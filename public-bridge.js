(function () {
  'use strict';

  const config = window.JUN_CONFIG;
  const nativeFetch = window.fetch.bind(window);
  const basePath = config.pagesBasePath.replace(/\/$/, '');
  const loginUrl = `${basePath}/login.html`;
  const homeUrl = `${basePath}/`;

  document.documentElement.classList.add('jun-auth-pending');

  if (!window.supabase || !config?.supabaseUrl || !config?.supabasePublishableKey) {
    document.documentElement.classList.remove('jun-auth-pending');
    document.documentElement.classList.add('jun-auth-error');
    throw new Error('JUN authentication configuration is unavailable');
  }

  const client = window.supabase.createClient(
    config.supabaseUrl,
    config.supabasePublishableKey,
    {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    }
  );
  window.JUN_SUPABASE = client;

  function returnPath() {
    return `${window.location.pathname}${window.location.search}${window.location.hash}`;
  }

  function redirectToLogin(reason) {
    const params = new URLSearchParams({return: returnPath()});
    if (reason) params.set('reason', reason);
    window.location.replace(`${loginUrl}?${params}`);
  }

  const authReady = (async function () {
    const {data, error} = await client.auth.getSession();
    if (error || !data.session) {
      redirectToLogin(error ? 'session' : 'login');
      return null;
    }

    const {data: profile, error: profileError} = await client
      .from('profiles')
      .select('role, disabled')
      .eq('id', data.session.user.id)
      .single();

    if (profileError || !profile || profile.disabled || profile.role !== 'admin') {
      await client.auth.signOut();
      redirectToLogin('access');
      return null;
    }

    document.documentElement.classList.remove('jun-auth-pending');
    document.documentElement.classList.add('jun-auth-ready');
    return data.session;
  })().catch(function (error) {
    console.error('JUN auth gate failed', error);
    redirectToLogin('session');
    return null;
  });

  function isLocalApiRequest(input) {
    const raw = typeof input === 'string' ? input : input?.url;
    if (!raw) return null;
    const parsed = new URL(raw, window.location.href);
    if (raw.startsWith('/api/') || (parsed.origin === window.location.origin && parsed.pathname.startsWith('/api/'))) {
      return parsed;
    }
    return null;
  }

  window.fetch = async function (input, init) {
    const apiUrl = isLocalApiRequest(input);
    if (!apiUrl) return nativeFetch(input, init);

    let session = await authReady;
    if (!session) {
      return new Response(JSON.stringify({error: 'authentication_required'}), {
        status: 401,
        headers: {'Content-Type': 'application/json'}
      });
    }

    const refreshed = await client.auth.getSession();
    if (refreshed.error || !refreshed.data.session) {
      redirectToLogin('expired');
      return new Response(JSON.stringify({error: 'session_expired'}), {
        status: 401,
        headers: {'Content-Type': 'application/json'}
      });
    }
    session = refreshed.data.session;

    const edgeUrl = new URL(
      `${config.supabaseUrl}/functions/v1/${config.edgeFunctionName}${apiUrl.pathname}`
    );
    edgeUrl.search = apiUrl.search;

    const options = {...(init || {})};
    const headers = new Headers(options.headers || {});
    headers.set('Authorization', `Bearer ${session.access_token}`);
    headers.set('apikey', config.supabasePublishableKey);
    headers.set('Accept', headers.get('Accept') || 'application/json');
    options.headers = headers;
    options.cache = 'no-store';

    const response = await nativeFetch(edgeUrl.toString(), options);
    if (response.status === 401) {
      await client.auth.signOut();
      redirectToLogin('expired');
    }
    return response;
  };

  window.JUN_SIGN_OUT = async function () {
    await client.auth.signOut();
    window.location.assign(loginUrl);
  };

  window.JUN_HOME = homeUrl;
})();
