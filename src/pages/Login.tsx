import { useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import { Button, ErrorBox, Field, inputCls } from '../components/ui';

export function AuthFrame({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-brand-900 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-5 flex items-center gap-3">
          <img src="/icon.svg" alt="" className="h-10 w-10" />
          <div>
            <div className="font-semibold">Stock Audit</div>
            <div className="text-sm text-slate-500">{title}</div>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}

export default function Login({ onDone }: { onDone: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/login', { username, password });
      onDone();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthFrame title="Sign in">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Username">
          <input className={inputCls} value={username} onChange={(e) => setUsername(e.target.value)} autoCapitalize="none" autoComplete="username" required />
        </Field>
        <Field label="Password">
          <input className={inputCls} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </Field>
        <ErrorBox error={error} />
        <Button type="submit" size="lg" busy={busy}>
          Sign in
        </Button>
        <p className="text-center text-xs text-slate-500">Forgot your password? Ask your administrator to reset it.</p>
      </form>
    </AuthFrame>
  );
}
