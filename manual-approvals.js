/* One canonical ledger for WeCom imports and native submissions. */
(function (root) {
  'use strict';
  const labels = { pending: '待审批', approved: '已通过', rejected: '已驳回', cancelled: '已撤销' };
  function dateText(value) {
    if (typeof value === 'number') {
      const d = new Date(Date.UTC(1899, 11, 30) + Math.round(value * 86400000));
      return d.toISOString().slice(0, 19) + '+08:00';
    }
    const m = String(value || '').trim().match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
    if (!m) throw new Error('无法识别企微时间：' + value);
    return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}T${(m[4] || '00').padStart(2, '0')}:${m[5] || '00'}:${m[6] || '00'}+08:00`;
  }
  function number(value) {
    if (value === '' || value == null || !Number.isFinite(Number(value))) throw new Error('金额、数量或单价不是有效数字');
    return Number(value);
  }
  function parseRows(rows) {
    const header = rows[0] || [];
    ['审批编号', '提交时间', '申请人账号', '当前审批状态', '明细-金额', '总金额'].forEach(k => { if (!header.includes(k)) throw new Error('缺少企微导出字段：' + k); });
    const statuses = { '已通过': 'approved', '审批通过': 'approved', '待审批': 'pending', '审批中': 'pending', '已驳回': 'rejected', '已拒绝': 'rejected', '已撤销': 'cancelled', '已取消': 'cancelled' };
    const result = []; let current;
    for (const row of rows.slice(1)) {
      if (row.every(v => v === '' || v == null)) continue;
      const raw = Object.fromEntries(header.map((k, i) => [k, row[i] ?? '']));
      if (raw['审批编号']) {
        const status = statuses[String(raw['当前审批状态']).trim()];
        if (!status) throw new Error('未知审批状态：' + raw['当前审批状态']);
        current = { approval_no: String(raw['审批编号']), submitted_at: dateText(raw['提交时间']), completed_at: raw['完成时间'] ? dateText(raw['完成时间']) : null,
          status, applicant: String(raw['申请人账号'] || raw['申请人']), total: number(raw['总金额']), details: [], raw: { header: raw, rows: [] } };
        result.push(current);
      }
      if (!current) throw new Error('明细缺少对应审批编号');
      current.raw.rows.push(raw);
      if (raw['明细-金额'] === '') continue;
      current.details.push({ style: String(raw['明细-款号']), quantity: number(raw['明细-数量']), unit_price: number(raw['明细-单价（元）']),
        amount: number(raw['明细-金额']), amount_uppercase: String(raw['明细-金额大写']), note: String(raw['明细-备注']), image_count: String(raw['明细-图片']), order_no: '' });
    }
    const seen = new Set();
    for (const a of result) {
      if (seen.has(a.approval_no)) throw new Error('文件内审批编号重复：' + a.approval_no);
      seen.add(a.approval_no);
      if (!a.details.length || Math.round(a.details.reduce((n, d) => n + d.amount, 0) * 100) !== Math.round(a.total * 100)) throw new Error('审批明细与总金额不一致：' + a.approval_no);
    }
    return result;
  }
  root.JUN_MANUAL = { parseRows, dateText, labels };
  if (typeof module !== 'undefined') module.exports = root.JUN_MANUAL;
  if (typeof document === 'undefined') return;
  const style = document.createElement('link'); style.rel = 'stylesheet'; style.href = '/jun-pages/manual-approvals.css?v=20260906-2'; document.head.append(style);
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = n => Number(n || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const now = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
  let month = new URLSearchParams(location.search).get('month') || now().slice(0, 7), data, filter = 'all', busy = false;
  const errors = { manual_forbidden: '没有操作权限', manual_submit_forbidden: '没有提交权限', manual_admin_required: '仅管理员可以审批、导入及定稿', manual_version_conflict: '记录已被更新，请刷新后再操作', manual_month_finalized: '本月已定稿，请管理员先重新打开', manual_pending_approvals: '还有待审批记录，请先处理完再定稿', finance_month_locked: '财务月份已锁定', finance_payroll_finalized: '工资表已定稿，不能修改本月来源', manual_legacy_month_requires_migration: '本月是历史账本，暂时只读，需先完成历史迁移', manual_not_pending: '这条记录已处理，请刷新', manual_submission_month_mismatch: '企微提交时间与导入月份不一致', manual_work_date_required: '请填写作业日期', manual_detail_invalid: '请核对款号、数量、单价和金额', manual_import_total_mismatch: '导入明细合计与企微总金额不一致' };
  async function api(action, values) {
    const response = await fetch('/api/production/manual-approvals?month=' + encodeURIComponent(month), action ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, values }) } : undefined);
    const body = await response.json();
    if (!response.ok) { const text = body.detail || body.error || '请求失败'; throw new Error(Object.entries(errors).find(([k]) => text.includes(k))?.[1] || text); }
    return body;
  }
  function message(text, bad) {
    let el = $('#manual-message'); if (!el) { el = document.createElement('div'); el.id = 'manual-message'; $('#module-toolbar').after(el); }
    el.className = 'alert ' + (bad ? 'alert-danger' : 'alert-success'); el.textContent = text;
  }
  async function mutate(action, values) {
    if (busy) return;
    busy = true; document.querySelectorAll('[data-action],dialog button[type=submit]').forEach(b => b.disabled = true);
    try { const result = await api(action, values); document.querySelector('dialog[open]')?.close(); await load(); message(action === 'import' ? `导入完成：更新 ${result.changed} 张审批；相同内容不会重复导入。` : '已保存', false); }
    catch (e) { message(e.message, true); const err = document.querySelector('dialog[open] [data-error]'); if (err) err.textContent = e.message; }
    finally { busy = false; document.querySelectorAll('[data-action],dialog button[type=submit]').forEach(b => b.disabled = false); }
  }
  function options(selected) { return '<option value="">请选择员工</option>' + data.employees.map(e => `<option value="${esc(e.id)}" ${e.id === selected ? 'selected' : ''}>${esc(e.name)}</option>`).join(''); }
  function dialog(title, content, submit) {
    document.querySelector('#manual-dialog')?.remove();
    const el = document.createElement('dialog'); el.id = 'manual-dialog'; el.className = 'manual-dialog';
    el.innerHTML = `<form><header class="manual-dialog-head"><h3>${esc(title)}</h3><button type="button" class="manual-dialog-close" data-close aria-label="关闭">×</button></header><div class="manual-dialog-body">${content}<p data-error class="text-danger mb-0" role="alert"></p></div><footer class="manual-dialog-footer"><span><span class="manual-required">*</span> 为必填项</span><button type="button" class="btn btn-outline-secondary" data-close>取消</button><button type="submit" class="btn btn-primary">${submit.label || '提交审批'}</button></footer></form>`;
    if (!el.querySelector('[required]')) el.querySelector('.manual-dialog-footer > span').textContent = '';
    document.body.append(el); el.querySelectorAll('[data-close]').forEach(b => b.onclick = () => el.close());
    el.querySelector('form').onsubmit = e => { e.preventDefault(); Promise.resolve(submit.run(new FormData(e.target), el)).catch(err => { el.querySelector('[data-error]').textContent = err.message; }); };
    el.showModal(); return el;
  }
  async function photo(file) {
    if (!/^image\/(jpeg|png|webp|gif|bmp|avif)$/.test(file.type) || file.size > 15000000) throw new Error('请选择 15 MB 以内的图片');
    const bitmap = await createImageBitmap(file).catch(() => { throw new Error('无法读取该图片，请转换为 JPG 或 PNG 后上传'); }); const scale = Math.min(1, 1200 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas'); canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close();
    const value = canvas.toDataURL('image/jpeg', 0.65); if (value.length > 350000) throw new Error('图片内容过大，请换一张较小的照片'); return value;
  }
  function edit(a) {
    const d = a?.details?.[0] || {};
    let images = [...(d.images || [])], imagesBusy = false;
    const star = '<span class="manual-required" aria-label="必填">*</span>';
    const workDate = a?.work_date || (month === now().slice(0, 7) ? now() : month + '-01');
    const el = dialog(a ? '修改手工审批' : '新增手工审批', `
      <p class="manual-dialog-note">计入月份 <strong>${esc(month)}</strong>${a ? ' · 修改后重新进入待审批' : ''}</p>
      <div class="manual-form-grid">
        <label><span class="form-label">往来单位 ${star}</span><select name="employee_id" class="form-select" required>${options(a?.employee_id || (a?.counterparty_profile_id ? 'profile:' + a.counterparty_profile_id : data.self_employee_id))}</select></label>
        <label><span class="form-label">作业日期 ${star}</span><input type="date" name="work_date" class="form-control" value="${esc(workDate)}" required></label>
        <label class="manual-form-wide"><span class="form-label">款号／手工内容 ${star}</span><input name="style" class="form-control" placeholder="填写款号或说明做了什么手工" maxlength="500" required value="${esc(d.style)}"></label>
        <label><span class="form-label">数量 ${star}</span><input type="number" name="quantity" class="form-control" min="0.001" step="0.001" required value="${esc(d.quantity ?? 1)}"></label>
        <label><span class="form-label">单价（元） ${star}</span><input type="number" name="unit_price" class="form-control" min="0" step="0.01" required placeholder="0.00" value="${esc(d.unit_price)}"></label>
        <div class="manual-amount-strip manual-form-wide"><label for="manual-amount">金额（元）<small>数量 × 单价，自动计算</small></label><input id="manual-amount" name="amount" readonly aria-label="金额（元）" value="${esc(d.amount != null ? Number(d.amount).toFixed(2) : '0.00')}"></div>
        <label class="manual-form-wide"><span class="form-label">订单编号 <small>选填</small></span><input name="order_no" class="form-control" maxlength="150" placeholder="有关联订单时填写" value="${esc(d.order_no)}"></label>
        <label class="manual-form-wide"><span class="form-label">备注 <small>选填</small></span><textarea name="note" class="form-control" rows="2" maxlength="3000" placeholder="补充说明工作内容或费用">${esc(d.note)}</textarea></label>
        <div class="manual-form-wide"><span class="form-label">附件图片 <small>选填</small></span><div class="manual-upload-box"><label class="btn btn-outline-secondary manual-upload-button" for="manual-photo-input"><i class="ti ti-photo-plus" aria-hidden="true"></i>添加图片</label><input id="manual-photo-input" name="photos" type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/bmp,image/avif" multiple hidden><span class="manual-muted">仅图片，最多 3 张，每张不超过 15 MB</span><div data-photo-previews class="manual-photo-previews"></div><p data-photo-error class="text-danger mb-0" role="alert"></p></div></div>
      </div>`, { run: async (f) => {
        if (imagesBusy) throw new Error('图片正在处理，请稍候');
        await mutate(a ? 'edit' : 'submit', { id: a?.id, expected_version: a?.version, employee_id: f.get('employee_id'), work_date: f.get('work_date'), details: [{ style: f.get('style'), quantity: number(f.get('quantity')), unit_price: number(f.get('unit_price')), amount: Math.round(number(f.get('quantity')) * number(f.get('unit_price')) * 100) / 100, order_no: f.get('order_no'), note: f.get('note'), images }] });
      } });
    function preview() {
      el.querySelector('[data-photo-previews]').innerHTML = images.map((src, i) => `<div class="manual-photo-item"><button type="button" class="manual-thumb" data-preview="${src}" aria-label="预览附件图片 ${i + 1}"><img src="${src}" alt="附件图片 ${i + 1}"></button><button type="button" class="manual-photo-remove" data-remove-photo="${i}" aria-label="移除附件图片 ${i + 1}">×</button></div>`).join('');
    }
    preview();
    el.querySelector('[name=photos]').onchange = async e => {
      const files = Array.from(e.target.files); const error = el.querySelector('[data-photo-error]'); error.textContent = '';
      if (images.length + files.length > 3) { error.textContent = '最多上传 3 张图片，请先移除不需要的图片'; e.target.value = ''; return; }
      imagesBusy = true; el.querySelector('[type=submit]').disabled = true;
      try { const added = await Promise.all(files.map(photo)); images.push(...added); preview(); }
      catch (err) { error.textContent = err.message; }
      finally { imagesBusy = false; el.querySelector('[type=submit]').disabled = false; e.target.value = ''; }
    };
    el.addEventListener('click', e => { const b = e.target.closest('[data-remove-photo]'); if (b && !imagesBusy) { images.splice(Number(b.dataset.removePhoto), 1); preview(); } });
    el.addEventListener('input', () => { const q = el.querySelector('[name=quantity]').value, p = el.querySelector('[name=unit_price]').value; el.querySelector('[name=amount]').value = (Math.round(Number(q) * Number(p) * 100) / 100).toFixed(2); });
  }
  async function importFile(file) {
    if (!file) return; if (file.size > 15000000) throw new Error('文件超过 15 MB');
    const book = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    if (!book.Sheets['手工申报']) throw new Error('找不到“手工申报”工作表，请使用企微原始导出');
    const all = parseRows(XLSX.utils.sheet_to_json(book.Sheets['手工申报'], { header: 1, defval: '' }));
    const entries = all.filter(a => a.submitted_at.slice(0, 7) === month); if (!entries.length) throw new Error('文件中没有提交时间属于 ' + month + ' 的审批');
    const applicants = [...new Set(entries.map(a => a.applicant))];
    dialog('导入预览 · ' + month, `<p>${entries.length} 张审批、${entries.reduce((n, a) => n + a.details.length, 0)} 条明细，合计 ¥${money(entries.reduce((n, a) => n + a.total, 0))}。</p>
      <p>${Object.entries(labels).map(([k, v]) => v + ' ' + entries.filter(a => a.status === k).length + ' 张').join('；')}。</p>
      <p>仅导入本月，其他 ${all.length - entries.length} 张跳过。同一企微审批号以本次文件覆盖；网页记录保留。</p>
      ${applicants.map((name, i) => `<label class="form-label">企微 ${esc(name)} 对应员工<select name="map${i}" class="form-select" required>${options(data.employees.find(e => e.name === (name === 'GanL' ? '林敢' : name))?.id)}</select></label>`).join('')}
      <small>Excel 只包含图片附件数量；历史图片请通过原企微审批查看。</small>`, { label: '确认导入', run: async f => {
        entries.forEach(a => { a.employee_id = f.get('map' + applicants.indexOf(a.applicant)); a.raw.file_name = file.name; });
        await mutate('import', { approvals: entries });
      } });
  }
  const validImages = d => (d.images || []).filter(src => /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(src));
  function detailHtml(d) {
    const images = validImages(d);
    return `<section class="manual-detail"><div class="manual-detail-heading"><strong>${esc(d.style)}</strong><span>¥${money(d.amount)}</span></div>
      <div class="manual-detail-calculation">${esc(d.quantity)} × ¥${money(d.unit_price)}</div>
      ${d.order_no ? '<div class="manual-field-row"><span>订单编号</span><strong>' + esc(d.order_no) + '</strong></div>' : ''}
      ${d.note ? '<p class="manual-detail-note">' + esc(d.note) + '</p>' : ''}
      ${images.length ? '<div class="manual-thumbnails">' + images.map((src, i) => `<button type="button" class="manual-thumb" data-preview="${src}" aria-label="预览 ${esc(d.style)} 附件图片 ${i + 1}"><img src="${src}" alt="${esc(d.style)} 附件图片 ${i + 1}" loading="lazy"></button>`).join('') + '</div>' : ''}
      ${!images.length && d.image_count && !/^0/.test(d.image_count) ? '<small class="manual-muted">企微原件 ' + esc(d.image_count) + '</small>' : ''}</section>`;
  }
  function cardHtml(a, open) {
    const sum = a.details.reduce((n, d) => n + Number(d.amount), 0);
    const owner = a.submitted_by === window.JUN_CONTEXT?.profile?.id;
    const date = value => new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
    const actions = `${data.is_admin && open && a.status === 'pending' ? `<button class="btn btn-success" data-action="approve" data-id="${a.id}"><i class="ti ti-check" aria-hidden="true"></i>通过</button><button class="btn btn-outline-danger" data-action="reject" data-id="${a.id}">驳回</button>` : ''}${data.can_submit && open && a.source === 'web' && owner && ['pending', 'rejected'].includes(a.status) ? `<button class="btn btn-outline-primary" data-action="edit" data-id="${a.id}">${a.status === 'rejected' ? '修改并重提' : '修改'}</button>${a.status === 'pending' ? `<button class="btn btn-outline-secondary" data-action="cancel" data-id="${a.id}">撤销</button>` : ''}` : ''}`;
    return `<article class="manual-record-card is-${a.status}"><header class="manual-card-head"><div><h3>${esc(a.employee_name)}</h3><span class="manual-muted">${a.source === 'wecom' ? '企微导入' : '网页提交'} · ${a.details.length} 条明细</span></div><span class="manual-status is-${a.status}">${labels[a.status]}</span></header>
      <div class="manual-card-total"><span>总金额</span><strong>¥${money(sum)}</strong></div>
      <div class="manual-card-meta"><div><span>作业日期</span><strong>${esc(a.work_date || '—')}</strong></div><div><span>提交时间</span><strong>${date(a.submitted_at)}</strong></div>${a.completed_at ? '<div><span>审批完成</span><strong>' + date(a.completed_at) + '</strong></div>' : ''}</div>
      ${a.reason ? '<div class="manual-reason">处理说明：' + esc(a.reason) + '</div>' : ''}
      <div class="manual-details">${detailHtml(a.details[0])}${a.details.length > 1 ? `<details class="manual-extra-details"><summary>展开其余 ${a.details.length - 1} 条明细</summary>${a.details.slice(1).map(detailHtml).join('')}</details>` : ''}</div>
      <footer class="manual-card-footer"><div class="manual-approval-number" title="${esc(a.approval_no)}"><span>审批编号</span>${esc(a.approval_no)}</div>${a.source === 'wecom' && /^https:\/\/[^/]*weixin\.qq\.com\//.test(a.raw?.header?.['审批详情'] || '') ? '<a target="_blank" rel="noopener noreferrer" href="' + esc(a.raw.header['审批详情']) + '">企微原审批 <i class="ti ti-external-link" aria-hidden="true"></i></a>' : ''}${actions ? '<div class="manual-card-actions">' + actions + '</div>' : ''}</footer></article>`;
  }
  function render() {
    const open = data.month_state.status === 'open';
    const approvals = data.approvals, pending = approvals.filter(a => a.status === 'pending');
    const total = approvals.filter(a => a.status === 'approved').reduce((n, a) => n + a.details.reduce((v, d) => v + Number(d.amount), 0), 0);
    const payroll = approvals.filter(a => a.status === 'approved' && a.employee_name === '林敢').reduce((n, a) => n + a.details.reduce((v, d) => v + Number(d.amount), 0), 0);
    $('#module-toolbar').classList.add('manual-toolbar');
    $('#module-toolbar').innerHTML = `<div class="manual-month-group"><label for="manual-month">计入月份</label><input type="month" id="manual-month" class="form-control" value="${esc(month)}"><span class="manual-status ${open ? '' : 'is-approved'}">${open ? '未定稿' : '已定稿'}</span></div><div class="manual-toolbar-actions">${data.can_submit && open && !data.legacy_source ? '<button class="btn btn-primary" data-action="new"><i class="ti ti-plus" aria-hidden="true"></i>新增手工审批</button>' : ''}${data.is_admin && !data.legacy_source ? (open ? '<label class="btn btn-outline-secondary manual-import-label">导入企微<input id="manual-import" type="file" accept=".xlsx,.xls" hidden></label><button class="btn btn-outline-success" data-action="finalize">本月定稿</button>' : '<button class="btn btn-outline-secondary" data-action="reopen">重新打开</button>') : ''}</div>`;
    $('#manual-month').onchange = e => { if (!e.target.value) return; month = e.target.value; const url = new URL(location.href); url.searchParams.set('month', month); history.replaceState(null, '', url); load().catch(e => message(e.message, true)); };
    const importer = $('#manual-import'); if (importer) importer.onchange = e => importFile(e.target.files[0]).catch(e => message(e.message, true)).finally(() => { e.target.value = ''; });
    const shown = approvals.filter(a => filter === 'all' || a.status === filter);
    $('#module-content').innerHTML = `<div class="manual-summary"><div><span>${data.is_admin ? '' : '本人相关 · '}已通过金额</span><strong>¥${money(total)}</strong></div><div><span>待审批</span><strong>${pending.length}<small> 张</small></strong></div>${data.is_admin ? '<div><span>林敢计薪金额</span><strong>¥' + money(payroll) + '</strong></div>' : ''}</div>
      ${data.legacy_source ? '<div class="alert alert-info">本月为历史账本。<a href="/jun-pages/finance/sources/?month=' + esc(month) + '&source=manual_work">查看历史来源</a></div>' : ''}
      <div class="manual-list-toolbar"><div class="manual-tabs" role="group" aria-label="审批状态">${[['all', '全部'], ...Object.entries(labels)].map(([k, v]) => `<button class="manual-tab ${filter === k ? 'is-active' : ''}" aria-pressed="${filter === k}" data-filter="${k}">${v}<span>${k === 'all' ? approvals.length : approvals.filter(a => a.status === k).length}</span></button>`).join('')}</div><span class="manual-muted">共 ${shown.length} 张审批</span></div>
      <div class="manual-card-list">${shown.map(a => cardHtml(a, open)).join('') || '<div class="manual-empty"><i class="ti ti-clipboard-check" aria-hidden="true"></i><p>本月暂无' + (filter === 'all' ? '' : labels[filter]) + '记录</p></div>'}</div>`;
  }
  document.addEventListener('click', e => {
    const thumb = e.target.closest('[data-preview]');
    if (thumb) {
      if (!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(thumb.dataset.preview)) return;
      document.querySelector('#manual-image-viewer')?.remove();
      const viewer = document.createElement('dialog'); viewer.id = 'manual-image-viewer'; viewer.className = 'manual-image-viewer';
      viewer.innerHTML = `<button type="button" aria-label="关闭图片预览">×</button><img src="${thumb.dataset.preview}" alt="附件图片预览">`;
      document.body.append(viewer); viewer.querySelector('button').onclick = () => viewer.close(); viewer.onclick = event => { if (event.target === viewer) viewer.close(); }; viewer.showModal(); return;
    }
    const f = e.target.closest('[data-filter]'); if (f) { filter = f.dataset.filter; render(); return; }
    const b = e.target.closest('[data-action]'); if (!b || busy) return;
    const action = b.dataset.action, a = data.approvals.find(a => a.id === b.dataset.id);
    if (action === 'new') return edit(); if (action === 'edit') return edit(a);
    if (action === 'approve') return mutate('review', { id: a.id, expected_version: a.version, status: 'approved' });
    if (['reject', 'cancel', 'reopen', 'finalize'].includes(action)) {
      const reasonNeeded = ['reject', 'reopen'].includes(action);
      dialog({ reject: '驳回手工审批', cancel: '撤销手工审批', reopen: '重新打开本月', finalize: '本月定稿' }[action], reasonNeeded ? '<label class="form-label">原因<textarea name="reason" class="form-control" required maxlength="1000"></textarea></label>' : `<p>${action === 'finalize' ? '定稿后，本月记录将锁定。需要调整时由管理员填写原因重新打开。' : '确认撤销这条待审批记录？'}</p>`, { label: { reject: '确认驳回', cancel: '确认撤销', reopen: '重新打开', finalize: '确认定稿' }[action], run: f => mutate(action === 'reject' ? 'review' : action, { id: a?.id, expected_version: a?.version ?? data.month_state.version, status: 'rejected', reason: f.get('reason') || '' }) });
    }
  });
  async function load() { data = await api(); render(); }
  Promise.resolve(window.JUN_AUTH_READY).then(load).catch(e => { $('#module-content').textContent = ''; message(e.message, true); });
})(typeof window !== 'undefined' ? window : globalThis);
