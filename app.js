import { FIELD_SPECS, presetA, presetB, presetOriginal, mergeOverrides,
  calculate, validateInputs, yearlyExits } from './model.js';

// The calculation engine owns all financial rules. This file only handles
// presentation, explicit local saves and the A/common versus B/override inputs.
const $ = (id) => document.getElementById(id);
const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clone = (value) => structuredClone(value);
const number = new Intl.NumberFormat('en-HK', { maximumFractionDigits: 0 });
const precise = new Intl.NumberFormat('en-HK', { maximumFractionDigits: 2 });
const money = (v) => Number.isFinite(v) ? `${v < 0 ? '−' : ''}$${number.format(Math.abs(v))}` : '—';
const wan = (v) => Number.isFinite(v) ? precise.format(v / 10000) : '—';
const pct = (v) => Number.isFinite(v) ? `${(v * 100).toFixed(2)}%` : '不適用';
const color = (v) => Number.isFinite(v) && v < 0 ? 'negative' : '';
const STORAGE_KEY = 'property-cashflow-saved-v1';
const HORIZONS = [3, 5, 10];
const scalarSpecs = FIELD_SPECS.filter((s) => !['holding_years','sale_price_change'].includes(s.key));
const knownKeys = Object.keys(presetA());
let dirty = false;
let saved = [];
let activeSavedId = '';
let results = {};

function defaultState(original = false) {
  const base = original ? presetOriginal() : presetA();
  const comparison = original ? presetOriginal() : presetB();
  const overrides = {};
  for (const key of knownKeys) {
    if (JSON.stringify(base[key]) !== JSON.stringify(comparison[key])) overrides[key] = clone(comparison[key]);
  }
  return { version: 1, base: clone(base), overrides };
}
let state = defaultState();

function notify(message, error = false) {
  $('notification').textContent = message;
  $('notification').className = `notice${error ? ' error' : ''}`;
  $('notification').hidden = false;
}

function errorsFor(inputs) {
  const errors = validateInputs(inputs);
  return Array.isArray(errors) ? errors : [];
}

function resolveB(current = state) { return mergeOverrides(current.base, current.overrides); }
function inputsFor(key) { return key === 'original' ? presetOriginal() : key === 'b' ? resolveB() : state.base; }
function horizonResult(inputs, years = 5) { return calculate({ ...inputs, holding_years: years, sale_price_change: null }); }

// Import only the numeric model schema: no HTML, paths, scripts or arbitrary keys.
// A file is read in this browser and is never uploaded.
function readSnapshot(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.version !== 1) throw new Error('這不是支援的方案格式（version 1）。');
  if (Object.keys(raw).some((k) => !['version','base','overrides'].includes(k))) throw new Error('方案含有未支援的欄位。');
  const checkValues = (object, partial) => {
    if (!object || typeof object !== 'object' || Array.isArray(object)) throw new Error('方案輸入格式不正確。');
    if (Object.keys(object).some((key) => !knownKeys.includes(key))) throw new Error('方案含有未知輸入欄位。');
    if (!partial && knownKeys.some((key) => !Object.hasOwn(object, key))) throw new Error('方案缺少必要輸入，請使用本頁下載的 JSON。');
    for (const value of Object.values(object)) {
      if (value === null) continue;
      if (Array.isArray(value)) {
        if (![5,10].includes(value.length) || value.some((v) => v !== null && (typeof v !== 'number' || !Number.isFinite(v)))) throw new Error('年度輸入必須是 5 或 10 個有效數值。');
      } else if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('輸入必須是有限數值或留白。');
    }
  };
  checkValues(raw.base, false); checkValues(raw.overrides, true);
  const next = { version: 1, base: clone(raw.base), overrides: clone(raw.overrides) };
  for (const key of ['extra_works','lease_counts','letting_counts']) {
    if (Array.isArray(next.base[key]) && next.base[key].length === 5) next.base[key].push(...Array(5).fill(0));
    if (Array.isArray(next.overrides[key]) && next.overrides[key].length === 5) next.overrides[key].push(...Array(5).fill(0));
  }
  // Convert old cumulative overrides once so every horizon uses one annual rate.
  if (next.base.sale_price_change !== null) {
    next.base.sale_price_growth = Math.pow(1 + next.base.sale_price_change, 1 / next.base.holding_years) - 1;
    next.base.sale_price_change = null;
  }
  if (next.overrides.sale_price_change !== undefined && next.overrides.sale_price_change !== null) {
    next.overrides.sale_price_growth = Math.pow(1 + next.overrides.sale_price_change, 1 / (next.overrides.holding_years ?? next.base.holding_years)) - 1;
  }
  delete next.overrides.sale_price_change;
  const errors = [...errorsFor(next.base), ...errorsFor(resolveB(next))];
  if (errors.length) throw new Error(errors.join('；'));
  // Check the longest requested horizon before accepting a saved scenario.
  horizonResult(next.base, 10); horizonResult(resolveB(next), 10);
  return next;
}

function loadDeviceStore() {
  try {
    const text = localStorage.getItem(STORAGE_KEY);
    if (!text) return;
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed.scenarios)) throw new Error('格式不正確');
    saved = parsed.scenarios.filter((r) => typeof r.id === 'string' && typeof r.name === 'string' && r.name.length <= 60).map((r) => ({id:r.id, name:r.name, snapshot:readSnapshot(r.snapshot)}));
    const last = saved.find((r) => r.id === parsed.activeId);
    if (last) { state = clone(last.snapshot); activeSavedId = last.id; $('scenario-name').value = last.name; }
  } catch { notify('本機保存的方案未能讀取，已載入預設；原本的瀏覽器資料尚未刪除。', true); }
}

function writeDeviceStore() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ activeId: activeSavedId, scenarios: saved }));
}
function renderSavedOptions() {
  $('saved-scenarios').innerHTML = '<option value="">選擇已保存單位</option>' + saved.map((r) => `<option value="${escapeHtml(r.id)}">${escapeHtml(r.name)}</option>`).join('');
  $('saved-scenarios').value = activeSavedId;
  $('load-device').disabled = saved.length === 0;
  $('delete-device').disabled = saved.length === 0;
}

function saveDevice() {
  if (!$('quick-errors').hidden) { notify('請先完成上方有效輸入，再儲存方案。', true); return; }
  if (dirty) { notify('詳細假設尚有未套用修改，請先套用，再儲存。', true); selectTab('inputs'); return; }
  const name = $('scenario-name').value.trim();
  if (!name) { notify('請先為這個單位輸入名稱。', true); $('scenario-name').focus(); return; }
  const prior = clone(saved); const previousActive = activeSavedId;
  const existing = saved.find((r) => r.name === name);
  activeSavedId = existing?.id || crypto.randomUUID();
  const record = {id:activeSavedId, name, snapshot:clone(state)};
  if (existing) saved[saved.indexOf(existing)] = record; else saved.push(record);
  try { writeDeviceStore(); renderSavedOptions(); $('save-status').textContent = `已儲存：${name}`; notify(`「${name}」已儲存到這部裝置。`); }
  catch { saved = prior; activeSavedId = previousActive; notify('瀏覽器未能保存資料。請使用「下載 JSON」備份目前方案。', true); }
}

function applyState(next, message) {
  state = readSnapshot(next); dirty = false;
  $('quick-errors').hidden = true;
  refreshQuickInputs(); renderAll(); renderInputs();
  $('save-status').textContent = '目前修改尚未儲存';
  if (message) notify(message);
}

function refreshQuickInputs() {
  document.querySelectorAll('[data-quick]').forEach((input) => {
    const key = input.dataset.quick;
    const value = state.base[key];
    input.value = value === null ? '' : String(Number((value * (input.dataset.percent ? 100 : 1)).toFixed(8)));
  });
  $('auto-rv').checked = state.base.rateable_value === null;
  $('auto-leases').checked = state.base.lease_counts === null;
}

function quickChange() {
  const next = clone(state);
  for (const input of document.querySelectorAll('[data-quick]')) {
    if (!input.value.trim()) { $('quick-errors').textContent = '請完成上方數值；下方結果仍為上一次有效輸入。'; $('quick-errors').hidden = false; return; }
    const value = Number(input.value);
    if (!Number.isFinite(value)) return;
    next.base[input.dataset.quick] = value / (input.dataset.percent ? 100 : 1);
  }
  // Annual growth is authoritative in the mobile workflow, including legacy imports.
  next.base.sale_price_change = null;
  try {
    const checked = readSnapshot(next);
    if (dirty) notify('上方即時輸入已套用；詳細輸入區已同步至這次計算。');
    state = checked; dirty = false;
    $('auto-rv').checked = state.base.rateable_value === null;
    $('auto-leases').checked = state.base.lease_counts === null;
    $('quick-errors').hidden = true;
    $('save-status').textContent = '目前修改尚未儲存';
    renderAll(); renderInputs();
  } catch (error) { $('quick-errors').textContent = `${error.message} 下方仍顯示上一次有效結果。`; $('quick-errors').hidden = false; }
}

function signChanges(values) {
  const signs = values.filter((v) => v !== 0).map(Math.sign);
  return signs.slice(1).filter((s, i) => s !== signs[i]).length;
}

function renderQuick() {
  const horizons = yearlyExits(state.base);
  const r = horizons.find((r) => r.inputs.holding_years === 5) || horizons[1];
  $('quick-assumptions-summary').textContent = `按揭 ${pct(state.base.ltv)} · 固定 ${pct(state.base.mortgage_rate)} · ${state.base.mortgage_years} 年 · 樓價每年 ${pct(state.base.sale_price_growth)}`;
  $('derived-summary').textContent = `假設算例｜首年無租 ${state.base.first_year_vacancy_months} 個月，其後每年空置 ${state.base.annual_vacancy_months} 個月；${state.base.rateable_value === null ? '自動估算' : '手動設定'} RV ${money(r.inputs.rateable_value)}${state.base.rateable_value === null ? '（月租 × 12，並非正式差餉租值）' : ''}。租金及年度成本全期固定，按息亦假設全期不變。`;
  const metrics = [
    ['買入時自有資金',`${precise.format(r.initial_equity / 10000)} 萬`,'首期、費用及裝修；未含備用金'],
    ['每月供樓',money(r.monthly_payment),'本息攤還'],
    ['首年平均每月補貼',money(r.first_year_monthly_subsidy),'物業稅及供款後，全年平均'],
  ];
  $('quick-metrics').innerHTML = metrics.map(([label,value,note]) => `<div><div class="quick-metric-label">${label}</div><div class="quick-metric-value">${value}</div><div class="quick-metric-note">${note}</div></div>`).join('');
  const actualRows = (result) => result.annual.slice(0,result.inputs.holding_years);
  const rows = [
    ['按揭後年化 IRR', (v) => v.leveraged_after_tax.irr, pct, 'key-row'],
    ['全現金年化 IRR', (v) => v.cash_after_tax.irr, pct],
    ['累計自有資金投入', (v) => v.initial_equity + actualRows(v).reduce((sum,row) => sum + Math.max(0,-row.leveraged_after_tax),0), wan],
    ['期間淨租務現金', (v) => actualRows(v).reduce((sum,row) => sum + row.leveraged_after_tax,0), wan],
    ['預計售價', (v) => v.sale_price, wan],
    ['出售時剩餘貸款', (v) => v.loan_at_exit, wan],
    ['出售後淨收款', (v) => v.leveraged_sale_proceeds, wan],
    ['持有期總盈虧', (v) => v.leveraged_after_tax.total_profit, wan],
  ];
  $('horizons-table').innerHTML = `<table class="horizon-table"><thead><tr><th>金額：HKD 萬</th>${horizons.map((v) => `<th>${v.inputs.holding_years} 年</th>`).join('')}</tr></thead><tbody>${rows.map(([label,get,format,cls='']) => `<tr class="${cls}"><th>${label}</th>${horizons.map((v) => `<td class="${color(get(v))}">${format(get(v))}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  const missing = horizons.filter((v) => v.leveraged_after_tax.irr === null).map((v) => `${v.inputs.holding_years} 年`);
  $('quick-irr-note').textContent = missing.length ? `${missing.join('、')}的現金流無唯一可顯示 IRR；可於詳細比較查看 NPV。` : '年化回報採年末現金流近似；並非按實際日期計算。累計自有資金投入未扣回中途分派的盈餘。';
  $('included-costs').innerHTML = `<summary>已計入哪些成本 <span>費率、金額均可在詳細假設修改</span></summary><p>管理費 ${money(state.base.annual_management / 12)}／月、保險 ${money(state.base.annual_insurance)}／年、日常維修 ${money(state.base.annual_maintenance)}／年、預計更新／大修支出 ${money(state.base.annual_major_repairs)}／年（當年花掉）。另計買入 AVD ${money(r.purchase_stamp_duty)}、差餉 ${money(r.annual_rates)}／年、地租、物業稅、租約印花稅、招租佣金、買賣代理及律師雜費。額外工程只填超出上述維修的支出；預算並非已取得的報價。</p>`;
}

const returnRows = [
  ['按揭 · 稅前 IRR', (r) => r.leveraged_before_tax.irr, pct],
  ['按揭 · 物業稅後 IRR', (r) => r.leveraged_after_tax.irr, pct, 'key-row'],
  ['全現金 · 稅前 IRR', (r) => r.cash_before_tax.irr, pct],
  ['全現金 · 物業稅後 IRR', (r) => r.cash_after_tax.irr, pct],
  ['按揭 · 稅前 NPV', (r) => r.leveraged_before_tax.npv, money],
  ['全現金 · 稅前 NPV', (r) => r.cash_before_tax.npv, money],
];
function compareTable(rows) {
  const columns = $('show-original').checked ? [['original','原例'],['a','方案 A'],['b','方案 B']] : [['a','方案 A'],['b','方案 B']];
  return `<table class="comparison-table"><thead><tr><th>第 5 年退出</th>${columns.map(([,name]) => `<th>${name}</th>`).join('')}</tr></thead><tbody>${rows.map(([label,get,format=money,cls='']) => `<tr class="${cls}"><th>${label}</th>${columns.map(([key]) => { const value=get(results[key]); return `<td class="${key==='original'?'original-cell ':''}${color(value)}">${format(value)}</td>`; }).join('')}</tr>`).join('')}</tbody></table>`;
}
function renderOverview() {
  $('scenario-summaries').innerHTML = ['a','b'].map((key) => { const r=results[key]; return `<article class="scenario-summary"><div class="scenario-label"><span class="scenario-badge ${key}">${key.toUpperCase()}</span>${key==='a'?'共同假設':'差異方案'}<span class="scenario-tag">5 年退出</span></div><div class="scenario-topline"><div><div class="headline-value ${color(r.leveraged_after_tax.irr)}">${pct(r.leveraged_after_tax.irr)}</div><div class="headline-caption">按揭 · 物業稅後年化 IRR</div></div><div><div>${money(r.leveraged_after_tax.total_profit)}</div><div class="headline-caption">持有期總盈虧</div></div></div><p class="summary-meta">樓價 <strong>${money(r.inputs.purchase_price)}</strong> · 月租 <strong>${money(r.inputs.monthly_rent)}</strong><br>假設售價 <strong>${money(r.sale_price)}</strong> · 比較門檻 <strong>${pct(r.inputs.benchmark_rate)}</strong></p></article>`; }).join('');
  $('returns-table').innerHTML = compareTable(returnRows);
  $('funding-table').innerHTML = compareTable([
    ['買入時自有資金',(r)=>r.initial_equity],['全現金取得成本',(r)=>r.acquisition_cost],
    ['每月供款',(r)=>r.monthly_payment],['首年平均每月補貼',(r)=>r.first_year_monthly_subsidy],
    ['出售時貸款餘額',(r)=>r.loan_at_exit],['出售後淨收款',(r)=>r.leveraged_sale_proceeds],
  ]);
  const zero={}; for(const key of ['a','b','original']) zero[key]=calculate({...inputsFor(key),holding_years:5,benchmark_rate:0});
  $('targets-table').innerHTML = compareTable([
    ['比較年回報門檻',(r)=>r.inputs.benchmark_rate,pct],
    ['按揭：追平門檻所需售價',(r)=>r.required_sale_price_leveraged],
    ['全現金：追平門檻所需售價',(r)=>r.required_sale_price_cash],
    ['按揭：所需累計樓價升幅',(r)=>r.required_price_change_leveraged,pct],
    ['按揭：稅前回本售價',(r)=>zero[Object.keys(results).find((key)=>results[key]===r)].required_sale_price_leveraged],
    ['全現金：稅前回本售價',(r)=>zero[Object.keys(results).find((key)=>results[key]===r)].required_sale_price_cash],
  ]);
  const warnings=[];
  for(const key of ['a','b']) for(const [label,metric] of [['按揭稅前',results[key].leveraged_before_tax],['按揭稅後',results[key].leveraged_after_tax],['全現金稅前',results[key].cash_before_tax],['全現金稅後',results[key].cash_after_tax]]) {
    if(metric.irr===null) warnings.push(`${key.toUpperCase()} ${label}：現金流轉號 ${signChanges(metric.cashflows)} 次，IRR 不適用；請看 NPV。`);
  }
  $('irr-warnings').innerHTML=warnings.length?`<div class="notice warning">${warnings.map(escapeHtml).join('<br>')}</div>`:'';
  renderChart();
}

function renderChart() {
  const sale=$('chart-sale').checked;
  const rows=[...Array(5)].map((_,i)=>({year:i+1,a:results.a.annual[i][sale?'leveraged_after_tax_flow':'leveraged_after_tax'],b:results.b.annual[i][sale?'leveraged_after_tax_flow':'leveraged_after_tax']}));
  const values=rows.flatMap((r)=>[r.a,r.b]);
  const low=Math.min(0,...values),high=Math.max(0,...values),span=Math.max(1,high-low);
  const min=low-(low<0?span*.14:0),max=high+(high>0?span*.14:0),height=182,top=15,left=58,width=520;
  const y=(v)=>top+(max-v)/(max-min||1)*height;
  const ticks=[min,(min+max)/2,max];
  const grid=ticks.map((v)=>`<line x1="${left}" x2="${width}" y1="${y(v)}" y2="${y(v)}" stroke="#ddded9"/><text x="${left-8}" y="${y(v)+4}" text-anchor="end">${precise.format(v/10000)}</text>`).join('');
  const bars=rows.map((r,i)=>{const x=left+23+i*91;return ['a','b'].map((k,j)=>`<rect x="${x+j*25}" y="${Math.min(y(r[k]),y(0))}" width="20" height="${Math.max(1,Math.abs(y(r[k])-y(0)))}" fill="${k==='a'?'#2148b8':'#a0acc4'}"><title>第 ${r.year} 年，方案 ${k.toUpperCase()}：${money(r[k])}</title></rect>`).join('')+`<text x="${x+22}" y="221" text-anchor="middle">第 ${r.year} 年</text>`;}).join('');
  $('cashflow-chart').innerHTML=`<div class="chart-legend"><span>HKD 萬</span><span><i class="legend-swatch"></i>A</span><span><i class="legend-swatch b"></i>B</span></div><svg viewBox="0 0 540 240" role="img" aria-labelledby="chart-title chart-description"><title id="chart-title">方案 A 與 B 的每年按揭稅後現金</title><desc id="chart-description">${rows.map((r)=>`第${r.year}年 A ${money(r.a)}，B ${money(r.b)}`).join('；')}</desc>${grid}<line x1="${left}" x2="${width}" y1="${y(0)}" y2="${y(0)}" stroke="#9298a1"/>${bars}</svg>`;
}

const ANNUAL_ROWS=[
  ['收租與營運',null],['合約月租','monthly_rent'],['實收租金月數','rent_months','number'],['實收租金','rental_income'],
  ['成本明細（支出以正數顯示）',null],['管理費','management_fee'],['差餉','rates'],['地租','government_rent'],['保險','insurance'],['日常維修','maintenance'],['預計更新／大修支出（當年花掉）','major_repairs'],['招租佣金','letting_commission'],['額外工程（超出已計成本）','extra_works'],['租約印花稅','lease_stamp_duty'],['營運成本合計','operating_costs','total'],['普通個人物業稅','property_tax'],
  ['現金與融資',null],['稅前、供款前淨現金','operating_before_tax'],['稅後、供款前淨現金','operating_after_tax'],['期初貸款','loan_opening'],['全年供款','debt_service'],['其中利息','interest'],['其中還本金','principal'],['期末貸款','loan_closing'],['按揭供款後現金（稅前）','leveraged_before_tax','total'],['按揭供款後現金（稅後）','leveraged_after_tax','total'],
  ['年末出售',null],['出售價','sale_price'],['售樓成本（不含還貸）','selling_costs'],['清還費／退回回贈','loan_exit_fee'],['售樓淨回款（全現金）','cash_sale_proceeds'],['售樓淨回款（按揭）','leveraged_sale_proceeds'],
  ['IRR 採用的完整現金流',null],['全現金 · 稅前','cash_before_tax_flow','flow'],['全現金 · 物業稅後','cash_after_tax_flow','flow'],['按揭 · 稅前','leveraged_before_tax_flow','flow'],['按揭 · 物業稅後','leveraged_after_tax_flow','flow'],
];
function annualValue(r,row,key){ return key==='monthly_rent'?r.inputs.monthly_rent:row[key]; }
function initialValue(r,key){return key?.startsWith('cash_')&&key.endsWith('_flow')?-r.acquisition_cost:key?.startsWith('leveraged_')&&key.endsWith('_flow')?-r.initial_equity:null;}
function selectedAnnual(){return horizonResult(inputsFor($('annual-scenario').value),Number($('detail-horizon').value));}
function renderAnnual() {
  const r=selectedAnnual(),annual=r.annual.slice(0,r.inputs.holding_years);
  $('annual-table').innerHTML=`<table class="annual-table"><thead><tr><th>現金流項目 · HKD</th><th>第 0 年</th>${annual.map((row)=>`<th>第 ${row.year} 年</th>`).join('')}</tr></thead><tbody>${ANNUAL_ROWS.map(([label,key,type])=>!key?`<tr class="group-row"><th>${label}</th>${'<td></td>'.repeat(annual.length+1)}</tr>`:`<tr class="${type==='flow'?'cashflow-row':type==='total'?'total-row':''}"><th>${label}</th><td>${initialValue(r,key)===null?'—':money(initialValue(r,key))}</td>${annual.map((row)=>{const v=annualValue(r,row,key);return `<td class="${color(v)}">${type==='number'?precise.format(v):money(v)}</td>`;}).join('')}</tr>`).join('')}</tbody></table>`;
  $('exit-table').innerHTML=`<table><thead><tr><th>持有期</th><th>預計售價</th><th>按揭稅前 IRR</th><th>按揭稅後 IRR</th><th>全現金稅後 IRR</th><th>按揭稅前 NPV</th></tr></thead><tbody>${yearlyExits(inputsFor($('annual-scenario').value)).map((v)=>`<tr><th>${v.inputs.holding_years} 年</th><td>${money(v.sale_price)}</td><td>${pct(v.leveraged_before_tax.irr)}</td><td>${pct(v.leveraged_after_tax.irr)}</td><td>${pct(v.cash_after_tax.irr)}</td><td>${money(v.leveraged_before_tax.npv)}</td></tr>`).join('')}</tbody></table>`;
  const d=r.lease_duty;
  const feeRows=[['買入樓價',r.inputs.purchase_price],['印花稅計稅值',r.purchase_duty_base],['買入從價印花稅 AVD',r.purchase_stamp_duty],['買入代理佣金',r.inputs.purchase_price*r.inputs.buying_commission_rate],['買入律師及雜費',r.inputs.buying_legal_fees],['初始裝修',r.inputs.renovation_cost],['全包取得成本',r.acquisition_cost],['每份租約全期租金',d.total_rent],['租約稅基（向上整百）',d.rounded_tax_base],['正本租約印花稅',d.original_duty],['副本印花稅合計',d.copy_duty],['每份租約連副本',d.total_duty],['每份租約業主承擔',d.landlord_duty],['持有期租約稅（業主）',annual.reduce((s,v)=>s+v.lease_stamp_duty,0)]];
  $('fees-table').innerHTML=`<table><thead><tr><th>項目</th><th>HKD</th></tr></thead><tbody>${feeRows.map(([label,value])=>`<tr><th>${label}</th><td>${precise.format(value)}</td></tr>`).join('')}</tbody></table>`;
}

function renderSensitivity() {
  const base=clone(inputsFor($('sensitivity-scenario').value)),key=$('sensitivity-variable').value;
  let values=key==='sale_price_growth'?[-.05,-.03,-.01,0,.01,.03,.05]:key==='monthly_rent'?[.8,.9,1,1.1,1.2].map((m)=>Math.round(base.monthly_rent*m)):[-0.02,-0.01,0,.01,.02].map((d)=>Math.max(0,base.mortgage_rate+d));
  values=[...new Set([...values,base[key]])].sort((a,b)=>a-b);
  $('sensitivity-table').innerHTML=`<table><thead><tr><th>${key==='monthly_rent'?'每月租金':'年率'}</th><th>首年每月補貼</th><th>5 年售價</th><th>按揭稅後 IRR</th><th>全現金稅後 IRR</th><th>按揭稅前 NPV</th></tr></thead><tbody>${values.map((value)=>{const r=horizonResult({...base,[key]:value,sale_price_change:null});const selected=Math.abs(value-base[key])<1e-9;return `<tr class="${selected?'current-row':''}"><th>${key==='monthly_rent'?money(value):pct(value)}${selected?'<span class="current-marker">目前</span>':''}</th><td>${money(r.first_year_monthly_subsidy)}</td><td>${money(r.sale_price)}</td><td>${pct(r.leveraged_after_tax.irr)}</td><td>${pct(r.cash_after_tax.irr)}</td><td class="${color(r.leveraged_before_tax.npv)}">${money(r.leveraged_before_tax.npv)}</td></tr>`;}).join('')}</tbody></table>`;
}

function fieldPercent(spec){ return spec.unit==='%' || spec.unit==='％'; }
function displayInput(value,spec){return value===null||value===undefined?'':String(Number((value*(fieldPercent(spec)?100:1)).toFixed(8)));}
function inputRow(spec,index=null){
  const key=spec.key,id=index===null?key:`${key}-${index}`;
  const auto=(key==='rateable_value'&&state.base[key]===null)||(key==='lease_counts'&&state.base[key]===null)||(key==='letting_counts'&&state.base[key]===null);
  const raw=index===null?state.base[key]:state.base[key]?.[index];
  const baseValue=auto?(index===null?results.a.inputs[key]:results.a.inputs[key]?.[index]):raw;
  const override=index===null?state.overrides[key]:state.overrides[key]?.[index];
  const bValue=index===null?results.b.inputs[key]:results.b.inputs[key]?.[index];
  const attributes=`data-field="${key}"${index===null?'':` data-index="${index}"`}${fieldPercent(spec)?' data-percent="true"':''}`;
  const label=key==='annual_major_repairs'?'預計更新／大修支出（當年花掉）':spec.label;
  return `<tr><th><label for="a-${id}">${escapeHtml(label)}</label><span class="field-unit">${escapeHtml(spec.unit)}</span>${auto?'<span class="help">自動推算；取消上方自動選項可自行設定</span>':''}</th><td><input id="a-${id}" type="number" inputmode="decimal" step="any" ${attributes} data-side="a" aria-label="${escapeHtml(label)}，方案 A" value="${displayInput(baseValue,spec)}" ${auto?'disabled':''}></td><td><input id="b-${id}" class="${override!==null&&override!==undefined?'override-filled':''}" type="number" inputmode="decimal" step="any" ${attributes} data-side="b" aria-label="${escapeHtml(label)}，B 差異；留白繼承 A" placeholder="跟 A" value="${displayInput(override,spec)}"></td><td><output id="effective-${id}" class="${override===null||override===undefined?'inherited':''}">${displayInput(bValue,spec)}</output></td></tr>`;
}
function renderInputs(){
  // Preserve open sections when a mobile quick input causes an immediate refresh.
  const open=new Set([...document.querySelectorAll('.input-group[open]')].map((el)=>el.dataset.group));
  if(!results.a) results={a:horizonResult(state.base),b:horizonResult(resolveB()),original:horizonResult(presetOriginal())};
  const groups=[...new Set(scalarSpecs.map((s)=>s.group))];
  const header='<thead><tr><th>輸入項目</th><th>A／共同假設</th><th>B 不同才填</th><th>B 採用值</th></tr></thead>';
  $('input-groups').innerHTML=groups.map((group,i)=>`<details class="input-group" data-group="${escapeHtml(group)}" ${open.has(group)||i===0?'open':''}><summary>${escapeHtml(group)}<span class="group-note">${scalarSpecs.filter((s)=>s.group===group).length} 項</span></summary><div class="table-scroll"><table class="input-table">${header}<tbody>${scalarSpecs.filter((s)=>s.group===group).map((s)=>inputRow(s)).join('')}</tbody></table></div></details>`).join('')+[['extra_works','各年額外工程','HKD'],['lease_counts','各年簽約份數','份'],['letting_counts','各年招租佣金次數','次']].map(([key,label,unit])=>`<details class="input-group" data-group="${key}" ${open.has(key)?'open':''}><summary>${label}<span class="group-note">10 年 · 只計選定持有期</span></summary><div class="table-scroll"><table class="input-table">${header}<tbody>${Array.from({length:10},(_,i)=>inputRow({key,label:`第 ${i+1} 年${label.slice(2)}`,unit},i)).join('')}</tbody></table></div></details>`).join('');
  $('input-errors').hidden=true;setDirty(false);
}
function setDirty(value){dirty=value;$('dirty-dot').hidden=!value;$('draft-status').textContent=value?'尚有未套用修改；結果仍使用先前數值':'所有輸入已套用';}
function updateDraftRow(input){
  setDirty(true);
  const id=input.id.slice(2),a=$(`a-${id}`),b=$(`b-${id}`),out=$(`effective-${id}`);
  out.textContent=b.value.trim()!==''?b.value:a.value;
  out.className=b.value.trim()!==''?'':'inherited';b.classList.toggle('override-filled',b.value.trim()!=='');
}
function submitInputs(event){
  event.preventDefault();
  const next=clone(state),overrideArrays={};
  next.overrides={};
  for(const input of $('assumptions-form').querySelectorAll('input[data-field]')){
    if(input.disabled) continue;
    const key=input.dataset.field,side=input.dataset.side,index=input.dataset.index;
    const text=input.value.trim(),value=text===''?null:Number(text)/(input.dataset.percent?100:1);
    if(side==='a'&&value===null&&key!=='reletting_interval_years'){$('input-errors').textContent='方案 A 輸入不可留白（招租佣金間隔可留白跟租約）。';$('input-errors').hidden=false;input.focus();return;}
    if(index!==undefined){
      if(side==='a'){if(!Array.isArray(next.base[key]))next.base[key]=Array(10).fill(0);next.base[key][Number(index)]=value;}
      else{if(!overrideArrays[key])overrideArrays[key]=Array(10).fill(null);overrideArrays[key][Number(index)]=value;}
    }else if(side==='a')next.base[key]=value;else if(value!==null)next.overrides[key]=value;
  }
  for(const [key,values] of Object.entries(overrideArrays))if(values.some((v)=>v!==null))next.overrides[key]=values;
  if($('auto-rv').checked)next.base.rateable_value=null;
  if($('auto-leases').checked){next.base.lease_counts=null;next.base.letting_counts=null;}
  next.base.sale_price_change=null;
  try{applyState(next,'詳細假設已套用，所有結果已更新。');}
  catch(error){$('input-errors').textContent=error.message;$('input-errors').hidden=false;}
}

function renderAll(){
  try{
    results={a:horizonResult(state.base),b:horizonResult(resolveB()),original:horizonResult(presetOriginal())};
    renderQuick();renderOverview();renderAnnual();renderSensitivity();$('fatal-error').hidden=true;
  }catch(error){$('fatal-error').textContent=`未能計算：${error.message}`;$('fatal-error').hidden=false;console.error(error);}
}
function selectTab(name){
  document.querySelectorAll('[role=tab]').forEach((tab)=>{const active=tab.dataset.tab===name;tab.setAttribute('aria-selected',String(active));tab.tabIndex=active?0:-1;$(tab.getAttribute('aria-controls')).hidden=!active;});
}
function download(name,text,type){const url=URL.createObjectURL(new Blob([text],{type}));const link=document.createElement('a');link.href=url;link.download=name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function exportCsv(){
  const r=selectedAnnual(),annual=r.annual.slice(0,r.inputs.holding_years);
  const quote=(v)=>`"${String(v??'').replace(/"/g,'""')}"`;
  const rows=[['方案', $('annual-scenario').value.toUpperCase()],['金額單位','HKD'],['持有年數',r.inputs.holding_years],['項目','第0年',...annual.map((v)=>`第${v.year}年`)],...ANNUAL_ROWS.filter(([,key])=>key).map(([label,key])=>[label,initialValue(r,key),...annual.map((row)=>annualValue(r,row,key))])];
  download(`property-cashflow-${$('annual-scenario').value}-${r.inputs.holding_years}y.csv`,'\uFEFF'+rows.map((row)=>row.map(quote).join(',')).join('\r\n'),'text/csv;charset=utf-8');
}

// Native controls remain keyboard accessible. Tabs implement the standard
// arrow-key behavior instead of requiring a mouse or touch screen.
document.querySelectorAll('[role=tab]').forEach((tab)=>{
  tab.addEventListener('click',()=>selectTab(tab.dataset.tab));
  tab.addEventListener('keydown',(event)=>{const tabs=[...document.querySelectorAll('[role=tab]')];let index=tabs.indexOf(tab);if(event.key==='ArrowRight')index=(index+1)%tabs.length;else if(event.key==='ArrowLeft')index=(index-1+tabs.length)%tabs.length;else if(event.key==='Home')index=0;else if(event.key==='End')index=tabs.length-1;else return;event.preventDefault();selectTab(tabs[index].dataset.tab);tabs[index].focus();});
});
document.querySelectorAll('[data-quick]').forEach((input)=>input.addEventListener('input',quickChange));
$('assumptions-form').addEventListener('input',(event)=>{if(event.target.matches('[data-field]'))updateDraftRow(event.target);});
$('assumptions-form').addEventListener('submit',submitInputs);
$('discard-draft').addEventListener('click',()=>{refreshQuickInputs();renderInputs();});
$('clear-overrides').addEventListener('click',()=>applyState({...state,overrides:{}},'B 現在全部跟隨 A。'));
$('restore-workbook').addEventListener('click',()=>applyState(defaultState(),'已恢復預設假設。已儲存的單位仍保留。'));
$('restore-original').addEventListener('click',()=>applyState(defaultState(true),'已載入 Excel 原例。已儲存的單位仍保留。'));
$('show-original').addEventListener('change',renderOverview);$('chart-sale').addEventListener('change',renderChart);
for(const id of ['annual-scenario','detail-horizon'])$(id).addEventListener('change',renderAnnual);
for(const id of ['sensitivity-scenario','sensitivity-variable'])$(id).addEventListener('change',renderSensitivity);
$('auto-rv').addEventListener('change',()=>{const input=$('a-rateable_value');input.disabled=$('auto-rv').checked;if(!input.value)input.value=results.a.inputs.rateable_value;setDirty(true);});
$('auto-leases').addEventListener('change',()=>{for(const key of ['lease_counts','letting_counts'])for(const input of document.querySelectorAll(`[data-side="a"][data-field="${key}"]`)){input.disabled=$('auto-leases').checked;if(!input.value)input.value=results.a.inputs[key][Number(input.dataset.index)];}setDirty(true);});
$('save-device').addEventListener('click',saveDevice);
$('load-device').addEventListener('click',()=>{const record=saved.find((r)=>r.id===$('saved-scenarios').value);if(!record){notify('請先選擇已保存單位。',true);return;}activeSavedId=record.id;applyState(record.snapshot,`已載入「${record.name}」。`);$('scenario-name').value=record.name;$('save-status').textContent=`已載入：${record.name}`;try{writeDeviceStore();}catch{/* Loading works even if the browser blocks persistence. */}});
$('delete-device').addEventListener('click',()=>{const id=$('saved-scenarios').value;const record=saved.find((r)=>r.id===id);if(!record)return;const previous=clone(saved);saved=saved.filter((r)=>r.id!==id);try{writeDeviceStore();renderSavedOptions();notify(`已刪除本機保存的「${record.name}」；目前畫面輸入保留。`);}catch{saved=previous;notify('瀏覽器未能刪除保存資料。',true);}});
$('export-json').addEventListener('click',()=>{if(dirty||!$('quick-errors').hidden){notify('請先完成上方有效輸入並套用詳細假設，再下載目前方案。',true);return;}download('property-cashflow-scenario.json',JSON.stringify(state,null,2),'application/json');});
$('export-csv').addEventListener('click',exportCsv);
$('import-button').addEventListener('click',()=>$('import-file').click());
$('import-file').addEventListener('change',async(event)=>{const file=event.target.files[0];if(!file)return;try{if(file.size>100*1024)throw new Error('方案檔案超過 100 KB。');const next=readSnapshot(JSON.parse(await file.text()));applyState(next,'方案已匯入；如需保留，請按儲存到這部裝置。');}catch(error){notify(`無法匯入：${error.message}`,true);}finally{event.target.value='';}});

loadDeviceStore();
refreshQuickInputs();
renderAll();
renderInputs();
renderSavedOptions();
