import { Hono, type Context } from 'hono';
import {
  type AppEnv,
  type SessionUser,
  currentUser,
  endSession,
  hashPassword,
  randomToken,
  requireRole,
  requireSignedIn,
  startSession,
  verifyPassword,
} from './auth';
import {
  DEFAULT_FACILITY_AREAS,
  centreKey,
  distanceMetres,
  compareChassis,
  facilityProblem,
  idKey,
  isShortMapsLink,
  meterCheck,
  parseCoords,
  type PhotoKind,
  type Role,
  type TractorStatus,
} from '../shared/domain';
import { notify, pushEnabled, testPush, usersWithRole } from './notify';
import { DEFAULT_REACH_BY, dayName, dmy, fmtTime, istParts, lateLines, runSchedule } from './schedule';

type C = Context<AppEnv>;
type Visit = {
  id: number;
  centre_id: number;
  auditor_id: number | null;
  status: string;
  audit_date: string;
  auditor_signature_key: string | null;
  manager_signature_key: string | null;
  checkin_selfie_key: string | null;
  checkin_at: string | null;
  count_done_at: string | null;
  missing_explanation: string | null;
};

const app = new Hono<AppEnv>().basePath('/api');

const now = () => new Date().toISOString();
const bad = (c: C, msg: string, code: 400 | 403 | 404 | 409 = 400) => c.json({ error: msg }, code);
const str = (v: unknown, max = 500) => (v === null || v === undefined ? null : String(v).trim().slice(0, max) || null);
const num = (v: unknown) => {
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
};

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: 'Something went wrong on the server. Please try again.' }, 500);
});

/** Load a visit and check the signed-in user may read it (or edit it, for auditors). */
async function visitFor(c: C, id: number, mode: 'read' | 'edit'): Promise<Visit | Response> {
  const user = c.get('user');
  const v = await c.env.DB.prepare('SELECT * FROM visits WHERE id = ?').bind(id).first<Visit>();
  if (!v) return bad(c, 'Visit not found.', 404);
  if (user.role === 'planner') return bad(c, 'Visit not found.', 404);
  if (user.role === 'client') {
    if (v.status !== 'approved' || mode === 'edit') return bad(c, 'Visit not found.', 404);
  } else if (user.role === 'auditor') {
    if (v.auditor_id !== user.id) return bad(c, 'This visit is not assigned to you.', 403);
    if (mode === 'edit' && v.status !== 'in_progress')
      return bad(c, v.status === 'assigned' || v.status === 'returned' ? 'Check in first.' : 'This audit has already been submitted.', 409);
  }
  return v;
}

// ---------------------------------------------------------------- setup & auth

app.get('/setup', async (c) => {
  const row = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM users').first<{ n: number }>();
  return c.json({ needed: !row || row.n === 0 });
});

app.post('/setup', async (c) => {
  const row = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM users').first<{ n: number }>();
  if (row && row.n > 0) return bad(c, 'Setup has already been completed.', 409);
  const body = await c.req.json<{ username: string; name: string; password: string }>();
  const username = str(body.username, 50)?.toLowerCase();
  const name = str(body.name, 100);
  if (!username || !name || !body.password || body.password.length < 8)
    return bad(c, 'Enter a username, your name and a password of at least 8 characters.');
  const { hash, salt } = await hashPassword(body.password);
  const res = await c.env.DB.prepare(
    "INSERT INTO users (username, name, role, password_hash, password_salt) VALUES (?, ?, 'admin', ?, ?)",
  )
    .bind(username, name, hash, salt)
    .run();
  await startSession(c, res.meta.last_row_id as number, 'admin');
  return c.json({ ok: true });
});

app.post('/login', async (c) => {
  const body = await c.req.json<{ username: string; password: string }>();
  const u = await c.env.DB.prepare('SELECT * FROM users WHERE username = ? AND active = 1')
    .bind(String(body.username ?? '').trim().toLowerCase())
    .first<{ id: number; password_hash: string; password_salt: string; role: Role }>();
  if (!u || !(await verifyPassword(String(body.password ?? ''), u.password_hash, u.password_salt)))
    return c.json({ error: 'Wrong username or password.' }, 401);
  await c.env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now()).run();
  await startSession(c, u.id, u.role);
  return c.json({ ok: true });
});

app.post('/logout', async (c) => {
  // stop phone alerts for this device
  const b = await c.req.json<{ device_token?: string }>().catch(() => ({}) as { device_token?: string });
  if (b.device_token) await c.env.DB.prepare('DELETE FROM device_tokens WHERE token = ?').bind(String(b.device_token)).run();
  await endSession(c);
  return c.json({ ok: true });
});

// ---------------------------------------------------------------- notifications

app.get('/notifications', requireRole(), async (c) => {
  const id = c.get('user').id;
  const [list, unread] = await c.env.DB.batch([
    c.env.DB.prepare('SELECT id, kind, title, body, link, created_at, read_at FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 60').bind(id),
    c.env.DB.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL').bind(id),
  ]);
  return c.json({ items: list.results, unread: (unread.results[0] as { n: number }).n });
});

app.get('/notifications/unread', requireRole(), async (c) => {
  const r = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL').bind(c.get('user').id).first<{ n: number }>();
  return c.json({ unread: r?.n ?? 0 });
});

app.post('/notifications/read', requireRole(), async (c) => {
  await c.env.DB.prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL').bind(now(), c.get('user').id).run();
  return c.json({ ok: true });
});

/** Local testing only (wrangler dev --var TEST_MODE:1): run the 15-minute job as if it were a given time. */
app.post('/test/schedule', requireRole('admin'), async (c) => {
  if (!c.env.TEST_MODE) return bad(c, 'Not found.', 404);
  const at = c.req.query('at');
  await runSchedule(c.env, at ? new Date(at) : new Date());
  return c.json({ ok: true });
});

app.get('/push-config', requireRole(), (c) => c.json({ enabled: pushEnabled(c.env) }));

app.post('/push-test', requireRole('admin'), async (c) => c.json(await testPush(c.env, c.get('user').id)));

/** The Android app registers its Firebase token so this user gets phone alerts. */
app.post('/me/devices', requireRole(), async (c) => {
  const b = await c.req.json<{ token?: string; platform?: string }>();
  const token = str(b.token, 400);
  if (!token) return bad(c, 'No device token.');
  await c.env.DB.prepare(
    'INSERT INTO device_tokens (token, user_id, platform, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(token) DO UPDATE SET user_id = excluded.user_id, updated_at = excluded.updated_at',
  )
    .bind(token, c.get('user').id, str(b.platform, 20), now())
    .run();
  return c.json({ ok: true });
});

app.get('/me', async (c) => {
  const user = await currentUser(c);
  if (!user) return c.json({ error: 'Not signed in.' }, 401);
  return c.json({
    id: user.id,
    username: user.username,
    name: user.name,
    role: user.role,
    selfie_required: user.role === 'auditor' && !user.selfie_done,
  });
});

/** Auditor's live selfie right after signing in. Unlocks the session for the day. */
app.post('/me/selfie', requireSignedIn, async (c) => {
  const user = c.get('user');
  if (user.role !== 'auditor') return bad(c, 'Only auditors take a sign-in selfie.');
  const img = await readImage(c);
  if (img instanceof Response) return img;
  const at = now();
  const key = `selfies/${user.id}/${at.replace(/[:.]/g, '-')}-${randomToken(4)}.jpg`;
  await c.env.PHOTOS.put(key, await img.file.arrayBuffer(), { httpMetadata: { contentType: img.file.type } });
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO login_selfies (user_id, r2_key, lat, lng, at) VALUES (?, ?, ?, ?, ?)').bind(
      user.id,
      key,
      num(img.form.get('lat')),
      num(img.form.get('lng')),
      at,
    ),
    c.env.DB.prepare('UPDATE sessions SET selfie_key = ? WHERE token = ?').bind(key, user.token),
  ]);
  return c.json({ ok: true });
});

app.get('/users/:id/selfies', requireRole('admin'), async (c) => {
  const { results } = await c.env.DB.prepare('SELECT id, lat, lng, at FROM login_selfies WHERE user_id = ? ORDER BY at DESC LIMIT 60')
    .bind(Number(c.req.param('id')))
    .all();
  return c.json(results);
});

app.get('/selfies/:id', requireRole('admin'), async (c) => {
  const r = await c.env.DB.prepare('SELECT r2_key FROM login_selfies WHERE id = ?').bind(Number(c.req.param('id'))).first<{ r2_key: string }>();
  return serveObject(c, r?.r2_key ?? null);
});

app.post('/me/password', requireRole(), async (c) => {
  const body = await c.req.json<{ current: string; next: string }>();
  const u = await c.env.DB.prepare('SELECT password_hash, password_salt FROM users WHERE id = ?')
    .bind(c.get('user').id)
    .first<{ password_hash: string; password_salt: string }>();
  if (!u || !(await verifyPassword(body.current ?? '', u.password_hash, u.password_salt)))
    return bad(c, 'Your current password is wrong.');
  if (!body.next || body.next.length < 8) return bad(c, 'The new password must be at least 8 characters.');
  const { hash, salt } = await hashPassword(body.next);
  await c.env.DB.prepare('UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?')
    .bind(hash, salt, c.get('user').id)
    .run();
  return c.json({ ok: true });
});

// ---------------------------------------------------------------- settings

app.get('/settings', requireRole(), async (c) => {
  const { results } = await c.env.DB.prepare('SELECT key, value FROM settings').all<{ key: string; value: string }>();
  return c.json(Object.fromEntries(results.map((r) => [r.key, r.value])));
});

app.put('/settings', requireRole('admin'), async (c) => {
  const body = await c.req.json<Record<string, string>>();
  const allowed = ['firm_name', 'client_name'];
  const stmts = Object.entries(body)
    .filter(([k]) => allowed.includes(k))
    .map(([k, v]) =>
      c.env.DB.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').bind(
        k,
        String(v).slice(0, 200),
      ),
    );
  if (stmts.length) await c.env.DB.batch(stmts);
  return c.json({ ok: true });
});

// ---------------------------------------------------------------- users

app.get('/users', requireRole('admin'), async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT id, username, name, phone, CASE WHEN access = 'planner' THEN 'planner' ELSE role END AS role, home_area, id_proof, active, created_at FROM users ORDER BY role, name",
  ).all();
  return c.json(results);
});

app.post('/users', requireRole('admin'), async (c) => {
  const b = await c.req.json<Record<string, string>>();
  const username = str(b.username, 50)?.toLowerCase().replace(/\s+/g, '');
  const name = str(b.name, 100);
  const role = b.role;
  if (!username || !name || !['admin', 'auditor', 'client', 'planner'].includes(role)) return bad(c, 'Username, name and role are required.');
  if (!b.password || b.password.length < 8) return bad(c, 'The password must be at least 8 characters.');
  const exists = await c.env.DB.prepare('SELECT 1 FROM users WHERE username = ?').bind(username).first();
  if (exists) return bad(c, `The username "${username}" is already taken.`, 409);
  const { hash, salt } = await hashPassword(b.password);
  const res = await c.env.DB.prepare(
    'INSERT INTO users (username, name, phone, role, access, home_area, id_proof, password_hash, password_salt) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  )
    // a planner is stored as a restricted auditor account flagged 'planner'
    .bind(username, name, str(b.phone, 20), role === 'planner' ? 'auditor' : role, role === 'planner' ? 'planner' : null, str(b.home_area, 100), str(b.id_proof, 60), hash, salt)
    .run();
  return c.json({ id: res.meta.last_row_id });
});

app.patch('/users/:id', requireRole('admin'), async (c) => {
  const id = Number(c.req.param('id'));
  const b = await c.req.json<Record<string, unknown>>();
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const k of ['name', 'phone', 'home_area', 'id_proof'] as const)
    if (k in b) {
      sets.push(`${k} = ?`);
      vals.push(str(b[k], 100));
    }
  if ('role' in b && ['admin', 'auditor', 'client', 'planner'].includes(String(b.role))) {
    sets.push('role = ?', 'access = ?');
    vals.push(b.role === 'planner' ? 'auditor' : b.role, b.role === 'planner' ? 'planner' : null);
  }
  if ('active' in b) {
    if (id === c.get('user').id && !b.active) return bad(c, 'You cannot deactivate your own account.');
    sets.push('active = ?');
    vals.push(b.active ? 1 : 0);
  }
  if (typeof b.password === 'string' && b.password) {
    if (b.password.length < 8) return bad(c, 'The password must be at least 8 characters.');
    const { hash, salt } = await hashPassword(b.password);
    sets.push('password_hash = ?', 'password_salt = ?');
    vals.push(hash, salt);
  }
  if (!sets.length) return c.json({ ok: true });
  const stmts = [c.env.DB.prepare(`UPDATE users SET ${sets.join(', ')} WHERE id = ?`).bind(...vals, id)];
  // Deactivating or resetting a password signs the person out everywhere.
  if ('active' in b || 'password' in b) stmts.push(c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id));
  await c.env.DB.batch(stmts);
  return c.json({ ok: true });
});

// ---------------------------------------------------------------- centres

app.get('/centres', requireRole('admin'), async (c) => {
  const [{ results: centres }, { results: aliases }] = await c.env.DB.batch([
    c.env.DB.prepare(
      `SELECT ce.*, (SELECT MAX(audit_date) FROM visits v WHERE v.centre_id = ce.id AND v.status = 'approved') AS last_audit
       FROM centres ce ORDER BY state, name`,
    ),
    c.env.DB.prepare('SELECT alias, centre_id FROM centre_aliases ORDER BY alias'),
  ]);
  return c.json({ centres, aliases });
});

app.post('/centres', requireRole('admin'), async (c) => {
  const b = await c.req.json<Record<string, unknown>>();
  const state = str(b.state, 10)?.toUpperCase();
  const name = str(b.name, 100);
  if (!state || !name) return bad(c, 'State and centre name are required.');
  const dup = await c.env.DB.prepare('SELECT id FROM centres WHERE state = ? AND lower(name) = lower(?)').bind(state, name).first();
  if (dup) return bad(c, `${name} already exists in ${state}.`, 409);
  const res = await c.env.DB.prepare('INSERT INTO centres (state, name, address, lat, lng, radius_m) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(state, name, str(b.address), num(b.lat), num(b.lng), num(b.radius_m) ?? 300)
    .run();
  return c.json({ id: res.meta.last_row_id });
});

app.patch('/centres/:id', requireRole('admin'), async (c) => {
  const id = Number(c.req.param('id'));
  const b = await c.req.json<Record<string, unknown>>();
  const sets: string[] = [];
  const vals: unknown[] = [];
  if ('state' in b) (sets.push('state = ?'), vals.push(str(b.state, 10)?.toUpperCase()));
  if ('name' in b) (sets.push('name = ?'), vals.push(str(b.name, 100)));
  if ('address' in b) (sets.push('address = ?'), vals.push(str(b.address)));
  if ('lat' in b) (sets.push('lat = ?'), vals.push(num(b.lat)));
  if ('lng' in b) (sets.push('lng = ?'), vals.push(num(b.lng)));
  if ('radius_m' in b) (sets.push('radius_m = ?'), vals.push(num(b.radius_m) ?? 300));
  if ('active' in b) (sets.push('active = ?'), vals.push(b.active ? 1 : 0));
  for (const k of ['manager_name', 'manager_phone', 'opening_hours', 'weekly_off'] as const)
    if (k in b) (sets.push(`${k} = ?`), vals.push(str(b[k], 200)));
  if (sets.length) await c.env.DB.prepare(`UPDATE centres SET ${sets.join(', ')} WHERE id = ?`).bind(...vals, id).run();
  return c.json({ ok: true });
});

/** Expand a short Google Maps link (maps.app.goo.gl/…) by following its redirects, then read the coordinates. */
async function coordsFromText(text: string): Promise<{ lat: number; lng: number } | null> {
  const direct = parseCoords(text);
  if (direct || !isShortMapsLink(text)) return direct;
  let url = text.trim();
  for (let i = 0; i < 6; i++) {
    const res = await fetch(url, { redirect: 'manual', headers: { 'User-Agent': 'Mozilla/5.0' } }).catch(() => null);
    const next = res?.headers.get('location');
    if (!next) break;
    url = new URL(next, url).toString();
    const found = parseCoords(url);
    if (found) return found;
  }
  return null;
}

type ImportRow = {
  centre_id: number | null;
  state: string;
  name: string;
  address?: string;
  maps?: string;
  manager_name?: string;
  manager_phone?: string;
  opening_hours?: string;
  weekly_off?: string;
};

/** Bulk update (or add) centres from the filled-in centre details template. */
app.post('/centres/import', requireRole('admin'), async (c) => {
  const { rows } = await c.req.json<{ rows: ImportRow[] }>();
  if (!Array.isArray(rows) || !rows.length) return bad(c, 'No rows to import.');
  const results: { name: string; ok: boolean; action: string; location: string }[] = [];
  for (const r of rows.slice(0, 500)) {
    const name = str(r.name, 100);
    const state = str(r.state, 10)?.toUpperCase();
    if (!name || !state) continue;
    const coords = r.maps ? await coordsFromText(r.maps) : null;
    const location = coords ? 'saved' : r.maps ? 'could not read the link' : 'not given';
    const fields: Record<string, unknown> = {
      address: str(r.address),
      manager_name: str(r.manager_name, 100),
      manager_phone: str(r.manager_phone, 30),
      opening_hours: str(r.opening_hours, 100),
      weekly_off: str(r.weekly_off, 50),
      ...(coords ? { lat: coords.lat, lng: coords.lng } : {}),
    };
    // Empty cells never wipe out what is already saved.
    const set = Object.entries(fields).filter(([, v]) => v !== null && v !== undefined);
    if (r.centre_id) {
      if (set.length)
        await c.env.DB.prepare(`UPDATE centres SET ${set.map(([k]) => `${k} = ?`).join(', ')} WHERE id = ?`)
          .bind(...set.map(([, v]) => v), r.centre_id)
          .run();
      results.push({ name, ok: true, action: 'updated', location });
    } else {
      const dup = await c.env.DB.prepare('SELECT id FROM centres WHERE state = ? AND lower(name) = lower(?)').bind(state, name).first();
      if (dup) {
        results.push({ name, ok: false, action: 'already exists', location });
        continue;
      }
      const cols = ['state', 'name', ...set.map(([k]) => k)];
      await c.env.DB.prepare(`INSERT INTO centres (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`)
        .bind(state, name, ...set.map(([, v]) => v))
        .run();
      results.push({ name, ok: true, action: 'added', location });
    }
  }
  return c.json({ results });
});

app.post('/centres/:id/aliases', requireRole('admin'), async (c) => {
  const { alias } = await c.req.json<{ alias: string }>();
  const key = centreKey(alias ?? '');
  if (!key) return bad(c, 'Enter the other name.');
  await c.env.DB.prepare(
    'INSERT INTO centre_aliases (alias, centre_id) VALUES (?, ?) ON CONFLICT(alias) DO UPDATE SET centre_id = excluded.centre_id',
  )
    .bind(key, Number(c.req.param('id')))
    .run();
  return c.json({ ok: true });
});

app.delete('/aliases/:alias', requireRole('admin'), async (c) => {
  await c.env.DB.prepare('DELETE FROM centre_aliases WHERE alias = ?').bind(c.req.param('alias')).run();
  return c.json({ ok: true });
});

// ---------------------------------------------------------------- stock statement upload

type UploadSheet = {
  sheet_name: string;
  centre_id: number;
  auditor_id: number | null;
  remember_alias?: boolean;
  rows: { reg_no: string; engine_no: string; chassis_no: string }[];
};

app.post('/uploads', requireRole('admin'), async (c) => {
  const b = await c.req.json<{ filename: string; audit_date: string; sheets: UploadSheet[] }>();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(b.audit_date ?? '')) return bad(c, 'Choose the audit date.');
  if (!Array.isArray(b.sheets) || !b.sheets.length) return bad(c, 'The file has no centre sheets to import.');
  const db = c.env.DB;
  const up = await db
    .prepare('INSERT INTO stock_uploads (filename, audit_date, uploaded_by) VALUES (?, ?, ?)')
    .bind(str(b.filename, 200) ?? 'stock.xlsx', b.audit_date, c.get('user').id)
    .run();
  const uploadId = up.meta.last_row_id as number;
  const created: { visit_id: number; centre_id: number; tractors: number }[] = [];
  for (const s of b.sheets) {
    const centre = await db.prepare('SELECT id, name FROM centres WHERE id = ?').bind(s.centre_id).first<{ id: number; name: string }>();
    if (!centre) continue;
    if (s.remember_alias && centreKey(s.sheet_name) !== centreKey(centre.name))
      await db
        .prepare('INSERT INTO centre_aliases (alias, centre_id) VALUES (?, ?) ON CONFLICT(alias) DO UPDATE SET centre_id = excluded.centre_id')
        .bind(centreKey(s.sheet_name), centre.id)
        .run();
    const v = await db
      .prepare('INSERT INTO visits (centre_id, auditor_id, upload_id, audit_date) VALUES (?, ?, ?, ?)')
      .bind(centre.id, s.auditor_id || null, uploadId, b.audit_date)
      .run();
    const visitId = v.meta.last_row_id as number;
    const rows = (s.rows ?? []).filter((r) => idKey(r.reg_no) || idKey(r.chassis_no));
    const stmts = rows.map((r, i) =>
      db
        .prepare("INSERT INTO tractors (visit_id, source, sort_order, reg_no, engine_no, chassis_no) VALUES (?, 'inventory', ?, ?, ?, ?)")
        .bind(visitId, i, str(r.reg_no, 40), str(r.engine_no, 60), str(r.chassis_no, 60)),
    );
    for (let i = 0; i < stmts.length; i += 50) await db.batch(stmts.slice(i, i + 50));
    created.push({ visit_id: visitId, centre_id: centre.id, tractors: rows.length });
  }
  return c.json({ upload_id: uploadId, visits: created });
});

// ---------------------------------------------------------------- visits

app.get('/visits', requireRole('admin', 'auditor', 'client'), async (c) => {
  const user = c.get('user');
  const q = c.req.query();
  const where: string[] = [];
  const vals: unknown[] = [];
  if (user.role === 'auditor') (where.push('v.auditor_id = ?'), vals.push(user.id));
  if (user.role === 'client') where.push("v.status = 'approved'");
  if (q.from) (where.push('v.audit_date >= ?'), vals.push(q.from));
  if (q.to) (where.push('v.audit_date <= ?'), vals.push(q.to));
  if (q.status) {
    const list = q.status.split(',');
    where.push(`v.status IN (${list.map(() => '?').join(',')})`);
    vals.push(...list);
  }
  if (q.centre_id) (where.push('v.centre_id = ?'), vals.push(Number(q.centre_id)));
  if (q.auditor_id && user.role === 'admin') (where.push('v.auditor_id = ?'), vals.push(Number(q.auditor_id)));
  const { results } = await c.env.DB.prepare(
    `SELECT v.id, v.audit_date, v.status, v.outcome, v.outcome_reason, v.checkin_at, v.checkout_at, v.submitted_at, v.checkin_distance_m,
            ce.id AS centre_id, ce.name AS centre_name, ce.state, ce.address, ce.lat, ce.lng,
            u.id AS auditor_id, u.name AS auditor_name,
            (SELECT COUNT(*) FROM tractors t WHERE t.visit_id = v.id AND t.source = 'inventory') AS inventory_count,
            (SELECT COUNT(*) FROM tractors t WHERE t.visit_id = v.id AND t.status = 'pending') AS pending_count,
            (SELECT COUNT(*) FROM tractors t WHERE t.visit_id = v.id AND t.status = 'verified') AS verified_count,
            (SELECT COUNT(*) FROM tractors t WHERE t.visit_id = v.id AND t.status = 'mismatch') AS mismatch_count,
            (SELECT COUNT(*) FROM tractors t WHERE t.visit_id = v.id AND t.status = 'not_found') AS not_found_count,
            (SELECT COUNT(*) FROM tractors t WHERE t.visit_id = v.id AND t.status = 'extra') AS extra_count
     FROM visits v JOIN centres ce ON ce.id = v.centre_id LEFT JOIN users u ON u.id = v.auditor_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY v.audit_date DESC, ce.name LIMIT 1000`,
  )
    .bind(...vals)
    .all<Record<string, unknown>>();
  // The client is not shown when the audit finished (it would show how long it took)
  if (user.role === 'client') for (const r of results) (r.checkout_at = null), (r.submitted_at = null);
  // Blind count: auditors never see how many tractors the stock list has
  if (user.role === 'auditor')
    for (const r of results) for (const k of ['inventory_count', 'pending_count', 'verified_count', 'mismatch_count', 'not_found_count', 'extra_count']) r[k] = null;
  return c.json(results);
});

app.get('/visits/:id', requireRole(), async (c) => {
  const v = await visitFor(c, Number(c.req.param('id')), 'read');
  if (v instanceof Response) return v;
  const db = c.env.DB;
  const role = c.get('user').role;
  const isAdmin = role === 'admin';
  if (v.status === 'in_progress' || v.status === 'returned') await ensureFacility(c, v.id);
  const [visit, tractors, accessories, photos, pings, facility, locs] = await db.batch([
    db.prepare(
      `SELECT v.*, ce.name AS centre_name, ce.state, ce.address, ce.lat, ce.lng, ce.radius_m,
              ce.manager_name AS centre_manager, ce.manager_phone AS centre_manager_phone, ce.opening_hours, ce.weekly_off,
              u.name AS auditor_name, u.phone AS auditor_phone, r.name AS reviewer_name
       FROM visits v JOIN centres ce ON ce.id = v.centre_id
       LEFT JOIN users u ON u.id = v.auditor_id LEFT JOIN users r ON r.id = v.reviewed_by WHERE v.id = ?`,
    ).bind(v.id),
    db.prepare("SELECT * FROM tractors WHERE visit_id = ? ORDER BY source = 'extra', sort_order, id").bind(v.id),
    db.prepare('SELECT * FROM accessories WHERE visit_id = ? ORDER BY id').bind(v.id),
    db.prepare('SELECT id, tractor_id, accessory_id, facility_id, location_id, kind, lat, lng, taken_at FROM photos WHERE visit_id = ? ORDER BY id').bind(v.id),
    db.prepare(isAdmin ? 'SELECT lat, lng, accuracy, at FROM location_pings WHERE visit_id = ? ORDER BY at' : 'SELECT 1 WHERE 0 AND ?').bind(v.id),
    db.prepare('SELECT id, area, sort_order, is_custom, rating, remarks FROM facility_checks WHERE visit_id = ? ORDER BY sort_order, id').bind(v.id),
    db.prepare(
      role === 'client'
        ? 'SELECT id, name, kind, address, distance_m, arrived_at FROM visit_locations WHERE visit_id = ? ORDER BY id'
        : 'SELECT * FROM visit_locations WHERE visit_id = ? ORDER BY id',
    ).bind(v.id),
  ]);
  const row = visit.results[0] as Record<string, unknown>;
  if (c.get('user').role === 'client') {
    // Staff location data is for the audit firm's internal use only.
    for (const k of ['checkin_lat', 'checkin_lng', 'checkin_accuracy', 'checkin_distance_m', 'checkout_lat', 'checkout_lng', 'review_note', 'checkout_at', 'submitted_at'])
      delete row[k];
  }
  return c.json({
    visit: {
      ...row,
      auditor_signature_key: undefined,
      manager_signature_key: undefined,
      checkin_selfie_key: undefined,
      has_auditor_signature: !!v.auditor_signature_key,
      has_manager_signature: !!v.manager_signature_key,
      // The check-in selfie is an internal control: never shown to the client
      has_checkin_selfie: c.get('user').role !== 'client' && !!v.checkin_selfie_key,
      // Blind count: the auditor only learns how many were not shown, after finishing the count
      pending_at_count: role === 'auditor' ? undefined : row.pending_at_count,
      office_remarks: role === 'auditor' ? undefined : row.office_remarks,
      same_day_open: auditDayOpen(v),
    },
    tractors: role === 'auditor' ? auditorView(tractors.results as TractorRow[]) : await withPreviousMeter(c, v, tractors.results as TractorRow[]),
    locations: locs.results,
    accessories: accessories.results,
    photos: photos.results,
    pings: pings.results,
    facility: facility.results,
  });
});

app.patch('/visits/:id', requireRole('admin'), async (c) => {
  const id = Number(c.req.param('id'));
  const b = await c.req.json<{ auditor_id?: number | null; audit_date?: string; office_remarks?: string }>();
  const sets: string[] = [];
  const vals: unknown[] = [];
  if ('auditor_id' in b) (sets.push('auditor_id = ?'), vals.push(b.auditor_id || null));
  if ('office_remarks' in b) (sets.push('office_remarks = ?'), vals.push(str(b.office_remarks, 3000)));
  if (b.audit_date && /^\d{4}-\d{2}-\d{2}$/.test(b.audit_date)) (sets.push('audit_date = ?'), vals.push(b.audit_date));
  if (sets.length) await c.env.DB.prepare(`UPDATE visits SET ${sets.join(', ')} WHERE id = ?`).bind(...vals, id).run();
  return c.json({ ok: true });
});

app.delete('/visits/:id', requireRole('admin'), async (c) => {
  const id = Number(c.req.param('id'));
  const v = await c.env.DB.prepare('SELECT status, auditor_signature_key, manager_signature_key, checkin_selfie_key FROM visits WHERE id = ?')
    .bind(id)
    .first<Visit>();
  if (!v) return bad(c, 'Visit not found.', 404);
  if (v.status === 'approved') return bad(c, 'Approved audits cannot be deleted.', 409);
  const { results } = await c.env.DB.prepare('SELECT r2_key FROM photos WHERE visit_id = ?').bind(id).all<{ r2_key: string }>();
  const keys = [...results.map((r) => r.r2_key), v.auditor_signature_key, v.manager_signature_key, v.checkin_selfie_key].filter(Boolean) as string[];
  for (let i = 0; i < keys.length; i += 1000) await c.env.PHOTOS.delete(keys.slice(i, i + 1000));
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM location_pings WHERE visit_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM photos WHERE visit_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM accessories WHERE visit_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM facility_checks WHERE visit_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM visit_locations WHERE visit_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM tractors WHERE visit_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM visits WHERE id = ?').bind(id),
  ]);
  return c.json({ ok: true });
});

app.post('/visits/:id/checkin', requireRole('auditor'), async (c) => {
  const user = c.get('user');
  const v = await c.env.DB.prepare('SELECT * FROM visits WHERE id = ?').bind(Number(c.req.param('id'))).first<Visit>();
  if (!v || v.auditor_id !== user.id) return bad(c, 'This visit is not assigned to you.', 403);
  if (v.status === 'in_progress') return c.json({ ok: true });
  if (v.status !== 'assigned' && v.status !== 'returned') return bad(c, 'This audit has already been submitted.', 409);
  // Check-in sends a live selfie plus GPS as a form; the selfie is required the first time.
  const form = await c.req.formData();
  const selfie = imageFrom(form);
  if (typeof selfie === 'string' && !v.checkin_selfie_key) return bad(c, 'Take a selfie at the centre to check in.');
  const b = { lat: form.get('lat'), lng: form.get('lng'), accuracy: form.get('accuracy') };
  const lat = num(b.lat);
  const lng = num(b.lng);
  if (lat === null || lng === null) return bad(c, 'Turn on location (GPS) to check in.');
  const other = await c.env.DB.prepare("SELECT ce.name FROM visits v JOIN centres ce ON ce.id = v.centre_id WHERE v.auditor_id = ? AND v.status = 'in_progress' AND v.id != ?")
    .bind(user.id, v.id)
    .first<{ name: string }>();
  if (other) return bad(c, `You are still checked in at ${other.name}. Submit that audit first.`, 409);
  const centre = await c.env.DB.prepare('SELECT name, lat, lng, radius_m FROM centres WHERE id = ?')
    .bind(v.centre_id)
    .first<{ name: string; lat: number | null; lng: number | null; radius_m: number }>();
  let distance: number | null = null;
  const stmts = [];
  if (centre?.lat != null && centre?.lng != null) distance = Math.round(distanceMetres(lat, lng, centre.lat, centre.lng));
  // First visit to a centre with no saved location: remember where the auditor checked in.
  else stmts.push(c.env.DB.prepare('UPDATE centres SET lat = ?, lng = ? WHERE id = ?').bind(lat, lng, v.centre_id));
  const at = now();
  if (typeof selfie !== 'string' && !v.checkin_selfie_key) {
    const key = `visits/${v.id}/checkin-selfie-${randomToken(6)}.jpg`;
    await c.env.PHOTOS.put(key, await selfie.arrayBuffer(), { httpMetadata: { contentType: selfie.type } });
    stmts.push(c.env.DB.prepare('UPDATE visits SET checkin_selfie_key = ? WHERE id = ?').bind(key, v.id));
  }
  await ensureFacility(c, v.id);
  // A returned audit keeps its original check-in so the visit's start time is preserved.
  stmts.push(
    c.env.DB.prepare(
      `UPDATE visits SET status = 'in_progress', outcome = NULL, outcome_reason = NULL,
         checkin_at = COALESCE(checkin_at, ?), checkin_lat = COALESCE(checkin_lat, ?), checkin_lng = COALESCE(checkin_lng, ?),
         checkin_accuracy = COALESCE(checkin_accuracy, ?), checkin_distance_m = COALESCE(checkin_distance_m, ?)
       WHERE id = ?`,
    ).bind(at, lat, lng, num(b.accuracy), distance, v.id),
    c.env.DB.prepare('INSERT INTO location_pings (visit_id, user_id, lat, lng, accuracy, at) VALUES (?, ?, ?, ?, ?, ?)').bind(
      v.id,
      user.id,
      lat,
      lng,
      num(b.accuracy),
      at,
    ),
  );
  await c.env.DB.batch(stmts);
  if (distance !== null && distance > (centre?.radius_m ?? 300) && v.status === 'assigned')
    await notify(
      c.env,
      await usersWithRole(c.env, 'admin'),
      {
        kind: 'far_checkin',
        title: `Check-in far from the centre: ${centre?.name ?? ''}`,
        body: `${user.name} checked in ${distance >= 1000 ? `${(distance / 1000).toFixed(1)} km` : `${distance} m`} from the centre's saved location.`,
        link: `/visits/${v.id}`,
      },
      (p) => c.executionCtx.waitUntil(p),
    );
  return c.json({ ok: true, distance_m: distance });
});

app.post('/visits/:id/pings', requireRole('auditor'), async (c) => {
  const user = c.get('user');
  const v = await c.env.DB.prepare('SELECT auditor_id, status FROM visits WHERE id = ?').bind(Number(c.req.param('id'))).first<Visit>();
  // Tracking only runs between check-in and check-out; quietly ignore late pings.
  if (!v || v.auditor_id !== user.id || v.status !== 'in_progress') return c.json({ ok: true, tracking: false });
  const b = await c.req.json<{ points: { lat: number; lng: number; accuracy?: number; at?: string }[] }>();
  const stmts = (b.points ?? [])
    .slice(0, 200)
    .filter((p) => num(p.lat) !== null && num(p.lng) !== null)
    .map((p) =>
      c.env.DB.prepare('INSERT INTO location_pings (visit_id, user_id, lat, lng, accuracy, at) VALUES (?, ?, ?, ?, ?, ?)').bind(
        Number(c.req.param('id')),
        user.id,
        num(p.lat),
        num(p.lng),
        num(p.accuracy),
        p.at && !isNaN(Date.parse(p.at)) ? new Date(p.at).toISOString() : now(),
      ),
    );
  if (stmts.length) await c.env.DB.batch(stmts);
  return c.json({ ok: true, tracking: true });
});

// ---------------------------------------------------------------- tractors (blind count)
//
// The auditor never sees the stock list. They record every tractor they are shown (chassis, plate, engine,
// meter reading, photos) and the server matches each one to the list in the background:
//   chassis matches a stock row            -> that row is "verified"
//   chassis close to a stock row (typo?)   -> auditor must re-type it once; if repeated, it is an "extra" flagged for the office
//   anything else                          -> "extra" (plate matching a stock row with another chassis is flagged too)
// Stock rows nobody showed become "not found" (short) when the audit is submitted.

type TractorRow = Record<string, unknown> & {
  id: number;
  visit_id: number;
  source: string;
  status: string;
  reg_no: string | null;
  chassis_no: string | null;
  chassis_key: string | null;
  meter_reading: number | null;
  meter_unit: string | null;
};

/** Calendar date in India for an ISO timestamp. */
const istDate = (iso: string) => new Date(Date.parse(iso) + 5.5 * 3600_000).toISOString().slice(0, 10);

/** Tractors can only be recorded on the day the auditor checked in – the audit closes the same day. */
function auditDayOpen(v: Visit) {
  return !v.checkin_at || istDate(v.checkin_at) === istDate(now());
}
const DAY_OVER = 'The audit day is over – tractors can only be recorded on the day of check-in. Submit the audit now; tractors not shown will be reported as short.';

/** What an auditor may see: only the tractors they recorded, never the stock list. */
function auditorView(rows: TractorRow[]) {
  return rows
    .filter((t) => t.status !== 'pending' && t.status !== 'not_found')
    .map((t) => ({
      id: t.id,
      source: 'seen',
      status: 'recorded',
      reg_no: t.verified_reg,
      chassis_no: t.verified_chassis,
      engine_no: t.seen_engine,
      meter_reading: t.meter_reading,
      meter_unit: t.meter_unit,
      location_id: t.location_id,
      seen_at: t.seen_at,
      remarks: t.remarks,
    }));
}

/** Add the last reading recorded for the same chassis in an earlier audit, and flag movement. */
async function withPreviousMeter(c: C, v: Visit, rows: TractorRow[]) {
  const { results } = await c.env.DB.prepare(
    `SELECT t.chassis_key, t.meter_reading, t.meter_unit, vv.audit_date, ce.name AS centre
     FROM tractors t JOIN visits vv ON vv.id = t.visit_id JOIN centres ce ON ce.id = vv.centre_id
     WHERE t.chassis_key IN (SELECT chassis_key FROM tractors WHERE visit_id = ? AND chassis_key IS NOT NULL)
       AND t.visit_id != ? AND t.meter_reading IS NOT NULL AND vv.status IN ('submitted', 'approved')
       AND (vv.audit_date < ? OR (vv.audit_date = ? AND vv.id < ?))
     ORDER BY vv.audit_date DESC, vv.id DESC`,
  )
    .bind(v.id, v.id, v.audit_date, v.audit_date, v.id)
    .all<{ chassis_key: string; meter_reading: number; meter_unit: string | null; audit_date: string; centre: string }>();
  const last = new Map<string, (typeof results)[number]>();
  for (const r of results) if (!last.has(r.chassis_key)) last.set(r.chassis_key, r);
  return rows.map((t) => {
    const p = t.chassis_key ? last.get(t.chassis_key) : undefined;
    if (!p) return t;
    const m = meterCheck(p.meter_reading, p.meter_unit, t.meter_reading, t.meter_unit);
    return { ...t, prev_meter: p.meter_reading, prev_meter_unit: p.meter_unit, prev_date: p.audit_date, prev_centre: p.centre, meter_diff: m.diff, meter_flag: m.flag };
  });
}

async function tractorFor(c: C, id: number) {
  const t = await c.env.DB.prepare('SELECT * FROM tractors WHERE id = ?').bind(id).first<TractorRow>();
  if (!t) return bad(c, 'Tractor not found.', 404);
  const v = await visitFor(c, t.visit_id, 'edit');
  if (v instanceof Response) return v;
  return { t, v };
}

const METER_UNITS = ['km', 'hours'];

const RETYPE_MSG = 'Please check the chassis number on the tractor again (the number punched on the frame, not the engine number) and type it once more.';

/**
 * A typed chassis that probably belongs to a stock tractor but does not match exactly: a look-alike chassis,
 * the engine number typed in the chassis box, or the number plate of a stock tractor. The auditor is asked to
 * re-type it (nothing about the list is revealed); if they type the same again it is kept as an extra, flagged.
 */
function suspectMatch(pending: TractorRow[], chassis: string | null, reg: string | null): { row: TractorRow; reason: 'near_chassis' | 'engine_typed' | 'same_plate' } | null {
  const key = idKey(chassis);
  const near = pending.find((t) => compareChassis(t.chassis_no, chassis) === 'near');
  if (near) return { row: near, reason: 'near_chassis' };
  const eng = pending.find((t) => idKey(t.engine_no) && (idKey(t.engine_no) === key || compareChassis(t.engine_no, chassis) === 'near'));
  if (eng) return { row: eng, reason: 'engine_typed' };
  const plate = reg ? pending.find((t) => idKey(t.reg_no) && idKey(t.reg_no) === idKey(reg)) : undefined;
  if (plate) return { row: plate, reason: 'same_plate' };
  return null;
}

app.post('/visits/:id/seen', requireRole('auditor'), async (c) => {
  const v = await visitFor(c, Number(c.req.param('id')), 'edit');
  if (v instanceof Response) return v;
  if (!auditDayOpen(v)) return bad(c, DAY_OVER, 409);
  const b = await c.req.json<Record<string, unknown>>();
  const reg = str(b.reg_no, 40)?.toUpperCase() ?? null;
  const chassis = str(b.chassis_no, 60)?.toUpperCase() ?? null;
  const engine = str(b.engine_no, 60)?.toUpperCase() ?? null;
  let remarks = str(b.remarks, 500);
  const key = idKey(chassis);
  if (key.length < 5) return bad(c, 'Enter the full chassis number punched on the tractor.');
  // Meter that cannot be read (no battery, faulty…): no reading – the reason goes into the remark
  const unreadable = str(b.meter_unreadable, 120);
  const meter = unreadable ? null : num(b.meter_reading);
  if (!unreadable && (meter === null || meter < 0)) return bad(c, 'Enter the meter reading.');
  const unit = unreadable ? null : METER_UNITS.includes(String(b.meter_unit)) ? String(b.meter_unit) : 'km';
  if (unreadable) remarks = [`Meter not readable – ${unreadable}`, remarks].filter(Boolean).join('; ');
  const locationId = num(b.location_id);
  if (locationId) {
    const l = await c.env.DB.prepare('SELECT 1 FROM visit_locations WHERE id = ? AND visit_id = ?').bind(locationId, v.id).first();
    if (!l) return bad(c, 'Location not found in this visit.');
  }
  const { results: rows } = await c.env.DB.prepare('SELECT * FROM tractors WHERE visit_id = ?').bind(v.id).all<TractorRow>();
  if (rows.some((t) => t.chassis_key === key)) return bad(c, 'This chassis number is already recorded in this audit.', 409);

  const pending = rows.filter((t) => t.source === 'inventory' && t.status === 'pending');
  const exact = pending.find((t) => idKey(t.chassis_no) === key);
  const confirmed = !!b.confirm_chassis && idKey(b.confirm_chassis) === key;
  const suspect = exact ? null : suspectMatch(pending, chassis, reg);
  if (suspect && !confirmed) return c.json({ error: RETYPE_MSG, retype: true }, 409);
  const near = suspect?.reason === 'near_chassis' || suspect?.reason === 'engine_typed' ? suspect.row : undefined;
  const retyped = b.confirm_chassis ? 1 : null;
  const at = now();
  let id: number;
  if (exact) {
    await c.env.DB.prepare(
      `UPDATE tractors SET status = 'verified', verified_reg = ?, verified_chassis = ?, seen_engine = ?, meter_reading = ?, meter_unit = ?,
         location_id = ?, seen_at = ?, chassis_key = ?, retyped = ?, remarks = ?, updated_at = ? WHERE id = ?`,
    )
      .bind(reg, chassis, engine, meter, unit, locationId, at, key, retyped, remarks, at, exact.id)
      .run();
    id = exact.id;
  } else {
    const samePlate = suspect?.reason === 'same_plate' ? suspect.row : undefined;
    const related = near ?? samePlate;
    const res = await c.env.DB.prepare(
      `INSERT INTO tractors (visit_id, source, sort_order, reg_no, chassis_no, engine_no, verified_reg, verified_chassis, seen_engine, status,
         meter_reading, meter_unit, location_id, seen_at, chassis_key, related_id, related_reason, retyped, remarks, updated_at)
       VALUES (?, 'extra', 100000, ?, ?, ?, ?, ?, ?, 'extra', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(v.id, reg, chassis, engine, reg, chassis, engine, meter, unit, locationId, at, key, related?.id ?? null,
        suspect?.reason ?? null, retyped, remarks, at)
      .run();
    id = res.meta.last_row_id;
  }
  const row = await c.env.DB.prepare('SELECT * FROM tractors WHERE id = ?').bind(id).first<TractorRow>();
  return c.json(auditorView([row!])[0]);
});

/** Remove a tractor the auditor recorded by mistake (its stock row, if any, goes back to "not yet shown"). */
app.delete('/tractors/:id', requireRole('auditor', 'admin'), async (c) => {
  const r = await tractorFor(c, Number(c.req.param('id')));
  if (r instanceof Response) return r;
  const { t, v } = r;
  if (c.get('user').role === 'auditor' && !auditDayOpen(v)) return bad(c, DAY_OVER, 409);
  await deletePhotos(c, 'tractor_id = ?', t.id);
  if (t.source === 'extra') await c.env.DB.prepare('DELETE FROM tractors WHERE id = ?').bind(t.id).run();
  else
    await c.env.DB.prepare(
      `UPDATE tractors SET status = 'pending', verified_reg = NULL, verified_chassis = NULL, seen_engine = NULL, meter_reading = NULL,
         meter_unit = NULL, location_id = NULL, seen_at = NULL, chassis_key = NULL, retyped = NULL, remarks = NULL, updated_at = ? WHERE id = ?`,
    )
      .bind(now(), t.id)
      .run();
  return c.json({ ok: true });
});

/** Office correction of a tractor row (status / remarks). */
app.patch('/tractors/:id', requireRole('admin'), async (c) => {
  const r = await tractorFor(c, Number(c.req.param('id')));
  if (r instanceof Response) return r;
  const { t } = r;
  const b = await c.req.json<Record<string, unknown>>();
  const allowed: TractorStatus[] = t.source === 'extra' ? ['extra'] : ['pending', 'verified', 'mismatch', 'not_found'];
  const sets: string[] = ['updated_at = ?'];
  const vals: unknown[] = [now()];
  if ('remarks' in b) (sets.push('remarks = ?'), vals.push(str(b.remarks, 1000)));
  if ('office_remarks' in b) (sets.push('office_remarks = ?'), vals.push(str(b.office_remarks, 1000)));
  if ('status' in b) {
    if (!allowed.includes(b.status as TractorStatus)) return bad(c, 'Invalid status.');
    sets.push('status = ?');
    vals.push(b.status);
  }
  await c.env.DB.prepare(`UPDATE tractors SET ${sets.join(', ')} WHERE id = ?`).bind(...vals, t.id).run();
  return c.json(await c.env.DB.prepare('SELECT * FROM tractors WHERE id = ?').bind(t.id).first());
});

/** Auditor has finished counting what was shown: tell them only HOW MANY stock tractors were not shown. */
/**
 * Correct the numbers of a tractor the auditor recorded that did not match the records (typo).
 * If it now matches a stock tractor, its photos, meter and place move to that tractor.
 */
app.patch('/seen/:id', requireRole('auditor'), async (c) => {
  const r = await tractorFor(c, Number(c.req.param('id')));
  if (r instanceof Response) return r;
  const { t, v } = r;
  if (!auditDayOpen(v)) return bad(c, DAY_OVER, 409);
  if (t.source !== 'extra') return bad(c, 'This tractor already matches the records.');
  const b = await c.req.json<Record<string, unknown>>();
  const reg = str(b.reg_no, 40)?.toUpperCase() ?? null;
  const chassis = str(b.chassis_no, 60)?.toUpperCase() ?? null;
  const engine = str(b.engine_no, 60)?.toUpperCase() ?? null;
  const key = idKey(chassis);
  if (key.length < 5) return bad(c, 'Enter the full chassis number punched on the tractor.');
  const { results: rows } = await c.env.DB.prepare('SELECT * FROM tractors WHERE visit_id = ? AND id != ?').bind(v.id, t.id).all<TractorRow>();
  if (rows.some((x) => x.chassis_key === key)) return bad(c, 'This chassis number is already recorded in this audit.', 409);
  const pending = rows.filter((x) => x.source === 'inventory' && x.status === 'pending');
  const exact = pending.find((x) => idKey(x.chassis_no) === key);
  const confirmed = !!b.confirm_chassis && idKey(b.confirm_chassis) === key;
  const suspect = exact ? null : suspectMatch(pending, chassis, reg);
  if (suspect && !confirmed) return c.json({ error: RETYPE_MSG, retype: true }, 409);
  const at = now();
  let id = t.id;
  if (exact) {
    await c.env.DB.batch([
      c.env.DB.prepare(
        `UPDATE tractors SET status = 'verified', verified_reg = ?, verified_chassis = ?, seen_engine = ?, meter_reading = ?, meter_unit = ?,
           location_id = ?, seen_at = ?, chassis_key = ?, retyped = 1, remarks = ?, updated_at = ? WHERE id = ?`,
      ).bind(reg, chassis, engine, t.meter_reading, t.meter_unit, t.location_id, t.seen_at, key, t.remarks, at, exact.id),
      c.env.DB.prepare('UPDATE photos SET tractor_id = ? WHERE tractor_id = ?').bind(exact.id, t.id),
      c.env.DB.prepare('DELETE FROM tractors WHERE id = ?').bind(t.id),
    ]);
    id = exact.id;
  } else
    await c.env.DB.prepare(
      `UPDATE tractors SET reg_no = ?, chassis_no = ?, engine_no = ?, verified_reg = ?, verified_chassis = ?, seen_engine = ?, chassis_key = ?,
         related_id = ?, related_reason = ?, retyped = 1, updated_at = ? WHERE id = ?`,
    )
      .bind(reg, chassis, engine, reg, chassis, engine, key, suspect?.row.id ?? null, suspect?.reason ?? null, at, t.id)
      .run();
  const row = await c.env.DB.prepare('SELECT * FROM tractors WHERE id = ?').bind(id).first<TractorRow>();
  return c.json({ old_id: t.id, tractor: auditorView([row!])[0] });
});

app.post('/visits/:id/count-done', requireRole('auditor'), async (c) => {
  const v = await visitFor(c, Number(c.req.param('id')), 'edit');
  if (v instanceof Response) return v;
  const r = await c.env.DB.prepare("SELECT COUNT(*) AS n FROM tractors WHERE visit_id = ? AND source = 'inventory' AND status = 'pending'")
    .bind(v.id)
    .first<{ n: number }>();
  const pending = r?.n ?? 0;
  // The first count (before any off-site visits) is kept as evidence
  if (!v.count_done_at)
    await c.env.DB.prepare('UPDATE visits SET count_done_at = ?, pending_at_count = ? WHERE id = ?').bind(now(), pending, v.id).run();
  // Help find typos: the auditor's own entries that matched nothing in the records (the list itself stays hidden)
  const recheck = pending
    ? (
        await c.env.DB.prepare("SELECT id FROM tractors WHERE visit_id = ? AND source = 'extra' AND seen_at IS NOT NULL ORDER BY id").bind(v.id).all<{ id: number }>()
      ).results.map((x) => x.id)
    : [];
  return c.json({ pending, recheck, day_open: auditDayOpen(v) });
});

app.put('/visits/:id/explanation', requireRole('auditor'), async (c) => {
  const v = await visitFor(c, Number(c.req.param('id')), 'edit');
  if (v instanceof Response) return v;
  const b = await c.req.json<{ missing_explanation?: string }>();
  await c.env.DB.prepare('UPDATE visits SET missing_explanation = ? WHERE id = ?').bind(str(b.missing_explanation, 2000), v.id).run();
  return c.json({ ok: true });
});

/** The centre says some tractors are elsewhere: the auditor goes there and checks in with GPS and a photo of the place. */
app.post('/visits/:id/locations', requireRole('auditor'), async (c) => {
  const v = await visitFor(c, Number(c.req.param('id')), 'edit');
  if (v instanceof Response) return v;
  if (!auditDayOpen(v)) return bad(c, DAY_OVER, 409);
  const img = await readImage(c);
  if (img instanceof Response) return img;
  const { form, file } = img;
  const name = str(form.get('name'), 120);
  if (!name) return bad(c, 'Enter the name of the place (e.g. "Sharma service centre").');
  const lat = num(form.get('lat'));
  const lng = num(form.get('lng'));
  if (lat === null || lng === null) return bad(c, 'Turn on location (GPS) to check in at this place.');
  const centre = await c.env.DB.prepare('SELECT lat, lng FROM centres WHERE id = ?').bind(v.centre_id).first<{ lat: number | null; lng: number | null }>();
  const distance = centre?.lat != null && centre?.lng != null ? Math.round(distanceMetres(lat, lng, centre.lat, centre.lng)) : null;
  const at = now();
  const res = await c.env.DB.prepare(
    'INSERT INTO visit_locations (visit_id, name, kind, address, lat, lng, accuracy, distance_m, arrived_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(v.id, name, str(form.get('kind'), 40), str(form.get('address'), 300), lat, lng, num(form.get('accuracy')), distance, at)
    .run();
  const locId = res.meta.last_row_id;
  const key = `visits/${v.id}/location-${randomToken(8)}.jpg`;
  await c.env.PHOTOS.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO photos (visit_id, location_id, kind, r2_key, size_bytes, lat, lng, taken_at, uploaded_by) VALUES (?, ?, 'other', ?, ?, ?, ?, ?, ?)`,
    ).bind(v.id, locId, key, file.size, lat, lng, at, c.get('user').id),
    c.env.DB.prepare('INSERT INTO location_pings (visit_id, user_id, lat, lng, accuracy, at) VALUES (?, ?, ?, ?, ?, ?)').bind(
      v.id, c.get('user').id, lat, lng, num(form.get('accuracy')), at,
    ),
  ]);
  return c.json(await c.env.DB.prepare('SELECT * FROM visit_locations WHERE id = ?').bind(locId).first());
});

/** Office only: add an extra tractor by hand. */
app.post('/visits/:id/tractors', requireRole('admin'), async (c) => {
  const v = await visitFor(c, Number(c.req.param('id')), 'edit');
  if (v instanceof Response) return v;
  const b = await c.req.json<Record<string, unknown>>();
  const reg = str(b.reg_no, 40)?.toUpperCase() ?? null;
  const chassis = str(b.chassis_no, 60)?.toUpperCase() ?? null;
  if (!reg && !chassis) return bad(c, 'Enter the registration number or the chassis number.');
  const res = await c.env.DB.prepare(
    `INSERT INTO tractors (visit_id, source, sort_order, reg_no, chassis_no, verified_reg, verified_chassis, status, remarks, chassis_key, updated_at)
     VALUES (?, 'extra', 100000, ?, ?, ?, ?, 'extra', ?, ?, ?)`,
  )
    .bind(v.id, reg, chassis, reg, chassis, str(b.remarks, 1000), idKey(chassis) || null, now())
    .run();
  return c.json(await c.env.DB.prepare('SELECT * FROM tractors WHERE id = ?').bind(res.meta.last_row_id).first());
});

// ---------------------------------------------------------------- accessories

async function accessoryFor(c: C, id: number) {
  const a = await c.env.DB.prepare('SELECT * FROM accessories WHERE id = ?').bind(id).first<{ id: number; visit_id: number }>();
  if (!a) return bad(c, 'Accessory not found.', 404);
  const v = await visitFor(c, a.visit_id, 'edit');
  if (v instanceof Response) return v;
  return a;
}

// ---------------------------------------------------------------- facility condition

/** Create the standard facility checklist for a visit (once). */
async function ensureFacility(c: C, visitId: number) {
  const has = await c.env.DB.prepare('SELECT 1 FROM facility_checks WHERE visit_id = ? LIMIT 1').bind(visitId).first();
  if (has) return;
  await c.env.DB.batch(
    DEFAULT_FACILITY_AREAS.map((area, i) =>
      c.env.DB.prepare('INSERT INTO facility_checks (visit_id, area, sort_order) VALUES (?, ?, ?)').bind(visitId, area, i),
    ),
  );
}

async function facilityFor(c: C, id: number) {
  const f = await c.env.DB.prepare('SELECT * FROM facility_checks WHERE id = ?').bind(id).first<{ id: number; visit_id: number; is_custom: number }>();
  if (!f) return bad(c, 'Facility area not found.', 404);
  const v = await visitFor(c, f.visit_id, 'edit');
  if (v instanceof Response) return v;
  return f;
}

app.patch('/facility/:id', requireRole('auditor', 'admin'), async (c) => {
  const f = await facilityFor(c, Number(c.req.param('id')));
  if (f instanceof Response) return f;
  const b = await c.req.json<Record<string, unknown>>();
  const sets: string[] = ['updated_at = ?'];
  const vals: unknown[] = [now()];
  if ('rating' in b) {
    if (b.rating !== null && !['good', 'average', 'poor', 'na'].includes(String(b.rating))) return bad(c, 'Invalid condition.');
    sets.push('rating = ?');
    vals.push(b.rating);
  }
  if ('remarks' in b) (sets.push('remarks = ?'), vals.push(str(b.remarks, 1000)));
  if ('area' in b && f.is_custom) (sets.push('area = ?'), vals.push(str(b.area, 100) ?? 'Other area'));
  await c.env.DB.prepare(`UPDATE facility_checks SET ${sets.join(', ')} WHERE id = ?`).bind(...vals, f.id).run();
  return c.json(await c.env.DB.prepare('SELECT id, area, sort_order, is_custom, rating, remarks FROM facility_checks WHERE id = ?').bind(f.id).first());
});

app.post('/visits/:id/facility', requireRole('auditor', 'admin'), async (c) => {
  const v = await visitFor(c, Number(c.req.param('id')), 'edit');
  if (v instanceof Response) return v;
  const { area } = await c.req.json<{ area: string }>();
  const name = str(area, 100);
  if (!name) return bad(c, 'Enter the area name.');
  const res = await c.env.DB.prepare('INSERT INTO facility_checks (visit_id, area, sort_order, is_custom) VALUES (?, ?, 1000, 1)').bind(v.id, name).run();
  return c.json(
    await c.env.DB.prepare('SELECT id, area, sort_order, is_custom, rating, remarks FROM facility_checks WHERE id = ?').bind(res.meta.last_row_id).first(),
  );
});

app.delete('/facility/:id', requireRole('auditor', 'admin'), async (c) => {
  const f = await facilityFor(c, Number(c.req.param('id')));
  if (f instanceof Response) return f;
  if (!f.is_custom) return bad(c, 'Standard areas cannot be removed – mark them "Not applicable" instead.');
  await deletePhotos(c, 'facility_id = ?', f.id);
  await c.env.DB.prepare('DELETE FROM facility_checks WHERE id = ?').bind(f.id).run();
  return c.json({ ok: true });
});

app.post('/visits/:id/accessories', requireRole('auditor', 'admin'), async (c) => {
  const v = await visitFor(c, Number(c.req.param('id')), 'edit');
  if (v instanceof Response) return v;
  const b = await c.req.json<Record<string, unknown>>();
  const name = str(b.name, 100);
  if (!name) return bad(c, 'Enter the accessory name.');
  const res = await c.env.DB.prepare('INSERT INTO accessories (visit_id, name, qty, remarks) VALUES (?, ?, ?, ?)')
    .bind(v.id, name, Math.max(0, Math.round(num(b.qty) ?? 0)), str(b.remarks, 1000))
    .run();
  return c.json(await c.env.DB.prepare('SELECT * FROM accessories WHERE id = ?').bind(res.meta.last_row_id).first());
});

app.patch('/accessories/:id', requireRole('auditor', 'admin'), async (c) => {
  const a = await accessoryFor(c, Number(c.req.param('id')));
  if (a instanceof Response) return a;
  const b = await c.req.json<Record<string, unknown>>();
  const sets: string[] = [];
  const vals: unknown[] = [];
  if ('name' in b) (sets.push('name = ?'), vals.push(str(b.name, 100) ?? 'Accessory'));
  if ('qty' in b) (sets.push('qty = ?'), vals.push(Math.max(0, Math.round(num(b.qty) ?? 0))));
  if ('remarks' in b) (sets.push('remarks = ?'), vals.push(str(b.remarks, 1000)));
  if (sets.length) await c.env.DB.prepare(`UPDATE accessories SET ${sets.join(', ')} WHERE id = ?`).bind(...vals, a.id).run();
  return c.json(await c.env.DB.prepare('SELECT * FROM accessories WHERE id = ?').bind(a.id).first());
});

app.delete('/accessories/:id', requireRole('auditor', 'admin'), async (c) => {
  const a = await accessoryFor(c, Number(c.req.param('id')));
  if (a instanceof Response) return a;
  await deletePhotos(c, 'accessory_id = ?', a.id);
  await c.env.DB.prepare('DELETE FROM accessories WHERE id = ?').bind(a.id).run();
  return c.json({ ok: true });
});

// ---------------------------------------------------------------- photos & signatures

const MAX_PHOTO_BYTES = 3 * 1024 * 1024;

async function deletePhotos(c: C, where: string, id: number) {
  const { results } = await c.env.DB.prepare(`SELECT r2_key FROM photos WHERE ${where}`).bind(id).all<{ r2_key: string }>();
  if (results.length) await c.env.PHOTOS.delete(results.map((r) => r.r2_key));
  await c.env.DB.prepare(`DELETE FROM photos WHERE ${where}`).bind(id).run();
}

/** Validate an uploaded image from a form; returns an error message or the file. */
function imageFrom(form: FormData): File | string {
  const file = form.get('file') as unknown as File | string | null;
  if (!file || typeof file === 'string') return 'No photo received.';
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) return 'Only JPEG, PNG or WebP photos are accepted.';
  if (file.size > MAX_PHOTO_BYTES) return 'The photo is too large (max 3 MB).';
  return file;
}

async function readImage(c: C): Promise<{ form: FormData; file: File } | Response> {
  const form = await c.req.formData();
  const file = imageFrom(form);
  return typeof file === 'string' ? bad(c, file) : { form, file };
}

app.post('/visits/:id/photos', requireRole('auditor', 'admin'), async (c) => {
  const v = await visitFor(c, Number(c.req.param('id')), 'edit');
  if (v instanceof Response) return v;
  const img = await readImage(c);
  if (img instanceof Response) return img;
  const { form, file } = img;
  const kind = String(form.get('kind') ?? 'other') as PhotoKind | 'facility' | 'meter' | 'document';
  if (!['chassis', 'tractor', 'accessory', 'storefront', 'facility', 'meter', 'document', 'other'].includes(kind)) return bad(c, 'Invalid photo type.');
  // Facility and meter photos are stored as "other", linked to their area / tractor
  // Supporting documents (invoice, challan, job card…) are "other" photos not linked to anything
  const storedKind: PhotoKind = kind === 'facility' || kind === 'meter' || kind === 'document' ? 'other' : kind;
  const tractorId = num(form.get('tractor_id'));
  const accessoryId = num(form.get('accessory_id'));
  const facilityId = num(form.get('facility_id'));
  if (kind === 'facility') {
    if (!facilityId) return bad(c, 'Choose the facility area for this photo.');
    const f = await c.env.DB.prepare('SELECT 1 FROM facility_checks WHERE id = ? AND visit_id = ?').bind(facilityId, v.id).first();
    if (!f) return bad(c, 'Facility area not found in this visit.');
  }
  if (tractorId) {
    const t = await c.env.DB.prepare('SELECT 1 FROM tractors WHERE id = ? AND visit_id = ?').bind(tractorId, v.id).first();
    if (!t) return bad(c, 'Tractor not found in this visit.');
  }
  if (accessoryId) {
    const a = await c.env.DB.prepare('SELECT 1 FROM accessories WHERE id = ? AND visit_id = ?').bind(accessoryId, v.id).first();
    if (!a) return bad(c, 'Accessory not found in this visit.');
  }
  const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
  if ((kind === 'chassis' || kind === 'tractor' || kind === 'meter') && !tractorId) return bad(c, 'Choose the tractor for this photo.');
  const key = `visits/${v.id}/${kind}-${randomToken(8)}.${ext}`;
  await c.env.PHOTOS.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
  const takenAt = String(form.get('taken_at') ?? '');
  const res = await c.env.DB.prepare(
    `INSERT INTO photos (visit_id, tractor_id, accessory_id, facility_id, kind, r2_key, size_bytes, lat, lng, taken_at, uploaded_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      v.id,
      tractorId,
      accessoryId,
      kind === 'facility' ? facilityId : null,
      storedKind,
      key,
      file.size,
      num(form.get('lat')),
      num(form.get('lng')),
      takenAt && !isNaN(Date.parse(takenAt)) ? new Date(takenAt).toISOString() : now(),
      c.get('user').id,
    )
    .run();
  // One photo per tractor slot (chassis / tractor / meter): a new one replaces the old
  let replaced: number[] = [];
  if (tractorId && (kind === 'chassis' || kind === 'tractor' || kind === 'meter')) {
    const { results: old } = await c.env.DB.prepare('SELECT id, r2_key FROM photos WHERE tractor_id = ? AND kind = ? AND id != ?')
      .bind(tractorId, storedKind, res.meta.last_row_id)
      .all<{ id: number; r2_key: string }>();
    if (old.length) {
      await c.env.PHOTOS.delete(old.map((o) => o.r2_key));
      await c.env.DB.prepare(`DELETE FROM photos WHERE id IN (${old.map(() => '?').join(',')})`).bind(...old.map((o) => o.id)).run();
      replaced = old.map((o) => o.id);
    }
  }
  const saved = await c.env.DB.prepare('SELECT id, tractor_id, accessory_id, facility_id, location_id, kind, lat, lng, taken_at FROM photos WHERE id = ?')
    .bind(res.meta.last_row_id)
    .first();
  return c.json({ ...saved, replaced });
});

app.delete('/photos/:id', requireRole('auditor', 'admin'), async (c) => {
  const p = await c.env.DB.prepare('SELECT id, visit_id FROM photos WHERE id = ?').bind(Number(c.req.param('id'))).first<{ id: number; visit_id: number }>();
  if (!p) return bad(c, 'Photo not found.', 404);
  const v = await visitFor(c, p.visit_id, 'edit');
  if (v instanceof Response) return v;
  await deletePhotos(c, 'id = ?', p.id);
  return c.json({ ok: true });
});

async function serveObject(c: C, key: string | null) {
  if (!key) return bad(c, 'Not found.', 404);
  const obj = await c.env.PHOTOS.get(key);
  if (!obj) return bad(c, 'Not found.', 404);
  return new Response(obj.body, {
    headers: {
      'Content-Type': obj.httpMetadata?.contentType ?? 'image/jpeg',
      'Cache-Control': 'private, max-age=86400',
    },
  });
}

app.get('/photos/:id', requireRole(), async (c) => {
  const p = await c.env.DB.prepare('SELECT visit_id, r2_key FROM photos WHERE id = ?').bind(Number(c.req.param('id'))).first<{ visit_id: number; r2_key: string }>();
  if (!p) return bad(c, 'Photo not found.', 404);
  const v = await visitFor(c, p.visit_id, 'read');
  if (v instanceof Response) return v;
  return serveObject(c, p.r2_key);
});

app.put('/visits/:id/signature/:who', requireRole('auditor', 'admin'), async (c) => {
  const who = c.req.param('who');
  if (who !== 'auditor' && who !== 'manager') return bad(c, 'Invalid signature.');
  const v = await visitFor(c, Number(c.req.param('id')), 'edit');
  if (v instanceof Response) return v;
  const img = await readImage(c);
  if (img instanceof Response) return img;
  const col = who === 'auditor' ? 'auditor_signature_key' : 'manager_signature_key';
  const old = v[col];
  const key = `visits/${v.id}/signature-${who}-${randomToken(6)}.png`;
  await c.env.PHOTOS.put(key, await img.file.arrayBuffer(), { httpMetadata: { contentType: img.file.type } });
  await c.env.DB.prepare(`UPDATE visits SET ${col} = ? WHERE id = ?`).bind(key, v.id).run();
  if (old) await c.env.PHOTOS.delete(old);
  return c.json({ ok: true });
});

app.get('/visits/:id/signature/:who', requireRole(), async (c) => {
  const v = await visitFor(c, Number(c.req.param('id')), 'read');
  if (v instanceof Response) return v;
  return serveObject(c, c.req.param('who') === 'manager' ? v.manager_signature_key : v.auditor_signature_key);
});

app.get('/visits/:id/checkin-selfie', requireRole('admin', 'auditor'), async (c) => {
  const v = await visitFor(c, Number(c.req.param('id')), 'read');
  if (v instanceof Response) return v;
  return serveObject(c, v.checkin_selfie_key);
});

// ---------------------------------------------------------------- submit & review

/** Everything the client's deliverables need, checked before an audit can be submitted. */
async function submissionProblems(c: C, visitId: number, v: Visit): Promise<string[]> {
  const db = c.env.DB;
  const [{ results: tractors }, { results: accessories }, { results: photos }] = await db.batch([
    db.prepare('SELECT id, reg_no, chassis_no, verified_reg, verified_chassis, status FROM tractors WHERE visit_id = ?').bind(visitId),
    db.prepare('SELECT id, name FROM accessories WHERE visit_id = ?').bind(visitId),
    db.prepare('SELECT tractor_id, accessory_id, facility_id, kind FROM photos WHERE visit_id = ?').bind(visitId),
  ]);
  const { results: facility } = await db
    .prepare('SELECT id, area, rating, remarks FROM facility_checks WHERE visit_id = ? ORDER BY sort_order, id')
    .bind(visitId)
    .all<{ id: number; area: string; rating: string | null; remarks: string | null }>();
  type T = { id: number; reg_no: string | null; chassis_no: string | null; verified_reg: string | null; verified_chassis: string | null; status: string };
  type P = { tractor_id: number | null; accessory_id: number | null; facility_id: number | null; kind: string };
  const ph = photos as P[];
  const problems: string[] = [];
  const seen = (tractors as T[]).filter((t) => t.status !== 'pending' && t.status !== 'not_found');
  const label = (t: T) => t.verified_reg || t.verified_chassis || t.reg_no || t.chassis_no;
  if (!v.count_done_at) problems.push('Tap "Done counting" on the Finish tab first.');
  else if ((tractors as T[]).some((t) => t.status === 'pending') && !v.missing_explanation?.trim())
    problems.push("Write the manager's explanation for the tractors not shown.");
  const noPhoto = seen.filter((t) => !ph.some((p) => p.tractor_id === t.id && p.kind === 'chassis'));
  if (noPhoto.length)
    problems.push(`Chassis photo missing for: ${noPhoto.slice(0, 5).map(label).join(', ')}${noPhoto.length > 5 ? '…' : ''}`);
  const noMeter = seen.filter((t) => !ph.some((p) => p.tractor_id === t.id && p.kind === 'other'));
  if (noMeter.length) problems.push(`Meter photo missing for: ${noMeter.slice(0, 5).map(label).join(', ')}${noMeter.length > 5 ? '…' : ''}`);
  const noTractorPhoto = seen.filter((t) => !ph.some((p) => p.tractor_id === t.id && p.kind === 'tractor'));
  if (noTractorPhoto.length)
    problems.push(
      `Tractor photo missing for: ${noTractorPhoto.slice(0, 5).map(label).join(', ')}${noTractorPhoto.length > 5 ? '…' : ''}`,
    );
  const accNoPhoto = (accessories as { id: number; name: string }[]).filter((a) => !ph.some((p) => p.accessory_id === a.id));
  if (accNoPhoto.length) problems.push(`Photo missing for accessories: ${accNoPhoto.map((a) => a.name).join(', ')}`);
  if (!ph.some((p) => p.kind === 'storefront')) problems.push('Storefront photo is missing.');
  const facIssues = facility
    .map((f) => ({ f, problem: facilityProblem(f, ph.filter((p) => p.facility_id === f.id).length) }))
    .filter((x) => x.problem);
  if (facIssues.length) problems.push(`Facility check incomplete: ${facIssues.map((x) => `${x.f.area} (${x.problem})`).join('; ')}`);
  if (!v.auditor_signature_key) problems.push('Auditor signature is missing.');
  if (!v.manager_signature_key) problems.push("Outlet manager's signature is missing.");
  return problems;
}

app.post('/visits/:id/submit', requireRole('auditor'), async (c) => {
  const v = await visitFor(c, Number(c.req.param('id')), 'edit');
  if (v instanceof Response) return v;
  const b = await c.req.json<{ manager_name?: string; manager_phone?: string; missing_explanation?: string; general_remarks?: string; lat?: number; lng?: number }>();
  const manager = str(b.manager_name, 100);
  if (b.missing_explanation !== undefined) {
    v.missing_explanation = str(b.missing_explanation, 2000);
    await c.env.DB.prepare('UPDATE visits SET missing_explanation = ? WHERE id = ?').bind(v.missing_explanation, v.id).run();
  }
  const problems = await submissionProblems(c, v.id, v);
  if (!manager) problems.push("Enter the outlet manager's name.");
  if (problems.length) return c.json({ error: 'The audit is not complete yet.', problems }, 400);
  const at = now();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE visits SET status = 'submitted', manager_name = ?, manager_phone = ?, general_remarks = ?, submitted_at = ?,
         checkout_at = ?, checkout_lat = ?, checkout_lng = ? WHERE id = ?`,
    ).bind(manager, str(b.manager_phone, 20), str(b.general_remarks, 2000), at, at, num(b.lat), num(b.lng), v.id),
    // Whatever was not shown is short
    c.env.DB.prepare("UPDATE tractors SET status = 'not_found', updated_at = ? WHERE visit_id = ? AND status = 'pending'").bind(at, v.id),
    ...(num(b.lat) !== null && num(b.lng) !== null
      ? [
          c.env.DB.prepare('INSERT INTO location_pings (visit_id, user_id, lat, lng, at) VALUES (?, ?, ?, ?, ?)').bind(
            v.id,
            c.get('user').id,
            num(b.lat),
            num(b.lng),
            at,
          ),
        ]
      : []),
  ]);
  // Findings: tell the office straight away (routine audits go in the 6 PM summary)
  const { results: trs } = await c.env.DB.prepare('SELECT * FROM tractors WHERE visit_id = ?').bind(v.id).all<TractorRow>();
  const checked = await withPreviousMeter(c, v, trs);
  const short = trs.filter((t) => t.status === 'not_found').length;
  const flagged = checked.filter((t) => (t as { meter_flag?: string | null }).meter_flag).length;
  const suspicious = trs.filter((t) => t.related_reason).length;
  if (short || flagged || suspicious) {
    const ce = await c.env.DB.prepare('SELECT name FROM centres WHERE id = ?').bind(v.centre_id).first<{ name: string }>();
    const parts = [short && `${short} short`, suspicious && `${suspicious} chassis to check`, flagged && `${flagged} meter flag${flagged > 1 ? 's' : ''}`].filter(Boolean);
    await notify(
      c.env,
      await usersWithRole(c.env, 'admin'),
      { kind: 'findings', title: `Audit with findings: ${ce?.name ?? ''}`, body: `${parts.join(', ')} – submitted by ${c.get('user').name}.`, link: `/visits/${v.id}` },
      (p) => c.executionCtx.waitUntil(p),
    );
  }
  return c.json({ ok: true });
});

app.post('/visits/:id/review', requireRole('admin'), async (c) => {
  const id = Number(c.req.param('id'));
  const b = await c.req.json<{ action: 'approve' | 'return' | 'unapprove'; note?: string }>();
  const v = await c.env.DB.prepare('SELECT status FROM visits WHERE id = ?').bind(id).first<Visit>();
  if (!v) return bad(c, 'Visit not found.', 404);
  const user: SessionUser = c.get('user');
  if (b.action === 'approve') {
    if (v.status !== 'submitted') return bad(c, 'Only submitted audits can be approved.', 409);
    await c.env.DB.prepare("UPDATE visits SET status = 'approved', reviewed_at = ?, reviewed_by = ?, review_note = ? WHERE id = ?")
      .bind(now(), user.id, str(b.note, 1000), id)
      .run();
  } else if (b.action === 'return') {
    if (v.status !== 'submitted' && v.status !== 'approved') return bad(c, 'Only submitted audits can be returned.', 409);
    if (!str(b.note)) return bad(c, 'Tell the auditor what needs fixing.');
    await c.env.DB.batch([
      c.env.DB.prepare(
        "UPDATE visits SET status = 'returned', reviewed_at = ?, reviewed_by = ?, review_note = ?, submitted_at = NULL WHERE id = ?",
      ).bind(now(), user.id, str(b.note, 1000), id),
      c.env.DB.prepare("UPDATE tractors SET status = 'pending' WHERE visit_id = ? AND status = 'not_found'").bind(id),
    ]);
  } else if (b.action === 'unapprove') {
    if (v.status !== 'approved') return bad(c, 'This audit is not approved.', 409);
    await c.env.DB.prepare("UPDATE visits SET status = 'submitted', reviewed_at = NULL, reviewed_by = NULL WHERE id = ?").bind(id).run();
  } else return bad(c, 'Unknown action.');
  return c.json({ ok: true });
});

// ---------------------------------------------------------------- dashboard, live tracking, billing

app.get('/dashboard', requireRole('admin'), async (c) => {
  const date = c.req.query('date') ?? now().slice(0, 10);
  const db = c.env.DB;
  const [byStatus, pendingReview, activeAuditors] = await db.batch([
    db.prepare('SELECT status, COUNT(*) AS n FROM visits WHERE audit_date = ? GROUP BY status').bind(date),
    db.prepare("SELECT COUNT(*) AS n FROM visits WHERE status = 'submitted'"),
    db.prepare("SELECT COUNT(DISTINCT auditor_id) AS n FROM visits WHERE status = 'in_progress'"),
  ]);
  return c.json({
    date,
    by_status: Object.fromEntries((byStatus.results as { status: string; n: number }[]).map((r) => [r.status, r.n])),
    awaiting_review: (pendingReview.results[0] as { n: number }).n,
    auditors_on_site: (activeAuditors.results[0] as { n: number }).n,
    late: await (async () => {
      const t = istParts();
      return (await lateLines(c.env, t.date, t.minutes)).map((l) => ({ centre: l.centre_name, auditor: l.auditor_name, reach_by: fmtTime(l.reach_by) }));
    })(),
  });
});

app.get('/live', requireRole('admin'), async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT v.id AS visit_id, v.checkin_at, v.checkin_distance_m, ce.name AS centre_name, ce.lat AS centre_lat, ce.lng AS centre_lng,
            u.name AS auditor_name, u.phone AS auditor_phone,
            p.lat, p.lng, p.accuracy, p.at AS last_seen,
            (SELECT COUNT(*) FROM tractors t WHERE t.visit_id = v.id AND t.status != 'pending') AS done_count,
            (SELECT COUNT(*) FROM tractors t WHERE t.visit_id = v.id) AS total_count
     FROM visits v JOIN centres ce ON ce.id = v.centre_id JOIN users u ON u.id = v.auditor_id
     LEFT JOIN location_pings p ON p.id = (SELECT id FROM location_pings WHERE visit_id = v.id ORDER BY at DESC LIMIT 1)
     WHERE v.status = 'in_progress' ORDER BY u.name`,
  ).all();
  return c.json(results);
});

app.get('/billing', requireRole('admin'), async (c) => {
  const month = c.req.query('month') ?? now().slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) return bad(c, 'Choose a month.');
  const { results } = await c.env.DB.prepare(
    `SELECT v.id AS visit_id, v.audit_date, v.checkin_at, v.checkout_at, v.status, v.outcome, v.outcome_reason, v.checkin_distance_m,
            ce.name AS centre_name, ce.state, u.id AS auditor_id, u.name AS auditor_name, u.username, u.home_area, u.phone,
            (SELECT COUNT(*) FROM tractors t WHERE t.visit_id = v.id) AS tractor_count
     FROM visits v JOIN centres ce ON ce.id = v.centre_id JOIN users u ON u.id = v.auditor_id
     WHERE substr(v.audit_date, 1, 7) = ? AND v.status IN ('approved', 'submitted')
     ORDER BY u.name, v.audit_date, ce.name`,
  )
    .bind(month)
    .all();
  return c.json({ month, visits: results });
});

// ---------------------------------------------------------------- photo stamp: address and map (OpenStreetMap)

// OpenStreetMap's usage policies ask for an identifying User-Agent and light, cached use.
const OSM_UA = 'SJBJ-StockAudit/1.0 (+https://tj-stock-audit.sjbjtractor.workers.dev)';

/** Address for a GPS point, used in the photo stamp. Cached per ~10 m for 30 days. */
app.get('/geo/reverse', requireRole('auditor', 'admin'), async (c) => {
  const lat = num(c.req.query('lat'));
  const lng = num(c.req.query('lng'));
  const lang = c.req.query('lang') === 'hi' ? 'hi' : 'en';
  if (lat === null || lng === null) return bad(c, 'Missing location.');
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&addressdetails=1&zoom=18&accept-language=${lang},en&lat=${lat.toFixed(4)}&lon=${lng.toFixed(4)}`;
  const cache = (caches as unknown as { default: Cache }).default;
  let res = await cache.match(url);
  if (!res) {
    const r = await fetch(url, { headers: { 'User-Agent': OSM_UA, 'Accept-Language': lang } }).catch(() => null);
    if (!r || !r.ok) return c.json({ place: null, address: null });
    res = new Response(r.body, { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=2592000' } });
    c.executionCtx.waitUntil(cache.put(url, res.clone()));
  }
  const j = (await res.json()) as { address?: Record<string, string> };
  const a = j.address ?? {};
  const town = a.city || a.town || a.village || a.suburb || a.county || '';
  const place = [town, a.state, a.country].filter(Boolean).join(', ');
  const address = [a.road, a.neighbourhood || a.suburb || a.hamlet, town !== (a.suburb ?? '') ? town : '', [a.state, a.postcode].filter(Boolean).join(' '), a.country]
    .filter((x, i, arr) => x && arr.indexOf(x) === i)
    .join(', ');
  return c.json({ place: place || null, address: address || null });
});

/** Map tile for the stamp's thumbnail (same-origin, so the phone can draw it into the photo). */
app.get('/geo/tile/:z/:x/:y', requireRole('auditor', 'admin'), async (c) => {
  const [z, x, y] = ['z', 'x', 'y'].map((k) => Number(c.req.param(k)));
  if (![z, x, y].every(Number.isInteger) || z < 3 || z > 18) return bad(c, 'Invalid tile.');
  const url = `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
  const cache = (caches as unknown as { default: Cache }).default;
  let res = await cache.match(url);
  if (!res) {
    const r = await fetch(url, { headers: { 'User-Agent': OSM_UA } }).catch(() => null);
    if (!r || !r.ok) return bad(c, 'Map not available.', 404);
    res = new Response(r.body, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=604800' } });
    c.executionCtx.waitUntil(cache.put(url, res.clone()));
  }
  return new Response(res.body, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=604800' } });
});

// ---------------------------------------------------------------- weekly audit plan

const isTime = (t: unknown) => typeof t === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(t);

/**
 * Tell auditors about their allocation once the week is approved & locked: the new auditor gets
 * "allocated", a replaced auditor gets "cancelled", and a changed date / time is an "update".
 */
async function allocationNotices(c: C, planId: number, changed = false) {
  const p = await c.env.DB.prepare(
    `SELECT p.*, ce.name AS centre_name FROM plans p JOIN centres ce ON ce.id = p.centre_id
     WHERE p.id = ? AND EXISTS (SELECT 1 FROM plan_weeks w WHERE w.week_start = ? AND w.locked_at IS NOT NULL)`,
  )
    .bind(planId, weekOf((await c.env.DB.prepare('SELECT plan_date FROM plans WHERE id = ?').bind(planId).first<{ plan_date: string }>())?.plan_date ?? '2000-01-03'))
    .first<{ id: number; plan_date: string; auditor_id: number | null; notified_auditor_id: number | null; reach_by: string | null; centre_name: string }>();
  if (!p) return; // draft week: nobody is told yet
  if (p.plan_date < istParts().date) return; // past days
  const wait = (x: Promise<unknown>) => c.executionCtx.waitUntil(x);
  const when = `${dayName(p.plan_date)} ${dmy(p.plan_date)}`;
  if (p.notified_auditor_id && p.notified_auditor_id !== p.auditor_id)
    await notify(c.env, [p.notified_auditor_id], { kind: 'allocation', title: `Cancelled: ${p.centre_name} on ${dmy(p.plan_date)}`, body: 'This audit has been given to another auditor.', link: '/' }, wait);
  if (p.auditor_id && (p.notified_auditor_id !== p.auditor_id || changed))
    await notify(
      c.env,
      [p.auditor_id],
      {
        kind: 'allocation',
        title: `${changed && p.notified_auditor_id === p.auditor_id ? 'Changed' : 'Audit allocated'}: ${p.centre_name}`,
        body: `${when}. Reach the showroom by ${fmtTime(p.reach_by ?? DEFAULT_REACH_BY)}.`,
        link: '/',
      },
      wait,
    );
  if (p.notified_auditor_id !== p.auditor_id)
    await c.env.DB.prepare('UPDATE plans SET notified_auditor_id = ?, reminded_eve_at = NULL, reminded_day_at = NULL, late_alerted_at = NULL WHERE id = ?').bind(p.auditor_id, p.id).run();
}

/** An audit already created for this centre and day (stock statement uploaded) follows the plan's auditor until it starts. */
async function syncPlanAuditor(c: C, planId: number) {
  const p = await c.env.DB.prepare('SELECT plan_date, centre_id, auditor_id FROM plans WHERE id = ?').bind(planId).first<{ plan_date: string; centre_id: number; auditor_id: number | null }>();
  if (!p) return;
  await c.env.DB.prepare("UPDATE visits SET auditor_id = ? WHERE centre_id = ? AND audit_date = ? AND status = 'assigned'")
    .bind(p.auditor_id, p.centre_id, p.plan_date)
    .run();
}

const isDate = (d: unknown) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d);
/** Monday of the week containing the date (YYYY-MM-DD). */
function weekOf(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

async function weekLocked(c: C, date: string) {
  return !!(await c.env.DB.prepare('SELECT 1 FROM plan_weeks WHERE week_start = ? AND locked_at IS NOT NULL').bind(weekOf(date)).first());
}

/** Centres and auditors to plan with (planners cannot see the admin lists). */
app.get('/plan/options', requireRole('admin', 'planner'), async (c) => {
  const [centres, auditors] = await c.env.DB.batch([
    c.env.DB.prepare('SELECT id, state, name, address, opening_hours, weekly_off FROM centres WHERE active = 1 ORDER BY state, name'),
    c.env.DB.prepare("SELECT id, name, phone, home_area FROM users WHERE role = 'auditor' AND access IS NULL AND active = 1 ORDER BY name"),
  ]);
  return c.json({ centres: centres.results, auditors: auditors.results });
});

app.get('/plans', requireRole('admin', 'planner'), async (c) => {
  const from = c.req.query('from');
  const to = c.req.query('to');
  if (!isDate(from) || !isDate(to)) return bad(c, 'Choose the dates.');
  const [rows, weeks] = await c.env.DB.batch([
    c.env.DB.prepare(
      `SELECT p.id, p.plan_date, p.centre_id, ce.name AS centre_name, ce.state, ce.weekly_off, p.auditor_id, u.name AS auditor_name, u.home_area,
              p.notes, p.reach_by, p.updated_at,
              (SELECT v.status FROM visits v WHERE v.centre_id = p.centre_id AND v.audit_date = p.plan_date ORDER BY v.id DESC LIMIT 1) AS visit_status,
              (SELECT v.outcome FROM visits v WHERE v.centre_id = p.centre_id AND v.audit_date = p.plan_date ORDER BY v.id DESC LIMIT 1) AS visit_outcome
       FROM plans p JOIN centres ce ON ce.id = p.centre_id LEFT JOIN users u ON u.id = p.auditor_id
       WHERE p.plan_date BETWEEN ? AND ? ORDER BY p.plan_date, ce.name`,
    ).bind(from, to),
    c.env.DB.prepare(
      `SELECT w.week_start, w.locked_at, u.name AS locked_by FROM plan_weeks w LEFT JOIN users u ON u.id = w.locked_by
       WHERE w.week_start BETWEEN ? AND ? AND w.locked_at IS NOT NULL`,
    ).bind(weekOf(from!), to),
  ]);
  return c.json({ rows: rows.results, locked_weeks: weeks.results });
});

app.post('/plans', requireRole('admin', 'planner'), async (c) => {
  const b = await c.req.json<{ plan_date: string; centre_id: number; auditor_id?: number | null; notes?: string; reach_by?: string }>();
  if (b.reach_by && !isTime(b.reach_by)) return bad(c, 'Reach-by time must look like 10:00.');
  if (!isDate(b.plan_date)) return bad(c, 'Choose the date.');
  if (!b.centre_id) return bad(c, 'Choose the centre.');
  if (c.get('user').role === 'planner' && (await weekLocked(c, b.plan_date)))
    return bad(c, 'This week has been approved and locked by the office. Ask them to unlock it.', 409);
  const dup = await c.env.DB.prepare('SELECT id FROM plans WHERE plan_date = ? AND centre_id = ?').bind(b.plan_date, b.centre_id).first();
  if (dup) return bad(c, 'This centre is already planned on that date.', 409);
  const res = await c.env.DB.prepare('INSERT INTO plans (plan_date, centre_id, auditor_id, notes, reach_by, created_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(b.plan_date, b.centre_id, b.auditor_id || null, str(b.notes, 300), b.reach_by || null, c.get('user').id, now())
    .run();
  if (b.auditor_id) await syncPlanAuditor(c, res.meta.last_row_id);
  await allocationNotices(c, res.meta.last_row_id);
  return c.json({ id: res.meta.last_row_id });
});

async function planFor(c: C, id: number) {
  const p = await c.env.DB.prepare('SELECT * FROM plans WHERE id = ?').bind(id).first<{ id: number; plan_date: string; centre_id: number }>();
  if (!p) return bad(c, 'Plan entry not found.', 404);
  if (c.get('user').role === 'planner' && (await weekLocked(c, p.plan_date)))
    return bad(c, 'This week has been approved and locked by the office. Ask them to unlock it.', 409);
  return p;
}

app.patch('/plans/:id', requireRole('admin', 'planner'), async (c) => {
  const p = await planFor(c, Number(c.req.param('id')));
  if (p instanceof Response) return p;
  const b = await c.req.json<Record<string, unknown>>();
  const sets: string[] = ['updated_at = ?'];
  const vals: unknown[] = [now()];
  if ('auditor_id' in b) (sets.push('auditor_id = ?'), vals.push(b.auditor_id || null));
  if ('notes' in b) (sets.push('notes = ?'), vals.push(str(b.notes, 300)));
  if ('reach_by' in b) {
    if (b.reach_by && !isTime(b.reach_by)) return bad(c, 'Reach-by time must look like 10:00.');
    // a new time means new reminders
    sets.push('reach_by = ?', 'reminded_eve_at = NULL', 'reminded_day_at = NULL', 'late_alerted_at = NULL');
    vals.push(b.reach_by || null);
  }
  if ('plan_date' in b) {
    if (!isDate(b.plan_date)) return bad(c, 'Choose the date.');
    if (c.get('user').role === 'planner' && (await weekLocked(c, String(b.plan_date)))) return bad(c, 'That week is locked.', 409);
    sets.push('plan_date = ?');
    vals.push(b.plan_date);
  }
  try {
    await c.env.DB.prepare(`UPDATE plans SET ${sets.join(', ')} WHERE id = ?`).bind(...vals, p.id).run();
  } catch {
    return bad(c, 'This centre is already planned on that date.', 409);
  }
  if ('auditor_id' in b) await syncPlanAuditor(c, p.id);
  await allocationNotices(c, p.id, ('plan_date' in b || 'reach_by' in b) && !('auditor_id' in b && b.auditor_id !== (p as { auditor_id?: number | null }).auditor_id));
  return c.json({ ok: true });
});

app.delete('/plans/:id', requireRole('admin', 'planner'), async (c) => {
  const p = await planFor(c, Number(c.req.param('id')));
  if (p instanceof Response) return p;
  const pp = p as typeof p & { notified_auditor_id: number | null };
  if (pp.notified_auditor_id) {
    const ce = await c.env.DB.prepare('SELECT name FROM centres WHERE id = ?').bind(p.centre_id).first<{ name: string }>();
    await notify(
      c.env,
      [pp.notified_auditor_id],
      { kind: 'allocation', title: `Cancelled: ${ce?.name ?? ''} on ${dmy(p.plan_date)}`, body: 'This audit has been taken off your plan.', link: '/' },
      (x) => c.executionCtx.waitUntil(x),
    );
  }
  await c.env.DB.prepare('DELETE FROM plans WHERE id = ?').bind(p.id).run();
  return c.json({ ok: true });
});

app.post('/plans/week/:week/:action', requireRole('admin'), async (c) => {
  const week = c.req.param('week');
  if (!isDate(week)) return bad(c, 'Invalid week.');
  const start = weekOf(week);
  if (c.req.param('action') === 'lock')
    await c.env.DB.prepare(
      'INSERT INTO plan_weeks (week_start, locked_at, locked_by) VALUES (?, ?, ?) ON CONFLICT(week_start) DO UPDATE SET locked_at = excluded.locked_at, locked_by = excluded.locked_by',
    )
      .bind(start, now(), c.get('user').id)
      .run();
  if (c.req.param('action') === 'lock') {
    const { results } = await c.env.DB.prepare('SELECT id FROM plans WHERE plan_date BETWEEN ? AND date(?, \'+6 day\')').bind(start, start).all<{ id: number }>();
    for (const r of results) await allocationNotices(c, r.id);
    await notify(
      c.env,
      await usersWithRole(c.env, 'planner'),
      { kind: 'plan_live', title: `Plan approved: week of ${dmy(start)}`, body: `${results.length} centre visit${results.length === 1 ? '' : 's'} approved. Auditors have been told their allocations.`, link: '/' },
      (p) => c.executionCtx.waitUntil(p),
    );
  } else if (c.req.param('action') === 'unlock') await c.env.DB.prepare('UPDATE plan_weeks SET locked_at = NULL WHERE week_start = ?').bind(start).run();
  else return bad(c, 'Unknown action.');
  return c.json({ ok: true });
});

// ---------------------------------------------------------------- centre closed / could not audit

app.post('/visits/:id/not-done', requireRole('auditor'), async (c) => {
  const user = c.get('user');
  const v = await c.env.DB.prepare('SELECT * FROM visits WHERE id = ?').bind(Number(c.req.param('id'))).first<Visit & { checkin_at: string | null }>();
  if (!v || v.auditor_id !== user.id) return bad(c, 'This visit is not assigned to you.', 403);
  if (!['assigned', 'returned', 'in_progress'].includes(v.status)) return bad(c, 'This audit has already been submitted.', 409);
  const form = await c.req.formData();
  const reason = str(form.get('reason'), 100);
  const note = str(form.get('note'), 500);
  if (!reason) return bad(c, 'Choose the reason.');
  if (reason === 'Other' && !note) return bad(c, 'Explain what happened.');
  const photo = imageFrom(form);
  if (typeof photo === 'string') return bad(c, 'Take a photo of the storefront as proof.');
  const lat = num(form.get('lat'));
  const lng = num(form.get('lng'));
  if (lat === null || lng === null) return bad(c, 'Turn on location (GPS) – your location is needed as proof.');
  const centre = await c.env.DB.prepare('SELECT lat, lng FROM centres WHERE id = ?').bind(v.centre_id).first<{ lat: number | null; lng: number | null }>();
  const distance = centre?.lat != null && centre?.lng != null ? Math.round(distanceMetres(lat, lng, centre.lat, centre.lng)) : null;
  const key = `visits/${v.id}/storefront-${randomToken(8)}.jpg`;
  await c.env.PHOTOS.put(key, await photo.arrayBuffer(), { httpMetadata: { contentType: photo.type } });
  const at = now();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO photos (visit_id, kind, r2_key, size_bytes, lat, lng, taken_at, uploaded_by) VALUES (?, 'storefront', ?, ?, ?, ?, ?, ?)`,
    ).bind(v.id, key, photo.size, lat, lng, at, user.id),
    c.env.DB.prepare(
      `UPDATE visits SET status = 'submitted', outcome = 'not_done', outcome_reason = ?, submitted_at = ?,
         checkin_at = COALESCE(checkin_at, ?), checkin_lat = COALESCE(checkin_lat, ?), checkin_lng = COALESCE(checkin_lng, ?),
         checkin_distance_m = COALESCE(checkin_distance_m, ?), checkout_at = ?, checkout_lat = ?, checkout_lng = ? WHERE id = ?`,
    ).bind(note ? `${reason} – ${note}` : reason, at, at, lat, lng, distance, at, lat, lng, v.id),
    c.env.DB.prepare('INSERT INTO location_pings (visit_id, user_id, lat, lng, at) VALUES (?, ?, ?, ?, ?)').bind(v.id, user.id, lat, lng, at),
  ]);
  const ce = await c.env.DB.prepare('SELECT name FROM centres WHERE id = ?').bind(v.centre_id).first<{ name: string }>();
  await notify(
    c.env,
    await usersWithRole(c.env, 'admin'),
    { kind: 'not_done', title: `Audit not carried out: ${ce?.name ?? ''}`, body: `${note ? `${reason} – ${note}` : reason} (reported by ${user.name}).`, link: `/visits/${v.id}` },
    (p) => c.executionCtx.waitUntil(p),
  );
  return c.json({ ok: true });
});

// Crash reports from the app's safety net, written to the Cloudflare log (Workers → Logs)
app.post('/client-error', async (c) => {
  const b = await c.req.json<{ message?: string; stack?: string; url?: string }>().catch(() => ({}) as Record<string, string>);
  const user = await currentUser(c).catch(() => null);
  console.error('client-error', JSON.stringify({ user: user?.username, message: String(b.message ?? '').slice(0, 500), url: String(b.url ?? '').slice(0, 300), stack: String(b.stack ?? '').slice(0, 1500) }));
  return c.json({ ok: true });
});

app.notFound((c) => c.json({ error: 'Not found.' }, 404));

// ---------------------------------------------------------------- inventory (book stock vs. last audit)
//
// Book stock = the latest stock statement uploaded for each centre.
// Physical   = the latest audit of that centre (clients: approved audits only; office: submitted or approved).
// It is "as of" those two dates – not real-time.

const auditedStatuses = (role: string) => (role === 'client' ? "('approved')" : "('submitted', 'approved')");

app.get('/inventory/summary', requireRole('admin', 'client'), async (c) => {
  const st = auditedStatuses(c.get('user').role);
  const db = c.env.DB;
  const [centres, accessories] = await db.batch([
    db.prepare(
      `SELECT ce.id, ce.name, ce.state,
              b.id AS book_visit_id, b.audit_date AS book_date,
              (SELECT COUNT(*) FROM tractors t WHERE t.visit_id = b.id AND t.source = 'inventory') AS book_count,
              a.id AS audit_visit_id, a.audit_date AS audit_date, a.status AS audit_status, a.outcome AS audit_outcome,
              (SELECT COUNT(*) FROM tractors t WHERE t.visit_id = a.id AND t.source = 'inventory') AS audit_book_count,
              (SELECT COUNT(*) FROM tractors t WHERE t.visit_id = a.id AND t.status = 'verified') AS verified,
              (SELECT COUNT(*) FROM tractors t WHERE t.visit_id = a.id AND t.status = 'not_found') AS short,
              (SELECT COUNT(*) FROM tractors t WHERE t.visit_id = a.id AND t.source = 'extra') AS extra,
              (SELECT COALESCE(SUM(qty), 0) FROM accessories x WHERE x.visit_id = a.id) AS accessory_qty
       FROM centres ce
       LEFT JOIN visits b ON b.id = (SELECT v.id FROM visits v WHERE v.centre_id = ce.id AND v.upload_id IS NOT NULL ORDER BY v.audit_date DESC, v.id DESC LIMIT 1)
       LEFT JOIN visits a ON a.id = (SELECT v.id FROM visits v WHERE v.centre_id = ce.id AND v.status IN ${st} ORDER BY v.audit_date DESC, v.id DESC LIMIT 1)
       WHERE ce.active = 1 AND (b.id IS NOT NULL OR a.id IS NOT NULL)
       ORDER BY ce.state, ce.name`,
    ),
    db.prepare(
      `SELECT v.centre_id, x.name, x.qty FROM accessories x JOIN visits v ON v.id = x.visit_id
       WHERE v.id IN (SELECT (SELECT v2.id FROM visits v2 WHERE v2.centre_id = ce.id AND v2.status IN ${st} ORDER BY v2.audit_date DESC, v2.id DESC LIMIT 1) FROM centres ce)`,
    ),
  ]);
  return c.json({ centres: centres.results, accessories: accessories.results });
});

/** One centre: each tractor in the latest stock statement with what the latest audit found, plus extras and accessories. */
app.get('/inventory/centre/:id', requireRole('admin', 'client'), async (c) => {
  const id = Number(c.req.param('id'));
  const st = auditedStatuses(c.get('user').role);
  const db = c.env.DB;
  const centre = await db.prepare('SELECT id, name, state, address FROM centres WHERE id = ?').bind(id).first();
  if (!centre) return bad(c, 'Centre not found.', 404);
  const book = await db
    .prepare('SELECT id, audit_date FROM visits WHERE centre_id = ? AND upload_id IS NOT NULL ORDER BY audit_date DESC, id DESC LIMIT 1')
    .bind(id)
    .first<{ id: number; audit_date: string }>();
  const audit = await db
    .prepare(`SELECT * FROM visits WHERE centre_id = ? AND status IN ${st} ORDER BY audit_date DESC, id DESC LIMIT 1`)
    .bind(id)
    .first<Visit & { outcome: string | null }>();
  const [bookRows, auditRows, accessories, locations] = await db.batch([
    db.prepare("SELECT reg_no, engine_no, chassis_no FROM tractors WHERE visit_id = ? AND source = 'inventory' ORDER BY sort_order, id").bind(book?.id ?? 0),
    db.prepare('SELECT * FROM tractors WHERE visit_id = ? ORDER BY source, sort_order, id').bind(audit?.id ?? 0),
    db.prepare('SELECT name, qty, remarks FROM accessories WHERE visit_id = ? ORDER BY id').bind(audit?.id ?? 0),
    db.prepare('SELECT id, name, kind, distance_m FROM visit_locations WHERE visit_id = ?').bind(audit?.id ?? 0),
  ]);
  const audited = audit ? await withPreviousMeter(c, audit, auditRows.results as TractorRow[]) : [];
  return c.json({
    centre,
    book: book ? { visit_id: book.id, date: book.audit_date, tractors: bookRows.results } : null,
    audit: audit ? { visit_id: audit.id, date: audit.audit_date, status: audit.status, outcome: audit.outcome, tractors: audited, locations: locations.results } : null,
    accessories: accessories.results,
  });
});

/** Item-wise: every audit a tractor appears in (by chassis or registration), newest first. */
app.get('/inventory/tractor', requireRole('admin', 'client'), async (c) => {
  const q = idKey(c.req.query('q'));
  if (q.length < 4) return bad(c, 'Type at least 4 letters or digits of the chassis or registration number.');
  const st = auditedStatuses(c.get('user').role);
  const norm = (col: string) => `UPPER(REPLACE(REPLACE(REPLACE(COALESCE(${col}, ''), ' ', ''), '-', ''), '/', ''))`;
  const like = `%${q}%`;
  const { results } = await c.env.DB.prepare(
    `SELECT t.id, t.source, t.status, t.reg_no, t.chassis_no, t.engine_no, t.verified_reg, t.verified_chassis, t.seen_engine,
            t.meter_reading, t.meter_unit, t.location_id, t.remarks, v.id AS visit_id, v.audit_date, v.status AS visit_status,
            ce.name AS centre_name, ce.state, l.name AS location_name
     FROM tractors t JOIN visits v ON v.id = t.visit_id JOIN centres ce ON ce.id = v.centre_id
     LEFT JOIN visit_locations l ON l.id = t.location_id
     WHERE (${norm('t.chassis_no')} LIKE ? OR ${norm('t.verified_chassis')} LIKE ? OR ${norm('t.reg_no')} LIKE ? OR ${norm('t.verified_reg')} LIKE ?)
       AND (v.status IN ${st} OR (t.source = 'inventory' AND v.upload_id IS NOT NULL))
     ORDER BY v.audit_date DESC, v.id DESC LIMIT 200`,
  )
    .bind(like, like, like, like)
    .all<Record<string, unknown> & { visit_status: string; status: string }>();
  // Book-stock rows of audits not yet approved (client) or not yet submitted: show as "in statement", hide the result
  const done = c.get('user').role === 'client' ? ['approved'] : ['submitted', 'approved'];
  return c.json(
    results.map((r) => (done.includes(r.visit_status) ? r : { ...r, status: 'listed', verified_reg: null, verified_chassis: null, seen_engine: null, meter_reading: null, location_name: null })),
  );
});

export default app;
