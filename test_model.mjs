import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {calculate,presetA,presetB,presetOriginal,recommendedDefaults,mergeOverrides,
  inputsFromDict,inputsToDict,validateInputs,purchaseStampDuty,progressiveRates,
  leaseStampDuty,monthlyPayment,annualIrr,npv,yearlyExits,sensitivity,DSR_LIMIT_NON_SELF_USE} from './model.js';

// These values were extracted read-only from the source workbook's cached
// formulas before its redesign. The app never needs the private XLSX file.
const workbook=JSON.parse(readFileSync(new URL('./workbook-parity.json',import.meta.url),'utf8'));
const close=(actual,expected,tolerance=0.00002)=>assert.ok(
  Math.abs(actual-expected)<=tolerance,
  `Expected ${expected}, got ${actual}; difference ${actual-expected}`,
);
const at=(object,path)=>path.split('.').reduce((value,key)=>value[key],object);

for(const fixture of workbook.scenarios) test(`570 cached Excel outputs: ${fixture.name} scenario`,()=>{
  const result=calculate(inputsFromDict(fixture.inputs));
  for(const [key,value] of Object.entries(fixture.summary)) close(at(result,key),value,key.endsWith('.irr')?1e-8:0.00002);
  fixture.annual.forEach((row,index)=>{
    for(const [key,value] of Object.entries(row)) close(result.annual[index][key],value);
  });
});

test('new automatic defaults match independently calculated 3/5/10-year returns',()=>{
  const expected=[-0.07504203808294752,-0.03231372759220879,0.0006725124227661169];
  const results=yearlyExits(presetA());
  assert.deepEqual(results.map(r=>r.inputs.holding_years),[3,5,10]);
  results.forEach((r,i)=>close(r.leveraged_after_tax.irr,expected[i],1e-12));
  close(results[0].annual[0].operating_costs,57832.5);
  close(results[0].annual[0].property_tax,17136);
  assert.equal(results[0].inputs.rateable_value,204000);
});

test('all cashflow and amortization identities hold without double-counting principal',()=>{
  for(const raw of [presetA(),presetB(),presetOriginal(),{...presetA(),holding_years:10,mortgage_years:3,mortgage_exit_fee:30000},
    {...presetA(),pa_marginal_rate:0.17,bank_valuation:3800000,holding_years:3,mortgage_exit_fee:56000}]) {
    const r=calculate(raw);
    for(const row of r.annual) {
      close(row.debt_service,row.interest+row.principal);
      close(row.loan_opening-row.principal,row.loan_closing);
      close(row.operating_costs,sumCosts(row));
      close(row.operating_after_tax,row.rental_income-row.operating_costs-row.cash_tax);
      close(row.leveraged_after_tax,row.rental_income-row.operating_costs-row.leveraged_tax-row.debt_service);
      assert.ok(row.cash_tax<=row.property_tax+1e-9&&row.leveraged_tax<=row.property_tax+1e-9);
      assert.ok(row.loan_closing>=0);
    }
    const final=r.annual[r.inputs.holding_years-1];
    close(final.leveraged_sale_proceeds,final.sale_price-final.selling_costs-final.loan_closing-final.loan_exit_fee);
    const operations=r.annual.slice(0,r.inputs.holding_years).reduce((s,row)=>s+row.leveraged_after_tax,0);
    close(r.leveraged_after_tax.total_profit,-r.initial_equity+operations+final.leveraged_sale_proceeds);
    assert.ok(r.annual.slice(r.inputs.holding_years).every(row=>row.leveraged_after_tax_flow===0));
  }
});
function sumCosts(row) { return ['management_fee','rates','government_rent','insurance','maintenance','major_repairs','letting_commission','extra_works','lease_stamp_duty'].reduce((s,key)=>s+row[key],0); }

test('zero mortgage exactly matches unlevered cashflows and suppresses exit charge',()=>{
  const r=calculate({...presetA(),ltv:0,mortgage_exit_fee:100000});
  assert.equal(r.monthly_payment,0);
  assert.deepEqual(r.cash_after_tax,r.leveraged_after_tax);
  assert.equal(r.loan_at_exit,0);
  assert.ok(r.annual.every(row=>row.debt_service===0&&row.loan_exit_fee===0));
});

test('zero and tiny rates amortize correctly and stop at contractual maturity',()=>{
  const r=calculate({...presetA(),mortgage_rate:0,mortgage_years:3,holding_years:10});
  close(r.monthly_payment,2800000/36);
  r.annual.forEach((row,i)=>{
    close(row.interest,0);
    if(i>=3){assert.equal(row.debt_service,0);assert.equal(row.loan_closing,0);}
  });
  const tiny=calculate({...presetA(),mortgage_rate:1e-12,mortgage_years:3});
  close(tiny.monthly_payment,r.monthly_payment,1e-5);
});

test('repayment fees, purchase costs, extra works and property tax remain in the correct cashflows',()=>{
  const base=calculate(presetA());
  const changed=calculate({...presetA(),buying_legal_fees:25000,mortgage_exit_fee:20000,mortgage_exit_fee_years:5,
    extra_works:[10000,0,0,0,0,0,0,0,0,0]});
  close(changed.initial_equity-base.initial_equity,10000);
  close(changed.leveraged_sale_proceeds-base.leveraged_sale_proceeds,-20000);
  close(changed.leveraged_after_tax.total_profit-base.leveraged_after_tax.total_profit,-40000);
  close(changed.annual[0].property_tax,base.annual[0].property_tax);
  const expensiveLoan=calculate({...presetA(),mortgage_rate:0.1});
  close(expensiveLoan.annual[0].property_tax,base.annual[0].property_tax);
  const paidOff=calculate({...presetA(),mortgage_years:2,mortgage_exit_fee:20000,mortgage_exit_fee_years:5});
  assert.equal(paidOff.annual[4].loan_exit_fee,0);
});

test('AVD brackets use exact round-up at boundaries and higher assessment',()=>{
  const cases=[[4000000,100],[4000000.01,101],[4323780,64856],[4323781,64857],
    [4500000,67500],[4500001,67501],[4935480,111048],[4935481,111049],
    [6000000,135000],[6000001,135001],[6642860,199286],[6642861,199286],
    [9000000,270000],[9000001,270001],[10080000,378000],[10080001,378001],
    [20000000,750000],[20000001,750001],[21739120,923912],[21739121,923913],
    [100000000,4250000],[100000001,4250001],[109574470,7122341],[109574471,7122341]];
  for(const [price,expected] of cases)assert.equal(purchaseStampDuty(price),expected,`AVD ${price}`);
  assert.equal(purchaseStampDuty(4000000,4500000),67500);
  assert.equal(purchaseStampDuty(4500000,4000000),67500);
});

test('progressive rates threshold cases',()=>{
  assert.equal(progressiveRates(0),0);
  assert.equal(progressiveRates(550000),27500);
  assert.equal(progressiveRates(800000),47500);
  assert.equal(progressiveRates(1000000),71500);
});

test('lease period bands, rounding, copy limits and exact owner-cent rounding',()=>{
  const raw={...presetA(),monthly_rent:15000};
  const cases=[[6,225],[12,450],[13,900],[36,900],[37,1800]];
  for(const [lease_months,expected] of cases)assert.equal(leaseStampDuty({...raw,lease_months}).original_duty,expected);
  const lease=leaseStampDuty({...raw,lease_months:24});
  assert.equal(lease.original_duty,900);assert.equal(lease.copy_duty,5);assert.equal(lease.landlord_duty,452.5);
  const rounded=leaseStampDuty({...raw,monthly_rent:1000.01,lease_months:12});
  assert.equal(rounded.rounded_tax_base,12100);assert.equal(rounded.original_duty,31);
  const small=leaseStampDuty({...raw,monthly_rent:1,lease_months:12,lease_copies:2,landlord_duty_share:0.335});
  assert.equal(small.original_duty,1);assert.equal(small.copy_duty,2);assert.equal(small.landlord_duty,1.01);
  const free=leaseStampDuty({...raw,lease_rent_free_months:24});
  assert.equal(free.total_duty,0);
});

test('lease free months adjust duty only; actual vacancy controls actual rent',()=>{
  const regular=calculate(presetA());
  const free=calculate({...presetA(),lease_rent_free_months:2});
  assert.equal(free.annual[0].rental_income,regular.annual[0].rental_income);
  assert.ok(free.lease_duty.total_duty<regular.lease_duty.total_duty);
});

test('automatic lease and commission schedules use calendar boundaries, including delayed letting',()=>{
  assert.deepEqual(recommendedDefaults(presetA()).lease_counts,[1,0,1,0,1,0,1,0,1,0]);
  assert.deepEqual(recommendedDefaults({...presetA(),first_year_vacancy_months:12}).lease_counts,[0,1,0,1,0,1,0,1,0,1]);
  assert.deepEqual(recommendedDefaults({...presetA(),lease_months:6}).lease_counts,Array(10).fill(2));
  const empty=recommendedDefaults({...presetA(),first_year_vacancy_months:12,annual_vacancy_months:12});
  assert.deepEqual(empty.lease_counts,Array(10).fill(0));
  assert.deepEqual(empty.letting_counts,Array(10).fill(0));
});

test('automatic RV updates with rent but explicit assessment, including zero, wins',()=>{
  assert.equal(calculate({...presetA(),monthly_rent:20000}).inputs.rateable_value,240000);
  assert.equal(calculate({...presetA(),monthly_rent:20000,rateable_value:180000}).inputs.rateable_value,180000);
  assert.equal(calculate({...presetA(),rateable_value:0}).annual_rates,0);
});

test('same annual house-price growth compounds correctly for 3/5/10 exits',()=>{
  const results=yearlyExits(presetB());
  close(results[1].sale_price,4800000);
  close(results[2].sale_price,5760000);
  close(results[0].sale_price,4000000*Math.pow(1.2,3/5));
  assert.equal(calculate({...presetA(),sale_price_change:0.2}).sale_price,4800000);
});

test('required sale price solves the pretax hurdle including interim subsidies and exit fee',()=>{
  const raw={...presetA(),holding_years:10,mortgage_exit_fee:45000,mortgage_exit_fee_years:10,extra_works:[0,0,100000,0,0,0,0,0,0,0]};
  assert.equal(calculate(raw).annual[9].loan_exit_fee,45000);
  const r=calculate(raw);
  const mortgage=calculate({...raw,sale_price_change:r.required_sale_price_leveraged/raw.purchase_price-1});
  const cash=calculate({...raw,sale_price_change:r.required_sale_price_cash/raw.purchase_price-1});
  close(mortgage.leveraged_before_tax.npv,0);
  close(cash.cash_before_tax.npv,0);
  close(mortgage.leveraged_before_tax.irr,raw.benchmark_rate,1e-11);
});

test('IRR ignores zero flows, declines ambiguous sign patterns, and keeps NPV available',()=>{
  close(annualIrr([-100,0,121]),0.1,1e-12);
  close(annualIrr([-100,90]),-0.1,1e-12);
  assert.equal(annualIrr([-100,230,-132]),null);
  assert.equal(annualIrr([-100,-1,-1]),null);
  assert.equal(annualIrr([0,0,0]),null);
  assert.ok(Number.isFinite(npv(0.04,[-100,230,-132])));
});

test('B inheritance preserves zero and per-year nulls; JSON round trip is lossless',()=>{
  const base=presetA();
  const merged=mergeOverrides(base,{monthly_rent:null,ltv:0,extra_works:[null,10000,null,null,null,null,null,null,null,null]});
  assert.equal(merged.monthly_rent,17000);assert.equal(merged.ltv,0);
  assert.deepEqual(merged.extra_works,[0,10000,0,0,0,0,0,0,0,0]);
  assert.deepEqual(inputsFromDict(JSON.parse(JSON.stringify(inputsToDict(merged)))),merged);
  assert.deepEqual(base,presetA());
  const scenarios=sensitivity(base,'monthly_rent',[15000,17000,19000]);
  assert.ok(scenarios[2].leveraged_after_tax.irr>scenarios[0].leveraged_after_tax.irr);
});

test('invalid and hostile imports fail before calculation',()=>{
  for(const change of [
    {purchase_price:0},{monthly_rent:-1},{mortgage_rate:NaN},{ltv:0.8},
    {holding_years:11},{holding_years:3.5},{mortgage_years:0},{mortgage_years:Infinity},
    {sale_price_growth:-1},{sale_price_change:-1},{benchmark_rate:-1},
    {selling_commission_rate:1},{lease_months:0},{lease_copies:0.5},
    {lease_rent_free_months:25},{landlord_duty_share:1.1},
    {extra_works:[0,0]},{lease_counts:[1,null,1,0,1]},
    {property_tax_rate:2},{monthly_rent:'17000'},{ltv:true},
    {mortgage_years:31},{pa_marginal_rate:0.2},{pa_marginal_rate:-0.01},{bank_valuation:-1},
    {mortgage_exit_fee_years:-1},{mortgage_exit_fee_years:1.5},{mortgage_exit_fee_years:31},
  ]) {
    const raw={...presetA(),...change};
    assert.ok(validateInputs(raw).length>0,JSON.stringify(change));
    assert.throws(()=>calculate(raw));
  }
  for(const key of ['__proto__','constructor','toString','unrecognized']) {
    const bad=JSON.parse(`{"${key}":123}`);
    assert.throws(()=>inputsFromDict(bad),/未知/);
    assert.throws(()=>mergeOverrides(presetA(),bad),/未知/);
  }
  assert.throws(()=>monthlyPayment(1,0,-1));
  assert.throws(()=>npv(-1,[-100,110]));
  assert.throws(()=>inputsFromDict(null));
});

test('HKMA limits: tenor at most 30 years and LTV at most 70%, with plain-language errors',()=>{
  assert.deepEqual(validateInputs({...presetA(),mortgage_years:30}),[]);
  assert.match(validateInputs({...presetA(),mortgage_years:31}).join(''),/30 年/);
  assert.match(validateInputs({...presetA(),ltv:0.71}).join(''),/70%/);
  assert.throws(()=>calculate({...presetA(),mortgage_years:40}),/30 年/);
});

test('early-repayment charge applies only when the sale falls inside the lock-in period',()=>{
  const fee={...presetA(),mortgage_exit_fee:56000};
  const exits=yearlyExits(fee);
  assert.deepEqual(exits.map(r=>r.annual[r.inputs.holding_years-1].loan_exit_fee),[56000,0,0]);
  const base=yearlyExits(presetA());
  close(base[0].leveraged_sale_proceeds-exits[0].leveraged_sale_proceeds,56000);
  close(exits[1].leveraged_sale_proceeds,base[1].leveraged_sale_proceeds);
  assert.deepEqual(yearlyExits({...fee,mortgage_exit_fee_years:0}).map(r=>r.loan_at_exit>0&&r.annual[r.inputs.holding_years-1].loan_exit_fee),[0,0,0]);
  assert.deepEqual(yearlyExits({...fee,mortgage_exit_fee_years:10}).map(r=>r.annual[r.inputs.holding_years-1].loan_exit_fee),[56000,56000,56000]);
  // The pre-tax hurdle price still solves exactly when the charge applies.
  const r=calculate({...fee,holding_years:3});
  close(calculate({...fee,holding_years:3,sale_price_change:r.required_sale_price_leveraged/fee.purchase_price-1}).leveraged_before_tax.npv,0);
});

test('bank valuation below price lowers the loan; a higher valuation does not raise it',()=>{
  const base=calculate(presetA());
  const short=calculate({...presetA(),bank_valuation:3800000});
  assert.equal(short.lending_value,3800000);
  close(short.loan_amount,2660000);
  close(short.initial_equity-base.initial_equity,140000);
  close(short.acquisition_cost,base.acquisition_cost);
  const high=calculate({...presetA(),bank_valuation:5000000});
  assert.equal(high.loan_amount,base.loan_amount);
  assert.equal(calculate({...presetA(),bank_valuation:0}).loan_amount,2800000);
});

test('personal assessment deducts let-month interest capped at NAV and never exceeds property tax',()=>{
  const base=calculate(presetA());
  // 0% keeps the previous ordinary-property-tax model exactly.
  assert.deepEqual(calculate({...presetA(),pa_marginal_rate:0}),base);
  const pa=calculate({...presetA(),pa_marginal_rate:0.15});
  const y1=pa.annual[0];
  close(y1.net_assessable_value,(153000-10200)*0.8);
  close(y1.property_tax,17136);
  close(y1.pa_deductible_interest,base.annual[0].interest*9/12);
  close(y1.leveraged_tax,(y1.net_assessable_value-y1.pa_deductible_interest)*0.15);
  close(y1.cash_tax,17136);
  assert.ok(pa.leveraged_after_tax.irr>base.leveraged_after_tax.irr);
  assert.deepEqual(pa.leveraged_before_tax,base.leveraged_before_tax);
  assert.deepEqual(pa.cash_after_tax,base.cash_after_tax);
  // A low marginal rate helps even without interest; a high rate with little interest falls back.
  close(calculate({...presetA(),pa_marginal_rate:0.02}).annual[1].cash_tax,calculate(presetA()).annual[1].net_assessable_value*0.02);
  const cheapLoan=calculate({...presetA(),pa_marginal_rate:0.17,mortgage_rate:0.001});
  cheapLoan.annual.forEach(row=>close(row.leveraged_tax,row.property_tax));
  // Interest above NAV is capped, so tax stops at zero instead of creating a loss.
  const dear=calculate({...presetA(),pa_marginal_rate:0.17,mortgage_rate:0.08});
  close(dear.annual[0].pa_deductible_interest,dear.annual[0].net_assessable_value);
  close(dear.annual[0].leveraged_tax,0);
  // Without a mortgage there is no interest to deduct.
  const cash=calculate({...presetA(),ltv:0,pa_marginal_rate:0.17});
  cash.annual.forEach(row=>close(row.leveraged_tax,row.property_tax));
});

test('DSR helper shows the minimum monthly income at the 50% non-self-use limit',()=>{
  const r=calculate(presetA());
  assert.equal(DSR_LIMIT_NON_SELF_USE,0.5);
  close(r.min_monthly_income_dsr,r.monthly_payment/0.5);
  assert.equal(calculate({...presetA(),ltv:0}).min_monthly_income_dsr,0);
});
