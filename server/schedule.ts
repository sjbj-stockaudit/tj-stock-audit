// Runs every 15 minutes (Cloudflare cron trigger, see wrangler.toml): reminders, late alerts and the evening summary.
// Only lines of weeks the office has approved & locked are used, so auditors never get draft plans.

import type { Env } from './auth';
import { notify, usersWithRole } from './notify';

export const DEFAULT_REACH_BY = '10:00';
/** Minutes after the reach-by time before someone is "late". */
export const LATE_AFTER_MIN = 30;

const DAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const istParts = (at = new Date()) => {
  const t = new Date(at.getTime() + 5.5 * 3600_000);
  return { date: t.toISOString().slice(0, 10), minutes: t.getUTCHours() * 60 + t.getUTCMinutes() };
};
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);
export const dmy = (d: string) => d.split('-').reverse().join('/');
export const dayName = (d: string) => DAY[new Date(`${d}T00:00:00Z`).getUTCDay()];
const toMin = (hm: string | null) => {
  const [h, m] = (hm || DEFAULT_REACH_BY).split(':').map(Number);
  return h * 60 + m;
};
/** "10:00 AM" */
export const fmtTime = (hm: string | null) => {
  const [h, m] = (hm || DEFAULT_REACH_BY).split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
};
/** Monday of the week (plan weeks run Monday–Sunday). */
export const mondayOf = (d: string) => addDays(d, -((new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7));

type Line = { id: number; plan_date: string; reach_by: string | null; auditor_id: number; auditor_name: string; centre_name: string; centre_id: number };

async function lockedLines(env: Env, date: string, extra = ''): Promise<Line[]> {
  const { results } = await env.DB.prepare(
    `SELECT p.id, p.plan_date, p.reach_by, p.auditor_id, u.name AS auditor_name, ce.name AS centre_name, p.centre_id
     FROM plans p JOIN centres ce ON ce.id = p.centre_id JOIN users u ON u.id = p.auditor_id
     JOIN plan_weeks w ON w.week_start = ? AND w.locked_at IS NOT NULL
     WHERE p.plan_date = ? AND p.auditor_id IS NOT NULL ${extra}`,
  )
    .bind(mondayOf(date), date)
    .all<Line>();
  return results;
}

/** Today's planned lines whose auditor has not checked in by reach-by + 30 min (and did not report the centre closed). */
export async function lateLines(env: Env, date: string, minutes: number, extra = '') {
  const lines = await lockedLines(
    env,
    date,
    `AND NOT EXISTS (SELECT 1 FROM visits v WHERE v.centre_id = p.centre_id AND v.audit_date = p.plan_date AND (v.checkin_at IS NOT NULL OR v.status IN ('submitted', 'approved'))) ${extra}`,
  );
  return lines.filter((l) => minutes >= toMin(l.reach_by) + LATE_AFTER_MIN);
}

export async function runSchedule(env: Env, at = new Date()) {
  const { date, minutes } = istParts(at);
  const stamp = at.toISOString();

  // 7 PM onwards: reminder for tomorrow
  if (minutes >= 19 * 60 && minutes < 23 * 60) {
    const tomorrow = addDays(date, 1);
    for (const l of await lockedLines(env, tomorrow, 'AND p.reminded_eve_at IS NULL')) {
      await notify(env, [l.auditor_id], {
        kind: 'reminder',
        title: `Tomorrow: ${l.centre_name}`,
        body: `Audit on ${dayName(tomorrow)} ${dmy(tomorrow)}. Reach the showroom by ${fmtTime(l.reach_by)}.`,
        link: '/',
      });
      await env.DB.prepare('UPDATE plans SET reminded_eve_at = ? WHERE id = ?').bind(stamp, l.id).run();
    }
  }

  // 8 AM until the reach-by time: reminder for today
  if (minutes >= 8 * 60 && minutes < 12 * 60) {
    for (const l of await lockedLines(env, date, 'AND p.reminded_day_at IS NULL')) {
      if (minutes >= toMin(l.reach_by)) continue;
      await notify(env, [l.auditor_id], {
        kind: 'reminder',
        title: `Today: ${l.centre_name}`,
        body: `Reach the showroom by ${fmtTime(l.reach_by)} and check in at the centre.`,
        link: '/',
      });
      await env.DB.prepare('UPDATE plans SET reminded_day_at = ? WHERE id = ?').bind(stamp, l.id).run();
    }
  }

  // Not checked in 30 min after the reach-by time: auditor, planner and office
  if (minutes < 18 * 60) {
    const late = await lateLines(env, date, minutes, 'AND p.late_alerted_at IS NULL');
    if (late.length) {
      const office = [...(await usersWithRole(env, 'admin')), ...(await usersWithRole(env, 'planner'))];
      for (const l of late) {
        await notify(env, [l.auditor_id], {
          kind: 'late',
          title: `You have not checked in at ${l.centre_name}`,
          body: `You were due by ${fmtTime(l.reach_by)}. Check in as soon as you reach the showroom.`,
          link: '/',
        });
        await notify(env, office, {
          kind: 'late',
          title: `Late: ${l.auditor_name} – ${l.centre_name}`,
          body: `Not checked in yet (due by ${fmtTime(l.reach_by)}).`,
          link: '/',
        });
        await env.DB.prepare('UPDATE plans SET late_alerted_at = ? WHERE id = ?').bind(stamp, l.id).run();
      }
    }
  }

  // 6 PM: one summary of audits waiting for approval
  if (minutes >= 18 * 60) {
    const sent = await env.DB.prepare("SELECT value FROM settings WHERE key = 'digest_date'").first<{ value: string }>();
    if (sent?.value !== date) {
      await env.DB.prepare("INSERT INTO settings (key, value) VALUES ('digest_date', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(date).run();
      const n = (await env.DB.prepare("SELECT COUNT(*) AS n FROM visits WHERE status = 'submitted'").first<{ n: number }>())?.n ?? 0;
      if (n > 0)
        await notify(env, await usersWithRole(env, 'admin'), {
          kind: 'digest',
          title: `${n} audit${n > 1 ? 's' : ''} waiting for your approval`,
          body: 'Open Audits → Awaiting review.',
          link: '/visits',
        });
    }
  }
}
