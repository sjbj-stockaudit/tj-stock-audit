import type { Context, MiddlewareHandler } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { Role } from '../shared/domain';

export type Env = { DB: D1Database; PHOTOS: R2Bucket };
export type SessionUser = { id: number; username: string; name: string; role: Role; token: string; selfie_done: number };
export type AppEnv = { Bindings: Env; Variables: { user: SessionUser } };

const COOKIE = 'tj_session';
const SESSION_DAYS = 30;
// Kept modest so a login fits within the Cloudflare free plan's per-request CPU budget.
const PBKDF2_ITERATIONS = 20000;

const toHex = (buf: ArrayBuffer | Uint8Array) =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const fromHex = (hex: string) => new Uint8Array(hex.match(/.{2}/g)!.map((h) => parseInt(h, 16)));

export function randomToken(bytes = 32): string {
  return toHex(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function hashPassword(password: string, saltHex?: string): Promise<{ hash: string; salt: string }> {
  const salt = saltHex ? fromHex(saltHex) : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITERATIONS },
    key,
    256,
  );
  return { hash: toHex(bits), salt: toHex(salt) };
}

export async function verifyPassword(password: string, hash: string, salt: string): Promise<boolean> {
  const { hash: candidate } = await hashPassword(password, salt);
  if (candidate.length !== hash.length) return false;
  let diff = 0;
  for (let i = 0; i < hash.length; i++) diff |= candidate.charCodeAt(i) ^ hash.charCodeAt(i);
  return diff === 0;
}

export async function startSession(c: Context<AppEnv>, userId: number, role: Role): Promise<void> {
  const token = randomToken();
  void role; // all logins last 30 days (the selfie is taken at each check-in instead of at sign-in)
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000);
  await c.env.DB.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)')
    .bind(token, userId, expires.toISOString())
    .run();
  const secure = new URL(c.req.url).protocol === 'https:';
  setCookie(c, COOKIE, token, { httpOnly: true, secure, sameSite: 'Lax', path: '/', expires });
}

export async function endSession(c: Context<AppEnv>): Promise<void> {
  const token = getCookie(c, COOKIE);
  if (token) await c.env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
  deleteCookie(c, COOKIE, { path: '/' });
}

export async function currentUser(c: Context<AppEnv>): Promise<SessionUser | null> {
  const token = getCookie(c, COOKIE);
  if (!token) return null;
  return c.env.DB.prepare(
    `SELECT u.id, u.username, u.name, CASE WHEN u.access = 'planner' THEN 'planner' ELSE u.role END AS role, s.token, 1 AS selfie_done
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token = ? AND s.expires_at > ? AND u.active = 1`,
  )
    .bind(token, new Date().toISOString())
    .first<SessionUser>();
}

/**
 * Require a signed-in user with one of the given roles.
 * Auditors must also have taken their sign-in selfie (except on routes that take it).
 */
export function requireRole(...roles: Role[]): MiddlewareHandler<AppEnv> {
  return guard(roles, false);
}

/** Signed in, selfie not needed yet (used to upload the selfie itself). */
export const requireSignedIn: MiddlewareHandler<AppEnv> = guard([], true);

function guard(roles: Role[], allowPendingSelfie: boolean): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const user = await currentUser(c);
    if (!user) return c.json({ error: 'Please sign in again.' }, 401);
    if (roles.length && !roles.includes(user.role)) return c.json({ error: 'You do not have access to this.' }, 403);
    if (user.role === 'auditor' && !user.selfie_done && !allowPendingSelfie)
      return c.json({ error: 'Take your sign-in selfie first.', code: 'selfie_required' }, 403);
    c.set('user', user);
    await next();
  };
}
