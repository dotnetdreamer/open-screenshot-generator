/**
 * GitHub OAuth token exchange for Open Screenshot Generator.
 *
 * The editor is a static export with no backend, but GitHub's token exchange
 * requires a client secret and its OAuth endpoints send no CORS headers. This
 * Worker is the smallest thing that closes that gap: it holds the secret and
 * does the code-for-token swap. That is all it does. It stores nothing, has no
 * database, and never sees a user's projects, which stay in their own gists.
 *
 * The redirect target is this Worker rather than the app, which means one
 * GitHub OAuth App serves localhost dev and production alike (the app origin
 * travels in `state` and is checked against ALLOWED_ORIGINS). It also means the
 * app never calls this Worker with fetch, so there is no CORS surface at all:
 * the only traffic is the popup navigating here and a postMessage back.
 *
 * Flow:
 *   1. app popup  -> GET /start?state=...   (302 to GitHub)
 *   2. GitHub     -> GET /callback?code&state
 *   3. Worker exchanges the code, returns a page that postMessages the token
 *      to window.opener and closes.
 *
 * Deploy: see README.md in this folder.
 */

const GITHUB_AUTHORIZE = 'https://github.com/login/oauth/authorize';
const GITHUB_TOKEN = 'https://github.com/login/oauth/access_token';
/** Only gist access is ever requested. */
const SCOPE = 'gist';
/** Must match MESSAGE_SOURCE in src/lib/account/providers/github.ts. */
const MESSAGE_SOURCE = 'abs-github-oauth';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    switch (url.pathname) {
      case '/start':
        return handleStart(request, env, url);
      case '/callback':
        return handleCallback(request, env, url);
      case '/health':
        return json({ ok: true, configured: !!(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET) });
      default:
        return new Response('Not found', { status: 404 });
    }
  },
};

/** Origins allowed to start a sign-in and receive a token. */
function allowedOrigins(env) {
  return String(env.ALLOWED_ORIGINS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

/**
 * `state` is base64url JSON: { n: nonce, o: appOrigin }. The nonce is echoed
 * back so the app can tie the response to the request it started; the origin
 * tells us where the token may be posted, and is only honoured if allowlisted.
 */
function decodeState(raw) {
  if (!raw) return null;
  try {
    const padded = raw.replace(/-/g, '+').replace(/_/g, '/');
    const parsed = JSON.parse(atob(padded));
    if (typeof parsed?.n !== 'string' || typeof parsed?.o !== 'string') return null;
    return parsed;
  } catch {
    return null;
  }
}

function handleStart(request, env, url) {
  if (!env.GITHUB_CLIENT_ID) {
    return new Response('This sign-in service is not configured.', { status: 500 });
  }
  const raw = url.searchParams.get('state');
  const state = decodeState(raw);
  if (!state || !allowedOrigins(env).includes(state.o)) {
    // An unknown origin is either a misconfiguration or someone trying to
    // aim the token somewhere else. Refuse before involving GitHub.
    return new Response('This sign-in request came from an unrecognized site.', { status: 400 });
  }

  const authorize = new URL(GITHUB_AUTHORIZE);
  authorize.searchParams.set('client_id', env.GITHUB_CLIENT_ID);
  authorize.searchParams.set('redirect_uri', `${url.origin}/callback`);
  authorize.searchParams.set('scope', SCOPE);
  authorize.searchParams.set('state', raw);
  return Response.redirect(authorize.toString(), 302);
}

async function handleCallback(request, env, url) {
  const raw = url.searchParams.get('state');
  const state = decodeState(raw);
  // Without a trusted origin there is nowhere safe to postMessage, so this is
  // the one case that has to render a plain dead end.
  if (!state || !allowedOrigins(env).includes(state.o)) {
    return new Response('This sign-in response could not be verified.', { status: 400 });
  }

  const denied = url.searchParams.get('error');
  if (denied) {
    return resultPage(state, {
      error: url.searchParams.get('error_description') || denied,
    });
  }

  const code = url.searchParams.get('code');
  if (!code) return resultPage(state, { error: 'GitHub did not return an authorization code.' });

  try {
    const response = await fetch(GITHUB_TOKEN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        client_id: env.GITHUB_CLIENT_ID,
        client_secret: env.GITHUB_CLIENT_SECRET,
        code,
        redirect_uri: `${url.origin}/callback`,
      }),
    });
    const body = await response.json();
    if (body.error || !body.access_token) {
      return resultPage(state, {
        error: body.error_description || body.error || 'GitHub refused the sign-in.',
      });
    }
    return resultPage(state, { token: body.access_token });
  } catch {
    // Never surface the raw exception: it can carry request details.
    return resultPage(state, { error: 'Could not reach GitHub to complete sign-in.' });
  }
}

/**
 * Hand the result back to the app that opened this popup.
 * The payload goes in a JSON script tag rather than interpolated JS so nothing
 * here can be parsed as code, and postMessage is aimed at the exact origin.
 */
function resultPage(state, payload) {
  const data = JSON.stringify({
    source: MESSAGE_SOURCE,
    nonce: state.n,
    origin: state.o,
    ...payload,
  }).replace(/</g, '\\u003c');

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>${payload.error ? 'Sign-in failed' : 'Signed in'}</title>
<style>body{font-family:system-ui,sans-serif;display:flex;align-items:center;justify-content:center;
height:100vh;margin:0;background:#0b0d10;color:#e6e8eb;text-align:center;line-height:1.6}
p{margin:0;opacity:.75;font-size:.95rem}</style></head>
<body><p>${payload.error ? 'Sign-in failed. You can close this window.' : 'You can close this window.'}</p>
<script id="p" type="application/json">${data}</script>
<script>
(function () {
  var payload = JSON.parse(document.getElementById('p').textContent);
  var origin = payload.origin;
  delete payload.origin;
  if (window.opener) {
    try { window.opener.postMessage(payload, origin); } catch (e) {}
  }
  setTimeout(function () { window.close(); }, 150);
})();
</script></body></html>`;

  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // The token is in this response; keep it out of every cache.
      'Cache-Control': 'no-store',
    },
  });
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
