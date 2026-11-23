const TZ = 'Asia/Kolkata';

/** Today's date in India as YYYY-MM-DD. */
export function todayIST(offsetDays = 0): string {
  const d = new Date(Date.now() + offsetDays * 86400_000);
  return d.toLocaleDateString('en-CA', { timeZone: TZ });
}

/** Monday and Sunday of the week containing the given date. */
export function weekRange(date = todayIST()): { from: string; to: string } {
  const d = new Date(`${date}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
  const mon = new Date(d.getTime() - dow * 86400_000);
  const sun = new Date(mon.getTime() + 6 * 86400_000);
  return { from: mon.toISOString().slice(0, 10), to: sun.toISOString().slice(0, 10) };
}

/** 2026-11-23 -> 23/11/2026 */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString('en-IN', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: true });
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-IN', {
    timeZone: TZ,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  });
}

export function fmtDistance(m: number | null | undefined): string {
  if (m === null || m === undefined) return '—';
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(1)} km`;
}

export function hoursBetween(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  return Math.max(0, (Date.parse(b) - Date.parse(a)) / 3600_000);
}

export function fmtHours(h: number | null): string {
  if (h === null) return '—';
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  return `${hh}h ${String(mm).padStart(2, '0')}m`;
}

/** Make a string safe for use as a file name. */
export function safeName(s: string): string {
  return s.replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, '_').slice(0, 80) || 'file';
}

export function mapsLink(lat: number | null, lng: number | null, address?: string | null, name?: string): string {
  if (lat != null && lng != null) return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
  const q = [name, address, 'Madhya Pradesh'].filter(Boolean).join(', ');
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(q)}`;
}
