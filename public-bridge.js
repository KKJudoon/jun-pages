(function () {
  'use strict';

  const config = window.JUN_CONFIG;
  const nativeFetch = window.fetch.bind(window);
  const basePath = config.pagesBasePath.replace(/\/$/, '');
  const loginUrl = `${basePath}/login.html`;
  const homeUrl = `${basePath}/`;

  document.documentElement.classList.add('jun-auth-pending');

  if (!window.supabase || !window.JUN_DEVICE || !config?.supabaseUrl || !config?.supabasePublishableKey) {
    document.documentElement.classList.remove('jun-auth-pending');
    document.documentElement.classList.add('jun-auth-error');
    throw new Error('JUN authentication configuration is unavailable');
  }

  const client = window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey, {
    auth: {persistSession: true, autoRefreshToken: true, detectSessionInUrl: true}
  });
  window.JUN_SUPABASE = client;

  function returnPath() {
    return `${window.location.pathname}${window.location.search}${window.location.hash}`;
  }

  function redirectToLogin(reason) {
    const params = new URLSearchParams({return: returnPath()});
    if (reason) params.set('reason', reason);
    window.location.replace(`${loginUrl}?${params}`);
  }

  async function currentSession() {
    const result = await client.auth.getSession();
    if (result.error) throw result.error;
    return result.data.session;
  }

  async function refreshSession() {
    const result = await client.auth.refreshSession();
    return {session: result.data.session, error: result.error};
  }

  function authUnavailableResponse() {
    return new Response(JSON.stringify({error: 'authentication_temporarily_unavailable'}), {
      status: 503,
      headers: {'Content-Type': 'application/json'}
    });
  }

  async function edgeFetch(path, options, suppliedSession) {
    let initialSession;
    try {
      initialSession = suppliedSession || await currentSession();
    } catch (error) {
      console.warn('Unable to refresh the persisted login session', error);
      return authUnavailableResponse();
    }
    if (!initialSession) return new Response(JSON.stringify({error: 'authentication_required'}), {status: 401, headers: {'Content-Type': 'application/json'}});
    const url = new URL(`${config.edgeFunctionBaseUrl}${path}`);
    const baseOptions = {...(options || {})};

    async function send(session) {
      const requestOptions = {...baseOptions};
      const headers = new Headers(baseOptions.headers || {});
      headers.set('Authorization', `Bearer ${session.access_token}`);
      headers.set('apikey', config.supabasePublishableKey);
      headers.set('Accept', headers.get('Accept') || 'application/json');
      Object.entries(window.JUN_DEVICE.headers()).forEach(function (entry) { headers.set(entry[0], entry[1]); });
      requestOptions.headers = headers;
      requestOptions.cache = 'no-store';
      return nativeFetch(url.toString(), requestOptions);
    }

    let response = await send(initialSession);
    if (response.status !== 401) return response;

    let retrySession;
    try {
      retrySession = await currentSession();
    } catch (error) {
      console.warn('Unable to read the refreshed login session', error);
      return authUnavailableResponse();
    }
    if (!retrySession || retrySession.access_token === initialSession.access_token) {
      const refreshed = await refreshSession();
      if (refreshed.error) {
        const status = Number(refreshed.error.status || 0);
        if (!status || status >= 500 || refreshed.error.name === 'AuthRetryableFetchError') return authUnavailableResponse();
        return response;
      }
      retrySession = refreshed.session;
    }
    if (!retrySession || retrySession.access_token === initialSession.access_token) return response;
    response.body?.cancel().catch(function () {});
    response = await send(retrySession);
    return response;
  }

  function pagePermission(pathname) {
    if (pathname.startsWith(`${basePath}/admin/users`)) return 'users.manage';
    if (pathname.startsWith(`${basePath}/finance/sources`)) return 'finance.sources.read';
    if (pathname.startsWith(`${basePath}/finance`)) return 'finance.read';
    if (pathname.startsWith(`${basePath}/production`)) return 'production.read';
    if (pathname.startsWith(`${basePath}/inventory`)) return 'inventory.read';
    if (pathname.startsWith(`${basePath}/erp`)) return 'orders.read';
    if (pathname.startsWith(`${basePath}/sycm`)) return 'operations.sycm.read';
    if (pathname.startsWith(`${basePath}/marketing-safety`)) return 'operations.marketing.read';
    return 'operations.overview.read';
  }

  function allowedHome(context) {
    const preferred = String(context.role?.home_path || '/');
    return `${basePath}${preferred === '/' ? '/' : preferred}`;
  }

  function avatarStyle(key) {
    const index = Math.max(0, Math.min(15, Number.parseInt(String(key || 'avatar-01').slice(-2), 10) - 1));
    const column = index % 4;
    const row = Math.floor(index / 4);
    return `--jun-avatar-x:${column * 100 / 3}%;--jun-avatar-y:${row * 100 / 3}%`;
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, function (character) {
      return {'&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'}[character];
    });
  }

  const feedbackModules = [
    ['overview','经营总览','/'],['inventory','库存明细','/inventory/'],['erp','ERP 订单与发货','/erp/'],
    ['sycm','生意参谋','/sycm/'],['marketing','营销安全','/marketing-safety/'],['production','生产记工','/production/'],
    ['production_manual','手工审批','/production/manual/'],['production_pattern','制版审批','/production/pattern/'],
    ['finance_report','财务月报','/finance/'],['finance_company_payroll','公司工资表','/finance/company-payroll/'],
    ['finance_payroll','工资发放','/finance/payroll/'],['finance_sources','财务数据源','/finance/sources/'],
    ['finance_employees','员工信息','/finance/employees/'],['admin_users','用户与安全','/admin/users/'],['account','账号与登录','/account/'],['other','其他','/other/'],
  ];

  function currentFeedbackModule() {
    const relative = window.location.pathname.slice(basePath.length) || '/';
    const ordered = feedbackModules.filter(function (item) { return item[2] !== '/'; }).sort(function (a, b) { return b[2].length - a[2].length; });
    return (ordered.find(function (item) { return relative.startsWith(item[2]); }) || feedbackModules[0])[0];
  }

  function navPermission(pathname) {
    if (pathname.startsWith(`${basePath}/finance/sources`)) return 'finance.sources.read';
    if (pathname.startsWith(`${basePath}/finance`)) return 'finance.read';
    if (pathname.startsWith(`${basePath}/production`)) return 'production.read';
    if (pathname.startsWith(`${basePath}/inventory`)) return 'inventory.read';
    if (pathname.startsWith(`${basePath}/erp`)) return 'orders.read';
    if (pathname.startsWith(`${basePath}/sycm`)) return 'operations.sycm.read';
    if (pathname.startsWith(`${basePath}/marketing-safety`)) return 'operations.marketing.read';
    if (pathname === `${basePath}/` || pathname === basePath) return 'operations.overview.read';
    return null;
  }

  function applyPermissionNavigation(context) {
    const permissions = new Set(context.permissions || []);
    document.querySelectorAll('a[href]').forEach(function (anchor) {
      const pathname = new URL(anchor.href, window.location.href).pathname;
      const required = navPermission(pathname);
      if (required && !permissions.has(required)) {
        anchor.hidden = true;
        anchor.setAttribute('aria-hidden', 'true');
      }
    });

    const permissionStyles = document.createElement('style');
    permissionStyles.id = 'jun-permission-styles';
    const hiddenSelectors = [];
    if (!permissions.has('inventory.preferences.manage')) {
      hiddenSelectors.push('#spot-column-picker', '#spot-filter-layout', '[data-resize-column]');
    }
    if (!permissions.has('products.tags.manage')) {
      hiddenSelectors.push('[data-product-tags-manage]', '[data-product-tag-edit]');
    }
    if (hiddenSelectors.length) {
      permissionStyles.textContent = `${hiddenSelectors.join(',')} { display: none !important; }`;
      document.head.appendChild(permissionStyles);
    }
  }

  function dialogShell(id, title, body) {
    const dialog = document.createElement('dialog');
    dialog.id = id;
    dialog.className = 'jun-dialog';
    dialog.innerHTML = `<form method="dialog" class="jun-dialog-card"><header><h3>${title}</h3><button value="cancel" class="jun-icon-button" aria-label="关闭">×</button></header><div class="jun-dialog-body">${body}</div></form>`;
    document.body.appendChild(dialog);
    return dialog;
  }

  function renderAccount(context) {
    const profile = context.profile;
    const permissions = new Set(context.permissions || []);
    const displayName = escapeHtml(profile.display_name || profile.username);
    const username = escapeHtml(profile.username);
    const roleLabel = escapeHtml(context.role?.label || profile.role);
    const shell = document.createElement('div');
    shell.className = 'jun-account-shell';
    shell.innerHTML = `
      <button class="jun-refresh-button" type="button" title="刷新当前页面" aria-label="刷新当前页面">
        <i class="ti ti-refresh" aria-hidden="true"></i>
      </button>
      <button class="jun-notification-button" type="button" aria-label="登录审批通知" hidden>
        <i class="ti ti-bell"></i><span class="jun-notification-badge" hidden></span>
      </button>
      <button class="jun-account-button" type="button" aria-expanded="false">
        <span class="jun-avatar" style="${avatarStyle(profile.avatar_key)}"></span>
        <span class="jun-account-copy"><strong>${displayName}</strong><small>${roleLabel}</small></span>
        <i class="ti ti-chevron-down"></i>
      </button>
      <div class="jun-account-menu" hidden>
        <div class="jun-account-summary"><span class="jun-avatar jun-avatar-lg" style="${avatarStyle(profile.avatar_key)}"></span><div><strong>${displayName}</strong><small>@${username} · ${roleLabel}</small></div></div>
        ${permissions.has('users.manage') ? `<a href="${basePath}/admin/users/"><i class="ti ti-users"></i>用户与安全</a>` : ''}
        <button type="button" data-action="feedback"><i class="ti ti-message-plus"></i>功能修改建议</button>
        <button type="button" data-action="profile"><i class="ti ti-user-edit"></i>个人资料</button>
        <button type="button" data-action="password"><i class="ti ti-key"></i>修改密码</button>
        ${profile.role !== 'admin' ? '<button type="button" data-action="devices"><i class="ti ti-devices"></i>登录设备</button>' : ''}
        <button type="button" data-action="logout" class="jun-menu-danger"><i class="ti ti-logout"></i>退出登录</button>
      </div>
      <div class="jun-notification-menu" hidden><div class="jun-notification-header"><strong>登录审批</strong><a href="${basePath}/admin/users/?tab=approvals">全部查看</a></div><div class="jun-notification-list">正在读取…</div></div>`;
    document.body.appendChild(shell);

    const accountButton = shell.querySelector('.jun-account-button');
    const accountMenu = shell.querySelector('.jun-account-menu');
    const refreshButton = shell.querySelector('.jun-refresh-button');
    const notificationButton = shell.querySelector('.jun-notification-button');
    const notificationMenu = shell.querySelector('.jun-notification-menu');

    refreshButton.addEventListener('click', function () {
      refreshButton.disabled = true;
      refreshButton.classList.add('is-refreshing');
      refreshButton.setAttribute('aria-label', '正在刷新当前页面');
      window.location.reload();
    });
    accountButton.addEventListener('click', function () {
      const opening = accountMenu.hidden;
      accountMenu.hidden = !opening;
      notificationMenu.hidden = true;
      accountButton.setAttribute('aria-expanded', String(opening));
    });
    notificationButton.addEventListener('click', function () {
      notificationMenu.hidden = !notificationMenu.hidden;
      accountMenu.hidden = true;
    });
    document.addEventListener('click', function (event) {
      if (!shell.contains(event.target)) {
        accountMenu.hidden = true;
        notificationMenu.hidden = true;
      }
    });

    const profileDialog = dialogShell('jun-profile-dialog', '个人资料', `
      <label>显示名称<input name="display_name" maxlength="60" value="${displayName}"></label>
      <label>账号<input value="${username}" disabled></label>
      <div class="jun-field-label">选择像素头像</div>
      <div class="jun-avatar-grid">${Array.from({length: 16}, function (_, index) {
        const key = `avatar-${String(index + 1).padStart(2, '0')}`;
        return `<button type="button" class="jun-avatar-choice${key === profile.avatar_key ? ' active' : ''}" data-avatar="${key}" aria-label="头像 ${index + 1}"><span class="jun-avatar jun-avatar-option" style="${avatarStyle(key)}"></span></button>`;
      }).join('')}</div>
      <p class="jun-form-message" aria-live="polite"></p>
      <footer><button value="cancel" class="jun-secondary-button">取消</button><button type="button" class="jun-primary-button" data-save-profile>保存资料</button></footer>`);
    let selectedAvatar = profile.avatar_key;
    profileDialog.querySelectorAll('[data-avatar]').forEach(function (button) {
      button.addEventListener('click', function () {
        selectedAvatar = button.dataset.avatar;
        profileDialog.querySelectorAll('[data-avatar]').forEach(function (item) { item.classList.toggle('active', item === button); });
      });
    });
    profileDialog.querySelector('[data-save-profile]').addEventListener('click', async function () {
      const message = profileDialog.querySelector('.jun-form-message');
      const displayName = profileDialog.querySelector('[name="display_name"]').value.trim();
      const response = await window.fetch('/api/account/profile', {method: 'PATCH', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({display_name: displayName, avatar_key: selectedAvatar})});
      const payload = await response.json();
      if (!response.ok) { message.textContent = payload.detail || '保存失败'; return; }
      window.location.reload();
    });

    const passwordDialog = dialogShell('jun-password-dialog', '修改密码', `
      <label>新密码<input name="password" type="password" autocomplete="new-password" minlength="12"></label>
      <label>再次输入<input name="confirm" type="password" autocomplete="new-password" minlength="12"></label>
      <p class="jun-password-hint">至少 12 位，并包含大小写字母、数字和符号。</p>
      <p class="jun-form-message" aria-live="polite"></p>
      <footer><button value="cancel" class="jun-secondary-button">取消</button><button type="button" class="jun-primary-button" data-save-password>更新密码</button></footer>`);
    passwordDialog.querySelector('[data-save-password]').addEventListener('click', async function () {
      const password = passwordDialog.querySelector('[name="password"]').value;
      const confirm = passwordDialog.querySelector('[name="confirm"]').value;
      const message = passwordDialog.querySelector('.jun-form-message');
      if (password !== confirm) { message.textContent = '两次密码不一致'; return; }
      if (password.length < 12 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password) || !/[^A-Za-z0-9]/.test(password)) { message.textContent = '密码强度不足'; return; }
      const result = await client.auth.updateUser({password});
      if (result.error) { message.textContent = '密码更新失败，请稍后重试'; return; }
      await window.fetch('/api/account/password-changed', {method: 'POST'});
      message.classList.add('success');
      message.textContent = '密码已更新';
      setTimeout(function () { passwordDialog.close(); }, 700);
    });

    const deviceDialog = dialogShell('jun-device-dialog', '登录设备', '<div class="jun-device-list">正在读取…</div><footer><button value="cancel" class="jun-secondary-button">关闭</button></footer>');

    const feedbackDialog = dialogShell('jun-feedback-dialog', '功能修改建议', `
      <p class="jun-dialog-note">建议会绑定模块和当前页面并保留处理记录，方便后续直接定位修改。</p>
      <label>对应模块<select name="module_key">${feedbackModules.map(function (item) { return `<option value="${item[0]}">${item[1]}</option>`; }).join('')}</select></label>
      <label>修改建议<textarea name="suggestion" maxlength="3000" rows="5" placeholder="请写清希望修改什么、现在有什么问题"></textarea></label>
      <p class="jun-form-message" aria-live="polite"></p>
      <footer><button value="cancel" class="jun-secondary-button">关闭</button><button type="button" class="jun-primary-button" data-submit-feedback>提交建议</button></footer>
      <div class="jun-feedback-history"><h4>${profile.role === 'admin' ? '全部建议记录' : '我的建议记录'}</h4><div data-feedback-list>正在读取…</div></div>`);
    feedbackDialog.querySelector('[name="module_key"]').value = currentFeedbackModule();
    const feedbackStatusLabels = {submitted:'已提交',accepted:'已采纳',in_progress:'处理中',done:'已完成',declined:'暂不处理'};
    async function loadFeedback() {
      const response = await window.fetch('/api/feedback');
      const payload = await response.json().catch(function () { return {}; });
      const target = feedbackDialog.querySelector('[data-feedback-list]');
      if (!response.ok) { target.textContent = payload.detail || '读取建议记录失败'; return; }
      target.innerHTML = (payload.items || []).map(function (item) {
        const module = feedbackModules.find(function (option) { return option[0] === item.module_key; });
        const adminControls = payload.admin ? `<div class="jun-feedback-admin"><select data-feedback-status="${item.id}">${Object.entries(feedbackStatusLabels).map(function (entry) { return `<option value="${entry[0]}" ${entry[0] === item.status ? 'selected' : ''}>${entry[1]}</option>`; }).join('')}</select><input data-feedback-note="${item.id}" maxlength="1500" placeholder="处理说明" value="${escapeHtml(item.resolution_note || '')}"><button type="button" data-feedback-save="${item.id}" data-version="${item.version}">保存状态</button></div>` : '';
        return `<article class="jun-feedback-item"><header><strong>${escapeHtml(module?.[1] || item.module_key)}</strong><span class="is-${escapeHtml(item.status)}">${escapeHtml(feedbackStatusLabels[item.status] || item.status)}</span></header><p>${escapeHtml(item.suggestion)}</p><small>${escapeHtml(item.created_by_name || '')} · ${new Date(item.created_at).toLocaleString('zh-CN')} · ${escapeHtml(item.page_path)}</small>${item.resolution_note ? `<div class="jun-feedback-resolution">${escapeHtml(item.resolution_note)}</div>` : ''}${adminControls}</article>`;
      }).join('') || '<p class="jun-dialog-note">还没有建议记录。</p>';
      target.querySelectorAll('[data-feedback-save]').forEach(function (button) {
        button.addEventListener('click', async function () {
          button.disabled = true;
          const id = button.dataset.feedbackSave;
          const status = target.querySelector(`[data-feedback-status="${id}"]`).value;
          const resolutionNote = target.querySelector(`[data-feedback-note="${id}"]`).value.trim();
          const savedResponse = await window.fetch(`/api/feedback/${id}/status`, {method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:status,resolution_note:resolutionNote,expected_version:Number(button.dataset.version)})});
          if (!savedResponse.ok) { button.disabled=false; return; }
          await loadFeedback();
        });
      });
    }
    feedbackDialog.querySelector('[data-submit-feedback]').addEventListener('click', async function () {
      const suggestion = feedbackDialog.querySelector('[name="suggestion"]').value.trim();
      const message = feedbackDialog.querySelector('.jun-form-message');
      if (suggestion.length < 3) { message.textContent='请至少写 3 个字'; return; }
      const response = await window.fetch('/api/feedback',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({module_key:feedbackDialog.querySelector('[name="module_key"]').value,page_path:`${window.location.pathname}${window.location.search}`,suggestion:suggestion})});
      const payload = await response.json().catch(function () { return {}; });
      if (!response.ok) { message.textContent=payload.detail||'提交失败'; return; }
      feedbackDialog.querySelector('[name="suggestion"]').value=''; message.classList.add('success'); message.textContent='已提交并记录'; await loadFeedback();
    });
    async function showDevices() {
      deviceDialog.showModal();
      const response = await window.fetch('/api/account/devices');
      const payload = await response.json();
      const list = deviceDialog.querySelector('.jun-device-list');
      list.innerHTML = (payload.devices || []).map(function (device) {
        return `<article><div><strong>${escapeHtml(device.label)}</strong><small>${escapeHtml(device.platform || '')} · ${escapeHtml(device.status)} · 最近 ${new Date(device.last_seen_at).toLocaleString('zh-CN')}</small></div>${device.status === 'approved' ? `<button type="button" data-revoke-device="${device.id}">撤销</button>` : ''}</article>`;
      }).join('') || '<p class="text-secondary">没有已登记设备。</p>';
      list.querySelectorAll('[data-revoke-device]').forEach(function (button) {
        button.addEventListener('click', async function () {
          if (!confirm('撤销后，此设备下次登录需要重新申请，确定继续吗？')) return;
          await window.fetch(`/api/account/devices/${button.dataset.revokeDevice}/revoke`, {method: 'POST'});
          window.JUN_DEVICE.rotate();
          await client.auth.signOut();
          window.location.assign(loginUrl);
        });
      });
    }

    accountMenu.addEventListener('click', function (event) {
      const action = event.target.closest('[data-action]')?.dataset.action;
      if (action === 'profile') profileDialog.showModal();
      if (action === 'feedback') { feedbackDialog.showModal(); loadFeedback(); }
      if (action === 'password') passwordDialog.showModal();
      if (action === 'devices') showDevices();
      if (action === 'logout') window.JUN_SIGN_OUT();
      accountMenu.hidden = true;
    });

    async function refreshNotifications() {
      if (!permissions.has('security.devices.approve')) return;
      notificationButton.hidden = false;
      const response = await window.fetch('/api/admin/notifications');
      if (!response.ok) return;
      const payload = await response.json();
      const badge = shell.querySelector('.jun-notification-badge');
      badge.hidden = !payload.unread_count;
      badge.textContent = payload.unread_count > 99 ? '99+' : String(payload.unread_count || '');
      shell.querySelector('.jun-notification-list').innerHTML = (payload.items || []).map(function (item) {
        return `<a href="${basePath}/admin/users/?tab=approvals"><span class="jun-avatar" style="${avatarStyle(item.avatar_key)}"></span><div><strong>${escapeHtml(item.display_name || item.username)}</strong><small>${escapeHtml(item.label)} 请求登录</small></div><time>${new Date(item.requested_at).toLocaleString('zh-CN')}</time></a>`;
      }).join('') || '<p>没有待审批设备</p>';
    }
    refreshNotifications();
    if (permissions.has('security.devices.approve')) setInterval(refreshNotifications, 30000);
  }

  const authReady = (async function () {
    const session = await currentSession();
    if (!session) { redirectToLogin('login'); return null; }
    const response = await edgeFetch('/api/auth/bootstrap', {method: 'GET'}, session);
    const context = await response.json().catch(function () { return {}; });
    if (response.status === 423) { redirectToLogin('device'); return null; }
    if (response.status === 428 || context.error === 'password_change_required') { redirectToLogin('password'); return null; }
    if (!response.ok) {
      if (['account_disabled', 'profile_not_found', 'invalid_session'].includes(context.error)) await client.auth.signOut();
      redirectToLogin(context.error === 'account_disabled' ? 'disabled' : 'access');
      return null;
    }
    const preferredHome = allowedHome(context);
    const atBaseHome = window.location.pathname === basePath || window.location.pathname === `${basePath}/`;
    if (atBaseHome && preferredHome !== window.location.pathname) {
      window.location.replace(preferredHome);
      return null;
    }
    const required = pagePermission(window.location.pathname);
    if (required && !(context.permissions || []).includes(required)) {
      const target = allowedHome(context);
      if (target !== window.location.pathname) { window.location.replace(target); return null; }
      redirectToLogin('access');
      return null;
    }
    window.JUN_CONTEXT = context;
    applyPermissionNavigation(context);
    renderAccount(context);
    document.documentElement.classList.remove('jun-auth-pending');
    document.documentElement.classList.add('jun-auth-ready');
    return {context};
  })().catch(function (error) {
    console.error('JUN auth gate failed', error);
    redirectToLogin('session');
    return null;
  });

  function isLocalApiRequest(input) {
    const raw = typeof input === 'string' ? input : input?.url;
    if (!raw) return null;
    const parsed = new URL(raw, window.location.href);
    if (raw.startsWith('/api/') || (parsed.origin === window.location.origin && parsed.pathname.startsWith('/api/'))) return parsed;
    return null;
  }

  window.fetch = async function (input, init) {
    const apiUrl = isLocalApiRequest(input);
    if (!apiUrl) return nativeFetch(input, init);
    const ready = await authReady;
    if (!ready) return new Response(JSON.stringify({error: 'authentication_required'}), {status: 401, headers: {'Content-Type': 'application/json'}});
    const response = await edgeFetch(`${apiUrl.pathname}${apiUrl.search}`, init);
    if (response.status === 401) { await client.auth.signOut(); redirectToLogin('expired'); }
    if (response.status === 423) redirectToLogin('device');
    if (response.status === 428) redirectToLogin('password');
    return response;
  };

  window.JUN_EDGE_FETCH = edgeFetch;
  window.JUN_AUTH_READY = authReady;
  window.JUN_SIGN_OUT = async function () { await client.auth.signOut(); window.location.assign(loginUrl); };
  window.JUN_HOME = homeUrl;
})();
