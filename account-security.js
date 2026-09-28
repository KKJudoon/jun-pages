(function () {
  'use strict';
  const enroll = document.getElementById('mfa-enroll');
  const verify = document.getElementById('mfa-verify');
  const status = document.getElementById('mfa-status');
  const message = document.getElementById('mfa-message');
  const panel = document.getElementById('mfa-enrollment');
  const qr = document.getElementById('mfa-qr');
  let factorId = null;
  async function refresh() {
    const result = await window.JUN_SUPABASE.auth.mfa.listFactors();
    if (result.error) throw new Error('无法读取两步验证状态，请刷新重试。');
    const enabled = result.data.totp.some(function (factor) { return factor.status === 'verified'; });
    status.textContent = enabled ? '已开启。重新登录时，需要密码和验证器验证码。验证器丢失时，请联系维护者核实身份后恢复。' : '尚未开启。绑定后，重新登录需要密码和验证器验证码。';
    enroll.hidden = enabled;
    return result.data;
  }
  enroll.addEventListener('click', async function () {
    enroll.disabled = true;
    message.textContent = '';
    try {
      const factors = await refresh();
      if (factors.totp.some(function (factor) { return factor.status === 'verified'; })) return;
      for (const factor of factors.all || []) {
        if (factor.factor_type === 'totp' && factor.status === 'unverified' && factor.friendly_name === 'Jun authenticator') {
          const removed = await window.JUN_SUPABASE.auth.mfa.unenroll({factorId: factor.id});
          if (removed.error) throw new Error('上次绑定尚未清理，请稍后重试。');
        }
      }
      const result = await window.JUN_SUPABASE.auth.mfa.enroll({factorType: 'totp', friendlyName: 'Jun authenticator', issuer: 'JUN'});
      if (result.error) throw new Error('无法创建绑定，请稍后重试。');
      factorId = result.data.id;
      // An image resource, never injected as active SVG/HTML.
      qr.src = result.data.totp.qr_code;
      panel.hidden = false;
      document.getElementById('mfa-enroll-code').focus();
    } catch (error) { message.textContent = error.message; }
    finally { enroll.disabled = false; }
  });
  verify.addEventListener('click', async function () {
    const input = document.getElementById('mfa-enroll-code');
    const code = input.value.trim();
    if (!factorId || !/^[0-9]{6}$/.test(code)) { message.textContent = '请输入验证器中的 6 位验证码。'; return; }
    verify.disabled = true;
    try {
      const result = await window.JUN_SUPABASE.auth.mfa.challengeAndVerify({factorId, code});
      input.value = '';
      if (result.error) { message.textContent = '验证码无效或已过期，请重试。'; return; }
      panel.hidden = true;
      qr.removeAttribute('src');
      factorId = null;
      await refresh();
      message.textContent = '绑定成功，两步验证已生效。';
    } catch (_) { message.textContent = '验证服务暂时不可用，请稍后重试。'; }
    finally { verify.disabled = false; }
  });
  (async function () {
    if (await window.JUN_AUTH_READY) await refresh();
  })().catch(function (error) { status.textContent = error.message; });
})();
