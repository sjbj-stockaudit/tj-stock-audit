import { useEffect, useRef, useState } from 'react';
import { api, photoUrl } from '../lib/api';
import type { StampedPhoto } from '../lib/camera';
import type { Photo } from '../lib/types';
import type { PhotoKind } from '../../shared/domain';
import LiveCamera from './LiveCamera';
import { cx } from './ui';
import { useT } from '../lib/i18n';

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
  kind: PhotoKind | 'facility' | 'meter';
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
  const t = useT();
  const [error, setError] = useState<string | null>(null);
  // Photos still uploading (or failed): shown at once so the auditor can carry on
  const [pending, setPending] = useState<{ key: string; url: string; photo: StampedPhoto; failed: boolean }[]>([]);
  const latest = useRef(photos);
  useEffect(() => {
    latest.current = photos;
  }, [photos]);

  function onTaken(photo: StampedPhoto) {
    setShooting(false);
    const item = { key: `${Date.now()}-${Math.random()}`, url: URL.createObjectURL(photo.blob), photo, failed: false };
    setPending((p) => [...p, item]);
    void upload(item);
  }

  async function upload(item: { key: string; url: string; photo: StampedPhoto }) {
    const { blob, fix, takenAt } = item.photo;
    setError(null);
    setPending((p) => p.map((x) => (x.key === item.key ? { ...x, failed: false } : x)));
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
      latest.current = [...latest.current, p];
      onChange(latest.current);
      setPending((list) => list.filter((x) => x.key !== item.key));
      URL.revokeObjectURL(item.url);
    } catch (e) {
      setError(`${t((e as Error).message)} – ${t('Retry')}`);
      setPending((list) => list.map((x) => (x.key === item.key ? { ...x, failed: true } : x)));
    }
  }

  async function remove(p: Photo) {
    if (!confirm(t('Delete this photo?'))) return;
    try {
      await api.del(`/photos/${p.id}`);
      latest.current = latest.current.filter((x) => x.id !== p.id);
      onChange(latest.current);
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
        {pending.map((x) => (
          <div key={x.key} className="relative">
            <img src={x.url} alt={label} className={cx('h-20 w-20 rounded-lg object-cover ring-1', x.failed ? 'ring-red-500' : 'opacity-70 ring-slate-200')} />
            {x.failed ? (
              <button onClick={() => void upload(x)} className="absolute inset-x-1 bottom-1 rounded bg-red-600 py-0.5 text-[11px] font-medium text-white">
                {t('Retry')}
              </button>
            ) : (
              <span className="absolute inset-0 flex items-center justify-center">
                <span className="h-5 w-5 animate-spin rounded-full border-2 border-white border-r-transparent" aria-label="Uploading" />
              </span>
            )}
          </div>
        ))}
        {!shooting && (
          <button
            type="button"
            onClick={() => setShooting(true)}
            className={cx(
              'flex h-20 min-w-20 flex-col items-center justify-center rounded-lg border-2 border-dashed px-2 text-xs font-medium',
              required && !photos.length && !pending.length ? 'border-amber-400 bg-amber-50 text-amber-800' : 'border-slate-300 text-slate-600',
            )}
          >
            <svg viewBox="0 0 24 24" className="mb-1 h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
              <circle cx="12" cy="13" r="3.5" />
            </svg>
            {photos.length || pending.length ? t('Add another') : label}
          </button>
        )}
      </div>
      {shooting && (
        <div className="mt-3">
          <LiveCamera
            facing="environment"
            title={stampTitle}
            place={place}
            captureLabel={t('Take photo')}
            confirmLabel={t('Use photo')}
            onConfirm={onTaken}
            onCancel={() => setShooting(false)}
          />
        </div>
      )}
      {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
    </div>
  );
}
