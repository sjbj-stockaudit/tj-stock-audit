import { useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import { Button, ErrorBox, Field, inputCls } from '../components/ui';
import { LangToggle, useT } from '../lib/i18n';

export function AuthFrame({ title, children }: { title: string; children: React.ReactNode }) {
  const t = useT();
  return (
    <div className="flex min-h-screen items-center justify-center bg-brand-900 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
        <div className="-mt-2 mb-2 flex justify-end">
          <LangToggle />
        </div>
        <div className="mb-5 border-b border-slate-100 pb-4 text-center">
          <img src="/brand/sjbj-logo.png" alt="SJBJ & Associates, Chartered Accountants" className="mx-auto w-56 max-w-full" />
          <div className="mt-3 font-semibold">Stock Audit</div>
          <div className="text-sm text-slate-500">{t(title)}</div>
        </div>
        {children}
      </div>
    </div>
  );
}

export default function Login({ onDone }: { onDone: () => void }) {
  const t = useT();
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
        <Field label={t('Username')}>
          <input className={inputCls} value={username} onChange={(e) => setUsername(e.target.value)} autoCapitalize="none" autoComplete="username" required />
        </Field>
        <Field label={t('Password')}>
          <input className={inputCls} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </Field>
        <ErrorBox error={error} />
        <Button type="submit" size="lg" busy={busy}>
          {t('Sign in')}
        </Button>
        <p className="text-center text-xs text-slate-500">{t('Forgot your password? Ask your administrator to reset it.')}</p>
      </form>
    </AuthFrame>
  );
}
