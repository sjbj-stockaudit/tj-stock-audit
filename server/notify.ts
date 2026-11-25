// Notifications: an in-app list for every user, plus phone alerts through Firebase Cloud Messaging
// when the FCM_SERVICE_ACCOUNT secret is set in Cloudflare (Workers → tj-stock-audit → Settings → Variables and Secrets).

import type { Env } from './auth';

export type Note = { kind: string; title: string; body?: string; link?: string };

/** Store the notification for each user and push it to their phones. */
export async function notify(env: Env, userIds: (number | null | undefined)[], n: Note, wait?: (p: Promise<unknown>) => void) {
  const ids = [...new Set(userIds.filter((x): x is number => !!x))];
  if (!ids.length) return;
  const at = new Date().toISOString();
  await env.DB.batch(
    ids.map((id) =>
      env.DB.prepare('INSERT INTO notifications (user_id, kind, title, body, link, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(id, n.kind, n.title, n.body ?? null, n.link ?? null, at),
    ),
  );
  const p = push(env, ids, n).catch((e) => console.error('push failed', e));
  if (wait) wait(p);
  else await p;
}

/** Users with a given role (admins, planners). */
export async function usersWithRole(env: Env, role: 'admin' | 'planner'): Promise<number[]> {
  const sql =
    role === 'planner'
      ? "SELECT id FROM users WHERE access = 'planner' AND active = 1"
      : "SELECT id FROM users WHERE role = 'admin' AND active = 1";
  const { results } = await env.DB.prepare(sql).all<{ id: number }>();
  return results.map((r) => r.id);
}

// ------------------------------------------------------------------ Firebase Cloud Messaging (HTTP v1)

type ServiceAccount = { project_id: string; client_email: string; private_key: string };
let tokenCache: { token: string; exp: number; email: string } | null = null;

export function pushEnabled(env: Env) {
  return !!env.FCM_SERVICE_ACCOUNT;
}

function account(env: Env): ServiceAccount | null {
  if (!env.FCM_SERVICE_ACCOUNT) return null;
  try {
    const a = JSON.parse(env.FCM_SERVICE_ACCOUNT) as ServiceAccount;
    return a.project_id && a.client_email && a.private_key ? a : null;
  } catch {
    console.error('FCM_SERVICE_ACCOUNT is not valid JSON');
    return null;
  }
}

const b64url = (data: ArrayBuffer | Uint8Array | string) =>
  btoa(typeof data === 'string' ? data : String.fromCharCode(...new Uint8Array(data)))
    .replace(/=+$/, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

/** OAuth access token for FCM, from a JWT signed with the service account key. */
async function accessToken(a: ServiceAccount): Promise<string> {
  const nowS = Math.floor(Date.now() / 1000);
  if (tokenCache && tokenCache.email === a.client_email && tokenCache.exp > nowS + 60) return tokenCache.token;
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(
    JSON.stringify({ iss: a.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: 'https://oauth2.googleapis.com/token', iat: nowS, exp: nowS + 3600 }),
  );
  const pem = a.private_key.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(pem), (ch) => ch.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(`${header}.${claims}`));
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${header}.${claims}.${b64url(sig)}`,
  });
  if (!res.ok) throw new Error(`FCM auth failed: ${res.status} ${await res.text()}`);
  const j = (await res.json()) as { access_token: string; expires_in: number };
  tokenCache = { token: j.access_token, exp: nowS + j.expires_in, email: a.client_email };
  return j.access_token;
}

async function push(env: Env, userIds: number[], n: Note) {
  const a = account(env);
  if (!a) return;
  const { results } = await env.DB.prepare(`SELECT token FROM device_tokens WHERE user_id IN (${userIds.map(() => '?').join(',')})`)
    .bind(...userIds)
    .all<{ token: string }>();
  if (!results.length) return;
  const bearer = await accessToken(a);
  await Promise.all(
    results.map(async ({ token }) => {
      const res = await fetch(`https://fcm.googleapis.com/v1/projects/${a.project_id}/messages:send`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: {
            token,
            notification: { title: n.title, body: n.body ?? '' },
            data: { link: n.link ?? '/', kind: n.kind },
            android: { priority: 'high', notification: { channel_id: 'alerts', sound: 'default' } },
          },
        }),
      });
      // Phone uninstalled the app / token expired: forget it
      if (res.status === 404 || res.status === 400) {
        const t = await res.text();
        if (/UNREGISTERED|INVALID_ARGUMENT|not a valid FCM registration token/i.test(t)) await env.DB.prepare('DELETE FROM device_tokens WHERE token = ?').bind(token).run();
      }
    }),
  );
}
