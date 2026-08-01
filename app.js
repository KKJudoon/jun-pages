import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.111.0/+esm';

const config = window.JUN_CONFIG || {};
const supabase = createClient(config.supabaseUrl, config.supabasePublishableKey);

const PRODUCT_PAGE_SIZE = 30;
const INVENTORY_PAGE_SIZE = 50;
const SKU_DETAIL_LIMIT = 250;
const VIEW_META = {
  overview: {eyebrow: 'OVERVIEW', title: '经营数据总览'},
  products: {eyebrow: 'PRODUCT CATALOG', title: '商品与 SKU 档案', permission: 'products.read'},
  inventory: {eyebrow: 'INVENTORY', title: '当前库存查询', permission: 'inventory.read'},
  orders: {eyebrow: 'ORDERS', title: '订单审核', permission: 'orders.read'},
  operations: {eyebrow: 'OPERATIONS', title: '运营数据', permission: 'operations.overview.read'}
};
const ROLE_LABELS = {
  admin: '管理员',
  operations: '运营',
  warehouse: '仓库',
  readonly: '只读'
};
const DATASET_LABELS = {
  products: '商品档案',
  skus: 'SKU 档案',
  inventory: '当前库存'
};

const loginView = document.getElementById('login-view');
const workspaceView = document.getElementById('workspace-view');
const loginForm = document.getElementById('login-form');
const loginMessage = document.getElementById('login-message');
const accountName = document.getElementById('account-name');
const accountRole = document.getElementById('account-role');
const viewEyebrow = document.getElementById('view-eyebrow');
const viewTitle = document.getElementById('view-title');
const viewMessage = document.getElementById('view-message');

const productState = {page: 0, total: 0, query: '', generation: 0, loaded: false};
const inventoryState = {page: 0, total: 0, query: '', warehouseId: '', generation: 0, loaded: false};
let skuGeneration = 0;
let overviewGeneration = 0;
let currentProfile = null;
let allowedPermissions = new Set();
let activeView = 'overview';
let activeUserId = null;
let hydrationPromise = null;
let authGeneration = 0;
let warehousePromise = null;

function showMessage(message = '') {
  loginMessage.textContent = message;
}

function setViewMessage(message = '') {
  viewMessage.textContent = message;
  viewMessage.classList.toggle('is-hidden', !message);
}

function showWorkspace(user) {
  loginView.classList.add('is-hidden');
  workspaceView.classList.remove('is-hidden');
  accountName.textContent = user?.email?.split('@')[0] || '';
  accountRole.textContent = '权限配置中';
  document.querySelectorAll('[data-permission]').forEach(item => item.classList.add('is-hidden'));
}

function showLogin() {
  authGeneration += 1;
  activeUserId = null;
  currentProfile = null;
  allowedPermissions = new Set();
  loginForm.reset();
  workspaceView.classList.add('is-hidden');
  loginView.classList.remove('is-hidden');
  accountName.textContent = '';
  accountRole.textContent = '权限读取中';
  setViewMessage('');
  document.querySelectorAll('[data-permission]').forEach(item => item.classList.add('is-hidden'));
}

async function denyAccess(message) {
  await supabase.auth.signOut();
  showLogin();
  showMessage(message);
}

function authEmailForAccount(account) {
  const normalized = account.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{1,31}$/.test(normalized)) return null;
  return `${normalized}@auth.jun.internal`;
}

function configureNavigation() {
  document.querySelectorAll('[data-permission]').forEach(item => {
    item.classList.toggle('is-hidden', !allowedPermissions.has(item.dataset.permission));
  });
  document.querySelectorAll('[data-open-view]').forEach(item => {
    const required = VIEW_META[item.dataset.openView]?.permission;
    item.classList.toggle('is-hidden', required && !allowedPermissions.has(required));
  });
}

async function hydrateSession(user) {
  if (hydrationPromise && activeUserId === user.id) return hydrationPromise;

  activeUserId = user.id;
  const generation = ++authGeneration;
  showWorkspace(user);

  hydrationPromise = (async () => {
    const {data: profile, error: profileError} = await supabase
      .from('profiles')
      .select('username, role, display_name, disabled')
      .eq('id', user.id)
      .maybeSingle();

    if (generation !== authGeneration) return;
    if (profileError || !profile) {
      await denyAccess('该账号尚未配置权限，请联系管理员。');
      return;
    }
    if (profile.disabled) {
      await denyAccess('该账号已停用，请联系管理员。');
      return;
    }

    const {data: permissionRows, error: permissionError} = await supabase
      .from('my_permissions')
      .select('permission_key');

    if (generation !== authGeneration) return;
    if (permissionError) {
      await denyAccess('权限读取失败，请稍后重试。');
      return;
    }

    currentProfile = profile;
    allowedPermissions = new Set(permissionRows.map(row => row.permission_key));
    accountName.textContent = profile.display_name || profile.username;
    accountRole.textContent = ROLE_LABELS[profile.role] || '未定义角色';
    configureNavigation();
    activateView('overview', {force: true});
  })().finally(() => {
    if (generation === authGeneration) hydrationPromise = null;
  });

  return hydrationPromise;
}

function canOpenView(view) {
  const required = VIEW_META[view]?.permission;
  return !required || allowedPermissions.has(required);
}

function activateView(view, {force = false} = {}) {
  if (!VIEW_META[view] || !canOpenView(view)) return;
  activeView = view;
  setViewMessage('');

  document.querySelectorAll('.nav-item[data-view]').forEach(item => {
    item.classList.toggle('active', item.dataset.view === view);
  });
  document.querySelectorAll('[data-panel]').forEach(panel => {
    panel.classList.toggle('is-hidden', panel.dataset.panel !== view);
  });

  viewEyebrow.textContent = VIEW_META[view].eyebrow;
  viewTitle.textContent = VIEW_META[view].title;

  if (view === 'overview') loadOverview(force);
  if (view === 'products' && (force || !productState.loaded)) loadProducts();
  if (view === 'inventory') {
    ensureWarehouseOptions(force);
    if (force || !inventoryState.loaded) loadInventory();
  }
}

function formatInteger(value) {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat('zh-CN', {maximumFractionDigits: 0}).format(value);
}

function formatQuantity(value) {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat('zh-CN', {maximumFractionDigits: 3}).format(Number(value));
}

function formatCurrency(value) {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: 'CNY',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  }).format(Number(value));
}

function formatDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(date);
}

function normalizeSearchTerm(value) {
  return value
    .trim()
    .slice(0, 64)
    .replace(/[^\p{L}\p{N}\s._\-/]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function clearNode(node) {
  node.replaceChildren();
}

function createCell(text = '', className = '') {
  const cell = document.createElement('td');
  if (className) cell.className = className;
  cell.textContent = text;
  return cell;
}

function renderTableMessage(body, columnCount, message, className = 'loading-row') {
  clearNode(body);
  const row = document.createElement('tr');
  row.className = className;
  const cell = document.createElement('td');
  cell.colSpan = columnCount;
  cell.textContent = message;
  row.append(cell);
  body.append(row);
}

function createImage(url, alt) {
  if (!url || !/^https:\/\//i.test(url)) {
    const placeholder = document.createElement('span');
    placeholder.className = 'product-thumb-placeholder';
    placeholder.textContent = '暂无图';
    return placeholder;
  }
  const image = document.createElement('img');
  image.className = 'product-thumb';
  image.src = url;
  image.alt = alt;
  image.loading = 'lazy';
  image.referrerPolicy = 'no-referrer';
  image.addEventListener('error', () => {
    const placeholder = document.createElement('span');
    placeholder.className = 'product-thumb-placeholder';
    placeholder.textContent = '暂无图';
    image.replaceWith(placeholder);
  }, {once: true});
  return image;
}

function createProductCell({imageUrl, title, subtitle}) {
  const cell = document.createElement('td');
  const wrapper = document.createElement('div');
  wrapper.className = 'product-cell';
  wrapper.append(createImage(imageUrl, ''));

  const copy = document.createElement('div');
  const titleNode = document.createElement('span');
  titleNode.className = 'cell-title';
  titleNode.textContent = title || '未命名商品';
  titleNode.title = title || '';
  const subtitleNode = document.createElement('span');
  subtitleNode.className = 'cell-subtitle';
  subtitleNode.textContent = subtitle || '';
  subtitleNode.title = subtitle || '';
  copy.append(titleNode, subtitleNode);
  wrapper.append(copy);
  cell.append(wrapper);
  return cell;
}

function createStateCell(value, positive = false) {
  const cell = document.createElement('td');
  const pill = document.createElement('span');
  pill.className = `state-pill${positive ? ' positive' : ''}`;
  pill.textContent = value || '—';
  cell.append(pill);
  return cell;
}

async function countView(view) {
  const {count, error} = await supabase.from(view).select('*', {count: 'exact', head: true});
  if (error) throw error;
  return count || 0;
}

async function fetchWarehouses({force = false} = {}) {
  if (force) warehousePromise = null;
  if (warehousePromise) return warehousePromise;

  warehousePromise = (async () => {
    const warehouses = new Map();
    const batchSize = 1000;
    let offset = 0;

    while (offset < 10000) {
      const {data, error} = await supabase
        .from('inventory_current')
        .select('warehouse_id, warehouse_name')
        .order('warehouse_id', {ascending: true})
        .range(offset, offset + batchSize - 1);
      if (error) throw error;
      data.forEach(row => warehouses.set(row.warehouse_id, row.warehouse_name));
      if (data.length < batchSize) break;
      offset += batchSize;
    }

    return [...warehouses.entries()]
      .map(([id, name]) => ({id, name}))
      .sort((left, right) => left.name.localeCompare(right.name, 'zh-CN'));
  })().catch(error => {
    warehousePromise = null;
    throw error;
  });

  return warehousePromise;
}

function renderSyncStatus(rows) {
  const list = document.getElementById('sync-list');
  clearNode(list);

  if (currentProfile?.role !== 'admin') {
    const message = document.createElement('p');
    message.className = 'muted-text';
    message.textContent = '数据可正常查询；详细同步状态仅管理员可见。';
    list.append(message);
    return;
  }

  if (!rows.length) {
    const message = document.createElement('p');
    message.className = 'muted-text';
    message.textContent = '暂未读取到同步记录。';
    list.append(message);
    return;
  }

  rows.forEach(item => {
    const row = document.createElement('div');
    row.className = 'sync-row';
    const name = document.createElement('span');
    name.className = 'sync-dataset';
    name.textContent = DATASET_LABELS[item.dataset] || item.dataset;
    const meta = document.createElement('span');
    meta.className = 'sync-meta';
    meta.textContent = `${formatInteger(item.row_count)} 条 · ${formatDateTime(item.captured_at)}`;
    const status = document.createElement('span');
    status.className = item.status === 'ok' ? 'sync-ok' : '';
    status.textContent = item.status === 'ok' ? '正常' : item.status;
    row.append(name, meta, status);
    list.append(row);
  });
}

async function loadOverview(force = false) {
  const generation = ++overviewGeneration;
  ['products', 'skus', 'inventory', 'warehouses'].forEach(key => {
    document.getElementById(`metric-${key}`).textContent = '…';
  });
  const syncList = document.getElementById('sync-list');
  syncList.textContent = '正在读取同步状态…';

  try {
    const productsJob = allowedPermissions.has('products.read') ? countView('product_catalog') : Promise.resolve(null);
    const skusJob = allowedPermissions.has('products.read') ? countView('sku_catalog') : Promise.resolve(null);
    const inventoryJob = allowedPermissions.has('inventory.read') ? countView('inventory_current') : Promise.resolve(null);
    const warehousesJob = allowedPermissions.has('inventory.read') ? fetchWarehouses({force}) : Promise.resolve([]);
    const syncJob = currentProfile?.role === 'admin'
      ? supabase.from('sync_status').select('dataset, captured_at, row_count, status').order('dataset')
      : Promise.resolve({data: [], error: null});

    const [products, skus, inventory, warehouses, syncResult] = await Promise.all([
      productsJob,
      skusJob,
      inventoryJob,
      warehousesJob,
      syncJob
    ]);

    if (generation !== overviewGeneration || !currentProfile) return;
    if (syncResult.error) throw syncResult.error;
    document.getElementById('metric-products').textContent = formatInteger(products);
    document.getElementById('metric-skus').textContent = formatInteger(skus);
    document.getElementById('metric-inventory').textContent = formatInteger(inventory);
    document.getElementById('metric-warehouses').textContent = allowedPermissions.has('inventory.read')
      ? formatInteger(warehouses.length)
      : '—';
    renderSyncStatus(syncResult.data || []);
  }
  catch (error) {
    console.error('Overview query failed', error);
    if (generation === overviewGeneration) {
      setViewMessage('部分经营数据读取失败，请稍后刷新。');
      renderSyncStatus([]);
    }
  }
}

function updateProductPagination() {
  const totalPages = Math.max(1, Math.ceil(productState.total / PRODUCT_PAGE_SIZE));
  document.getElementById('product-page-label').textContent = `第 ${productState.page + 1} / ${totalPages} 页`;
  document.getElementById('product-prev').disabled = productState.page <= 0;
  document.getElementById('product-next').disabled = productState.page + 1 >= totalPages;
}

function renderProductRows(rows) {
  const body = document.getElementById('product-table-body');
  clearNode(body);
  if (!rows.length) {
    renderTableMessage(body, 7, '没有找到符合条件的商品。', 'empty-row');
    return;
  }

  rows.forEach(product => {
    const row = document.createElement('tr');
    row.append(createProductCell({
      imageUrl: product.primary_image_url,
      title: product.product_name,
      subtitle: product.short_name
    }));
    row.append(createCell(product.product_code || '—'));
    row.append(createCell(product.brand || '—'));
    row.append(createCell(formatCurrency(product.retail_price), 'number-cell'));
    row.append(createStateCell(product.status));
    row.append(createCell(formatDateTime(product.source_updated_at || product.last_seen_at)));

    const actionCell = document.createElement('td');
    const action = document.createElement('button');
    action.className = 'table-action';
    action.type = 'button';
    action.textContent = '查看 SKU';
    action.addEventListener('click', () => loadSkuDetail(product));
    actionCell.append(action);
    row.append(actionCell);
    body.append(row);
  });
}

async function loadProducts() {
  if (!allowedPermissions.has('products.read')) return;
  const generation = ++productState.generation;
  const body = document.getElementById('product-table-body');
  renderTableMessage(body, 7, '正在读取商品档案…');
  document.getElementById('product-prev').disabled = true;
  document.getElementById('product-next').disabled = true;
  setViewMessage('');

  productState.query = normalizeSearchTerm(document.getElementById('product-search').value);
  const from = productState.page * PRODUCT_PAGE_SIZE;
  const to = from + PRODUCT_PAGE_SIZE - 1;
  let query = supabase
    .from('product_catalog')
    .select('erp_product_id, product_code, product_name, short_name, brand, status, primary_image_url, retail_price, last_seen_at, source_updated_at', {count: 'exact'})
    .order('product_code', {ascending: true})
    .range(from, to);

  if (productState.query) {
    const pattern = `%${productState.query}%`;
    query = query.or(`product_code.ilike.${pattern},product_name.ilike.${pattern},short_name.ilike.${pattern},barcode.ilike.${pattern}`);
  }

  const {data, count, error} = await query;
  if (generation !== productState.generation) return;
  if (error) {
    console.error('Product query failed', error);
    renderTableMessage(body, 7, '商品数据读取失败，请稍后重试。', 'empty-row');
    setViewMessage('商品档案读取失败，请检查网络后重试。');
    return;
  }

  productState.total = count || 0;
  productState.loaded = true;
  renderProductRows(data || []);
  document.getElementById('product-results-meta').textContent = productState.query
    ? `“${productState.query}”找到 ${formatInteger(productState.total)} 个商品`
    : `共 ${formatInteger(productState.total)} 个商品`;
  updateProductPagination();
}

function renderSkuRows(rows) {
  const body = document.getElementById('sku-table-body');
  clearNode(body);
  if (!rows.length) {
    renderTableMessage(body, 7, '该商品暂未同步 SKU 明细。', 'empty-row');
    return;
  }

  rows.forEach(sku => {
    const row = document.createElement('tr');
    row.append(createCell(sku.sku_code || '—'));
    row.append(createCell(sku.barcode || '—'));
    row.append(createCell(sku.color || sku.prop1_title || '—'));
    row.append(createCell(sku.size || sku.prop2_title || '—'));
    row.append(createCell(sku.prop3_title || '—'));
    row.append(createCell(sku.unit || '—'));
    row.append(createCell(formatDateTime(sku.source_updated_at || sku.last_seen_at)));
    body.append(row);
  });
}

async function loadSkuDetail(product) {
  const generation = ++skuGeneration;
  const panel = document.getElementById('sku-detail');
  const body = document.getElementById('sku-table-body');
  panel.classList.remove('is-hidden');
  document.getElementById('sku-detail-title').textContent = `${product.product_code} · ${product.product_name}`;
  document.getElementById('sku-detail-meta').textContent = '正在读取 SKU…';
  renderTableMessage(body, 7, '正在读取 SKU 明细…');
  panel.scrollIntoView({behavior: 'smooth', block: 'start'});

  const {data, count, error} = await supabase
    .from('sku_catalog')
    .select('erp_sku_id, sku_code, barcode, color, size, prop1_title, prop2_title, prop3_title, unit, last_seen_at, source_updated_at', {count: 'exact'})
    .eq('erp_product_id', product.erp_product_id)
    .order('sku_code', {ascending: true})
    .range(0, SKU_DETAIL_LIMIT - 1);

  if (generation !== skuGeneration) return;
  if (error) {
    console.error('SKU query failed', error);
    document.getElementById('sku-detail-meta').textContent = 'SKU 读取失败';
    renderTableMessage(body, 7, 'SKU 明细读取失败，请稍后重试。', 'empty-row');
    return;
  }

  const total = count || 0;
  document.getElementById('sku-detail-meta').textContent = total > SKU_DETAIL_LIMIT
    ? `共 ${formatInteger(total)} 个 SKU，当前显示前 ${SKU_DETAIL_LIMIT} 个`
    : `共 ${formatInteger(total)} 个 SKU`;
  renderSkuRows(data || []);
}

async function ensureWarehouseOptions(force = false) {
  if (!allowedPermissions.has('inventory.read')) return;
  const select = document.getElementById('warehouse-filter');
  try {
    const warehouses = await fetchWarehouses({force});
    const selected = inventoryState.warehouseId;
    select.replaceChildren(new Option('全部仓库', ''));
    warehouses.forEach(warehouse => select.add(new Option(warehouse.name, warehouse.id)));
    select.value = selected;
  }
  catch (error) {
    console.error('Warehouse query failed', error);
    setViewMessage('仓库列表读取失败，仍可查询全部库存。');
  }
}

function updateInventoryPagination() {
  const totalPages = Math.max(1, Math.ceil(inventoryState.total / INVENTORY_PAGE_SIZE));
  document.getElementById('inventory-page-label').textContent = `第 ${inventoryState.page + 1} / ${totalPages} 页`;
  document.getElementById('inventory-prev').disabled = inventoryState.page <= 0;
  document.getElementById('inventory-next').disabled = inventoryState.page + 1 >= totalPages;
}

function inventorySpec(row) {
  const values = [row.color, row.size, row.prop3_title, row.spec]
    .filter(Boolean)
    .filter((value, index, all) => all.indexOf(value) === index);
  return values.join(' / ') || '—';
}

function renderInventoryRows(rows) {
  const body = document.getElementById('inventory-table-body');
  clearNode(body);
  if (!rows.length) {
    renderTableMessage(body, 9, '没有找到符合条件的库存记录。', 'empty-row');
    document.getElementById('inventory-captured-at').textContent = '';
    return;
  }

  let latestCapturedAt = null;
  rows.forEach(item => {
    const row = document.createElement('tr');
    row.append(createProductCell({
      imageUrl: item.image_url,
      title: item.product_name || item.short_name,
      subtitle: `${item.product_code || '无款号'} · ${item.sku_code || '无 SKU 编码'}`
    }));
    row.append(createCell(inventorySpec(item)));
    row.append(createCell(item.warehouse_name || '—'));
    row.append(createCell(formatQuantity(item.stock_qty), `number-cell${Number(item.stock_qty) < 0 ? ' negative-value' : ''}`));
    row.append(createCell(formatQuantity(item.occupied_qty), 'number-cell'));
    row.append(createCell(formatQuantity(item.sellable_qty), `number-cell${Number(item.sellable_qty) < 0 ? ' negative-value' : ''}`));
    row.append(createCell(formatCurrency(item.retail_price), 'number-cell'));
    row.append(createCell(item.position || '—'));
    row.append(createCell(formatDateTime(item.source_updated_at || item.captured_at)));
    body.append(row);

    const captured = new Date(item.captured_at || 0).getTime();
    if (Number.isFinite(captured) && (!latestCapturedAt || captured > latestCapturedAt)) latestCapturedAt = captured;
  });

  document.getElementById('inventory-captured-at').textContent = latestCapturedAt
    ? `云端快照 ${formatDateTime(new Date(latestCapturedAt).toISOString())}`
    : '';
}

async function loadInventory() {
  if (!allowedPermissions.has('inventory.read')) return;
  const generation = ++inventoryState.generation;
  const body = document.getElementById('inventory-table-body');
  renderTableMessage(body, 9, '正在读取当前库存…');
  document.getElementById('inventory-prev').disabled = true;
  document.getElementById('inventory-next').disabled = true;
  setViewMessage('');

  inventoryState.query = normalizeSearchTerm(document.getElementById('inventory-search').value);
  inventoryState.warehouseId = document.getElementById('warehouse-filter').value;
  const from = inventoryState.page * INVENTORY_PAGE_SIZE;
  const to = from + INVENTORY_PAGE_SIZE - 1;
  let query = supabase
    .from('inventory_current')
    .select('warehouse_id, warehouse_name, erp_sku_id, erp_product_id, product_code, product_name, short_name, sku_code, barcode, color, size, prop3_title, unit, spec, brand, status, position, image_url, stock_qty, occupied_qty, sellable_qty, retail_price, allocation_status, source_updated_at, captured_at', {count: 'exact'})
    .order('product_code', {ascending: true})
    .order('sku_code', {ascending: true})
    .order('warehouse_name', {ascending: true})
    .range(from, to);

  if (inventoryState.warehouseId) query = query.eq('warehouse_id', inventoryState.warehouseId);
  if (inventoryState.query) {
    const pattern = `%${inventoryState.query}%`;
    query = query.or(`product_code.ilike.${pattern},product_name.ilike.${pattern},short_name.ilike.${pattern},sku_code.ilike.${pattern},barcode.ilike.${pattern},color.ilike.${pattern},size.ilike.${pattern},spec.ilike.${pattern}`);
  }

  const {data, count, error} = await query;
  if (generation !== inventoryState.generation) return;
  if (error) {
    console.error('Inventory query failed', error);
    renderTableMessage(body, 9, '库存数据读取失败，请稍后重试。', 'empty-row');
    setViewMessage('当前库存读取失败，请检查网络后重试。');
    return;
  }

  inventoryState.total = count || 0;
  inventoryState.loaded = true;
  renderInventoryRows(data || []);
  const filters = [];
  if (inventoryState.query) filters.push(`“${inventoryState.query}”`);
  const warehouseName = document.getElementById('warehouse-filter').selectedOptions[0]?.textContent;
  if (inventoryState.warehouseId && warehouseName) filters.push(warehouseName);
  document.getElementById('inventory-results-meta').textContent = filters.length
    ? `${filters.join(' · ')}找到 ${formatInteger(inventoryState.total)} 条库存记录`
    : `共 ${formatInteger(inventoryState.total)} 条库存记录`;
  updateInventoryPagination();
}

loginForm.addEventListener('submit', async event => {
  event.preventDefault();
  const form = new FormData(loginForm);
  const email = authEmailForAccount(form.get('account')?.toString() || '');
  const password = form.get('password')?.toString() || '';
  if (!email) {
    showMessage('账号需使用 2–32 位字母、数字、点、下划线或短横线。');
    return;
  }

  showMessage('登录中…');
  const {data, error} = await supabase.auth.signInWithPassword({email, password});
  if (error) {
    showMessage('登录失败，请检查账号和密码。');
    return;
  }
  showMessage('');
  await hydrateSession(data.user);
});

document.getElementById('logout-button').addEventListener('click', async () => {
  await supabase.auth.signOut();
  showLogin();
});

document.querySelectorAll('.nav-item[data-view]').forEach(item => {
  item.addEventListener('click', () => activateView(item.dataset.view));
});

document.querySelectorAll('[data-open-view]').forEach(item => {
  item.addEventListener('click', () => activateView(item.dataset.openView));
});

document.getElementById('refresh-overview').addEventListener('click', () => loadOverview(true));

document.getElementById('product-search-form').addEventListener('submit', event => {
  event.preventDefault();
  productState.page = 0;
  loadProducts();
});

document.getElementById('product-reset').addEventListener('click', () => {
  document.getElementById('product-search').value = '';
  productState.page = 0;
  loadProducts();
});

document.getElementById('product-prev').addEventListener('click', () => {
  if (productState.page <= 0) return;
  productState.page -= 1;
  loadProducts();
});

document.getElementById('product-next').addEventListener('click', () => {
  const totalPages = Math.ceil(productState.total / PRODUCT_PAGE_SIZE);
  if (productState.page + 1 >= totalPages) return;
  productState.page += 1;
  loadProducts();
});

document.getElementById('sku-detail-close').addEventListener('click', () => {
  skuGeneration += 1;
  document.getElementById('sku-detail').classList.add('is-hidden');
});

document.getElementById('inventory-search-form').addEventListener('submit', event => {
  event.preventDefault();
  inventoryState.page = 0;
  loadInventory();
});

document.getElementById('warehouse-filter').addEventListener('change', () => {
  inventoryState.page = 0;
  loadInventory();
});

document.getElementById('inventory-reset').addEventListener('click', () => {
  document.getElementById('inventory-search').value = '';
  document.getElementById('warehouse-filter').value = '';
  inventoryState.page = 0;
  loadInventory();
});

document.getElementById('inventory-prev').addEventListener('click', () => {
  if (inventoryState.page <= 0) return;
  inventoryState.page -= 1;
  loadInventory();
});

document.getElementById('inventory-next').addEventListener('click', () => {
  const totalPages = Math.ceil(inventoryState.total / INVENTORY_PAGE_SIZE);
  if (inventoryState.page + 1 >= totalPages) return;
  inventoryState.page += 1;
  loadInventory();
});

supabase.auth.onAuthStateChange((_event, session) => {
  setTimeout(() => {
    if (session?.user) hydrateSession(session.user);
    else showLogin();
  }, 0);
});

const {data: {session}} = await supabase.auth.getSession();
if (session?.user) await hydrateSession(session.user);
else showLogin();
