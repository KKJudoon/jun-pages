/* Annual financial report: shared pure model + accessible expandable matrix. */
(function (root) {
  'use strict';
  const METRICS = [
    ['income', '收入'], ['expenses', '经营支出'], ['operating_profit', '经营净利'],
    ['margin', '经营利润率'], ['adjustment', 'CK个人结算 / 利润后调整'], ['final_profit', '最终净利'],
  ];
  const CORE = ['income', 'expenses', 'operating_profit', 'adjustment', 'final_profit'];
  const number = value => value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
  const round = value => Math.round((value + Number.EPSILON) * 100) / 100;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money = new Intl.NumberFormat('zh-CN', {minimumFractionDigits:2, maximumFractionDigits:2});
  const monthKey = (year, month) => `${year}-${String(month).padStart(2,'0')}`;
  const empty = status => ({amount:null,status:status || 'missing'});
  function metricCell(month, key) { return month?.metrics?.[key] || empty(month?.error ? 'error' : 'missing'); }
  function categoryCell(month, key, childKey) {
    const category = month?.categories?.find(item => item.key === key);
    if (childKey !== undefined) return category?.children?.find(item => item.key === childKey) || empty('not_applicable');
    if (category) return category;
    // An absent historical category is not fabricated as a numeric zero.
    return empty('not_applicable');
  }
  function rowCell(month, row) { return row.category ? categoryCell(month,row.category,row.child) : metricCell(month,row.key); }
  function annualModel(payload, year, through) {
    const months = Array.from({length:12},(_,index) => payload.months.find(item => item.month === monthKey(year,index+1)) || null);
    const selected = months.slice(0,through);
    // Keep all headline totals on precisely the same month set. A month with a
    // missing cost cannot inflate annual income while being absent from profit.
    const included = selected.map((month,index) => ({month,index})).filter(({month}) => month && CORE.every(key => number(metricCell(month,key).amount) !== null));
    const coverage = included.map(({index}) => index+1);
    const common = {coverage, expected:through, partial:coverage.length !== through || included.some(({month}) => CORE.some(key=>metricCell(month,key).status !== 'complete'))};
    const sum = key => included.length ? round(included.reduce((total,{month})=>total+metricCell(month,key).amount,0)) : null;
    const totals = {};
    for (const [key] of METRICS) {
      const amount = key === 'margin' ? (sum('income') > 0 ? round(sum('operating_profit') / sum('income') * 100) : null) : sum(key);
      totals[key] = {...common,amount,status:amount === null?'missing':common.partial?'partial':'complete'};
    }
    const categories = new Map();
    for (const month of selected) for (const category of month?.categories || []) {
      if (!categories.has(category.key)) categories.set(category.key,{key:category.key,label:category.label,legacy:category.legacy,children:new Map()});
      const group = categories.get(category.key);
      for (const child of category.children || []) if (!group.children.has(child.key)) group.children.set(child.key,child);
    }
    const categoryTotal = (key,childKey) => {
      const cells = included.map(({month,index})=>({cell:categoryCell(month,key,childKey),month,index}));
      const numeric = cells.filter(item=>number(item.cell.amount)!==null);
      const unknown = cells.some(item=>number(item.cell.amount)===null && item.cell.status!=='not_applicable');
      const amount = numeric.length ? round(numeric.reduce((total,item)=>total+item.cell.amount,0)) : null;
      return {amount,status:amount===null?'not_applicable':common.partial||unknown||numeric.some(x=>x.cell.status!=='complete')?'partial':'complete',
        coverage:numeric.map(item=>item.index+1),expected:through};
    };
    const rows = METRICS.map(([key,label])=>({key,label,depth:0,total:totals[key],children:key==='expenses'?[...categories.values()].map(category=>({
      key:`category:${category.key}`,category:category.key,label:category.label,legacy:category.legacy,depth:1,total:categoryTotal(category.key),
      children:[...category.children.values()].map(child=>({key:`child:${category.key}:${child.key}`,category:category.key,child:child.key,
        label:child.label,note:child.note,depth:2,total:categoryTotal(category.key,child.key),children:[]})),
    })):[]}));
    return {year,through,months,coverage,totals,rows,included,missing:Array.from({length:through},(_,i)=>i+1).filter(m=>!coverage.includes(m))};
  }
  function comparison(current, previous, key) {
    if (!current || !previous || current.status!=='complete' || previous.status!=='complete' || number(current.amount)===null || number(previous.amount)===null
      || JSON.stringify(current.coverage)!==JSON.stringify(previous.coverage)) return null;
    const difference=round(current.amount-previous.amount);
    if(key==='margin')return {difference,unit:'pp',rate:null};
    return {difference,unit:'money',rate:previous.amount>0&&current.amount>=0?round(difference/previous.amount*100):null};
  }
  function visibleRows(rows, expanded, year) {
    const result=[];
    function visit(row){result.push(row);if(expanded.has(`${year}:${row.key}`))for(const child of row.children || [])visit(child);}
    rows.forEach(visit);return result;
  }
  function lineSegments(points) {
    const segments=[];let run=[];
    for(const point of points){if(point==null){if(run.length)segments.push(run);run=[];}else run.push(point);}
    if(run.length)segments.push(run);return segments;
  }
  // One numeric axis for all currency series, including losses and reversals.
  function chart(series, kind) {
    const width=960,height=290,left=70,right=24,top=24,bottom=42;
    const values=series.flatMap(item=>item.cells.map(cell=>number(cell?.amount))).filter(value=>value!==null);
    if(!values.length)return '<div class="annual-empty">所选范围暂无可绘制的数据</div>';
    const low=Math.min(0,...values),high=Math.max(0,...values),span=high-low||1;
    const min=low<0?low-span*.12:0,max=high+span*.12;
    const x=index=>left+(index+.5)*(width-left-right)/12;
    const y=value=>top+(max-value)/(max-min)*(height-top-bottom);
    const axis=Array.from({length:5},(_,i)=>{const value=min+(max-min)*i/4;return `<line x1="${left}" x2="${width-right}" y1="${y(value)}" y2="${y(value)}" class="annual-grid"/><text x="${left-10}" y="${y(value)+4}" text-anchor="end">${(value/10000).toFixed(1)}</text>`;}).join('');
    const months=Array.from({length:12},(_,i)=>`<text x="${x(i)}" y="${height-13}" text-anchor="middle">${i+1}月</text>`).join('');
    const plots=series.map((item,si)=>{
      const points=item.cells.map((cell,i)=>number(cell?.amount)===null?null:{x:x(i),y:y(cell.amount),cell,index:i});
      const title=p=>`${item.label} · ${p.index+1}月：¥${money.format(p.cell.amount)}${p.cell.status==='partial'?'（暂计）':''}`;
      if(kind==='combo'&&si<2)return points.filter(Boolean).map(p=>`<rect x="${p.x+(si===0?-22:1)}" y="${Math.min(y(0),p.y)}" width="20" height="${Math.max(1,Math.abs(y(0)-p.y))}" rx="2" fill="${item.color}" opacity="${p.cell.status==='partial'?'.42':'.8'}"><title>${esc(title(p))}</title></rect>`).join('');
      return lineSegments(points).map(run=>run.slice(1).map((p,i)=>`<line x1="${run[i].x}" y1="${run[i].y}" x2="${p.x}" y2="${p.y}" stroke="${item.color}" stroke-width="2.5" ${p.cell.status==='partial'||run[i].cell.status==='partial'?'stroke-dasharray="5 5"':''}/>`).join('')).join('')+points.filter(Boolean).map(p=>`<circle cx="${p.x}" cy="${p.y}" r="4" fill="${p.cell.status==='partial'?'#fff':item.color}" stroke="${item.color}" stroke-width="2"><title>${esc(title(p))}</title></circle>`).join('');
    }).join('');
    return `<div class="annual-chart-scroll"><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${kind==='combo'?'月度收入、支出和经营净利':'各年同月趋势'}，单位万元，缺失月份断开"><text x="12" y="18">万元</text>${axis}<line x1="${left}" x2="${width-right}" y1="${y(0)}" y2="${y(0)}" stroke="#94a3b8"/>${months}${plots}</svg></div><div class="annual-legend">${series.map(item=>`<span><i style="background:${item.color}"></i>${esc(item.label)}</span>`).join('')}<small>空心点 / 浅色柱为暂计；缺数不连线</small></div>`;
  }
  const API={METRICS,annualModel,comparison,visibleRows,lineSegments,chart,rowCell};
  root.JUN_ANNUAL=API;
  if(typeof module!=='undefined')module.exports=API;
  if(typeof document==='undefined'||document.body.dataset.junPage!=='finance-annual')return;

  const content=document.getElementById('module-content'),toolbar=document.getElementById('module-toolbar');
  const query=new URLSearchParams(location.search);
  const state={payload:null,year:0,through:0,years:[],basis:query.get('income_basis')==='billing'?'billing':'orders',
    from:0,to:0,metric:['income','expenses','operating_profit','margin','adjustment','final_profit'].includes(query.get('metric'))?query.get('metric'):'all',
    chartMetric:'income',expanded:new Set(),closedYears:new Set(),request:0};
  const finiteYear=value=>/^20\d{2}$/.test(value||'')?Number(value):null;
  async function api(path){const response=await fetch(path);const body=await response.json().catch(()=>({}));if(!response.ok)throw new Error(body.detail||'年报暂时无法读取，请重试');return body;}
  function saveUrl(){const url=new URL(location.href);for(const [key,value] of Object.entries({year:state.year,from_year:state.from,to_year:state.to,through:state.through,income_basis:state.basis,metric:state.metric}))url.searchParams.set(key,value);history.replaceState({},'',url);}
  function options(values,current,label){return values.map(value=>`<option value="${value}" ${value===current?'selected':''}>${label?label(value):value}</option>`).join('');}
  function controls(){
    toolbar.innerHTML=`<label>重点年份<select id="annual-year" class="form-select">${options(state.years,state.year,y=>y+'年')}</select></label><label>对比范围<select id="annual-range" class="form-select"><option value="1" ${state.from===state.year?'selected':''}>仅所选年</option><option value="3" ${state.from!==state.year?'selected':''}>近三年</option></select></label><label>累计截至<select id="annual-through" class="form-select">${options(Array.from({length:12},(_,i)=>i+1),state.through,m=>m+'月')}</select></label><label>收入来源<select id="annual-basis" class="form-select"><option value="orders" ${state.basis==='orders'?'selected':''}>订单收入</option><option value="billing" ${state.basis==='billing'?'selected':''}>账房收入</option></select></label><button type="button" class="btn btn-outline-secondary" id="annual-refresh">刷新数据</button>`;
    toolbar.querySelector('#annual-year').onchange=async event=>{state.year=Number(event.target.value);state.to=state.year;state.from=state.year;const current=state.payload?.current_month;state.through=String(state.year)===current?.slice(0,4)?Math.max(1,Number(current.slice(5))-1):12;state.closedYears=new Set();saveUrl();await load();};
    toolbar.querySelector('#annual-range').onchange=async event=>{state.from=state.year-Number(event.target.value)+1;state.to=state.year;saveUrl();await load();};
    toolbar.querySelector('#annual-through').onchange=event=>{state.through=Number(event.target.value);saveUrl();render();};
    toolbar.querySelector('#annual-basis').onchange=async event=>{state.basis=event.target.value;saveUrl();await load();};
    toolbar.querySelector('#annual-refresh').onclick=load;
  }
  function cellMarkup(cell,key,link,excluded){
    if(number(cell?.amount)===null){const label=cell?.status==='not_applicable'?'—':cell?.status==='future'?'未到':cell?.status==='error'?'读取失败':'待补';return `<span class="annual-missing" title="${label==='—'?'当月无此分类或子项':label}">${label}</span>`;}
    const text=key==='margin'?cell.amount.toFixed(2)+'%':money.format(cell.amount);
    const title=[cell.note,cell.status==='partial'?'暂计，数据尚未完整':null,excluded?'未纳入所选累计范围':null].filter(Boolean).join('；');
    const body=`${text}${cell.status==='partial'?'<sup aria-label="暂计">*</sup>':''}`;
    return link?`<a class="annual-amount ${cell.amount<0?'annual-negative':''}" href="${esc(link)}" title="${esc(title||'查看对应月报')}">${body}</a>`:`<span class="${cell.amount<0?'annual-negative':''}" title="${esc(title)}">${body}</span>`;
  }
  function deltaMarkup(current,previous,key){const c=comparison(current,previous,key);if(!c)return '<span class="annual-missing">—</span>';return `<span class="annual-delta">${c.difference>0?'+':''}${money.format(c.difference)}${c.unit==='pp'?' pp':''}${c.rate!==null?`<small>${c.rate>0?'+':''}${c.rate.toFixed(1)}%</small>`:''}</span>`;}
  function matrix(models){
    const thead=`<thead><tr><th class="annual-year-col">年份</th><th class="annual-label-col">指标 / 费用分类</th>${Array.from({length:12},(_,i)=>`<th ${i>=state.through?'class="annual-excluded"':''}>${i+1}月</th>`).join('')}<th class="annual-total">截至${state.through}月累计</th><th>同比增减</th></tr></thead>`;
    const body=models.map(model=>{
      const previous=models.find(item=>item.year===model.year-1);
      const closed=state.closedYears.has(model.year);
      const heading=`<tr class="annual-year-heading"><th colspan="2"><button type="button" data-year="${model.year}" aria-expanded="${!closed}"><span aria-hidden="true">${closed?'▸':'▾'}</span> ${model.year} 年</button></th><td colspan="14">${model.coverage.length?`累计纳入 ${model.coverage.join('、')} 月`:'暂无可核算月份'}${model.missing.length?` · ${model.missing.join('、')} 月未纳入`:' · 所选月份已齐'}</td></tr>`;
      if(closed)return heading;
      const selected=state.metric==='all'?model.rows:model.rows.filter(row=>row.key===state.metric);
      return heading+visibleRows(selected,state.expanded,model.year).map(row=>{
        const id=`${model.year}:${row.key}`,expand=row.children?.length>0,open=state.expanded.has(id);
        const label=expand?`<button type="button" class="annual-toggle" data-toggle="${esc(id)}" aria-expanded="${open}"><span aria-hidden="true">${open?'▾':'▸'}</span>${esc(row.label)}<small>${row.children.length}</small></button>`:`<span class="annual-leaf">${esc(row.label)}</span>`;
        return `<tr class="annual-depth-${row.depth} ${['operating_profit','final_profit'].includes(row.key)?'annual-profit-row':''}" data-row="${esc(id)}"><th class="annual-year-col" scope="row">${row.depth===0?model.year:''}</th><th class="annual-label-col" title="${esc(row.note||row.label)}">${label}${row.legacy?'<small class="annual-legacy">历史分类</small>':''}</th>${model.months.map((month,i)=>{
          const future=monthKey(model.year,i+1)>state.payload.current_month;
          const cell=future?empty('future'):rowCell(month,row);
          return `<td class="${i>=state.through?'annual-excluded':''}">${cellMarkup(cell,row.key,month?.source_url,i>=state.through)}</td>`;
        }).join('')}<td class="annual-total">${cellMarkup(row.total,row.key)}${row.total.amount!==null?`<small>${row.total.coverage.length}/${state.through} 月</small>`:''}</td><td>${row.depth===0?deltaMarkup(row.total,previous?.totals[row.key],row.key):'—'}</td></tr>`;
      }).join('');
    }).join('');
    return `<div class="annual-table-scroll" tabindex="0" role="region" aria-label="年度财务明细，可横向滚动"><table class="annual-table">${thead}<tbody>${body}</tbody></table>`;
  }
  function charts(models,focus){
    const colors=['#4263eb','#e89a4b','#169b82'];
    const cells=(model,key)=>model.months.map((month,i)=>i<state.through?metricCell(month,key):null);
    const combo=chart([['income','收入'],['expenses','经营支出'],['operating_profit','经营净利']].map(([key,label],i)=>({label,color:colors[i],cells:cells(focus,key)})),'combo');
    const years=models.filter(model=>model.months.some((month,i)=>i<state.through&&number(metricCell(month,state.chartMetric).amount)!==null)).slice(0,3);
    const comparisonChart=years.length>=2?chart(years.map((model,i)=>({label:model.year+'年',color:colors[i],cells:cells(model,state.chartMetric)})),'line'):'<div class="annual-empty">需要至少两个年份的同口径月报，才能比较历年同月走势。<small>历史销售参考表不并入财务数据。</small></div>';
    const categories=focus.rows.find(row=>row.key==='expenses').children.filter(row=>number(row.total.amount)!==null).sort((a,b)=>Math.abs(b.total.amount)-Math.abs(a.total.amount));
    const max=Math.max(1,...categories.map(row=>Math.abs(row.total.amount)));
    const reconciled=focus.included.length>0&&focus.included.every(({month})=>month.category_reconciled);
    const bars=categories.map(row=>`<button type="button" class="annual-cost-bar" data-category="${esc(row.key)}"><span>${esc(row.label)}</span><span class="annual-bar-track"><i style="width:${Math.abs(row.total.amount)/max*100}%;background:${row.total.amount<0?'#169b82':'#7086bd'}"></i></span><strong>${cellMarkup(row.total,'expenses')}${reconciled&&focus.totals.expenses.amount>0?`<small>${(row.total.amount/focus.totals.expenses.amount*100).toFixed(1)}%</small>`:''}</strong></button>`).join('');
    return `<section class="annual-chart-card"><div class="annual-card-head"><div><h2>${focus.year} 月度收支与利润</h2><p>金额与上表一致；累计范围外的月份不绘制。</p></div></div>${combo}</section><div class="annual-chart-grid"><section class="annual-chart-card"><div class="annual-card-head"><div><h2>历年同月趋势</h2><p>在顶部选择“近三年”查看。</p></div><select id="annual-chart-metric" class="form-select" aria-label="趋势指标">${['income','expenses','operating_profit'].map(key=>`<option value="${key}" ${key===state.chartMetric?'selected':''}>${METRICS.find(item=>item[0]===key)[1]}</option>`).join('')}</select></div>${comparisonChart}</section><section class="annual-chart-card"><div class="annual-card-head"><div><h2>${focus.year} 支出结构</h2><p>点击分类，展开上方明细。${reconciled?'':'部分历史分类待核对，占比暂不展示。'}</p></div></div>${bars||'<div class="annual-empty">暂无可汇总的支出</div>'}</section></div>`;
  }
  function render(){
    controls();const payload=state.payload;
    if(!payload)return;
    const models=Array.from({length:state.to-state.from+1},(_,i)=>annualModel(payload,state.to-i,state.through));
    const focus=models.find(model=>model.year===state.year)||models[0];
    const allWarnings=focus.months.slice(0,state.through).flatMap(month=>(month?.warnings||[]).map(w=>`${month.month}：${w}${w.includes('分类合计')&&month.category_difference!==null?'（差额 ¥'+money.format(month.category_difference)+'）':''}`));
    const cards=['income','expenses','operating_profit','margin'].map(key=>`<article class="annual-summary-card ${key==='operating_profit'?'annual-summary-profit':''}"><span>${METRICS.find(item=>item[0]===key)[1]}</span><strong>${cellMarkup(focus.totals[key],key)}</strong><small>${focus.coverage.length}/${state.through} 个月纳入累计${focus.totals[key].status==='partial'?' · 暂计':''}</small></article>`).join('');
    const captured=payload.collection?.sources?.find(item=>item.id==='qianniu-orders');
    const collectionWarning=state.basis==='orders'&&(payload.collection?.stale||(captured&&(captured.status!=='ok'||captured.publication_status==='error')))?' 订单采集状态待恢复，金额以已采集数据为准。':'';
    content.innerHTML=`<div class="annual-page"><header class="annual-title"><div><span class="annual-eyebrow">年度经营概览</span><h1>${state.year} 财务年报</h1><p>每月的收支，一年的经营变化。</p></div><span class="annual-basis">${state.basis==='orders'?'订单收入':'账房收入'} · 截至${state.through}月</span></header><div class="annual-summary">${cards}</div><div class="annual-coverage" role="status"><strong>${focus.missing.length?'部分月份尚未纳入累计':'所选月份已纳入累计'}</strong><span>${focus.coverage.length?'累计使用 '+focus.coverage.join('、')+' 月相同范围的收入、支出和利润。':'尚无收支及结算金额齐备的月份。'}${focus.missing.length?' '+focus.missing.join('、')+' 月缺报或金额待补；已有单项金额仍在表内显示。':''} 星号 * 为暂计；“—”为无对应项目，0 为实际零值。${esc(collectionWarning)}</span></div><section class="annual-matrix-card"><div class="annual-card-head"><div><h2>年度财务明细</h2><p>点击箭头展开年份、支出和子项；点击金额查看月报。单位：元</p></div><div class="annual-table-actions"><select id="annual-view" class="form-select" aria-label="表格指标"><option value="all">全部指标</option>${METRICS.map(([key,label])=>`<option value="${key}" ${state.metric===key?'selected':''}>只看${label}</option>`).join('')}</select><button type="button" class="btn btn-sm btn-outline-secondary" data-expand="all">展开全部</button><button type="button" class="btn btn-sm btn-outline-secondary" data-expand="none">收起明细</button></div></div>${matrix(models)}</section>${charts(models,focus)}<details class="annual-method"><summary>口径、数据状态与更新时间${allWarnings.length?' · '+allWarnings.length+' 项提示':''}</summary><p>经营净利 = 收入 − 经营支出；最终净利 = 经营净利 + 有符号的个人结算 / 利润后调整。利润率按累计经营净利 ÷ 同期累计收入计算。</p><p>${state.basis==='orders'?'订单收入按付款月及当前交易成功状态，账房退款未再次扣除。':'账房收入取当月净入账金额。'}面料沿用月报估值；本页利润不代表现金余额。历史分类保留原名，个人扣款参考行不重复计成本。</p><p>同比仅在两年相同月份范围完整且口径一致时显示；利润率变化用百分点。历史快照、未关账与进行中月份的状态见对应月报。</p>${allWarnings.length?`<ul>${allWarnings.map(w=>`<li>${esc(w)}</li>`).join('')}</ul>`:''}<p>汇总读取：${esc(new Date(payload.generated_at).toLocaleString('zh-CN',{hour12:false}))}；该时间不代表订单采集成功时间。${captured?'订单来源最后成功：'+esc(captured.last_success_at||'未知'):''}</p></details></div>`;
    content.querySelectorAll('[data-year]').forEach(button=>button.onclick=()=>{const year=Number(button.dataset.year);state.closedYears.has(year)?state.closedYears.delete(year):state.closedYears.add(year);renderKeepingScroll();});
    content.querySelectorAll('[data-toggle]').forEach(button=>button.onclick=()=>{const key=button.dataset.toggle;state.expanded.has(key)?state.expanded.delete(key):state.expanded.add(key);renderKeepingScroll(key);});
    content.querySelectorAll('[data-expand]').forEach(button=>button.onclick=()=>{state.expanded.clear();state.closedYears.clear();if(button.dataset.expand==='all')for(const model of models)for(const row of model.rows){state.expanded.add(`${model.year}:${row.key}`);for(const child of row.children)state.expanded.add(`${model.year}:${child.key}`);}renderKeepingScroll();});
    content.querySelector('#annual-view').onchange=event=>{state.metric=event.target.value;saveUrl();renderKeepingScroll();};
    content.querySelector('#annual-chart-metric').onchange=event=>{state.chartMetric=event.target.value;renderKeepingScroll();};
    content.querySelectorAll('[data-category]').forEach(button=>button.onclick=()=>{state.metric='all';state.closedYears.delete(state.year);state.expanded.add(`${state.year}:expenses`);state.expanded.add(`${state.year}:${button.dataset.category}`);render();content.querySelector(`[data-row="${CSS.escape(state.year+':'+button.dataset.category)}"]`)?.scrollIntoView({block:'center',behavior:'smooth'});});
  }
  function renderKeepingScroll(focus){const table=content.querySelector('.annual-table-scroll'),left=table?.scrollLeft||0,top=table?.scrollTop||0;render();const next=content.querySelector('.annual-table-scroll');next.scrollLeft=left;next.scrollTop=top;if(focus)content.querySelector(`[data-toggle="${CSS.escape(focus)}"]`)?.focus({preventScroll:true});}
  async function load(){
    const id=++state.request;controls();content.innerHTML='<div class="annual-loading" role="status"><span class="spinner-border spinner-border-sm"></span> 正在汇总月报…</div>';
    try{const payload=await api(`/api/finance/annual?${new URLSearchParams({from_year:state.from,to_year:state.to,income_basis:state.basis})}`);if(id!==state.request)return;state.payload=payload;saveUrl();render();}
    catch(error){if(id!==state.request)return;content.innerHTML=`<div class="finance-error" role="alert">${esc(error.message)} <button class="btn btn-sm btn-outline-secondary" id="annual-retry">重新读取</button></div>`;content.querySelector('#annual-retry').onclick=load;}
  }
  async function start(){
    await root.JUN_AUTH_READY;
    const payload=await api('/api/finance/months');state.years=[...new Set((payload.months||[]).map(item=>Number(item.month.slice(0,4))))].sort((a,b)=>b-a);
    if(!state.years.length){content.innerHTML='<div class="annual-empty">还没有可汇总的月报。请先完成月报数据接入。</div>';return;}
    const now=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit'}).formatToParts(new Date());
    const currentYear=Number(now.find(item=>item.type==='year').value),currentMonth=Number(now.find(item=>item.type==='month').value);
    const requested=finiteYear(query.get('year'));state.year=state.years.includes(requested)?requested:state.years.includes(currentYear)?currentYear:state.years[0];
    state.from=finiteYear(query.get('from_year'))||state.year;state.to=state.year;if(state.from>state.to||state.to-state.from>4)state.from=state.to;
    const through=Number(query.get('through'));state.through=through>=1&&through<=12&&Number.isInteger(through)?through:state.year===currentYear?Math.max(1,currentMonth-1):12;
    state.closedYears=new Set(Array.from({length:state.to-state.from},(_,i)=>state.to-i-1));
    await load();
  }
  start().catch(error=>{content.innerHTML=`<div class="finance-error" role="alert">${esc(error.message)}</div>`;});
})(typeof window==='undefined'?globalThis:window);
