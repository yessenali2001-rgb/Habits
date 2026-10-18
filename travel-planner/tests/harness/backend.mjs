/*
 * Supabase-compatible test backend — FOR TESTS AND LOCAL DEMOS ONLY, never for production.
 *
 * It speaks the subset of the Supabase HTTP API that this app uses, on top of a REAL PostgreSQL
 * server that has the project's migrations applied:
 *   /auth/v1/*       GoTrue subset: sign-up, password sign-in, refresh, user, logout, admin create-user
 *   /rest/v1/*       PostgREST subset: select/insert/update/delete/upsert + rpc, with filters, order, limit,
 *                    count and single-object responses
 *   /realtime/v1/*   Realtime subset: Phoenix channels with `postgres_changes` over LISTEN/NOTIFY
 *
 * What is real: every query runs as the `authenticated` / `anon` / `service_role` Postgres role with the
 * caller's JWT claims in `request.jwt.claims`, so the project's row level security, grants, triggers and
 * functions are exercised exactly as on Supabase. What is emulated: the HTTP layer itself, tokens
 * (HS256 signed with a local secret), and realtime delivery. Storage and OAuth are not implemented.
 */
import http from 'node:http';
import crypto from 'node:crypto';
import pg from 'pg';
import { WebSocketServer } from 'ws';

const env = process.env;
export const ANON_KEY = 'harness-anon-key';
export const SERVICE_KEY = 'harness-service-key';
const JWT_SECRET = env.HARNESS_JWT_SECRET || 'harness-jwt-secret-for-local-tests-only';
const PORT = Number(env.HARNESS_PORT || 54321);

const pool = new pg.Pool({
  host: env.PGHOST, port: Number(env.PGPORT || 5432), user: env.PGUSER || 'postgres', database: env.PGDATABASE || 'wanderplan', max: 12,
});

// ------------------------------------------------------------------------------------- helpers
const b64u = (b) => Buffer.from(b).toString('base64url');
const sign = (payload) => {
  const head = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64u(JSON.stringify(payload));
  return `${head}.${body}.${crypto.createHmac('sha256', JWT_SECRET).update(`${head}.${body}`).digest('base64url')}`;
};
function verify(token) {
  const [h, b, s] = String(token).split('.');
  if (!h || !b || !s) return null;
  const want = crypto.createHmac('sha256', JWT_SECRET).update(`${h}.${b}`).digest('base64url');
  if (want.length !== s.length || !crypto.timingSafeEqual(Buffer.from(want), Buffer.from(s))) return null;
  try {
    const p = JSON.parse(Buffer.from(b, 'base64url').toString());
    return p.exp && p.exp < Date.now() / 1000 ? null : p;
  } catch { return null; }
}
const httpErr = (status, message, code = 'PGRST000', extra = {}) => Object.assign(new Error(message), { status, pgrst: code, ...extra });

/** Who is calling? anon key, service key, or a user access token. */
function principal(req) {
  const bearer = (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || req.headers.apikey || '';
  if (bearer === SERVICE_KEY) return { role: 'service_role', claims: { role: 'service_role' } };
  if (!bearer || bearer === ANON_KEY) return { role: 'anon', claims: { role: 'anon' } };
  const claims = verify(bearer);
  if (!claims || !claims.sub) throw httpErr(401, 'JWT expired or invalid', 'PGRST301');
  return { role: 'authenticated', claims };
}

async function withTx(who, fn) {
  const c = await pool.connect();
  try {
    await c.query('begin');
    await c.query(`set local role ${who.role}`);
    await c.query("select set_config('request.jwt.claims', $1, true), set_config('timezone', 'UTC', true)", [JSON.stringify(who.claims)]);
    const out = await fn(c);
    await c.query('commit');
    return out;
  } catch (e) {
    await c.query('rollback').catch(() => undefined);
    throw e;
  } finally { c.release(); }
}

const ident = (s) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw httpErr(400, `invalid identifier "${s}"`);
  return `"${s}"`;
};

function splitTop(s) { // split on commas that are not inside quotes
  const out = []; let cur = ''; let q = false;
  for (const ch of s) { if (ch === '"') q = !q; if (ch === ',' && !q) { out.push(cur); cur = ''; } else cur += ch; }
  out.push(cur);
  return out;
}

const RESERVED = new Set(['select', 'order', 'limit', 'offset', 'on_conflict', 'columns']);
function filtersOf(params, values) {
  const where = [];
  for (const [k, v] of params) {
    if (RESERVED.has(k)) continue;
    const neg = v.startsWith('not.');
    const rest = neg ? v.slice(4) : v;
    const dot = rest.indexOf('.');
    const op = rest.slice(0, dot);
    const val = rest.slice(dot + 1);
    const col = `t.${ident(k)}`;
    const push = (x) => { values.push(x); return `$${values.length}`; };
    let cond;
    switch (op) {
      case 'eq': cond = `${col} = ${push(val)}`; break;
      case 'neq': cond = `${col} <> ${push(val)}`; break;
      case 'gt': cond = `${col} > ${push(val)}`; break;
      case 'gte': cond = `${col} >= ${push(val)}`; break;
      case 'lt': cond = `${col} < ${push(val)}`; break;
      case 'lte': cond = `${col} <= ${push(val)}`; break;
      case 'like': cond = `${col}::text like ${push(val.replace(/\*/g, '%'))}`; break;
      case 'ilike': cond = `${col}::text ilike ${push(val.replace(/\*/g, '%'))}`; break;
      case 'in': cond = `${col} = any(${push(splitTop(val.replace(/^\(|\)$/g, '')).map((x) => x.replace(/^"|"$/g, '')))})`; break;
      case 'is': cond = val === 'null' ? `${col} is null` : `${col} is ${val === 'true' ? 'true' : 'false'}`; break;
      default: throw httpErr(400, `unsupported filter operator "${op}"`);
    }
    where.push(neg ? `not (${cond})` : cond);
  }
  return where.length ? ` where ${where.join(' and ')}` : '';
}

function selectList(params) {
  const sel = params.get('select') || '*';
  if (sel === '*') return 't.*';
  return splitTop(sel).map((c) => { c = c.trim(); if (/[(!:]/.test(c)) throw httpErr(400, `embedded resources are not supported by the harness: ${c}`); return `t.${ident(c)}`; }).join(', ');
}
function orderBy(params) {
  const o = params.get('order');
  if (!o) return '';
  return ' order by ' + o.split(',').map((part) => {
    const [col, ...mods] = part.split('.');
    return `t.${ident(col)} ${mods.includes('desc') ? 'desc' : 'asc'}${mods.includes('nullsfirst') ? ' nulls first' : mods.includes('nullslast') ? ' nulls last' : ''}`;
  }).join(', ');
}

const pkCache = new Map();
async function pkOf(c, table) {
  if (!pkCache.has(table)) {
    const { rows } = await c.query(
      `select a.attname from pg_index i join pg_attribute a on a.attrelid = i.indrelid and a.attnum = any(i.indkey)
       where i.indrelid = ('public.' || quote_ident($1))::regclass and i.indisprimary order by array_position(i.indkey, a.attnum)`, [table]);
    pkCache.set(table, rows.map((r) => r.attname));
  }
  return pkCache.get(table);
}

const STATUS = { '23505': 409, '23503': 409, '23502': 400, '23514': 400, '42501': 403, '42P01': 404, P0001: 400, P0002: 404 };

// -------------------------------------------------------------------------------------- REST
async function rest(req, url, body) {
  const who = principal(req);
  const parts = url.pathname.replace(/^\/rest\/v1\//, '').split('/');
  const prefer = String(req.headers.prefer || '');
  const wantsRows = /return=representation/.test(prefer);
  const single = /vnd\.pgrst\.object\+json/.test(String(req.headers.accept || ''));
  const params = url.searchParams;

  if (parts[0] === 'rpc') {
    const fn = ident(parts[1]);
    return withTx(who, async (c) => {
      const meta = (await c.query(
        `select p.proretset, p.prorettype::regtype::text as rt from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = $1 limit 1`, [parts[1]])).rows[0];
      if (!meta) throw httpErr(404, `function ${parts[1]} not found`, 'PGRST202');
      const args = body && typeof body === 'object' ? Object.entries(body) : [];
      const vals = args.map(([, v]) => (v !== null && typeof v === 'object' ? JSON.stringify(v) : v));
      const call = `public.${fn}(${args.map(([k], i) => `${ident(k)} := $${i + 1}`).join(', ')})`;
      if (meta.proretset || meta.rt === 'record') {
        const r = await c.query(`select coalesce(json_agg(r), '[]'::json) as j from (select * from ${call}) r`, vals);
        return { status: 200, json: r.rows[0].j };
      }
      const r = await c.query(`select to_json(${call}) as j`, vals);
      return { status: 200, json: r.rows[0].j };
    });
  }

  const table = ident(parts[0]);
  const tname = parts[0];
  return withTx(who, async (c) => {
    const values = [];
    const cols = selectList(params);
    const headers = {};

    if (req.method === 'GET' || req.method === 'HEAD') {
      const where = filtersOf(params, values);
      const lim = params.get('limit') ? ` limit ${Number(params.get('limit'))}` : '';
      const off = params.get('offset') ? ` offset ${Number(params.get('offset'))}` : '';
      if (/count=exact/.test(prefer)) {
        const n = (await c.query(`select count(*)::int as n from public.${table} t${where}`, values)).rows[0].n;
        headers['content-range'] = `0-${Math.max(0, n - 1)}/${n}`;
        if (req.method === 'HEAD') return { status: 200, headers };
      }
      const { rows } = await c.query(`select coalesce(json_agg(r), '[]'::json) as j from (select ${cols} from public.${table} t${where}${orderBy(params)}${lim}${off}) r`, values);
      return shape(rows[0].j, single, headers, 200);
    }

    if (req.method === 'POST') {
      const rows = Array.isArray(body) ? body : [body];
      if (!rows.length) return { status: 201, headers };
      const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))];
      const list = keys.map(ident).join(', ');
      values.push(JSON.stringify(rows));
      let conflict = '';
      if (/resolution=(merge|ignore)-duplicates/.test(prefer)) {
        const target = params.get('on_conflict') ? params.get('on_conflict').split(',') : await pkOf(c, tname);
        const t = target.map(ident).join(', ');
        const upd = keys.filter((k) => !target.includes(k)).map((k) => `${ident(k)} = excluded.${ident(k)}`).join(', ');
        conflict = /ignore-duplicates/.test(prefer) || !upd ? ` on conflict (${t}) do nothing` : ` on conflict (${t}) do update set ${upd}`;
      }
      const ret = wantsRows ? ` returning ${cols.replace(/t\./g, `public.${table}.`)}` : '';
      const r = await c.query(`insert into public.${table} (${list}) select ${list} from jsonb_populate_recordset(null::public.${table}, $1::jsonb)${conflict}${ret}`, values);
      return wantsRows ? shape(JSON.stringify(r.rows), single, headers, 201, true) : { status: 201, headers };
    }

    if (req.method === 'PATCH') {
      const keys = Object.keys(body || {});
      if (!keys.length) return { status: 204, headers };
      values.push(JSON.stringify(body));
      const where = filtersOf(params, values);
      const set = keys.map((k) => `${ident(k)} = r.${ident(k)}`).join(', ');
      const r = await c.query(`update public.${table} t set ${set} from jsonb_populate_record(null::public.${table}, $1::jsonb) r${where}${wantsRows ? ` returning ${cols}` : ''}`, values);
      return wantsRows ? shape(JSON.stringify(r.rows), single, headers, 200, true) : { status: 204, headers };
    }

    if (req.method === 'DELETE') {
      const where = filtersOf(params, values);
      const r = await c.query(`delete from public.${table} t${where}${wantsRows ? ` returning ${cols}` : ''}`, values);
      return wantsRows ? shape(JSON.stringify(r.rows), single, headers, 200, true) : { status: 204, headers };
    }
    throw httpErr(405, 'method not allowed');
  });
}

function shape(json, single, headers, status, alreadyString = false) {
  const rows = alreadyString ? JSON.parse(json) : json;
  if (single) {
    if (rows.length !== 1) throw httpErr(406, 'JSON object requested, multiple (or no) rows returned', 'PGRST116', { details: `The result contains ${rows.length} rows` });
    return { status, headers, json: rows[0] };
  }
  return { status, headers, json: rows };
}

// -------------------------------------------------------------------------------------- auth
const hashPw = (pw, salt = crypto.randomBytes(16).toString('hex')) => `${salt}:${crypto.scryptSync(pw, salt, 32).toString('hex')}`;
const checkPw = (pw, stored) => { const [salt] = stored.split(':'); return crypto.timingSafeEqual(Buffer.from(hashPw(pw, salt)), Buffer.from(stored)); };
const refreshTokens = new Map();

const userJson = (u) => ({
  id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, email_confirmed_at: u.created_at, phone: '', confirmed_at: u.created_at,
  last_sign_in_at: new Date().toISOString(), app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: u.raw_user_meta_data ?? {},
  identities: [], created_at: u.created_at, updated_at: u.created_at, is_anonymous: false,
});
function sessionFor(u) {
  const now = Math.floor(Date.now() / 1000);
  const claims = { aud: 'authenticated', exp: now + 3600, iat: now, sub: u.id, email: u.email, role: 'authenticated', session_id: crypto.randomUUID(),
    app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: u.raw_user_meta_data ?? {}, is_anonymous: false };
  const refresh = crypto.randomBytes(12).toString('base64url');
  refreshTokens.set(refresh, u.id);
  return { access_token: sign(claims), token_type: 'bearer', expires_in: 3600, expires_at: now + 3600, refresh_token: refresh, user: userJson(u) };
}
const authErr = (status, error_code, msg) => ({ status, json: { code: status, error_code, msg } });

async function createUser(email, password, meta) {
  const c = await pool.connect();
  try {
    await c.query('begin');
    const dup = await c.query('select 1 from auth.users where lower(email) = lower($1)', [email]);
    if (dup.rowCount) { await c.query('rollback'); return null; }
    const { rows } = await c.query('insert into auth.users (email, raw_user_meta_data) values (lower($1), $2) returning id, email, raw_user_meta_data, created_at', [email, meta ?? {}]);
    await c.query('insert into auth.mock_credentials (user_id, password_hash) values ($1, $2)', [rows[0].id, hashPw(password)]);
    await c.query('commit');
    return rows[0];
  } catch (e) { await c.query('rollback').catch(() => undefined); throw e; } finally { c.release(); }
}

async function auth(req, url, body) {
  const path = url.pathname.replace(/^\/auth\/v1/, '');
  if (path === '/signup' && req.method === 'POST') {
    if (!body.email || !body.password || String(body.password).length < 8) return authErr(422, 'weak_password', 'Password should be at least 8 characters.');
    const u = await createUser(body.email, body.password, body.data);
    if (!u) return authErr(422, 'user_already_exists', 'User already registered');
    return { status: 200, json: sessionFor(u) };
  }
  if (path === '/token' && req.method === 'POST') {
    const grant = url.searchParams.get('grant_type');
    if (grant === 'password') {
      const { rows } = await pool.query('select u.id, u.email, u.raw_user_meta_data, u.created_at, c.password_hash from auth.users u join auth.mock_credentials c on c.user_id = u.id where lower(u.email) = lower($1)', [body.email ?? '']);
      if (!rows[0] || !checkPw(String(body.password ?? ''), rows[0].password_hash)) return authErr(400, 'invalid_credentials', 'Invalid login credentials');
      return { status: 200, json: sessionFor(rows[0]) };
    }
    if (grant === 'refresh_token') {
      const id = refreshTokens.get(body.refresh_token);
      if (!id) return authErr(400, 'refresh_token_not_found', 'Invalid Refresh Token: Refresh Token Not Found');
      refreshTokens.delete(body.refresh_token);
      const { rows } = await pool.query('select id, email, raw_user_meta_data, created_at from auth.users where id = $1', [id]);
      return rows[0] ? { status: 200, json: sessionFor(rows[0]) } : authErr(400, 'user_not_found', 'User not found');
    }
    return authErr(400, 'unsupported_grant_type', 'Unsupported grant type');
  }
  if (path === '/user' && req.method === 'GET') {
    const claims = verify((req.headers.authorization || '').replace(/^Bearer\s+/i, ''));
    if (!claims) return authErr(401, 'bad_jwt', 'invalid JWT');
    const { rows } = await pool.query('select id, email, raw_user_meta_data, created_at from auth.users where id = $1', [claims.sub]);
    return rows[0] ? { status: 200, json: userJson(rows[0]) } : authErr(403, 'user_not_found', 'User from sub claim in JWT does not exist');
  }
  if (path === '/logout') return { status: 204 };
  if (path.startsWith('/admin/users')) {
    if ((req.headers.authorization || '').replace(/^Bearer\s+/i, '') !== SERVICE_KEY) return authErr(401, 'no_authorization', 'service role required');
    if (req.method === 'POST') {
      const u = await createUser(body.email, body.password, body.user_metadata);
      return u ? { status: 200, json: userJson(u) } : authErr(422, 'email_exists', 'A user with this email address has already been registered');
    }
    const id = path.split('/')[3];
    const { rows } = await pool.query('select id, email, raw_user_meta_data, created_at from auth.users where id = $1', [id]);
    return rows[0] ? { status: 200, json: { user: userJson(rows[0]) } } : authErr(404, 'user_not_found', 'User not found');
  }
  return authErr(404, 'not_found', `no such auth endpoint ${path}`);
}

// ------------------------------------------------------------------------------------ server
const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin || '*';
  const cors = {
    'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true', vary: 'Origin',
    'access-control-allow-headers': 'authorization, apikey, content-type, prefer, accept, accept-profile, content-profile, x-client-info, x-supabase-api-version, range',
    'access-control-allow-methods': 'GET, POST, PATCH, PUT, DELETE, HEAD, OPTIONS', 'access-control-expose-headers': 'content-range, content-type',
  };
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = raw ? JSON.parse(raw) : undefined;
    let out;
    if (url.pathname.startsWith('/rest/v1/')) out = await rest(req, url, body);
    else if (url.pathname.startsWith('/auth/v1/')) out = await auth(req, url, body ?? {});
    else if (url.pathname === '/health') out = { status: 200, json: { ok: true } };
    else out = { status: 404, json: { message: 'not implemented by the test harness (storage and OAuth are not emulated)' } };
    res.writeHead(out.status, { ...cors, ...(out.headers ?? {}), ...(out.json !== undefined ? { 'content-type': 'application/json' } : {}) });
    res.end(out.json !== undefined && req.method !== 'HEAD' ? JSON.stringify(out.json) : undefined);
  } catch (e) {
    const status = e.status ?? STATUS[e.code] ?? (e.code === '42501' ? 403 : 400);
    res.writeHead(status, { ...cors, 'content-type': 'application/json' });
    res.end(JSON.stringify({ code: e.pgrst ?? e.code ?? 'PGRST000', message: e.message, details: e.details ?? e.detail ?? null, hint: e.hint ?? null }));
  }
});

// ----------------------------------------------------------------------------------- realtime
const wss = new WebSocketServer({ noServer: true });
const TABLES = ['trips', 'trip_participants', 'destinations', 'itinerary_items', 'comments', 'trip_tasks', 'expenses', 'expense_shares', 'participant_details', 'activity_log', 'notifications'];
let bindingSeq = 1000;
const sockets = new Set();

server.on('upgrade', (req, socket, head) => {
  if (!req.url.startsWith('/realtime/v1/websocket')) return socket.destroy();
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

wss.on('connection', (ws) => {
  const state = { ws, topics: new Map() };
  sockets.add(state);
  ws.on('close', () => sockets.delete(state));
  ws.on('message', (data) => {
    let msg;
    try { msg = JSON.parse(String(data)); } catch { return; }
    const [joinRef, ref, topic, event, payload] = msg;
    const reply = (status, response = {}) => ws.send(JSON.stringify([joinRef, ref, topic, 'phx_reply', { status, response }]));
    if (event === 'heartbeat') return ws.send(JSON.stringify([null, ref, 'phoenix', 'phx_reply', { status: 'ok', response: {} }]));
    if (event === 'phx_join') {
      const tok = payload?.access_token;
      const claims = tok ? verify(tok) : null;
      const bindings = (payload?.config?.postgres_changes ?? []).map((b) => ({ ...b, id: ++bindingSeq }));
      state.topics.set(topic, { joinRef, bindings, claims });
      return reply('ok', { postgres_changes: bindings });
    }
    if (event === 'access_token') { const t = state.topics.get(topic); if (t) t.claims = verify(payload?.access_token) ?? t.claims; return; }
    if (event === 'phx_leave') { state.topics.delete(topic); return reply('ok'); }
  });
});

const matchesFilter = (filter, row) => {
  if (!filter) return true;
  const m = /^([a-z_]+)=eq\.(.*)$/.exec(filter);
  return m ? String(row?.[m[1]]) === m[2] : true;
};

async function dispatch(n) {
  const { t: table, op, keys, old } = n;
  let record = null;
  if (op !== 'DELETE') {
    const cols = Object.keys(keys);
    const { rows } = await pool.query(`select to_jsonb(t) as r from public.${ident(table)} t where ${cols.map((k, i) => `t.${ident(k)}::text = $${i + 1}`).join(' and ')}`, cols.map((k) => String(keys[k]))).catch(() => ({ rows: [] }));
    record = rows[0]?.r ?? null;
    if (!record) return;
  }
  for (const s of sockets) {
    for (const [topic, sub] of s.topics) {
      const hit = sub.bindings.filter((b) => b.table === table && (b.event === '*' || b.event === op) && matchesFilter(b.filter, op === 'DELETE' ? old : record));
      if (!hit.length) continue;
      if (op !== 'DELETE') {
        // Realtime only delivers rows the subscriber may read: re-check with their own role + claims
        const who = sub.claims?.sub ? { role: 'authenticated', claims: sub.claims } : { role: 'anon', claims: { role: 'anon' } };
        const cols = Object.keys(keys);
        const visible = await withTx(who, (c) => c.query(`select 1 from public.${ident(table)} t where ${cols.map((k, i) => `t.${ident(k)}::text = $${i + 1}`).join(' and ')}`, cols.map((k) => String(keys[k]))))
          .then((r) => r.rowCount > 0).catch(() => false);
        if (!visible) continue;
      }
      s.ws.send(JSON.stringify([null, null, topic, 'postgres_changes', {
        ids: hit.map((b) => b.id),
        data: { schema: 'public', table, commit_timestamp: new Date().toISOString(), type: op, columns: [], record: op === 'DELETE' ? {} : record, old_record: op === 'DELETE' ? old : {}, errors: null },
      }]));
    }
  }
}

async function startRealtime() {
  const admin = await pool.connect();
  await admin.query('create schema if not exists harness');
  await admin.query(`create or replace function harness.notify() returns trigger language plpgsql as $f$
    declare r jsonb := to_jsonb(case when tg_op = 'DELETE' then old else new end); k jsonb := '{}'::jsonb; e record;
    begin
      for e in select key, value from jsonb_each(r) loop
        if e.key in ('id', 'trip_id', 'user_id', 'expense_id') then k := k || jsonb_build_object(e.key, e.value); end if;
      end loop;
      perform pg_notify('harness_rt', jsonb_build_object('t', tg_table_name, 'op', tg_op, 'keys', k, 'old', case when tg_op = 'DELETE' then k else null end)::text);
      return null;
    end $f$`);
  for (const t of TABLES) {
    // the primary key columns identify the row (e.g. trip_id + user_id), so keep only those for the lookup
    await admin.query(`drop trigger if exists zz_harness_rt on public.${t}`);
    await admin.query(`create trigger zz_harness_rt after insert or update or delete on public.${t} for each row execute function harness.notify()`);
  }
  admin.release();
  const listener = new pg.Client({ host: env.PGHOST, port: Number(env.PGPORT || 5432), user: env.PGUSER || 'postgres', database: env.PGDATABASE || 'wanderplan' });
  await listener.connect();
  await listener.query('listen harness_rt');
  listener.on('notification', (m) => { try { void dispatch(JSON.parse(m.payload)); } catch { /* ignore */ } });
}

// -------------------------------------------------------------------------------------- boot
async function boot() {
  await pool.query('create table if not exists auth.mock_credentials (user_id uuid primary key references auth.users(id) on delete cascade, password_hash text not null)');
  await startRealtime();
  server.listen(PORT, '127.0.0.1', () => console.log(`harness backend listening on http://127.0.0.1:${PORT}`));
}
boot().catch((e) => { console.error(e); process.exit(1); });
