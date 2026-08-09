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
    income: '收入', product_cost: '产品成本', platform_operations: '平台运营费用',
    logistics: '物流', customer_service: '客服', rent_food_equipment: '房租水电、食杂与设备',
    design: '设计', factory_manager: '工厂运营·厂长费用', business_show: '商务（走秀开支）',
    company_social: '公司医社保', software: '软件费用', finance_fee: '财务费用',
  };
  const sectionOrder = ['income','product_cost','platform_operations','logistics','customer_service','rent_food_equipment','design','factory_manager','business_show','company_social','software','finance_fee'];
  const state = {months: [], month: '', data: null, sourceType: 'taobao_income_order', offset: 0, limit: 100, sourceTotal: 0, companyPayrollModule: 'all'};

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
    document.querySelectorAll('[data-finance-admin]').forEach(function (element) {
      element.hidden = !has('finance.employees.manage');
    });
    document.querySelectorAll('[data-finance-payroll]').forEach(function (element) {
      element.hidden = !(has('finance.payroll.manage') || has('finance.manage'));
    });
  }

  function dialog(id, title, body) {
    document.getElementById(id)?.remove();
    const element = document.createElement('dialog');
    element.id = id;
    element.className = 'finance-dialog';
    element.innerHTML = `<form method="dialog"><header><h3>${escapeHtml(title)}</h3><button class="finance-icon-button" type="button" data-dialog-close aria-label="关闭"><i class="ti ti-x"></i></button></header><div class="finance-dialog-body">${body}</div></form>`;
    document.body.appendChild(element);
    element.querySelectorAll('[data-dialog-close], [value="cancel"]').forEach(function (button) {
      button.setAttribute('type', 'button');
      button.addEventListener('click', function (event) { event.preventDefault(); element.close('cancel'); });
    });
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
    const companyPayroll = has('finance.payroll.manage') || has('finance.manage')
      ? `<a href="/jun-pages/finance/company-payroll/" ${page === 'finance-company-payroll' ? 'class="active"' : ''}>公司工资表</a>`
      : '';
    return `<nav class="finance-tabs" aria-label="财务模块"><a href="/jun-pages/finance/" ${page === 'finance-report' ? 'class="active"' : ''}>财务月报</a>${companyPayroll}<a href="/jun-pages/finance/payroll/" ${page === 'finance-payroll' ? 'class="active"' : ''}>工资发放</a><a href="/jun-pages/finance/sources/" ${page === 'finance-sources' ? 'class="active"' : ''}>财务数据源</a>${has('finance.employees.manage') ? `<a href="/jun-pages/finance/employees/" ${page === 'finance-employees' ? 'class="active"' : ''}>员工信息</a>` : ''}</nav>`;
  }

  function reportMetric(key, fallback) {
    const line = (state.data.lines || []).find(function (item) { return item.line_key === key; });
    return line || fallback || null;
  }

  function numeric(value) {
    const parsed = Number(value);
    return value == null || !Number.isFinite(parsed) ? null : parsed;
  }

  function percent(value, base) {
    return value == null || !base ? '' : `${money.format((Number(value) / Number(base)) * 100)}%`;
  }

  function deltaHtml(current, previous, goodWhenUp) {
    if (current == null || previous == null) return '<span class="delta flat">—</span>';
    const difference = Number(current) - Number(previous);
    const ratio = Number(previous) === 0 ? null : difference / Math.abs(Number(previous)) * 100;
    const direction = difference > 0 ? 'up' : difference < 0 ? 'down' : 'flat';
    const favorable = difference === 0 ? 'flat' : (difference > 0) === goodWhenUp ? 'good' : direction;
    const symbol = difference > 0 ? '▲' : difference < 0 ? '▼' : '—';
    return `<span class="delta ${favorable}">${symbol} ${money.format(Math.abs(difference))}${ratio == null ? '' : ` ${difference >= 0 ? '+' : ''}${ratio.toFixed(1)}%`}</span>`;
  }

  function comparisonValue(line) {
    const comparison = state.data.comparison || {};
    if (Object.hasOwn(comparison.lines_by_key || {}, line.line_key)) return numeric(comparison.lines_by_key[line.line_key]);
    const normalized = String(line.label || '').replace(/[（(].*?[）)]/g, '').replace(/\s+/g, '').trim();
    return Object.hasOwn(comparison.lines_by_label || {}, normalized) ? numeric(comparison.lines_by_label[normalized]) : null;
  }

  function sectionLines(section) {
    return (state.data.lines || []).filter(function (line) {
      if (line.section_key !== section) return false;
      return !['total_expenses','operating_profit','post_profit_adjustment','final_profit'].includes(line.line_key);
    }).sort(function (left, right) { return Number(left.sort_order || 0) - Number(right.sort_order || 0); });
  }

  function sectionTotal(section, lines) {
    const total = lines.find(function (line) { return line.is_total || /小计/.test(line.label || ''); });
    if (total) return total;
    const values = lines.filter(function (line) { return !line.reference_only; }).map(function (line) { return numeric(line.final_amount); });
    if (!values.length) return {final_amount: section === 'business_show' ? 0 : null, note: ''};
    if (values.some(function (value) { return value == null; })) return {final_amount: null, note: ''};
    return {final_amount: values.reduce(function (sum, value) { return sum + value; }, 0), note: ''};
  }

  function renderWaterfall(income, finalProfit) {
    const width = 1060;
    const height = 360;
    const baseline = 310;
    const top = 80;
    const max = Math.max(Number(income || 0), 1);
    const scale = (baseline - top) / max;
    const items = [{label: '收入', amount: Number(income || 0), kind: 'income'}];
    sectionOrder.slice(1).forEach(function (section) {
      const total = sectionTotal(section, sectionLines(section));
      if (total.final_amount != null && (Number(total.final_amount) !== 0 || section === 'business_show')) items.push({label: sectionLabels[section], amount: Number(total.final_amount), kind: 'cost'});
    });
    const adjustment = reportMetric('post_profit_adjustment');
    if (adjustment?.final_amount) items.push({label: 'CK结算', amount: Math.abs(Number(adjustment.final_amount)), kind: 'cost'});
    items.push({label: '最终净利', amount: Number(finalProfit || 0), kind: 'profit'});
    const step = 960 / Math.max(items.length - 1, 1);
    let running = Number(income || 0);
    const bars = items.map(function (item, index) {
      const x = 54 + index * step;
      let y;
      let barHeight;
      let color;
      if (item.kind === 'income') {
        barHeight = Math.max(1, item.amount * scale); y = baseline - barHeight; color = '#2e7d32';
      } else if (item.kind === 'profit') {
        barHeight = Math.max(1, item.amount * scale); y = baseline - barHeight; color = '#1565c0';
      } else {
        const before = running; running -= item.amount;
        barHeight = Math.max(1, item.amount * scale); y = baseline - before * scale; color = '#c62828';
      }
      const shortLabel = item.label.length > 12 ? `${item.label.slice(0, 11)}…` : item.label;
      return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="42" height="${barHeight.toFixed(1)}" fill="${color}" rx="3"/><text x="${(x + 21).toFixed(1)}" y="${Math.max(18, y - 6).toFixed(1)}" text-anchor="middle" font-size="10" fill="#333">${escapeHtml(`${(item.amount / 1000).toFixed(1)}k`)}</text><text x="${(x + 21).toFixed(1)}" y="324" text-anchor="middle" font-size="10" fill="#555" transform="rotate(28 ${(x + 21).toFixed(1)} 324)">${escapeHtml(shortLabel)}</text>`;
    }).join('');
    return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="收入到最终净利瀑布图"><line x1="50" y1="310" x2="1010" y2="310" stroke="#bbb"/>${bars}</svg>`;
  }

  function reportActions(line) {
    const editable = has('finance.manage') && (state.data.month.status === 'open' || state.data.month.historical_snapshot);
    return `<span class="report-row-actions"><button class="finance-icon-button" type="button" data-trace="${escapeHtml(line.line_key)}" title="查看计算依据" aria-label="查看${escapeHtml(line.label)}计算依据"><i class="ti ti-help-circle"></i></button>${editable ? `<button class="finance-icon-button" type="button" data-override="${escapeHtml(line.line_key)}" title="手动调整" aria-label="调整${escapeHtml(line.label)}"><i class="ti ti-edit"></i></button>` : ''}</span>`;
  }

  function renderCategory(section, income, maxExpense) {
    const all = sectionLines(section);
    const total = sectionTotal(section, all);
    const rows = all.filter(function (line) { return !(line.is_total || /小计/.test(line.label || '')); });
    const previousTotal = numeric(state.data.comparison?.category_totals?.[section]);
    const goodWhenUp = section === 'income';
    const barWidth = section === 'income' ? 2 : Math.max(2, Math.min(100, Number(total.final_amount || 0) / Math.max(maxExpense, 1) * 100));
    const currentMonth = Number(state.month.slice(5));
    const previousMonth = Number((state.data.comparison?.month || '').slice(5));
    const note = total.note || rows.map(function (line) { return line.note; }).filter(Boolean).at(-1) || '';
    return `<section class="finance-report-category">
      <div class="finance-category-head"><span class="finance-category-name">${escapeHtml(sectionLabels[section])}</span><span class="finance-category-total">${amount(total.final_amount)} <span class="pct">占收入 ${percent(total.final_amount, income)}</span> ${deltaHtml(total.final_amount, previousTotal, goodWhenUp)}</span></div>
      <div class="finance-category-bar"><div style="width:${barWidth.toFixed(1)}%"></div></div>
      <div class="finance-subs-wrap"><table class="finance-subs"><thead><tr><th>子项</th><th>${currentMonth}月</th><th>占收入</th><th>${previousMonth || '-'}月</th><th>环比</th></tr></thead><tbody>${rows.map(function (line) {
        const previous = comparisonValue(line);
        return `<tr class="${line.status === 'missing' ? 'is-missing' : ''}"><td class="sub-name"><span>${escapeHtml(line.label)}${line.manual ? '<span class="finance-line-origin"><i class="ti ti-pencil"></i>手动</span>' : ''}</span>${reportActions(line)}</td><td class="num">${amount(line.final_amount)}</td><td class="num pct">${line.reference_only ? '' : percent(line.final_amount, income)}</td><td class="num prev">${previous == null ? '—' : amount(previous)}</td><td class="num">${deltaHtml(line.final_amount, previous, goodWhenUp)}</td></tr>`;
      }).join('') || '<tr><td colspan="5" class="finance-note">本月无发生额</td></tr>'}</tbody></table></div>${note ? `<div class="finance-category-note">${escapeHtml(note)}</div>` : ''}
    </section>`;
  }

  function renderReport() {
    const incomeLine = reportMetric('income_total', reportMetric('taobao_income'));
    const expenses = reportMetric('total_expenses');
    const operating = reportMetric('operating_profit');
    const finalProfit = reportMetric('final_profit', (state.data.lines || []).at(-1));
    const income = numeric(incomeLine?.final_amount);
    const previous = state.data.comparison?.metrics || {};
    const maxExpense = Math.max.apply(null, sectionOrder.slice(1).map(function (section) { return Number(sectionTotal(section, sectionLines(section)).final_amount || 0); }).concat([1]));
    const missing = state.data.completeness?.missing?.length || 0;
    const payrollWarning = state.data.payroll_snapshot?.source_status?.source_pending_employee_count || 0;
    content.innerHTML = `${reportTabs()}<div class="finance-report-wrap">
      <header class="finance-report-title"><h1>${escapeHtml(state.month.replace('-', '年'))}月 月度财务报告</h1><div>君设计 · 中台固定算法 · 数据源与管理员调整均可追溯</div></header>
      <div class="finance-report-kpis">
        <article><span>收入</span><strong>${amount(income)}</strong><small>100%</small>${deltaHtml(income, numeric(previous.income), true)}</article>
        <article><span>支出</span><strong>${amount(expenses?.final_amount)}</strong><small>占收入 ${percent(expenses?.final_amount, income)}</small>${deltaHtml(expenses?.final_amount, numeric(previous.expenses), false)}</article>
        <article><span>最终净利</span><strong>${amount(finalProfit?.final_amount)}</strong><small>扣 CK 后 ${percent(finalProfit?.final_amount, income)}</small><em>经营净利 ${amount(operating?.final_amount)}</em></article>
      </div>
      <section class="finance-report-card finance-report-ok"><h2>口径状态</h2><div>${state.data.completeness.complete ? '本月所有必需数据已到位，分类小计、支出合计、经营净利和最终净利均由固定公式生成。' : `当前还有 ${missing} 个必需数据项待补，已有金额仍按同一套公式计算。`}${payrollWarning ? ` 生产工资中有 ${payrollWarning} 人仍受待审批记录影响。` : ''}</div></section>
      <section class="finance-report-card finance-waterfall"><h2>收入 → 最终净利 瀑布</h2>${renderWaterfall(income, finalProfit?.final_amount)}</section>
      <h2 class="finance-detail-title">支出明细（由中台数据源生成）</h2>
      ${sectionOrder.map(function (section) { return renderCategory(section, income, maxExpense); }).join('')}
      <section class="finance-report-card finance-settlement-card"><h2>经营净利与最终结算</h2><dl><dt>支出合计</dt><dd>${amount(expenses?.final_amount)}</dd><dt>经营净利</dt><dd>${amount(operating?.final_amount)}</dd><dt>CK 个人结算</dt><dd>${amount(Math.abs(reportMetric('post_profit_adjustment')?.final_amount || 0))}</dd><dt>最终净利</dt><dd><strong>${amount(finalProfit?.final_amount)}</strong></dd></dl></section>
    </div>`;
    content.querySelectorAll('[data-trace]').forEach(function (button) { button.addEventListener('click', function () { showTrace(button.dataset.trace); }); });
    content.querySelectorAll('[data-override]').forEach(function (button) { button.addEventListener('click', function () { showOverride(button.dataset.override); }); });
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

  function payrollStatus(row) {
    const labels = {ready: '应发已生成', missing_input: '待补提报', source_pending: '受待审批影响', excluded: '不计经营报表'};
    return labels[row.calculation_status] || (row.net_pay == null ? '待财务核定' : '已核定');
  }

  function payrollSortedRows() {
    return [...payrollRows()].sort(function (left, right) {
      const leftNo = String(left.employee_no || '').trim();
      const rightNo = String(right.employee_no || '').trim();
      if (leftNo && rightNo) {
        const byNo = leftNo.localeCompare(rightNo, 'zh-CN', {numeric: true});
        if (byNo) return byNo;
      } else if (leftNo || rightNo) {
        return leftNo ? -1 : 1;
      }
      return String(left.employee_name || '').localeCompare(String(right.employee_name || ''), 'zh-CN');
    });
  }

  function payrollComponent(row, key) {
    const aliases = {internal_output:['piecework'],points_settlement:['points'],other:['additional']};
    return (row.components || []).find(function (item) { return item.key === key; })
      || (row.components || []).find(function (item) { return (aliases[key] || []).includes(item.key); })
      || null;
  }

  function payrollComponentSummary(row) {
    const visible = (row.components || []).filter(function (item) {
      return item.key !== 'admin_override' && (item.amount == null || Number(item.amount) !== 0);
    });
    return visible.map(function (item) { return `${escapeHtml(item.label)} ${amount(item.amount)}`; }).join(' + ') || escapeHtml(row.calculation || '月度工资');
  }

  function renderPayroll() {
    const rows = payrollSortedRows();
    const grossTotal = rows.reduce(function (sum, row) { return sum + Number(row.gross_pay || 0); }, 0);
    const netValues = rows.map(function (row) { return numeric(row.net_pay); });
    const netTotal = netValues.some(function (value) { return value == null; }) ? null : netValues.reduce(function (sum, value) { return sum + value; }, 0);
    content.innerHTML = `${reportTabs()}<div class="payroll-sheet">
      <header class="payroll-title"><h1>${escapeHtml(state.month.replace('-', '年'))}月 工资发放单</h1></header>
      <div class="payroll-total-band"><span>${rows.length} 人</span><strong>应发合计 ${amount(grossTotal)}</strong><em>实发合计 ${amount(netTotal)}</em></div>
      <div class="payroll-payment-list">${rows.map(function (row) {
        const statusClass = row.calculation_status === 'missing_input' ? 'is-missing' : row.calculation_status === 'source_pending' ? 'is-pending' : 'is-ready';
        const pay = row.net_pay == null ? row.gross_pay : row.net_pay;
        return `<article class="payroll-payment-row ${statusClass}">
          <div class="payroll-payment-person"><strong>${escapeHtml(row.employee_no || '-')} · ${escapeHtml(row.employee_name)}</strong><span>${escapeHtml(row.role_name || row.department || '')}</span></div>
          <div class="payroll-payment-detail"><strong>${payrollComponentSummary(row)}</strong><span>应发 ${amount(row.gross_pay)} · 医社保 ${amount(row.personal_social_insurance)} · 个税 ${amount(row.income_tax)}</span></div>
          <div class="payroll-payment-bank"><i class="ti ti-building-bank"></i><span>${escapeHtml([row.payment_bank, row.payment_method].filter(Boolean).join(' · ') || '付款资料待补')}</span><strong>${escapeHtml(row.payment_account || '账号待补')}</strong></div>
          <div class="payroll-payment-amount"><small>${escapeHtml(payrollStatus(row))}</small><strong>${amount(pay)}</strong><span>${row.net_pay == null ? '当前应发' : '最终实发'}</span></div>
        </article>`;
      }).join('') || '<div class="finance-empty">尚未生成本月工资快照。</div>'}</div>
    </div>`;
  }

  function payrollRuleType(row) {
    if (row.payload?.rule_type) return row.payload.rule_type;
    const role = `${row.role_name || ''} ${row.compensation_method || ''} ${row.calculation || ''}`;
    if (/生产管理|工厂合作|合作制/.test(role)) return 'production_manager';
    if (/仓管|仓库/.test(role)) return 'warehouse';
    if (/制版|积分/.test(role)) return 'pattern_points';
    if (/企划/.test(role)) return 'planning_submission';
    if (/设计/.test(role)) return 'design_submission';
    if (/车工|计件/.test(role)) return 'production_worker';
    return 'fixed';
  }

  const companyPayrollModules = [
    {key:'production_manager',title:'工厂合作制',match:function(row){return payrollRuleType(row) === 'production_manager';},columns:[['piecework','工钱'],['management','制作管理费'],['profit','个人利润分红'],['cutting','裁床费用'],['other','其他']]},
    {key:'production_worker',title:'车工计件',match:function(row){return payrollRuleType(row) === 'production_worker';},columns:[['internal_output','内部产值'],['external_processing','外加工产值'],['output_bonus','产值奖励'],['meal_allowance','餐补'],['seniority','工龄福利'],['quality_bonus','质量奖'],['paid_leave','带薪休假福利'],['other','其他']]},
    {key:'warehouse',title:'仓管',match:function(row){return payrollRuleType(row) === 'warehouse';},columns:[['manual_work','手工提成工资'],['shipment','订单管理工资'],['other','其他']]},
    {key:'pattern_points',title:'制版',match:function(row){return payrollRuleType(row) === 'pattern_points';},columns:[['points_settlement','实际积分计数'],['paid_leave','带薪假期福利'],['performance_bonus','绩效奖金'],['other','其他']]},
    {key:'planning_submission',title:'企划',match:function(row){return payrollRuleType(row) === 'planning_submission';},columns:[['base','基础工资'],['commission','销售提成'],['other','其他']]},
    {key:'design_submission',title:'设计',match:function(row){return payrollRuleType(row) === 'design_submission';},columns:[['project','项目工资'],['sales_commission','销售提成'],['other','其他']]},
    {key:'customer_service',title:'客服',match:function(row){return payrollRuleType(row) === 'fixed' && /客服|客户/.test(`${row.role_name || ''}${row.compensation_method || ''}`);},columns:[['fixed','基础工资'],['sales_commission','销售提成'],['other','其他']]},
    {key:'fixed',title:'固定工资与助理',match:function(row){return payrollRuleType(row) === 'fixed' && !/客服|客户/.test(`${row.role_name || ''}${row.compensation_method || ''}`);},columns:[['fixed','基础工资'],['sales_commission','其他提成'],['other','其他']]},
  ];

  function companyPayrollGroups() {
    const rows = payrollSortedRows();
    return companyPayrollModules.map(function (module) {
      return {...module, rows: rows.filter(module.match)};
    });
  }

  function payrollCell(row, key) {
    const item = payrollComponent(row, key);
    if (!item) return '<span class="company-payroll-empty">-</span>';
    return `<span class="company-payroll-value ${item.adjusted ? 'is-adjusted' : ''}">${amount(item.amount)}${item.adjusted ? '<i class="ti ti-pencil" title="管理员已调整"></i>' : ''}</span>`;
  }

  function companyPayrollStatus(row) {
    const kind = row.calculation_status === 'missing_input' ? 'is-missing' : row.calculation_status === 'source_pending' ? 'is-pending' : 'is-ready';
    return `<span class="company-payroll-status ${kind}">${escapeHtml(payrollStatus(row))}</span>`;
  }

  function renderCompanyPayrollTable(module) {
    const canEdit = has('finance.manage') && state.data.month.status === 'open';
    const gross = module.rows.reduce(function(sum,row){return sum + Number(row.gross_pay || 0);},0);
    const columns = module.columns.map(function(column){return `<th class="number">${escapeHtml(column[1])}</th>`;}).join('');
    return `<section class="company-payroll-module" data-company-payroll-section="${escapeHtml(module.key)}">
      <header><div><h2>${escapeHtml(module.title)}</h2><span>${module.rows.length} 人</span></div><strong>${amount(gross)}</strong></header>
      <div class="company-payroll-table-wrap"><table class="company-payroll-table"><thead><tr><th class="company-payroll-action"></th><th class="company-payroll-no">工号</th><th class="company-payroll-name">姓名</th>${columns}<th class="number total">税前工资</th><th class="number">个人医社保</th><th class="number">个税</th><th class="number total">实发金额</th><th>状态</th><th>备注</th></tr></thead><tbody>${module.rows.map(function(row){
        const adjusted = (row.payload?.adjusted_components || []).length || row.payload?.gross_override;
        return `<tr class="${row.calculation_status === 'missing_input' ? 'is-missing' : row.calculation_status === 'source_pending' ? 'is-pending' : ''}">
          <td class="company-payroll-action">${canEdit && row.employee_id ? `<button class="finance-icon-button" data-company-payroll-edit="${escapeHtml(row.employee_id)}" title="修改${escapeHtml(row.employee_name)}本月工资" aria-label="修改${escapeHtml(row.employee_name)}本月工资"><i class="ti ti-edit"></i></button>` : ''}</td>
          <td class="company-payroll-no">${escapeHtml(row.employee_no || '-')}</td><td class="company-payroll-name"><strong>${escapeHtml(row.employee_name)}</strong><span>${escapeHtml(row.role_name || '')}</span></td>
          ${module.columns.map(function(column){return `<td class="number">${payrollCell(row,column[0])}</td>`;}).join('')}
          <td class="number total">${amount(row.gross_pay)}${adjusted ? '<i class="ti ti-pencil company-payroll-adjusted" title="含管理员调整"></i>' : ''}</td><td class="number">${amount(row.personal_social_insurance)}</td><td class="number">${amount(row.income_tax)}</td><td class="number total">${amount(row.net_pay)}</td><td>${companyPayrollStatus(row)}</td><td class="company-payroll-note" title="${escapeHtml(row.note || '')}">${escapeHtml(row.note || '-')}</td>
        </tr>`;
      }).join('')}</tbody></table></div>
    </section>`;
  }

  function applyCompanyPayrollFilter() {
    content.querySelectorAll('[data-company-payroll-module]').forEach(function(button){button.classList.toggle('active',button.dataset.companyPayrollModule === state.companyPayrollModule);});
    content.querySelectorAll('[data-company-payroll-section]').forEach(function(section){section.hidden = state.companyPayrollModule !== 'all' && section.dataset.companyPayrollSection !== state.companyPayrollModule;});
  }

  function renderCompanyPayroll() {
    const groups = companyPayrollGroups().filter(function(module){return module.rows.length;});
    const rows = payrollSortedRows();
    const gross = rows.reduce(function(sum,row){return sum + Number(row.gross_pay || 0);},0);
    content.innerHTML = `${reportTabs()}<div class="company-payroll-sheet">
      <div class="company-payroll-summary"><div><span>人员</span><strong>${rows.length}</strong></div><div><span>税前工资合计</span><strong>${amount(gross)}</strong></div><div><span>待补或待审批</span><strong>${rows.filter(function(row){return ['missing_input','source_pending'].includes(row.calculation_status);}).length}</strong></div></div>
      <nav class="company-payroll-switch" aria-label="岗位模块"><button type="button" data-company-payroll-module="all">全部</button>${groups.map(function(module){return `<button type="button" data-company-payroll-module="${escapeHtml(module.key)}">${escapeHtml(module.title)} <span>${module.rows.length}</span></button>`;}).join('')}</nav>
      <div class="company-payroll-modules">${groups.map(renderCompanyPayrollTable).join('') || '<div class="finance-empty">尚未生成本月工资快照。</div>'}</div>
    </div>`;
    content.querySelectorAll('[data-company-payroll-module]').forEach(function(button){button.addEventListener('click',function(){state.companyPayrollModule=button.dataset.companyPayrollModule;applyCompanyPayrollFilter();});});
    content.querySelectorAll('[data-company-payroll-edit]').forEach(function(button){button.addEventListener('click',function(){showPayrollInput(button.dataset.companyPayrollEdit);});});
    applyCompanyPayrollFilter();
  }

  function exportPayroll() {
    const headers = ['月份','工号','姓名','部门','职位','工资计算方式','应发金额','个税（财务核定）','个人医社保扣除（财务填写）','公司承担医社保','实发金额（公式）','电话','身份证号','工资发放方式','工资账号','银行（开户行）','计入公司财报','备注'];
    const rows = payrollSortedRows();
    const values = [headers].concat(rows.map(function (row) {
      return [state.month,row.employee_no || '',row.employee_name,row.department,row.role_name,row.compensation_method || row.calculation,row.gross_pay,row.income_tax,row.personal_social_insurance,row.employer_social_insurance,row.net_pay,row.phone || '',row.identity_no || '',row.payment_method || '',row.payment_account,row.payment_bank,row.included_in_company_report === false ? '否' : '是',row.note || ''];
    }));
    const sheet = XLSX.utils.aoa_to_sheet(values);
    rows.forEach(function (_row, index) {
      const excelRow = index + 2;
      sheet[`K${excelRow}`] = {t: 'n', f: `G${excelRow}-H${excelRow}-I${excelRow}`};
      sheet[`O${excelRow}`] = {t: 's', v: String(values[index + 1][14] || '')};
      sheet[`M${excelRow}`] = {t: 's', v: String(values[index + 1][12] || '')};
    });
    sheet['!cols'] = [9,9,12,12,14,30,12,14,20,16,16,14,22,16,24,22,14,42].map(function (width) { return {wch: width}; });
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, '财务发薪表');
    const parts = state.month.split('-');
    XLSX.writeFile(workbook, `${parts[0]}年${Number(parts[1])}月发薪表（含身份证手机号）_待个税.xlsx`);
  }

  async function importPayroll(file) {
    const workbook = XLSX.read(await file.arrayBuffer(), {type: 'array', cellDates: true});
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const raw = XLSX.utils.sheet_to_json(sheet, {defval: '', raw: false});
    const rows = raw.filter(function (item) { return String(item['姓名'] || '').trim(); }).map(function (item, index) {
      const numberOrZero = function (value) { const parsed = Number(String(value).replace(/,/g, '')); return value === '' || !Number.isFinite(parsed) ? 0 : parsed; };
      return {employee_no: String(item['工号'] || '').trim(), row_key: `${String(item['姓名']).trim()}-${index + 1}`, employee_name: String(item['姓名']).trim(), income_tax: numberOrZero(item['个税（财务核定）'] ?? item['个人所得税']), personal_social_insurance: numberOrZero(item['个人医社保扣除（财务填写）'] ?? item['个人医社保扣除']), employer_social_insurance: numberOrZero(item['公司承担医社保']), note: String(item['备注'] || '').trim()};
    });
    if (!rows.length) throw new Error('工资核算表中没有有效人员行');
    await api(`/api/finance/payroll/${state.month}/import`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({stage: 'finance_return', file_name: file.name, file_sha256: await sha256(file), rows: rows, summary: {row_count: rows.length}})});
  }

  async function loadPayroll() {
    state.data = await api(`/api/finance/months/${state.month}`);
    const snapshot = state.data.payroll_snapshot;
    toolbar.innerHTML = `${monthSelect(state.months, state.month)}${snapshot ? `<span class="finance-status ${snapshot.status === 'final' ? 'is-ready' : 'is-missing'}">${snapshot.status === 'final' ? '财务已核定' : snapshot.status === 'awaiting_finance' ? '待财务核定' : '工资草稿'}</span>` : '<span class="finance-status is-missing">尚未核算</span>'}<span class="finance-toolbar-spacer"></span><button id="payroll-print" class="btn btn-outline-secondary"><i class="ti ti-printer me-1"></i>打印</button>`;
    toolbar.querySelector('#finance-month').addEventListener('change', async function (event) { setMonth(event.target.value); await loadPayroll(); });
    toolbar.querySelector('#payroll-print').addEventListener('click', function () { window.print(); });
    renderPayroll();
  }

  async function loadCompanyPayroll() {
    if (!has('finance.payroll.manage') && !has('finance.manage')) throw new Error('没有查看公司工资表的权限');
    state.data = await api(`/api/finance/months/${state.month}`);
    const snapshot = state.data.payroll_snapshot;
    const canManagePayroll = has('finance.payroll.manage') || has('finance.manage');
    toolbar.innerHTML = `${monthSelect(state.months, state.month)}${snapshot ? `<span class="finance-status ${snapshot.status === 'final' ? 'is-ready' : 'is-missing'}">${snapshot.status === 'final' ? '财务已核定' : snapshot.status === 'awaiting_finance' ? '待财务核定' : '工资草稿'}</span>` : '<span class="finance-status is-missing">尚未核算</span>'}<span class="finance-toolbar-spacer"></span>${has('finance.manage') && state.data.month.status === 'open' ? '<button id="payroll-recalculate" class="btn btn-outline-primary"><i class="ti ti-calculator me-1"></i>重新核算</button>' : ''}${canManagePayroll ? `<button id="payroll-export" class="btn btn-outline-primary" ${payrollRows().length ? '' : 'disabled'}><i class="ti ti-file-export me-1"></i>导出给财务</button>` : ''}${canManagePayroll && payrollRows().length ? '<label class="btn btn-primary mb-0"><i class="ti ti-file-import me-1"></i>导入财务回表<input id="payroll-import" type="file" accept=".xlsx,.xls" hidden></label>' : ''}`;
    toolbar.querySelector('#finance-month').addEventListener('change', async function (event) { setMonth(event.target.value); state.companyPayrollModule = 'all'; await loadCompanyPayroll(); });
    toolbar.querySelector('#payroll-export')?.addEventListener('click', exportPayroll);
    toolbar.querySelector('#payroll-recalculate')?.addEventListener('click', async function (event) {
      event.currentTarget.disabled = true;
      try { await api(`/api/finance/payroll/${state.month}/recalculate`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: '{}'}); await loadCompanyPayroll(); }
      catch (error) { renderError(error); }
    });
    toolbar.querySelector('#payroll-import')?.addEventListener('change', async function (event) {
      const file = event.target.files[0];
      if (!file) return;
      try { await importPayroll(file); await loadCompanyPayroll(); } catch (error) { renderError(error); }
    });
    renderCompanyPayroll();
  }

  async function showPayrollInput(employeeId) {
    const foundation = await api(`/api/finance/employees?month=${encodeURIComponent(state.month)}`);
    const employee = (foundation.employees || []).find(function (item) { return item.id === employeeId; });
    const rule = (foundation.rules || []).find(function (item) { return item.employee_id === employeeId; });
    const existing = (foundation.month_inputs || []).find(function (item) { return item.employee_id === employeeId; });
    const row = payrollRows().find(function (item) { return item.employee_id === employeeId; });
    if (!employee) return;
    const inputs = existing?.inputs || {};
    const ruleType = rule?.rule_type || row?.payload?.rule_type || '';
    const module = companyPayrollModules.find(function (item) { return item.match(row || {...employee, payload:{rule_type:ruleType}}); });
    const value = function (name) {
      if (inputs[name] != null) return inputs[name];
      if (name === 'other_amount' && inputs.additional_amount != null) return inputs.additional_amount;
      return '';
    };
    const field = function (label, name, minimum) {
      return `<label>${escapeHtml(label)}<input class="form-control" type="number" step="0.01" ${minimum === false ? '' : 'min="0"'} name="${escapeHtml(name)}" value="${escapeHtml(value(name))}"></label>`;
    };
    let directFields = '';
    const directNames = [];
    const addField = function (label, name, minimum) { directNames.push(name); directFields += field(label, name, minimum); };
    if (ruleType === 'fixed') { addField('销售/其他提成', 'sales_commission'); addField('其他', 'other_amount', false); }
    if (ruleType === 'production_manager') addField('其他', 'other_amount', false);
    if (ruleType === 'warehouse') addField('其他', 'other_amount', false);
    if (ruleType === 'pattern_points') { addField('审批积分总额', 'points'); addField('带薪假期福利', 'paid_leave_amount'); addField('绩效奖金', 'performance_bonus'); addField('其他', 'other_amount', false); }
    if (ruleType === 'planning_submission') { addField('企划提报订单金额', 'sales_amount'); addField('基础工资', 'base_amount'); addField('其他', 'other_amount', false); }
    if (ruleType === 'design_submission') { addField('项目工资', 'project_amount'); addField('销售提成', 'sales_commission'); addField('其他', 'other_amount', false); }
    const directComponentKeys = {
      fixed:['sales_commission','other'],production_manager:['other'],warehouse:['other'],pattern_points:['points_settlement','paid_leave','performance_bonus','other'],planning_submission:['base','commission','other'],design_submission:['project','sales_commission','other'],
    }[ruleType] || [];
    const existingOverrides = inputs.component_overrides || {};
    const overrideFields = (module?.columns || []).filter(function (column) { return !directComponentKeys.includes(column[0]); }).map(function (column) {
      const automatic = payrollComponent(row || {}, column[0])?.automatic_amount ?? payrollComponent(row || {}, column[0])?.amount;
      return `<label>${escapeHtml(column[1])}<input class="form-control" type="number" step="0.01" name="component_${escapeHtml(column[0])}" value="${escapeHtml(existingOverrides[column[0]] ?? '')}" placeholder="自动 ${automatic == null ? '待补' : money.format(Number(automatic))}"></label>`;
    }).join('');
    const current = (row?.components || []).filter(function (item) { return item.key !== 'admin_override'; }).map(function (item) { return `<div><span>${escapeHtml(item.label)}</span><strong>${amount(item.amount)}</strong></div>`; }).join('');
    const element = dialog('finance-payroll-input-dialog', `${employee.employee_no} · ${employee.employee_name}`, `<div class="company-payroll-current">${current}</div><div class="employee-form-grid">${directFields}${overrideFields}</div><details><summary>最终税前工资覆盖</summary><label>税前工资<input class="form-control" type="number" step="0.01" min="0" name="gross_override" value="${escapeHtml(value('gross_override'))}"></label></details><label>调整原因<textarea class="form-control" rows="3" name="reason" required>${escapeHtml(existing?.reason || '')}</textarea></label><div class="finance-error" data-message hidden></div><footer><button class="btn btn-outline-secondary" value="cancel">取消</button><button class="btn btn-primary" type="button" data-save>保存并重算</button></footer>`);
    element.querySelector('[data-save]').addEventListener('click', async function () {
      const values = {};
      directNames.forEach(function (name) { const input = element.querySelector(`[name="${name}"]`); if (input?.value !== '') values[name] = Number(input.value); });
      const componentOverrides = {};
      element.querySelectorAll('[name^="component_"]').forEach(function (input) { if (input.value !== '') componentOverrides[input.name.replace('component_','')] = Number(input.value); });
      if (Object.keys(componentOverrides).length) values.component_overrides = componentOverrides;
      const grossOverride = element.querySelector('[name="gross_override"]');
      if (grossOverride.value !== '') values.gross_override = Number(grossOverride.value);
      const message = element.querySelector('[data-message]');
      try {
        await api(`/api/finance/payroll/${state.month}/inputs/${employeeId}`, {method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({inputs: values, reason: element.querySelector('[name="reason"]').value, expected_version: existing?.version || null})});
        await api(`/api/finance/payroll/${state.month}/recalculate`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: '{}'});
        element.close(); await loadCompanyPayroll();
      } catch (error) { message.hidden = false; message.textContent = error.message; }
    });
  }

  function maskValue(value, start, end) {
    const text = String(value || '');
    if (!text) return '-';
    if (text.length <= start + end) return text;
    return `${text.slice(0, start)}${'•'.repeat(Math.min(8, text.length - start - end))}${text.slice(-end)}`;
  }

  function ruleFields(type, parameters) {
    const p = parameters || {};
    const field = function (label, name, value, step) { return `<label>${label}<input class="form-control" type="number" min="0" step="${step || '0.01'}" name="rule_${name}" value="${escapeHtml(value ?? '')}"></label>`; };
    if (type === 'fixed') return field('固定工资', 'amount', p.amount);
    if (type === 'production_worker') return `<label>生产记工姓名<input class="form-control" name="rule_source_worker_name" value="${escapeHtml(p.source_worker_name || '')}"></label>`;
    if (type === 'warehouse') return field('每件发货工资', 'shipment_rate', p.shipment_rate ?? 21);
    if (type === 'pattern_points') return `${field('积分阈值', 'threshold', p.threshold ?? 4000, '1')}${field('超出部分倍率', 'excess_multiplier', p.excess_multiplier ?? 1.2)}`;
    if (type === 'planning_submission') return `${field('基础/售后金额', 'base_amount', p.base_amount ?? 2500)}${field('订单提成率', 'commission_rate', p.commission_rate ?? 0.05, '0.001')}`;
    return '';
  }

  function employeeRule(employeeId) {
    return (state.employeeFoundation?.rules || []).find(function (rule) { return rule.employee_id === employeeId; }) || null;
  }

  function renderEmployees() {
    const employees = state.employeeFoundation?.employees || [];
    content.innerHTML = `${reportTabs()}<section class="employee-panel"><div class="employee-summary"><div><strong>${employees.filter(function (item) { return item.active; }).length}</strong><span>当前在册</span></div><div><strong>${employees.filter(function (item) { return item.has_social_insurance; }).length}</strong><span>有医社保</span></div><div><strong>${employees.filter(function (item) { return item.included_in_company_report === false; }).length}</strong><span>工资不计经营财报</span></div></div><div class="finance-table-wrap"><table class="finance-table employee-table"><thead><tr><th>工号 / 姓名</th><th>部门 / 职位</th><th>计薪方式</th><th class="number">基础工资</th><th>医社保</th><th>付款资料</th><th>经营财报</th><th></th></tr></thead><tbody>${employees.map(function (employee) {
      return `<tr class="${employee.active ? '' : 'is-inactive'}"><td><strong>${escapeHtml(employee.employee_no)} · ${escapeHtml(employee.employee_name)}</strong><div class="finance-note">${escapeHtml(employee.nickname || '')}</div></td><td>${escapeHtml(employee.department)}<div class="finance-note">${escapeHtml(employee.role_name)}</div></td><td>${escapeHtml(employee.compensation_method || employeeRule(employee.id)?.rule_type || '-')}</td><td class="number">${amount(employee.base_salary)}</td><td>${employee.has_social_insurance ? '有' : '无'}</td><td>${escapeHtml(employee.payment_bank || '-')}<div class="finance-note">${escapeHtml(maskValue(employee.payment_account, 4, 4))}</div></td><td>${employee.included_in_company_report === false ? '<span class="badge bg-orange-lt">不计入</span>' : '<span class="badge bg-green-lt">计入</span>'}</td><td><button class="finance-icon-button" data-employee="${escapeHtml(employee.id)}" title="查看并编辑员工资料"><i class="ti ti-edit"></i></button></td></tr>`;
    }).join('') || '<tr><td colspan="8"><div class="finance-empty">员工主档尚未导入</div></td></tr>'}</tbody></table></div></section>`;
    content.querySelectorAll('[data-employee]').forEach(function (button) { button.addEventListener('click', function () { showEmployeeDialog((state.employeeFoundation.employees || []).find(function (item) { return item.id === button.dataset.employee; })); }); });
  }

  function showEmployeeDialog(employee) {
    const rule = employee ? employeeRule(employee.id) : null;
    const ruleType = rule?.rule_type || 'fixed';
    const element = dialog('finance-employee-dialog', employee ? `员工资料 · ${employee.employee_name}` : '新增员工', `<div class="employee-form-grid"><label>工号<input class="form-control" name="employee_no" required value="${escapeHtml(employee?.employee_no || '')}"></label><label>姓名<input class="form-control" name="employee_name" required value="${escapeHtml(employee?.employee_name || '')}"></label><label>称呼<input class="form-control" name="nickname" value="${escapeHtml(employee?.nickname || '')}"></label><label>性别<select class="form-select" name="gender"><option value="">未填</option><option value="男">男</option><option value="女">女</option></select></label><label>出生日期<input class="form-control" type="date" name="birth_date" value="${escapeHtml(employee?.birth_date || '')}"></label><label>手机号<input class="form-control" name="phone" value="${escapeHtml(employee?.phone || '')}"></label><label>身份证号<input class="form-control" name="identity_no" value="${escapeHtml(employee?.identity_no || '')}"></label><label class="span-2">身份证地址<input class="form-control" name="identity_address" value="${escapeHtml(employee?.identity_address || '')}"></label><label>部门<input class="form-control" name="department" value="${escapeHtml(employee?.department || '')}"></label><label>职位<input class="form-control" name="role_name" value="${escapeHtml(employee?.role_name || '')}"></label><label class="span-2">工资计算方式<input class="form-control" name="compensation_method" value="${escapeHtml(employee?.compensation_method || '')}"></label><label>基础工资<input class="form-control" type="number" min="0" step="0.01" name="base_salary" value="${escapeHtml(employee?.base_salary ?? 0)}"></label><label>餐补基数<input class="form-control" type="number" min="0" step="0.01" name="meal_allowance_rate" value="${escapeHtml(employee?.meal_allowance_rate ?? 0)}"></label><label>工龄补贴<input class="form-control" type="number" min="0" step="0.01" name="seniority_allowance" value="${escapeHtml(employee?.seniority_allowance ?? 0)}"></label><label>其他固定补贴<input class="form-control" type="number" min="0" step="0.01" name="fixed_allowance" value="${escapeHtml(employee?.fixed_allowance ?? 0)}"></label><label>发放方式<input class="form-control" name="payment_method" value="${escapeHtml(employee?.payment_method || '')}"></label><label>工资账号<input class="form-control" name="payment_account" value="${escapeHtml(employee?.payment_account || '')}"></label><label class="span-2">开户行<input class="form-control" name="payment_bank" value="${escapeHtml(employee?.payment_bank || '')}"></label><label>入职日期<input class="form-control" type="date" name="employment_start" value="${escapeHtml(employee?.employment_start || '')}"></label><label>离职日期<input class="form-control" type="date" name="employment_end" value="${escapeHtml(employee?.employment_end || '')}"></label></div><div class="employee-checks"><label class="form-check"><input class="form-check-input" type="checkbox" name="has_social_insurance" ${employee?.has_social_insurance ? 'checked' : ''}><span>有医社保</span></label><label class="form-check"><input class="form-check-input" type="checkbox" name="included_in_company_report" ${employee?.included_in_company_report === false ? '' : 'checked'}><span>计入公司经营财报</span></label><label class="form-check"><input class="form-check-input" type="checkbox" name="active" ${employee?.active === false ? '' : 'checked'}><span>当前在册</span></label></div><hr><div class="employee-form-grid"><label>计薪规则<select class="form-select" name="rule_type"><option value="fixed">固定工资</option><option value="production_worker">生产车工</option><option value="production_manager">生产负责人</option><option value="warehouse">仓管</option><option value="pattern_points">制版积分</option><option value="planning_submission">企划提报</option><option value="design_submission">设计提报</option></select></label><label>规则开始月份<input class="form-control" type="month" name="rule_start_month" value="${escapeHtml(rule?.start_month || state.month)}"></label><div class="span-2 employee-rule-fields"></div><label class="form-check span-2"><input class="form-check-input" type="checkbox" name="self_funded_social" ${rule?.parameters?.self_funded_social ? 'checked' : ''}><span>医社保全部从个人工资扣回</span></label><label class="span-2">备注<textarea class="form-control" name="note" rows="3">${escapeHtml(employee?.note || '')}</textarea></label></div><div class="finance-error" data-message hidden></div><footer><button class="btn btn-outline-secondary" value="cancel">取消</button><button class="btn btn-primary" type="button" data-save>保存</button></footer>`);
    element.querySelector('[name="gender"]').value = employee?.gender || '';
    element.querySelector('[name="rule_type"]').value = ruleType;
    const refreshRuleFields = function () { element.querySelector('.employee-rule-fields').innerHTML = ruleFields(element.querySelector('[name="rule_type"]').value, rule?.parameters || {}); };
    element.querySelector('[name="rule_type"]').addEventListener('change', refreshRuleFields); refreshRuleFields();
    element.querySelector('[data-save]').addEventListener('click', async function () {
      const value = function (name) { return element.querySelector(`[name="${name}"]`)?.value || ''; };
      const numberValue = function (name) { const raw = value(name); return raw === '' ? 0 : Number(raw); };
      const values = {employee_no:value('employee_no'),employee_name:value('employee_name'),nickname:value('nickname'),gender:value('gender'),birth_date:value('birth_date'),identity_no:value('identity_no'),identity_address:value('identity_address'),phone:value('phone'),department:value('department'),role_name:value('role_name'),compensation_method:value('compensation_method'),has_social_insurance:element.querySelector('[name="has_social_insurance"]').checked,base_salary:numberValue('base_salary'),meal_allowance_rate:numberValue('meal_allowance_rate'),seniority_allowance:numberValue('seniority_allowance'),fixed_allowance:numberValue('fixed_allowance'),payment_method:value('payment_method'),payment_account:value('payment_account').replace(/\s/g,''),payment_bank:value('payment_bank'),included_in_company_report:element.querySelector('[name="included_in_company_report"]').checked,employment_start:value('employment_start'),employment_end:value('employment_end'),active:element.querySelector('[name="active"]').checked,note:value('note')};
      const parameters = {self_funded_social: element.querySelector('[name="self_funded_social"]').checked};
      element.querySelectorAll('.employee-rule-fields [name]').forEach(function (field) { const key = field.name.replace('rule_',''); parameters[key] = field.type === 'number' ? Number(field.value || 0) : field.value; });
      const payload = {id:employee?.id || null,expected_version:employee?.version || null,values,rule:{rule_type:value('rule_type'),start_month:value('rule_start_month'),end_month:rule?.end_month || '',parameters,note:value('note')}};
      const message = element.querySelector('[data-message]');
      try { await api('/api/finance/employees', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}); element.close(); await loadEmployees(); }
      catch (error) { message.hidden = false; message.textContent = error.message; }
    });
  }

  async function loadEmployees() {
    state.employeeFoundation = await api(`/api/finance/employees?month=${encodeURIComponent(state.month)}`);
    toolbar.innerHTML = `${monthSelect(state.months, state.month)}<span class="finance-toolbar-spacer"></span><button id="employee-add" class="btn btn-primary"><i class="ti ti-user-plus me-1"></i>新增员工</button>`;
    toolbar.querySelector('#finance-month').addEventListener('change', async function (event) { setMonth(event.target.value); await loadEmployees(); });
    toolbar.querySelector('#employee-add').addEventListener('click', function () { showEmployeeDialog(null); });
    renderEmployees();
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
    if (page === 'finance-company-payroll') return await loadCompanyPayroll();
    if (page === 'finance-payroll') return await loadPayroll();
    if (page === 'finance-sources') return await loadSources();
    if (page === 'finance-employees') return await loadEmployees();
    throw new Error('未知财务页面');
  }

  init().catch(renderError);
})();
