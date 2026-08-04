(function () {
  'use strict';

  const state = {users: [], roles: [], permissions: [], mappings: [], devices: [], context: null};
  const userDialog = document.getElementById('user-dialog');
  const userForm = document.getElementById('user-form');
  const roleDialog = document.getElementById('role-dialog');
  const roleForm = document.getElementById('role-form');
  const permissionDialog = document.getElementById('permission-dialog');
  const permissionForm = document.getElementById('permission-form');
  const secretDialog = document.getElementById('secret-dialog');
  const deleteDialog = document.getElementById('delete-dialog');
  const deleteForm = document.getElementById('delete-form');
  let selectedAvatar = 'avatar-01';

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>'"]/g, function (character) {
      return {'&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'}[character];
    });
  }

  function avatarStyle(key) {
    const index = Math.max(0, Math.min(15, Number.parseInt(String(key || 'avatar-01').slice(-2), 10) - 1));
    return `--jun-avatar-x:${(index % 4) * 100 / 3}%;--jun-avatar-y:${Math.floor(index / 4) * 100 / 3}%`;
  }

  function formatDate(value) {
    return value ? new Date(value).toLocaleString('zh-CN', {dateStyle: 'short', timeStyle: 'short'}) : '从未';
  }

  async function api(path, options) {
    const response = await window.fetch(path, options);
    const payload = await response.json().catch(function () { return {}; });
    if (!response.ok) {
      const error = new Error(payload.detail || payload.error || '请求失败');
      error.payload = payload;
      throw error;
    }
    return payload;
  }

  function roleByKey(key) { return state.roles.find(function (role) { return role.role_key === key; }) || {label: key}; }
  function userById(id) { return state.users.find(function (user) { return user.id === id; }); }
  function mappingSet(role) { return new Set(state.mappings.filter(function (row) { return row.role === role && row.allowed; }).map(function (row) { return row.permission_key; })); }
  function roleHomeLabel(path) {
    return {'/inventory/': '库存明细', '/erp/': '订单审核', '/erp/products/': '商品档案', '/sycm/': '运营数据', '/marketing-safety/': '营销安全', '/': '工作台'}[path] || path;
  }

  function renderSummary() {
    const active = state.users.filter(function (user) { return !user.disabled; }).length;
    const admins = state.users.filter(function (user) { return user.role === 'admin' && !user.disabled; }).length;
    const pending = state.devices.filter(function (device) { return device.status === 'pending'; }).length;
    const changePassword = state.users.filter(function (user) { return user.must_change_password; }).length;
    document.getElementById('summary-grid').innerHTML = [
      ['团队账号', state.users.length, 'ti-users', ''],
      ['启用账号', active, 'ti-user-check', ''],
      ['待审批设备', pending, 'ti-device-mobile-question', pending ? 'warning' : ''],
      ['待改临时密码', changePassword, 'ti-key', changePassword ? 'warning' : '']
    ].map(function (item) { return `<article class="summary-card"><small><i class="ti ${item[2]}"></i> ${item[0]}</small><strong class="${item[3]}">${item[1]}</strong></article>`; }).join('');
    const badge = document.getElementById('approval-badge');
    badge.hidden = !pending;
    badge.textContent = pending;
    if (!admins) console.error('No active administrator remains');
  }

  function userActions(user) {
    const isSelf = state.context.profile.id === user.id;
    return `<div class="action-group">
      <button type="button" data-user-action="edit" data-id="${user.id}"><i class="ti ti-edit"></i>编辑</button>
      <button type="button" data-user-action="permissions" data-id="${user.id}"><i class="ti ti-shield"></i>权限</button>
      ${isSelf ? '' : `<button type="button" data-user-action="reset" data-id="${user.id}"><i class="ti ti-key"></i>重置密码</button><button type="button" class="danger" data-user-action="delete" data-id="${user.id}"><i class="ti ti-trash"></i>删除</button>`}
    </div>`;
  }

  function renderUsers() {
    const query = document.getElementById('user-search').value.trim().toLowerCase();
    const users = state.users.filter(function (user) { return `${user.username} ${user.display_name || ''}`.toLowerCase().includes(query); });
    document.getElementById('user-table-body').innerHTML = users.map(function (user) {
      const role = roleByKey(user.role);
      const deviceText = user.role === 'admin' ? '管理员免审' : `${user.devices.approved} 已通过${user.devices.pending ? ` · ${user.devices.pending} 待审` : ''}`;
      return `<tr><td><div class="user-cell"><span class="jun-avatar" style="${avatarStyle(user.avatar_key)}"></span><div><strong>${escapeHtml(user.display_name || user.username)}</strong><small>@${escapeHtml(user.username)}${user.must_change_password ? ' · 待改密码' : ''}</small></div></div></td><td><span class="role-badge">${escapeHtml(role.label)}</span></td><td><span class="status-badge ${user.disabled ? 'disabled' : ''}">${user.disabled ? '已停用' : '启用'}</span></td><td>${escapeHtml(deviceText)}</td><td>${formatDate(user.last_sign_in_at)}</td><td>${userActions(user)}</td></tr>`;
    }).join('') || '<tr><td colspan="6" class="empty-state">没有匹配的用户</td></tr>';
    document.getElementById('user-card-list').innerHTML = users.map(function (user) {
      return `<article class="user-mobile-card"><header><div class="user-cell"><span class="jun-avatar" style="${avatarStyle(user.avatar_key)}"></span><div><strong>${escapeHtml(user.display_name || user.username)}</strong><small>@${escapeHtml(user.username)} · ${escapeHtml(roleByKey(user.role).label)}</small></div></div><span class="status-badge ${user.disabled ? 'disabled' : ''}">${user.disabled ? '停用' : '启用'}</span></header>${userActions(user)}</article>`;
    }).join('');
  }

  function renderAvatarPicker(key) {
    selectedAvatar = key || 'avatar-01';
    document.getElementById('user-avatar-picker').innerHTML = Array.from({length: 16}, function (_, index) {
      const avatar = `avatar-${String(index + 1).padStart(2, '0')}`;
      return `<button type="button" data-avatar="${avatar}" class="${avatar === selectedAvatar ? 'active' : ''}" aria-label="头像 ${index + 1}"><span class="jun-avatar" style="${avatarStyle(avatar)}"></span></button>`;
    }).join('');
  }

  function openUserDialog(user) {
    userForm.reset();
    userForm.querySelector('.dialog-message').textContent = '';
    userForm.elements.id.value = user?.id || '';
    userForm.elements.username.value = user?.username || '';
    userForm.elements.username.disabled = Boolean(user);
    userForm.elements.display_name.value = user?.display_name || '';
    userForm.elements.role.innerHTML = state.roles.map(function (role) { return `<option value="${role.role_key}">${escapeHtml(role.label)}</option>`; }).join('');
    userForm.elements.role.value = user?.role || 'readonly';
    userForm.elements.disabled.checked = Boolean(user?.disabled);
    document.getElementById('disabled-row').hidden = !user;
    document.getElementById('user-dialog-eyebrow').textContent = user ? '编辑账号' : '新增账号';
    document.getElementById('user-dialog-title').textContent = user ? (user.display_name || user.username) : '新增用户';
    renderAvatarPicker(user?.avatar_key || 'avatar-01');
    userDialog.showModal();
  }

  function loginUrl() {
    const basePath = String(window.JUN_CONFIG?.pagesBasePath || '/jun-pages').replace(/\/+$/, '');
    return `${window.location.origin}${basePath}/login.html`;
  }

  function secretBundle() {
    return [
      '生意中台登录信息',
      `登录网址：${document.getElementById('secret-url').textContent}`,
      `登录账号：${document.getElementById('secret-username').textContent}`,
      `临时密码：${document.getElementById('secret-password').textContent}`,
      '首次登录后请按提示修改密码。'
    ].join('\n');
  }

  function showSecret(username, password) {
    document.getElementById('secret-url').textContent = loginUrl();
    document.getElementById('secret-username').textContent = username;
    document.getElementById('secret-password').textContent = password;
    document.getElementById('secret-copy-status').textContent = '';
    document.querySelectorAll('#secret-dialog [data-copy], #secret-dialog [data-copy-all]').forEach(function (button) {
      button.innerHTML = button.dataset.copyAll ? '<i class="ti ti-copy"></i>复制全部登录信息' : '<i class="ti ti-copy"></i>';
      button.disabled = false;
    });
    secretDialog.showModal();
  }

  function openRoleDialog(role) {
    roleForm.reset();
    roleForm.querySelector('.dialog-message').textContent = '';
    roleForm.elements.role_key.value = role?.role_key || '';
    roleForm.elements.label.value = role?.label || '';
    roleForm.elements.description.value = role?.description || '';
    roleForm.elements.home_path.value = role?.home_path || '/inventory/';
    document.getElementById('role-dialog-eyebrow').textContent = role ? '编辑角色' : '新增角色';
    document.getElementById('role-dialog-title').textContent = role?.label || '新增角色';
    document.getElementById('role-system-note').hidden = !role?.system_role;
    roleDialog.showModal();
  }

  function openPermissions(user) {
    permissionForm.elements.id.value = user.id;
    document.getElementById('permission-title').textContent = `${user.display_name || user.username} · 个人权限`;
    const overrides = new Map((user.permission_overrides || []).map(function (row) { return [row.permission_key, row.allowed]; }));
    const defaults = mappingSet(user.role);
    const modules = Object.groupBy ? Object.groupBy(state.permissions, function (permission) { return permission.module; }) : state.permissions.reduce(function (result, permission) { (result[permission.module] ||= []).push(permission); return result; }, {});
    document.getElementById('permission-groups').innerHTML = Object.entries(modules).map(function (entry) {
      return `<section class="permission-override-group"><h4>${escapeHtml(entry[0])}</h4>${entry[1].map(function (permission) {
        const current = overrides.has(permission.permission_key) ? String(overrides.get(permission.permission_key)) : 'inherit';
        const inherited = user.role === 'admin' || defaults.has(permission.permission_key);
        return `<label class="permission-override-row"><div><strong>${escapeHtml(permission.label)}</strong><small>${escapeHtml(permission.description || '')} · 角色默认${inherited ? '允许' : '拒绝'}</small></div><select data-permission="${permission.permission_key}" ${user.role === 'admin' ? 'disabled' : ''}><option value="inherit" ${current === 'inherit' ? 'selected' : ''}>继承角色</option><option value="true" ${current === 'true' ? 'selected' : ''}>明确允许</option><option value="false" ${current === 'false' ? 'selected' : ''}>明确拒绝</option></select></label>`;
      }).join('')}</section>`;
    }).join('');
    permissionDialog.showModal();
  }

  function renderRoles() {
    const modules = state.permissions.reduce(function (result, permission) { (result[permission.module] ||= []).push(permission); return result; }, {});
    document.getElementById('role-grid').innerHTML = state.roles.map(function (role) {
      const allowed = mappingSet(role.role_key);
      const admin = role.role_key === 'admin';
      return `<article class="role-card" data-role-card="${role.role_key}"><header><div><div class="role-title-line"><h3>${escapeHtml(role.label)}</h3><span class="role-kind">${role.system_role ? '系统角色' : '自定义'}</span></div><p>${escapeHtml(role.description || '暂无角色说明')}</p><small>${Number(role.user_count || 0)} 个用户 · 默认进入${escapeHtml(roleHomeLabel(role.home_path))}</small></div><span class="role-badge">${admin ? '固定全权限' : `${allowed.size} 项权限`}</span></header><div class="permission-list">${Object.entries(modules).map(function (entry) { return `<div class="permission-module">${escapeHtml(entry[0])}</div>${entry[1].map(function (permission) { const checked = admin || allowed.has(permission.permission_key); return `<label class="permission-row"><input type="checkbox" data-role-permission="${permission.permission_key}" ${checked ? 'checked' : ''} ${admin ? 'disabled' : ''}><span><strong>${escapeHtml(permission.label)}</strong><small>${escapeHtml(permission.description || '')}</small></span></label>`; }).join('')}`; }).join('')}</div><footer><div class="role-card-actions"><button type="button" class="btn btn-outline-secondary" data-edit-role="${role.role_key}"><i class="ti ti-edit"></i>编辑</button>${role.system_role ? '' : `<button type="button" class="btn btn-outline-danger" data-delete-role="${role.role_key}"><i class="ti ti-trash"></i>删除</button>`}</div>${admin ? '' : `<button type="button" class="btn btn-primary" data-save-role="${role.role_key}">保存权限</button>`}</footer></article>`;
    }).join('');
  }

  async function loadApprovals() {
    const status = document.getElementById('approval-filter').value;
    const payload = await api(`/api/admin/device-approvals?status=${encodeURIComponent(status)}&limit=300`);
    state.devices = payload.devices || [];
    renderSummary();
    document.getElementById('approval-list').innerHTML = state.devices.map(function (device) {
      const pending = device.status === 'pending';
      const approved = device.status === 'approved';
      return `<article class="approval-card"><span class="jun-avatar jun-avatar-lg" style="${avatarStyle(device.avatar_key)}"></span><div class="approval-copy"><strong>${escapeHtml(device.display_name || device.username)} · ${escapeHtml(device.label)}</strong><small>@${escapeHtml(device.username)} · ${escapeHtml(device.platform || '未知平台')} · 申请 ${formatDate(device.requested_at)} · 最近 ${formatDate(device.last_seen_at)}</small><span class="status-badge ${pending ? 'pending' : device.status === 'revoked' || device.status === 'rejected' ? 'disabled' : ''}">${escapeHtml(device.status)}</span></div><div class="approval-actions">${pending ? `<button class="btn btn-success" data-device-decision="approved" data-id="${device.id}">通过</button><button class="btn btn-outline-danger" data-device-decision="rejected" data-id="${device.id}">拒绝</button>` : ''}${approved ? `<button class="btn btn-outline-danger" data-device-revoke="${device.id}">撤销</button>` : ''}</div></article>`;
    }).join('') || '<div class="empty-state">当前没有对应的设备记录</div>';
  }

  const eventLabels = {
    'device.requested': ['ti-device-mobile-question', '申请新设备登录'],
    'device.approved': ['ti-device-mobile-check', '批准设备登录'],
    'device.rejected': ['ti-device-mobile-x', '拒绝设备登录'],
    'device.revoked': ['ti-device-off', '撤销设备授权'],
    'user.created': ['ti-user-plus', '创建用户'],
    'user.updated': ['ti-user-edit', '更新用户'],
    'user.deleted': ['ti-user-minus', '删除用户'],
    'user.password_reset': ['ti-key', '重置用户密码'],
    'user.password_changed': ['ti-lock-check', '用户修改密码'],
    'user.permissions_updated': ['ti-shield-cog', '更新个人权限'],
    'role.created': ['ti-shield-plus', '创建角色'],
    'role.updated': ['ti-shield-cog', '更新角色资料'],
    'role.deleted': ['ti-shield-x', '删除角色'],
    'role.permissions_updated': ['ti-shield-lock', '更新角色权限'],
    'profile.updated': ['ti-id', '更新个人资料']
  };

  async function loadAudit() {
    const payload = await api('/api/admin/audit?limit=200');
    document.getElementById('audit-list').innerHTML = (payload.events || []).map(function (event) {
      const label = eventLabels[event.event_type] || ['ti-history', event.event_type];
      const actor = event.actor_name || event.actor_username || '系统';
      const target = event.target_name || event.target_username || event.metadata?.username || '';
      return `<article class="audit-item"><span class="audit-icon"><i class="ti ${label[0]}"></i></span><div><strong>${escapeHtml(label[1])}</strong><small>${escapeHtml(actor)}${target ? ` → ${escapeHtml(target)}` : ''}</small></div><time>${formatDate(event.created_at)}</time></article>`;
    }).join('') || '<div class="empty-state">暂无安全日志</div>';
  }

  function switchTab(tab) {
    document.querySelectorAll('[data-tab]').forEach(function (button) { button.classList.toggle('active', button.dataset.tab === tab); });
    document.querySelectorAll('[data-panel]').forEach(function (panel) { panel.classList.toggle('active', panel.dataset.panel === tab); });
    const url = new URL(window.location.href); url.searchParams.set('tab', tab); history.replaceState(null, '', url);
    if (tab === 'approvals') loadApprovals();
    if (tab === 'audit') loadAudit();
  }

  document.querySelector('.admin-tabs').addEventListener('click', function (event) { const tab = event.target.closest('[data-tab]')?.dataset.tab; if (tab) switchTab(tab); });
  document.getElementById('create-user').addEventListener('click', function () { openUserDialog(null); });
  document.getElementById('create-role').addEventListener('click', function () { openRoleDialog(null); });
  document.addEventListener('click', function (event) {
    const closeButton = event.target.closest('[data-dialog-close]');
    if (closeButton) closeButton.closest('dialog')?.close('cancel');
  });
  document.getElementById('user-search').addEventListener('input', renderUsers);
  document.getElementById('approval-filter').addEventListener('change', loadApprovals);
  document.getElementById('refresh-audit').addEventListener('click', loadAudit);
  document.getElementById('user-avatar-picker').addEventListener('click', function (event) { const button = event.target.closest('[data-avatar]'); if (!button) return; selectedAvatar = button.dataset.avatar; document.querySelectorAll('#user-avatar-picker [data-avatar]').forEach(function (item) { item.classList.toggle('active', item === button); }); });

  userForm.addEventListener('submit', async function (event) {
    event.preventDefault();
    const id = userForm.elements.id.value;
    const payload = {display_name: userForm.elements.display_name.value.trim(), role: userForm.elements.role.value, avatar_key: selectedAvatar};
    if (!id) payload.username = userForm.elements.username.value.trim().toLowerCase();
    else payload.disabled = userForm.elements.disabled.checked;
    try {
      const result = await api(id ? `/api/admin/users/${id}` : '/api/admin/users', {method: id ? 'PATCH' : 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(payload)});
      userDialog.close();
      await loadBase();
      if (result.temporary_password) showSecret(payload.username || userById(id)?.username, result.temporary_password);
    } catch (error) { userForm.querySelector('.dialog-message').textContent = error.message; }
  });

  roleForm.addEventListener('submit', async function (event) {
    event.preventDefault();
    const roleKey = roleForm.elements.role_key.value;
    const payload = {
      label: roleForm.elements.label.value.trim(),
      description: roleForm.elements.description.value.trim(),
      home_path: roleForm.elements.home_path.value
    };
    try {
      await api(roleKey ? `/api/admin/roles/${roleKey}` : '/api/admin/roles', {
        method: roleKey ? 'PATCH' : 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(payload)
      });
      roleDialog.close();
      await loadBase();
      const card = roleKey ? document.querySelector(`[data-role-card="${roleKey}"]`) : document.querySelector('[data-role-card]:last-child');
      card?.scrollIntoView({block: 'nearest', behavior: 'smooth'});
    } catch (error) {
      roleForm.querySelector('.dialog-message').textContent = error.message;
    }
  });

  document.getElementById('user-table-body').addEventListener('click', handleUserAction);
  document.getElementById('user-card-list').addEventListener('click', handleUserAction);
  async function handleUserAction(event) {
    const button = event.target.closest('[data-user-action]'); if (!button) return;
    const user = userById(button.dataset.id); if (!user) return;
    if (button.dataset.userAction === 'edit') openUserDialog(user);
    if (button.dataset.userAction === 'permissions') openPermissions(user);
    if (button.dataset.userAction === 'reset' && confirm(`为 ${user.username} 生成新的临时密码吗？`)) {
      try { const result = await api(`/api/admin/users/${user.id}/reset-password`, {method: 'POST'}); await loadBase(); showSecret(user.username, result.temporary_password); } catch (error) { alert(error.message); }
    }
    if (button.dataset.userAction === 'delete') {
      deleteForm.reset(); deleteForm.elements.id.value = user.id; document.getElementById('delete-username-label').textContent = user.username; deleteDialog.showModal();
    }
  }

  permissionForm.addEventListener('submit', async function (event) {
    event.preventDefault();
    const id = permissionForm.elements.id.value;
    const overrides = [...permissionForm.querySelectorAll('[data-permission]')].filter(function (select) { return select.value !== 'inherit'; }).map(function (select) { return {permission_key: select.dataset.permission, allowed: select.value === 'true'}; });
    try { await api(`/api/admin/users/${id}/permissions`, {method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({overrides})}); permissionDialog.close(); await loadBase(); } catch (error) { permissionForm.querySelector('.dialog-message').textContent = error.message; }
  });

  deleteForm.addEventListener('submit', async function (event) {
    event.preventDefault();
    const user = userById(deleteForm.elements.id.value);
    if (!user || deleteForm.elements.confirmation.value !== user.username) { deleteForm.querySelector('.dialog-message').textContent = '账号输入不一致'; return; }
    try { await api(`/api/admin/users/${user.id}`, {method: 'DELETE'}); deleteDialog.close(); await loadBase(); } catch (error) { deleteForm.querySelector('.dialog-message').textContent = error.message; }
  });

  document.getElementById('role-grid').addEventListener('click', async function (event) {
    const edit = event.target.closest('[data-edit-role]');
    const remove = event.target.closest('[data-delete-role]');
    const save = event.target.closest('[data-save-role]');
    if (edit) {
      const role = roleByKey(edit.dataset.editRole);
      if (role.role_key) openRoleDialog(role);
      return;
    }
    if (remove) {
      const role = roleByKey(remove.dataset.deleteRole);
      if (!role.role_key) return;
      if (Number(role.user_count || 0) > 0) {
        alert(`“${role.label}”仍分配给 ${role.user_count} 个用户，请先调整用户角色。`);
        return;
      }
      if (!confirm(`删除自定义角色“${role.label}”吗？该角色的默认权限也会删除。`)) return;
      remove.disabled = true;
      try { await api(`/api/admin/roles/${role.role_key}`, {method: 'DELETE'}); await loadBase(); } catch (error) { alert(error.message); } finally { remove.disabled = false; }
      return;
    }
    if (!save) return;
    const card = save.closest('[data-role-card]');
    const permissions = [...card.querySelectorAll('[data-role-permission]:checked')].map(function (checkbox) { return checkbox.dataset.rolePermission; });
    save.disabled = true;
    try { await api(`/api/admin/roles/${save.dataset.saveRole}/permissions`, {method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({permissions})}); await loadBase(); } catch (error) { alert(error.message); } finally { save.disabled = false; }
  });

  document.getElementById('approval-list').addEventListener('click', async function (event) {
    const decision = event.target.closest('[data-device-decision]');
    const revoke = event.target.closest('[data-device-revoke]');
    try {
      if (decision) await api(`/api/admin/device-approvals/${decision.dataset.id}/decision`, {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({decision: decision.dataset.deviceDecision})});
      if (revoke && confirm('撤销后，这台设备必须重新申请，确定继续吗？')) await api(`/api/admin/devices/${revoke.dataset.deviceRevoke}/revoke`, {method: 'POST'});
      if (decision || revoke) { await loadApprovals(); await loadAudit(); }
    } catch (error) { alert(error.message); }
  });

  async function copyText(value) {
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(value);
        return;
      } catch (error) {
        // Fall through to the legacy textarea path when clipboard permission is unavailable.
      }
    }
    const input = document.createElement('textarea');
    input.value = value;
    input.setAttribute('readonly', '');
    input.style.position = 'fixed';
    input.style.opacity = '0';
    document.body.appendChild(input);
    input.select();
    const copied = document.execCommand('copy');
    input.remove();
    if (!copied) throw new Error('clipboard_unavailable');
  }

  function markCopied(button) {
    button.innerHTML = button.dataset.copyAll ? '<i class="ti ti-check"></i>已复制' : '<i class="ti ti-check"></i>';
    window.setTimeout(function () {
      if (button.isConnected) button.innerHTML = button.dataset.copyAll ? '<i class="ti ti-copy"></i>复制全部登录信息' : '<i class="ti ti-copy"></i>';
    }, 1800);
  }

  secretDialog.addEventListener('click', async function (event) {
    const allButton = event.target.closest('[data-copy-all]');
    const button = event.target.closest('[data-copy]');
    if (!allButton && !button) return;
    const status = document.getElementById('secret-copy-status');
    try {
      await copyText(allButton ? secretBundle() : document.getElementById(`secret-${button.dataset.copy}`).textContent);
      markCopied(allButton || button);
      status.textContent = allButton ? '登录网址、账号和临时密码已复制，可直接粘贴发送。' : '已复制';
    } catch (error) {
      status.textContent = '复制失败，请手动选择内容复制。';
    }
  });

  async function loadBase() {
    const contextPermissions = new Set(state.context?.permissions || []);
    const [usersPayload, rolesPayload, devicesPayload] = await Promise.all([
      api('/api/admin/users'),
      api('/api/admin/roles'),
      contextPermissions.has('security.devices.approve') ? api('/api/admin/device-approvals?status=all&limit=500') : Promise.resolve({devices: []})
    ]);
    state.users = usersPayload.users || [];
    state.roles = rolesPayload.roles || [];
    state.permissions = rolesPayload.permissions || [];
    state.mappings = rolesPayload.mappings || [];
    state.devices = devicesPayload.devices || [];
    renderSummary(); renderUsers(); renderRoles();
  }

  (async function initialize() {
    const ready = await window.JUN_AUTH_READY;
    if (!ready) return;
    state.context = ready.context;
    const permissions = new Set(state.context.permissions || []);
    if (!permissions.has('permissions.manage')) document.querySelector('[data-tab="roles"]').hidden = true;
    if (!permissions.has('security.devices.approve')) document.querySelector('[data-tab="approvals"]').hidden = true;
    if (!permissions.has('security.audit.read')) document.querySelector('[data-tab="audit"]').hidden = true;
    await loadBase();
    const requested = new URLSearchParams(window.location.search).get('tab') || 'users';
    switchTab(document.querySelector(`[data-tab="${requested}"]:not([hidden])`) ? requested : 'users');
  })().catch(function (error) {
    console.error('Account center initialization failed', error);
    document.querySelector('[data-panel="users"]').innerHTML = `<div class="empty-state">账户与安全中心加载失败：${escapeHtml(error.message)}</div>`;
  });
})();
