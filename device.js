(function () {
  'use strict';

  const STORAGE_KEY = 'jun.trusted-device.v1';

  function randomKey() {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    let binary = '';
    bytes.forEach(function (byte) { binary += String.fromCharCode(byte); });
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function createIdentity() {
    return {
      id: crypto.randomUUID(),
      key: randomKey(),
      createdAt: new Date().toISOString()
    };
  }

  function readIdentity() {
    try {
      const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      if (value && /^[0-9a-f-]{36}$/i.test(value.id) && typeof value.key === 'string' && value.key.length >= 32) return value;
    } catch (error) {
      console.warn('Trusted device identity is unreadable', error);
    }
    const value = createIdentity();
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(value)); } catch (error) {
      console.warn('Trusted device identity is session-only', error);
    }
    return value;
  }

  function browserName() {
    const value = navigator.userAgent;
    if (/Edg\//.test(value)) return 'Edge';
    if (/CriOS\//.test(value)) return 'Chrome';
    if (/Chrome\//.test(value)) return 'Chrome';
    if (/Firefox\//.test(value)) return 'Firefox';
    if (/Safari\//.test(value)) return 'Safari';
    return '浏览器';
  }

  function platformName() {
    const raw = navigator.userAgentData?.platform || navigator.platform || navigator.userAgent;
    if (/iphone|ipad|ios/i.test(raw) || /iphone|ipad/i.test(navigator.userAgent)) return 'iOS';
    if (/android/i.test(raw) || /android/i.test(navigator.userAgent)) return 'Android';
    if (/mac/i.test(raw)) return 'macOS';
    if (/win/i.test(raw)) return 'Windows';
    if (/linux/i.test(raw)) return 'Linux';
    return String(raw || '未知平台').slice(0, 50);
  }

  let identity = readIdentity();

  window.JUN_DEVICE = {
    get: function () { return {...identity}; },
    rotate: function () {
      identity = createIdentity();
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(identity)); } catch (_) {}
      return {...identity};
    },
    label: function () { return `${browserName()} · ${platformName()}`; },
    platform: platformName,
    headers: function () {
      return {
        'X-Jun-Device-Id': identity.id,
        'X-Jun-Device-Key': identity.key,
        'X-Jun-Device-Label': encodeURIComponent(`${browserName()} · ${platformName()}`),
        'X-Jun-Device-Platform': encodeURIComponent(platformName())
      };
    }
  };

  function appendFilingFooter() {
    const filing = window.JUN_CONFIG?.filing || {};
    const icpNumber = String(filing.icpNumber || '').trim();
    const policeRecordNumber = String(filing.policeRecordNumber || '').trim();
    if (!icpNumber && !policeRecordNumber) return;

    const footer = document.createElement('footer');
    footer.className = 'jun-filing-footer';
    footer.setAttribute('aria-label', '网站备案信息');

    const companyName = String(filing.companyName || '').trim();
    if (companyName) {
      const company = document.createElement('span');
      company.textContent = companyName;
      footer.appendChild(company);
    }
    if (icpNumber) {
      const link = document.createElement('a');
      link.href = 'https://beian.miit.gov.cn/';
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = icpNumber;
      footer.appendChild(link);
    }
    if (policeRecordNumber) {
      const link = document.createElement('a');
      const code = policeRecordNumber.replace(/\D/g, '');
      link.href = `https://beian.mps.gov.cn/#/query/webSearch?code=${encodeURIComponent(code)}`;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.textContent = policeRecordNumber;
      footer.appendChild(link);
    }

    const style = document.createElement('style');
    style.textContent = `
      .jun-filing-footer {
        display: flex; flex-wrap: wrap; justify-content: center; gap: 6px 14px;
        padding: 12px 16px; color: #7a8699; background: #f4f6fa;
        border-top: 1px solid #e3e8ef; font-size: 12px; line-height: 1.5;
      }
      .jun-filing-footer a { color: inherit; text-decoration: none; }
      .jun-filing-footer a:hover { text-decoration: underline; }
    `;
    document.head.appendChild(style);
    document.body.appendChild(footer);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', appendFilingFooter, {once: true});
  } else {
    appendFilingFooter();
  }
})();
