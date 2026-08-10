(function () {
  'use strict';

  const app = document.getElementById('erp-app');
  const syncBar = document.getElementById('sync-bar');
  const money = new Intl.NumberFormat('zh-CN', {minimumFractionDigits: 2, maximumFractionDigits: 2});
  const number = new Intl.NumberFormat('zh-CN', {maximumFractionDigits: 2});
  const columns = [
    ['workflow','处理进度'],['order','订单 / 管家婆单据'],['arranged','管家婆安排'],['items','SKU 商品'],
    ['promise','备注约定发货'],['platform','淘宝最迟发货'],['status','平台与系统状态'],['amount','金额'],
    ['memo','卖家备注'],['buyer','买家'],['logistics','物流'],['times','其他时间'],['audit','审核异常'],
  ];
  const defaultColumns = ['workflow','order','items','promise','platform','amount'];
  const state = {
    orders: [], groups: [], filtered: [], presets: [], presetMeta: {}, page: 1,
    pageSize: window.matchMedia('(max-width: 760px)').matches ? 24 : 50,
    filters: {q:'',orderState:'active',stage:'actionable',stock:'all',shop:'all',sortBy:'promise',sortDir:'asc',columns:[...defaultColumns]},
  };

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (character) {
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character];
    });
  }

  async function api(path, options) {
    const response = await fetch(path, options);
    const payload = await response.json().catch(function(){return {};});
    if (!response.ok) throw new Error(payload.detail || payload.error || `HTTP ${response.status}`);
    return payload;
  }

  function dateTime(value) {
    if (!value) return '-';
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
  function isRefund(order) { return order.trade_status === '退款中' || Boolean(String(order.refund_status || '').trim()); }

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
      const items = records.flatMap(function(order){return order.items || [];});
      const arrangedCount = records.filter(isArranged).length;
      const shippedCount = records.filter(isShipped).length;
      const closedCount = records.filter(isClosed).length;
      const refundCount = records.filter(isRefund).length;
      const paidAt = records.map(function(order){return order.paid_at || '';}).filter(Boolean).sort().at(-1) || '';
      const promises = records.map(function(order){return remarkShipTime(order.seller_memo, order.paid_at || paidAt);});
      let workflowStage = 'unarranged';
      if (closedCount === records.length) workflowStage = 'closed';
      else if (shippedCount === records.length) workflowStage = 'shipped';
      else if (shippedCount) workflowStage = 'partial';
      else if (arrangedCount) workflowStage = 'arranged';
      const searchable = records.map(function(order){
        return [order.id,order.vchcode,order.shop,order.tag,order.alert,order.trade_status,order.process_status,order.sync_status,order.refund_status,order.tracking_no,order.logistics_company,order.warehouse,order.operator,order.seller_memo,order.buyer_message,order.audit_fail_reason,order.summary,order.buyer?.name,order.buyer?.account,order.buyer?.province,order.buyer?.city].join(' ');
      }).concat(items.map(function(item){return [item.sku,item.sku_full,item.name,item.color,item.size,item.taobao_title,item.taobao_sku_props].join(' ');})).join(' ').toLocaleLowerCase();
      return {
        key:key, records:records, items:items, searchable:searchable, workflowStage:workflowStage,
        arrangedCount:arrangedCount, shippedCount:shippedCount, closedCount:closedCount, refundCount:refundCount,
        hasRefund:refundCount > 0, allClosed:closedCount === records.length,
        arrangedState:arrangedCount === records.length ? 'yes' : arrangedCount ? 'partial' : 'no',
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
  function workflowLabel(group) {
    const labels = {unarranged:'待安排',arranged:'已安排待发货',partial:`部分已发货 ${group.shippedCount}/${group.records.length}`,shipped:'已发货',closed:'交易关闭'};
    return labels[group.workflowStage] || group.workflowStage;
  }
  function workflowTone(group) { return `is-workflow-${group.workflowStage}`; }
  function exceptionBadges(group) {
    const refund = group.hasRefund ? badge(group.refundCount === group.records.length ? '退款 / 售后' : '含退款记录','is-danger') : '';
    const closed = group.closedCount ? badge(group.allClosed ? '交易关闭' : '含关闭记录','is-closed') : '';
    return refund + closed;
  }

  function orderIdentity(group, cell) {
    const tag = cell || 'div';
    const ids = group.records.map(function(order){return `<span class="order-id">${escapeHtml(order.id)}</span>`;}).join('');
    const docs = unique(group.records,'vchcode').map(function(value){return `<small>管家婆 ${escapeHtml(value)}</small>`;}).join('');
    return `<${tag} class="order-col-order"><div class="order-group-label">${group.merged?badge(`合并发货 · ${group.records.length} 单`,'is-merge'):group.split?badge(`分批记录 · ${group.records.length} 条`,'is-split'):''}${badge(group.shop,'is-shop')}</div><div class="order-ids">${ids}</div>${docs}<small>${escapeHtml(group.records[0]?.summary || '')}</small></${tag}>`;
  }
  function renderOrderCell(group) { return orderIdentity(group,'td'); }
  function renderWorkflowCell(group) { return `<td>${badge(workflowLabel(group),workflowTone(group))}<small>${group.workflowStage==='arranged'?'已进入管家婆安排，尚无实际发货记录':group.workflowStage==='unarranged'?'管家婆尚未标记已安排':''}</small></td>`; }
  function renderArrangedCell(group) {
    const label = group.arrangedState === 'yes' ? '已安排' : group.arrangedState === 'partial' ? `部分已安排 ${group.arrangedCount}/${group.records.length}` : '未安排';
    return `<td>${badge(label,group.arrangedState==='yes'?'is-arranged':group.arrangedState==='partial'?'is-partial':'is-unarranged')}<div class="order-cell-notes">${unique(group.records,'tag').concat(unique(group.records,'alert')).filter(function(value,index,array){return array.indexOf(value)===index;}).map(escapeHtml).join(' · ') || '管家婆暂无标记'}</div></td>`;
  }
  function itemsMarkup(group) {
    return group.items.map(function(item){
      const image = item.image_url ? `<img src="${escapeHtml(item.image_url)}" loading="lazy" alt="${escapeHtml(item.sku || item.name || '商品')}">` : '<span class="order-image-empty"><i class="ti ti-photo-off"></i></span>';
      const spec = [item.color,item.size,item.taobao_sku_props].filter(Boolean).join(' / ');
      const prices = [`× ${number.format(Number(item.qty || 1))}`,item.unit_price!=null?`单价 ¥${money.format(Number(item.unit_price))}`:'',item.amount!=null?`小计 ¥${money.format(Number(item.amount))}`:''].filter(Boolean).join(' · ');
      return `<article class="order-item ${item.out_of_stock?'is-out':''}">${image}<div><div><strong>${escapeHtml(item.sku || item.name || '-')}</strong>${item.out_of_stock?badge('缺货','is-danger'):''}</div><span>${escapeHtml(item.sku_full || item.taobao_sku_code || '')}</span><small>${escapeHtml(spec || item.taobao_title || item.name || '')}</small><small>${escapeHtml(prices)}</small></div></article>`;
    }).join('') || '<span class="text-secondary">无商品明细</span>';
  }
  function renderItemsCell(group) { return `<td class="order-col-items">${itemsMarkup(group)}</td>`; }
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
    workflow:renderWorkflowCell,order:renderOrderCell,arranged:renderArrangedCell,items:renderItemsCell,promise:renderPromiseCell,platform:renderPlatformCell,status:renderStatusCell,amount:renderAmountCell,buyer:renderBuyerCell,logistics:renderLogisticsCell,times:renderTimesCell,
    memo:function(group){return textCell(group,'seller_memo','order-long-text');},audit:function(group){return textCell(group,'audit_fail_reason','order-long-text order-audit');},
  };

  function filterGroups() {
    const f=state.filters;
    let rows=state.groups.filter(function(group){
      if (f.orderState==='active' && (group.hasRefund || group.allClosed)) return false;
      if (f.orderState==='refund' && !group.hasRefund) return false;
      if (f.orderState==='closed' && !group.allClosed) return false;
      if (f.stage==='actionable' && ['shipped','closed'].includes(group.workflowStage)) return false;
      if (!['all','actionable'].includes(f.stage) && group.workflowStage!==f.stage) return false;
      if (f.stock==='out'&&!group.outOfStock) return false;
      if (f.stock==='ready'&&group.outOfStock) return false;
      if (f.shop!=='all'&&!group.records.some(function(order){return order.shop===f.shop;})) return false;
      return !f.q||group.searchable.includes(f.q.toLocaleLowerCase());
    });
    rows.sort(function(a,b){
      const workflowOrder={unarranged:0,partial:1,arranged:2,shipped:3,closed:4};
      const values=function(group){
        if(f.sortBy==='amount')return {value:group.amount,missing:false,numeric:true};
        if(f.sortBy==='workflow')return {value:workflowOrder[group.workflowStage],missing:false,numeric:true};
        if(f.sortBy==='paid')return {value:group.paidAt,missing:!group.paidAt};
        if(f.sortBy==='deadline')return {value:group.deadline,missing:!group.deadline};
        return {value:group.promise.label==='未识别'||group.promise.label==='格式异常'?'':group.promise.sort,missing:group.promise.label==='未识别'||group.promise.label==='格式异常'};
      };
      const av=values(a);const bv=values(b);
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
    const next={...(config||{})};
    if(!next.stage&&next.source)next.stage=next.source==='all'?'all':next.source==='history'?'shipped':'actionable';
    if(next.sort){
      const legacy={promise_asc:['promise','asc'],deadline_asc:['deadline','asc'],workflow:['workflow','asc'],paid_desc:['paid','desc'],paid_asc:['paid','asc'],amount_desc:['amount','desc']}[next.sort];
      if(legacy){next.sortBy=legacy[0];next.sortDir=legacy[1];}
    }
    if(next.stage==='closed'){next.orderState='closed';next.stage='all';}
    if(!['active','refund','closed','all'].includes(next.orderState))next.orderState='active';
    if(!['promise','deadline','workflow','paid','amount'].includes(next.sortBy))next.sortBy='promise';
    if(!['asc','desc'].includes(next.sortDir))next.sortDir='asc';
    if(next.orderState!=='active'&&next.stage==='actionable')next.stage='all';
    delete next.source;delete next.arranged;delete next.sort;
    next.columns=Array.isArray(next.columns)&&next.columns.length?next.columns.filter(function(key){return columns.some(function(item){return item[0]===key;});}):[...defaultColumns];
    return next;
  }
  function applyConfig(config){state.filters={...state.filters,...normalizedConfig(config)};state.page=1;render();}

  function renderStats(){
    const active=state.groups.filter(function(g){return !g.hasRefund&&!g.allClosed;});
    const actionable=active.filter(function(g){return !['shipped','closed'].includes(g.workflowStage);}).length;
    const unarranged=active.filter(function(g){return g.workflowStage==='unarranged';}).length;
    const risk=active.filter(function(g){return g.outOfStock&&!['shipped','closed'].includes(g.workflowStage);}).length;
    const excluded=state.groups.filter(function(g){return g.hasRefund||g.allClosed;}).length;
    return `<div class="order-stats"><article><span>正常订单待处理</span><strong>${number.format(actionable)}</strong></article><article><span>正常订单待安排</span><strong>${number.format(unarranged)}</strong></article><article><span>待处理中的缺货 / 异常</span><strong>${number.format(risk)}</strong></article><article><span>售后 / 关闭（默认隐藏）</span><strong>${number.format(excluded)}</strong></article></div>`;
  }
  function renderControls(){
    const shops=[...new Set(state.orders.map(function(order){return order.shop;}).filter(Boolean))].sort();
    const selected=new Set(state.filters.columns);
    const presets=state.presets.map(function(p){return `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}${p.scope==='team'?' · 团队':''}</option>`;}).join('');
    return `<section class="order-controls"><div class="order-filter-grid"><label class="order-search"><span>搜索</span><input id="order-q" class="form-control" type="search" placeholder="订单号、SKU、备注、买家、物流" value="${escapeHtml(state.filters.q)}"></label><label><span>订单范围</span><select id="order-state" class="form-select"><option value="active">正常订单（默认）</option><option value="refund">退款 / 售后</option><option value="closed">交易关闭 / ERP 删除</option><option value="all">全部订单</option></select></label><label><span>处理进度</span><select id="order-stage" class="form-select"><option value="actionable">待处理（未全部发货）</option><option value="unarranged">待安排</option><option value="arranged">已安排待发货</option><option value="partial">部分已发货</option><option value="shipped">已发货</option><option value="all">全部进度</option></select></label><label><span>库存风险</span><select id="order-stock" class="form-select"><option value="all">全部</option><option value="out">缺货 / 审核异常</option><option value="ready">无缺货标记</option></select></label><label><span>店铺</span><select id="order-shop" class="form-select"><option value="all">全部店铺</option>${shops.map(function(shop){return `<option value="${escapeHtml(shop)}">${escapeHtml(shop)}</option>`;}).join('')}</select></label><label><span>排序</span><div class="order-sort-control"><select id="order-sort-by" class="form-select"><option value="promise">备注约定发货</option><option value="deadline">淘宝最迟发货</option><option value="workflow">处理优先级</option><option value="paid">付款时间</option><option value="amount">订单金额</option></select><button type="button" class="btn btn-outline-secondary" id="order-sort-dir" aria-label="切换排序方向"><i class="ti ti-sort-${state.filters.sortDir==='asc'?'ascending':'descending'}"></i><span>${state.filters.sortDir==='asc'?'升序':'降序'}</span></button></div></label></div><details class="order-truth-note"><summary><i class="ti ti-info-circle"></i><span>字段口径说明</span></summary><p>“已安排”只表示管家婆已安排；当前数据没有独立的“生产完成”字段，页面不会自行推断。备注日期与淘宝平台时限分开显示。</p></details><div class="order-preset-row"><label><span>筛选预设</span><select id="order-preset" class="form-select"><option value="">选择预设</option>${presets}</select></label><button class="btn btn-outline-primary" id="order-preset-save">保存当前预设</button><button class="btn btn-outline-secondary" id="order-preset-default" disabled>设为默认</button><button class="btn btn-outline-danger" id="order-preset-delete" disabled>删除</button><details class="order-column-picker"><summary class="btn btn-outline-secondary">显示列 · ${selected.size}</summary><div>${columns.map(function(item){return `<label><input type="checkbox" value="${escapeHtml(item[0])}" ${selected.has(item[0])?'checked':''}>${escapeHtml(item[1])}</label>`;}).join('')}</div></details></div></section>`;
  }
  function renderCards(rows){
    return `<div class="order-card-list">${rows.map(function(group){
      return `<article class="order-card"><header><div>${badge(workflowLabel(group),workflowTone(group))}${exceptionBadges(group)}</div><strong>¥${money.format(group.amount)}</strong></header>${orderIdentity(group,'div')}<div class="order-card-dates"><div><span>备注约定发货</span><strong>${escapeHtml(group.promise.label)}</strong></div><div><span>淘宝最迟发货</span><strong>${dateTime(group.deadline)}</strong></div></div><section class="order-card-items">${itemsMarkup(group)}</section><details><summary>状态、备注、物流和买家</summary>${statusMarkup(group)}${unique(group.records,'seller_memo').length?`<div class="order-card-memo"><span>卖家备注</span>${unique(group.records,'seller_memo').map(function(v){return `<p>${escapeHtml(v)}</p>`;}).join('')}</div>`:''}<dl><dt>管家婆安排</dt><dd>${group.arrangedState==='no'?'未安排':group.arrangedState==='partial'?'部分安排':'已安排'}</dd><dt>物流</dt><dd>${escapeHtml(unique(group.records,'logistics_company').join(' / ')||'暂无')} ${escapeHtml(unique(group.records,'tracking_no').join(' / '))}</dd><dt>买家</dt><dd>${escapeHtml(group.records[0]?.buyer?.name||group.records[0]?.buyer?.account||'-')}</dd><dt>付款</dt><dd>${dateTime(group.paidAt)}</dd><dt>实际发货</dt><dd>${dateTime(group.records.map(function(r){return r.shipped_at;}).filter(Boolean).sort().at(-1))}</dd><dt>审核异常</dt><dd>${escapeHtml(unique(group.records,'audit_fail_reason').join(' / ')||'无')}</dd></dl></details></article>`;
    }).join('')||'<div class="order-empty">没有符合当前筛选的订单</div>'}</div>`;
  }
  function renderResults(){
    const start=(state.page-1)*state.pageSize;const rows=state.filtered.slice(start,start+state.pageSize);const selected=columns.filter(function(item){return state.filters.columns.includes(item[0]);});
    const table=`<div class="order-table-wrap"><table class="order-table"><thead><tr>${selected.map(function(item){return `<th class="order-col-${escapeHtml(item[0])}">${escapeHtml(item[1])}</th>`;}).join('')}</tr></thead><tbody>${rows.map(function(group){return `<tr>${selected.map(function(item){return cellRenderers[item[0]](group);}).join('')}</tr>`;}).join('')||`<tr><td colspan="${selected.length}"><div class="order-empty">没有符合当前筛选的订单</div></td></tr>`}</tbody></table></div>`;
    const pages=Math.max(1,Math.ceil(state.filtered.length/state.pageSize));
    return `<section class="order-results"><header><div><h2>订单处理清单</h2><p>共 ${number.format(state.filtered.length)} 个订单组；退款和关闭订单默认隐藏，可在“订单范围”中查看。</p></div><strong>第 ${state.page} / ${pages} 页</strong></header>${table}${renderCards(rows)}<footer><span>显示 ${state.filtered.length?start+1:0}–${Math.min(start+state.pageSize,state.filtered.length)} / ${state.filtered.length}</span><div><button class="btn btn-sm btn-outline-secondary" id="order-prev" ${state.page<=1?'disabled':''}>上一页</button><button class="btn btn-sm btn-outline-secondary" id="order-next" ${state.page>=pages?'disabled':''}>下一页</button></div></footer></section>`;
  }
  function bindControls(){
    [['order-stage','stage'],['order-stock','stock'],['order-shop','shop'],['order-sort-by','sortBy']].forEach(function(pair){const field=document.getElementById(pair[0]);field.value=state.filters[pair[1]];field.addEventListener('change',function(){state.filters[pair[1]]=field.value;state.page=1;render();});});
    const orderState=document.getElementById('order-state');orderState.value=state.filters.orderState;orderState.addEventListener('change',function(){state.filters.orderState=orderState.value;if(orderState.value!=='active'&&state.filters.stage==='actionable')state.filters.stage='all';state.page=1;render();});
    document.getElementById('order-sort-dir').addEventListener('click',function(){state.filters.sortDir=state.filters.sortDir==='asc'?'desc':'asc';state.page=1;render();});
    let timer;document.getElementById('order-q').addEventListener('input',function(event){clearTimeout(timer);timer=setTimeout(function(){state.filters.q=event.target.value.trim();state.page=1;render();},180);});
    document.querySelectorAll('.order-column-picker input').forEach(function(input){input.addEventListener('change',function(){const checked=[...document.querySelectorAll('.order-column-picker input:checked')].map(function(i){return i.value;});if(!checked.length){input.checked=true;return;}state.filters.columns=checked;render();});});
    const preset=document.getElementById('order-preset');const presetDefault=document.getElementById('order-preset-default');const presetDelete=document.getElementById('order-preset-delete');
    preset.addEventListener('change',function(){const row=state.presets.find(function(i){return i.id===preset.value;});presetDefault.disabled=!row;presetDelete.disabled=!row;if(row)applyConfig(row.config||{});});
    document.getElementById('order-preset-save').addEventListener('click',openPresetDialog);
    presetDefault.addEventListener('click',async function(){await api('/api/erp/v1/orders/query-presets/default',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:preset.value})});state.presetMeta.default_id=preset.value;render();});
    presetDelete.addEventListener('click',async function(){const row=state.presets.find(function(i){return i.id===preset.value;});if(!row||!confirm(`删除预设“${row.name}”？`))return;await api(`/api/erp/v1/orders/query-presets/${encodeURIComponent(row.id)}`,{method:'DELETE'});await loadPresets();render();});
    document.getElementById('order-prev')?.addEventListener('click',function(){state.page=Math.max(1,state.page-1);render();});document.getElementById('order-next')?.addEventListener('click',function(){state.page+=1;render();});
  }
  function render(){filterGroups();app.innerHTML=`${renderStats()}${renderControls()}${renderResults()}`;bindControls();}
  function openPresetDialog(){const d=document.getElementById('order-preset-dialog');d.querySelector('[name="name"]').value='';d.querySelector('[name="team"]').checked=false;d.querySelector('[name="team"]').closest('label').hidden=!state.presetMeta.can_manage_team;d.querySelector('[name="default"]').checked=false;d.querySelector('[data-error]').hidden=true;d.showModal();}
  function bindPresetDialog(){const d=document.getElementById('order-preset-dialog');d.querySelector('[data-cancel]').addEventListener('click',function(){d.close();});d.querySelector('[data-save]').addEventListener('click',async function(){const name=d.querySelector('[name="name"]').value.trim();const error=d.querySelector('[data-error]');if(!name){error.hidden=false;error.textContent='请填写预设名称';return;}try{await api('/api/erp/v1/orders/query-presets',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:name,scope:d.querySelector('[name="team"]').checked?'team':'personal',set_default:d.querySelector('[name="default"]').checked,config:currentConfig()})});d.close();await loadPresets();render();}catch(exception){error.hidden=false;error.textContent=exception.message;}});}
  async function loadPresets(){const payload=await api('/api/erp/v1/orders/query-presets');state.presets=payload.data?.items||[];state.presetMeta=payload.data||{};}
  async function renderSync(){try{const status=await api('/api/erp/sync-status');const ok=status.process_alive&&!status.stale&&status.status==='ok';const tone=ok?'success':!status.process_alive?'danger':'warning';const label=!status.process_alive?'同步进程未运行':status.stale?'数据可能过期':status.status==='ok'?'运行中':`同步异常：${status.status}`;syncBar.innerHTML=`<div class="alert alert-${tone} d-flex align-items-center py-2"><i class="ti ti-${ok?'circle-check':'alert-circle'} me-2"></i><div><strong>ERP 同步 ${escapeHtml(label)}</strong><span class="ms-2">最近拉取 ${escapeHtml(status.synced_at||'从未')}</span></div></div>`;}catch(_error){syncBar.innerHTML='<div class="alert alert-secondary py-2">同步状态获取失败</div>';}}
  async function init(){try{await window.JUN_AUTH_READY;bindPresetDialog();await Promise.all([renderSync(),loadPresets()]);const payload=await api('/api/erp/orders');state.orders=payload.orders||[];state.groups=buildGroups(state.orders);const preset=state.presets.find(function(i){return i.id===state.presetMeta.default_id;});if(preset)state.filters={...state.filters,...normalizedConfig(preset.config)};render();}catch(error){app.innerHTML=`<div class="alert alert-danger">订单审核加载失败：${escapeHtml(error.message)}</div>`;}}
  init();
})();
