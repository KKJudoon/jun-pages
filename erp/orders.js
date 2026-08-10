(function () {
  'use strict';

  const app = document.getElementById('erp-app');
  const syncBar = document.getElementById('sync-bar');
  const money = new Intl.NumberFormat('zh-CN', {minimumFractionDigits: 2, maximumFractionDigits: 2});
  const number = new Intl.NumberFormat('zh-CN', {maximumFractionDigits: 2});
  const columns = [
    ['order','订单 / 管家婆单据'],['arranged','管家婆标记'],['items','SKU 商品'],['status','交易与同步状态'],
    ['amount','金额'],['buyer','买家'],['times','时间'],['warehouse','仓库 / 经手人'],['logistics','物流'],
    ['messages','买家留言'],['memo','卖家备注'],['audit','审核异常'],
  ];
  const defaultColumns = columns.map(function (item) { return item[0]; });
  const state = {
    orders: [], groups: [], filtered: [], presets: [], presetMeta: {}, page: 1, pageSize: 100,
    filters: {q:'',source:'pending',arranged:'all',stock:'all',shop:'all',sort:'paid_desc',columns:[...defaultColumns]},
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

  function baseOrderId(value) {
    return String(value || '').replace(/(-\d+)+$/, '');
  }

  function orderGroupKey(order) {
    const tracking = String(order.tracking_no || '').trim();
    if (tracking) return `tracking:${tracking}`;
    const base = baseOrderId(order.id);
    return base && base !== String(order.id || '') ? `split:${base}` : `order:${order.id}`;
  }

  function arranged(order) {
    return order.tag === '已安排' || order.alert === '已安排';
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
      const arrangedCount = records.filter(arranged).length;
      const source = records.some(function(order){return order.source === 'pending';}) ? 'pending' : 'history';
      const shop = [...new Set(records.map(function(order){return order.shop;}).filter(Boolean))].join(' / ');
      const searchable = records.map(function(order){
        return [order.id,order.vchcode,order.shop,order.tag,order.alert,order.trade_status,order.process_status,order.sync_status,order.refund_status,order.tracking_no,order.logistics_company,order.warehouse,order.operator,order.seller_memo,order.buyer_message,order.audit_fail_reason,order.summary,order.buyer?.name,order.buyer?.account,order.buyer?.province,order.buyer?.city].join(' ');
      }).concat(items.map(function(item){return [item.sku,item.sku_full,item.name,item.color,item.size,item.taobao_title,item.taobao_sku_props].join(' ');})).join(' ').toLocaleLowerCase();
      return {
        key:key,records:records,items:items,source:source,shop:shop,searchable:searchable,
        arrangedCount:arrangedCount,arrangedState:arrangedCount === records.length ? 'yes' : arrangedCount ? 'partial' : 'no',
        outOfStock:items.some(function(item){return item.out_of_stock;}) || records.some(function(order){return Boolean(order.audit_fail_reason);}),
        amount:records.reduce(function(sum,order){return sum + Number(order.amount || 0);},0),
        paidAt:records.map(function(order){return order.paid_at || '';}).sort().at(-1) || '',
        deadline:records.map(function(order){return order.deadline || '';}).filter(Boolean).sort().at(0) || '',
        merged:key.startsWith('tracking:') && records.length > 1,
        split:key.startsWith('split:') && records.length > 1,
      };
    });
  }

  function badge(text, tone) {
    return text ? `<span class="order-badge ${tone || ''}">${escapeHtml(text)}</span>` : '';
  }

  function unique(records, field) {
    return [...new Set(records.map(function(row){return row[field];}).filter(Boolean))];
  }

  function renderOrderCell(group) {
    const ids = group.records.map(function(order){return `<span class="order-id">${escapeHtml(order.id)}</span>`;}).join('');
    const docs = unique(group.records,'vchcode').map(function(value){return `<small>管家婆 ${escapeHtml(value)}</small>`;}).join('');
    return `<td class="order-col-order"><div class="order-group-label">${group.merged?badge(`合并发货 · ${group.records.length} 单`,'is-merge'):group.split?badge(`分批记录 · ${group.records.length} 条`,'is-split'):''}${badge(group.shop,'is-shop')}</div><div class="order-ids">${ids}</div>${docs}<small>${escapeHtml(group.records[0]?.summary || '')}</small></td>`;
  }

  function renderArrangedCell(group) {
    const label = group.arrangedState === 'yes' ? '已安排' : group.arrangedState === 'partial' ? `部分已安排 ${group.arrangedCount}/${group.records.length}` : '未安排';
    const tags = [...new Set(group.records.flatMap(function(order){return [order.tag,order.alert];}).filter(Boolean))];
    return `<td>${badge(label,group.arrangedState==='yes'?'is-arranged':group.arrangedState==='partial'?'is-partial':'is-unarranged')}<div class="order-cell-notes">${tags.map(function(value){return escapeHtml(value);}).join(' · ') || '管家婆暂无标记'}</div></td>`;
  }

  function renderItemsCell(group) {
    const items = group.items.map(function(item){
      const image = item.image_url ? `<img src="${escapeHtml(item.image_url)}" loading="lazy" alt="${escapeHtml(item.sku || item.name || '商品')}">` : '<span class="order-image-empty"><i class="ti ti-photo-off"></i></span>';
      const spec = [item.color,item.size,item.taobao_sku_props].filter(Boolean).join(' / ');
      const prices = [`× ${number.format(Number(item.qty || 1))}`,item.unit_price!=null?`单价 ¥${money.format(Number(item.unit_price))}`:'',item.amount!=null?`小计 ¥${money.format(Number(item.amount))}`:'',Number(item.service_fee||0)?`服务费 ¥${money.format(Number(item.service_fee))}`:''].filter(Boolean).join(' · ');
      return `<article class="order-item ${item.out_of_stock?'is-out':''}">${image}<div><div><strong>${escapeHtml(item.sku || item.name || '-')}</strong>${item.out_of_stock?badge('缺货','is-danger'):''}</div><span>${escapeHtml(item.sku_full || item.taobao_sku_code || '')}</span><small>${escapeHtml(spec || item.taobao_title || item.name || '')}</small><small>${escapeHtml(prices)}</small></div></article>`;
    }).join('');
    return `<td class="order-col-items">${items || '<span class="text-secondary">无商品明细</span>'}</td>`;
  }

  function renderStatusCell(group) {
    const statuses = [];
    group.records.forEach(function(order){
      [['trade_status',''],['process_status','is-process'],['sync_status','is-sync'],['refund_status','is-danger']].forEach(function(pair){if(order[pair[0]])statuses.push([order[pair[0]],pair[1]]);});
    });
    const seen = new Set();
    return `<td><div class="order-badges">${statuses.filter(function(item){if(seen.has(item[0]))return false;seen.add(item[0]);return true;}).map(function(item){return badge(item[0],item[1]);}).join('')}</div></td>`;
  }

  function renderAmountCell(group) {
    const freight = group.records.reduce(function(sum,row){return sum+Number(row.freight||0);},0);
    const discount = group.records.reduce(function(sum,row){return sum+Number(row.discount||0);},0);
    return `<td class="order-number"><strong>¥${money.format(group.amount)}</strong><small>运费 ¥${money.format(freight)}</small><small>优惠 ¥${money.format(discount)}</small></td>`;
  }

  function renderBuyerCell(group) {
    const buyers = group.records.map(function(order){return order.buyer || {};});
    const names = [...new Set(buyers.map(function(buyer){return buyer.name || buyer.account;}).filter(Boolean))].join(' / ');
    const accounts = [...new Set(buyers.map(function(buyer){return buyer.account;}).filter(Boolean))].join(' / ');
    const place = [...new Set(buyers.map(function(buyer){return `${buyer.province||''}${buyer.city||''}${buyer.district||''}`;}).filter(Boolean))].join(' / ');
    const phones = [...new Set(buyers.map(function(buyer){return buyer.phone;}).filter(Boolean))].join(' / ');
    return `<td><strong>${escapeHtml(names || '-')}</strong><small>${escapeHtml(accounts)}</small><small>${escapeHtml(place)}</small><small>${escapeHtml(phones)}</small></td>`;
  }

  function renderTimesCell(group) {
    const rows = group.records;
    return `<td><dl class="order-mini-dl"><dt>付款</dt><dd>${dateTime(group.paidAt)}</dd><dt>最迟</dt><dd>${dateTime(group.deadline)}</dd><dt>发货</dt><dd>${dateTime(rows.map(function(row){return row.shipped_at;}).filter(Boolean).sort().at(-1))}</dd><dt>更新</dt><dd>${dateTime(rows.map(function(row){return row.modified_at;}).filter(Boolean).sort().at(-1))}</dd></dl></td>`;
  }

  function renderWarehouseCell(group) {
    return `<td><strong>${escapeHtml(unique(group.records,'warehouse').join(' / ') || '-')}</strong><small>经手：${escapeHtml(unique(group.records,'operator').join(' / ') || '-')}</small></td>`;
  }

  function renderLogisticsCell(group) {
    return `<td><strong>${escapeHtml(unique(group.records,'logistics_company').join(' / ') || '-')}</strong><div class="order-tracking">${unique(group.records,'tracking_no').map(function(value){return `<span>${escapeHtml(value)}</span>`;}).join('') || '<small>暂无物流单号</small>'}</div></td>`;
  }

  function textCell(group, field, className) {
    const values = unique(group.records,field);
    return `<td class="${className || 'order-long-text'}">${values.map(function(value){return `<p>${escapeHtml(value)}</p>`;}).join('') || '<span class="text-secondary">-</span>'}</td>`;
  }

  const cellRenderers = {
    order:renderOrderCell,arranged:renderArrangedCell,items:renderItemsCell,status:renderStatusCell,amount:renderAmountCell,buyer:renderBuyerCell,times:renderTimesCell,warehouse:renderWarehouseCell,logistics:renderLogisticsCell,
    messages:function(group){return textCell(group,'buyer_message','order-long-text');},
    memo:function(group){return textCell(group,'seller_memo','order-long-text');},
    audit:function(group){return textCell(group,'audit_fail_reason','order-long-text order-audit');},
  };

  function filterGroups() {
    const filters = state.filters;
    let rows = state.groups.filter(function(group){
      if (filters.source !== 'all' && group.source !== filters.source) return false;
      if (filters.arranged === 'yes' && group.arrangedState === 'no') return false;
      if (filters.arranged === 'no' && group.arrangedState !== 'no') return false;
      if (filters.stock === 'out' && !group.outOfStock) return false;
      if (filters.stock === 'ready' && group.outOfStock) return false;
      if (filters.shop !== 'all' && !group.records.some(function(order){return order.shop === filters.shop;})) return false;
      return !filters.q || group.searchable.includes(filters.q.toLocaleLowerCase());
    });
    rows.sort(function(left,right){
      if (filters.sort === 'paid_asc') return left.paidAt.localeCompare(right.paidAt);
      if (filters.sort === 'amount_desc') return right.amount-left.amount;
      if (filters.sort === 'amount_asc') return left.amount-right.amount;
      if (filters.sort === 'deadline_asc') return (left.deadline||'9999').localeCompare(right.deadline||'9999');
      if (filters.sort === 'arranged_first') return ({no:0,partial:1,yes:2}[left.arrangedState]-({no:0,partial:1,yes:2}[right.arrangedState])) || right.paidAt.localeCompare(left.paidAt);
      return right.paidAt.localeCompare(left.paidAt);
    });
    state.filtered = rows;
    const maxPage = Math.max(1,Math.ceil(rows.length/state.pageSize));
    state.page = Math.min(state.page,maxPage);
  }

  function currentConfig() {
    return JSON.parse(JSON.stringify(state.filters));
  }

  function applyConfig(config) {
    state.filters = {...state.filters,...config,columns:Array.isArray(config?.columns)&&config.columns.length?config.columns.filter(function(key){return columns.some(function(item){return item[0]===key;});}):[...defaultColumns]};
    state.page = 1;
    render();
  }

  function renderStats() {
    const pending = state.groups.filter(function(group){return group.source==='pending';}).length;
    const arrangedCount = state.groups.filter(function(group){return group.arrangedState!=='no';}).length;
    const stock = state.groups.filter(function(group){return group.outOfStock;}).length;
    const merged = state.groups.filter(function(group){return group.merged||group.split;}).length;
    return `<div class="order-stats"><article><span>待审核订单组</span><strong>${number.format(pending)}</strong></article><article><span>管家婆已安排</span><strong>${number.format(arrangedCount)}</strong></article><article><span>含缺货 / 审核异常</span><strong>${number.format(stock)}</strong></article><article><span>合并发货 / 分批记录</span><strong>${number.format(merged)}</strong></article></div>`;
  }

  function renderControls() {
    const shops = [...new Set(state.orders.map(function(order){return order.shop;}).filter(Boolean))].sort();
    const selectedColumns = new Set(state.filters.columns);
    const presets = state.presets.map(function(preset){return `<option value="${escapeHtml(preset.id)}">${escapeHtml(preset.name)}${preset.scope==='team'?' · 团队':''}</option>`;}).join('');
    return `<section class="order-controls"><div class="order-filter-grid"><label class="order-search"><span>搜索</span><input id="order-q" class="form-control" type="search" placeholder="订单号、SKU、备注、买家、物流" value="${escapeHtml(state.filters.q)}"></label><label><span>订单范围</span><select id="order-source" class="form-select"><option value="pending">待审核</option><option value="history">已发货</option><option value="all">全部</option></select></label><label><span>管家婆标记</span><select id="order-arranged" class="form-select"><option value="all">全部</option><option value="yes">已安排 / 部分安排</option><option value="no">未安排</option></select></label><label><span>库存风险</span><select id="order-stock" class="form-select"><option value="all">全部</option><option value="out">缺货 / 审核异常</option><option value="ready">无缺货标记</option></select></label><label><span>店铺</span><select id="order-shop" class="form-select"><option value="all">全部店铺</option>${shops.map(function(shop){return `<option value="${escapeHtml(shop)}">${escapeHtml(shop)}</option>`;}).join('')}</select></label><label><span>排序</span><select id="order-sort" class="form-select"><option value="paid_desc">付款时间 · 新到旧</option><option value="paid_asc">付款时间 · 旧到新</option><option value="deadline_asc">最迟发货 · 近到远</option><option value="amount_desc">金额 · 高到低</option><option value="amount_asc">金额 · 低到高</option><option value="arranged_first">未安排优先</option></select></label></div><div class="order-preset-row"><label><span>筛选预设</span><select id="order-preset" class="form-select"><option value="">选择预设</option>${presets}</select></label><button class="btn btn-outline-primary" id="order-preset-save"><i class="ti ti-device-floppy me-1"></i>保存当前预设</button><button class="btn btn-outline-secondary" id="order-preset-default" disabled>设为默认</button><button class="btn btn-outline-danger" id="order-preset-delete" disabled>删除</button><details class="order-column-picker"><summary class="btn btn-outline-secondary"><i class="ti ti-columns-3 me-1"></i>显示列 · ${selectedColumns.size}</summary><div>${columns.map(function(item){return `<label><input type="checkbox" value="${escapeHtml(item[0])}" ${selectedColumns.has(item[0])?'checked':''}>${escapeHtml(item[1])}</label>`;}).join('')}</div></details></div></section>`;
  }

  function renderTable() {
    const start = (state.page-1)*state.pageSize;
    const pageRows = state.filtered.slice(start,start+state.pageSize);
    const selected = columns.filter(function(item){return state.filters.columns.includes(item[0]);});
    const table = `<div class="order-table-wrap"><table class="order-table"><thead><tr>${selected.map(function(item){return `<th class="order-col-${escapeHtml(item[0])}">${escapeHtml(item[1])}</th>`;}).join('')}</tr></thead><tbody>${pageRows.map(function(group){return `<tr>${selected.map(function(item){return cellRenderers[item[0]](group);}).join('')}</tr>`;}).join('') || `<tr><td colspan="${selected.length}"><div class="order-empty">没有符合当前筛选的订单</div></td></tr>`}</tbody></table></div>`;
    const pages = Math.max(1,Math.ceil(state.filtered.length/state.pageSize));
    return `<section class="order-results"><header><div><h2>订单审核明细</h2><p>共 ${number.format(state.filtered.length)} 个订单组；同物流单号或同订单分批记录合并为一行。</p></div><strong>第 ${state.page} / ${pages} 页</strong></header>${table}<footer><span>显示 ${state.filtered.length?start+1:0}–${Math.min(start+state.pageSize,state.filtered.length)} / ${state.filtered.length}</span><div><button class="btn btn-sm btn-outline-secondary" id="order-prev" ${state.page<=1?'disabled':''}>上一页</button><button class="btn btn-sm btn-outline-secondary" id="order-next" ${state.page>=pages?'disabled':''}>下一页</button></div></footer></section>`;
  }

  function bindControls() {
    [['order-source','source'],['order-arranged','arranged'],['order-stock','stock'],['order-shop','shop'],['order-sort','sort']].forEach(function(pair){
      const field=document.getElementById(pair[0]);field.value=state.filters[pair[1]];field.addEventListener('change',function(){state.filters[pair[1]]=field.value;state.page=1;render();});
    });
    let timer;
    document.getElementById('order-q').addEventListener('input',function(event){clearTimeout(timer);timer=setTimeout(function(){state.filters.q=event.target.value.trim();state.page=1;render();},180);});
    document.querySelectorAll('.order-column-picker input').forEach(function(input){input.addEventListener('change',function(){const checked=[...document.querySelectorAll('.order-column-picker input:checked')].map(function(item){return item.value;});if(!checked.length){input.checked=true;return;}state.filters.columns=checked;render();});});
    const presetSelect=document.getElementById('order-preset');
    const presetDefault=document.getElementById('order-preset-default');
    const presetDelete=document.getElementById('order-preset-delete');
    presetSelect.addEventListener('change',function(){const preset=state.presets.find(function(item){return item.id===presetSelect.value;});presetDefault.disabled=!preset;presetDelete.disabled=!preset;if(preset)applyConfig(preset.config||{});});
    document.getElementById('order-preset-save').addEventListener('click',openPresetDialog);
    presetDefault.addEventListener('click',async function(){await api('/api/erp/v1/orders/query-presets/default',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:presetSelect.value})});state.presetMeta.default_id=presetSelect.value;render();});
    presetDelete.addEventListener('click',async function(){const preset=state.presets.find(function(item){return item.id===presetSelect.value;});if(!preset||!confirm(`删除预设“${preset.name}”？`))return;await api(`/api/erp/v1/orders/query-presets/${encodeURIComponent(preset.id)}`,{method:'DELETE'});await loadPresets();render();});
    document.getElementById('order-prev')?.addEventListener('click',function(){state.page=Math.max(1,state.page-1);render();});
    document.getElementById('order-next')?.addEventListener('click',function(){state.page+=1;render();});
  }

  function render() {
    filterGroups();
    app.innerHTML = `${renderStats()}${renderControls()}${renderTable()}`;
    bindControls();
  }

  function openPresetDialog() {
    const dialog=document.getElementById('order-preset-dialog');
    dialog.querySelector('[name="name"]').value='';
    dialog.querySelector('[name="team"]').checked=false;
    dialog.querySelector('[name="team"]').closest('label').hidden=!state.presetMeta.can_manage_team;
    dialog.querySelector('[name="default"]').checked=false;
    dialog.querySelector('[data-error]').hidden=true;
    dialog.showModal();
  }

  function bindPresetDialog() {
    const dialog=document.getElementById('order-preset-dialog');
    dialog.querySelector('[data-cancel]').addEventListener('click',function(){dialog.close();});
    dialog.querySelector('[data-save]').addEventListener('click',async function(){
      const name=dialog.querySelector('[name="name"]').value.trim();
      const error=dialog.querySelector('[data-error]');
      if(!name){error.hidden=false;error.textContent='请填写预设名称';return;}
      try {await api('/api/erp/v1/orders/query-presets',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:name,scope:dialog.querySelector('[name="team"]').checked?'team':'personal',set_default:dialog.querySelector('[name="default"]').checked,config:currentConfig()})});dialog.close();await loadPresets();render();}
      catch(exception){error.hidden=false;error.textContent=exception.message;}
    });
  }

  async function loadPresets() {
    const payload=await api('/api/erp/v1/orders/query-presets');
    state.presets=payload.data?.items||[];
    state.presetMeta=payload.data||{};
  }

  async function renderSync() {
    try {
      const status=await api('/api/erp/sync-status');
      const ok=status.process_alive&&!status.stale&&status.status==='ok';
      const tone=ok?'success':!status.process_alive?'danger':'warning';
      const label=!status.process_alive?'同步进程未运行':status.stale?'数据可能过期':status.status==='ok'?'运行中':`同步异常：${status.status}`;
      syncBar.innerHTML=`<div class="alert alert-${tone} d-flex align-items-center py-2"><i class="ti ti-${ok?'circle-check':'alert-circle'} me-2"></i><div><strong>ERP 同步 ${escapeHtml(label)}</strong><span class="ms-2">最近拉取 ${escapeHtml(status.synced_at||'从未')}</span><span class="ms-2">待审核 ${number.format(status.pending_count||0)} / 历史 ${number.format(status.history_count||0)}</span></div></div>`;
    } catch (_error) { syncBar.innerHTML='<div class="alert alert-secondary py-2">同步状态获取失败</div>'; }
  }

  async function init() {
    try {
      await window.JUN_AUTH_READY;
      bindPresetDialog();
      await Promise.all([renderSync(),loadPresets()]);
      const payload=await api('/api/erp/orders');
      state.orders=payload.orders||[];
      state.groups=buildGroups(state.orders);
      const defaultPreset=state.presets.find(function(item){return item.id===state.presetMeta.default_id;});
      if(defaultPreset)state.filters={...state.filters,...defaultPreset.config,columns:Array.isArray(defaultPreset.config?.columns)&&defaultPreset.config.columns.length?defaultPreset.config.columns:[...defaultColumns]};
      render();
    } catch(error) { app.innerHTML=`<div class="alert alert-danger">订单审核加载失败：${escapeHtml(error.message)}</div>`; }
  }

  init();
})();
