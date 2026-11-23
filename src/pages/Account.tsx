import { useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import { Button, Card, ErrorBox, Field, PageTitle, inputCls } from '../components/ui';
import { useAuth } from '../App';

export default function Account() {
  const { me } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/me/password', { current, next });
      setDone(true);
      setCurrent('');
      setNext('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-md">
      <PageTitle title="My account" sub={`${me.name} · ${me.username}`} />
      <Card className="p-4">
        <form onSubmit={submit} className="space-y-4">
          <Field label="Current password">
            <input className={inputCls} type="password" value={current} onChange={(e) => setCurrent(e.target.value)} required />
          </Field>
          <Field label="New password" hint="At least 8 characters">
            <input className={inputCls} type="password" value={next} onChange={(e) => setNext(e.target.value)} minLength={8} required />
          </Field>
          <ErrorBox error={error} />
          {done && <p className="text-sm text-green-700">Password changed.</p>}
          <Button type="submit" busy={busy}>
            Change password
          </Button>
        </form>
      </Card>
    </div>
  );
}
