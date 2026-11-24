import { quickPosition, type Fix } from './geo';

const MAX_SIDE = 1600;
const QUALITY = 0.72;

export type StampedPhoto = { blob: Blob; fix: Fix | null; takenAt: string };

/** Address and map thumbnail for a GPS point (fetched once per ~100 m, then reused). */
type StampInfo = { place: string | null; address: string | null; map: HTMLCanvasElement | null };
const infoCache = new Map<string, Promise<StampInfo>>();

const withTimeout = <T,>(p: Promise<T>, ms: number, fallback: T) =>
  Promise.race([p, new Promise<T>((r) => setTimeout(() => r(fallback), ms))]);

function loadImg(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => resolve(null);
    i.src = src;
  });
}

/** 256×256 OpenStreetMap crop centred on the point (tiles come through our own server). */
async function mapThumb(lat: number, lng: number, z = 17): Promise<HTMLCanvasElement | null> {
  const n = 2 ** z;
  const px = ((lng + 180) / 360) * n * 256;
  const latR = (lat * Math.PI) / 180;
  const py = ((1 - Math.log(Math.tan(latR) + 1 / Math.cos(latR)) / Math.PI) / 2) * n * 256;
  const x0 = px - 128;
  const y0 = py - 128;
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const ctx = c.getContext('2d')!;
  const jobs: Promise<boolean>[] = [];
  for (let tx = Math.floor(x0 / 256); tx <= Math.floor((x0 + 255) / 256); tx++)
    for (let ty = Math.floor(y0 / 256); ty <= Math.floor((y0 + 255) / 256); ty++)
      jobs.push(
        loadImg(`/api/geo/tile/${z}/${tx}/${ty}`).then((img) => {
          if (img) ctx.drawImage(img, tx * 256 - x0, ty * 256 - y0);
          return !!img;
        }),
      );
  const ok = await Promise.all(jobs);
  return ok.some(Boolean) ? c : null;
}

function stampInfo(fix: Fix, lang: string): Promise<StampInfo> {
  const key = `${fix.lat.toFixed(3)},${fix.lng.toFixed(3)},${lang}`;
  let p = infoCache.get(key);
  if (!p) {
    p = Promise.all([
      fetch(`/api/geo/reverse?lat=${fix.lat}&lng=${fix.lng}&lang=${lang}`)
        .then((r) => (r.ok ? r.json() : {}))
        .catch(() => ({})) as Promise<{ place?: string | null; address?: string | null }>,
      mapThumb(fix.lat, fix.lng).catch(() => null),
    ]).then(([g, map]) => ({ place: g.place ?? null, address: g.address ?? null, map }));
    infoCache.set(key, p);
  }
  return p;
}

/** Start getting location, address and map while the camera opens, so the shutter is instant. */
export function prepareStamp(lang = 'en'): Promise<{ fix: Fix | null; info: StampInfo | null }> {
  return quickPosition().then(async (fix) => ({ fix, info: fix ? await withTimeout(stampInfo(fix, lang), 4000, null) : null }));
}

// ------------------------------------------------------------------ drawing

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxW: number, maxLines: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const t = line ? `${line} ${w}` : w;
    if (ctx.measureText(t).width > maxW && line) {
      lines.push(line);
      line = w;
    } else line = t;
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) {
    lines.length = maxLines;
    lines[maxLines - 1] += '…';
  }
  return lines;
}

/** "Tuesday, 24/11/2026 02:40 PM GMT +05:30" in India time */
function stampTime(iso: string) {
  const d = new Date(iso);
  const day = d.toLocaleDateString('en-IN', { weekday: 'long', timeZone: 'Asia/Kolkata' });
  const date = d.toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata' });
  const time = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Kolkata' });
  return `${day}, ${date} ${time} GMT +05:30`;
}

/**
 * GPS-camera style stamp: map thumbnail with a pin on the left; place, full address,
 * Lat/Long, date & time and a note on a dark card; an app badge above it.
 */
function drawStamp(ctx: CanvasRenderingContext2D, w: number, h: number, o: { note: string; fallbackPlace: string; fix: Fix | null; info: StampInfo | null; takenAt: string }) {
  const base = Math.min(w, h);
  const fs = Math.max(13, Math.round(base * 0.032));
  const m = Math.round(base * 0.022);
  const lh = 1.32;
  const font = (px: number, bold = false) => `${bold ? '600 ' : ''}${px}px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`;

  const place = o.info?.place ?? o.fallbackPlace;
  const lines: { text: string; size: number; bold?: boolean }[] = [];
  const mapSizeGuess = fs * 7.2;
  const textX0 = m + mapSizeGuess + m * 0.6;
  const textW = w - textX0 - m - fs;
  ctx.font = font(Math.round(fs * 1.3), true);
  for (const l of wrap(ctx, `${place} 🇮🇳`, textW, 1)) lines.push({ text: l, size: Math.round(fs * 1.3), bold: true });
  ctx.font = font(fs);
  if (o.info?.address) for (const l of wrap(ctx, o.info.address, textW, 2)) lines.push({ text: l, size: fs });
  lines.push({ text: o.fix ? `Lat ${o.fix.lat.toFixed(6)}°  Long ${o.fix.lng.toFixed(6)}°` : 'Location not available', size: fs });
  lines.push({ text: stampTime(o.takenAt), size: fs });
  ctx.font = font(fs);
  for (const l of wrap(ctx, `Note : ${o.note}`, textW, 1)) lines.push({ text: l, size: fs });

  const pad = Math.round(fs * 0.7);
  const textH = lines.reduce((a, l) => a + l.size * lh, 0);
  const cardH = Math.max(mapSizeGuess, textH + pad * 2);
  const cardY = h - m - cardH;
  const mapSize = cardH;
  const r = Math.round(fs * 0.6);

  // Map thumbnail with a red pin
  ctx.save();
  roundRect(ctx, m, cardY, mapSize, mapSize, r);
  ctx.clip();
  if (o.info?.map) ctx.drawImage(o.info.map, m, cardY, mapSize, mapSize);
  else {
    ctx.fillStyle = '#cbd5e1';
    ctx.fillRect(m, cardY, mapSize, mapSize);
  }
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.fillRect(m, cardY + mapSize - fs * 0.85, mapSize, fs * 0.85);
  ctx.fillStyle = '#334155';
  ctx.font = font(Math.round(fs * 0.55));
  ctx.textBaseline = 'middle';
  ctx.fillText(o.info?.map ? '© OpenStreetMap' : 'Map unavailable', m + fs * 0.3, cardY + mapSize - fs * 0.42);
  ctx.restore();
  const cx = m + mapSize / 2;
  const cy = cardY + mapSize / 2;
  const pin = fs * 0.9;
  ctx.fillStyle = '#dc2626';
  ctx.beginPath();
  ctx.arc(cx, cy - pin, pin * 0.6, Math.PI, 0);
  ctx.lineTo(cx, cy);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#7f1d1d';
  ctx.beginPath();
  ctx.arc(cx, cy - pin, pin * 0.25, 0, Math.PI * 2);
  ctx.fill();

  // Text card
  const cardX = m + mapSize + Math.round(m * 0.6);
  const cardW = w - cardX - m;
  ctx.fillStyle = 'rgba(20,20,20,0.62)';
  roundRect(ctx, cardX, cardY, cardW, cardH, r);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'top';
  let y = cardY + pad + (cardH - pad * 2 - textH) / 2;
  for (const l of lines) {
    ctx.font = font(l.size, l.bold);
    ctx.fillText(l.text, cardX + pad, y, cardW - pad * 2);
    y += l.size * lh;
  }

  // App badge above the card, like the camera-app badge
  const label = 'SJBJ Stock Audit';
  ctx.font = font(Math.round(fs * 0.8), true);
  const bw = ctx.measureText(label).width + fs * 2.2;
  const bh = fs * 1.45;
  const bx = w - m - bw;
  const by = cardY - bh - m * 0.4;
  ctx.fillStyle = 'rgba(20,20,20,0.62)';
  roundRect(ctx, bx, by, bw, bh, bh / 2);
  ctx.fill();
  ctx.fillStyle = '#125886';
  roundRect(ctx, bx + fs * 0.45, by + bh * 0.2, bh * 0.6, bh * 0.6, fs * 0.15);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, bx + fs * 1.4, by + bh / 2);
}

/**
 * Freeze the current camera frame immediately, then stamp it with the location/address
 * that was prepared while the camera was opening.
 */
export async function captureVideoFrame(
  video: HTMLVideoElement,
  note: string,
  fallbackPlace: string,
  prepared: Promise<{ fix: Fix | null; info: StampInfo | null }>,
): Promise<StampedPhoto> {
  const w0 = video.videoWidth;
  const h0 = video.videoHeight;
  const scale = Math.min(1, MAX_SIDE / Math.max(w0, h0));
  const w = Math.round(w0 * scale);
  const h = Math.round(h0 * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(video, 0, 0, w, h); // the moment the shutter was pressed
  const takenAt = new Date().toISOString();
  const { fix, info } = await withTimeout(prepared, 8000, { fix: null, info: null });
  drawStamp(ctx, w, h, { note, fallbackPlace, fix, info, takenAt });
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not process the photo.'))), 'image/jpeg', QUALITY),
  );
  return { blob, fix, takenAt };
}
