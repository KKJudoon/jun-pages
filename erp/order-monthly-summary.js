(function () {
  'use strict';
  const host=document.getElementById('order-monthly-summary');
  if(!host)return;
  const monthFormat=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit'});
  const parts=monthFormat.formatToParts(new Date());
  const currentMonth=`${parts.find(p=>p.type==='year').value}-${parts.find(p=>p.type==='month').value}`;
  const money=new Intl.NumberFormat('zh-CN',{style:'currency',currency:'CNY'});
  const percent=new Intl.NumberFormat('zh-CN',{style:'percent',minimumFractionDigits:1,maximumFractionDigits:1});
  const input=host.querySelector('#order-summary-month');
  const content=host.querySelector('#order-monthly-content');
  let requestId=0;
  let loaded=false;
  function validMonth(value){return /^20\d{2}-(0[1-9]|1[0-2])$/.test(value);}
  function shiftedMonth(month,offset){
    const [year,number]=month.split('-').map(Number);
    const date=new Date(Date.UTC(year,number-1+offset,1));
    const shifted=`${date.getUTCFullYear()}-${String(date.getUTCMonth()+1).padStart(2,'0')}`;
    return validMonth(shifted)?shifted:null;
  }
  function comparison(label,month,current,result,key){
    if(!month)return `<div class="order-monthly-comparison">${label}：无可比月份</div>`;
    if(result.status!=='fulfilled'||!result.value)return `<div class="order-monthly-comparison">${label} ${month}：暂不可用</div>`;
    const previous=result.value[key];
    if(!previous)return `<div class="order-monthly-comparison">${label} ${month}：暂不可用</div>`;
    const base=Math.round(Number(previous.amount)*100);
    const now=Math.round(Number(current.amount)*100);
    if(!Number.isFinite(base)||!Number.isFinite(now))return `<div class="order-monthly-comparison">${label} ${month}：金额待补</div>`;
    const baseline=`${label} ${month}：${money.format(base/100)}`;
    if(Number(current.missing_amount_count||0)||Number(previous.missing_amount_count||0))
      return `<div class="order-monthly-comparison">${baseline}<small>金额待补，变化暂不可比</small></div>`;
    const difference=(now-base)/100;
    const delta=`${difference>0?'+':''}${money.format(difference)}`;
    const change=base===0?'比例—':`${difference>0?'+':''}${percent.format((now-base)/base)}`;
    return `<div class="order-monthly-comparison">${baseline}<small>差额 ${delta}（${change}）</small></div>`;
  }
  function card(title,value,key,previousMonth,previous,yearMonth,lastYear){
    const missing=Number(value?.missing_amount_count||0);
    return `<div class="order-monthly-card"><span>${title}</span><strong>${money.format(Number(value?.amount||0))}</strong><small>${Number(value?.count||0)} 单${missing?` · ${missing} 单金额待补，以上为已知金额`:''}</small><div class="order-monthly-comparisons">${comparison('环比',previousMonth,value,previous,key)}${comparison('同比',yearMonth,value,lastYear,key)}</div></div>`;
  }
  async function fetchSummary(month){
    const response=await fetch(`/api/erp/order-monthly-summary?month=${encodeURIComponent(month)}`,{signal:AbortSignal.timeout(15000)});
    if(!response.ok)throw new Error(`HTTP ${response.status}`);
    const data=await response.json();
    if(data.month!==month||!data.completed_paid||!data.unfinished_paid||!data.placed_total)throw new Error('汇总数据不完整');
    return data;
  }
  async function load(month){
    loaded=true;
    const id=++requestId;
    content.innerHTML=`<p class="text-secondary mb-0">正在读取 ${month} 的订单汇总…</p>`;
    try{
      await window.JUN_AUTH_READY;
      const previousMonth=shiftedMonth(month,-1);
      const yearMonth=shiftedMonth(month,-12);
      const [current,previous,lastYear]=await Promise.allSettled([
        fetchSummary(month),previousMonth?fetchSummary(previousMonth):Promise.resolve(null),yearMonth?fetchSummary(yearMonth):Promise.resolve(null)
      ]);
      if(id!==requestId)return;
      if(current.status!=='fulfilled')throw current.reason;
      const data=current.value;
      const note=month===currentMonth?'本月尚未结束时，当前累计额与对方整月比较。':'';
      content.innerHTML=`<div class="order-monthly-grid">${card('已完成订单收入',data.completed_paid,'completed_paid',previousMonth,previous,yearMonth,lastYear)}${card('未完成订单收入',data.unfinished_paid,'unfinished_paid',previousMonth,previous,yearMonth,lastYear)}${card('总订单金额',data.placed_total,'placed_total',previousMonth,previous,yearMonth,lastYear)}</div><p class="order-monthly-note">环比对比上月，同比对比去年同月；显示对比月金额、差额和变化比例。${note}收入按付款月订单实付及当前状态统计，账房退款未从本卡金额扣除；未完成排除已识别退款、退货。总订单金额按下单月统计退款前应付金额，包含所有状态。金额是订单口径，不等于账房当月入账。</p>`;
    }catch(error){
      if(id!==requestId)return;
      content.innerHTML='<p class="text-danger mb-2">月度汇总暂不可用，订单列表仍可使用。</p><button type="button" class="btn btn-sm btn-outline-primary">重试</button>';
      content.querySelector('button').addEventListener('click',()=>load(month));
    }
  }
  const linkedMonth=new URLSearchParams(location.search).get('month');
  input.value=validMonth(linkedMonth)?linkedMonth:currentMonth;
  input.addEventListener('change',event=>{
    const next=event.target.value;
    if(validMonth(next))load(next);
  });
  host.addEventListener('toggle',()=>{
    if(host.open&&!loaded)load(input.value);
  });
  if(validMonth(linkedMonth)){
    host.open=true;
    load(input.value);
  }
})();
