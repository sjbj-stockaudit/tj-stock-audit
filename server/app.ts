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
import { centreKey, distanceMetres, idKey, isShortMapsLink, parseCoords, type PhotoKind, type Role, type TractorStatus } from '../shared/domain';

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
  await endSession(c);
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
    'SELECT id, username, name, phone, role, team, active, created_at FROM users ORDER BY role, name',
  ).all();
  return c.json(results);
});

app.post('/users', requireRole('admin'), async (c) => {
  const b = await c.req.json<Record<string, string>>();
  const username = str(b.username, 50)?.toLowerCase().replace(/\s+/g, '');
  const name = str(b.name, 100);
  const role = b.role;
  if (!username || !name || !['admin', 'auditor', 'client'].includes(role)) return bad(c, 'Username, name and role are required.');
  if (!b.password || b.password.length < 8) return bad(c, 'The password must be at least 8 characters.');
  const exists = await c.env.DB.prepare('SELECT 1 FROM users WHERE username = ?').bind(username).first();
  if (exists) return bad(c, `The username "${username}" is already taken.`, 409);
  const { hash, salt } = await hashPassword(b.password);
  const res = await c.env.DB.prepare(
    'INSERT INTO users (username, name, phone, role, team, password_hash, password_salt) VALUES (?, ?, ?, ?, ?, ?, ?)',
  )
    .bind(username, name, str(b.phone, 20), role, str(b.team, 100), hash, salt)
    .run();
  return c.json({ id: res.meta.last_row_id });
});

app.patch('/users/:id', requireRole('admin'), async (c) => {
  const id = Number(c.req.param('id'));
  const b = await c.req.json<Record<string, unknown>>();
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const k of ['name', 'phone', 'team'] as const)
    if (k in b) {
      sets.push(`${k} = ?`);
      vals.push(str(b[k], 100));
    }
  if ('role' in b && ['admin', 'auditor', 'client'].includes(String(b.role))) {
    sets.push('role = ?');
    vals.push(b.role);
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

app.get('/visits', requireRole(), async (c) => {
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
    `SELECT v.id, v.audit_date, v.status, v.checkin_at, v.checkout_at, v.submitted_at, v.checkin_distance_m,
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
    .all();
  return c.json(results);
});

app.get('/visits/:id', requireRole(), async (c) => {
  const v = await visitFor(c, Number(c.req.param('id')), 'read');
  if (v instanceof Response) return v;
  const db = c.env.DB;
  const isAdmin = c.get('user').role === 'admin';
  const [visit, tractors, accessories, photos, pings] = await db.batch([
    db.prepare(
      `SELECT v.*, ce.name AS centre_name, ce.state, ce.address, ce.lat, ce.lng, ce.radius_m,
              ce.manager_name AS centre_manager, ce.manager_phone AS centre_manager_phone, ce.opening_hours, ce.weekly_off,
              u.name AS auditor_name, u.phone AS auditor_phone, r.name AS reviewer_name
       FROM visits v JOIN centres ce ON ce.id = v.centre_id
       LEFT JOIN users u ON u.id = v.auditor_id LEFT JOIN users r ON r.id = v.reviewed_by WHERE v.id = ?`,
    ).bind(v.id),
    db.prepare("SELECT * FROM tractors WHERE visit_id = ? ORDER BY source = 'extra', sort_order, id").bind(v.id),
    db.prepare('SELECT * FROM accessories WHERE visit_id = ? ORDER BY id').bind(v.id),
    db.prepare('SELECT id, tractor_id, accessory_id, kind, lat, lng, taken_at FROM photos WHERE visit_id = ? ORDER BY id').bind(v.id),
    db.prepare(isAdmin ? 'SELECT lat, lng, accuracy, at FROM location_pings WHERE visit_id = ? ORDER BY at' : 'SELECT 1 WHERE 0 AND ?').bind(v.id),
  ]);
  const row = visit.results[0] as Record<string, unknown>;
  if (c.get('user').role === 'client') {
    // Staff location data is for the audit firm's internal use only.
    for (const k of ['checkin_lat', 'checkin_lng', 'checkin_accuracy', 'checkin_distance_m', 'checkout_lat', 'checkout_lng', 'review_note'])
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
      has_checkin_selfie: !!v.checkin_selfie_key,
    },
    tractors: tractors.results,
    accessories: accessories.results,
    photos: photos.results,
    pings: pings.results,
  });
});

app.patch('/visits/:id', requireRole('admin'), async (c) => {
  const id = Number(c.req.param('id'));
  const b = await c.req.json<{ auditor_id?: number | null; audit_date?: string }>();
  const sets: string[] = [];
  const vals: unknown[] = [];
  if ('auditor_id' in b) (sets.push('auditor_id = ?'), vals.push(b.auditor_id || null));
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
  const centre = await c.env.DB.prepare('SELECT lat, lng FROM centres WHERE id = ?').bind(v.centre_id).first<{ lat: number | null; lng: number | null }>();
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
  // A returned audit keeps its original check-in so the visit's start time is preserved.
  stmts.push(
    c.env.DB.prepare(
      `UPDATE visits SET status = 'in_progress',
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

// ---------------------------------------------------------------- tractors

async function tractorFor(c: C, id: number) {
  const t = await c.env.DB.prepare('SELECT * FROM tractors WHERE id = ?').bind(id).first<{ id: number; visit_id: number; source: string }>();
  if (!t) return bad(c, 'Tractor not found.', 404);
  const v = await visitFor(c, t.visit_id, 'edit');
  if (v instanceof Response) return v;
  return t;
}

app.patch('/tractors/:id', requireRole('auditor', 'admin'), async (c) => {
  const t = await tractorFor(c, Number(c.req.param('id')));
  if (t instanceof Response) return t;
  const b = await c.req.json<Record<string, unknown>>();
  const allowed: TractorStatus[] = t.source === 'extra' ? ['extra'] : ['pending', 'verified', 'mismatch', 'not_found'];
  const sets: string[] = ['updated_at = ?'];
  const vals: unknown[] = [now()];
  if ('verified_reg' in b) (sets.push('verified_reg = ?'), vals.push(str(b.verified_reg, 40)?.toUpperCase() ?? null));
  if ('verified_chassis' in b) (sets.push('verified_chassis = ?'), vals.push(str(b.verified_chassis, 60)?.toUpperCase() ?? null));
  if ('remarks' in b) (sets.push('remarks = ?'), vals.push(str(b.remarks, 1000)));
  if ('status' in b) {
    if (!allowed.includes(b.status as TractorStatus)) return bad(c, 'Invalid status.');
    sets.push('status = ?');
    vals.push(b.status);
  }
  if (t.source === 'extra') {
    if ('reg_no' in b) (sets.push('reg_no = ?'), vals.push(str(b.reg_no, 40)?.toUpperCase() ?? null));
    if ('chassis_no' in b) (sets.push('chassis_no = ?'), vals.push(str(b.chassis_no, 60)?.toUpperCase() ?? null));
  }
  await c.env.DB.prepare(`UPDATE tractors SET ${sets.join(', ')} WHERE id = ?`).bind(...vals, t.id).run();
  return c.json(await c.env.DB.prepare('SELECT * FROM tractors WHERE id = ?').bind(t.id).first());
});

app.post('/visits/:id/tractors', requireRole('auditor', 'admin'), async (c) => {
  const v = await visitFor(c, Number(c.req.param('id')), 'edit');
  if (v instanceof Response) return v;
  const b = await c.req.json<Record<string, unknown>>();
  const reg = str(b.reg_no, 40)?.toUpperCase() ?? null;
  const chassis = str(b.chassis_no, 60)?.toUpperCase() ?? null;
  if (!reg && !chassis) return bad(c, 'Enter the registration number or the chassis number.');
  const res = await c.env.DB.prepare(
    `INSERT INTO tractors (visit_id, source, sort_order, reg_no, chassis_no, verified_reg, verified_chassis, status, remarks, updated_at)
     VALUES (?, 'extra', 100000, ?, ?, ?, ?, 'extra', ?, ?)`,
  )
    .bind(v.id, reg, chassis, reg, chassis, str(b.remarks, 1000), now())
    .run();
  return c.json(await c.env.DB.prepare('SELECT * FROM tractors WHERE id = ?').bind(res.meta.last_row_id).first());
});

app.delete('/tractors/:id', requireRole('auditor', 'admin'), async (c) => {
  const t = await tractorFor(c, Number(c.req.param('id')));
  if (t instanceof Response) return t;
  if (t.source !== 'extra') return bad(c, 'Only tractors you added as extra can be removed.');
  await deletePhotos(c, 'tractor_id = ?', t.id);
  await c.env.DB.prepare('DELETE FROM tractors WHERE id = ?').bind(t.id).run();
  return c.json({ ok: true });
});

// ---------------------------------------------------------------- accessories

async function accessoryFor(c: C, id: number) {
  const a = await c.env.DB.prepare('SELECT * FROM accessories WHERE id = ?').bind(id).first<{ id: number; visit_id: number }>();
  if (!a) return bad(c, 'Accessory not found.', 404);
  const v = await visitFor(c, a.visit_id, 'edit');
  if (v instanceof Response) return v;
  return a;
}

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
  const kind = String(form.get('kind') ?? 'other') as PhotoKind;
  if (!['chassis', 'tractor', 'accessory', 'other'].includes(kind)) return bad(c, 'Invalid photo type.');
  const tractorId = num(form.get('tractor_id'));
  const accessoryId = num(form.get('accessory_id'));
  if (tractorId) {
    const t = await c.env.DB.prepare('SELECT 1 FROM tractors WHERE id = ? AND visit_id = ?').bind(tractorId, v.id).first();
    if (!t) return bad(c, 'Tractor not found in this visit.');
  }
  if (accessoryId) {
    const a = await c.env.DB.prepare('SELECT 1 FROM accessories WHERE id = ? AND visit_id = ?').bind(accessoryId, v.id).first();
    if (!a) return bad(c, 'Accessory not found in this visit.');
  }
  const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
  const key = `visits/${v.id}/${kind}-${randomToken(8)}.${ext}`;
  await c.env.PHOTOS.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type } });
  const takenAt = String(form.get('taken_at') ?? '');
  const res = await c.env.DB.prepare(
    `INSERT INTO photos (visit_id, tractor_id, accessory_id, kind, r2_key, size_bytes, lat, lng, taken_at, uploaded_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      v.id,
      tractorId,
      accessoryId,
      kind,
      key,
      file.size,
      num(form.get('lat')),
      num(form.get('lng')),
      takenAt && !isNaN(Date.parse(takenAt)) ? new Date(takenAt).toISOString() : now(),
      c.get('user').id,
    )
    .run();
  return c.json(
    await c.env.DB.prepare('SELECT id, tractor_id, accessory_id, kind, lat, lng, taken_at FROM photos WHERE id = ?')
      .bind(res.meta.last_row_id)
      .first(),
  );
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

app.get('/visits/:id/checkin-selfie', requireRole(), async (c) => {
  const v = await visitFor(c, Number(c.req.param('id')), 'read');
  if (v instanceof Response) return v;
  return serveObject(c, v.checkin_selfie_key);
});

// ---------------------------------------------------------------- submit & review

/** Everything the client's deliverables need, checked before an audit can be submitted. */
async function submissionProblems(c: C, visitId: number, v: Visit): Promise<string[]> {
  const db = c.env.DB;
  const [{ results: tractors }, { results: accessories }, { results: photos }] = await db.batch([
    db.prepare('SELECT id, reg_no, chassis_no, status FROM tractors WHERE visit_id = ?').bind(visitId),
    db.prepare('SELECT id, name FROM accessories WHERE visit_id = ?').bind(visitId),
    db.prepare('SELECT tractor_id, accessory_id, kind FROM photos WHERE visit_id = ?').bind(visitId),
  ]);
  type T = { id: number; reg_no: string | null; chassis_no: string | null; status: string };
  type P = { tractor_id: number | null; accessory_id: number | null; kind: string };
  const ph = photos as P[];
  const problems: string[] = [];
  const pending = (tractors as T[]).filter((t) => t.status === 'pending');
  if (pending.length) problems.push(`${pending.length} tractor(s) have not been checked yet.`);
  const noPhoto = (tractors as T[]).filter(
    (t) => t.status !== 'pending' && t.status !== 'not_found' && !ph.some((p) => p.tractor_id === t.id && p.kind === 'chassis'),
  );
  if (noPhoto.length)
    problems.push(`Chassis photo missing for: ${noPhoto.slice(0, 5).map((t) => t.reg_no || t.chassis_no).join(', ')}${noPhoto.length > 5 ? '…' : ''}`);
  const noTractorPhoto = (tractors as T[]).filter(
    (t) => t.status !== 'pending' && t.status !== 'not_found' && !ph.some((p) => p.tractor_id === t.id && p.kind === 'tractor'),
  );
  if (noTractorPhoto.length)
    problems.push(
      `Tractor photo missing for: ${noTractorPhoto.slice(0, 5).map((t) => t.reg_no || t.chassis_no).join(', ')}${noTractorPhoto.length > 5 ? '…' : ''}`,
    );
  const accNoPhoto = (accessories as { id: number; name: string }[]).filter((a) => !ph.some((p) => p.accessory_id === a.id));
  if (accNoPhoto.length) problems.push(`Photo missing for accessories: ${accNoPhoto.map((a) => a.name).join(', ')}`);
  if (!v.auditor_signature_key) problems.push('Auditor signature is missing.');
  if (!v.manager_signature_key) problems.push("Outlet manager's signature is missing.");
  return problems;
}

app.post('/visits/:id/submit', requireRole('auditor'), async (c) => {
  const v = await visitFor(c, Number(c.req.param('id')), 'edit');
  if (v instanceof Response) return v;
  const b = await c.req.json<{ manager_name?: string; general_remarks?: string; lat?: number; lng?: number }>();
  const manager = str(b.manager_name, 100);
  const problems = await submissionProblems(c, v.id, v);
  if (!manager) problems.push("Enter the outlet manager's name.");
  if (problems.length) return c.json({ error: 'The audit is not complete yet.', problems }, 400);
  const at = now();
  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE visits SET status = 'submitted', manager_name = ?, general_remarks = ?, submitted_at = ?,
         checkout_at = ?, checkout_lat = ?, checkout_lng = ? WHERE id = ?`,
    ).bind(manager, str(b.general_remarks, 2000), at, at, num(b.lat), num(b.lng), v.id),
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
    await c.env.DB.prepare(
      "UPDATE visits SET status = 'returned', reviewed_at = ?, reviewed_by = ?, review_note = ?, submitted_at = NULL WHERE id = ?",
    )
      .bind(now(), user.id, str(b.note, 1000), id)
      .run();
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
    `SELECT v.id AS visit_id, v.audit_date, v.checkin_at, v.checkout_at, v.status, v.checkin_distance_m,
            ce.name AS centre_name, ce.state, u.id AS auditor_id, u.name AS auditor_name, u.username, u.team, u.phone,
            (SELECT COUNT(*) FROM tractors t WHERE t.visit_id = v.id) AS tractor_count
     FROM visits v JOIN centres ce ON ce.id = v.centre_id JOIN users u ON u.id = v.auditor_id
     WHERE substr(v.audit_date, 1, 7) = ? AND v.status IN ('approved', 'submitted')
     ORDER BY u.name, v.audit_date, ce.name`,
  )
    .bind(month)
    .all();
  return c.json({ month, visits: results });
});

app.notFound((c) => c.json({ error: 'Not found.' }, 404));

export default app;
