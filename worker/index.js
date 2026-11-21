// Cloudflare Worker: serves the game files and keeps each player's save in a
// D1 database, so a cleared browser or a new phone picks up the same game.
//
// Who is playing comes from Cloudflare Access, which sits in front of the
// whole site. Access signs a token (Cf-Access-Jwt-Assertion) for every request
// it lets through; this Worker checks that signature before trusting the
// email inside it.

export { LinkCable } from './link.js';

const FLASH_SIZE = 128 * 1024;
const LINK_CABLES = 3;
const HISTORY_KEEP = 20;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      try {
        return await handleApi(request, env, url);
      } catch (error) {
        if (error instanceof HttpError) return json({ error: error.message }, error.status);
        console.error(error);
        return json({ error: 'server error' }, 500);
      }
    }
    return env.ASSETS.fetch(request);
  },
};

async function handleApi(request, env, url) {
  const email = await playerEmail(request, env);

  if (url.pathname === '/api/whoami' && request.method === 'GET') {
    return json({ email });
  }

  if (url.pathname === '/api/link') {
    // The Cable Club's link cable; see worker/link.js.
    if (request.headers.get('Upgrade') !== 'websocket') throw new HttpError(426, 'expected a WebSocket');
    const cable = Math.min(LINK_CABLES, Math.max(1, Number(url.searchParams.get('cable')) || 1));
    const headers = new Headers(request.headers);
    let name = displayName(email);
    if (env.DEV_PLAYER_EMAIL && url.searchParams.get('name')) name = url.searchParams.get('name').slice(0, 20);
    headers.set('X-Player-Name', name);
    const stub = env.LINK.get(env.LINK.idFromName(`cable-${cable}`));
    return stub.fetch(new Request(request, { headers }));
  }

  if (url.pathname === '/api/save') {
    if (request.method === 'GET') return getSave(env, email);
    if (request.method === 'PUT') return putSave(request, env, email);
    throw new HttpError(405, 'method not allowed');
  }

  throw new HttpError(404, 'not found');
}

async function getSave(env, email) {
  const row = await env.DB.prepare('SELECT data, saved_at FROM saves WHERE email = ?').bind(email).first();
  if (!row) return json({ error: 'no save yet' }, 404);
  return new Response(new Uint8Array(row.data), {
    headers: {
      'Content-Type': 'application/octet-stream',
      'X-Saved-At': String(row.saved_at),
      'Cache-Control': 'no-store',
    },
  });
}

async function putSave(request, env, email) {
  const data = new Uint8Array(await request.arrayBuffer());
  if (data.length !== FLASH_SIZE) throw new HttpError(400, `save must be ${FLASH_SIZE} bytes`);

  const savedAt = Number(request.headers.get('X-Saved-At')) || Date.now();
  const now = Date.now();
  const current = await env.DB.prepare('SELECT saved_at FROM saves WHERE email = ?').bind(email).first();
  if (current && current.saved_at > savedAt) {
    // A newer save from another phone is already here; tell the page.
    return json({ ok: false, reason: 'server has a newer save', savedAt: current.saved_at }, 409);
  }

  await env.DB.batch([
    // Keep older copies, so a bad save can be rolled back by hand.
    env.DB.prepare('INSERT INTO save_history (email, data, saved_at) SELECT email, data, saved_at FROM saves WHERE email = ?').bind(email),
    env.DB.prepare(
      'INSERT INTO saves (email, data, saved_at, updated_at) VALUES (?, ?, ?, ?) '
      + 'ON CONFLICT(email) DO UPDATE SET data = excluded.data, saved_at = excluded.saved_at, updated_at = excluded.updated_at',
    ).bind(email, data, savedAt, now),
    env.DB.prepare(
      'DELETE FROM save_history WHERE email = ? AND id NOT IN (SELECT id FROM save_history WHERE email = ? ORDER BY id DESC LIMIT ?)',
    ).bind(email, email, HISTORY_KEEP),
  ]);

  return json({ ok: true, savedAt });
}

// ---- Identity -------------------------------------------------------------

async function playerEmail(request, env) {
  if (env.DEV_PLAYER_EMAIL) return env.DEV_PLAYER_EMAIL; // local testing only (.dev.vars)

  const token = request.headers.get('Cf-Access-Jwt-Assertion');
  if (!token) throw new HttpError(401, 'not signed in through Cloudflare Access');
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) throw new HttpError(500, 'Access is not configured on the server');

  const claims = await verifyAccessJwt(token, env.ACCESS_TEAM_DOMAIN, env.ACCESS_AUD);
  if (!claims.email) throw new HttpError(401, 'sign-in has no email');
  return String(claims.email).toLowerCase();
}

let cachedKeys = null;
let cachedKeysAt = 0;

async function accessKeys(teamDomain) {
  if (cachedKeys && Date.now() - cachedKeysAt < 60 * 60 * 1000) return cachedKeys;
  const res = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!res.ok) throw new HttpError(500, 'could not load Access signing keys');
  const { keys } = await res.json();
  cachedKeys = keys;
  cachedKeysAt = Date.now();
  return keys;
}

async function verifyAccessJwt(token, teamDomain, aud) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new HttpError(401, 'bad sign-in token');
  const [headerB64, payloadB64, sigB64] = parts;
  const header = JSON.parse(textFromB64url(headerB64));
  const payload = JSON.parse(textFromB64url(payloadB64));

  if (header.alg !== 'RS256') throw new HttpError(401, 'bad sign-in token');
  const jwk = (await accessKeys(teamDomain)).find((key) => key.kid === header.kid);
  if (!jwk) throw new HttpError(401, 'unknown sign-in key');

  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5', key, bytesFromB64url(sigB64), new TextEncoder().encode(`${headerB64}.${payloadB64}`),
  );
  if (!ok) throw new HttpError(401, 'bad sign-in signature');

  const now = Math.floor(Date.now() / 1000);
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audiences.includes(aud)) throw new HttpError(401, 'sign-in is for a different site');
  if (payload.iss !== `https://${teamDomain}`) throw new HttpError(401, 'sign-in from an unknown issuer');
  if (typeof payload.exp !== 'number' || payload.exp < now) throw new HttpError(401, 'sign-in expired');
  return payload;
}

// ---- Helpers --------------------------------------------------------------

// "dad.ward@example.com" -> "Dad"
function displayName(email) {
  const first = email.split('@')[0].split(/[._+-]/)[0] || 'Player';
  return (first[0].toUpperCase() + first.slice(1)).slice(0, 12);
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

function bytesFromB64url(value) {
  const b64 = value.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((value.length + 3) % 4);
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

function textFromB64url(value) {
  return new TextDecoder().decode(bytesFromB64url(value));
}
