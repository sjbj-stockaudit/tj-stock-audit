import { useEffect, useRef, useState } from 'react';
import { Button } from './ui';

/** Finger/stylus signature box. Calls onSave with a PNG blob. */
export default function SignaturePad({ onSave, saved, busy }: { onSave: (png: Blob) => void; saved: boolean; busy?: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    const c = canvas.current!;
    const ratio = window.devicePixelRatio || 1;
    c.width = c.offsetWidth * ratio;
    c.height = c.offsetHeight * ratio;
    const ctx = c.getContext('2d')!;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#0f172a';
  }, []);

  const pos = (e: React.PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top] as const;
  };
  const down = (e: React.PointerEvent) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    const ctx = canvas.current!.getContext('2d')!;
    ctx.beginPath();
    ctx.moveTo(...pos(e));
  };
  const move = (e: React.PointerEvent) => {
    if (!drawing.current) return;
    const ctx = canvas.current!.getContext('2d')!;
    ctx.lineTo(...pos(e));
    ctx.stroke();
    setDirty(true);
  };
  const up = () => (drawing.current = false);
  const clear = () => {
    const c = canvas.current!;
    c.getContext('2d')!.clearRect(0, 0, c.width, c.height);
    setDirty(false);
  };
  const save = () =>
    canvas.current!.toBlob((b) => {
      if (!b) return;
      onSave(b);
      setDirty(false);
    }, 'image/png');

  return (
    <div>
      <canvas
        ref={canvas}
        className="h-36 w-full touch-none rounded-lg border-2 border-dashed border-slate-300 bg-white"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerLeave={up}
        aria-label="Signature area"
      />
      <div className="mt-2 flex items-center gap-2">
        <Button variant="secondary" size="sm" onClick={clear} disabled={!dirty}>
          Clear
        </Button>
        <Button size="sm" onClick={save} disabled={!dirty} busy={busy}>
          Save signature
        </Button>
        {saved && !dirty && <span className="text-sm text-green-700">✓ Saved</span>}
      </div>
    </div>
  );
}
