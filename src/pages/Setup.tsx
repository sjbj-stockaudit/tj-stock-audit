import { useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import { Button, ErrorBox, Field, inputCls } from '../components/ui';
import { AuthFrame } from './Login';

/** Shown only once, on a brand-new installation, to create the first administrator. */
export default function Setup({ onDone }: { onDone: () => void }) {
  const [form, setForm] = useState({ name: '', username: '', password: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/setup', form);
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthFrame title="First-time setup">
      <p className="mb-4 text-sm text-slate-600">Create the administrator account. You will add auditors and client logins after this.</p>
      <form onSubmit={submit} className="space-y-4">
        <Field label="Your name">
          <input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
        </Field>
        <Field label="Username">
          <input className={inputCls} value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} autoCapitalize="none" required />
        </Field>
        <Field label="Password" hint="At least 8 characters">
          <input className={inputCls} type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} minLength={8} required />
        </Field>
        <ErrorBox error={error} />
        <Button type="submit" size="lg" busy={busy}>
          Create administrator
        </Button>
      </form>
    </AuthFrame>
  );
}
