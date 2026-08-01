import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.111.0/+esm';

const config = window.JUN_CONFIG || {};
const supabase = createClient(config.supabaseUrl, config.supabasePublishableKey);
const loginView = document.getElementById('login-view');
const workspaceView = document.getElementById('workspace-view');
const loginForm = document.getElementById('login-form');
const loginMessage = document.getElementById('login-message');
const accountName = document.getElementById('account-name');
const accountRole = document.getElementById('account-role');

function showMessage(message = '') {
  loginMessage.textContent = message;
}

function showWorkspace(user) {
  loginView.classList.add('is-hidden');
  workspaceView.classList.remove('is-hidden');
  accountName.textContent = user?.email?.split('@')[0] || '';
  accountRole.textContent = '权限配置中';
  document.querySelectorAll('[data-permission]').forEach(item => item.classList.add('is-hidden'));
}

async function denyAccess(message) {
  await supabase.auth.signOut();
  showLogin();
  showMessage(message);
}

async function loadProfile(user) {
  const { data, error } = await supabase
    .from('profiles')
    .select('username, role, display_name, disabled')
    .eq('id', user.id)
    .maybeSingle();
  if (error || !data) {
    await denyAccess('该账号尚未配置权限，请联系管理员。');
    return;
  }
  if (data.disabled) {
    await denyAccess('该账号已停用，请联系管理员。');
    return;
  }
  const roleLabels = {
    admin: '管理员',
    operations: '运营',
    warehouse: '仓库',
    readonly: '只读'
  };
  accountName.textContent = data.display_name || data.username;
  accountRole.textContent = roleLabels[data.role] || '未定义角色';

  const { data: permissionRows, error: permissionError } = await supabase
    .from('my_permissions')
    .select('permission_key');
  if (permissionError) {
    await denyAccess('权限读取失败，请稍后重试。');
    return;
  }

  const allowedPermissions = new Set(permissionRows.map(row => row.permission_key));
  document.querySelectorAll('[data-permission]').forEach(item => {
    item.classList.toggle('is-hidden', !allowedPermissions.has(item.dataset.permission));
  });
}

function showLogin() {
  workspaceView.classList.add('is-hidden');
  loginView.classList.remove('is-hidden');
  accountName.textContent = '';
  accountRole.textContent = '权限读取中';
  document.querySelectorAll('[data-permission]').forEach(item => item.classList.add('is-hidden'));
}

function authEmailForAccount(account) {
  const normalized = account.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._-]{1,31}$/.test(normalized)) return null;
  return `${normalized}@auth.jun.internal`;
}

loginForm.addEventListener('submit', async event => {
  event.preventDefault();
  const account = new FormData(loginForm).get('account')?.toString() || '';
  const password = new FormData(loginForm).get('password')?.toString() || '';
  const email = authEmailForAccount(account);
  if (!email) {
    showMessage('账号需使用 2–32 位字母、数字、点、下划线或短横线。');
    return;
  }
  showMessage('登录中...');
  const { data, error } = await supabase.auth.signInWithPassword({email, password});
  if (error) {
    showMessage('登录失败，请检查账号和密码。');
    return;
  }
  showMessage('');
  showWorkspace(data.user);
  await loadProfile(data.user);
});

document.getElementById('logout-button').addEventListener('click', async () => {
  await supabase.auth.signOut();
  showLogin();
});

supabase.auth.onAuthStateChange((_event, session) => {
  if (session?.user) {
    showWorkspace(session.user);
    loadProfile(session.user);
  }
  else showLogin();
});

const { data: { session } } = await supabase.auth.getSession();
if (session?.user) {
  showWorkspace(session.user);
  await loadProfile(session.user);
}
