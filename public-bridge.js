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
    return result.error ? null : result.data.session;
  }

  async function edgeFetch(path, options, suppliedSession) {
    const session = suppliedSession || await currentSession();
    if (!session) return new Response(JSON.stringify({error: 'authentication_required'}), {status: 401, headers: {'Content-Type': 'application/json'}});
    const url = new URL(`${config.supabaseUrl}/functions/v1/${config.edgeFunctionName}${path}`);
    const requestOptions = {...(options || {})};
    const headers = new Headers(requestOptions.headers || {});
    headers.set('Authorization', `Bearer ${session.access_token}`);
    headers.set('apikey', config.supabasePublishableKey);
    headers.set('Accept', headers.get('Accept') || 'application/json');
    Object.entries(window.JUN_DEVICE.headers()).forEach(function (entry) { headers.set(entry[0], entry[1]); });
    requestOptions.headers = headers;
    requestOptions.cache = 'no-store';
    return nativeFetch(url.toString(), requestOptions);
  }

  function pagePermission(pathname) {
    if (pathname.startsWith(`${basePath}/admin/users`)) return 'users.manage';
    if (pathname.startsWith(`${basePath}/inventory`)) return 'inventory.read';
    if (pathname.startsWith(`${basePath}/erp/products`)) return 'products.read';
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

  function navPermission(pathname) {
    if (pathname.startsWith(`${basePath}/inventory`)) return 'inventory.read';
    if (pathname.startsWith(`${basePath}/erp/products`)) return 'products.read';
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
        <button type="button" data-action="profile"><i class="ti ti-user-edit"></i>个人资料</button>
        <button type="button" data-action="password"><i class="ti ti-key"></i>修改密码</button>
        ${profile.role !== 'admin' ? '<button type="button" data-action="devices"><i class="ti ti-devices"></i>登录设备</button>' : ''}
        <button type="button" data-action="logout" class="jun-menu-danger"><i class="ti ti-logout"></i>退出登录</button>
      </div>
      <div class="jun-notification-menu" hidden><div class="jun-notification-header"><strong>登录审批</strong><a href="${basePath}/admin/users/?tab=approvals">全部查看</a></div><div class="jun-notification-list">正在读取…</div></div>`;
    document.body.appendChild(shell);

    const accountButton = shell.querySelector('.jun-account-button');
    const accountMenu = shell.querySelector('.jun-account-menu');
    const notificationButton = shell.querySelector('.jun-notification-button');
    const notificationMenu = shell.querySelector('.jun-notification-menu');

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
    return {session, context};
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
    const response = await edgeFetch(`${apiUrl.pathname}${apiUrl.search}`, init, ready.session);
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
