/** Property cashflows at annual period ends. Rates are decimals; money is HKD.
 * Tax tables reproduce the workbook's dated assumptions, not a live tax feed.
 * This module is shared by the browser and Node tests and never reads user data.
 */

const DEFAULTS = {
  purchase_price: 4000000, assessed_value: 0, holding_years: 5,
  monthly_rent: 17000, first_year_vacancy_months: 3, annual_vacancy_months: 1,
  renovation_cost: 300000, ltv: 0.7, mortgage_rate: 0.03, mortgage_years: 20,
  sale_price_growth: 0, sale_price_change: null, benchmark_rate: 0.035,
  buying_commission_rate: 0.01, buying_legal_fees: 15000,
  selling_commission_rate: 0.01, selling_legal_fees: 15000,
  annual_management: 12000, rateable_value: null, government_rent_rate: 0.03,
  annual_insurance: 2500, annual_maintenance: 8000, annual_major_repairs: 10000,
  letting_commission_months: 0.5, reletting_interval_years: null,
  mortgage_exit_fee: 0, first_year_rates_deduction: 1,
  property_tax_rate: 0.15, statutory_deduction_rate: 0.2,
  lease_months: 24, lease_rent_free_months: 0, lease_copies: 1,
  landlord_duty_share: 0.5, extra_works: Array(10).fill(0),
  lease_counts: null, letting_counts: null,
};

const rows = [
  ['purchase_price','買入樓價','HKD','常用假設','float',0,null,100000],
  ['assessed_value','較高評定價值（如有）','HKD','常用假設','float',0,null,100000],
  ['holding_years','持有年數','年','常用假設','int',1,10,1],
  ['monthly_rent','每月租金','HKD','常用假設','float',0,null,500],
  ['first_year_vacancy_months','首年裝修／招租無租月數','月','常用假設','float',0,12,0.5],
  ['annual_vacancy_months','第2年起每年空置／免租','月','常用假設','float',0,12,0.5],
  ['renovation_cost','初始裝修預算','HKD','常用假設','float',0,null,10000],
  ['ltv','按揭成數','%','常用假設','float',0,0.7,0.05],
  ['mortgage_rate','按揭固定年利率','%','常用假設','float',0,null,0.001],
  ['mortgage_years','按揭還款年期','年','常用假設','int',1,null,1],
  ['sale_price_growth','每年樓價升跌假設','%','常用假設','float',-1,null,0.01],
  ['sale_price_change','出售時樓價累計升跌（舊版覆寫）','%','常用假設','float',-1,null,0.05],
  ['benchmark_rate','比較用債券年回報門檻','%','常用假設','float',-1,null,0.005],
  ['buying_commission_rate','買入代理佣金','%','買賣費用','float',0,null,0.001],
  ['buying_legal_fees','買入律師及雜費','HKD','買賣費用','float',0,null,1000],
  ['selling_commission_rate','出售代理佣金','%','買賣費用','float',0,1,0.001],
  ['selling_legal_fees','出售律師及雜費','HKD','買賣費用','float',0,null,1000],
  ['mortgage_exit_fee','出售時清還費／退回回贈','HKD','買賣費用','float',0,null,1000],
  ['annual_management','每年管理費','HKD','年度費用與稅務','float',0,null,1000],
  ['rateable_value','全年應課差餉租值 RV（留空估算）','HKD','年度費用與稅務','float',0,null,10000],
  ['government_rent_rate','地租佔 RV 比率','%','年度費用與稅務','float',0,null,0.005],
  ['annual_insurance','每年保險','HKD','年度費用與稅務','float',0,null,500],
  ['annual_maintenance','每年日常維修','HKD','年度費用與稅務','float',0,null,1000],
  ['annual_major_repairs','預計更新／大修支出（當年花掉）','HKD','年度費用與稅務','float',0,null,1000],
  ['letting_commission_months','每次招租佣金','月租','年度費用與稅務','float',0,null,0.25],
  ['reletting_interval_years','招租佣金間隔（留空跟租約）','年','年度費用與稅務','int',1,null,1],
  ['first_year_rates_deduction','首年差餉可扣稅比例','%','年度費用與稅務','float',0,1,0.05],
  ['property_tax_rate','普通個人物業稅率','%','年度費用與稅務','float',0,1,0.01],
  ['statutory_deduction_rate','法定修葺支出扣減比例','%','年度費用與稅務','float',0,1,0.01],
  ['lease_months','租期（包括租約免租期）','月','租約印花稅','int',1,null,1],
  ['lease_rent_free_months','租約內免租期（只影響印花稅）','月','租約印花稅','float',0,null,0.5],
  ['lease_copies','需加蓋印花的副本數','份','租約印花稅','int',0,null,1],
  ['landlord_duty_share','業主分攤比例','%','租約印花稅','float',0,1,0.05],
];
const specKeys = ['key','label','unit','group','kind','min','max','step'];
export const FIELD_SPECS = rows.map(row => Object.fromEntries(row.map((v,i) => [specKeys[i],v])));
const nullable = new Set(['rateable_value','sale_price_change','reletting_interval_years']);
const clone = value => structuredClone(value);
const finite = value => typeof value === 'number' && Number.isFinite(value);
const sum = values => values.reduce((a,b) => a+b,0);

export function presetA() { return clone(DEFAULTS); }
export function presetB() { return {...presetA(),sale_price_growth: Math.pow(1.2,1/5)-1}; }
export function presetOriginal() {
  return {...presetA(),monthly_rent:15000,first_year_vacancy_months:2,
    renovation_cost:150000,mortgage_rate:0.0293,mortgage_years:30,
    benchmark_rate:0.04,rateable_value:180000,reletting_interval_years:2,
    sale_price_change:0,lease_counts:[1,0,1,0,1,0,1,0,1,0]};
}

/** Validate raw scenarios before resolving automatic values. No partial results. */
export function validateInputs(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return ['方案必須是 JSON 物件。'];
  const errors = [];
  for (const key of Object.keys(data)) if (!Object.hasOwn(DEFAULTS,key)) errors.push(`未知假設欄位：${key}`);
  const p = {...presetA(),...data};
  for (const spec of FIELD_SPECS) {
    const value=p[spec.key];
    if (value === null && nullable.has(spec.key)) continue;
    if (!finite(value)) { errors.push(`${spec.label}必須是有限數字。`); continue; }
    if (spec.kind === 'int' && !Number.isSafeInteger(value)) errors.push(`${spec.label}必須是整數。`);
    if (value < spec.min || (spec.max !== null && value > spec.max)) errors.push(`${spec.label}超出允許範圍。`);
  }
  for (const key of ['extra_works','lease_counts','letting_counts']) {
    const values=p[key];
    if (key !== 'extra_works' && values === null) continue;
    if (!Array.isArray(values) || ![5,10].includes(values.length)) { errors.push(`${key}需要5或10個年度數值。`); continue; }
    if (values.some(v => !finite(v) || v < 0 || (key !== 'extra_works' && !Number.isSafeInteger(v)))) errors.push(`${key}必須是非負${key === 'extra_works' ? '數字' : '整數'}。`);
  }
  if (finite(p.purchase_price) && p.purchase_price <= 0) errors.push('買入樓價必須大於零。');
  for (const key of ['sale_price_growth','sale_price_change','benchmark_rate']) if (finite(p[key]) && p[key] <= -1) errors.push('樓價升跌及回報門檻必須大於 -100%。');
  if (finite(p.selling_commission_rate) && p.selling_commission_rate >= 1) errors.push('出售代理佣金必須低於100%。');
  if (finite(p.lease_rent_free_months) && finite(p.lease_months) && p.lease_rent_free_months > p.lease_months) errors.push('租約免租期不可超過租期。');
  return errors;
}

function requireValid(p) { const errors=validateInputs(p); if(errors.length) throw new Error(errors.join('\n')); }
export function inputsFromDict(data) { requireValid(data); return {...presetA(),...clone(data)}; }
export function inputsToDict(data) { return clone(data); }

function padded(values) { return [...values,...Array(10-values.length).fill(0)]; }
/** Derived schedules are explicit in the result and remain automatic in raw input. */
export function recommendedDefaults(partial={}, holding_years) {
  const p = {...presetA(),...clone(partial)};
  if (holding_years !== undefined) p.holding_years=holding_years;
  requireValid(p);
  if (p.rateable_value === null) p.rateable_value=p.monthly_rent*12;
  if (p.sale_price_change === null) p.sale_price_change=Math.pow(1+p.sale_price_growth,p.holding_years)-1;
  if (p.lease_counts === null) {
    p.lease_counts=Array(10).fill(0);
    // Month 12 belongs to year 2. A completely rent-free year has no auto signing.
    for(let month=p.first_year_vacancy_months; month<120; month+=p.lease_months) {
      const year=Math.floor(month/12);
      if ((year === 0 ? p.first_year_vacancy_months : p.annual_vacancy_months)<12) p.lease_counts[year]++;
    }
  } else p.lease_counts=padded(p.lease_counts);
  if (p.letting_counts === null) {
    p.letting_counts=[...p.lease_counts];
    if(p.reletting_interval_years !== null) {
      const first=p.first_year_vacancy_months===12?2:1;
      p.letting_counts=Array.from({length:10},(_,i)=> {
        const y=i+1; const rented=12-(y===1?p.first_year_vacancy_months:p.annual_vacancy_months);
        return rented>0 && y>=first && (y-first)%p.reletting_interval_years===0 ? 1:0;
      });
    }
  } else p.letting_counts=padded(p.letting_counts);
  p.extra_works=padded(p.extra_works);
  return p;
}

/** null inherits, zero overrides; per-year null entries inherit that year's A. */
export function mergeOverrides(base, overrides) {
  const data=inputsFromDict(base);
  const automatic=recommendedDefaults(base);
  for(const [key,value] of Object.entries(overrides)) {
    if(!Object.hasOwn(DEFAULTS,key)) throw new Error(`未知假設欄位：${key}`);
    if(value === null || value === undefined || value === '') continue;
    data[key]=Array.isArray(value) ? value.map((v,i)=>v===null?automatic[key][i]:v) : value;
  }
  return inputsFromDict(data);
}

// Exact rational arithmetic is only used for statutory round-up operations.
// It prevents binary floating point from adding a dollar at exact boundaries.
function fraction(value) {
  const [mantissa, exponent='0']=String(value).toLowerCase().split('e');
  const parts=mantissa.split('.'); const digits=parts.join('');
  const scale=(parts[1]?.length??0)-Number(exponent);
  return scale>=0 ? [BigInt(digits),10n**BigInt(scale)] : [BigInt(digits)*10n**BigInt(-scale),1n];
}
const multiply=(a,b)=>[a[0]*b[0],a[1]*b[1]];
const subtract=(a,b)=>[a[0]*b[1]-b[0]*a[1],a[1]*b[1]];
const divide=(a,b)=>[a[0]*b[1],a[1]*b[0]];
const ceiling=a=>Number((a[0]+a[1]-1n)/a[1]);
const numeric=a=>Number(a[0])/Number(a[1]);
const cents=a=>Number((a[0]*200n+a[1])/(a[1]*2n))/100;

export const AVD_BANDS = [
  [4000000,100,0,0],[4323780,100,4000000,0.2],[4500000,0,0,0.015],
  [4935480,67500,4500000,0.1],[6000000,0,0,0.0225],
  [6642860,135000,6000000,0.1],[9000000,0,0,0.03],
  [10080000,270000,9000000,0.1],[20000000,0,0,0.0375],
  [21739120,750000,20000000,0.1],[100000000,0,0,0.0425],
  [109574470,4250000,100000000,0.3],[Infinity,0,0,0.065],
];
export function purchaseStampDuty(price, assessed=0) {
  if(!finite(price)||price<=0||!finite(assessed)||assessed<0) throw new Error('買價及評定價值無效。');
  const base=Math.max(price,assessed);
  const [,fixed,start,rate]=AVD_BANDS.find(row=>base<=row[0]);
  return fixed+ceiling(multiply(subtract(fraction(base),fraction(start)),fraction(rate)));
}
export function progressiveRates(rv) {
  if(!finite(rv)||rv<0) throw new Error('應課差餉租值無效。');
  return Math.min(rv,550000)*0.05+Math.min(Math.max(rv-550000,0),250000)*0.08+Math.max(rv-800000,0)*0.12;
}
export function leaseStampDuty(raw) {
  requireValid(raw); const p={...presetA(),...raw};
  const total=multiply(fraction(p.monthly_rent),subtract(fraction(p.lease_months),fraction(p.lease_rent_free_months)));
  const base=p.lease_months<=12 ? total : divide(multiply(total,fraction(12)),fraction(p.lease_months));
  const rounded=ceiling(divide(base,fraction(100)))*100;
  const rate=p.lease_months<=12?0.0025:p.lease_months<=36?0.005:0.01;
  const original=ceiling(multiply(fraction(rounded),fraction(rate)));
  const copies=Math.min(5,original)*p.lease_copies; const combined=original+copies;
  const landlord=cents(multiply(fraction(combined),fraction(p.landlord_duty_share)));
  return {total_rent:numeric(total),tax_base:numeric(base),rounded_tax_base:rounded,rate,
    original_duty:original,copy_duty:copies,total_duty:combined,landlord_duty:landlord,tenant_duty:combined-landlord};
}
export function monthlyPayment(loan,annualRate,years) {
  if(![loan,annualRate,years].every(finite)||loan<0||annualRate<0||years<1||!Number.isSafeInteger(years)) throw new Error('貸款條件無效。');
  if(loan===0) return 0;
  const r=annualRate/12,n=years*12;
  return r===0?loan/n:loan*r/-Math.expm1(-n*Math.log1p(r));
}
function loanBalance(loan,payment,rate,months,paid) {
  const remaining=Math.max(0,months-paid);
  if(loan===0||remaining===0)return 0;
  // Present value of remaining instalments is stable near zero rates/payoff.
  return rate===0?loan*remaining/months:payment*-Math.expm1(-remaining*Math.log1p(rate))/rate;
}
export function npv(rate,flows) {
  if(!finite(rate)||rate<=-1||!flows.every(finite))throw new Error('淨現值的折現率或現金流無效。');
  return sum(flows.map((value,year)=>value/Math.pow(1+rate,year)));
}
export function annualIrr(flows) {
  if(!flows.every(finite))throw new Error('IRR 現金流必須是有限數字。');
  const signs=flows.filter(v=>v!==0).map(Math.sign);
  if(signs.slice(1).filter((v,i)=>v!==signs[i]).length!==1)return null;
  // Solve log(1+r), rescaling terms to avoid overflow near minus 100%.
  const objective=x=>{const shift=Math.max(0,-(flows.length-1)*x);return sum(flows.map((v,i)=>v*Math.exp(-i*x-shift)));};
  let low=-36,high=36,lv=objective(low); const hv=objective(high);
  if((lv>0)===(hv>0))return null;
  for(let i=0;i<160;i++) {
    const mid=(low+high)/2,value=objective(mid);
    if(value===0)return Math.expm1(mid);
    if((value>0)===(lv>0)){low=mid;lv=value;}else high=mid;
  }
  const answer=Math.expm1((low+high)/2);return answer>-1?answer:null;
}
function returns(initial,annual,key,p) {
  const cashflows=[-initial,...annual.slice(0,p.holding_years).map(row=>row[key])];
  return {cashflows,irr:annualIrr(cashflows),npv:npv(p.benchmark_rate,cashflows),total_profit:sum(cashflows)};
}

export function calculate(raw) {
  const p=recommendedDefaults(raw);
  const duty=purchaseStampDuty(p.purchase_price,p.assessed_value),rates=progressiveRates(p.rateable_value);
  const acquisition=p.purchase_price+duty+p.purchase_price*p.buying_commission_rate+p.buying_legal_fees+p.renovation_cost;
  const loan=p.purchase_price*p.ltv,equity=acquisition-loan;
  const payment=monthlyPayment(loan,p.mortgage_rate,p.mortgage_years),lease=leaseStampDuty(p);
  const sale_price=p.purchase_price*(1+p.sale_price_change);
  const annual=[]; let opening=loan;
  for(let year=1;year<=10;year++) {
    const rent_months=12-(year===1?p.first_year_vacancy_months:p.annual_vacancy_months);
    const rental_income=p.monthly_rent*rent_months;
    const letting_commission=p.monthly_rent*p.letting_commission_months*p.letting_counts[year-1];
    const lease_stamp_duty=lease.landlord_duty*p.lease_counts[year-1];
    const government_rent=p.rateable_value*p.government_rent_rate;
    const operating_costs=sum([p.annual_management,rates,government_rent,p.annual_insurance,p.annual_maintenance,
      p.annual_major_repairs,letting_commission,p.extra_works[year-1],lease_stamp_duty]);
    const operating_before_tax=rental_income-operating_costs;
    const deductible_rates=rates*(year===1?p.first_year_rates_deduction:1);
    const property_tax=Math.max(0,rental_income-deductible_rates)*(1-p.statutory_deduction_rate)*p.property_tax_rate;
    const operating_after_tax=operating_before_tax-property_tax;
    const debt_service=payment*Math.min(12,Math.max(0,p.mortgage_years*12-(year-1)*12));
    const loan_closing=loanBalance(loan,payment,p.mortgage_rate/12,p.mortgage_years*12,year*12);
    const principal=opening-loan_closing;
    const interest=Math.abs(debt_service-principal)<1e-8?0:debt_service-principal;
    const leveraged_before_tax=operating_before_tax-debt_service,leveraged_after_tax=operating_after_tax-debt_service;
    const exit=year===p.holding_years,active=year<=p.holding_years;
    const price=exit?sale_price:0;
    const selling_costs=exit?price*p.selling_commission_rate+p.selling_legal_fees:0;
    const cash_sale_proceeds=price-selling_costs;
    const loan_exit_fee=exit&&loan_closing>0.01?p.mortgage_exit_fee:0;
    const leveraged_sale_proceeds=exit?cash_sale_proceeds-loan_closing-loan_exit_fee:0;
    annual.push({year,rent_months,rental_income,management_fee:p.annual_management,rates,government_rent,
      insurance:p.annual_insurance,maintenance:p.annual_maintenance,major_repairs:p.annual_major_repairs,
      letting_commission,extra_works:p.extra_works[year-1],lease_stamp_duty,operating_costs,
      operating_before_tax,deductible_rates,property_tax,operating_after_tax,loan_opening:opening,
      debt_service,interest,principal,loan_closing,leveraged_before_tax,leveraged_after_tax,
      sale_price:price,selling_costs,cash_sale_proceeds,loan_exit_fee,leveraged_sale_proceeds,
      cash_before_tax_flow:active?operating_before_tax+cash_sale_proceeds:0,
      cash_after_tax_flow:active?operating_after_tax+cash_sale_proceeds:0,
      leveraged_before_tax_flow:active?leveraged_before_tax+leveraged_sale_proceeds:0,
      leveraged_after_tax_flow:active?leveraged_after_tax+leveraged_sale_proceeds:0});
    opening=loan_closing;
  }
  const exit=annual[p.holding_years-1],compound=Math.pow(1+p.benchmark_rate,p.holding_years);
  const future=key=>sum(annual.slice(0,p.holding_years).map(row=>row[key]*Math.pow(1+p.benchmark_rate,p.holding_years-row.year)));
  const required_sale_price_cash=(acquisition*compound-future('operating_before_tax')+p.selling_legal_fees)/(1-p.selling_commission_rate);
  const required_sale_price_leveraged=(equity*compound-future('leveraged_before_tax')+exit.loan_closing+p.selling_legal_fees+exit.loan_exit_fee)/(1-p.selling_commission_rate);
  const result={inputs:p,purchase_duty_base:Math.max(p.purchase_price,p.assessed_value),purchase_stamp_duty:duty,
    annual_rates:rates,acquisition_cost:acquisition,loan_amount:loan,initial_equity:equity,monthly_payment:payment,sale_price,lease_duty:lease,annual,
    cash_before_tax:returns(acquisition,annual,'cash_before_tax_flow',p),cash_after_tax:returns(acquisition,annual,'cash_after_tax_flow',p),
    leveraged_before_tax:returns(equity,annual,'leveraged_before_tax_flow',p),leveraged_after_tax:returns(equity,annual,'leveraged_after_tax_flow',p),
    required_sale_price_cash,required_sale_price_leveraged,required_price_change_leveraged:required_sale_price_leveraged/p.purchase_price-1,
    first_year_monthly_subsidy:Math.max(0,-annual[0].leveraged_after_tax/12),loan_at_exit:exit.loan_closing,
    cash_sale_proceeds:exit.cash_sale_proceeds,leveraged_sale_proceeds:exit.leveraged_sale_proceeds};
  const finiteTree=value=>value===null || (Array.isArray(value)?value.every(finiteTree):typeof value==='object'?Object.values(value).every(finiteTree):finite(value));
  if(!finiteTree(result))throw new Error('輸入數值過大，超出可計算範圍。');
  return result;
}
export function yearlyExits(inputs) {
  return [3,5,10].map(holding_years=>calculate({...inputs,holding_years,sale_price_change:null}));
}
export function sensitivity(inputs,field,values) {
  if(!FIELD_SPECS.some(spec=>spec.key===field))throw new Error('敏感度欄位不受支援。');
  return values.map(value=>calculate(mergeOverrides(inputs,{[field]:value})));
}
