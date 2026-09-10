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
  // The database accepts JPEG data URLs of at most 350,000 characters per image.
  // Try readable dimensions first, then reduce quality and dimensions as needed.
  async function photo(file) {
    if (!/^image\/(jpeg|png|webp|gif|bmp|avif)$/.test(file.type) || file.size > 15000000) throw new Error('请选择 15 MB 以内的图片');
    let source, release;
    if (typeof createImageBitmap === 'function') {
      try { source = await createImageBitmap(file); release = () => source.close(); } catch (_) { /* Safari may need the image decoder. */ }
    }
    if (!source) {
      const url = URL.createObjectURL(file), img = new Image();
      try { await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = url; }); }
      catch (_) { URL.revokeObjectURL(url); throw new Error('无法读取该图片，请转换为 JPG 或 PNG 后上传'); }
      source = img; release = () => { img.src = ''; URL.revokeObjectURL(url); };
    }
    const canvas = document.createElement('canvas');
    try {
      const width = source.naturalWidth || source.width, height = source.naturalHeight || source.height;
      if (!width || !height) throw new Error('无法读取该图片，请转换为 JPG 或 PNG 后上传');
      const edge = Math.max(width, height);
      let scale = Math.min(1, 2400 / edge, Math.sqrt(4000000 / (width * height)));
      const minimumScale = Math.min(scale, 640 / edge);
      for (;;) {
        canvas.width = Math.max(1, Math.round(width * scale)); canvas.height = Math.max(1, Math.round(height * scale));
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('图片处理失败，请重新选择图片');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
        for (const quality of [0.86, 0.76, 0.66, 0.56]) {
          const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
          if (!blob || blob.type !== 'image/jpeg') throw new Error('图片处理失败，请重新选择图片');
          if (23 + 4 * Math.ceil(blob.size / 3) > 350000) continue;
          const value = await new Promise((resolve, reject) => {
            const reader = new FileReader(); reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error('图片处理失败，请重新选择图片')); reader.readAsDataURL(blob);
          });
          if (typeof value === 'string' && value.length <= 350000 && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(value)) return value;
        }
        if (scale <= minimumScale) break;
        scale = Math.max(minimumScale, scale * 0.8);
      }
      throw new Error('图片压缩后仍过大，请裁剪或拆成多张图片');
    } finally { release(); canvas.width = canvas.height = 1; }
  }
  root.JUN_MANUAL = { parseRows, dateText, labels, photo };
  if (typeof module !== 'undefined') module.exports = root.JUN_MANUAL;
  if (typeof document === 'undefined') return;
  const style = document.createElement('link'); style.rel = 'stylesheet'; style.href = '/jun-pages/manual-approvals.css?v=20260909-batch1'; document.head.append(style);
  const $ = s => document.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = n => Number(n || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const now = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
  let month = new URLSearchParams(location.search).get('month') || now().slice(0, 7), data, filter = 'all', busy = false, loading = false, loadVersion = 0, activeLoad;
  const attachmentCache = new Map();
  const errors = { manual_forbidden: '没有操作权限', manual_submit_forbidden: '没有提交权限', manual_admin_required: '仅管理员可以审批、导入及定稿', manual_version_conflict: '记录已被更新，请刷新后再操作', manual_month_finalized: '本月已定稿，请管理员先重新打开', manual_pending_approvals: '还有待审批记录，请先处理完再定稿', finance_month_locked: '财务月份已锁定', finance_payroll_finalized: '工资表已定稿，不能修改本月来源', manual_import_already_completed: '本月企微文件已经导入，不再接受重复导入', manual_legacy_month_requires_migration: '本月是历史账本，暂时只读，需先完成历史迁移', manual_not_pending: '这条记录已处理，请刷新', manual_submission_month_mismatch: '企微提交时间与导入月份不一致', manual_work_date_required: '请填写作业日期', manual_detail_invalid: '请核对款号、数量、单价和金额', manual_import_total_mismatch: '导入明细合计与企微总金额不一致' };
  Object.assign(errors, { manual_batch_invalid: '每次可提交 1 至 3 项，请核对申请及附件', manual_request_id_required: '提交标识无效，请刷新后重新填写', manual_request_conflict: '本次提交内容不一致，请核对原提交结果', manual_employee_required: '请选择有效的往来单位', manual_images_invalid: '附件不符合要求，请重新选择图片', manual_detail_too_large: '附件或备注过长，请精简后重试', manual_request_failed: '暂时无法确认提交结果，请重试' });
  async function api(action, values, signal, requestedMonth = month, approvalId) {
    const run = async () => {
    const response = await fetch('/api/production/manual-approvals?month=' + encodeURIComponent(requestedMonth) + (!action ? (approvalId ? '&approval_id=' + encodeURIComponent(approvalId) : '&list=1') : ''), action ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, values }), signal } : { signal });
    const body = await response.json();
    if (!response.ok) { const text = body.detail || body.error || '请求失败'; const error = new Error(Object.entries(errors).find(([k]) => text.includes(k))?.[1] || text); error.confirmedRejection = response.status < 500 && body.error !== 'manual_request_conflict'; throw error; }
    return body;
    };
    if (!signal) return run();
    // The login bridge can await auth before starting native fetch; bound that wait too.
    return new Promise((resolve, reject) => {
      const aborted = () => reject(new DOMException('请求已取消', 'AbortError'));
      if (signal.aborted) { aborted(); return; }
      signal.addEventListener('abort', aborted, { once: true });
      run().then(resolve, reject).finally(() => signal.removeEventListener('abort', aborted));
    });
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
  function entryFields(d, employee, workDate, uid) {
    const star = '<span class="manual-required" aria-label="必填">*</span>';
    return `      <div class="manual-form-grid">
        <label><span class="form-label">往来单位 ${star}</span><select name="employee_id" class="form-select" required>${options(employee)}</select></label>
        <label><span class="form-label">作业日期 ${star}</span><input type="date" name="work_date" class="form-control" value="${esc(workDate)}" required></label>
        <label class="manual-form-wide"><span class="form-label">款号／手工内容 ${star}</span><input name="style" class="form-control" placeholder="填写款号或说明做了什么手工" maxlength="500" required value="${esc(d.style)}"></label>
        <label><span class="form-label">数量 ${star}</span><input type="number" name="quantity" class="form-control" min="0.001" step="0.001" required value="${esc(d.quantity ?? 1)}"></label>
        <label><span class="form-label">单价（元） ${star}</span><input type="number" name="unit_price" class="form-control" min="0" step="0.01" required placeholder="0.00" value="${esc(d.unit_price)}"></label>
        <div class="manual-amount-strip manual-form-wide"><label for="${uid}-amount">金额（元）<small>数量 × 单价，自动计算</small></label><input id="${uid}-amount" name="amount" readonly aria-label="金额（元）" value="${esc(d.amount != null ? Number(d.amount).toFixed(2) : '0.00')}"></div>
        <label class="manual-form-wide"><span class="form-label">订单编号 <small>选填</small></span><input name="order_no" class="form-control" maxlength="150" placeholder="有关联订单时填写" value="${esc(d.order_no)}"></label>
        <label class="manual-form-wide"><span class="form-label">备注 <small>选填</small></span><textarea name="note" class="form-control" rows="2" maxlength="3000" placeholder="补充说明工作内容或费用">${esc(d.note)}</textarea></label>
        <div class="manual-form-wide"><span class="form-label">附件图片 <small>选填</small></span><div class="manual-upload-box"><label class="btn btn-outline-secondary manual-upload-button" for="${uid}-photos"><i class="ti ti-photo-plus" aria-hidden="true"></i>添加图片</label><input id="${uid}-photos" name="photos" type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/bmp,image/avif" multiple hidden><span class="manual-muted">最多 3 张，每张原图不超过 15 MB，将自动压缩</span><p data-photo-status class="manual-muted mb-0" role="status" aria-live="polite"></p><div data-photo-previews class="manual-photo-previews"></div><p data-photo-error class="text-danger mb-0" role="alert"></p></div></div>
      </div>`;
  }
  function edit(a) {
    const d = a?.details?.[0] || {};
    let images = [...(d.images || [])], imagesBusy = false;
    const star = '<span class="manual-required" aria-label="必填">*</span>';
    const workDate = a?.work_date || (month === now().slice(0, 7) ? now() : month + '-01');
    const el = dialog(a ? '修改手工审批' : '新增手工审批', `
      <p class="manual-dialog-note">计入月份 <strong>${esc(month)}</strong>${a ? ' · 修改后重新进入待审批' : ''}</p>${a?.details?.length > 1 ? `<p class="manual-dialog-note">本次编辑第 1 条明细，其余 ${a.details.length - 1} 条明细保留。</p>` : ''}
      ${entryFields(d, a?.employee_id || (a?.counterparty_profile_id ? 'profile:' + a.counterparty_profile_id : data.self_employee_id), workDate, 'manual-edit')}`, { run: async (f) => {
        if (imagesBusy) throw new Error('图片正在处理，请稍候');
        await mutate(a ? 'edit' : 'submit', { id: a?.id, expected_version: a?.version, employee_id: f.get('employee_id'), work_date: f.get('work_date'), details: [{ style: f.get('style'), quantity: number(f.get('quantity')), unit_price: number(f.get('unit_price')), amount: Math.round(number(f.get('quantity')) * number(f.get('unit_price')) * 100) / 100, order_no: f.get('order_no'), note: f.get('note'), images }, ...(a?.details || []).slice(1)] });
      } });
    function preview() {
      el.querySelector('[data-photo-previews]').innerHTML = images.map((src, i) => `<div class="manual-photo-item"><button type="button" class="manual-thumb" data-preview="${src}" aria-label="预览附件图片 ${i + 1}"><img src="${src}" alt="附件图片 ${i + 1}"></button><button type="button" class="manual-photo-remove" data-remove-photo="${i}" aria-label="移除附件图片 ${i + 1}">×</button></div>`).join('');
    }
    preview();
    el.querySelector('[name=photos]').onchange = async e => {
      const input = e.target;
      if (imagesBusy) return;
      const files = Array.from(input.files); const error = el.querySelector('[data-photo-error]'), status = el.querySelector('[data-photo-status]'); error.textContent = ''; status.textContent = '';
      if (!files.length) return;
      if (images.length + files.length > 3) { error.textContent = '最多上传 3 张图片，请先移除不需要的图片'; e.target.value = ''; return; }
      imagesBusy = true; input.disabled = true; el.querySelector('[type=submit]').disabled = true;
      try {
        for (let i = 0; i < files.length; i++) {
          status.textContent = `正在压缩图片 ${i + 1}/${files.length}…`;
          images.push(await photo(files[i])); preview();
        }
        status.textContent = '图片已处理，可预览后提交';
      }
      catch (err) { error.textContent = err.message; }
      finally { if (error.textContent) status.textContent = ''; imagesBusy = false; input.disabled = false; el.querySelector('[type=submit]').disabled = false; input.value = ''; }
    };
    el.addEventListener('click', e => { const b = e.target.closest('[data-remove-photo]'); if (b && !imagesBusy) { images.splice(Number(b.dataset.removePhoto), 1); preview(); } });
    el.addEventListener('input', () => { const q = el.querySelector('[name=quantity]').value, p = el.querySelector('[name=unit_price]').value; el.querySelector('[name=amount]').value = (Math.round(Number(q) * Number(p) * 100) / 100).toFixed(2); });
  }
  function createBatch() {
    const entries = []; let sequence = 0, imagesBusy = false, sending = false, pending, uncertain = false;
    const el = dialog('新增手工审批', `<p class="manual-dialog-note">计入月份 <strong>${esc(month)}</strong> · 每项分别审批，最多 3 项</p><div data-batch-items></div><button type="button" class="btn btn-outline-primary manual-add-entry" data-add-entry>＋ 再加一项</button>`, {
      label: '提交审批（1项）', run: async () => {
        if (sending || imagesBusy) return;
        if (!pending) {
          const values = entries.map(row => {
            const get = name => row.el.querySelector(`[name=${name}]`).value;
            const quantity = number(get('quantity')), unitPrice = number(get('unit_price'));
            return { employee_id: get('employee_id'), work_date: get('work_date'), details: [{ style: get('style').trim(), quantity, unit_price: unitPrice, amount: Math.round(quantity * unitPrice * 100) / 100, order_no: get('order_no'), note: get('note'), images: [...row.images] }] };
          });
          pending = { request_id: crypto.randomUUID(), entries: values }; uncertain = false;
          if (new TextEncoder().encode(JSON.stringify(pending)).length > 3500000) { pending = null; throw new Error('附件总量过大，请减少图片后重试'); }
        }
        sending = true; busy = true; lock();
        const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 45000);
        const error = el.querySelector('[data-error]'); error.textContent = '正在提交，请稍候…';
        try {
          const result = await api('submit_batch', pending, controller.signal);
          if (!Array.isArray(result.approval_ids) || result.approval_ids.length !== pending.entries.length) throw new Error('提交结果未确认');
          const count = pending.entries.length; pending = null; sending = false; el.close();
          message(`已提交 ${count} 项审批，等待分别审批`, false);
          const refresh = new AbortController(), refreshTimer = setTimeout(() => refresh.abort(), 10000);
          try { await load(refresh.signal); } catch (_) { message(`已提交 ${count} 项审批，列表刷新失败，请刷新页面查看`, false); }
          finally { clearTimeout(refreshTimer); }
        } catch (err) {
          if (err.confirmedRejection && !uncertain) { pending = null; error.textContent = err.message; }
          else { uncertain = true; error.textContent = '提交结果暂未确认，内容已保留。请点“重试提交”核对，不会重复生成审批。'; }
        } finally { clearTimeout(timer); sending = false; busy = false; lock(); }
      }
    });
    // Pending requests keep the original payload and ID until the server confirms them.
    const beforeUnload = event => { if (pending) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', beforeUnload);
    el.addEventListener('close', () => window.removeEventListener('beforeunload', beforeUnload));
    el.addEventListener('cancel', event => { if (sending || pending) event.preventDefault(); });
    function lock() {
      const frozen = sending || Boolean(pending);
      entries.forEach(row => {
        row.el.querySelector('fieldset').disabled = frozen;
        row.el.querySelector('[name=photos]').disabled = frozen || imagesBusy;
        row.el.querySelectorAll('[data-remove-photo],[data-remove-entry]').forEach(button => button.disabled = frozen || imagesBusy);
      });
      el.querySelectorAll('[data-close]').forEach(button => button.disabled = frozen);
      const add = el.querySelector('[data-add-entry]'); add.disabled = frozen || imagesBusy; add.hidden = entries.length >= 3;
      const submit = el.querySelector('[type=submit]'); submit.disabled = sending || imagesBusy;
      submit.textContent = sending ? '正在提交…' : pending ? '重试提交' : `提交审批（${entries.length}项）`;
    }
    function renumber() {
      entries.forEach((row, i) => { row.el.querySelector('h4').textContent = `申请 ${i + 1}`; row.el.querySelector('[data-remove-entry]').hidden = entries.length === 1; });
      lock();
    }
    function addEntry() {
      if (entries.length >= 3 || imagesBusy || sending || pending) return;
      const previous = entries.at(-1)?.el;
      const employee = previous?.querySelector('[name=employee_id]').value || data.self_employee_id;
      const workDate = previous?.querySelector('[name=work_date]').value || (month === now().slice(0, 7) ? now() : month + '-01');
      const section = document.createElement('section'), uid = `manual-batch-${++sequence}`;
      section.className = 'manual-batch-entry'; section.dataset.entry = uid;
      section.innerHTML = `<header class="manual-entry-head"><h4 tabindex="-1"></h4><button type="button" class="btn btn-outline-secondary" data-remove-entry>移除</button></header><fieldset>${entryFields({}, employee, workDate, uid)}</fieldset>`;
      const row = { el: section, images: [] }; entries.push(row); el.querySelector('[data-batch-items]').append(section);
      const preview = () => {
        section.querySelector('[data-photo-previews]').innerHTML = row.images.map((src, i) => `<div class="manual-photo-item"><button type="button" class="manual-thumb" data-preview="${src}" aria-label="预览附件图片 ${i + 1}"><img src="${src}" alt="附件图片 ${i + 1}"></button><button type="button" class="manual-photo-remove" data-remove-photo="${i}" aria-label="移除附件图片 ${i + 1}">×</button></div>`).join('');
      };
      section.querySelector('[name=photos]').onchange = async event => {
        if (imagesBusy || sending || pending) return;
        const input = event.target, files = Array.from(input.files || []);
        const error = section.querySelector('[data-photo-error]'), status = section.querySelector('[data-photo-status]'); error.textContent = ''; status.textContent = '';
        if (row.images.length + files.length > 3) { error.textContent = '每项最多上传 3 张图片，请先移除不需要的图片'; input.value = ''; return; }
        if (!files.length) return;
        imagesBusy = true; lock();
        try {
          for (let i = 0; i < files.length; i++) {
            if (!el.open) break;
            status.textContent = `正在压缩图片 ${i + 1}/${files.length}…`;
            const value = await photo(files[i]);
            if (!el.open) break;
            row.images.push(value); preview(); lock();
          }
          status.textContent = el.open ? '图片已处理，可预览后提交' : '';
        } catch (err) { error.textContent = err.message; status.textContent = ''; }
        finally { imagesBusy = false; input.value = ''; lock(); }
      };
      section.addEventListener('click', event => {
        if (imagesBusy || sending || pending) return;
        const removePhoto = event.target.closest('[data-remove-photo]');
        if (removePhoto) { row.images.splice(Number(removePhoto.dataset.removePhoto), 1); preview(); }
        if (event.target.closest('[data-remove-entry]') && entries.length > 1) { entries.splice(entries.indexOf(row), 1); row.images.length = 0; section.remove(); renumber(); }
      });
      section.addEventListener('input', () => {
        const quantity = Number(section.querySelector('[name=quantity]').value), price = Number(section.querySelector('[name=unit_price]').value);
        section.querySelector('[name=amount]').value = (Math.round(quantity * price * 100) / 100).toFixed(2);
      });
      renumber(); if (entries.length > 1) section.querySelector('h4').focus();
    }
    el.querySelector('[data-add-entry]').onclick = addEntry;
    addEntry();
    el.querySelector('.manual-dialog-footer > span').innerHTML = '<span class="manual-required">*</span> 为必填项';
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
  function imagesHtml(images) {
    return '<div class="manual-thumbnails">' + images.map((src, i) => `<button type="button" class="manual-thumb" data-preview="${src}" aria-label="预览附件图片 ${i + 1}"><img src="${src}" alt="附件图片 ${i + 1}" loading="lazy"></button>`).join('') + '</div>';
  }
  async function fullApproval(id) {
    const requestedMonth = month, key = `${requestedMonth}:${id}`;
    if (!attachmentCache.has(key)) {
      const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20000);
      try {
        const response = await api(undefined, undefined, controller.signal, requestedMonth, id);
        attachmentCache.set(key, response.approval);
      } finally { clearTimeout(timer); }
    }
    if (requestedMonth !== month) throw new Error('月份已切换，请重新打开记录');
    return attachmentCache.get(key);
  }
  function detailHtml(d, approvalId, detailIndex) {
    const images = validImages(d);
    return `<section class="manual-detail"><div class="manual-detail-heading"><strong>${esc(d.style)}</strong><span>¥${money(d.amount)}</span></div>
      <div class="manual-detail-calculation">${esc(d.quantity)} × ¥${money(d.unit_price)}</div>
      ${d.order_no ? '<div class="manual-field-row"><span>订单编号</span><strong>' + esc(d.order_no) + '</strong></div>' : ''}
      ${d.note ? '<p class="manual-detail-note">' + esc(d.note) + '</p>' : ''}
      ${images.length ? imagesHtml(images) : d.has_images ? `<div><button type="button" class="btn btn-outline-secondary" data-attachments="${esc(approvalId)}" data-detail-index="${detailIndex}">查看附件（${esc(d.image_count)} 张）</button></div>` : ''}
      ${!images.length && !d.has_images && d.image_count && !/^0/.test(d.image_count) ? '<small class="manual-muted">企微原件 ' + esc(d.image_count) + '</small>' : ''}</section>`;
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
      <div class="manual-details">${detailHtml(a.details[0], a.id, 0)}${a.details.length > 1 ? `<details class="manual-extra-details"><summary>展开其余 ${a.details.length - 1} 条明细</summary>${a.details.slice(1).map((detail,index) => detailHtml(detail,a.id,index+1)).join('')}</details>` : ''}</div>
      <footer class="manual-card-footer"><div class="manual-approval-number" title="${esc(a.approval_no)}"><span>审批编号</span>${esc(a.approval_no)}</div>${a.source === 'wecom' && /^https:\/\/[^/]*weixin\.qq\.com\//.test(a.raw?.header?.['审批详情'] || '') ? '<a target="_blank" rel="noopener noreferrer" href="' + esc(a.raw.header['审批详情']) + '">企微原审批 <i class="ti ti-external-link" aria-hidden="true"></i></a>' : ''}${actions ? '<div class="manual-card-actions">' + actions + '</div>' : ''}</footer></article>`;
  }
  function render() {
    const open = data.month_state.status === 'open';
    const importLocked = Boolean(data.month_state.ingest_channel);
    const approvals = data.approvals, pending = approvals.filter(a => a.status === 'pending');
    const total = approvals.filter(a => a.status === 'approved').reduce((n, a) => n + a.details.reduce((v, d) => v + Number(d.amount), 0), 0);
    const payroll = approvals.filter(a => a.status === 'approved' && a.employee_name === '林敢').reduce((n, a) => n + a.details.reduce((v, d) => v + Number(d.amount), 0), 0);
    $('#module-toolbar').classList.add('manual-toolbar');
    $('#module-toolbar').innerHTML = `<div class="manual-month-group"><label for="manual-month">计入月份</label><input type="month" id="manual-month" class="form-control" value="${esc(month)}"><span class="manual-status ${open ? '' : 'is-approved'}">${open ? '未定稿' : '已定稿'}</span></div><div class="manual-toolbar-actions">${data.can_submit && open && !data.legacy_source ? '<button class="btn btn-primary" data-action="new"><i class="ti ti-plus" aria-hidden="true"></i>新增手工审批</button>' : ''}${data.is_admin && !data.legacy_source ? (open ? (!importLocked ? '<label class="btn btn-outline-secondary manual-import-label">导入企微<input id="manual-import" type="file" accept=".xlsx,.xls" hidden></label>' : '') + '<button class="btn btn-outline-success" data-action="finalize">本月定稿</button>' : '<button class="btn btn-outline-secondary" data-action="reopen">重新打开</button>') : ''}</div>`;
    $('#manual-month').onchange = e => { if (!e.target.value) return; month = e.target.value; const url = new URL(location.href); url.searchParams.set('month', month); history.replaceState(null, '', url); load().catch(e => message(e.message, true)); };
    const importer = $('#manual-import'); if (importer) importer.onchange = e => importFile(e.target.files[0]).catch(e => message(e.message, true)).finally(() => { e.target.value = ''; });
    const shown = approvals.filter(a => filter === 'all' || a.status === filter);
    $('#module-content').innerHTML = `<div class="manual-summary"><div><span>${data.is_admin ? '' : '本人相关 · '}已通过金额</span><strong>¥${money(total)}</strong></div><div><span>待审批</span><strong>${pending.length}<small> 张</small></strong></div>${data.is_admin ? '<div><span>林敢计薪金额</span><strong>¥' + money(payroll) + '</strong></div>' : ''}</div>
      ${data.legacy_source ? '<div class="alert alert-info">本月为历史账本。<a href="/jun-pages/finance/sources/?month=' + esc(month) + '&source=manual_work">查看历史来源</a></div>' : importLocked ? '<div class="alert alert-info">本月企微文件已由' + (data.month_state.ingest_channel === 'automatic_collection' ? '采集器' : '手动导入') + '接收，导入入口已关闭；网页新增审批仍可继续使用。</div>' : ''}
      <div class="manual-list-toolbar"><div class="manual-tabs" role="group" aria-label="审批状态">${[['all', '全部'], ...Object.entries(labels)].map(([k, v]) => `<button class="manual-tab ${filter === k ? 'is-active' : ''}" aria-pressed="${filter === k}" data-filter="${k}">${v}<span>${k === 'all' ? approvals.length : approvals.filter(a => a.status === k).length}</span></button>`).join('')}</div><span class="manual-muted">共 ${shown.length} 张审批</span></div>
      <div class="manual-card-list">${shown.map(a => cardHtml(a, open)).join('') || '<div class="manual-empty"><i class="ti ti-clipboard-check" aria-hidden="true"></i><p>本月暂无' + (filter === 'all' ? '' : labels[filter]) + '记录</p></div>'}</div>`;
  }
  document.addEventListener('click', async e => {
    const retry = e.target.closest('[data-manual-retry]');
    if (retry) { load().catch(error => message(error.message,true)); return; }
    const attachment = e.target.closest('[data-attachments]');
    if (attachment) {
      attachment.disabled = true;
      const label = attachment.textContent; attachment.textContent = '正在加载附件…';
      try {
        const approval = await fullApproval(attachment.dataset.attachments);
        if (attachment.isConnected) attachment.parentElement.innerHTML = imagesHtml(validImages(approval.details[Number(attachment.dataset.detailIndex)]));
      } catch(error) { message(error.name === 'AbortError' ? '附件加载超时，请重试' : error.message,true); attachment.disabled=false; attachment.textContent=label; }
      return;
    }
    const thumb = e.target.closest('[data-preview]');
    if (thumb) {
      if (!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(thumb.dataset.preview)) return;
      document.querySelector('#manual-image-viewer')?.remove();
      const viewer = document.createElement('dialog'); viewer.id = 'manual-image-viewer'; viewer.className = 'manual-image-viewer';
      viewer.innerHTML = `<button type="button" aria-label="关闭图片预览">×</button><img src="${thumb.dataset.preview}" alt="附件图片预览">`;
      document.body.append(viewer); viewer.querySelector('button').onclick = () => viewer.close(); viewer.onclick = event => { if (event.target === viewer) viewer.close(); }; viewer.showModal(); return;
    }
    if (loading || data?.month !== month) return;
    const f = e.target.closest('[data-filter]'); if (f) { filter = f.dataset.filter; render(); return; }
    const b = e.target.closest('[data-action]'); if (!b || busy) return;
    const action = b.dataset.action, a = data.approvals.find(a => a.id === b.dataset.id);
    if (action === 'new') return createBatch();
    if (action === 'edit') {
      b.disabled=true;
      try { edit(await fullApproval(a.id)); }
      catch(error) { message(error.name === 'AbortError' ? '读取审批超时，请重试' : error.message,true); }
      finally { b.disabled=false; }
      return;
    }
    if (action === 'approve') return mutate('review', { id: a.id, expected_version: a.version, status: 'approved' });
    if (['reject', 'cancel', 'reopen', 'finalize'].includes(action)) {
      const reasonNeeded = ['reject', 'reopen'].includes(action);
      dialog({ reject: '驳回手工审批', cancel: '撤销手工审批', reopen: '重新打开本月', finalize: '本月定稿' }[action], reasonNeeded ? '<label class="form-label">原因<textarea name="reason" class="form-control" required maxlength="1000"></textarea></label>' : `<p>${action === 'finalize' ? '定稿后，本月记录将锁定。需要调整时由管理员填写原因重新打开。' : '确认撤销这条待审批记录？'}</p>`, { label: { reject: '确认驳回', cancel: '确认撤销', reopen: '重新打开', finalize: '确认定稿' }[action], run: f => mutate(action === 'reject' ? 'review' : action, { id: a?.id, expected_version: a?.version ?? data.month_state.version, status: 'rejected', reason: f.get('reason') || '' }) });
    }
  });
  async function load(signal) {
    const version = ++loadVersion, requestedMonth = month;
    activeLoad?.abort();
    const controller = new AbortController(); activeLoad = controller;
    const abort = () => controller.abort();
    if (signal?.aborted) abort(); else signal?.addEventListener('abort',abort,{once:true});
    const timer = setTimeout(abort,20000);
    loading = true;
    $('#manual-message')?.remove();
    document.querySelectorAll('[data-action]').forEach(button => button.disabled=true);
    $('#module-content').innerHTML = `<div class="manual-empty" role="status">正在加载 ${esc(requestedMonth)} 手工审批…</div>`;
    try {
      const result = await api(undefined,undefined,controller.signal,requestedMonth);
      if (version !== loadVersion || requestedMonth !== month) return;
      data = result; attachmentCache.clear(); render();
    } catch(error) {
      if (version !== loadVersion) return;
      $('#module-content').innerHTML = `<div class="manual-empty"><p>${error.name === 'AbortError' ? '加载超时，请重试' : '暂时无法加载本月审批'}</p><button type="button" class="btn btn-outline-primary" data-manual-retry>重新加载 ${esc(requestedMonth)}</button></div>`;
      // Keep the retry control visible, including on first load.
      message(error.name === 'AbortError' ? '加载超时，请重试' : error.message,true);
      throw error;
    } finally {
      clearTimeout(timer); signal?.removeEventListener('abort',abort);
      if (version === loadVersion) loading = false;
    }
  }
  Promise.resolve(window.JUN_AUTH_READY).then(() => { month = window.JUN_PAGE_STATE?.resolveMonth(month) || month; window.JUN_PAGE_STATE?.rememberMonth(month, false); return load(); }).catch(e => { message(e.name === 'AbortError' ? '加载超时，请重试' : e.message, true); });
})(typeof window !== 'undefined' ? window : globalThis);
