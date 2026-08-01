(function () {
  'use strict';

  const config = window.JUN_CONFIG;
  const client = window.supabase.createClient(
    config.supabaseUrl,
    config.supabasePublishableKey
  );
  const form = document.getElementById('login-form');
  const submit = document.getElementById('login-submit');
  const message = document.getElementById('login-message');
  const basePath = config.pagesBasePath.replace(/\/$/, '');
  const query = new URLSearchParams(window.location.search);

  function safeReturnPath() {
    const candidate = query.get('return') || `${basePath}/`;
    return candidate === basePath || candidate.startsWith(`${basePath}/`)
      ? candidate
      : `${basePath}/`;
  }

  function reasonMessage() {
    const reason = query.get('reason');
    if (reason === 'access') return '这个账号没有管理员访问权限。';
    if (reason === 'expired') return '登录已过期，请重新登录。';
    return '';
  }

  async function initialize() {
    if (query.get('logout') === '1') await client.auth.signOut();
    const {data} = await client.auth.getSession();
    if (data.session && query.get('logout') !== '1') {
      window.location.replace(safeReturnPath());
      return;
    }
    message.textContent = reasonMessage();
  }

  form.addEventListener('submit', async function (event) {
    event.preventDefault();
    submit.disabled = true;
    message.textContent = '';
    const data = new FormData(form);
    const email = String(data.get('email') || '').trim();
    const password = String(data.get('password') || '');
    const result = await client.auth.signInWithPassword({email, password});
    if (result.error) {
      message.textContent = '登录失败，请检查邮箱和密码。';
      submit.disabled = false;
      return;
    }
    window.location.replace(safeReturnPath());
  });

  initialize().catch(function (error) {
    console.error('Login initialization failed', error);
    message.textContent = '登录服务暂时不可用，请稍后重试。';
  });
})();
