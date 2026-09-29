(function () {
  'use strict';

  const app = document.getElementById('erp-app');
  const syncBar = document.getElementById('sync-bar');
  const money = new Intl.NumberFormat('zh-CN', {minimumFractionDigits: 2, maximumFractionDigits: 2});
  const number = new Intl.NumberFormat('zh-CN', {maximumFractionDigits: 2});
  const columns = [
    ['workflow','SKU / 处理进度'],['order','订单 / 管家婆单据'],['arranged','管家婆安排'],
    ['promise','备注约定发货'],['platform','淘宝最迟发货'],['status','平台与系统状态'],['amount','金额'],
    ['memo','卖家备注'],['buyer','买家'],['logistics','物流'],['times','其他时间'],['audit','审核异常'],
  ];
  const defaultColumns = ['workflow','order','promise','platform','amount'];
  const state = {
    orders: [], groups: [], filtered: [], presets: [], presetMeta: {}, page: 1,
    pageSize: window.matchMedia('(max-width: 760px)').matches ? 24 : 50,
    filters: defaultFilters(), activePreset:'', beforeSearchTab:'pending', searchTimer:null,
  };

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (character) {
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character];
    });
  }

  async function api(path, options) {
    const response = await fetch(path, {...options, signal: AbortSignal.timeout(20000)});
    const payload = await response.json().catch(function(){return {};});
    if (!response.ok) throw new Error(payload.detail || payload.error || `HTTP ${response.status}`);
    return payload;
  }

  async function copyText(value) {
    const text = String(value || '');
    if (!text) return false;
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (_error) {}
    const input = document.createElement('textarea');
    input.value = text;
    input.setAttribute('readonly', '');
    input.style.position = 'fixed';
    input.style.opacity = '0';
    document.body.appendChild(input);
    input.select();
    const copied = document.execCommand('copy');
    input.remove();
    return copied;
  }

  function dateTime(value) {
    if (!value) return '-';
    const parsed = new Date(String(value).replace(' ', 'T'));
    if (Number.isNaN(parsed.getTime())) return escapeHtml(value);
    return parsed.toLocaleString('zh-CN', {hour12:false,month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
  }

  function shortDateTime(value) {
    if (!value) return '待完成';
    const parsed = new Date(String(value).replace(' ', 'T'));
    if (Number.isNaN(parsed.getTime())) return escapeHtml(value);
    return parsed.toLocaleString('zh-CN', {hour12:false,month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
  }

  function baseOrderId(value) { return String(value || '').replace(/(-\d+)+$/, ''); }
  function orderGroupKey(order) {
    const tracking = String(order.tracking_no || '').trim();
    if (tracking) return `tracking:${tracking}`;
    const base = baseOrderId(order.id);
    return base && base !== String(order.id || '') ? `split:${base}` : `order:${order.id}`;
  }
  function isArranged(order) { return order.is_arranged === true || order.tag === '已安排' || order.alert === '已安排'; }
  function isShipped(order) { return order.is_shipped === true || order.process_status === '已发货' || Boolean(order.shipped_at); }
  function isClosed(order) { return ['交易关闭','ERP已删除'].includes(order.trade_status); }
  function isRefund(order) { return order.trade_status === '退款中' || Boolean(String(order.refund_status || '').trim()) && !['无退款','无售后','退款关闭','退款取消','已取消','已撤销'].includes(String(order.refund_status).trim()); }

  function remarkShipTime(memo, paidAt) {
    const text = String(memo || '');
    const match = text.match(/(?:^|\D)(0?[1-9]|1[0-2])(?:月|[.\/-]?)(0?[1-9]|[12]\d|3[01])(?:日)?\s*发/);
    if (!match) return {label:'未识别',sort:'9999-99-99',raw:text};
    const month = Number(match[1]);
    const day = Number(match[2]);
    const paid = paidAt ? new Date(String(paidAt).replace(' ', 'T')) : new Date();
    let year = Number.isNaN(paid.getTime()) ? new Date().getFullYear() : paid.getFullYear();
    if (!Number.isNaN(paid.getTime()) && month < paid.getMonth() + 1 - 6) year += 1;
    const parsed = new Date(year, month - 1, day);
    if (parsed.getMonth() !== month - 1 || parsed.getDate() !== day) return {label:'格式异常',sort:'9999-99-98',raw:match[0].trim()};
    return {label:`${String(month).padStart(2,'0')}月${String(day).padStart(2,'0')}日`,sort:`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`,raw:text};
  }

  function buildGroups(orders) {
    const byKey = new Map();
    orders.forEach(function(order){
      const key = orderGroupKey(order);
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(order);
    });
    return [...byKey.entries()].map(function(entry){
      const key = entry[0];
      const records = entry[1];
      const itemTracks = records.flatMap(function(order){return (order.items || []).map(function(item){return {item:item,order:order};});});
      const items = itemTracks.map(function(track){return track.item;});
      const closedCount = records.filter(isClosed).length;
      const activeRecords = records.filter(function(order){return !isClosed(order);});
      const arrangedCount = activeRecords.filter(isArranged).length;
      const shippedCount = activeRecords.filter(isShipped).length;
      const refundCount = records.filter(isRefund).length;
      const afterSaleCount = [...new Map(records.map(function(order){return [baseOrderId(order.id),Number(order.after_sale_count)||0];})).values()].reduce(function(sum,count){return sum+count;},0);
      const paidAt = records.map(function(order){return order.paid_at || '';}).filter(Boolean).sort().at(-1) || '';
      const promises = records.map(function(order){return remarkShipTime(order.seller_memo, order.paid_at || paidAt);});
      let workflowStage = 'unarranged';
      if (!activeRecords.length) workflowStage = 'closed';
      else if (shippedCount === activeRecords.length) workflowStage = 'shipped';
      else if (shippedCount) workflowStage = 'partial';
      else if (arrangedCount) workflowStage = 'arranged';
      const searchable = records.map(function(order){
        return [order.id,order.vchcode,order.shop,order.tag,order.alert,order.trade_status,order.process_status,order.sync_status,order.refund_status,order.tracking_no,order.logistics_company,order.warehouse,order.operator,order.seller_memo,order.buyer_message,order.audit_fail_reason,order.summary,order.buyer?.name,order.buyer?.account,order.buyer?.province,order.buyer?.city].join(' ');
      }).concat(items.map(function(item){return [item.sku,item.sku_full,item.name,item.color,item.size,item.taobao_title,item.taobao_sku_props].join(' ');})).join(' ').toLocaleLowerCase();
      return {
        key:key, records:records, items:items, itemTracks:itemTracks, searchable:searchable, workflowStage:workflowStage,
        activeCount:activeRecords.length, arrangedCount:arrangedCount, shippedCount:shippedCount, closedCount:closedCount, refundCount:refundCount, afterSaleCount:afterSaleCount,
        hasRefund:refundCount > 0, allClosed:closedCount === records.length,
        arrangedState:!activeRecords.length ? 'no' : arrangedCount === activeRecords.length ? 'yes' : arrangedCount ? 'partial' : 'no',
        outOfStock:items.some(function(item){return item.out_of_stock;}) || records.some(function(order){return Boolean(order.audit_fail_reason);}),
        amount:records.reduce(function(sum,order){return sum + Number(order.amount || 0);},0),
        shop:[...new Set(records.map(function(order){return order.shop;}).filter(Boolean))].join(' / '),
        paidAt:paidAt,
        deadline:records.map(function(order){return order.platform_ship_deadline || order.deadline || '';}).filter(Boolean).sort().at(0) || '',
        promise:promises.sort(function(a,b){return a.sort.localeCompare(b.sort);})[0],
        merged:key.startsWith('tracking:') && records.length > 1,
        split:key.startsWith('split:') && records.length > 1,
      };
    });
  }

  function badge(text, tone) { return text ? `<span class="order-badge ${tone || ''}">${escapeHtml(text)}</span>` : ''; }
  function unique(records, field) { return [...new Set(records.map(function(row){return row[field];}).filter(Boolean))]; }
  function availableOrderTags() {
    return [...new Set(state.orders.flatMap(function(order){return [order.tag,order.alert];}).concat(state.filters.tags||[]).map(function(value){return String(value||'').trim();}).filter(Boolean))].sort(function(a,b){return a.localeCompare(b,'zh-CN');});
  }
  function workflowLabel(group) {
    const labels = {unarranged:'待安排',arranged:'已安排待发货',partial:`部分已发货 ${group.shippedCount}/${group.activeCount}`,shipped:'已发货',closed:'交易关闭'};
    return labels[group.workflowStage] || group.workflowStage;
  }
  function workflowTone(group) { return `is-workflow-${group.workflowStage}`; }
  function exceptionBadges(group) {
    const afterSale = afterSaleBadge(group);
    const refund = group.hasRefund ? badge(group.refundCount === group.records.length ? '退款 / 售后' : '含退款记录','is-danger') : '';
    const closed = group.closedCount ? badge(group.allClosed ? '交易关闭' : '含关闭记录','is-closed') : '';
    return afterSale + refund + closed;
  }
  function afterSaleBadge(group) { return group.afterSaleCount ? badge(`售后 ${group.afterSaleCount} 条`,'is-after-sale') : ''; }

  function orderDetailButton(id) {
    const raw = String(id || '').trim();
    // Only known Taobao split suffixes are aliases; manual IDs stay intact.
    const canonical = /^[0-9]{15,24}(-[0-9]+)+$/.test(raw) ? raw.replace(/(-[0-9]+)+$/, '') : raw;
    return raw ? `<button type="button" class="order-detail-trigger" data-order-detail="${escapeHtml(canonical)}" aria-label="查看订单 ${escapeHtml(raw)} 的详情" aria-haspopup="dialog" title="订单详情"><i class="ti ti-info-circle" aria-hidden="true"></i></button>` : '';
  }
  function orderIdentity(group, cell) {
    const tag = cell || 'div';
    const ids = group.records.map(function(order){return `<div class="order-identity-row"><button type="button" class="order-id order-id-copy" data-copy-order-id="${escapeHtml(order.id)}" aria-label="复制订单编号 ${escapeHtml(order.id)}"><span>${escapeHtml(order.id)}</span><i class="ti ti-copy"></i><em data-copy-label>复制</em></button>${orderDetailButton(order.id)}</div>`;}).join('');
    const docs = unique(group.records,'vchcode').map(function(value){return `<small>管家婆 ${escapeHtml(value)}</small>`;}).join('');
    return `<${tag} class="order-col-order"><div class="order-group-label">${group.merged?badge(`合并发货 · ${group.records.length} 单`,'is-merge'):group.split?badge(`分批记录 · ${group.records.length} 条`,'is-split'):''}${afterSaleBadge(group)}${badge(group.shop,'is-shop')}</div><div class="order-ids">${ids}</div>${docs}<small>${escapeHtml(group.records[0]?.summary || '')}</small></${tag}>`;
  }
  function renderOrderCell(group) { return orderIdentity(group,'td'); }
  function renderWorkflowCell(group) { return `<td>${badge(workflowLabel(group),workflowTone(group))}${orderProgressMarkup(group,'table')}<small>${group.workflowStage==='arranged'?'已进入管家婆安排，尚无实际发货记录':group.workflowStage==='unarranged'?'管家婆尚未标记已安排':''}</small></td>`; }
  function renderArrangedCell(group) {
    const label = group.arrangedState === 'yes' ? '已安排' : group.arrangedState === 'partial' ? `部分已安排 ${group.arrangedCount}/${group.activeCount}` : '未安排';
    return `<td>${badge(label,group.arrangedState==='yes'?'is-arranged':group.arrangedState==='partial'?'is-partial':'is-unarranged')}<div class="order-cell-notes">${unique(group.records,'tag').concat(unique(group.records,'alert')).filter(function(value,index,array){return array.indexOf(value)===index;}).map(escapeHtml).join(' · ') || '管家婆暂无标记'}</div></td>`;
  }
  function compactItemSpec(item) {
    const props=String(item.taobao_sku_props||'').split(/[；;]/).map(function(value){return value.replace(/^.*?[：:]/,'').trim();}).filter(Boolean);
    const fallback=[item.color,item.size].filter(Boolean).map(String);
    const values=props.length?props:fallback.length?fallback:[item.sku_full].filter(Boolean);
    return [...new Set(values)].join(' / ');
  }
  function mobileOrderIds(group) {
    const ids=[...new Set(group.records.map(function(order){return String(order.id||'').trim();}).filter(Boolean))];
    return `<div class="order-card-identities">${ids.map(function(id){return `<div class="order-identity-row"><button type="button" class="order-copy-id" data-copy-order-id="${escapeHtml(id)}" aria-label="复制订单编号 ${escapeHtml(id)}"><span>订单</span><strong>${escapeHtml(id)}</strong><i class="ti ti-copy"></i><em data-copy-label>复制</em></button>${orderDetailButton(id)}</div>`;}).join('')}</div>`;
  }
  function isReadyStockTrack(track) {
    return /现货/.test(String(track.order?.seller_memo||'')) && track.item?.in_stock_sku === true;
  }
  function progressStep(label,state,time) {
    return `<li class="${escapeHtml(state)}"><span class="order-progress-dot"><i class="ti ti-${state==='is-done'?'check':'point'}"></i></span><strong>${escapeHtml(label)}</strong><small>${escapeHtml(time||'待关联')}</small></li>`;
  }
  function itemProgressMarkup(track,mode) {
    const direct=isReadyStockTrack(track);
    const shipped=isShipped(track.order||{});
    const orderedAt=shortDateTime(track.order?.paid_at);
    const shippedAt=shortDateTime(track.order?.shipped_at);
    const kind=String(track.item?.workflow_kind||'direct');
    const middle=direct||kind==='direct'
      ? ''
      : kind==='headwear'
        ? progressStep('手','is-unlinked','待关联')
        : progressStep('裁','is-unlinked','待关联')+progressStep('制','is-unlinked','待关联')+progressStep('手','is-unlinked','待关联');
    const stages=progressStep('订','is-done',orderedAt)+middle+progressStep('发',shipped?'is-done':'is-next',shippedAt);
    const routeLabel=direct?'现货直发':kind==='headwear'?'头饰手工':kind==='apparel'?'服装制作':'直接发货';
    const item=track.item||{};
    const image=item.image_url?`<img src="${escapeHtml(item.image_url)}" loading="lazy" alt="${escapeHtml(item.sku||item.name||'商品')}">`:'<span class="order-progress-image-empty"><i class="ti ti-photo-off"></i></span>';
    const sku=item.sku||item.name||'-';
    const name=item.name&&item.name!==sku?item.name:'';
    const spec=compactItemSpec(item);
    return `<article class="order-item-progress ${item.out_of_stock?'is-out':''} ${direct||kind==='direct'?'is-direct':''} ${mode==='table'?'is-table':''}"><header class="order-progress-product">${image}<div><div class="order-progress-product-title"><strong>${escapeHtml(sku)}</strong><span>${item.out_of_stock?badge('缺货','is-danger'):''}${badge(routeLabel,direct?'is-arranged':'is-process')}<b>× ${number.format(Number(item.qty||1))}</b></span></div>${name?`<p>${escapeHtml(name)}</p>`:''}${spec?`<small>${escapeHtml(spec)}</small>`:''}</div></header><ol>${stages}</ol></article>`;
  }
  function orderProgressMarkup(group,mode) {
    const tracks=group.itemTracks||[];
    const body=tracks.length?tracks.map(function(track){return itemProgressMarkup(track,mode);}).join(''):'<p class="order-progress-empty">商品明细尚未同步，暂不能建立逐件进度。</p>';
    if(group.hasRefund && mode!=='table')return `<details class="order-refund-progress"><summary><i class="ti ti-history"></i>查看退款 / 售后订单原进度${tracks.length?` · ${tracks.length} 件`:''}</summary><div class="order-progress-list">${body}</div></details>`;
    if(group.hasRefund && mode==='table')return `<details class="order-refund-progress is-table"><summary>查看原进度${tracks.length?` · ${tracks.length} 件`:''}</summary><div class="order-progress-list">${body}</div></details>`;
    return `<section class="order-progress-list" aria-label="逐件订单进度">${body}</section>`;
  }
  function platformEarlierThanPromise(group) {
    if (!group.deadline||!group.promise?.sort||group.promise.sort.startsWith('9999')) return false;
    return String(group.deadline).slice(0,10)<group.promise.sort;
  }
  function statusMarkup(group) {
    const line = function(label, field, tone){const values=unique(group.records,field);return `<div><span>${label}</span><strong>${values.map(function(value){return badge(value,tone);}).join('') || '-'}</strong></div>`;};
    return `<div class="order-status-lines">${line('淘宝订单','trade_status','is-taobao')}${line('管家婆处理','process_status','is-process')}${line('同步','sync_status','is-sync')}${line('退款','refund_status','is-danger')}</div>`;
  }
  function renderStatusCell(group) { return `<td>${statusMarkup(group)}</td>`; }
  function renderAmountCell(group) { return `<td class="order-number"><strong>¥${money.format(group.amount)}</strong><small>运费 ¥${money.format(group.records.reduce(function(sum,row){return sum+Number(row.freight||0);},0))}</small></td>`; }
  function renderPromiseCell(group) { return `<td class="order-date-cell"><strong>${escapeHtml(group.promise.label)}</strong><small>${group.promise.label==='未识别'?'备注里没有可识别的发货日期':'只来自卖家备注，不等于平台时限'}</small></td>`; }
  function renderPlatformCell(group) { return `<td class="order-date-cell"><strong>${dateTime(group.deadline)}</strong><small>淘宝平台 deadline</small></td>`; }
  function renderBuyerCell(group) {
    const buyers=group.records.map(function(order){return order.buyer||{};});
    return `<td><strong>${escapeHtml([...new Set(buyers.map(function(b){return b.name||b.account;}).filter(Boolean))].join(' / ')||'-')}</strong><small>${escapeHtml([...new Set(buyers.map(function(b){return b.account;}).filter(Boolean))].join(' / '))}</small><small>${escapeHtml([...new Set(buyers.map(function(b){return `${b.province||''}${b.city||''}${b.district||''}`;}).filter(Boolean))].join(' / '))}</small></td>`;
  }
  function renderLogisticsCell(group) { return `<td><strong>${escapeHtml(unique(group.records,'logistics_company').join(' / ')||'-')}</strong><div class="order-tracking">${unique(group.records,'tracking_no').map(function(value){return `<span>${escapeHtml(value)}</span>`;}).join('')||'<small>暂无物流单号</small>'}</div></td>`; }
  function renderTimesCell(group) { return `<td><dl class="order-mini-dl"><dt>付款</dt><dd>${dateTime(group.paidAt)}</dd><dt>实际发货</dt><dd>${dateTime(group.records.map(function(row){return row.shipped_at;}).filter(Boolean).sort().at(-1))}</dd><dt>更新</dt><dd>${dateTime(group.records.map(function(row){return row.modified_at;}).filter(Boolean).sort().at(-1))}</dd></dl></td>`; }
  function textCell(group, field, className) { const values=unique(group.records,field);return `<td class="${className||'order-long-text'}">${values.map(function(value){return `<p>${escapeHtml(value)}</p>`;}).join('')||'<span class="text-secondary">-</span>'}</td>`; }
  const cellRenderers = {
    workflow:renderWorkflowCell,order:renderOrderCell,arranged:renderArrangedCell,promise:renderPromiseCell,platform:renderPlatformCell,status:renderStatusCell,amount:renderAmountCell,buyer:renderBuyerCell,logistics:renderLogisticsCell,times:renderTimesCell,
    memo:function(group){return textCell(group,'seller_memo','order-long-text');},audit:function(group){return textCell(group,'audit_fail_reason','order-long-text order-audit');},
  };

  const orderViews = [
    ['pending','待发货','已付款'],
    ['shipped','已发货','无退款 / 退货'],
    ['returns','退款 / 退货','已发货'],
    ['all','全部订单','含已完成 / 已关闭'],
  ];
  function defaultFilters() { return {version:2,tab:'pending',production:'all',q:'',stock:'all',tags:[],shop:'all',status:'all',refund:'all',afterSale:'all',dateFrom:'',dateTo:'',deadline:'all',sortBy:'promise',sortDir:'asc',columns:[...defaultColumns]}; }
  function infoButton(topic,label) { return `<button type="button" class="order-info-button" data-order-help="${topic}" aria-label="${escapeHtml(label)}" aria-haspopup="dialog"><i class="ti ti-info-circle" aria-hidden="true"></i></button>`; }
  function completed(order) { return order.trade_status === '交易成功'; }
  function hasShipment(order) { return isShipped(order) || ['已发货','卖家已发货','部分发货','交易成功'].includes(order.trade_status); }
  function paid(order) { return Boolean(order.paid_at) || ['已付款','买家已付款','部分付款','已发货','卖家已发货','部分发货','交易成功'].includes(order.trade_status); }
  function matchesView(order,view) {
    if(view==='all')return true;
    if(isClosed(order)||completed(order))return false;
    if(view==='pending')return paid(order)&&(!hasShipment(order)||order.trade_status==='部分发货');
    if(view==='shipped')return hasShipment(order)&&!isRefund(order);
    if(view==='returns')return hasShipment(order)&&isRefund(order);
    return false;
  }
  function matchesRecord(order,f) {
    if(!matchesView(order,f.tab))return false;
    if(f.shop!=='all'&&order.shop!==f.shop)return false;
    if(f.tags.length&&!f.tags.includes(String(order.tag||'').trim())&&!f.tags.includes(String(order.alert||'').trim()))return false;
    const date=String(order.paid_at||'').slice(0,10);
    if(f.dateFrom&&(!date||date<f.dateFrom))return false;
    if(f.dateTo&&(!date||date>f.dateTo))return false;
    if(f.status==='completed'&&!completed(order))return false;
    if(f.status==='closed'&&!isClosed(order))return false;
    if(f.status==='open'&&isClosed(order))return false;
    if(f.status==='ongoing'&&(isClosed(order)||completed(order)))return false;
    if(f.status==='unpaid'&&(paid(order)||isClosed(order)))return false;
    if(f.status==='shipped_any'&&!hasShipment(order))return false;
    if(f.status==='partial'&&order.trade_status!=='部分发货')return false;
    if(f.refund==='yes'&&!isRefund(order))return false;
    if(f.refund==='no'&&isRefund(order))return false;
    if(f.refund==='active'&&!/退款中|退货中|待.*退|申请|处理中/.test(String(order.refund_status||'')+' '+String(order.trade_status||'')))return false;
    if(f.afterSale==='yes'&&!(Number(order.after_sale_count)>0))return false;
    if(f.afterSale==='no'&&Number(order.after_sale_count)>0)return false;
    if(f.production==='unarranged'&&(isArranged(order)||isShipped(order)||isClosed(order)||completed(order)))return false;
    if(f.production==='arranged'&&(!isArranged(order)||isShipped(order)||isClosed(order)||completed(order)))return false;
    const out=(order.items||[]).some(item=>item.out_of_stock);
    if(f.stock==='out'&&!out)return false;
    if(f.stock==='ready'&&out)return false;
    if(f.stock==='issue'&&!order.audit_fail_reason)return false;
    if(f.deadline!=='all'){
      const raw=String(order.platform_ship_deadline||order.deadline||'').trim();
      if(f.deadline==='missing')return !raw;
      if(isClosed(order)||completed(order)||isShipped(order)||!raw)return false;
      // The ERP platform deadline is a China business timestamp, independent of viewer timezone.
      const iso=raw.replace(' ','T');
      const time=Date.parse(/[zZ]$|[+-]\d\d:\d\d$/.test(iso)?iso:iso+'+08:00');
      if(!Number.isFinite(time))return false;
      const delta=time-Date.now();
      if(f.deadline==='overdue'&&delta>=0)return false;
      if(f.deadline==='soon'&&(delta<0||delta>86400000))return false;
    }
    return true;
  }
  function matchesGroup(group,f) {
    return (!f.q||group.searchable.includes(f.q.trim().toLocaleLowerCase()))&&group.records.some(order=>matchesRecord(order,f));
  }
  function filterGroups() {
    const f=state.filters;
    let rows=state.groups.filter(group=>matchesGroup(group,f));
    rows.sort(function(a,b){
      const values=function(group){
        if(f.sortBy==='amount')return {value:group.amount,missing:false,numeric:true};
        if(f.sortBy==='paid')return {value:group.paidAt,missing:!group.paidAt};
        if(f.sortBy==='deadline')return {value:group.deadline,missing:!group.deadline};
        return {value:group.promise.label==='未识别'||group.promise.label==='格式异常'?'':group.promise.sort,missing:group.promise.label==='未识别'||group.promise.label==='格式异常'};
      };
      const av=values(a),bv=values(b);
      if(av.missing!==bv.missing)return av.missing?1:-1;
      let compared=av.numeric?av.value-bv.value:String(av.value).localeCompare(String(bv.value));
      if(f.sortDir==='desc')compared=-compared;
      return compared||a.key.localeCompare(b.key);
    });
    state.filtered=rows;
    state.page=Math.min(state.page,Math.max(1,Math.ceil(rows.length/state.pageSize)));
  }
  function currentConfig(){return JSON.parse(JSON.stringify(state.filters));}
  function normalizedConfig(config){
    const old=config||{};
    const next={...defaultFilters(),...old};
    if(old.version!==2){
      const stage=old.stage||(old.source==='history'?'shipped':old.source==='all'?'all':'actionable');
      next.tab=stage==='all'||stage==='shipped'||stage==='partial'?'all':'pending';
      if(['arranged','unarranged'].includes(stage))next.production=stage;
      if(stage==='shipped')next.status='shipped_any';
      if(stage==='partial')next.status='partial';
      if(old.closure==='closed'||stage==='closed'||old.orderState==='closed'){next.tab='all';next.status='closed';}
      else if(old.closure==='open'&&next.tab==='all')next.status=stage==='shipped'?'shipped_any':'open';
      if(old.orderState==='refund'){next.tab='all';next.refund='yes';}
      if(old.orderState==='active')next.refund='no';
      if(old.orderState==='all'&&!old.stage)next.tab='all';
      if(old.sort){const pair={promise_asc:['promise','asc'],deadline_asc:['deadline','asc'],paid_desc:['paid','desc'],paid_asc:['paid','asc'],amount_desc:['amount','desc']}[old.sort];if(pair)[next.sortBy,next.sortDir]=pair;}
    }
    for(const [key,valid] of Object.entries({tab:orderViews.map(v=>v[0]),production:['all','arranged','unarranged'],stock:['all','out','ready','issue'],status:['all','ongoing','completed','closed','open','unpaid','shipped_any','partial'],refund:['all','yes','no','active'],afterSale:['all','yes','no'],deadline:['all','soon','overdue','missing'],sortBy:['promise','deadline','paid','amount'],sortDir:['asc','desc']}))if(!valid.includes(next[key]))next[key]=defaultFilters()[key];
    if(next.tab!=='all')next.status='all';
    next.q=String(next.q||'');next.shop=String(next.shop||'all');
    next.tags=Array.isArray(next.tags)?[...new Set(next.tags.map(v=>String(v||'').trim()).filter(Boolean))]:[];
    for(const k of ['dateFrom','dateTo'])if(!/^\d{4}-\d{2}-\d{2}$/.test(next[k]))next[k]='';
    const validColumns=Array.isArray(next.columns)?next.columns.filter(key=>columns.some(item=>item[0]===key)):[];
    next.columns=validColumns.length?validColumns:[...defaultColumns];
    return Object.fromEntries(Object.keys(defaultFilters()).map(k=>[k,k==='version'?2:next[k]]));
  }
  function applyConfig(config){state.filters=normalizedConfig(config);state.page=1;render();}
  function advancedChips(){
    const f=state.filters, chips=[];
    if(f.dateFrom||f.dateTo)chips.push(['dates',`付款 ${f.dateFrom||'不限'} 至 ${f.dateTo||'不限'}`]);
    if(f.shop!=='all')chips.push(['shop',f.shop]);
    if(f.tags.length)chips.push(['tags',`标签：${f.tags.join('、')}`]);
    const status={ongoing:'进行中',completed:'已完成',closed:'已关闭 / 已删除',open:'未关闭',unpaid:'待付款',shipped_any:'已发货（含已完成）',partial:'部分发货'};
    if(status[f.status])chips.push(['status',status[f.status]]);
    if(f.refund!=='all')chips.push(['refund',{yes:'有退款 / 退货',no:'无退款 / 退货',active:'售后处理中'}[f.refund]]);
    if(f.afterSale!=='all')chips.push(['afterSale',f.afterSale==='yes'?'有已关联售后':'无已关联售后']);
    if(f.deadline!=='all')chips.push(['deadline',{soon:'24小时内需发货',overdue:'已超发货时限',missing:'未记录发货时限'}[f.deadline]]);
    if(['ready','issue'].includes(f.stock))chips.push(['stock',f.stock==='ready'?'无缺货标记':'审核异常']);
    return chips;
  }
  function renderControls(){
    const f=state.filters, chips=advancedChips();
    const shops=[...new Set(state.orders.map(o=>o.shop).filter(Boolean))].sort();
    const count=filters=>number.format(state.groups.filter(g=>matchesGroup(g,filters)).length);
    const tabs=orderViews.map(([key,label,sub])=>`<button type="button" role="tab" id="order-tab-${key}" data-order-tab="${key}" aria-selected="${f.tab===key}" aria-controls="order-results" tabindex="${f.tab===key?'0':'-1'}"><span>${label}${key!=='all'?`<b>${count(f.tab===key?f:{...f,tab:key,production:'all',stock:'all',status:'all',refund:'all',afterSale:'all'})}</b>`:''}</span><small>${sub}</small></button>`).join('');
    const production=['pending','all'].includes(f.tab)?`<div class="order-production"><span>生产安排 ${infoButton('production','了解生产安排')}</span><div class="order-production-options" role="group" aria-label="生产安排">${[['all','全部'],['unarranged','待安排'],['arranged','已安排']].map(([key,label])=>`<button type="button" data-production="${key}" aria-pressed="${f.production===key}">${label}<small>${count({...f,production:key})}</small></button>`).join('')}</div><button type="button" class="order-stock-chip" id="order-stock-toggle" aria-pressed="${f.stock==='out'}"><i class="ti ti-alert-circle" aria-hidden="true"></i>缺货<small>${count({...f,stock:'out'})}</small></button></div>`:'';
    return `<section class="order-controls order-workspace-controls" aria-label="订单筛选"><div class="order-view-tabs" role="tablist" aria-label="订单状态">${tabs}</div>${production}<div class="order-toolbar"><label class="order-search"><i class="ti ti-search" aria-hidden="true"></i><input id="order-q" class="form-control" type="search" aria-label="搜索全部订单" placeholder="搜索订单号、SKU、备注…" value="${escapeHtml(f.q)}"></label><button type="button" id="order-more" class="btn btn-outline-secondary"><i class="ti ti-adjustments-horizontal" aria-hidden="true"></i>更多筛选${chips.length?`<b>${chips.length}</b>`:''}</button><label class="order-sort"><span class="visually-hidden">排序方式</span><select id="order-sort-by" class="form-select"><option value="promise">约定发货优先</option><option value="deadline">发货时限优先</option><option value="paid">付款时间</option><option value="amount">订单金额</option></select></label><button type="button" class="order-sort-direction" id="order-sort-dir" aria-label="${f.sortDir==='asc'?'当前升序，切换降序':'当前降序，切换升序'}" title="${f.sortDir==='asc'?'升序':'降序'}"><i class="ti ti-sort-${f.sortDir==='asc'?'ascending':'descending'}" aria-hidden="true"></i></button>${infoButton('scope','了解订单范围与数量')}</div>${f.q?`<div class="order-search-scope" role="status">${f.tab==='all'?'搜索全部订单，包含已完成和已关闭':`在${orderViews.find(v=>v[0]===f.tab)[1]}中搜索`}<button type="button" data-clear-search>清除搜索</button></div>`:''}${chips.length?`<div class="order-filter-chips" aria-label="已选筛选">${chips.map(([key,label])=>`<button type="button" data-clear-filter="${key}" aria-label="移除筛选：${escapeHtml(label)}">${escapeHtml(label)}<i class="ti ti-x" aria-hidden="true"></i></button>`).join('')}<button type="button" data-clear-filters>清空筛选</button></div>`:''}</section>${renderFilterDialog(shops)}`;
  }
  function renderFilterDialog(shops){
    const f=state.filters;
    return `<dialog id="order-filters-dialog" class="order-filter-dialog" aria-labelledby="order-filters-title"><form id="order-filter-form"><header><h3 id="order-filters-title">更多筛选</h3><button class="order-dialog-close" type="button" data-filter-close aria-label="关闭更多筛选"><i class="ti ti-x" aria-hidden="true"></i></button></header><div class="order-filter-body"><fieldset><legend>付款时间</legend><div class="order-date-shortcuts">${[['all','不限'],['7','近7天'],['30','近30天'],['month','本月']].map(([key,label])=>`<button type="button" data-date-range="${key}">${label}</button>`).join('')}</div><div class="order-date-range"><input type="date" name="dateFrom" aria-label="付款开始日期"><span>至</span><input type="date" name="dateTo" aria-label="付款结束日期"></div></fieldset><div class="order-more-grid">${f.tab==='all'?`<label><span>订单状态</span><select name="status" class="form-select"><option value="all">全部状态</option><option value="ongoing">进行中</option><option value="completed">已完成</option><option value="closed">已关闭 / 已删除</option><option value="unpaid">待付款</option><option value="open">未关闭（含已完成）</option><option value="shipped_any">已发货（含已完成）</option><option value="partial">部分发货</option></select></label>`:''}<label><span>管家婆退款标记</span><select name="refund" class="form-select"><option value="all">不限</option><option value="active">处理中</option><option value="yes">有退款 / 退货标记</option><option value="no">无退款 / 退货标记</option></select></label><label><span>已关联售后</span><select name="afterSale" class="form-select"><option value="all">不限</option><option value="yes">有售后记录</option><option value="no">无已关联记录</option></select></label><label><span>发货时限</span><select name="deadline" class="form-select"><option value="all">不限</option><option value="soon">24小时内需发货</option><option value="overdue">已超时</option><option value="missing">未记录</option></select></label>${shops.length>1?`<label><span>店铺</span><select name="shop" class="form-select"><option value="all">全部店铺</option>${shops.map(shop=>`<option value="${escapeHtml(shop)}">${escapeHtml(shop)}</option>`).join('')}</select></label>`:''}<label><span>库存 / 异常</span><select name="stock" class="form-select"><option value="all">不限</option><option value="out">缺货</option><option value="ready">无缺货标记</option><option value="issue">审核异常</option></select></label></div>${availableOrderTags().length?`<details class="order-filter-section"><summary>管家婆标签${f.tags.length?` · 已选 ${f.tags.length} 项`:''}</summary><div class="order-tag-options">${availableOrderTags().map(tag=>`<label><input type="checkbox" name="tags" value="${escapeHtml(tag)}"><span>${escapeHtml(tag)}</span></label>`).join('')}</div></details>`:''}<details class="order-filter-section"><summary>常用筛选</summary><div class="order-saved-views"><select id="order-preset" class="form-select" aria-label="常用筛选"><option value="">选择已保存的筛选</option>${state.presets.map(p=>`<option value="${escapeHtml(p.id)}" ${state.activePreset===p.id?'selected':''}>${escapeHtml(p.name)}${p.scope==='team'?' · 团队':''}</option>`).join('')}</select><div><button type="button" class="btn btn-sm btn-outline-primary" id="order-preset-save">保存这组筛选</button><button type="button" class="btn btn-sm btn-outline-secondary" id="order-preset-default" ${state.activePreset?'':'disabled'}>设为默认</button><button type="button" class="btn btn-sm btn-outline-secondary" id="order-preset-delete" ${state.activePreset?'':'disabled'}>删除</button></div></div></details><details class="order-filter-section order-column-settings"><summary>表格显示列</summary><div>${columns.map(([key,label])=>`<label><input type="checkbox" name="columns" value="${key}" ${f.columns.includes(key)?'checked':''}>${label}</label>`).join('')}</div></details><p id="order-filter-error" class="text-danger" role="alert" hidden></p></div><footer><button type="button" class="btn btn-outline-secondary" data-filter-reset>重置</button><button type="submit" class="btn btn-primary">应用筛选</button></footer></form></dialog>`;
  }
  function renderCards(rows){
    return `<div class="order-card-list">${rows.map(function(group){
      const memos=unique(group.records,'seller_memo');
      const deadlineWarning=platformEarlierThanPromise(group);
      return `<article class="order-card"><header class="order-card-priority"><div>${badge(workflowLabel(group),workflowTone(group))}${exceptionBadges(group)}${group.outOfStock?badge('缺货 / 异常','is-danger'):''}</div><div class="order-card-promise"><span>约定发货</span><strong>${escapeHtml(group.promise.label==='未识别'?'日期待补':group.promise.label)}</strong></div></header>${mobileOrderIds(group)}${orderProgressMarkup(group,'card')}${memos.length?`<div class="order-card-memo"><span>操作备注</span>${memos.map(function(v){return `<p>${escapeHtml(v)}</p>`;}).join('')}</div>`:''}<div class="order-card-secondary"><div class="${deadlineWarning?'is-warning':''}"><span>平台最迟</span><strong>${dateTime(group.deadline)}</strong>${deadlineWarning?'<small>早于约定日期</small>':''}</div><div><span>订单金额</span><strong>¥${money.format(group.amount)}</strong></div></div><details><summary>更多信息</summary>${statusMarkup(group)}<dl><dt>管家婆单据</dt><dd>${escapeHtml(unique(group.records,'vchcode').join(' / ')||'-')}</dd><dt>管家婆安排</dt><dd>${group.arrangedState==='no'?'未安排':group.arrangedState==='partial'?'部分安排':'已安排'}</dd><dt>物流</dt><dd>${escapeHtml(unique(group.records,'logistics_company').join(' / ')||'暂无')} ${escapeHtml(unique(group.records,'tracking_no').join(' / '))}</dd><dt>买家</dt><dd>${escapeHtml(group.records[0]?.buyer?.name||group.records[0]?.buyer?.account||'-')}</dd><dt>付款</dt><dd>${dateTime(group.paidAt)}</dd><dt>实际发货</dt><dd>${dateTime(group.records.map(function(r){return r.shipped_at;}).filter(Boolean).sort().at(-1))}</dd><dt>审核异常</dt><dd>${escapeHtml(unique(group.records,'audit_fail_reason').join(' / ')||'无')}</dd></dl></details></article>`;
    }).join('')||'<div class="order-empty">没有符合当前筛选的订单</div>'}</div>`;
  }
  function renderResults(){
    const start=(state.page-1)*state.pageSize;const rows=state.filtered.slice(start,start+state.pageSize);const selected=columns.filter(function(item){return state.filters.columns.includes(item[0]);});
    const table=`<div class="order-table-wrap"><table class="order-table"><thead><tr>${selected.map(function(item){return `<th class="order-col-${escapeHtml(item[0])}">${escapeHtml(item[1])}</th>`;}).join('')}</tr></thead><tbody>${rows.map(function(group){return `<tr>${selected.map(function(item){return cellRenderers[item[0]](group);}).join('')}</tr>`;}).join('')||`<tr><td colspan="${selected.length}"><div class="order-empty">没有符合当前筛选的订单</div></td></tr>`}</tbody></table></div>`;
    const pages=Math.max(1,Math.ceil(state.filtered.length/state.pageSize));
    return `<section class="order-results" id="order-results" role="tabpanel" aria-labelledby="order-tab-${state.filters.tab}" tabindex="0"><header><div><h2>${state.filters.q?'搜索结果':orderViews.find(v=>v[0]===state.filters.tab)[1]}</h2><p role="status">${number.format(state.filtered.length)} 组订单${state.filters.production!=='all'?' · '+(state.filters.production==='arranged'?'已安排':'待安排'):''}${state.filters.stock==='out'?' · 缺货':''}</p></div><strong>第 ${state.page} / ${pages} 页</strong></header>${table}${renderCards(rows)}<footer><span>显示 ${state.filtered.length?start+1:0}–${Math.min(start+state.pageSize,state.filtered.length)} / ${state.filtered.length}</span><div><button class="btn btn-sm btn-outline-secondary" id="order-prev" ${state.page<=1?'disabled':''}>上一页</button><button class="btn btn-sm btn-outline-secondary" id="order-next" ${state.page>=pages?'disabled':''}>下一页</button></div></footer></section>`;
  }
  function selectTab(key){
    if(key===state.filters.tab){document.getElementById('order-tab-'+key)?.focus();return;}
    state.filters={...state.filters,tab:key,production:'all',stock:'all',status:'all',refund:'all',afterSale:'all'};
    state.page=1;state.activePreset='';render();
    document.getElementById('order-tab-'+key)?.focus();
  }
  function fillFilterForm(filters){
    const form=document.getElementById('order-filter-form');
    for(const key of ['dateFrom','dateTo','status','refund','afterSale','deadline','stock','shop']){const field=form.elements.namedItem(key);if(field)field.value=filters[key];}
    form.querySelectorAll('[name="tags"]').forEach(input=>input.checked=filters.tags.includes(input.value));
    form.querySelectorAll('[name="columns"]').forEach(input=>input.checked=filters.columns.includes(input.value));
    document.getElementById('order-filter-error').hidden=true;
  }
  function readFilterForm(){
    const form=document.getElementById('order-filter-form'),next=currentConfig();
    for(const key of ['dateFrom','dateTo','status','refund','afterSale','deadline','stock','shop']){const field=form.elements.namedItem(key);if(field)next[key]=field.value;}
    next.tags=[...form.querySelectorAll('[name="tags"]:checked')].map(i=>i.value);
    next.columns=[...form.querySelectorAll('[name="columns"]:checked')].map(i=>i.value);
    let error='';
    if(next.dateFrom&&next.dateTo&&next.dateFrom>next.dateTo)error='开始日期不能晚于结束日期';
    if(!next.columns.length)error='请至少保留一列';
    const hint=document.getElementById('order-filter-error');hint.hidden=!error;hint.textContent=error;
    if(error||!form.reportValidity())return null;
    return normalizedConfig(next);
  }
  function bindControls(){
    document.querySelectorAll('[data-order-tab]').forEach(button=>{
      button.addEventListener('click',()=>selectTab(button.dataset.orderTab));
      button.addEventListener('keydown',event=>{
        const index=orderViews.findIndex(v=>v[0]===button.dataset.orderTab);
        const next={ArrowRight:(index+1)%orderViews.length,ArrowLeft:(index+orderViews.length-1)%orderViews.length,Home:0,End:orderViews.length-1}[event.key];
        if(next===undefined)return;event.preventDefault();selectTab(orderViews[next][0]);
      });
    });
    document.querySelectorAll('[data-production]').forEach(button=>button.addEventListener('click',()=>{state.filters.production=button.dataset.production;state.page=1;render();document.querySelector(`[data-production="${state.filters.production}"]`)?.focus();}));
    document.getElementById('order-stock-toggle')?.addEventListener('click',()=>{state.filters.stock=state.filters.stock==='out'?'all':'out';state.page=1;render();});
    const sort=document.getElementById('order-sort-by');sort.value=state.filters.sortBy;
    sort.addEventListener('change',()=>{state.filters.sortBy=sort.value;state.filters.sortDir=sort.value==='paid'?'desc':'asc';state.page=1;render();});
    document.getElementById('order-sort-dir').addEventListener('click',()=>{state.filters.sortDir=state.filters.sortDir==='asc'?'desc':'asc';render();});
    document.querySelectorAll('[data-copy-order-id]').forEach(function(button){button.addEventListener('click',async function(){const copied=await copyText(button.dataset.copyOrderId);if(!copied)return;button.classList.add('is-copied');button.querySelector('i').className='ti ti-check';button.querySelector('[data-copy-label]').textContent='已复制';window.setTimeout(function(){if(!button.isConnected)return;button.classList.remove('is-copied');button.querySelector('i').className='ti ti-copy';button.querySelector('[data-copy-label]').textContent='复制';},1600);});});
    const clearSearch=()=>{state.filters={...state.filters,q:'',tab:state.beforeSearchTab||'pending'};state.page=1;render();};
    document.querySelector('[data-clear-search]')?.addEventListener('click',clearSearch);
    const search=document.getElementById('order-q');
    search.addEventListener('input',event=>{
      clearTimeout(state.searchTimer);
      const value=event.target.value;
      state.searchTimer=setTimeout(()=>{
        if(value.trim()&&!state.filters.q.trim()){
          state.beforeSearchTab=state.filters.tab;
          // A new lookup searches historical orders too, without hidden constraints.
          state.filters={...defaultFilters(),columns:state.filters.columns,sortBy:'paid',sortDir:'desc',tab:'all',q:value};
        }else{state.filters.q=value;if(!value.trim())state.filters.tab=state.beforeSearchTab||'pending';}
        state.page=1;render();
      },220);
    });
    const dialog=document.getElementById('order-filters-dialog');
    document.getElementById('order-more').addEventListener('click',()=>{fillFilterForm(state.filters);dialog.showModal();});
    document.querySelector('[data-filter-close]').addEventListener('click',()=>dialog.close());
    document.querySelector('[data-filter-reset]').addEventListener('click',()=>fillFilterForm(defaultFilters()));
    document.getElementById('order-filter-form').addEventListener('submit',event=>{event.preventDefault();const next=readFilterForm();if(!next)return;dialog.close();state.activePreset='';applyConfig(next);document.getElementById('order-more')?.focus();});
    document.querySelectorAll('[data-date-range]').forEach(button=>button.addEventListener('click',()=>{
      const now=new Date(new Date().toLocaleString('en-US',{timeZone:'Asia/Shanghai'}));
      const fmt=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
      const form=document.getElementById('order-filter-form'),key=button.dataset.dateRange;
      form.elements.dateTo.value=key==='all'?'':fmt(now);
      if(key==='month')now.setDate(1);else if(key!=='all')now.setDate(now.getDate()-Number(key)+1);
      form.elements.dateFrom.value=key==='all'?'':fmt(now);
    }));
    document.querySelectorAll('[data-clear-filter]').forEach(button=>button.addEventListener('click',()=>{
      const key=button.dataset.clearFilter;
      if(key==='dates'){state.filters.dateFrom='';state.filters.dateTo='';}else state.filters[key]=defaultFilters()[key];
      state.page=1;render();
    }));
    document.querySelector('[data-clear-filters]')?.addEventListener('click',()=>{const {tab,q,columns,sortBy,sortDir}=state.filters;state.filters={...defaultFilters(),tab,q,columns,sortBy,sortDir};state.page=1;render();});
    const preset=document.getElementById('order-preset');
    preset.addEventListener('change',()=>{const row=state.presets.find(i=>i.id===preset.value);if(row){dialog.close();state.activePreset=row.id;applyConfig(row.config||{});}});
    document.getElementById('order-preset-save').addEventListener('click',()=>{const next=readFilterForm();if(!next)return;dialog.close();applyConfig(next);openPresetDialog();});
    const presetError=error=>{const e=document.getElementById('order-filter-error');e.hidden=false;e.textContent=error.message;};
    document.getElementById('order-preset-default').addEventListener('click',async()=>{try{await api('/api/erp/v1/orders/query-presets/default',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:state.activePreset})});state.presetMeta.default_id=state.activePreset;dialog.close();render();}catch(e){presetError(e);}});
    document.getElementById('order-preset-delete').addEventListener('click',async()=>{const row=state.presets.find(i=>i.id===state.activePreset);if(!row||!confirm(`删除筛选“${row.name}”？`))return;try{await api(`/api/erp/v1/orders/query-presets/${encodeURIComponent(row.id)}`,{method:'DELETE'});await loadPresets();state.activePreset='';dialog.close();render();}catch(e){presetError(e);}});
    document.getElementById('order-prev')?.addEventListener('click',()=>{state.page=Math.max(1,state.page-1);render();});
    document.getElementById('order-next')?.addEventListener('click',()=>{state.page+=1;render();});
  }
  function render(){
    const focused=document.activeElement, id=focused?.id;
    const selection=id==='order-q'?[focused.selectionStart,focused.selectionEnd]:null;
    const scroll=document.querySelector('.order-view-tabs')?.scrollLeft||0;
    filterGroups();app.innerHTML=`${renderControls()}${renderResults()}`;bindControls();
    const tabs=document.querySelector('.order-view-tabs');if(tabs)tabs.scrollLeft=scroll;
    const target=id?document.getElementById(id):null;
    if(target){target.focus({preventScroll:true});if(selection)target.setSelectionRange(...selection);}
  }
  function openPresetDialog(){const d=document.getElementById('order-preset-dialog');d.querySelector('[name="name"]').value='';d.querySelector('[name="team"]').checked=false;d.querySelector('[name="team"]').closest('label').hidden=!state.presetMeta.can_manage_team;d.querySelector('[name="default"]').checked=false;d.querySelector('[data-error]').hidden=true;d.showModal();}
  function bindPresetDialog(){const d=document.getElementById('order-preset-dialog');d.querySelector('[data-cancel]').addEventListener('click',function(){d.close();});d.querySelector('[data-save]').addEventListener('click',async function(){const name=d.querySelector('[name="name"]').value.trim();const error=d.querySelector('[data-error]');if(!name){error.hidden=false;error.textContent='请填写预设名称';return;}try{await api('/api/erp/v1/orders/query-presets',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:name,scope:d.querySelector('[name="team"]').checked?'team':'personal',set_default:d.querySelector('[name="default"]').checked,config:currentConfig()})});d.close();await loadPresets();render();}catch(exception){error.hidden=false;error.textContent=exception.message;}});}
  async function loadPresets(){const payload=await api('/api/erp/v1/orders/query-presets');state.presets=payload.data?.items||[];state.presetMeta=payload.data||{};}
  async function renderSync(){
    try{
      const status=await api('/api/erp/sync-status');
      // A fresh successful result is the cross-container liveness signal.
      // process_alive only reports processes visible inside the API container.
      const fresh=status.status==='ok'&&status.stale!==true&&Boolean(status.synced_at);
      const ok=fresh;
      const tone=ok?'success':status.status!=='ok'?'danger':status.stale?'warning':'info';
      const label=status.status!=='ok'?`同步异常：${status.status}`:status.stale?'数据可能过期':fresh?'数据更新正常':'等待首次同步';
      syncBar.innerHTML=`<div class="order-sync-status is-${tone}"><i class="ti ti-${ok?'circle-check':'alert-circle'}" aria-hidden="true"></i><span>${escapeHtml(label)}</span><small>最近更新 ${dateTime(status.synced_at)}</small></div>`;
    }catch(_error){
      syncBar.innerHTML='<div class="order-sync-status is-warning">暂时无法读取更新时间</div>';
    }
  }
  async function init(){try{await window.JUN_AUTH_READY;bindPresetDialog();renderSync();const [payload]=await Promise.all([api('/api/erp/orders'),loadPresets().catch(function(){state.presets=[];state.presetMeta={};})]);state.orders=payload.orders||[];state.groups=buildGroups(state.orders);const preset=state.presets.find(function(i){return i.id===state.presetMeta.default_id;});if(preset){state.filters=normalizedConfig(preset.config);state.activePreset=preset.id;}render();}catch(error){app.innerHTML=`<div class="alert alert-danger">处理进度加载失败：${escapeHtml(error.message)}</div>`;}}
  init();
})();
