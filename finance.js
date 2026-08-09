(function () {
  'use strict';

  const page = document.body.dataset.junPage;
  const toolbar = document.getElementById('module-toolbar');
  const content = document.getElementById('module-content');
  const money = new Intl.NumberFormat('zh-CN', {minimumFractionDigits: 2, maximumFractionDigits: 2});
  const integer = new Intl.NumberFormat('zh-CN', {maximumFractionDigits: 2});
  const sourceLabels = {
    taobao_income_order: '淘宝账房订单',
    taobao_platform_charge: '平台运营扣费',
    promotion_charge: '付费推广',
    logistics_sf: '顺丰物流',
    logistics_other: '其他物流',
    manual_work: '手工审批',
    erp_shipment: 'ERP 发货',
  };
  const sectionLabels = {
    revenue: '经营收入', product_cost: '商品成本', operations: '运营履约',
    payroll: '人员费用', fixed: '固定及分摊费用', adjustment: '经营模块外调整', result: '核算结果', historical: '历史财报',
  };
  const state = {months: [], month: '', data: null, sourceType: 'taobao_income_order', offset: 0, limit: 100, sourceTotal: 0};

  function escapeHtml(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (character) {
      return {'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[character];
    });
  }

  function amount(value) {
    return value == null || value === '' ? '待补' : `¥${money.format(Number(value))}`;
  }

  function dateTime(value) {
    if (!value) return '-';
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? escapeHtml(value) : parsed.toLocaleString('zh-CN', {hour12: false});
  }

  async function api(path, options) {
    const response = await fetch(path, options);
    const payload = await response.json().catch(function () { return {}; });
    if (!response.ok) throw new Error(payload.detail || payload.error || `HTTP ${response.status}`);
    return payload;
  }

  function has(permission) {
    return (window.JUN_CONTEXT?.permissions || []).includes(permission);
  }

  function monthBeforeNow() {
    const now = new Date();
    now.setDate(1);
    now.setMonth(now.getMonth() - 1);
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }

  function rollingMonths() {
    const result = [];
    const cursor = new Date();
    cursor.setDate(1);
    cursor.setMonth(cursor.getMonth() - 1);
    for (let index = 0; index < 18; index += 1) {
      result.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`);
      cursor.setMonth(cursor.getMonth() - 1);
    }
    return result;
  }

  function selectedMonthFromUrl(fallback) {
    const value = new URLSearchParams(location.search).get('month');
    return /^\d{4}-(0[1-9]|1[0-2])$/.test(value || '') ? value : fallback;
  }

  function monthSelect(months, selected) {
    return `<select id="finance-month" class="form-select" aria-label="核算月份">${months.map(function (item) {
      const month = typeof item === 'string' ? item : item.month;
      return `<option value="${month}" ${month === selected ? 'selected' : ''}>${month.replace('-', ' 年 ')} 月</option>`;
    }).join('')}</select>`;
  }

  function setMonth(month) {
    const url = new URL(location.href);
    url.searchParams.set('month', month);
    history.replaceState({}, '', url);
    state.month = month;
  }

  function markNavigation() {
    const current = location.pathname.replace(/\/$/, '');
    document.querySelectorAll('a[href]').forEach(function (anchor) {
      const target = new URL(anchor.href, location.href).pathname.replace(/\/$/, '');
      if (target === current) anchor.classList.add('active');
    });
    const group = page.startsWith('finance-') ? '/jun-pages/finance' : page === 'production-manual' ? '/jun-pages/production' : '/jun-pages/erp';
    document.querySelectorAll('.bottom-tab-bar a').forEach(function (anchor) {
      if (new URL(anchor.href).pathname.replace(/\/$/, '') === group) anchor.classList.add('active');
    });
  }

  function dialog(id, title, body) {
    document.getElementById(id)?.remove();
    const element = document.createElement('dialog');
    element.id = id;
    element.className = 'finance-dialog';
    element.innerHTML = `<form method="dialog"><header><h3>${escapeHtml(title)}</h3><button class="finance-icon-button" value="cancel" aria-label="关闭"><i class="ti ti-x"></i></button></header><div class="finance-dialog-body">${body}</div></form>`;
    document.body.appendChild(element);
    element.showModal();
    return element;
  }

  function renderError(error) {
    content.innerHTML = `<div class="finance-error">${escapeHtml(error.message || error)}</div>`;
  }

  async function loadFinanceMonths() {
    const payload = await api('/api/finance/months');
    state.months = payload.months || [];
    const fallback = state.months[0]?.month || monthBeforeNow();
    state.month = selectedMonthFromUrl(fallback);
  }

  function reportTabs() {
    return `<nav class="finance-tabs" aria-label="财务模块"><a href="/jun-pages/finance/" ${page === 'finance-report' ? 'class="active"' : ''}>财务月报</a><a href="/jun-pages/finance/payroll/" ${page === 'finance-payroll' ? 'class="active"' : ''}>工资发放</a><a href="/jun-pages/finance/sources/" ${page === 'finance-sources' ? 'class="active"' : ''}>财务数据源</a></nav>`;
  }

  function reportLine(line) {
    const editable = has('finance.manage') && (state.data.month.status === 'open' || state.data.month.historical_snapshot);
    const resultClass = line.section_key === 'result' ? ' is-result' : '';
    return `<div class="finance-line ${line.status === 'missing' ? 'is-missing' : ''}${resultClass}">
      <div class="finance-line-label">${escapeHtml(line.label)}${line.manual ? '<span class="finance-line-origin"><i class="ti ti-pencil"></i>手动</span>' : ''}</div>
      <div class="finance-amount">${amount(line.final_amount)}</div>
      <button class="finance-icon-button" type="button" data-trace="${escapeHtml(line.line_key)}" title="查看计算依据" aria-label="查看${escapeHtml(line.label)}计算依据"><i class="ti ti-help-circle"></i></button>
      ${editable ? `<button class="finance-icon-button" type="button" data-override="${escapeHtml(line.line_key)}" title="手动调整" aria-label="调整${escapeHtml(line.label)}"><i class="ti ti-edit"></i></button>` : '<span></span>'}
    </div>`;
  }

  function renderReport() {
    const data = state.data;
    const byKey = new Map((data.lines || []).map(function (line) { return [line.line_key, line]; }));
    const profit = byKey.get('final_profit') || byKey.get('profit') || (data.lines || []).at(-1);
    const revenue = byKey.get('taobao_income') || byKey.get('total_income');
    const expenses = byKey.get('total_expenses');
    const missing = data.completeness?.missing?.length || 0;
    const sections = new Map();
    (data.lines || []).forEach(function (line) {
      if (!sections.has(line.section_key)) sections.set(line.section_key, []);
      sections.get(line.section_key).push(line);
    });
    content.innerHTML = `${reportTabs()}
      <div class="finance-kpis">
        <div class="finance-kpi"><span>经营收入</span><strong>${amount(revenue?.final_amount)}</strong></div>
        <div class="finance-kpi"><span>成本费用</span><strong>${amount(expenses?.final_amount)}</strong></div>
        <div class="finance-kpi"><span>调整后利润</span><strong class="${Number(profit?.final_amount) >= 0 ? 'positive' : 'negative'}">${amount(profit?.final_amount)}</strong></div>
        <div class="finance-kpi"><span>待补项目</span><strong>${missing}</strong></div>
      </div>
      <div class="finance-report">${Array.from(sections.entries()).map(function (entry) {
        return `<section class="finance-section"><div class="finance-section-header"><h3>${escapeHtml(sectionLabels[entry[0]] || entry[0])}</h3></div>${entry[1].map(reportLine).join('')}</section>`;
      }).join('')}</div>`;
    content.querySelectorAll('[data-trace]').forEach(function (button) {
      button.addEventListener('click', function () { showTrace(button.dataset.trace); });
    });
    content.querySelectorAll('[data-override]').forEach(function (button) {
      button.addEventListener('click', function () { showOverride(button.dataset.override); });
    });
  }

  function showTrace(lineKey) {
    const line = state.data.lines.find(function (item) { return item.line_key === lineKey; });
    if (!line) return;
    const origin = line.manual ? '管理员手动调整' : line.trace?.kind === 'historical_snapshot' ? '历史财报快照' : '自动计算';
    dialog('finance-trace-dialog', line.label, `<div class="finance-trace"><dl><dt>当前金额</dt><dd>${amount(line.final_amount)}</dd><dt>自动金额</dt><dd>${amount(line.source_amount)}</dd><dt>数值来源</dt><dd>${origin}</dd><dt>计算逻辑</dt><dd>${escapeHtml(line.trace?.formula || line.trace?.note || '-')}</dd>${line.override ? `<dt>调整原因</dt><dd>${escapeHtml(line.override.reason)}</dd>` : ''}</dl><pre>${escapeHtml(JSON.stringify(line.trace || {}, null, 2))}</pre></div>`);
  }

  async function sha256(file) {
    const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
    return Array.from(new Uint8Array(digest)).map(function (byte) { return byte.toString(16).padStart(2, '0'); }).join('');
  }

  function showOverride(lineKey) {
    const line = state.data.lines.find(function (item) { return item.line_key === lineKey; });
    if (!line) return;
    const element = dialog('finance-override-dialog', `调整：${line.label}`, `<label>核算金额<input class="form-control" name="amount" type="number" step="0.01" required value="${line.final_amount == null ? '' : escapeHtml(line.final_amount)}"></label><label>调整原因<textarea class="form-control" name="reason" rows="3" required>${escapeHtml(line.override?.reason || '')}</textarea></label><label>凭证图片（可选）<input class="form-control" name="evidence" type="file" accept="image/jpeg,image/png,image/webp"></label><p class="finance-note">自动计算值：${amount(line.source_amount)}</p><div class="finance-error" data-message hidden></div><footer>${line.override ? '<button class="btn btn-outline-danger" type="button" data-remove>恢复自动</button>' : ''}<button class="btn btn-outline-secondary" value="cancel">取消</button><button class="btn btn-primary" type="button" data-save>保存</button></footer>`);
    const message = element.querySelector('[data-message]');
    element.querySelector('[data-save]').addEventListener('click', async function () {
      const save = element.querySelector('[data-save]');
      save.disabled = true;
      try {
        const saved = await api(`/api/finance/months/${state.month}/overrides/${encodeURIComponent(line.line_key)}`, {
          method: 'PUT', headers: {'Content-Type': 'application/json'},
          body: JSON.stringify({amount: Number(element.querySelector('[name="amount"]').value), reason: element.querySelector('[name="reason"]').value, expected_version: line.override?.version || null}),
        });
        const file = element.querySelector('[name="evidence"]').files[0];
        if (file) {
          const reserved = await api(`/api/finance/overrides/${saved.id}/attachments/upload`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({original_name: file.name, mime_type: file.type, byte_size: file.size, sha256: await sha256(file)})});
          const upload = await window.JUN_SUPABASE.storage.from(reserved.bucket).uploadToSignedUrl(reserved.path, reserved.token, file, {contentType: file.type});
          if (upload.error) throw upload.error;
          await api(`/api/finance/attachments/${reserved.attachment.id}/confirm`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: '{}'});
        }
        element.close();
        await loadReport();
      } catch (error) {
        message.hidden = false;
        message.textContent = error.message;
        save.disabled = false;
      }
    });
    element.querySelector('[data-remove]')?.addEventListener('click', async function () {
      try {
        await api(`/api/finance/months/${state.month}/overrides/${encodeURIComponent(line.line_key)}`, {method: 'DELETE', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({expected_version: line.override.version})});
        element.close();
        await loadReport();
      } catch (error) { message.hidden = false; message.textContent = error.message; }
    });
  }

  async function loadReport() {
    content.innerHTML = '<div class="finance-loading"><span class="spinner-border spinner-border-sm"></span>正在核算</div>';
    state.data = await api(`/api/finance/months/${state.month}`);
    toolbar.innerHTML = `${monthSelect(state.months, state.month)}<span class="finance-status ${state.data.completeness.complete ? 'is-ready' : 'is-missing'}"><i class="ti ti-${state.data.completeness.complete ? 'circle-check' : 'alert-triangle'}"></i>${state.data.completeness.complete ? '数据完整' : `${state.data.completeness.missing.length} 项待补`}</span><span class="finance-toolbar-spacer"></span><span class="finance-status">${state.data.month.status === 'locked' ? '已关账' : '核算中'}</span>`;
    toolbar.querySelector('#finance-month').addEventListener('change', async function (event) { setMonth(event.target.value); await loadReport(); });
    renderReport();
  }

  function payrollRows() {
    return state.data?.payroll_rows || [];
  }

  function renderPayroll() {
    const rows = payrollRows();
    content.innerHTML = `${reportTabs()}<div class="finance-table-wrap"><table class="finance-table"><thead><tr><th>姓名</th><th>部门 / 职位</th><th class="number">应发</th><th class="number">个税</th><th class="number">个人医社保</th><th class="number">公司医社保</th><th class="number">实发</th><th>银行</th><th>备注</th></tr></thead><tbody>${rows.map(function (row) { return `<tr><td><strong>${escapeHtml(row.employee_name)}</strong></td><td>${escapeHtml(row.department)}<div class="text-secondary small">${escapeHtml(row.role_name)}</div></td><td class="number">${amount(row.gross_pay)}</td><td class="number">${amount(row.income_tax)}</td><td class="number">${amount(row.personal_social_insurance)}</td><td class="number">${amount(row.employer_social_insurance)}</td><td class="number"><strong>${amount(row.net_pay)}</strong></td><td>${escapeHtml(row.payment_bank)}<div class="text-secondary small">${escapeHtml(row.payment_account)}</div></td><td class="subtle" title="${escapeHtml(row.note)}">${escapeHtml(row.note)}</td></tr>`; }).join('') || '<tr><td colspan="9"><div class="finance-empty">当前月份尚无工资数据</div></td></tr>'}</tbody></table></div>`;
  }

  function exportPayroll() {
    const rows = payrollRows().map(function (row) {
      return {'月份': state.month, '姓名': row.employee_name, '部门': row.department, '职位': row.role_name, '计算说明': row.calculation, '应发工资': row.gross_pay, '个人所得税': row.income_tax, '个人医社保扣除': row.personal_social_insurance, '公司承担医社保': row.employer_social_insurance, '实发工资': row.net_pay, '支付账号': row.payment_account, '开户行': row.payment_bank, '计入公司财报': row.included_in_company_report === false ? '否' : '是', '备注': row.note};
    });
    const sheet = XLSX.utils.json_to_sheet(rows, {header: ['月份','姓名','部门','职位','计算说明','应发工资','个人所得税','个人医社保扣除','公司承担医社保','实发工资','支付账号','开户行','计入公司财报','备注']});
    sheet['!cols'] = [9,12,12,12,32,12,12,15,15,12,24,18,14,32].map(function (width) { return {wch: width}; });
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, '工资核算');
    XLSX.writeFile(workbook, `${state.month.replace('-', '年')}月工资核算.xlsx`);
  }

  async function importPayroll(file) {
    const workbook = XLSX.read(await file.arrayBuffer(), {type: 'array', cellDates: true});
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const raw = XLSX.utils.sheet_to_json(sheet, {defval: '', raw: false});
    const rows = raw.filter(function (item) { return String(item['姓名'] || '').trim(); }).map(function (item, index) {
      const numberOrNull = function (value) { const parsed = Number(String(value).replace(/,/g, '')); return value === '' || !Number.isFinite(parsed) ? null : parsed; };
      return {row_key: `${String(item['姓名']).trim()}-${index + 1}`, employee_name: String(item['姓名']).trim(), department: String(item['部门'] || '').trim(), role_name: String(item['职位'] || '').trim(), calculation: String(item['计算说明'] || '').trim(), gross_pay: numberOrNull(item['应发工资']), income_tax: numberOrNull(item['个人所得税']), personal_social_insurance: numberOrNull(item['个人医社保扣除']), employer_social_insurance: numberOrNull(item['公司承担医社保']), net_pay: numberOrNull(item['实发工资']), payment_account: String(item['支付账号'] || '').replace(/\s/g, ''), payment_bank: String(item['开户行'] || '').trim(), included_in_company_report: String(item['计入公司财报'] || '是').trim() !== '否', note: String(item['备注'] || '').trim(), payload: item};
    });
    if (!rows.length) throw new Error('工资核算表中没有有效人员行');
    await api(`/api/finance/payroll/${state.month}/import`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({stage: 'finance_return', file_name: file.name, file_sha256: await sha256(file), rows: rows, summary: {row_count: rows.length}})});
  }

  async function loadPayroll() {
    state.data = await api(`/api/finance/months/${state.month}`);
    toolbar.innerHTML = `${monthSelect(state.months, state.month)}<span class="finance-toolbar-spacer"></span><button id="payroll-export" class="btn btn-outline-primary"><i class="ti ti-file-export me-1"></i>导出 Excel</button>${has('finance.payroll.manage') ? '<label class="btn btn-primary mb-0"><i class="ti ti-file-import me-1"></i>导入财务回表<input id="payroll-import" type="file" accept=".xlsx,.xls" hidden></label>' : ''}`;
    toolbar.querySelector('#finance-month').addEventListener('change', async function (event) { setMonth(event.target.value); await loadPayroll(); });
    toolbar.querySelector('#payroll-export').addEventListener('click', exportPayroll);
    toolbar.querySelector('#payroll-import')?.addEventListener('change', async function (event) {
      const file = event.target.files[0];
      if (!file) return;
      try { await importPayroll(file); await loadPayroll(); } catch (error) { renderError(error); }
    });
    renderPayroll();
  }

  function sourceCard(batch) {
    const total = batch ? batch.amount_total : null;
    return `<button class="finance-source-item ${state.sourceType === batch?.source_type ? 'active' : ''}" data-source="${escapeHtml(batch?.source_type || '')}"><span>${escapeHtml(sourceLabels[batch?.source_type] || batch?.source_type || '')}</span><strong>${amount(total)}</strong><small>${batch ? `${integer.format(batch.record_count || 0)} 条 · ${dateTime(batch.captured_at)}` : '未导入'}</small></button>`;
  }

  async function loadSourceRecords() {
    const query = new URLSearchParams({month: state.month, source_type: state.sourceType, limit: state.limit, offset: state.offset});
    const payload = await api(`/api/finance/sources/records?${query}`);
    state.sourceTotal = payload.total || 0;
    const target = content.querySelector('#source-records');
    target.innerHTML = renderRecordTable(payload.items || [], true);
    bindRecordDetails(target);
    bindPager(target, loadSourceRecords);
  }

  function renderRecordTable(rows, pager) {
    return `<div class="finance-table-wrap"><table class="finance-table"><thead><tr><th>时间</th><th>单号 / 参考号</th><th>内容</th><th>往来单位</th><th class="number">数量</th><th class="number">金额</th><th>状态</th><th></th></tr></thead><tbody>${rows.map(function (row) { return `<tr><td>${dateTime(row.occurred_at)}</td><td>${escapeHtml(row.reference_no || row.record_key)}</td><td class="subtle" title="${escapeHtml(row.title)}">${escapeHtml(row.title)}</td><td>${escapeHtml(row.counterparty)}</td><td class="number">${row.quantity == null ? '-' : integer.format(row.quantity)}</td><td class="number">${amount(row.amount)}</td><td>${escapeHtml(row.status)}${row.eligible === false ? '<span class="badge bg-red-lt ms-1">不计入</span>' : ''}</td><td><button class="finance-icon-button" data-record='${escapeHtml(JSON.stringify(row))}' title="查看明细"><i class="ti ti-eye"></i></button></td></tr>`; }).join('') || '<tr><td colspan="8"><div class="finance-empty">暂无明细</div></td></tr>'}</tbody></table></div>${pager ? `<div class="finance-pager"><span class="finance-note">${state.offset + 1}-${Math.min(state.offset + state.limit, state.sourceTotal)} / ${state.sourceTotal}</span><button class="btn btn-sm btn-outline-secondary" data-prev ${state.offset <= 0 ? 'disabled' : ''}><i class="ti ti-chevron-left"></i></button><button class="btn btn-sm btn-outline-secondary" data-next ${state.offset + state.limit >= state.sourceTotal ? 'disabled' : ''}><i class="ti ti-chevron-right"></i></button></div>` : ''}`;
  }

  function bindRecordDetails(target) {
    target.querySelectorAll('[data-record]').forEach(function (button) {
      button.addEventListener('click', function () {
        const row = JSON.parse(button.dataset.record);
        dialog('finance-record-dialog', row.reference_no || row.title || '数据明细', `<div class="finance-trace"><dl><dt>时间</dt><dd>${dateTime(row.occurred_at)}</dd><dt>金额</dt><dd>${amount(row.amount)}</dd><dt>数量</dt><dd>${row.quantity == null ? '-' : integer.format(row.quantity)}</dd><dt>状态</dt><dd>${escapeHtml(row.status || '-')}</dd></dl><pre>${escapeHtml(JSON.stringify(row.payload || {}, null, 2))}</pre></div>`);
      });
    });
  }

  function bindPager(target, loader) {
    target.querySelector('[data-prev]')?.addEventListener('click', function () { state.offset = Math.max(0, state.offset - state.limit); loader(); });
    target.querySelector('[data-next]')?.addEventListener('click', function () { state.offset += state.limit; loader(); });
  }

  function showCostDialog(cost) {
    const element = dialog('finance-cost-dialog', cost ? '编辑费用' : '新增费用', `<label>费用名称<input class="form-control" name="name" required value="${escapeHtml(cost?.name || '')}"></label><div class="row"><label class="col">分类<select class="form-select" name="category"><option value="rent_utilities">房租水电</option><option value="software">软件</option><option value="finance_fee">财务费用</option><option value="office">办公</option><option value="equipment">机器设备</option><option value="renovation">装修</option><option value="other">其他</option></select></label><label class="col">类型<select class="form-select" name="cost_type"><option value="recurring">周期费用</option><option value="one_time_amortized">一次性分摊</option></select></label></div><div class="row"><label class="col">总金额<input class="form-control" type="number" step="0.01" min="0" name="amount" required value="${escapeHtml(cost?.amount || '')}"></label><label class="col">开始月份<input class="form-control" type="month" name="start_month" required value="${escapeHtml(cost?.start_month || state.month)}"></label></div><div class="row"><label class="col">结束月份<input class="form-control" type="month" name="end_month" value="${escapeHtml(cost?.end_month || '')}"></label><label class="col">分摊月数<input class="form-control" type="number" min="1" max="240" name="amortization_months" value="${escapeHtml(cost?.amortization_months || '')}"></label></div><label>备注<textarea class="form-control" name="note" rows="2">${escapeHtml(cost?.note || '')}</textarea></label><label class="form-check"><input class="form-check-input" type="checkbox" name="renewal_required" ${cost?.renewal_required ? 'checked' : ''}><span class="form-check-label">到期后需要重新确认</span></label><div class="finance-error" data-message hidden></div><footer><button class="btn btn-outline-secondary" value="cancel">取消</button><button class="btn btn-primary" type="button" data-save>保存</button></footer>`);
    element.querySelector('[name="category"]').value = cost?.category || 'software';
    element.querySelector('[name="cost_type"]').value = cost?.cost_type || 'recurring';
    element.querySelector('[data-save]').addEventListener('click', async function () {
      const values = Object.fromEntries(new FormData(element.querySelector('form')).entries());
      values.amount = Number(values.amount);
      values.amortization_months = values.amortization_months ? Number(values.amortization_months) : null;
      values.renewal_required = element.querySelector('[name="renewal_required"]').checked;
      values.active = true;
      try { await api('/api/finance/recurring-costs', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({id: cost?.id || null, expected_version: cost?.version || null, values: values})}); element.close(); await loadSources(); } catch (error) { const message = element.querySelector('[data-message]'); message.hidden = false; message.textContent = error.message; }
    });
  }

  function showPolicyDialog(policy) {
    const element = dialog('finance-policy-dialog', policy ? '编辑经营调整' : '新增经营调整', `<label>名称<input class="form-control" name="name" required value="${escapeHtml(policy?.name || '')}"></label><label>规则编号<input class="form-control" name="policy_key" required pattern="[a-z][a-z0-9_.-]+" value="${escapeHtml(policy?.policy_key || '')}"></label><label>规则类型<select class="form-select" name="policy_type"><option value="post_profit_fixed">利润后固定调整</option><option value="exclude_employee">排除指定人员</option><option value="exclude_source_tag">排除指定来源标签</option></select></label><div class="row"><label class="col">数值 / 关键字<input class="form-control" name="value" required value="${escapeHtml(policy?.value?.amount ?? policy?.value?.employee_name ?? policy?.value?.tag ?? '')}"></label><label class="col">开始月份<input class="form-control" type="month" name="start_month" required value="${escapeHtml(policy?.start_month || state.month)}"></label></div><label>结束月份<input class="form-control" type="month" name="end_month" value="${escapeHtml(policy?.end_month || '')}"></label><label>备注<textarea class="form-control" name="note" rows="2">${escapeHtml(policy?.note || '')}</textarea></label><div class="finance-error" data-message hidden></div><footer><button class="btn btn-outline-secondary" value="cancel">取消</button><button class="btn btn-primary" type="button" data-save>保存</button></footer>`);
    element.querySelector('[name="policy_type"]').value = policy?.policy_type || 'post_profit_fixed';
    element.querySelector('[data-save]').addEventListener('click', async function () {
      const form = Object.fromEntries(new FormData(element.querySelector('form')).entries());
      const value = form.policy_type === 'post_profit_fixed' ? {amount: Number(form.value)} : form.policy_type === 'exclude_employee' ? {employee_name: form.value} : {tag: form.value};
      try { await api('/api/finance/policies', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({id: policy?.id || null, expected_version: policy?.version || null, values: {policy_key: form.policy_key, name: form.name, policy_type: form.policy_type, start_month: form.start_month, end_month: form.end_month, value: value, active: true, note: form.note}})}); element.close(); await loadSources(); } catch (error) { const message = element.querySelector('[data-message]'); message.hidden = false; message.textContent = error.message; }
    });
  }

  async function loadSources() {
    state.data = await api(`/api/finance/months/${state.month}`);
    const batches = new Map((state.data.source_batches || []).map(function (batch) { return [batch.source_type, batch]; }));
    toolbar.innerHTML = `${monthSelect(state.months, state.month)}<span class="finance-toolbar-spacer"></span>${has('finance.manage') ? '<button class="btn btn-outline-primary" id="add-cost"><i class="ti ti-plus me-1"></i>费用</button><button class="btn btn-outline-primary" id="add-policy"><i class="ti ti-adjustments me-1"></i>经营调整</button>' : ''}`;
    toolbar.querySelector('#finance-month').addEventListener('change', async function (event) { setMonth(event.target.value); state.offset = 0; await loadSources(); });
    toolbar.querySelector('#add-cost')?.addEventListener('click', function () { showCostDialog(null); });
    toolbar.querySelector('#add-policy')?.addEventListener('click', function () { showPolicyDialog(null); });
    content.innerHTML = `${reportTabs()}<div class="finance-source-grid">${Object.keys(sourceLabels).filter(function (key) { return !['manual_work','erp_shipment'].includes(key); }).map(function (key) { return sourceCard(batches.get(key) || {source_type: key, amount_total: null, record_count: 0, captured_at: null}); }).join('')}</div><section class="finance-section"><div class="finance-section-header"><h3>导入明细</h3></div><div id="source-records"><div class="finance-loading"><span class="spinner-border spinner-border-sm"></span>正在读取</div></div></section><section class="finance-section mt-4"><div class="finance-section-header"><h3>其他固定费用</h3></div>${renderCostTable(state.data.recurring_costs || [])}</section><section class="finance-section mt-4"><div class="finance-section-header"><h3>经营模块外调整</h3></div>${renderPolicyTable(state.data.policies || [])}</section>`;
    content.querySelectorAll('[data-source]').forEach(function (button) { button.addEventListener('click', async function () { state.sourceType = button.dataset.source; state.offset = 0; content.querySelectorAll('[data-source]').forEach(function (item) { item.classList.toggle('active', item === button); }); await loadSourceRecords(); }); });
    content.querySelectorAll('[data-cost]').forEach(function (button) { button.addEventListener('click', function () { showCostDialog(JSON.parse(button.dataset.cost)); }); });
    content.querySelectorAll('[data-policy]').forEach(function (button) { button.addEventListener('click', function () { showPolicyDialog(JSON.parse(button.dataset.policy)); }); });
    if (!batches.has(state.sourceType)) state.sourceType = Array.from(batches.keys()).find(function (key) { return !['manual_work','erp_shipment'].includes(key); }) || 'taobao_income_order';
    await loadSourceRecords();
  }

  function renderCostTable(rows) {
    return `<div class="finance-table-wrap"><table class="finance-table"><thead><tr><th>费用</th><th>分类</th><th>类型</th><th class="number">金额</th><th>期间</th><th>备注</th><th></th></tr></thead><tbody>${rows.map(function (row) { return `<tr><td><strong>${escapeHtml(row.name)}</strong></td><td>${escapeHtml(row.category)}</td><td>${row.cost_type === 'recurring' ? '周期' : `${row.amortization_months} 个月分摊`}</td><td class="number">${amount(row.amount)}</td><td>${escapeHtml(row.start_month)} - ${escapeHtml(row.end_month || '持续')}</td><td class="subtle">${escapeHtml(row.note)}</td><td>${has('finance.manage') ? `<button class="finance-icon-button" data-cost='${escapeHtml(JSON.stringify(row))}'><i class="ti ti-edit"></i></button>` : ''}</td></tr>`; }).join('') || '<tr><td colspan="7"><div class="finance-empty">尚未设置费用</div></td></tr>'}</tbody></table></div>`;
  }

  function renderPolicyTable(rows) {
    return `<div class="finance-table-wrap"><table class="finance-table"><thead><tr><th>规则</th><th>类型</th><th>生效期间</th><th>值</th><th>备注</th><th></th></tr></thead><tbody>${rows.map(function (row) { return `<tr><td><strong>${escapeHtml(row.name)}</strong><div class="finance-note">${escapeHtml(row.policy_key)}</div></td><td>${escapeHtml(row.policy_type)}</td><td>${escapeHtml(row.start_month)} - ${escapeHtml(row.end_month || '持续')}</td><td>${escapeHtml(JSON.stringify(row.value))}</td><td class="subtle">${escapeHtml(row.note)}</td><td>${has('finance.manage') ? `<button class="finance-icon-button" data-policy='${escapeHtml(JSON.stringify(row))}'><i class="ti ti-edit"></i></button>` : ''}</td></tr>`; }).join('') || '<tr><td colspan="6"><div class="finance-empty">尚未设置经营调整</div></td></tr>'}</tbody></table></div>`;
  }

  async function loadStandaloneSource(endpoint, title) {
    const months = rollingMonths();
    state.month = selectedMonthFromUrl(monthBeforeNow());
    toolbar.innerHTML = `${monthSelect(months, state.month)}<span class="finance-toolbar-spacer"></span><span class="finance-status">${escapeHtml(title)}</span>`;
    toolbar.querySelector('#finance-month').addEventListener('change', async function (event) { setMonth(event.target.value); state.offset = 0; await loadStandaloneSource(endpoint, title); });
    const query = new URLSearchParams({month: state.month, limit: state.limit, offset: state.offset});
    const payload = await api(`${endpoint}?${query}`);
    state.sourceTotal = payload.total || 0;
    content.innerHTML = renderRecordTable(payload.items || [], true);
    bindRecordDetails(content);
    bindPager(content, function () { loadStandaloneSource(endpoint, title); });
  }

  async function init() {
    await window.JUN_AUTH_READY;
    markNavigation();
    if (page === 'production-manual') return await loadStandaloneSource('/api/production/manual-approvals', '手工审批');
    if (page === 'erp-shipments') return await loadStandaloneSource('/api/erp/shipments', '发货情况');
    await loadFinanceMonths();
    setMonth(state.month);
    if (page === 'finance-report') return await loadReport();
    if (page === 'finance-payroll') return await loadPayroll();
    if (page === 'finance-sources') return await loadSources();
    throw new Error('未知财务页面');
  }

  init().catch(renderError);
})();
