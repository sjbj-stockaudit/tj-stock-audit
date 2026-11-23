import { useEffect, useRef, useState } from 'react';
import { captureVideoFrame, type StampedPhoto } from '../lib/camera';
import { Button } from './ui';

/**
 * Live front-camera selfie. Uses the camera stream directly (no file picker),
 * so a saved or gallery photo cannot be used instead of a live one.
 */
export default function SelfieCamera({
  title,
  place,
  onConfirm,
  confirmLabel,
  busy,
}: {
  title: string;
  place: string;
  onConfirm: (photo: StampedPhoto) => void;
  confirmLabel: string;
  busy?: boolean;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shot, setShot] = useState<{ photo: StampedPhoto; url: string } | null>(null);
  const [capturing, setCapturing] = useState(false);

  async function start() {
    setError(null);
    setReady(false);
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('unsupported');
      const s = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 } }, audio: false });
      stream.current = s;
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
          : 'Could not open the front camera on this device.',
      );
    }
  }

  function stop() {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
  }

  useEffect(() => {
    void start();
    return stop;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function capture() {
    if (!video.current) return;
    setCapturing(true);
    try {
      const photo = await captureVideoFrame(video.current, title, place);
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
    void start();
  }

  return (
    <div className="space-y-3">
      <div className="relative mx-auto aspect-[3/4] w-full max-w-xs overflow-hidden rounded-2xl bg-slate-900">
        {shot ? (
          <img src={shot.url} alt="Your selfie" className="h-full w-full object-cover" />
        ) : (
          // Mirrored preview feels natural; the saved photo is not mirrored.
          <video ref={video} playsInline muted className="h-full w-full -scale-x-100 object-cover" aria-label="Front camera preview" />
        )}
        {!shot && !ready && !error && <div className="absolute inset-0 flex items-center justify-center text-sm text-white/80">Opening camera…</div>}
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
        <Button size="lg" onClick={capture} disabled={!ready} busy={capturing}>
          Take selfie
        </Button>
      )}
    </div>
  );
}
