import { getPosition, type Fix } from './geo';
import { fmtDateTime } from './format';

const MAX_SIDE = 1600;
const QUALITY = 0.72;

export type StampedPhoto = { blob: Blob; fix: Fix | null; takenAt: string };

/** Draw an image onto a canvas (max 1600 px), burn in a GPS/time stamp, and encode as JPEG. */
async function stampAndEncode(img: CanvasImageSource, w0: number, h0: number, title: string, place: string, fix: Fix | null): Promise<StampedPhoto> {
  const scale = Math.min(1, MAX_SIDE / Math.max(w0, h0));
  const w = Math.round(w0 * scale);
  const h = Math.round(h0 * scale);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0, w, h);

  const takenAt = new Date().toISOString();
  const lines = [
    title,
    place,
    `${fmtDateTime(takenAt)} IST`,
    fix ? `Lat ${fix.lat.toFixed(6)}°  Long ${fix.lng.toFixed(6)}°  (±${Math.round(fix.accuracy)} m)` : 'Location unavailable',
  ].filter(Boolean);
  const fs = Math.max(14, Math.round(w / 40));
  const pad = Math.round(fs * 0.6);
  const bandH = lines.length * fs * 1.3 + pad * 2;
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  ctx.fillRect(0, h - bandH, w, bandH);
  ctx.fillStyle = '#fff';
  ctx.textBaseline = 'top';
  lines.forEach((line, i) => {
    ctx.font = `${i === 0 ? 'bold ' : ''}${fs}px system-ui, sans-serif`;
    ctx.fillText(line, pad, h - bandH + pad + i * fs * 1.3, w - pad * 2);
  });

  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not process the photo.'))), 'image/jpeg', QUALITY),
  );
  return { blob, fix, takenAt };
}

/** Grab the current frame of a live camera <video> and stamp it. */
export async function captureVideoFrame(video: HTMLVideoElement, title: string, place: string): Promise<StampedPhoto> {
  const fix = await getPosition(10000).catch(() => null);
  return stampAndEncode(video, video.videoWidth, video.videoHeight, title, place, fix);
}
