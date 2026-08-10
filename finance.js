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
    pattern_approval: '制版审批',
  };
  const sectionLabels = {
    income: '收入', product_cost: '产品成本', platform_operations: '平台运营费用',
    logistics: '物流', customer_service: '客服', rent_food_equipment: '场地费用',
    design: '设计', factory_manager: '工厂运营·厂长费用', business_show: '商务（走秀开支）',
    company_social: '员工其他支出', software: '软件费用', finance_fee: '财务费用',
  };
  const manualParentLabels = {
    income:'收入',product_cost:'产品成本',platform_operations:'平台运营费用',logistics:'物流',
    customer_service:'客服',rent_food_equipment:'场地费用',design:'设计',factory_manager:'工厂运营·厂长费用',
    business_show:'商务（走秀开支）',company_social:'员工其他支出',software:'软件费用',finance_fee:'财务费用',adjustment:'利润后调整',
  };
  const automaticSourceSections = {
    taobao_income_order:'income',taobao_platform_charge:'platform_operations',promotion_charge:'platform_operations',
    logistics_sf:'logistics',logistics_other:'logistics',manual_work:'product_cost',erp_shipment:'logistics',pattern_approval:'product_cost',
  };
  const recurringCategorySections = {
    rent_utilities:'rent_food_equipment',office:'rent_food_equipment',equipment:'rent_food_equipment',renovation:'rent_food_equipment',other:'rent_food_equipment',
    software:'software',finance_fee:'finance_fee',
  };
  const recurringCategoryLabels = {
    rent_utilities:'场地费用 · 房租水电',office:'场地费用 · 办公食杂',equipment:'场地费用 · 机器设备',renovation:'场地费用 · 装修',other:'场地费用 · 其他',
    software:'软件费用',finance_fee:'财务费用',
  };
  const sectionOrder = ['income','product_cost','platform_operations','logistics','customer_service','rent_food_equipment','design','factory_manager','business_show','company_social','software','finance_fee'];
  const state = {months: [], month: '', data: null, sourceType: 'taobao_income_order', offset: 0, limit: 100, sourceTotal: 0, companyPayrollModule: 'all', shipmentCompare: ''};

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
    const group = page.startsWith('finance-') ? '/jun-pages/finance' : page.startsWith('production-') ? '/jun-pages/production' : '/jun-pages/erp';
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
    return `<span class="report-row-actions"><button class="finance-icon-button" type="button" data-trace="${escapeHtml(line.line_key)}" title="查看计算依据" aria-label="查看${escapeHtml(line.label)}计算依据"><i class="ti ti-help-circle"></i></button></span>`;
  }

  function traceAmount(line) {
    if (!line?.line_key) return amount(line?.final_amount);
    return `<button class="finance-trace-amount" type="button" data-trace="${escapeHtml(line.line_key)}">${amount(line.final_amount)}</button>`;
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
      <div class="finance-category-head"><span class="finance-category-name">${escapeHtml(sectionLabels[section])}</span><span class="finance-category-total">${traceAmount(total)} <span class="pct">占收入 ${percent(total.final_amount, income)}</span> ${deltaHtml(total.final_amount, previousTotal, goodWhenUp)}</span></div>
      <div class="finance-category-bar"><div style="width:${barWidth.toFixed(1)}%"></div></div>
      <div class="finance-subs-wrap"><table class="finance-subs"><thead><tr><th>子项</th><th>${currentMonth}月</th><th>占收入</th><th>${previousMonth || '-'}月</th><th>环比</th></tr></thead><tbody>${rows.map(function (line) {
        const previous = comparisonValue(line);
        return `<tr class="${line.status === 'missing' ? 'is-missing' : ''}"><td class="sub-name"><span>${escapeHtml(line.label)}</span>${reportActions(line)}</td><td class="num">${traceAmount(line)}</td><td class="num pct">${line.reference_only ? '' : percent(line.final_amount, income)}</td><td class="num prev">${previous == null ? '—' : amount(previous)}</td><td class="num">${deltaHtml(line.final_amount, previous, goodWhenUp)}</td></tr>`;
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
      <header class="finance-report-title"><h1>${escapeHtml(state.month.replace('-', '年'))}月 月度财务报告</h1><div>君设计 · 纯展示 · 每个金额都由唯一来源和固定公式生成</div></header>
      <div class="finance-report-kpis">
        <article><span>收入</span><strong>${traceAmount(incomeLine)}</strong><small>100%</small>${deltaHtml(income, numeric(previous.income), true)}</article>
        <article><span>支出</span><strong>${traceAmount(expenses)}</strong><small>占收入 ${percent(expenses?.final_amount, income)}</small>${deltaHtml(expenses?.final_amount, numeric(previous.expenses), false)}</article>
        <article><span>最终净利</span><strong>${traceAmount(finalProfit)}</strong><small>扣 CK 后 ${percent(finalProfit?.final_amount, income)}</small><em>经营净利 ${traceAmount(operating)}</em></article>
      </div>
      <section class="finance-report-card finance-report-ok"><h2>口径状态</h2><div>${state.data.completeness.complete ? '本月所有必需数据已到位，分类小计、支出合计、经营净利和最终净利均由固定公式生成。' : `当前还有 ${missing} 个必需数据项待补，已有金额仍按同一套公式计算。`}${payrollWarning ? ` 生产工资中有 ${payrollWarning} 人仍受待审批记录影响。` : ''}</div></section>
      <section class="finance-report-card finance-waterfall"><h2>收入 → 最终净利 瀑布</h2>${renderWaterfall(income, finalProfit?.final_amount)}</section>
      <h2 class="finance-detail-title">支出明细（由中台数据源生成）</h2>
      ${sectionOrder.map(function (section) { return renderCategory(section, income, maxExpense); }).join('')}
      <section class="finance-report-card finance-settlement-card"><h2>经营净利与最终结算</h2><dl><dt>支出合计</dt><dd>${traceAmount(expenses)}</dd><dt>经营净利</dt><dd>${traceAmount(operating)}</dd><dt>CK 个人结算</dt><dd>${traceAmount(reportMetric('post_profit_adjustment'))}</dd><dt>最终净利</dt><dd><strong>${traceAmount(finalProfit)}</strong></dd></dl></section>
    </div>`;
    content.querySelectorAll('[data-trace]').forEach(function (button) { button.addEventListener('click', function () { showTrace(button.dataset.trace); }); });
  }

  function showTrace(lineKey) {
    const line = state.data.lines.find(function (item) { return item.line_key === lineKey; });
    if (!line) return;
    const trace = line.trace || {};
    const origin = trace.kind === 'historical_snapshot' ? '历史月报快照' : trace.kind === 'formula' ? '固定公式' : '已连接的数据源';
    const dependencies = (trace.dependencies || []).map(function (key) {
      const dependency = state.data.lines.find(function (item) { return item.line_key === key; });
      return dependency ? `<button type="button" class="finance-lineage-chip" data-trace-dependency="${escapeHtml(key)}">${escapeHtml(dependency.label)} · ${amount(dependency.final_amount)}</button>` : '';
    }).join('');
    const sourceLink = trace.source_url ? `<a class="btn btn-outline-primary btn-sm" href="${escapeHtml(trace.source_url)}">${escapeHtml(trace.source_label || '查看数据源')}<i class="ti ti-arrow-right ms-1"></i></a>` : '';
    const element = dialog('finance-trace-dialog', line.label, `<div class="finance-trace finance-trace-simple"><dl><dt>金额</dt><dd><strong>${amount(line.final_amount)}</strong></dd><dt>类型</dt><dd>${escapeHtml(origin)}</dd><dt>计算方式</dt><dd>${escapeHtml(trace.formula || trace.note || '按来源原值展示')}</dd></dl>${dependencies ? `<div class="finance-lineage-links"><span>公式引用</span>${dependencies}</div>` : ''}${sourceLink ? `<div class="finance-lineage-source">${sourceLink}</div>` : ''}</div>`);
    element.querySelectorAll('[data-trace-dependency]').forEach(function (button) {
      button.addEventListener('click', function () { element.close(); showTrace(button.dataset.traceDependency); });
    });
  }

  async function sha256(file) {
    const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
    return Array.from(new Uint8Array(digest)).map(function (byte) { return byte.toString(16).padStart(2, '0'); }).join('');
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
    if (row.payload?.finance_managed_gross && row.gross_pay == null) return '待财务核定应发';
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

  function showPayrollDetail(rowId) {
    const row = payrollRows().find(function (item) { return item.id === rowId; });
    if (!row) return;
    const components = (row.components || []).filter(function (item) { return item.amount == null || Number(item.amount) !== 0; }).map(function (item) {
      const source = item.source_url ? `<a href="${escapeHtml(item.source_url)}">${escapeHtml(item.source_label || '查看来源')}<i class="ti ti-arrow-right"></i></a>` : '';
      return `<li><div><span>${escapeHtml(item.label)}</span><strong>${amount(item.amount)}</strong></div><p>${escapeHtml(item.formula || '按来源原值计入')}</p>${source}</li>`;
    }).join('');
    const insured = row.payload?.has_social_insurance === true;
    const selfFundedSocial = row.payload?.self_funded_social === true;
    const netFormula = row.net_pay == null
      ? `<div class="payroll-net-pending"><i class="ti ti-alert-circle"></i>${row.payload?.finance_managed_gross && row.gross_pay == null ? '应发金额等待财务回表核定；' : ''}个税尚未由财务确认${insured ? `，个人医社保${selfFundedSocial ? '和公司代缴医社保' : ''}也尚未确认` : ''}，因此实发金额待补。</div>`
      : selfFundedSocial
        ? `<div class="payroll-net-formula"><span>${amount(row.gross_pay)}</span><i>−</i><span>${amount(row.personal_social_insurance)}</span><i>−</i><span>${amount(row.employer_social_insurance)}</span><i>−</i><span>${amount(row.income_tax)}</span><i>=</i><strong>${amount(row.net_pay)}</strong><small>税前工资　个人医社保　公司代缴医社保　个税　实发</small></div>`
      : insured
        ? `<div class="payroll-net-formula"><span>${amount(row.gross_pay)}</span><i>−</i><span>${amount(row.personal_social_insurance)}</span><i>−</i><span>${amount(row.income_tax)}</span><i>=</i><strong>${amount(row.net_pay)}</strong><small>税前工资　个人医社保　个税　实发</small></div>`
        : `<div class="payroll-net-formula"><span>${amount(row.gross_pay)}</span><i>−</i><span>${amount(row.income_tax)}</span><i>=</i><strong>${amount(row.net_pay)}</strong><small>税前工资　个税　实发（本月无医社保）</small></div>`;
    dialog('payroll-detail-dialog', `${row.employee_name} · 工资详情`, `<div class="payroll-detail-dialog"><div class="payroll-detail-net"><span>实发金额</span><strong>${amount(row.net_pay)}</strong></div>${netFormula}<h4>税前工资组成</h4><ul>${components || '<li>暂无工资组成</li>'}</ul></div>`);
  }

  async function setPayrollPaid(rowId, checked, control) {
    const row = payrollRows().find(function (item) { return item.id === rowId; });
    if (!row) return;
    control.disabled = true;
    try {
      const saved = await api(`/api/finance/payroll/${state.month}/payments/${rowId}`, {
        method: 'PUT', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({is_paid: checked, expected_version: row.payment?.version || null, note: checked ? '管理员确认已发放' : '管理员撤销已发放标记'}),
      });
      row.payment = saved;
      await loadPayroll();
    } catch (error) {
      control.checked = !checked;
      control.disabled = false;
      window.alert(error.message);
    }
  }

  function renderPayroll() {
    const rows = payrollSortedRows();
    const grossTotal = rows.reduce(function (sum, row) { return sum + Number(row.gross_pay || 0); }, 0);
    const netValues = rows.map(function (row) { return numeric(row.net_pay); });
    const netTotal = netValues.some(function (value) { return value == null; }) ? null : netValues.reduce(function (sum, value) { return sum + value; }, 0);
    content.innerHTML = `${reportTabs()}<div class="payroll-sheet">
      <header class="payroll-title"><h1>${escapeHtml(state.month.replace('-', '年'))}月 工资发放单</h1></header>
      <div class="payroll-total-band"><span>${rows.length} 人</span><strong>实发合计 ${amount(netTotal)}</strong><em>税前合计 ${amount(grossTotal)}</em></div>
      <div class="payroll-payment-list">${rows.map(function (row) {
        const statusClass = row.calculation_status === 'missing_input' ? 'is-missing' : row.calculation_status === 'source_pending' ? 'is-pending' : 'is-ready';
        const paymentReady = state.data.payroll_snapshot?.status === 'final' && row.net_pay != null;
        const paid = row.payment?.is_paid === true;
        const adminControl = window.JUN_CONTEXT?.profile?.role === 'admin'
          ? `<label class="payroll-paid-control ${paid ? 'is-paid' : ''}"><input type="checkbox" data-payroll-paid="${escapeHtml(row.id)}" ${paid ? 'checked' : ''} ${paymentReady ? '' : 'disabled'}><span>${paid ? '已发' : '未发'}</span></label>`
          : `<span class="payroll-paid-state ${paid ? 'is-paid' : ''}">${paid ? '已发' : '未发'}</span>`;
        return `<article class="payroll-payment-row ${statusClass}">
          <div class="payroll-payment-person"><strong>${escapeHtml(row.employee_name)}</strong><span>${escapeHtml(row.role_name || row.department || '')}</span></div>
          <div class="payroll-payment-bank"><i class="ti ti-building-bank"></i><span>${escapeHtml([row.payment_bank, row.payment_method].filter(Boolean).join(' · ') || '付款资料待补')}</span><strong>${escapeHtml(row.payment_account || '账号待补')}</strong></div>
          <button type="button" class="payroll-payment-amount" data-payroll-detail="${escapeHtml(row.id)}"><small>${row.net_pay == null ? '实发待财务核定' : '点击查看金额组成'}</small><strong>${amount(row.net_pay)}</strong><span>实发</span></button>
          <div class="payroll-payment-state">${adminControl}</div>
        </article>`;
      }).join('') || '<div class="finance-empty">尚未生成本月工资快照。</div>'}</div>
    </div>`;
    content.querySelectorAll('[data-payroll-detail]').forEach(function (button) { button.addEventListener('click', function () { showPayrollDetail(button.dataset.payrollDetail); }); });
    content.querySelectorAll('[data-payroll-paid]').forEach(function (checkbox) { checkbox.addEventListener('change', function () { setPayrollPaid(checkbox.dataset.payrollPaid, checkbox.checked, checkbox); }); });
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
    {key:'pattern_points',title:'制版',match:function(row){return payrollRuleType(row) === 'pattern_points';},columns:[['points_settlement','制版积分结算'],['paid_leave','带薪假期福利'],['performance_bonus','绩效奖金'],['other','其他']]},
    {key:'planning_submission',title:'企划',match:function(row){return payrollRuleType(row) === 'planning_submission';},columns:[['base','基础工资'],['commission','销售提成'],['show_cooperation','走秀合作'],['other','其他']]},
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

  function payrollManualInputKey(row, key) {
    const type = payrollRuleType(row);
    const mapping = {
      fixed: {sales_commission:'sales_commission', other:'other_amount'},
      production_manager: {other:'other_amount'},
      warehouse: {other:'other_amount'},
      pattern_points: {paid_leave:'paid_leave_amount', performance_bonus:'performance_bonus', other:'other_amount'},
      planning_submission: {commission:'sales_amount', show_cooperation:'show_cooperation_amount', other:'other_amount'},
      design_submission: {project:'project_amount', sales_commission:'sales_commission', other:'other_amount'},
    };
    return mapping[type]?.[key] || null;
  }

  function payrollCell(row, key) {
    const item = payrollComponent(row, key);
    if (!item) return '<span class="company-payroll-empty">-</span>';
    const inputKey = payrollManualInputKey(row, key);
    const manual = Boolean(inputKey) && has('finance.manage') && state.data.month.status === 'open';
    return `<button type="button" class="company-payroll-value ${manual ? 'is-manual-source' : 'is-linked-source'}" data-component-row="${escapeHtml(row.id)}" data-component-key="${escapeHtml(key)}" ${manual ? `data-source-input="${escapeHtml(inputKey)}"` : ''}>${amount(item.amount)}<i class="ti ti-${manual ? 'pencil' : 'link'}"></i></button>`;
  }

  function showPayrollComponent(row, key) {
    const item = payrollComponent(row, key);
    if (!item) return;
    const source = item.source_url ? `<a class="btn btn-outline-primary btn-sm" href="${escapeHtml(item.source_url)}">${escapeHtml(item.source_label || '查看来源')}<i class="ti ti-arrow-right ms-1"></i></a>` : '';
    dialog('payroll-component-dialog', `${row.employee_name} · ${item.label}`, `<div class="finance-trace finance-trace-simple"><dl><dt>金额</dt><dd><strong>${amount(item.amount)}</strong></dd><dt>计算方式</dt><dd>${escapeHtml(item.formula || '按来源原值计入')}</dd><dt>数据性质</dt><dd>${item.input_key ? '工资表人工源数据' : item.source_kind === 'rule' ? '生效计薪规则' : '自动引用或公式计算'}</dd></dl>${source ? `<div class="finance-lineage-source">${source}</div>` : ''}</div>`);
  }

  function companyPayrollStatus(row) {
    const kind = row.calculation_status === 'missing_input' ? 'is-missing' : row.calculation_status === 'source_pending' ? 'is-pending' : 'is-ready';
    return `<span class="company-payroll-status ${kind}">${escapeHtml(payrollStatus(row))}</span>`;
  }

  function companyPayrollMonthNote(row) {
    const note = row.payload?.month_note || row.note || '';
    const editable = has('finance.manage') && state.data.month.status === 'open';
    if (!editable) return `<span title="${escapeHtml(note)}">${escapeHtml(note || '-')}</span>`;
    return `<button type="button" class="company-payroll-note-button" data-payroll-month-note="${escapeHtml(row.employee_id)}" title="编辑只适用于本月的备注"><span>${escapeHtml(note || '填写当月备注')}</span><i class="ti ti-pencil"></i></button>`;
  }

  function renderCompanyPayrollTable(module) {
    const gross = module.rows.reduce(function(sum,row){return sum + Number(row.gross_pay || 0);},0);
    const columns = module.columns.map(function(column){return `<th class="number">${escapeHtml(column[1])}</th>`;}).join('');
    return `<section class="company-payroll-module" data-company-payroll-section="${escapeHtml(module.key)}">
      <header><div><h2>${escapeHtml(module.title)}</h2><span>${module.rows.length} 人</span></div><strong>${amount(gross)}</strong></header>
      <div class="company-payroll-table-wrap"><table class="company-payroll-table"><thead><tr><th class="company-payroll-name">姓名</th>${columns}<th class="number total">税前工资</th><th class="number">个人医社保</th><th class="number">个税</th><th class="number total">实发金额</th><th>状态</th><th>当月备注</th><th>固定备注</th></tr></thead><tbody>${module.rows.map(function(row){
        return `<tr class="${row.calculation_status === 'missing_input' ? 'is-missing' : row.calculation_status === 'source_pending' ? 'is-pending' : ''}">
          <td class="company-payroll-name" id="payroll-row-${escapeHtml(row.employee_id)}"><strong>${escapeHtml(row.employee_name)}</strong><span>${escapeHtml(row.role_name || '')}</span></td>
          ${module.columns.map(function(column){return `<td class="number">${payrollCell(row,column[0])}</td>`;}).join('')}
          <td class="number total"><button type="button" class="company-payroll-total-link" data-payroll-detail="${escapeHtml(row.id)}">${amount(row.gross_pay)}</button></td><td class="number">${row.payload?.has_social_insurance ? `<button type="button" class="company-payroll-total-link" data-payroll-detail="${escapeHtml(row.id)}">${amount(row.personal_social_insurance)}</button>` : '<span class="company-payroll-na">不适用</span>'}</td><td class="number"><button type="button" class="company-payroll-total-link" data-payroll-detail="${escapeHtml(row.id)}">${amount(row.income_tax)}</button></td><td class="number total"><button type="button" class="company-payroll-total-link is-net" data-payroll-detail="${escapeHtml(row.id)}">${amount(row.net_pay)}</button></td><td>${companyPayrollStatus(row)}</td><td class="company-payroll-note">${companyPayrollMonthNote(row)}</td><td class="company-payroll-note" title="${escapeHtml(row.payload?.finance_note || '')}">${escapeHtml(row.payload?.finance_note || '-')}</td>
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
      <div class="company-payroll-summary"><div><span>人员</span><strong>${rows.length}</strong></div><div><span>税前工资合计</span><strong>${amount(gross)}</strong></div><div><span>待补源数据</span><strong>${rows.filter(function(row){return ['missing_input','source_pending'].includes(row.calculation_status);}).length}</strong></div></div>
      <nav class="company-payroll-switch" aria-label="岗位模块"><button type="button" data-company-payroll-module="all">全部</button>${groups.map(function(module){return `<button type="button" data-company-payroll-module="${escapeHtml(module.key)}">${escapeHtml(module.title)} <span>${module.rows.length}</span></button>`;}).join('')}</nav>
      <div class="company-payroll-modules">${groups.map(renderCompanyPayrollTable).join('') || '<div class="finance-empty">尚未生成本月工资快照。</div>'}</div>
    </div>`;
    content.querySelectorAll('[data-company-payroll-module]').forEach(function(button){button.addEventListener('click',function(){state.companyPayrollModule=button.dataset.companyPayrollModule;applyCompanyPayrollFilter();});});
    content.querySelectorAll('[data-component-row]').forEach(function(button){button.addEventListener('click',function(){
      const row = payrollRows().find(function(item){return item.id === button.dataset.componentRow;});
      if (!row) return;
      if (button.dataset.sourceInput) showPayrollInput(row.employee_id, button.dataset.sourceInput);
      else showPayrollComponent(row, button.dataset.componentKey);
    });});
    content.querySelectorAll('[data-payroll-detail]').forEach(function(button){button.addEventListener('click',function(){showPayrollDetail(button.dataset.payrollDetail);});});
    content.querySelectorAll('[data-payroll-month-note]').forEach(function(button){button.addEventListener('click',function(){showPayrollMonthNote(button.dataset.payrollMonthNote);});});
    applyCompanyPayrollFilter();
  }

  function exportPayroll() {
    const headers = ['月份','工号','姓名','部门','职位','应发金额','个税（财务核定）','个人医社保扣除（财务填写）','公司承担医社保','实发金额','电话','身份证号','工资发放方式','工资账号','银行（开户行）','财务备注'];
    const rows = payrollSortedRows();
    const values = [headers].concat(rows.map(function (row) {
      return [state.month,row.employee_no || '',row.employee_name,row.department,row.role_name,row.gross_pay,row.income_tax,row.payload?.has_social_insurance ? row.personal_social_insurance : '',row.payload?.has_social_insurance ? row.employer_social_insurance : '',row.net_pay,row.phone || '',row.identity_no || '','银行转账',row.payment_account,row.payment_bank,row.payload?.finance_note || ''];
    }));
    const sheet = XLSX.utils.aoa_to_sheet(values);
    rows.forEach(function (_row, index) {
      const excelRow = index + 2;
      sheet[`K${excelRow}`] = {t: 's', v: String(values[index + 1][10] || '')};
      sheet[`L${excelRow}`] = {t: 's', v: String(values[index + 1][11] || '')};
      sheet[`N${excelRow}`] = {t: 's', v: String(values[index + 1][13] || '')};
    });
    sheet['!cols'] = [9,9,12,12,14,12,14,20,16,14,14,22,16,24,22,54].map(function (width) { return {wch: width}; });
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
      const numberOrNull = function (value, label) { if (value == null || String(value).trim() === '') return null; const parsed = Number(String(value).replace(/,/g, '')); if (!Number.isFinite(parsed)) throw new Error(`${item['姓名'] || `第 ${index + 2} 行`}的${label}不是有效数字`); return parsed; };
      const netPay = numberOrNull(item['实发金额'], '实发金额');
      const tax = numberOrNull(item['个税（财务核定）'] ?? item['个人所得税'], '个税');
      const combinedSocial = numberOrNull(item['个人医社保扣除（财务填写）'] ?? item['个人医社保扣除'], '个人医社保');
      const socialParts = ['个人社保扣除（财务填写）','个人医保扣除（财务填写）','个人失业扣除（财务填写）'].map(function (key) { return numberOrNull(item[key], key.replace('（财务填写）','')); });
      const hasSocialParts = socialParts.some(function (value) { return value != null; });
      return {employee_no: String(item['工号'] || '').trim(), row_key: `${String(item['姓名']).trim()}-${index + 1}`, employee_name: String(item['姓名']).trim(), gross_pay: numberOrNull(item['应发金额'], '应发金额'), income_tax: tax == null && netPay != null ? 0 : tax, personal_social_insurance: combinedSocial != null ? combinedSocial : hasSocialParts ? socialParts.reduce(function (sum, value) { return sum + Number(value || 0); }, 0) : null, employer_social_insurance: numberOrNull(item['公司承担医社保'], '公司承担医社保'), net_pay: netPay, note: String(item['财务备注'] ?? item['备注'] ?? '').trim()};
    });
    if (!rows.length) throw new Error('工资核算表中没有有效人员行');
    const saved = await api(`/api/finance/payroll/${state.month}/import`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({stage: 'finance_return', file_name: file.name, file_sha256: await sha256(file), rows: rows, summary: {row_count: rows.length}})});
    if (saved.ignored_retired_rows?.length) window.alert(`财务回表已导入；${saved.ignored_retired_rows.map(function (row) { return row.employee_name; }).join('、')}已从本月员工中移出，其回表行未计入工资。`);
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
    const query = new URLSearchParams(location.search);
    const employeeName = query.get('employee');
    const inputKey = query.get('input');
    const linkedRow = employeeName ? payrollRows().find(function (row) { return row.employee_name === employeeName; }) : null;
    if (linkedRow) {
      const target = document.getElementById(`payroll-row-${linkedRow.employee_id}`);
      target?.closest('tr')?.classList.add('is-lineage-target');
      target?.scrollIntoView({block:'center'});
      if (inputKey && has('finance.manage')) {
        query.delete('input');
        const url = new URL(location.href); url.search = query.toString(); history.replaceState({}, '', url);
        await showPayrollInput(linkedRow.employee_id, inputKey);
      }
    }
  }

  async function showPayrollInput(employeeId, focusInputKey) {
    const foundation = await api(`/api/finance/employees?month=${encodeURIComponent(state.month)}`);
    const employee = (foundation.employees || []).find(function (item) { return item.id === employeeId; });
    const rule = (foundation.rules || []).find(function (item) { return item.employee_id === employeeId; });
    const existing = (foundation.month_inputs || []).find(function (item) { return item.employee_id === employeeId; });
    const row = payrollRows().find(function (item) { return item.employee_id === employeeId; });
    if (!employee) return;
    const inputs = existing?.inputs || {};
    const ruleType = rule?.rule_type || row?.payload?.rule_type || '';
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
    if (ruleType === 'fixed') { addField('销售提成', 'sales_commission'); addField('其他', 'other_amount', false); }
    if (ruleType === 'production_manager') addField('其他', 'other_amount', false);
    if (ruleType === 'warehouse') addField('其他', 'other_amount', false);
    if (ruleType === 'pattern_points') { addField('带薪假期福利', 'paid_leave_amount'); addField('绩效奖金', 'performance_bonus'); addField('其他', 'other_amount', false); }
    if (ruleType === 'planning_submission') { addField('企划提报订单金额', 'sales_amount'); addField('走秀合作', 'show_cooperation_amount'); addField('其他', 'other_amount', false); }
    if (ruleType === 'design_submission') { addField('项目工资', 'project_amount'); addField('销售提成', 'sales_commission'); addField('其他', 'other_amount', false); }
    if (!directNames.length) return;
    const sourceSummary = (row?.components || []).filter(function (item) { return item.input_key; }).map(function (item) { return `<div><span>${escapeHtml(item.label)}</span><strong>${amount(item.amount)}</strong></div>`; }).join('');
    const approved = existing?.approved_at ? `上次确认：${dateTime(existing.approved_at)} · 版本 ${existing.version}` : '尚未填报本月人工源数据';
    const element = dialog('finance-payroll-input-dialog', `${employee.employee_name} · 本月工资源数据`, `<p class="finance-note">这里只能维护无法自动生成或引用的数据。自动金额、公式结果和实发金额均不可修改。</p>${sourceSummary ? `<div class="company-payroll-current">${sourceSummary}</div>` : ''}<div class="employee-form-grid">${directFields}</div><label>来源与确认说明<textarea class="form-control" rows="3" name="reason" required placeholder="说明这笔数据来自哪里或为何确认">${escapeHtml(existing?.reason || '')}</textarea></label><p class="finance-note">${escapeHtml(approved)}</p><div class="finance-error" data-message hidden></div><footer><button class="btn btn-outline-secondary" value="cancel">取消</button><button class="btn btn-primary" type="button" data-save>确认源数据并重算</button></footer>`);
    if (focusInputKey) element.querySelector(`[name="${focusInputKey}"]`)?.focus();
    element.querySelector('[data-save]').addEventListener('click', async function () {
      const values = {};
      directNames.forEach(function (name) { const input = element.querySelector(`[name="${name}"]`); if (input?.value !== '') values[name] = Number(input.value); });
      const message = element.querySelector('[data-message]');
      try {
        await api(`/api/finance/payroll/${state.month}/inputs/${employeeId}`, {method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({inputs: values, reason: element.querySelector('[name="reason"]').value, expected_version: existing?.version || null})});
        await api(`/api/finance/payroll/${state.month}/recalculate`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: '{}'});
        element.close(); await loadCompanyPayroll();
      } catch (error) { message.hidden = false; message.textContent = error.message; }
    });
  }

  async function showPayrollMonthNote(employeeId) {
    const row = payrollRows().find(function (item) { return item.employee_id === employeeId; });
    if (!row) return;
    const current = row.payload?.month_note || row.note || '';
    const element = dialog('finance-payroll-note-dialog', `${row.employee_name} · ${state.month} 当月备注`, `<p class="finance-note">当月备注只适用于本月，修改会保留版本记录；它不参与工资公式，也不会导给财务。每月都要让财务看到的固定核算事项，请到员工信息修改“固定备注”。</p><label>当月备注<textarea class="form-control" rows="5" maxlength="1500" name="month_note" placeholder="例如：本月有临时调整，待与本人确认">${escapeHtml(current)}</textarea></label><p class="finance-note">当前源数据版本：${escapeHtml(row.payload?.month_input_version || '尚未建立')}</p><div class="finance-error" data-message hidden></div><footer><button class="btn btn-outline-secondary" value="cancel">取消</button><button class="btn btn-primary" type="button" data-save>保存当月备注</button></footer>`);
    element.querySelector('[name="month_note"]')?.focus();
    element.querySelector('[data-save]').addEventListener('click', async function (event) {
      const message = element.querySelector('[data-message]');
      event.currentTarget.disabled = true;
      try {
        await api(`/api/finance/payroll/${state.month}/notes/${employeeId}`, {method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({month_note: element.querySelector('[name="month_note"]').value, expected_version: row.payload?.month_input_version || null})});
        await api(`/api/finance/payroll/${state.month}/recalculate`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: '{}'});
        element.close();
        await loadCompanyPayroll();
      } catch (error) {
        event.currentTarget.disabled = false;
        message.hidden = false;
        message.textContent = error.message;
      }
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

  function employeeActiveForMonth(employee) {
    if (employee.inactive_from_month && employee.inactive_from_month <= state.month) return false;
    if (employee.active === false && !employee.inactive_from_month) return false;
    if (employee.employment_start && employee.employment_start.slice(0, 7) > state.month) return false;
    if (employee.employment_end && employee.employment_end < `${state.month}-01`) return false;
    return true;
  }

  function renderEmployees() {
    const employees = state.employeeFoundation?.employees || [];
    content.innerHTML = `${reportTabs()}<section class="employee-panel"><div class="employee-summary"><div><strong>${employees.filter(employeeActiveForMonth).length}</strong><span>本月在册</span></div><div><strong>${employees.filter(function (item) { return employeeActiveForMonth(item) && item.has_social_insurance; }).length}</strong><span>本月有医社保</span></div><div><strong>${employees.filter(function (item) { return employeeActiveForMonth(item) && item.included_in_company_report === false; }).length}</strong><span>工资不计经营财报</span></div></div><div class="finance-table-wrap"><table class="finance-table employee-table"><thead><tr><th>工号 / 姓名</th><th>部门 / 职位</th><th>计薪方式</th><th class="number">基础工资</th><th>医社保</th><th>付款资料</th><th>状态</th><th></th></tr></thead><tbody>${employees.map(function (employee) {
      const activeThisMonth = employeeActiveForMonth(employee);
      const status = activeThisMonth ? '<span class="badge bg-green-lt">本月在册</span>' : `<span class="badge bg-secondary-lt">已移出</span><div class="finance-note">${employee.inactive_from_month ? `${escapeHtml(employee.inactive_from_month)} 起` : escapeHtml(employee.employment_end || '')}</div>`;
      return `<tr class="${activeThisMonth ? '' : 'is-inactive'}"><td><strong>${escapeHtml(employee.employee_no)} · ${escapeHtml(employee.employee_name)}</strong><div class="finance-note">${escapeHtml(employee.nickname || '')}</div></td><td>${escapeHtml(employee.department)}<div class="finance-note">${escapeHtml(employee.role_name)}</div></td><td>${escapeHtml(employee.compensation_method || employeeRule(employee.id)?.rule_type || '-')}</td><td class="number">${amount(employee.base_salary)}</td><td>${employee.has_social_insurance ? '有' : '无'}</td><td>${escapeHtml(employee.payment_bank || '-')}<div class="finance-note">${escapeHtml(maskValue(employee.payment_account, 4, 4))}</div></td><td>${status}</td><td><button class="finance-icon-button" data-employee="${escapeHtml(employee.id)}" title="查看并编辑员工资料"><i class="ti ti-edit"></i></button></td></tr>`;
    }).join('') || '<tr><td colspan="8"><div class="finance-empty">员工主档尚未导入</div></td></tr>'}</tbody></table></div></section>`;
    content.querySelectorAll('[data-employee]').forEach(function (button) { button.addEventListener('click', function () { showEmployeeDialog((state.employeeFoundation.employees || []).find(function (item) { return item.id === button.dataset.employee; })); }); });
  }

  function showEmployeeDialog(employee) {
    const rule = employee ? employeeRule(employee.id) : null;
    const ruleType = rule?.rule_type || 'fixed';
    const element = dialog('finance-employee-dialog', employee ? `员工资料 · ${employee.employee_name}` : '新增员工', `<div class="employee-form-grid"><label>工号<input class="form-control" name="employee_no" required value="${escapeHtml(employee?.employee_no || '')}"></label><label>姓名<input class="form-control" name="employee_name" required value="${escapeHtml(employee?.employee_name || '')}"></label><label>称呼<input class="form-control" name="nickname" value="${escapeHtml(employee?.nickname || '')}"></label><label>性别<select class="form-select" name="gender"><option value="">未填</option><option value="男">男</option><option value="女">女</option></select></label><label>出生日期<input class="form-control" type="date" name="birth_date" value="${escapeHtml(employee?.birth_date || '')}"></label><label>手机号<input class="form-control" name="phone" value="${escapeHtml(employee?.phone || '')}"></label><label>身份证号<input class="form-control" name="identity_no" value="${escapeHtml(employee?.identity_no || '')}"></label><label class="span-2">身份证地址<input class="form-control" name="identity_address" value="${escapeHtml(employee?.identity_address || '')}"></label><label>部门<input class="form-control" name="department" value="${escapeHtml(employee?.department || '')}"></label><label>职位<input class="form-control" name="role_name" value="${escapeHtml(employee?.role_name || '')}"></label><label class="span-2">工资计算方式<input class="form-control" name="compensation_method" value="${escapeHtml(employee?.compensation_method || '')}"></label><label>基础工资<input class="form-control" type="number" min="0" step="0.01" name="base_salary" value="${escapeHtml(employee?.base_salary ?? 0)}"></label><label>餐补基数<input class="form-control" type="number" min="0" step="0.01" name="meal_allowance_rate" value="${escapeHtml(employee?.meal_allowance_rate ?? 0)}"></label><label>工龄补贴<input class="form-control" type="number" min="0" step="0.01" name="seniority_allowance" value="${escapeHtml(employee?.seniority_allowance ?? 0)}"></label><label>其他固定补贴<input class="form-control" type="number" min="0" step="0.01" name="fixed_allowance" value="${escapeHtml(employee?.fixed_allowance ?? 0)}"></label><label>发放方式<input class="form-control" name="payment_method" value="${escapeHtml(employee?.payment_method || '')}"></label><label>工资账号<input class="form-control" name="payment_account" value="${escapeHtml(employee?.payment_account || '')}"></label><label class="span-2">开户行<input class="form-control" name="payment_bank" value="${escapeHtml(employee?.payment_bank || '')}"></label><label>入职日期<input class="form-control" type="date" name="employment_start" value="${escapeHtml(employee?.employment_start || '')}"></label><label>离职日期<input class="form-control" type="date" name="employment_end" value="${escapeHtml(employee?.employment_end || '')}"></label></div><div class="employee-checks"><label class="form-check"><input class="form-check-input" type="checkbox" name="has_social_insurance" ${employee?.has_social_insurance ? 'checked' : ''}><span>有医社保</span></label><label class="form-check"><input class="form-check-input" type="checkbox" name="finance_managed_gross" ${employee?.finance_managed_gross ? 'checked' : ''}><span>应发由财务回表核定</span></label><label class="form-check"><input class="form-check-input" type="checkbox" name="included_in_company_report" ${employee?.included_in_company_report === false ? '' : 'checked'}><span>计入公司经营财报</span></label><label class="form-check"><input class="form-check-input" type="checkbox" name="active" ${employee?.active === false ? '' : 'checked'}><span>当前在册</span></label></div><hr><div class="employee-form-grid"><label>计薪规则<select class="form-select" name="rule_type"><option value="fixed">固定工资</option><option value="production_worker">生产车工</option><option value="production_manager">生产负责人</option><option value="warehouse">仓管</option><option value="pattern_points">制版积分</option><option value="planning_submission">企划提报</option><option value="design_submission">设计提报</option></select></label><label>规则开始月份<input class="form-control" type="month" name="rule_start_month" value="${escapeHtml(rule?.start_month || state.month)}"></label><div class="span-2 employee-rule-fields"></div><label class="form-check span-2"><input class="form-check-input" type="checkbox" name="self_funded_social" ${rule?.parameters?.self_funded_social ? 'checked' : ''}><span>医社保全部从个人工资扣回</span></label><label class="span-2">内部备注（不导给财务）<textarea class="form-control" name="note" rows="3">${escapeHtml(employee?.note || '')}</textarea></label><label class="span-2">固定备注（工资表只读、每次导给财务）<textarea class="form-control" name="finance_note" rows="3" placeholder="只写每月都需要财务知道的固定核算事项">${escapeHtml(employee?.finance_note || '')}</textarea></label></div><div class="finance-error" data-message hidden></div><footer><button class="btn btn-outline-secondary" value="cancel">取消</button><button class="btn btn-primary" type="button" data-save>保存</button></footer>`);
    element.querySelector('[name="gender"]').value = employee?.gender || '';
    element.querySelector('[name="phone"]').inputMode = 'tel';
    element.querySelector('[name="payment_account"]').inputMode = 'numeric';
    element.querySelector('[name="payment_method"]').value = '银行转账';
    element.querySelector('[name="payment_method"]').readOnly = true;
    element.querySelector('[name="employment_end"]').readOnly = true;
    element.querySelector('[name="active"]').disabled = true;
    if (employee && employeeActiveForMonth(employee)) {
      const retire = document.createElement('button');
      retire.type = 'button'; retire.className = 'btn btn-outline-danger me-auto'; retire.dataset.retire = ''; retire.textContent = '删除员工';
      element.querySelector('footer').prepend(retire);
    }
    element.querySelector('[name="rule_type"]').value = ruleType;
    const refreshRuleFields = function () { element.querySelector('.employee-rule-fields').innerHTML = ruleFields(element.querySelector('[name="rule_type"]').value, rule?.parameters || {}); };
    element.querySelector('[name="rule_type"]').addEventListener('change', refreshRuleFields); refreshRuleFields();
    const retireButton = element.querySelector('[data-retire]');
    if (retireButton) retireButton.addEventListener('click', function () { element.close(); showRetireEmployeeDialog(employee); });
    element.querySelector('[data-save]').addEventListener('click', async function () {
      const value = function (name) { return element.querySelector(`[name="${name}"]`)?.value || ''; };
      const numberValue = function (name) { const raw = value(name); return raw === '' ? 0 : Number(raw); };
      const values = {employee_no:value('employee_no'),employee_name:value('employee_name'),nickname:value('nickname'),gender:value('gender'),birth_date:value('birth_date'),identity_no:value('identity_no'),identity_address:value('identity_address'),phone:value('phone'),department:value('department'),role_name:value('role_name'),compensation_method:value('compensation_method'),has_social_insurance:element.querySelector('[name="has_social_insurance"]').checked,finance_managed_gross:element.querySelector('[name="finance_managed_gross"]').checked,finance_note:value('finance_note'),base_salary:numberValue('base_salary'),meal_allowance_rate:numberValue('meal_allowance_rate'),seniority_allowance:numberValue('seniority_allowance'),fixed_allowance:numberValue('fixed_allowance'),payment_method:'银行转账',payment_account:value('payment_account').replace(/\s/g,''),payment_bank:value('payment_bank'),included_in_company_report:element.querySelector('[name="included_in_company_report"]').checked,employment_start:value('employment_start'),employment_end:value('employment_end'),active:element.querySelector('[name="active"]').checked,note:value('note')};
      const parameters = {self_funded_social: element.querySelector('[name="self_funded_social"]').checked};
      element.querySelectorAll('.employee-rule-fields [name]').forEach(function (field) { const key = field.name.replace('rule_',''); parameters[key] = field.type === 'number' ? Number(field.value || 0) : field.value; });
      const payload = {id:employee?.id || null,expected_version:employee?.version || null,values,rule:{rule_type:value('rule_type'),start_month:value('rule_start_month'),end_month:rule?.end_month || '',parameters,note:value('note')}};
      const message = element.querySelector('[data-message]');
      try { await api('/api/finance/employees', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}); element.close(); await loadEmployees(); }
      catch (error) { message.hidden = false; message.textContent = error.message; }
    });
  }

  function showRetireEmployeeDialog(employee) {
    const element = dialog('finance-employee-retire-dialog', `删除员工 · ${employee.employee_name}`, `<p class="finance-note">员工不会从历史工资中物理删除。所选月份起不再进入工资表、工资发放和月报，并保留操作人、原因及当时员工资料。</p><label>生效月份<input class="form-control" type="month" name="effective_month" value="${escapeHtml(state.month)}"></label><label>删除原因<textarea class="form-control" name="reason" rows="4" required placeholder="例如：年龄原因，自本月起不再列入员工及发薪范围"></textarea></label><div class="finance-error" data-message hidden></div><footer><button class="btn btn-outline-secondary" value="cancel">取消</button><button class="btn btn-danger" type="button" data-confirm-retire>确认删除并留档</button></footer>`);
    element.querySelector('[data-confirm-retire]').addEventListener('click', async function () {
      const message = element.querySelector('[data-message]');
      const effectiveMonth = element.querySelector('[name="effective_month"]').value;
      const reason = element.querySelector('[name="reason"]').value.trim();
      if (!effectiveMonth || reason.length < 2) { message.hidden = false; message.textContent = '请选择生效月份并填写具体原因'; return; }
      try {
        await api(`/api/finance/employees/${employee.id}/retire`, {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({expected_version:employee.version,effective_month:effectiveMonth,reason})});
        element.close();
        await api(`/api/finance/payroll/${effectiveMonth}/recalculate`, {method:'POST'});
        await loadEmployees();
      } catch (error) { message.hidden = false; message.textContent = error.message; }
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
    const captured = Boolean(batch?.captured_at);
    return `<button class="finance-source-item ${state.sourceType === batch?.source_type ? 'active' : ''}" data-source="${escapeHtml(batch?.source_type || '')}"><span>${escapeHtml(sourceLabels[batch?.source_type] || batch?.source_type || '')}</span><strong>${amount(captured ? total : 0)}</strong><small>${captured ? `${integer.format(batch.record_count || 0)} 条 · ${dateTime(batch.captured_at)}` : '本月无采集记录 · 按 0 计'}</small></button>`;
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
        const payload = row.payload || {};
        const detailUrl = payload['审批详情'] || payload['审批详情 URL'] || '';
        const fields = Object.entries(payload).filter(function (entry) { return entry[1] != null && entry[1] !== '' && !['审批详情','审批详情 URL'].includes(entry[0]); }).slice(0, 16).map(function (entry) { return `<dt>${escapeHtml(entry[0])}</dt><dd>${escapeHtml(entry[1])}</dd>`; }).join('');
        dialog('finance-record-dialog', row.reference_no || row.title || '数据明细', `<div class="finance-trace finance-trace-simple"><dl><dt>时间</dt><dd>${dateTime(row.occurred_at)}</dd><dt>金额</dt><dd>${amount(row.amount)}</dd><dt>数量</dt><dd>${row.quantity == null ? '-' : integer.format(row.quantity)}</dd><dt>状态</dt><dd>${escapeHtml(row.status || '-')}</dd>${fields}</dl>${detailUrl ? `<div class="finance-lineage-source"><a class="btn btn-outline-primary btn-sm" href="${escapeHtml(detailUrl)}" target="_blank" rel="noopener">打开企微审批详情<i class="ti ti-external-link ms-1"></i></a></div>` : ''}</div>`);
      });
    });
  }

  function bindPager(target, loader) {
    target.querySelector('[data-prev]')?.addEventListener('click', function () { state.offset = Math.max(0, state.offset - state.limit); loader(); });
    target.querySelector('[data-next]')?.addEventListener('click', function () { state.offset += state.limit; loader(); });
  }

  function showManualSourceDialog(source) {
    const options = Object.entries(manualParentLabels).map(function (entry) {
      return `<option value="${escapeHtml(entry[0])}">${escapeHtml(entry[1])}</option>`;
    }).join('');
    const element = dialog('finance-manual-source-dialog', source ? '编辑财务原始数据' : '新增财务原始数据', `<p class="finance-note">金额只在这里维护；月报按所选母条目自动引用。保存即代表管理员已核对，并保留版本记录。</p><label>母条目<select class="form-select" name="parent_key">${options}</select></label><label>子条目名称<input class="form-control" name="name" maxlength="120" required value="${escapeHtml(source?.name || '')}"></label><label>本月金额<input class="form-control" type="number" step="0.01" name="amount" required value="${escapeHtml(source?.amount ?? '')}"></label><label>来源与核对说明<textarea class="form-control" name="note" rows="3" required placeholder="例如：7月电费账单，财务回单核对">${escapeHtml(source?.note || '')}</textarea></label><div class="finance-error" data-message hidden></div><footer><button class="btn btn-outline-secondary" value="cancel">取消</button>${source ? '<button class="btn btn-outline-danger me-auto" type="button" data-retire>停用本条</button>' : ''}<button class="btn btn-primary" type="button" data-save>确认并计入月报</button></footer>`);
    element.querySelector('[name="parent_key"]').value = source?.parent_key || 'rent_food_equipment';
    element.querySelector('[data-save]').addEventListener('click', async function () {
      const amountInput = element.querySelector('[name="amount"]').value.trim();
      const values = {parent_key:element.querySelector('[name="parent_key"]').value,name:element.querySelector('[name="name"]').value.trim(),amount:amountInput === '' ? NaN : Number(amountInput),note:element.querySelector('[name="note"]').value.trim()};
      const message = element.querySelector('[data-message]');
      if (!values.name || !Number.isFinite(values.amount) || values.note.length < 2) { message.hidden=false; message.textContent='请填写名称、有效金额和来源说明'; return; }
      try { await api('/api/finance/manual-sources',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({month:state.month,id:source?.id||null,expected_version:source?.version||null,values})}); element.close(); await loadSources(); }
      catch(error){message.hidden=false;message.textContent=error.message;}
    });
    element.querySelector('[data-retire]')?.addEventListener('click', async function () {
      if (!confirm(`停用“${source.name}”？月报将不再计入，历史记录仍保留。`)) return;
      try { await api(`/api/finance/manual-sources/${source.id}/retire`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({month:state.month,expected_version:source.version})}); element.close(); await loadSources(); }
      catch(error){const message=element.querySelector('[data-message]');message.hidden=false;message.textContent=error.message;}
    });
  }

  function renderManualSourceTable(rows) {
    return `<div class="finance-table-wrap"><table class="finance-table"><thead><tr><th>母条目</th><th>子条目</th><th class="number">本月金额</th><th>来源说明</th><th>确认</th><th></th></tr></thead><tbody>${rows.map(function(row){const approved=row.status==='approved';return `<tr data-manual-row="${escapeHtml(row.id)}"><td>${escapeHtml(manualParentLabels[row.parent_key]||row.parent_key)}</td><td><strong>${escapeHtml(row.name)}</strong></td><td class="number">${amount(row.amount)}</td><td class="subtle">${escapeHtml(row.note||'待填写来源依据')}</td><td><span class="badge ${approved?'bg-green-lt':'bg-yellow-lt'}">${approved?'已确认':'待确认'} · v${escapeHtml(row.version)}</span></td><td>${has('finance.manage')?`<button class="finance-icon-button" data-manual='${escapeHtml(JSON.stringify(row))}' title="${approved?'编辑':'填写并确认'}原始数据"><i class="ti ti-edit"></i></button>`:''}</td></tr>`;}).join('')||'<tr><td colspan="6"><div class="finance-empty">本月尚未建立人工财务源槽位。</div></td></tr>'}</tbody></table></div>`;
  }

  function monthOffset(month, offset) {
    const parts = String(month || '').split('-').map(Number);
    const date = new Date(Date.UTC(parts[0], (parts[1] || 1) - 1 + offset, 1));
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
  }

  function recurringMonthAmount(cost) {
    if (cost.cost_type === 'recurring') return Number(cost.amount || 0);
    const months = Number(cost.amortization_months || 0);
    const start = String(cost.start_month || '').split('-').map(Number);
    const current = String(state.month || '').split('-').map(Number);
    const offset = (current[0] - start[0]) * 12 + current[1] - start[1];
    return months > 0 && offset >= 0 && offset < months ? Number(cost.amount || 0) / months : 0;
  }

  function financeEntryRows() {
    const rows = [];
    (state.data.manual_source_lines || []).filter(function(row){return row.status !== 'retired';}).forEach(function(row){
      rows.push({kind:'single',section:row.parent_key,name:row.name,amount:row.amount,note:row.note,origin:'管理员填报',occurrence:'单次费用',period:row.month,status:row.status === 'approved' ? '已确认' : '待确认',pending:row.status !== 'approved',record:row});
    });
    (state.data.recurring_costs || []).forEach(function(row){
      const end = row.end_month || (row.cost_type === 'one_time_amortized' && row.amortization_months ? monthOffset(row.start_month, Number(row.amortization_months) - 1) : '持续');
      rows.push({kind:'recurring',section:recurringCategorySections[row.category] || 'rent_food_equipment',name:row.name,amount:recurringMonthAmount(row),note:row.note,origin:'管理员填报',occurrence:row.cost_type === 'recurring' ? '周期费用' : `${row.amortization_months} 个月分摊`,period:`${row.start_month} — ${end}`,status:'生效中',pending:false,record:row});
    });
    (state.data.source_batches || []).forEach(function(row){
      const quantityFirst = ['erp_shipment','pattern_approval'].includes(row.source_type);
      rows.push({kind:'collected',section:automaticSourceSections[row.source_type] || 'product_cost',name:sourceLabels[row.source_type] || row.source_type,amount:quantityFirst ? null : row.amount_total,note:row.summary?.rule || row.file_name || '',origin:'系统采集',occurrence:'当月采集',period:state.month,status:'已采集',pending:false,quantity:quantityFirst ? row.quantity_total : null,record:row});
    });
    return rows;
  }

  function renderFinanceEntryTable() {
    const rows = financeEntryRows();
    const sections = sectionOrder.concat(['adjustment']).filter(function(section){return rows.some(function(row){return row.section === section;});});
    return `<div class="finance-entry-groups">${sections.map(function(section){
      const group = rows.filter(function(row){return row.section === section;});
      return `<section class="finance-entry-group"><header><h3>${escapeHtml(manualParentLabels[section] || section)}</h3><span>${group.length} 项</span></header><div class="finance-table-wrap"><table class="finance-table finance-entry-table"><thead><tr><th>条目</th><th>来源</th><th>发生方式</th><th>期间</th><th class="number">本月计入</th><th>状态</th><th>依据</th><th></th></tr></thead><tbody>${group.map(function(row){
        const edit = row.kind === 'collected' || !has('finance.manage') ? '' : `<button class="finance-icon-button" data-finance-entry="${escapeHtml(row.kind)}" data-entry-record='${escapeHtml(JSON.stringify(row.record))}' title="编辑原始记账"><i class="ti ti-edit"></i></button>`;
        const currentAmount = row.quantity != null ? `${integer.format(row.quantity)} 件/分` : amount(row.amount);
        return `<tr class="${row.pending ? 'is-missing' : ''}" ${row.kind === 'single' ? `data-manual-row="${escapeHtml(row.record.id)}"` : ''}><td><strong>${escapeHtml(row.name)}</strong></td><td><span class="badge ${row.origin === '系统采集' ? 'bg-blue-lt' : 'bg-azure-lt'}">${escapeHtml(row.origin)}</span></td><td>${escapeHtml(row.occurrence)}</td><td>${escapeHtml(row.period)}</td><td class="number">${currentAmount}</td><td><span class="badge ${row.pending ? 'bg-yellow-lt' : 'bg-green-lt'}">${escapeHtml(row.status)}</span></td><td class="subtle" title="${escapeHtml(row.note)}">${escapeHtml(row.note || '-')}</td><td>${edit}</td></tr>`;
      }).join('')}</tbody></table></div></section>`;
    }).join('')}</div>`;
  }

  function showFinanceEntryDialog(entry) {
    const record = entry?.record || null;
    const editingKind = entry?.kind || '';
    const initialType = editingKind === 'single' ? 'single' : record?.cost_type === 'one_time_amortized' ? 'amortized' : editingKind === 'recurring' ? 'recurring' : 'single';
    const singleOptions = Object.entries(manualParentLabels).map(function(item){return `<option value="${escapeHtml(item[0])}">${escapeHtml(item[1])}</option>`;}).join('');
    const recurringOptions = Object.entries(recurringCategoryLabels).map(function(item){return `<option value="${escapeHtml(item[0])}">${escapeHtml(item[1])}</option>`;}).join('');
    const element = dialog('finance-entry-dialog', record ? '编辑财务记账' : '新增财务记账', `<p class="finance-note">先选择当月单次费用、持续周期费用，或一笔总额按月分摊。月报只引用这里保存的源数据，不在结果页重复录入。</p><label>发生方式<select class="form-select" name="entry_type" ${record ? 'disabled' : ''}><option value="single">单次费用 · 只计入当月</option><option value="recurring">周期费用 · 每月计入</option><option value="amortized">一次性费用 · 按周期分摊</option></select></label><label>月报母条目<select class="form-select" name="category"></select></label><label>条目名称<input class="form-control" name="name" maxlength="120" required value="${escapeHtml(record?.name || '')}"></label><label data-amount-label><span>金额</span><input class="form-control" type="number" step="0.01" name="amount" required value="${escapeHtml(record?.amount ?? '')}"></label><div data-period hidden><div class="row"><label class="col">开始月份<input class="form-control" type="month" name="start_month" value="${escapeHtml(record?.start_month || state.month)}"></label><label class="col">结束月份（可留空）<input class="form-control" type="month" name="end_month" value="${escapeHtml(record?.end_month || '')}"></label></div><label data-amortization hidden>分摊月数<input class="form-control" type="number" min="1" max="240" name="amortization_months" value="${escapeHtml(record?.amortization_months || '')}"></label><label class="form-check"><input class="form-check-input" type="checkbox" name="renewal_required" ${record?.renewal_required ? 'checked' : ''}><span class="form-check-label">到期后需要重新确认</span></label></div><label>来源与核对说明<textarea class="form-control" name="note" rows="3" required placeholder="写清账单、回单或核对依据">${escapeHtml(record?.note || '')}</textarea></label><div class="finance-error" data-message hidden></div><footer><button class="btn btn-outline-secondary" value="cancel">取消</button>${editingKind === 'single' ? '<button class="btn btn-outline-danger me-auto" type="button" data-retire>停用本条</button>' : ''}<button class="btn btn-primary" type="button" data-save>保存源数据</button></footer>`);
    const typeField = element.querySelector('[name="entry_type"]');
    const categoryField = element.querySelector('[name="category"]');
    const sync = function(){
      const type = typeField.value;
      const recurring = type !== 'single';
      const desired = editingKind === 'single' ? record?.parent_key : editingKind === 'recurring' ? record?.category : categoryField.value;
      categoryField.innerHTML = recurring ? recurringOptions : singleOptions;
      if ([...categoryField.options].some(function(option){return option.value === desired;})) categoryField.value = desired;
      element.querySelector('[data-period]').hidden = !recurring;
      element.querySelector('[data-amortization]').hidden = type !== 'amortized';
      element.querySelector('[data-amount-label] span').textContent = type === 'amortized' ? '待分摊总金额' : type === 'recurring' ? '每月金额' : '本月金额';
    };
    typeField.value = initialType;
    typeField.addEventListener('change', sync);
    sync();
    element.querySelector('[data-save]').addEventListener('click', async function(){
      const type = typeField.value;
      const name = element.querySelector('[name="name"]').value.trim();
      const rawAmount = element.querySelector('[name="amount"]').value.trim();
      const value = Number(rawAmount);
      const note = element.querySelector('[name="note"]').value.trim();
      const message = element.querySelector('[data-message]');
      if (!name || rawAmount === '' || !Number.isFinite(value) || note.length < 2) { message.hidden=false; message.textContent='请填写名称、有效金额和来源说明'; return; }
      try {
        if (type === 'single') {
          await api('/api/finance/manual-sources',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({month:state.month,id:editingKind === 'single' ? record.id : null,expected_version:editingKind === 'single' ? record.version : null,values:{parent_key:categoryField.value,name:name,amount:value,note:note}})});
        } else {
          const monthsRaw = element.querySelector('[name="amortization_months"]').value.trim();
          const months = type === 'amortized' ? Number(monthsRaw) : null;
          if (type === 'amortized' && (!Number.isInteger(months) || months < 1 || months > 240)) throw new Error('请填写 1 到 240 之间的分摊月数');
          await api('/api/finance/recurring-costs',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:editingKind === 'recurring' ? record.id : null,expected_version:editingKind === 'recurring' ? record.version : null,values:{name:name,category:categoryField.value,cost_type:type === 'amortized' ? 'one_time_amortized' : 'recurring',amount:value,start_month:element.querySelector('[name="start_month"]').value || state.month,end_month:element.querySelector('[name="end_month"]').value,amortization_months:months,renewal_required:element.querySelector('[name="renewal_required"]').checked,active:true,note:note}})});
        }
        element.close(); await loadSources();
      } catch(error) { message.hidden=false; message.textContent=error.message; }
    });
    element.querySelector('[data-retire]')?.addEventListener('click', async function(){
      if (!confirm(`停用“${record.name}”？历史版本仍会保留。`)) return;
      const message = element.querySelector('[data-message]');
      try { await api(`/api/finance/manual-sources/${record.id}/retire`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({month:state.month,expected_version:record.version})}); element.close(); await loadSources(); }
      catch(error){message.hidden=false;message.textContent=error.message;}
    });
  }

  function showCostDialog(cost) {
    const element = dialog('finance-cost-dialog', cost ? '编辑周期费用' : '新增周期费用', `<p class="finance-note">这里只维护跨月重复或需要分摊的费用；仅本月发生的项目请使用“新增财务数据”。</p><label>费用名称<input class="form-control" name="name" required value="${escapeHtml(cost?.name || '')}"></label><div class="row"><label class="col">分类<select class="form-select" name="category"><option value="rent_utilities">场地费用 · 房租水电</option><option value="software">软件</option><option value="finance_fee">财务费用</option><option value="office">场地费用 · 办公食杂</option><option value="equipment">场地费用 · 机器设备</option><option value="renovation">场地费用 · 装修</option><option value="other">场地费用 · 其他</option></select></label><label class="col">类型<select class="form-select" name="cost_type"><option value="recurring">周期费用</option><option value="one_time_amortized">一次性分摊</option></select></label></div><div class="row"><label class="col">总金额<input class="form-control" type="number" step="0.01" min="0" name="amount" required value="${escapeHtml(cost?.amount || '')}"></label><label class="col">开始月份<input class="form-control" type="month" name="start_month" required value="${escapeHtml(cost?.start_month || state.month)}"></label></div><div class="row"><label class="col">结束月份<input class="form-control" type="month" name="end_month" value="${escapeHtml(cost?.end_month || '')}"></label><label class="col">分摊月数<input class="form-control" type="number" min="1" max="240" name="amortization_months" value="${escapeHtml(cost?.amortization_months || '')}"></label></div><label>备注<textarea class="form-control" name="note" rows="2">${escapeHtml(cost?.note || '')}</textarea></label><label class="form-check"><input class="form-check-input" type="checkbox" name="renewal_required" ${cost?.renewal_required ? 'checked' : ''}><span class="form-check-label">到期后需要重新确认</span></label><div class="finance-error" data-message hidden></div><footer><button class="btn btn-outline-secondary" value="cancel">取消</button><button class="btn btn-primary" type="button" data-save>保存</button></footer>`);
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
    const requestedSource = new URLSearchParams(location.search).get('source_type');
    if (requestedSource && sourceLabels[requestedSource] && !['manual_work','erp_shipment','pattern_approval'].includes(requestedSource)) state.sourceType = requestedSource;
    if (!batches.has(state.sourceType)) state.sourceType = Array.from(batches.keys()).find(function (key) { return !['manual_work','erp_shipment','pattern_approval'].includes(key); }) || 'taobao_income_order';
    toolbar.innerHTML = `${monthSelect(state.months, state.month)}<span class="finance-toolbar-spacer"></span>${has('finance.manage') ? '<button class="btn btn-primary" id="add-finance-entry"><i class="ti ti-plus me-1"></i>新增财务记账</button><button class="btn btn-outline-primary" id="add-policy"><i class="ti ti-adjustments me-1"></i>经营调整</button>' : ''}`;
    toolbar.querySelector('#finance-month').addEventListener('change', async function (event) { setMonth(event.target.value); state.offset = 0; await loadSources(); });
    toolbar.querySelector('#add-finance-entry')?.addEventListener('click', function () { showFinanceEntryDialog(null); });
    toolbar.querySelector('#add-policy')?.addEventListener('click', function () { showPolicyDialog(null); });
    content.innerHTML = `${reportTabs()}<section class="finance-section"><div class="finance-section-header"><div><h2>财务数据原</h2><p class="finance-note mb-0">单次、周期、分摊和系统采集数据统一按月报分类展示；月报只引用这里的唯一源记录。</p></div></div>${renderFinanceEntryTable()}</section><section class="finance-section mt-4"><div class="finance-section-header"><div><h3>自动采集明细</h3><p class="finance-note mb-0">选择采集源查看原始记录；这里的金额不能人工覆盖。</p></div></div><div class="finance-source-grid">${Object.keys(sourceLabels).filter(function (key) { return !['manual_work','erp_shipment','pattern_approval'].includes(key); }).map(function (key) { return sourceCard(batches.get(key) || {source_type: key, amount_total: 0, record_count: 0, captured_at: null}); }).join('')}</div><div id="source-records"><div class="finance-loading"><span class="spinner-border spinner-border-sm"></span>正在读取</div></div></section><section class="finance-section mt-4"><div class="finance-section-header"><h3>经营模块外调整</h3></div>${renderPolicyTable(state.data.policies || [])}</section>`;
    content.querySelectorAll('[data-source]').forEach(function (button) { button.addEventListener('click', async function () { state.sourceType = button.dataset.source; state.offset = 0; content.querySelectorAll('[data-source]').forEach(function (item) { item.classList.toggle('active', item === button); }); await loadSourceRecords(); }); });
    content.querySelectorAll('[data-finance-entry]').forEach(function (button) { button.addEventListener('click', function () { showFinanceEntryDialog({kind:button.dataset.financeEntry,record:JSON.parse(button.dataset.entryRecord)}); }); });
    content.querySelectorAll('[data-policy]').forEach(function (button) { button.addEventListener('click', function () { showPolicyDialog(JSON.parse(button.dataset.policy)); }); });
    await loadSourceRecords();
    const manualId = new URLSearchParams(location.search).get('manual');
    if (manualId) {
      const target = content.querySelector(`[data-manual-row="${CSS.escape(manualId)}"]`);
      target?.classList.add('is-lineage-target'); target?.scrollIntoView({block:'center'});
    }
  }

  function renderCostTable(rows) {
    return `<div class="finance-table-wrap"><table class="finance-table"><thead><tr><th>费用</th><th>分类</th><th>类型</th><th class="number">金额</th><th>期间</th><th>备注</th><th></th></tr></thead><tbody>${rows.map(function (row) { return `<tr><td><strong>${escapeHtml(row.name)}</strong></td><td>${escapeHtml(row.category)}</td><td>${row.cost_type === 'recurring' ? '周期' : `${row.amortization_months} 个月分摊`}</td><td class="number">${amount(row.amount)}</td><td>${escapeHtml(row.start_month)} - ${escapeHtml(row.end_month || '持续')}</td><td class="subtle">${escapeHtml(row.note)}</td><td>${has('finance.manage') ? `<button class="finance-icon-button" data-cost='${escapeHtml(JSON.stringify(row))}'><i class="ti ti-edit"></i></button>` : ''}</td></tr>`; }).join('') || '<tr><td colspan="7"><div class="finance-empty">尚未设置费用</div></td></tr>'}</tbody></table></div>`;
  }

  function renderPolicyTable(rows) {
    return `<div class="finance-table-wrap"><table class="finance-table"><thead><tr><th>规则</th><th>类型</th><th>生效期间</th><th>值</th><th>备注</th><th></th></tr></thead><tbody>${rows.map(function (row) { return `<tr><td><strong>${escapeHtml(row.name)}</strong><div class="finance-note">${escapeHtml(row.policy_key)}</div></td><td>${escapeHtml(row.policy_type)}</td><td>${escapeHtml(row.start_month)} - ${escapeHtml(row.end_month || '持续')}</td><td>${escapeHtml(JSON.stringify(row.value))}</td><td class="subtle">${escapeHtml(row.note)}</td><td>${has('finance.manage') ? `<button class="finance-icon-button" data-policy='${escapeHtml(JSON.stringify(row))}'><i class="ti ti-edit"></i></button>` : ''}</td></tr>`; }).join('') || '<tr><td colspan="6"><div class="finance-empty">尚未设置经营调整</div></td></tr>'}</tbody></table></div>`;
  }

  async function allShipmentRows(month, search) {
    const rows = [];
    let offset = 0;
    let total = 0;
    do {
      const query = new URLSearchParams({month:month,limit:'500',offset:String(offset),search:search || ''});
      const payload = await api(`/api/erp/shipments?${query}`);
      total = Number(payload.total || 0);
      rows.push(...(payload.items || []));
      offset += 500;
    } while (offset < total && offset < 10000);
    return rows;
  }

  function shipmentDaily(rows, month) {
    const days = new Date(Number(month.slice(0,4)), Number(month.slice(5,7)), 0).getDate();
    const values = Array.from({length:days}, function(){return 0;});
    rows.forEach(function(row){
      const match = String(row.occurred_at || '').match(/(?:^|\D)(\d{4})[-\/]?(\d{1,2})[-\/]?(\d{1,2})/);
      if (!match) return;
      const rowMonth = `${match[1]}-${String(match[2]).padStart(2,'0')}`;
      const day = Number(match[3]);
      if (rowMonth === month && day >= 1 && day <= days) values[day - 1] += Number(row.quantity ?? 1) || 0;
    });
    return values;
  }

  function shipmentTrendSvg(current, comparison) {
    const width = 1040;
    const height = 280;
    const left = 42;
    const right = 18;
    const top = 22;
    const bottom = 38;
    const days = Math.max(current.length, comparison.length, 1);
    const max = Math.max(1, ...current, ...comparison);
    const plotWidth = width - left - right;
    const plotHeight = height - top - bottom;
    const step = plotWidth / days;
    const y = function(value){return top + plotHeight - Number(value || 0) / max * plotHeight;};
    const bars = current.map(function(value,index){const barHeight=Math.max(0,(Number(value)||0)/max*plotHeight);return `<rect x="${(left+index*step+step*.15).toFixed(1)}" y="${y(value).toFixed(1)}" width="${Math.max(2,step*.7).toFixed(1)}" height="${barHeight.toFixed(1)}" rx="2" fill="#206bc4" opacity=".78"><title>${index+1}日：${integer.format(value)} 件</title></rect>`;}).join('');
    const points = comparison.map(function(value,index){return `${(left+index*step+step*.5).toFixed(1)},${y(value).toFixed(1)}`;}).join(' ');
    const labels = current.map(function(_value,index){const day=index+1;return day===1||day%5===0||day===current.length?`<text x="${(left+index*step+step*.5).toFixed(1)}" y="${height-14}" text-anchor="middle" font-size="10" fill="#667085">${day}</text>`:'';}).join('');
    const grid = [0,.25,.5,.75,1].map(function(ratio){const gy=top+plotHeight-plotHeight*ratio;return `<line x1="${left}" y1="${gy}" x2="${width-right}" y2="${gy}" stroke="#e6eaf0"/><text x="${left-8}" y="${gy+3}" text-anchor="end" font-size="9" fill="#98a2b3">${Math.round(max*ratio)}</text>`;}).join('');
    return `<svg class="shipment-trend" viewBox="0 0 ${width} ${height}" role="img" aria-label="按日发货件数对比图">${grid}${bars}${points?`<polyline points="${points}" fill="none" stroke="#e07b00" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="7 5"/>`:''}${labels}</svg>`;
  }

  async function loadShipments() {
    const months = rollingMonths();
    state.month = selectedMonthFromUrl(monthBeforeNow());
    const params = new URLSearchParams(location.search);
    const search = params.get('search') || '';
    const defaultCompare = monthOffset(state.month, -1);
    state.shipmentCompare = params.get('compare') || defaultCompare;
    if (state.shipmentCompare === state.month) state.shipmentCompare = defaultCompare;
    const compareOptions = months.concat([state.shipmentCompare]).filter(function(value,index,array){return value !== state.month && array.indexOf(value) === index;}).map(function(value){return `<option value="${escapeHtml(value)}" ${value===state.shipmentCompare?'selected':''}>对比 ${escapeHtml(value)}</option>`;}).join('');
    toolbar.innerHTML = `${monthSelect(months,state.month)}<select id="shipment-compare" class="form-select finance-month">${compareOptions}</select><input id="source-search" class="form-control finance-source-search" type="search" placeholder="搜索单号、商品或内容" value="${escapeHtml(search)}"><span class="finance-toolbar-spacer"></span><span class="finance-status">当前月为主 · 虚线为对比月</span>`;
    toolbar.querySelector('#finance-month').addEventListener('change', async function(event){setMonth(event.target.value);await loadShipments();});
    toolbar.querySelector('#shipment-compare').addEventListener('change', async function(event){const url=new URL(location.href);url.searchParams.set('compare',event.target.value);history.replaceState({},'',url);await loadShipments();});
    toolbar.querySelector('#source-search').addEventListener('change', async function(event){const url=new URL(location.href);if(event.target.value.trim())url.searchParams.set('search',event.target.value.trim());else url.searchParams.delete('search');history.replaceState({},'',url);await loadShipments();});
    content.innerHTML = '<div class="finance-loading"><span class="spinner-border spinner-border-sm"></span>正在汇总按日发货数据</div>';
    const [currentRows,compareRows] = await Promise.all([allShipmentRows(state.month,search),allShipmentRows(state.shipmentCompare,search)]);
    const currentDaily = shipmentDaily(currentRows,state.month);
    const compareDaily = shipmentDaily(compareRows,state.shipmentCompare);
    const total = currentDaily.reduce(function(sum,value){return sum+value;},0);
    const compareTotal = compareDaily.reduce(function(sum,value){return sum+value;},0);
    const change = compareTotal ? (total-compareTotal)/compareTotal*100 : null;
    const activeDays = currentDaily.filter(function(value){return value>0;}).length;
    content.innerHTML = `<section class="shipment-overview"><div class="shipment-kpis"><article><span>${escapeHtml(state.month)} 发货件数</span><strong>${integer.format(total)}</strong><small>${currentRows.length} 条发货记录</small></article><article><span>对比 ${escapeHtml(state.shipmentCompare)}</span><strong>${integer.format(compareTotal)}</strong><small>${change==null?'无可比基数':`${change>=0?'+':''}${change.toFixed(1)}%`}</small></article><article><span>有发货的日期</span><strong>${activeDays}</strong><small>日均 ${activeDays?integer.format(total/activeDays):'0'} 件</small></article></div><div class="shipment-chart-card"><header><div><h2>日粒度发货数量</h2><p>${escapeHtml(state.month)} 以蓝色柱为主；${escapeHtml(state.shipmentCompare)} 用橙色虚线按日期对齐。</p></div><div class="shipment-legend"><span><i class="current"></i>${escapeHtml(state.month)}</span><span><i class="compare"></i>${escapeHtml(state.shipmentCompare)}</span></div></header>${shipmentTrendSvg(currentDaily,compareDaily)}</div></section><section class="finance-section"><div class="finance-section-header"><div><h3>${escapeHtml(state.month)} 发货明细</h3><p class="finance-note mb-0">图表与明细使用同一批原始记录；搜索条件会同时作用于当月和对比月。</p></div></div>${renderRecordTable(currentRows,false)}</section>`;
    bindRecordDetails(content);
  }

  async function loadStandaloneSource(endpoint, title) {
    const months = rollingMonths();
    state.month = selectedMonthFromUrl(monthBeforeNow());
    const search = new URLSearchParams(location.search).get('search') || '';
    toolbar.innerHTML = `${monthSelect(months, state.month)}<input id="source-search" class="form-control finance-source-search" type="search" placeholder="搜索姓名、编号或内容" value="${escapeHtml(search)}"><span class="finance-toolbar-spacer"></span><span class="finance-status">${escapeHtml(title)}</span>`;
    toolbar.querySelector('#finance-month').addEventListener('change', async function (event) { setMonth(event.target.value); state.offset = 0; await loadStandaloneSource(endpoint, title); });
    toolbar.querySelector('#source-search').addEventListener('change', async function (event) { const url = new URL(location.href); if (event.target.value.trim()) url.searchParams.set('search', event.target.value.trim()); else url.searchParams.delete('search'); history.replaceState({}, '', url); state.offset = 0; await loadStandaloneSource(endpoint, title); });
    const query = new URLSearchParams({month: state.month, limit: state.limit, offset: state.offset, search: search});
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
    if (page === 'production-pattern') return await loadStandaloneSource('/api/production/pattern-approvals', '制版审批');
    if (page === 'erp-shipments') return await loadShipments();
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
