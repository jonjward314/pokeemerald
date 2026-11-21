// Cloudflare Worker: serves the game files and keeps each player's save in a
// D1 database, so a cleared browser or a new phone picks up the same game.
//
// Who is playing comes from Cloudflare Access, which sits in front of the
// whole site. Access signs a token (Cf-Access-Jwt-Assertion) for every request
// it lets through; this Worker checks that signature before trusting the
// email inside it.

const FLASH_SIZE = 128 * 1024;
const HISTORY_KEEP = 20;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/admin' || url.pathname.startsWith('/admin/')) {
      // The page itself holds nothing secret, but only the admin needs it.
      try {
        if (!(await isAdmin(await playerEmail(request, env), env))) {
          return new Response('This page is for the game admin only.', { status: 403 });
        }
      } catch (error) {
        if (error instanceof HttpError) return new Response(error.message, { status: error.status });
        throw error;
      }
      return env.ASSETS.fetch(request);
    }
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
    return json({ email, admin: await isAdmin(email, env), picker: await isPicker(env, email) });
  }

  if (url.pathname === '/api/rules' && request.method === 'GET') {
    return json(await rulesFor(env, email));
  }

  if (url.pathname.startsWith('/api/admin/')) {
    if (!(await isAdmin(email, env))) throw new HttpError(403, 'admin only');
    return handleAdmin(request, env, url);
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

// ---- Game rules ------------------------------------------------------------
// House rules the game reads at start-up and every few minutes (web/app.js
// writes them into gWasmRules, see src/wasm_rules.c). One row holds the rules
// for everyone ('*'); a row per player can override any of them.

const RULE_DEFAULTS = {
  expPercent: 100, // EXP from battles
  moneyPercent: 100, // prize money from trainers
  encounterPercent: 100, // how often wild Pokemon appear in grass, caves and water
  clockMode: 'real', // 'real' | 'shift' | 'lock'
  clockShiftHours: 0, // clockMode 'shift': hours added to the real time
  clockLockHour: 12, // clockMode 'lock': the hour the game always shows
  dayNight: true, // darken outdoor maps in the evening and at night
};

function cleanRules(input) {
  const out = {};
  if (!input || typeof input !== 'object') return out;
  const int = (value, min, max) => Math.min(max, Math.max(min, Math.round(Number(value))));
  if (Number.isFinite(Number(input.expPercent))) out.expPercent = int(input.expPercent, 0, 1000);
  if (Number.isFinite(Number(input.moneyPercent))) out.moneyPercent = int(input.moneyPercent, 0, 1000);
  if (Number.isFinite(Number(input.encounterPercent))) out.encounterPercent = int(input.encounterPercent, 0, 400);
  if (['real', 'shift', 'lock'].includes(input.clockMode)) out.clockMode = input.clockMode;
  if (Number.isFinite(Number(input.clockShiftHours))) out.clockShiftHours = int(input.clockShiftHours, -23, 23);
  if (Number.isFinite(Number(input.clockLockHour))) out.clockLockHour = int(input.clockLockHour, 0, 23);
  if (typeof input.dayNight === 'boolean') out.dayNight = input.dayNight;
  return out;
}

let rulesTableReady = false;

async function ensureRulesTable(env) {
  if (rulesTableReady) return;
  await env.DB.prepare(
    'CREATE TABLE IF NOT EXISTS rules (email TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at INTEGER NOT NULL)',
  ).run();
  rulesTableReady = true;
}

async function rulesRows(env) {
  await ensureRulesTable(env);
  const { results } = await env.DB.prepare('SELECT email, data, updated_at FROM rules').all();
  return results.map((row) => ({ email: row.email, rules: cleanRules(safeJson(row.data)), updatedAt: row.updated_at }));
}

async function rulesFor(env, email) {
  const rows = await rulesRows(env);
  const everyone = rows.find((row) => row.email === '*')?.rules || {};
  const mine = rows.find((row) => row.email === email)?.rules || {};
  return { ...RULE_DEFAULTS, ...everyone, ...mine };
}

async function handleAdmin(request, env, url) {
  if (url.pathname === '/api/admin/pickers') {
    await ensurePickersTable(env);
    if (request.method === 'GET') {
      const { results } = await env.DB.prepare('SELECT email, added_at FROM pickers ORDER BY email').all();
      return json({ pickers: results.map((row) => ({ email: row.email, addedAt: row.added_at })) });
    }
    if (request.method === 'PUT' || request.method === 'DELETE') {
      const body = await request.json().catch(() => null);
      const email = String(body?.email || '').trim().toLowerCase();
      if (!email.includes('@')) throw new HttpError(400, 'email must be an address');
      if (request.method === 'PUT') {
        await env.DB.prepare('INSERT OR IGNORE INTO pickers (email, added_at) VALUES (?, ?)').bind(email, Date.now()).run();
      } else {
        await env.DB.prepare('DELETE FROM pickers WHERE email = ?').bind(email).run();
      }
      return json({ ok: true });
    }
    throw new HttpError(405, 'method not allowed');
  }
  if (url.pathname === '/api/admin/rules') {
    if (request.method === 'GET') {
      const rows = await rulesRows(env);
      const { results } = await env.DB.prepare('SELECT email, saved_at FROM saves ORDER BY email').all();
      return json({
        defaults: RULE_DEFAULTS,
        rows,
        players: results.map((row) => ({ email: row.email, savedAt: row.saved_at })),
      });
    }
    if (request.method === 'PUT') {
      const body = await request.json().catch(() => null);
      const email = String(body?.email || '').trim().toLowerCase();
      if (!email || (email !== '*' && !email.includes('@'))) throw new HttpError(400, 'email must be * or an address');
      await ensureRulesTable(env);
      if (body.rules === null) {
        await env.DB.prepare('DELETE FROM rules WHERE email = ?').bind(email).run();
        return json({ ok: true });
      }
      const rules = cleanRules(body.rules);
      await env.DB.prepare(
        'INSERT INTO rules (email, data, updated_at) VALUES (?, ?, ?) '
        + 'ON CONFLICT(email) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at',
      ).bind(email, JSON.stringify(rules), Date.now()).run();
      return json({ ok: true, rules });
    }
    throw new HttpError(405, 'method not allowed');
  }
  throw new HttpError(404, 'not found');
}

// ---- Picker logins ---------------------------------------------------------
// A picker email is a shared family login: the game asks who is playing
// instead of treating the login as one player. The admin page manages them.

let pickersTableReady = false;

async function ensurePickersTable(env) {
  if (pickersTableReady) return;
  await env.DB.prepare('CREATE TABLE IF NOT EXISTS pickers (email TEXT PRIMARY KEY, added_at INTEGER NOT NULL)').run();
  pickersTableReady = true;
}

async function isPicker(env, email) {
  await ensurePickersTable(env);
  return Boolean(await env.DB.prepare('SELECT 1 FROM pickers WHERE email = ?').bind(email).first());
}

function safeJson(text) {
  try { return JSON.parse(text); } catch { return {}; }
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

// Admins are listed in wrangler.toml as SHA-256 hashes of their sign-in
// emails (the repository is public, so the addresses themselves stay out).
async function isAdmin(email, env) {
  const hashes = String(env.ADMIN_EMAIL_SHA256 || '').split(',').map((v) => v.trim().toLowerCase()).filter(Boolean);
  if (!hashes.length || !email) return false;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(email));
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return hashes.includes(hex);
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
