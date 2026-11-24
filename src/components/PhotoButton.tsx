import { useState } from 'react';
import { api, photoUrl } from '../lib/api';
import type { StampedPhoto } from '../lib/camera';
import type { Photo } from '../lib/types';
import type { PhotoKind } from '../../shared/domain';
import LiveCamera from './LiveCamera';
import { cx } from './ui';

/**
 * Opens the in-app camera (live only – no gallery), stamps the photo with GPS + time,
 * compresses it and uploads it. Shows existing photos as thumbnails with a remove button.
 */
export default function PhotoButton({
  visitId,
  kind,
  label,
  stampTitle,
  place,
  tractorId,
  accessoryId,
  facilityId,
  photos,
  onChange,
  required,
}: {
  visitId: number;
  kind: PhotoKind | 'facility';
  label: string;
  stampTitle: string;
  place: string;
  tractorId?: number;
  accessoryId?: number;
  facilityId?: number;
  photos: Photo[];
  onChange: (photos: Photo[]) => void;
  required?: boolean;
}) {
  const [shooting, setShooting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload({ blob, fix, takenAt }: StampedPhoto) {
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('file', blob, 'photo.jpg');
      form.append('kind', kind);
      form.append('taken_at', takenAt);
      if (tractorId) form.append('tractor_id', String(tractorId));
      if (accessoryId) form.append('accessory_id', String(accessoryId));
      if (facilityId) form.append('facility_id', String(facilityId));
      if (fix) {
        form.append('lat', String(fix.lat));
        form.append('lng', String(fix.lng));
      }
      const p = await api.post<Photo>(`/visits/${visitId}/photos`, form);
      onChange([...photos, p]);
      setShooting(false);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(p: Photo) {
    if (!confirm('Delete this photo?')) return;
    try {
      await api.del(`/photos/${p.id}`);
      onChange(photos.filter((x) => x.id !== p.id));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        {photos.map((p) => (
          <div key={p.id} className="relative">
            <img src={photoUrl(p.id)} alt={label} className="h-20 w-20 rounded-lg object-cover ring-1 ring-slate-200" />
            <button
              onClick={() => remove(p)}
              className="absolute -top-2 -right-2 flex h-6 w-6 items-center justify-center rounded-full bg-red-600 text-sm text-white"
              aria-label="Delete photo"
            >
              ×
            </button>
          </div>
        ))}
        {!shooting && (
          <button
            type="button"
            onClick={() => setShooting(true)}
            className={cx(
              'flex h-20 min-w-20 flex-col items-center justify-center rounded-lg border-2 border-dashed px-2 text-xs font-medium',
              required && !photos.length ? 'border-amber-400 bg-amber-50 text-amber-800' : 'border-slate-300 text-slate-600',
            )}
          >
            <svg viewBox="0 0 24 24" className="mb-1 h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
              <circle cx="12" cy="13" r="3.5" />
            </svg>
            {photos.length ? 'Add another' : label}
          </button>
        )}
      </div>
      {shooting && (
        <div className="mt-3">
          <LiveCamera
            facing="environment"
            title={stampTitle}
            place={place}
            captureLabel="Take photo"
            confirmLabel="Use photo"
            busy={busy}
            onConfirm={upload}
            onCancel={() => setShooting(false)}
          />
        </div>
      )}
      {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
    </div>
  );
}
