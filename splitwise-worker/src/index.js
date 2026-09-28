/**
 * "Connect Splitwise" for the poker app.
 *
 * Each admin logs in with THEIR OWN Splitwise account (OAuth 2.0). This worker:
 *   /login     → sends the browser to Splitwise's "Allow" page
 *   /callback  → swaps Splitwise's one-time code for the user's token (needs the app secret,
 *                which is why this can't live in the website), encrypts the token into an
 *                opaque "session" and sends the browser back to the app with it
 *   /api/...   → forwards the app's calls to Splitwise with the user's token. Only the three
 *                calls the app needs are allowed; nothing can be read or deleted beyond that.
 *
 * The browser only ever holds the encrypted session, which is useless without this worker.
 */

const API_ALLOWED = new Set(['GET get_current_user', 'GET get_groups', 'POST create_expense']);

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname === '/login') return login(url, env);
      if (url.pathname === '/callback') return await callback(request, url, env);
      if (url.pathname.startsWith('/api/')) return await api(request, url, env);
      return text('Poker Splitwise worker', 200);
    } catch (err) {
      return text(`Error: ${err instanceof Error ? err.message : 'unknown'}`, 500);
    }
  },
};

const base = (env) => env.SPLITWISE_BASE || 'https://secure.splitwise.com';

// ---------------------------------------------------------------- login flow

function login(url, env) {
  const back = url.searchParams.get('return') || '';
  if (!isAllowedUrl(back, env)) return text('Return address not allowed', 400);
  const nonce = randomId();
  const auth = new URL('/oauth/authorize', base(env));
  auth.searchParams.set('response_type', 'code');
  auth.searchParams.set('client_id', env.SPLITWISE_CLIENT_ID);
  auth.searchParams.set('redirect_uri', `${url.origin}/callback`);
  auth.searchParams.set('state', nonce);
  const cookie = b64url(new TextEncoder().encode(JSON.stringify({ n: nonce, r: back })));
  return new Response(null, {
    status: 302,
    headers: {
      Location: auth.toString(),
      'Set-Cookie': `sw_oauth=${cookie}; Path=/callback; Max-Age=600; HttpOnly;${secure(url)} SameSite=Lax`,
    },
  });
}

async function callback(request, url, env) {
  const saved = readCookie(request, 'sw_oauth');
  let n = '';
  let r = '';
  try {
    ({ n, r } = JSON.parse(new TextDecoder().decode(unb64url(saved))));
  } catch {
    return text('Login expired — go back to the app and tap Connect Splitwise again.', 400);
  }
  // The state must match the cookie set in /login (stops forged logins); re-check the return address.
  if (!n || url.searchParams.get('state') !== n || !isAllowedUrl(r, env)) return text('Login check failed', 400);

  const back = new URL(r);
  const clear = `sw_oauth=; Path=/callback; Max-Age=0; HttpOnly;${secure(url)} SameSite=Lax`;
  const code = url.searchParams.get('code');
  if (!code) {
    back.searchParams.set('sw_error', url.searchParams.get('error') || 'cancelled');
    return redirect(back, clear);
  }

  const res = await fetch(new URL('/oauth/token', base(env)), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: env.SPLITWISE_CLIENT_ID,
      client_secret: env.SPLITWISE_CLIENT_SECRET,
      redirect_uri: `${url.origin}/callback`,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.access_token) {
    back.searchParams.set('sw_error', 'token');
    return redirect(back, clear);
  }
  back.searchParams.set('sw_session', await seal(data.access_token, env));
  return redirect(back, clear);
}

// ---------------------------------------------------------------- API proxy

async function api(request, url, env) {
  const origin = request.headers.get('Origin') || '';
  if (!isAllowedOrigin(origin, env)) return text('Origin not allowed', 403);
  const cors = {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

  const name = url.pathname.slice('/api/'.length);
  if (!API_ALLOWED.has(`${request.method} ${name}`)) return json({ error: 'Not allowed' }, 403, cors);

  const session = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  const token = session && (await unseal(session, env));
  if (!token) return json({ error: 'Not connected to Splitwise' }, 401, cors);

  let body;
  if (request.method === 'POST') {
    body = await request.text();
    if (env.GROUP_ID) {
      const groupId = String(JSON.parse(body || '{}').group_id ?? '');
      if (groupId !== String(env.GROUP_ID)) return json({ error: 'Wrong Splitwise group' }, 403, cors);
    }
  }
  const res = await fetch(new URL(`/api/v3.0/${name}`, base(env)), {
    method: request.method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body,
  });
  return new Response(res.body, {
    status: res.status,
    headers: { ...cors, 'Content-Type': res.headers.get('Content-Type') || 'application/json' },
  });
}

// ---------------------------------------------------------------- helpers

function patternToRegex(p) {
  return new RegExp(`^${p.trim().replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[a-z0-9-]*')}$`, 'i');
}

function isAllowedOrigin(origin, env) {
  return (env.ALLOWED_ORIGINS || '').split(',').some((p) => p.trim() && patternToRegex(p).test(origin));
}

function isAllowedUrl(value, env) {
  try {
    return isAllowedOrigin(new URL(value).origin, env);
  } catch {
    return false;
  }
}

/** `Secure` cookies need https — skip it for `wrangler dev` on http://localhost. */
const secure = (url) => (url.protocol === 'https:' ? ' Secure;' : '');

function redirect(to, cookie) {
  return new Response(null, { status: 302, headers: { Location: to.toString(), 'Set-Cookie': cookie } });
}

const text = (body, status) => new Response(body, { status, headers: { 'Content-Type': 'text/plain' } });
const json = (body, status, headers) =>
  new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json' } });

function readCookie(request, name) {
  const match = (request.headers.get('Cookie') || '').match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? match[1] : '';
}

const randomId = () => b64url(crypto.getRandomValues(new Uint8Array(18)));

function b64url(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function unb64url(s) {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

async function sessionKey(env) {
  if (!env.SESSION_SECRET) throw new Error('SESSION_SECRET is not set');
  const raw = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(env.SESSION_SECRET));
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

/** Encrypt the user's Splitwise token; only this worker can open it. */
async function seal(token, env) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(JSON.stringify({ t: token }));
  const box = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await sessionKey(env), data));
  const out = new Uint8Array(iv.length + box.length);
  out.set(iv);
  out.set(box, iv.length);
  return b64url(out);
}

async function unseal(session, env) {
  try {
    const bytes = unb64url(session);
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: bytes.slice(0, 12) },
      await sessionKey(env),
      bytes.slice(12),
    );
    return JSON.parse(new TextDecoder().decode(plain)).t || '';
  } catch {
    return '';
  }
}
