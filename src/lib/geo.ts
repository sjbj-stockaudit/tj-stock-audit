import { api } from './api';

export type Fix = { lat: number; lng: number; accuracy: number; at: string };

/** Most recent GPS reading from any source (check-in, tracking, camera). */
let lastFix: Fix | null = null;
const remember = (f: Fix) => ((lastFix = f), f);

/** One GPS reading. Rejects with a readable message if location is off or denied. */
export function getPosition(timeoutMs = 20000): Promise<Fix> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) return reject(new Error('This phone does not support GPS location.'));
    navigator.geolocation.getCurrentPosition(
      (p) =>
        resolve(remember({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, at: new Date(p.timestamp).toISOString() })),
      (err) =>
        reject(
          new Error(
            err.code === err.PERMISSION_DENIED
              ? 'Location permission is blocked. Allow location for this app in your phone settings.'
              : 'Could not get your location. Turn on GPS and step outside if you are indoors.',
          ),
        ),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 30000 },
    );
  });
}

// ------------------------------------------------------------------ tracking between check-in and check-out

type NativeBgGeo = {
  addWatcher(
    options: Record<string, unknown>,
    cb: (loc?: { latitude: number; longitude: number; accuracy: number; time: number | null }, err?: unknown) => void,
  ): Promise<string> | string; // the Android bridge returns the watcher id directly for callback-style methods
  removeWatcher(o: { id: string }): Promise<void> | void;
};

function nativeBackgroundGeolocation(): NativeBgGeo | null {
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean; Plugins?: Record<string, unknown> } }).Capacitor;
  if (!cap?.isNativePlatform?.()) return null;
  return (cap.Plugins?.BackgroundGeolocation as NativeBgGeo) ?? null;
}

/**
 * A recent location without waiting: the last reading if it is under a minute old,
 * otherwise a quick new reading (accepting one up to 30 s old). Null if location is unavailable.
 */
export async function quickPosition(): Promise<Fix | null> {
  if (lastFix && Date.now() - Date.parse(lastFix.at) < 60_000) return lastFix;
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(lastFix);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve(remember({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, at: new Date(p.timestamp).toISOString() })),
      () => resolve(lastFix),
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 30000 },
    );
  });
}

const FLUSH_MS = 2 * 60_000; // send at most every 2 minutes
const MIN_GAP_MS = 60_000; // keep at most one point a minute
const BUFFER_KEY = 'tj_ping_buffer';

class Tracker {
  private visitId: number | null = null;
  private stopFn: (() => void) | null = null;
  private timer: number | null = null;
  private lastKept = 0;

  start(visitId: number) {
    if (this.visitId === visitId) return;
    this.stop();
    this.visitId = visitId;
    // Tracking must never break the audit screen: any failure falls back to browser GPS.
    if (!this.startNative()) this.startBrowser();
    this.timer = window.setInterval(() => this.flush(), FLUSH_MS);
  }

  /** Android app: keeps tracking with the screen off (shows a notification while active). */
  private startNative(): boolean {
    const native = nativeBackgroundGeolocation();
    if (!native) return false;
    try {
      let id: string | null = null;
      const ret = native.addWatcher(
        {
          backgroundMessage: 'Recording your location until you check out.',
          backgroundTitle: 'Stock audit in progress',
          requestPermissions: true,
          stale: false,
          distanceFilter: 25,
        },
        (loc) => loc && this.add({ lat: loc.latitude, lng: loc.longitude, accuracy: loc.accuracy, at: new Date(loc.time ?? Date.now()).toISOString() }),
      );
      // Depending on the bridge, the id comes back directly or as a promise.
      Promise.resolve(ret)
        .then((w) => (id = typeof w === 'string' ? w : null))
        .catch(() => undefined);
      this.stopFn = () => {
        try {
          if (id) void Promise.resolve(native.removeWatcher({ id })).catch(() => undefined);
        } catch {
          /* ignore */
        }
      };
      return true;
    } catch {
      return false;
    }
  }

  /** Browser: works while the app is open on screen. */
  private startBrowser() {
    if (navigator.geolocation) {
      // Browser: works while the app is open on screen.
      const w = navigator.geolocation.watchPosition(
        (p) => this.add({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy, at: new Date(p.timestamp).toISOString() }),
        () => undefined,
        { enableHighAccuracy: true, maximumAge: 60000 },
      );
      this.stopFn = () => navigator.geolocation.clearWatch(w);
    }
  }

  stop() {
    this.stopFn?.();
    this.stopFn = null;
    if (this.timer) window.clearInterval(this.timer);
    this.timer = null;
    void this.flush();
    this.visitId = null;
  }

  private add(fix: Fix) {
    remember(fix);
    const t = Date.parse(fix.at);
    if (t - this.lastKept < MIN_GAP_MS) return;
    this.lastKept = t;
    const buf = readBuffer();
    buf.push({ ...fix, visitId: this.visitId! });
    writeBuffer(buf.slice(-500));
  }

  async flush() {
    const buf = readBuffer();
    if (!buf.length) return;
    const byVisit = new Map<number, Fix[]>();
    for (const p of buf) byVisit.set(p.visitId, [...(byVisit.get(p.visitId) ?? []), p]);
    for (const [visitId, points] of byVisit) {
      try {
        await api.post(`/visits/${visitId}/pings`, { points });
        writeBuffer(readBuffer().filter((p) => p.visitId !== visitId || !points.some((q) => q.at === p.at)));
      } catch {
        // offline: keep the points and try again on the next flush
      }
    }
  }
}

type Buffered = Fix & { visitId: number };
function readBuffer(): Buffered[] {
  try {
    return JSON.parse(localStorage.getItem(BUFFER_KEY) ?? '[]');
  } catch {
    return [];
  }
}
function writeBuffer(b: Buffered[]) {
  try {
    localStorage.setItem(BUFFER_KEY, JSON.stringify(b));
  } catch {
    /* storage unavailable */
  }
}

export const tracker = new Tracker();

// ------------------------------------------------------------------ keep the screen on during an audit

type WakeLockSentinelLike = { release: () => Promise<void> };
let wakeLock: WakeLockSentinelLike | null = null;
let wakeWanted = false;

async function requestWake() {
  try {
    const wl = (navigator as unknown as { wakeLock?: { request: (t: 'screen') => Promise<WakeLockSentinelLike> } }).wakeLock;
    if (wakeWanted && wl && document.visibilityState === 'visible') wakeLock = await wl.request('screen');
  } catch {
    /* not supported or refused (e.g. battery saver) – the audit still works */
  }
}
const onVisible = () => void requestWake(); // the lock is released when the app goes to the background

/** Stop the phone auto-locking while an audit is open, so location keeps being recorded. */
export function keepScreenOn(on: boolean) {
  wakeWanted = on;
  if (on) {
    void requestWake();
    document.addEventListener('visibilitychange', onVisible);
  } else {
    document.removeEventListener('visibilitychange', onVisible);
    void wakeLock?.release().catch(() => undefined);
    wakeLock = null;
  }
}

// ------------------------------------------------------------------ Android app settings (battery / location)

type CapLike = { isNativePlatform?: () => boolean; getPlatform?: () => string; Plugins?: Record<string, unknown> };
const cap = () => (window as unknown as { Capacitor?: CapLike }).Capacitor;

/** True inside the installed Android app (not a browser). */
export const isAndroidApp = () => !!cap()?.isNativePlatform?.() && cap()?.getPlatform?.() !== 'ios';

/** Open this app's settings page, where battery saver and "Allow all the time" location are set. */
export async function openAppSettings(): Promise<boolean> {
  try {
    const ns = cap()?.Plugins?.NativeSettings as { openAndroid?: (o: { option: string }) => unknown } | undefined;
    if (!ns?.openAndroid) return false;
    await Promise.resolve(ns.openAndroid({ option: 'application_details' }));
    return true;
  } catch {
    return false;
  }
}
