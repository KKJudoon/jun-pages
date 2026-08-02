(function () {
  'use strict';

  const config = window.JUN_CONFIG;
  const client = window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey, {
    auth: {persistSession: true, autoRefreshToken: true, detectSessionInUrl: true}
  });
  const form = document.getElementById('login-form');
  const fields = document.getElementById('login-fields');
  const submit = document.getElementById('login-submit');
  const message = document.getElementById('login-message');
  const devicePanel = document.getElementById('device-panel');
  const deviceTitle = document.getElementById('device-title');
  const deviceName = document.getElementById('device-name');
  const deviceTime = document.getElementById('device-time');
  const passwordPanel = document.getElementById('password-panel');
  const passwordSubmit = document.getElementById('password-submit');
  const basePath = config.pagesBasePath.replace(/\/$/, '');
  const query = new URLSearchParams(window.location.search);
  let pollTimer = null;

  function safeReturnPath(context) {
    const candidate = query.get('return') || `${basePath}/`;
    if (candidate === basePath || candidate.startsWith(`${basePath}/`)) return candidate;
    const home = String(context?.role?.home_path || '/');
    return `${basePath}${home === '/' ? '/' : home}`;
  }

  function reasonMessage() {
    const reason = query.get('reason');
    if (reason === 'access') return '这个账号没有访问当前页面的权限。';
    if (reason === 'disabled') return '这个账号已停用，请联系管理员。';
    if (reason === 'expired') return '登录已过期，请重新登录。';
    if (reason === 'password') return '请先设置新的登录密码。';
    return '';
  }

  function loginEmail(account) {
    const value = String(account || '').trim().toLowerCase();
    return value.includes('@') ? value : `${value}@auth.jun.internal`;
  }

  async function edgeBootstrap(session) {
    const headers = new Headers({
      'Authorization': `Bearer ${session.access_token}`,
      'apikey': config.supabasePublishableKey,
      'Accept': 'application/json'
    });
    Object.entries(window.JUN_DEVICE.headers()).forEach(function (entry) { headers.set(entry[0], entry[1]); });
    const response = await fetch(`${config.supabaseUrl}/functions/v1/${config.edgeFunctionName}/api/auth/bootstrap`, {headers, cache: 'no-store'});
    return {response, payload: await response.json().catch(function () { return {}; })};
  }

  function stopPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  }

  function showLogin(text) {
    stopPolling();
    message.classList.remove('info');
    fields.hidden = false;
    devicePanel.hidden = true;
    passwordPanel.hidden = true;
    message.textContent = text || '';
    submit.disabled = false;
  }

  function showPassword(context) {
    stopPolling();
    message.classList.remove('info');
    fields.hidden = true;
    devicePanel.hidden = true;
    passwordPanel.hidden = false;
    message.textContent = '';
    passwordSubmit.dataset.returnPath = safeReturnPath(context);
  }

  function showDevice(payload) {
    fields.hidden = true;
    devicePanel.hidden = false;
    passwordPanel.hidden = true;
    const status = payload.device?.status || 'pending';
    message.classList.toggle('info', status === 'pending');
    deviceTitle.textContent = status === 'rejected' ? '设备申请已拒绝' : status === 'revoked' ? '设备授权已撤销' : '等待管理员审批';
    deviceName.textContent = payload.device?.label || window.JUN_DEVICE.label();
    deviceTime.textContent = payload.device?.requested_at ? `申请时间：${new Date(payload.device.requested_at).toLocaleString('zh-CN')}` : '';
    message.textContent = status === 'rejected' ? '请联系管理员重新审核。' : status === 'revoked' ? '请联系管理员后重新登录。' : '审批后本页会自动进入。';
    if (status === 'pending' && !pollTimer) pollTimer = setInterval(checkExistingSession, 10000);
  }

  async function handleBootstrap(session) {
    const result = await edgeBootstrap(session);
    if (result.response.ok) {
      if (result.payload.profile?.must_change_password) { showPassword(result.payload); return; }
      window.location.replace(safeReturnPath(result.payload));
      return;
    }
    if (result.response.status === 423 || ['device_approval_required', 'device_rejected', 'device_revoked'].includes(result.payload.error)) {
      showDevice(result.payload);
      return;
    }
    if (result.payload.error === 'account_disabled') {
      await client.auth.signOut();
      showLogin('这个账号已停用，请联系管理员。');
      return;
    }
    if (result.response.status === 401) {
      await client.auth.signOut();
      showLogin('登录已过期，请重新登录。');
      return;
    }
    showLogin('登录验证失败，请联系管理员。');
  }

  async function checkExistingSession() {
    const result = await client.auth.getSession();
    if (!result.data.session) { showLogin(reasonMessage()); return; }
    await handleBootstrap(result.data.session);
  }

  form.addEventListener('submit', async function (event) {
    event.preventDefault();
    if (fields.hidden) return;
    submit.disabled = true;
    message.textContent = '';
    const data = new FormData(form);
    const email = loginEmail(data.get('account'));
    const password = String(data.get('password') || '');
    const result = await client.auth.signInWithPassword({email, password});
    if (result.error || !result.data.session) {
      message.textContent = '登录失败，请检查账号和密码。';
      submit.disabled = false;
      return;
    }
    await handleBootstrap(result.data.session);
  });

  passwordSubmit.addEventListener('click', async function () {
    const password = document.getElementById('new-password').value;
    const confirm = document.getElementById('confirm-password').value;
    if (password !== confirm) { message.textContent = '两次密码不一致。'; return; }
    if (password.length < 12 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/\d/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
      message.textContent = '密码强度不足，请按提示设置。';
      return;
    }
    passwordSubmit.disabled = true;
    const update = await client.auth.updateUser({password});
    if (update.error) { message.textContent = '密码更新失败，请稍后重试。'; passwordSubmit.disabled = false; return; }
    const session = (await client.auth.getSession()).data.session;
    if (!session) { showLogin('登录已过期，请使用新密码重新登录。'); return; }
    const headers = new Headers({'Authorization': `Bearer ${session.access_token}`, 'apikey': config.supabasePublishableKey});
    Object.entries(window.JUN_DEVICE.headers()).forEach(function (entry) { headers.set(entry[0], entry[1]); });
    const acknowledgement = await fetch(`${config.supabaseUrl}/functions/v1/${config.edgeFunctionName}/api/account/password-changed`, {method: 'POST', headers});
    if (!acknowledgement.ok) { message.textContent = '密码已更新，但账户状态确认失败，请重新登录。'; passwordSubmit.disabled = false; return; }
    window.location.replace(passwordSubmit.dataset.returnPath || `${basePath}/`);
  });

  document.getElementById('device-refresh').addEventListener('click', checkExistingSession);
  document.getElementById('device-logout').addEventListener('click', async function () { stopPolling(); await client.auth.signOut(); showLogin('已退出登录。'); });

  async function initialize() {
    if (query.get('logout') === '1') await client.auth.signOut();
    message.textContent = reasonMessage();
    if (query.get('logout') !== '1') await checkExistingSession();
  }

  initialize().catch(function (error) {
    console.error('Login initialization failed', error);
    showLogin('登录服务暂时不可用，请稍后重试。');
  });
})();
