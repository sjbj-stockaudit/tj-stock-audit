import { useEffect, useRef, useState } from 'react';
import { captureVideoFrame, prepareStamp, type StampedPhoto } from '../lib/camera';

// The camera stays on for a short while after a photo, so the next photo opens instantly.
const KEEP_WARM_MS = 45_000;
let warm: { facing: string; stream: MediaStream; timer: number | null } | null = null;

function releaseLater(facing: string, stream: MediaStream) {
  if (warm && warm.stream !== stream) warm.stream.getTracks().forEach((t) => t.stop());
  if (warm?.timer) clearTimeout(warm.timer);
  warm = {
    facing,
    stream,
    timer: window.setTimeout(() => {
      stream.getTracks().forEach((t) => t.stop());
      if (warm?.stream === stream) warm = null;
    }, KEEP_WARM_MS),
  };
}

function takeWarm(facing: string): MediaStream | null {
  if (!warm || warm.facing !== facing || !warm.stream.getVideoTracks().some((t) => t.readyState === 'live')) return null;
  if (warm.timer) clearTimeout(warm.timer);
  const s = warm.stream;
  warm = null;
  return s;
}
import { Button } from './ui';

/**
 * In-app live camera. Uses the camera stream directly (no file picker), so a saved or
 * gallery photo can never be submitted instead of a photo taken on the spot.
 * facing="user" for selfies (front camera), "environment" for tractors and chassis plates.
 */
export default function LiveCamera({
  facing,
  title,
  place,
  onConfirm,
  onCancel,
  confirmLabel,
  captureLabel,
  busy,
}: {
  facing: 'user' | 'environment';
  title: string;
  place: string;
  onConfirm: (photo: StampedPhoto) => void;
  onCancel?: () => void;
  confirmLabel: string;
  captureLabel: string;
  busy?: boolean;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shot, setShot] = useState<{ photo: StampedPhoto; url: string } | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [torch, setTorch] = useState<boolean | null>(null); // null = phone has no torch control
  const front = facing === 'user';
  // Location, address and map are fetched while the camera opens – not after the shutter.
  const prepared = useRef(prepareStamp());

  async function start() {
    setError(null);
    setReady(false);
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('unsupported');
      const s =
        takeWarm(facing) ??
        (await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: facing }, width: { ideal: front ? 1280 : 1920 }, height: { ideal: front ? 960 : 1440 } },
          audio: false,
        }));
      stream.current = s;
      const track = s.getVideoTracks()[0];
      const caps = (track.getCapabilities?.() ?? {}) as MediaTrackCapabilities & { torch?: boolean; focusMode?: string[] };
      if (!front && caps.focusMode?.includes('continuous'))
        await track.applyConstraints({ advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet] }).catch(() => undefined);
      setTorch(!front && caps.torch ? false : null);
      if (video.current) {
        video.current.srcObject = s;
        await video.current.play().catch(() => undefined);
      }
      setReady(true);
    } catch (e) {
      const name = (e as DOMException).name;
      setError(
        name === 'NotAllowedError'
          ? 'Camera permission is blocked. Allow camera access for this app in your phone settings, then try again.'
          : `Could not open the ${front ? 'front' : 'back'} camera on this device.`,
      );
    }
  }

  /** Keep the camera warm briefly instead of switching it off (it switches off by itself). */
  function stop() {
    if (stream.current) releaseLater(facing, stream.current);
    stream.current = null;
  }

  useEffect(() => {
    void start();
    return stop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function toggleTorch() {
    const track = stream.current?.getVideoTracks()[0];
    if (!track || torch === null) return;
    await track.applyConstraints({ advanced: [{ torch: !torch } as MediaTrackConstraintSet] }).catch(() => undefined);
    setTorch(!torch);
  }

  async function capture() {
    if (!video.current) return;
    setCapturing(true);
    try {
      const photo = await captureVideoFrame(video.current, title, `${place}, India`, prepared.current);
      setShot({ photo, url: URL.createObjectURL(photo.blob) });
      stop();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setCapturing(false);
    }
  }

  function retake() {
    if (shot) URL.revokeObjectURL(shot.url);
    setShot(null);
    prepared.current = prepareStamp();
    void start();
  }

  return (
    <div className="space-y-3">
      <div className={`relative mx-auto w-full overflow-hidden rounded-2xl bg-slate-900 ${front ? 'aspect-[3/4] max-w-xs' : 'aspect-[3/4] max-w-md'}`}>
        {shot ? (
          <img src={shot.url} alt="Photo taken" className="h-full w-full object-contain" />
        ) : (
          <video
            ref={video}
            playsInline
            muted
            // Selfie preview is mirrored like a mirror; the saved photo is not. Back camera shows the full frame that will be saved.
            className={`h-full w-full ${front ? '-scale-x-100 object-cover' : 'object-contain'}`}
            aria-label={front ? 'Front camera preview' : 'Camera preview'}
          />
        )}
        {!shot && !ready && !error && <div className="absolute inset-0 flex items-center justify-center text-sm text-white/80">Opening camera…</div>}
        {!shot && ready && torch !== null && (
          <button onClick={toggleTorch} className="absolute top-2 right-2 rounded-full bg-black/50 px-3 py-1.5 text-xs font-medium text-white">
            {torch ? 'Torch off' : 'Torch on'}
          </button>
        )}
      </div>
      {error && (
        <div className="space-y-2 rounded-lg bg-red-50 p-3 text-sm text-red-800">
          <p>{error}</p>
          <Button variant="secondary" size="sm" onClick={start}>
            Try again
          </Button>
        </div>
      )}
      {shot ? (
        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" onClick={retake} disabled={busy}>
            Retake
          </Button>
          <Button onClick={() => onConfirm(shot.photo)} busy={busy}>
            {confirmLabel}
          </Button>
        </div>
      ) : (
        <div className={onCancel ? 'grid grid-cols-[auto_1fr] gap-2' : ''}>
          {onCancel && (
            <Button variant="secondary" onClick={onCancel}>
              Cancel
            </Button>
          )}
          <Button size="lg" onClick={capture} disabled={!ready} busy={capturing}>
            {captureLabel}
          </Button>
        </div>
      )}
    </div>
  );
}
