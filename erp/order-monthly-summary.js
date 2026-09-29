(function () {
  'use strict';
  const host=document.getElementById('order-monthly-summary');
  if(!host)return;
  const monthFormat=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit'});
  const parts=monthFormat.formatToParts(new Date());
  const currentMonth=`${parts.find(p=>p.type==='year').value}-${parts.find(p=>p.type==='month').value}`;
  const money=new Intl.NumberFormat('zh-CN',{style:'currency',currency:'CNY'});
  const input=host.querySelector('#order-summary-month');
  const content=host.querySelector('#order-monthly-content');
  let requestId=0;
  let loaded=false;
  function validMonth(value){return /^20\d{2}-(0[1-9]|1[0-2])$/.test(value);}
  function card(title,value){
    const missing=Number(value?.missing_amount_count||0);
    return `<div class="order-monthly-card"><span>${title}</span><strong>${money.format(Number(value?.amount||0))}</strong><small>${Number(value?.count||0)} 单${missing?` · ${missing} 单金额待补，以上为已知金额`:''}</small></div>`;
  }
  async function load(month){
    loaded=true;
    const id=++requestId;
    content.innerHTML=`<p class="text-secondary mb-0">正在读取 ${month} 的订单汇总…</p>`;
    try{
      await window.JUN_AUTH_READY;
      const response=await fetch(`/api/erp/order-monthly-summary?month=${encodeURIComponent(month)}`,{signal:AbortSignal.timeout(15000)});
      if(!response.ok)throw new Error(`HTTP ${response.status}`);
      const data=await response.json();
      if(id!==requestId)return;
      if(data.month!==month||!data.completed_paid||!data.unfinished_paid||!data.placed_total)throw new Error('汇总数据不完整');
      content.innerHTML=`<div class="order-monthly-grid">${card('已完成订单收入',data.completed_paid)}${card('未完成订单收入',data.unfinished_paid)}${card('总订单金额',data.placed_total)}</div><p class="order-monthly-note">收入按付款月订单实付及当前状态统计；未完成排除退款、退货。总订单金额按下单月统计退款前应付金额，包含所有状态。金额是订单口径，不等于账房当月入账。</p>`;
    }catch(error){
      if(id!==requestId)return;
      content.innerHTML='<p class="text-danger mb-2">月度汇总暂不可用，订单列表仍可使用。</p><button type="button" class="btn btn-sm btn-outline-primary">重试</button>';
      content.querySelector('button').addEventListener('click',()=>load(month));
    }
  }
  input.value=currentMonth;
  input.addEventListener('change',event=>{
    const next=event.target.value;
    if(validMonth(next))load(next);
  });
  host.addEventListener('toggle',()=>{
    if(host.open&&!loaded)load(input.value);
  });
})();
