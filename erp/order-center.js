(function () {
  'use strict';
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const amount=v=>v===null||v===undefined||v===''?'—':new Intl.NumberFormat('zh-CN',{style:'currency',currency:'CNY'}).format(Number(v));
  const stamp=v=>v?esc(String(v).replace('T',' ').slice(0,19)):'—';
  const names={erp:'管家婆','erp.raw':'管家婆完整采集','qianniu.export':'千牛历史','qianniu.incremental':'千牛增量','qianniu.refund':'退款管理','finance.taobao_income_order':'账房货款','finance.taobao_platform_charge':'账房费用',manual:'手动订单'};
  const labels={raw_json:'原始采集字段',source:'来源',month:'账期',groups:'待办分类',coverage:'覆盖说明',fetched_at:'采集时间',trade_created_at:'平台下单时间',service_fee:'服务费',has_merge:'合单标记',has_split:'拆单标记',order_total:'订单总额',trade_total:'交易总额',settle_total:'结算额',report_total:'报表金额',pay_no:'支付单号',order_id:'订单号',status:'状态',paid_at:'付款时间',created_at:'下单时间',completed_at:'确认收货时间',shipped_at:'发货时间',source_observed_at:'采集时间',observed_at:'采集时间',detail_observed_at:'详情采集时间',refund_amount:'导出退款金额',buyer_paid_amount:'导出实付金额',merchant_received_amount:'确认收货打款金额',buyer_due_goods:'应付货款',buyer_due_shipping:'应付邮费',gross_amount:'报表总金额',listed_amount:'列表金额',refund_id:'退款单号',success_at:'退款成功时间',amount:'金额',refunds:'退款记录',after_sales:'售后记录',detail:'详情',status_raw:'平台原始状态',money_quality:'金额核对情况',net_amount:'净额',successful_refund_amount:'详情成功退款合计',kind:'类型',dispute_id:'售后单号',items:'商品明细',id:'来源订单号',vchcode:'管家婆单据号',sku:'SKU',sku_full:'完整SKU',name:'名称',qty:'数量',price:'单价',trade_status:'交易状态',process_status:'处理状态',seller_memo:'卖家备注',buyer_message:'买家留言',buyer:'买家',shop:'店铺',tracking_no:'物流单号',logistics_company:'物流公司',warehouse:'仓库',operator:'经办人',freight:'运费',discount:'优惠',refund_status:'售后状态',audit_fail_reason:'审核异常',tag:'标签',alert:'提示',refundFee:'申请退款金额',transactionAmount:'交易金额',refundStatus:'退款状态',refundReason:'退款原因',applyDateTime:'申请时间',tradeId:'淘宝订单号',itemTitle:'商品',returnLogisticsDetail:'退货物流详情',deliveryStatus:'物流状态',remaining:'处理期限',operations:'可用操作',candidateIds:'关联标识',logistics:'退货物流',manual_order_no:'手动订单号',received_date:'收货日期',progress:'订单进度',title:'标题',note:'备注',attachments:'附件'};
  Object.assign(labels,{current_status:'详情状态',sub_order_id:'子订单号',after_sale_type:'售后类型',biz_claim_type:'平台售后类型编号',status_notes:'状态提醒',buyer_goods_paid:'商品实付（不含邮费）',refund_breakdown:'退款金额构成',quantity:'申请件数',merchant_code:'商家编码',dispute_type:'售中 / 售后',negotiation_status:'协商状态',intervention_status:'平台介入状态',detail_pending:'详情待补充',detail_error:'详情更新异常',shipping_logistics:'发货物流',return_logistics:'退货物流',company:'物流公司',latest_at:'最新物流时间',latest_status:'最新物流动态',events:'物流轨迹',time:'时间',message:'动态',event_times:'业务时间',platform_advanced:'平台先行垫付',logistics_note:'物流说明',related_refund_id:'关联原售后单号',detail_scope:'详情来源范围',shipping:'商家发货',return:'买家退货'});
  async function api(path){const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),20000);try{const r=await fetch(path,{signal:controller.signal});const p=await r.json();if(!r.ok)throw new Error(p.detail||p.error||`HTTP ${r.status}`);return p;}catch(e){throw new Error(e.name==='AbortError'?'请求超时，请重试':e.message);}finally{clearTimeout(timer);}}
  function fields(obj,depth=0){if(obj===null||obj===undefined||obj==='')return '<span class="text-secondary">未采集</span>';if(typeof obj==='boolean')return obj?'是':'否';if(typeof obj!=='object')return esc(obj==='recent_all_statuses'?'近三个月全部售后状态':obj);if(depth>7)return esc(JSON.stringify(obj));if(Array.isArray(obj))return obj.length?obj.map((v,i)=>`<div class="oc-array-item"><small>${i+1}</small>${fields(v,depth+1)}</div>`).join(''):'<span class="text-secondary">暂无记录</span>';return `<dl class="oc-fields">${Object.entries(obj).filter(([k])=>!k.startsWith('_')).map(([k,v])=>`<dt>${esc(labels[k]||k)}</dt><dd>${fields(v,depth+1)}</dd>`).join('')}</dl>`;}
  function logisticsCard(title, data){
    if(!data)return '';
    const events=data.events||[];
    return `<details class="oc-source"><summary>${esc(title)} · ${esc(data.company||'物流公司待补充')} ${esc(data.tracking_no||'')}<small> ${esc(String(data.latest_status||data.coverage||'').slice(0,90))}</small></summary><p class="text-secondary">${esc(data.coverage||'最新动态')}</p>${events.length?events.map(e=>`<p><small>${stamp(e.time)}</small><br>${esc(e.message)}</p>`).join(''):'<p>当前页面未提供物流轨迹。</p>'}</details>`;
  }
  function refundCard(x){
    if(!x.refund_id||x.source!=='退款管理')return `<details class="oc-source"><summary>${esc(x.source||'其他售后记录')} · ${esc(x.refundStatus||x.kind||'详情')}</summary>${fields(x)}</details>`;
    const d=x.detail||{};
    const exchanging=x.after_sale_type==='换货';
    return `<section class="oc-source"><h4>${esc(x.after_sale_type||'退款 / 售后')} · ${esc(x.refundStatus||'状态待补充')}</h4><p>售后单号 ${esc(x.refund_id)}<br>申请 ${stamp(x.applyDateTime)}</p><p>${esc(x.itemTitle||'')} ${esc(x.sku||'')}</p><p>${exchanging?'换货售后，金额不计作现金退款':`申请退款 <strong>${amount(x.refundFee)}</strong>`} · ${esc(x.refundReason||'原因未提供')}</p>${x.detail_pending?'<p class="text-secondary">详情正在补充；已采集信息保留显示。</p>':''}${x.detail_error?'<p class="text-secondary">详情暂未更新，稍后重试。</p>':''}${d.platform_advanced?'<p class="text-secondary">平台已先行垫付买家；商家实际退款仍以账房核对。</p>':''}${logisticsCard('退货物流',d.return_logistics)}${logisticsCard('发货物流',d.shipping_logistics)}<details><summary>更多售后信息</summary>${fields(x)}</details></section>`;
  }
  const help={
    scope:['订单范围与数量','日常标签只显示尚未完成、尚未关闭的订单。已发货分为无售后、退款/退货两类；退款/退货不等于已经退回商品。搜索默认查全部订单，包含已完成和已关闭。列表目前覆盖管家婆已采集订单；「售后 N 条」来自已采集且按主订单号关联的独立售后单，当前持续采集范围为近三个月。无已关联记录不等于历史上没有售后。千牛、账房等关联信息可在订单旁的 ⓘ 查看。数量按页面订单组计算；合并发货和拆单会归组，一组有不同状态时可能出现在不同标签中。'],
    production:['生产安排','待安排、已安排来自管家婆的安排记录，仅筛选仍需处理的订单；已安排不代表生产完成。缺货单独筛选，可以与待安排或已安排组合。商品的裁剪、制作、手工和发货进度仍显示在每条订单里。'],
    money:['金额说明','订单实付、订单退款保留千牛采集到的原字段；这里的实付已包含该退款扣减，不再重复相减。账房已入账是已采集账期的累计净收，平台费用另列。暂无记录不等于零，退款金额也不代表商品已经退回。'],
  };
  function showHelp(topic){
    const entry=help[topic];if(!entry)return;
    ensureDialogs();
    const dialog=document.getElementById('oc-help');
    document.getElementById('oc-help-title').textContent=entry[0];
    document.getElementById('oc-help-body').textContent=entry[1];
    if(!dialog.open)dialog.showModal();
  }
  // Details are separate from the workflow page and created only on demand.
  let dialogsReady=false;
  function ensureDialogs(){
    if(dialogsReady)return;
    const host=document.createElement('div');
    host.innerHTML=`<dialog id="oc-detail" class="oc-dialog" aria-labelledby="oc-detail-title"><header><h3 id="oc-detail-title">订单详情</h3><button type="button" class="btn btn-outline-secondary" data-close>关闭</button></header><div id="oc-detail-body" aria-live="polite"></div></dialog><dialog id="oc-refund" class="oc-dialog" aria-labelledby="oc-refund-title"><header><h3 id="oc-refund-title">退款 / 售后详情</h3><button type="button" class="btn btn-outline-secondary" data-close>关闭</button></header><div id="oc-refund-body"></div></dialog><dialog id="oc-help" class="oc-dialog oc-help-dialog" aria-labelledby="oc-help-title"><header><h3 id="oc-help-title"></h3><button type="button" class="btn btn-outline-secondary" data-close>关闭</button></header><p id="oc-help-body"></p></dialog>`;
    host.querySelectorAll('[data-close]').forEach(button=>button.onclick=()=>button.closest('dialog').close());
    document.body.appendChild(host);
    document.getElementById('oc-detail').addEventListener('close',()=>{detailSeq++;});
    dialogsReady=true;
  }
  let detailSeq=0;
  async function detail(id){ensureDialogs();const seq=++detailSeq;const d=document.getElementById('oc-detail'),body=document.getElementById('oc-detail-body');document.getElementById('oc-detail-title').textContent='订单 '+id;body.textContent='正在加载…';if(!d.open)d.showModal();try{await window.JUN_AUTH_READY;const p=await api('/api/orders/'+encodeURIComponent(id));if(seq!==detailSeq)return;const o=p.order;const sources=p.sources||[];const refunds=[];for(const s of sources){if(s.source==='qianniu.refund')refunds.push({source:'退款管理',observed_at:s.observed_at,...s.payload});if(s.source==='qianniu.incremental')for(const r of [...(s.payload.detail?.refunds||[]),...(s.payload.detail?.after_sales||[])])refunds.push({source:'千牛详情',...r});if(s.source==='finance.taobao_income_order'&&Number(s.payload['退款金额（元）'])>0)refunds.push({source:'账房退款流水',month:s.month,...s.payload});}
  body.innerHTML=`<div class="oc-summary"><div><small>交易状态</small><strong>${esc(o.status)}</strong></div><div><small>订单实付</small><strong>${amount(o.export_paid)}</strong></div><div><small>订单退款</small><strong>${amount(o.export_refund)}</strong></div>${p.finance_visible?`<div><small>账房已入账</small><strong>${Number(o.billing?.rows)>0?amount(o.billing.net):'未匹配流水'}</strong></div>`:''}</div><div class="oc-business-times"><span>付款 <strong>${stamp(o.paid_at)}</strong></span><span>发货 <strong>${stamp(o.shipped_at)}</strong></span><span>完成 <strong>${stamp(o.completed_at)}</strong></span><button type="button" class="order-info-button" data-order-help="money" aria-label="了解订单金额" aria-haspopup="dialog"><i class="ti ti-info-circle" aria-hidden="true"></i></button></div><button type="button" class="btn btn-outline-primary mb-3" id="oc-open-refunds">查看退款 / 退货记录</button><h4 class="oc-source-heading">更多订单信息</h4>${sources.map(s=>`<details class="oc-source"><summary>${esc(names[s.source]||s.source)}${s.month?' · '+esc(s.month):''}${s.active?'':' · 历史批次'} <small>采集 ${stamp(s.observed_at)}</small></summary>${fields(s.payload)}</details>`).join('')}<details class="oc-source"><summary>信息更新记录（${(p.history||[]).length} 条）</summary>${(p.history||[]).map(h=>`<details><summary>${esc(names[h.source]||h.source)} · ${stamp(h.observed_at)}</summary>${fields(h.payload)}</details>`).join('')||'<p>本次接入后的变化会继续保留；此前未记录的历史不作推断。</p>'}</details>`;
  document.getElementById('oc-open-refunds').onclick=()=>{const r=document.getElementById('oc-refund');document.getElementById('oc-refund-body').innerHTML='<p class="text-secondary">各来源可能描述同一退款，请按退款单号及流水号核对；不把不同来源金额重复相加。</p>'+ (refunds.length?refunds.filter((x,i,all)=>!(x.source==='千牛详情'&&all.some(y=>y.source==='退款管理'&&y.refund_id&&(y.refund_id===x.refund_id||y.refund_id===x.dispute_id)))&&!(x.coverage==='refund_management_readable_sample'&&all.some(y=>y.source==='退款管理'&&y.refund_id))).map(refundCard).join(''):'<p>当前已采集来源没有可展开的退款明细，不代表没有发生退款。</p>');if(!r.open)r.showModal();};}catch(e){if(seq===detailSeq){body.innerHTML=`<p role="alert">${esc(e.message)}</p><button type="button" class="btn btn-outline-primary" id="oc-detail-retry">重试</button>`;document.getElementById('oc-detail-retry').onclick=()=>detail(id);}}}
  document.addEventListener('click',event=>{
    const helpButton=event.target.closest('[data-order-help]');
    if(helpButton){showHelp(helpButton.dataset.orderHelp);return;}
    const button=event.target.closest('[data-order-detail]');
    if(button)detail(button.dataset.orderDetail);
  });
})();
