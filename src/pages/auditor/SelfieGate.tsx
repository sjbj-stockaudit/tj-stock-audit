import { useState } from 'react';
import { api } from '../../lib/api';
import type { StampedPhoto } from '../../lib/camera';
import { fmtDate, todayIST } from '../../lib/format';
import SelfieCamera from '../../components/SelfieCamera';
import { ErrorBox } from '../../components/ui';
import { AuthFrame } from '../Login';

/** After signing in, auditors take a live selfie before they can use the app (once a day). */
export default function SelfieGate({ name, onDone, onSignOut }: { name: string; onDone: () => void; onSignOut: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(photo: StampedPhoto) {
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('file', photo.blob, 'selfie.jpg');
      if (photo.fix) {
        form.append('lat', String(photo.fix.lat));
        form.append('lng', String(photo.fix.lng));
      }
      await api.post('/me/selfie', form);
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthFrame title={`Sign-in selfie · ${fmtDate(todayIST())}`}>
      <p className="mb-4 text-sm text-slate-600">
        Hi {name.split(' ')[0]}, take a quick selfie to confirm it's you. Face the camera in good light.
      </p>
      <SelfieCamera title={`Sign-in · ${name}`} place="Stock audit app" onConfirm={upload} confirmLabel="Use this selfie" busy={busy} />
      <div className="mt-3">
        <ErrorBox error={error} />
      </div>
      <button onClick={onSignOut} className="mt-4 w-full text-center text-sm text-slate-500">
        Not you? Sign out
      </button>
    </AuthFrame>
  );
}
