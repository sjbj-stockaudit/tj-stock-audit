import { useEffect, useState, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { TRACTOR_STATUS_LABEL, VISIT_STATUS_LABEL, type TractorStatus, type VisitStatus } from '../../shared/domain';

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(' ');
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost' | 'warning';
  size?: 'sm' | 'md' | 'lg';
  busy?: boolean;
};

export function Button({ variant = 'primary', size = 'md', busy, className, children, disabled, ...rest }: BtnProps) {
  return (
    <button
      {...rest}
      disabled={disabled || busy}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition disabled:opacity-50 disabled:cursor-not-allowed',
        size === 'sm' && 'px-2.5 py-1.5 text-sm',
        size === 'md' && 'px-4 py-2 text-sm',
        size === 'lg' && 'px-5 py-3.5 text-base w-full',
        variant === 'primary' && 'bg-brand-800 text-white hover:bg-brand-900',
        variant === 'secondary' && 'bg-white text-slate-800 border border-slate-300 hover:bg-slate-50',
        variant === 'danger' && 'bg-red-600 text-white hover:bg-red-700',
        variant === 'warning' && 'bg-amber-500 text-white hover:bg-amber-600',
        variant === 'ghost' && 'text-slate-600 hover:bg-slate-100',
        className,
      )}
    >
      {busy && <Spinner />}
      {children}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <span className={cx('inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent', className)} />;
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('rounded-xl border border-slate-200 bg-white', className)}>{children}</div>;
}

export function PageTitle({ title, sub, actions }: { title: string; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
        {sub && <p className="mt-0.5 text-sm text-slate-500">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

/** Labelled form row. Use `group` when the content is not a single input (e.g. photo buttons). */
export function Field({ label, hint, children, group }: { label: string; hint?: ReactNode; children: ReactNode; group?: boolean }) {
  const Tag = group ? 'div' : 'label';
  return (
    <Tag className="block" {...(group ? { role: 'group', 'aria-label': label } : {})}>
      <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-500">{hint}</span>}
    </Tag>
  );
}

export const inputCls =
  'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 placeholder:text-slate-400 focus:border-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-100';

export function ErrorBox({ error, problems }: { error?: string | null; problems?: string[] }) {
  if (!error) return null;
  return (
    <div role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
      {error}
      {!!problems?.length && (
        <ul className="mt-1 list-disc pl-5">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

const visitTone: Record<VisitStatus, string> = {
  assigned: 'bg-slate-100 text-slate-700',
  in_progress: 'bg-blue-100 text-blue-800',
  submitted: 'bg-amber-100 text-amber-800',
  approved: 'bg-green-100 text-green-800',
  returned: 'bg-red-100 text-red-800',
};

export function VisitBadge({ status }: { status: VisitStatus }) {
  return <span className={cx('inline-block rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap', visitTone[status])}>{VISIT_STATUS_LABEL[status]}</span>;
}

const tractorTone: Record<TractorStatus, string> = {
  pending: 'bg-slate-100 text-slate-600',
  verified: 'bg-green-100 text-green-800',
  mismatch: 'bg-amber-100 text-amber-800',
  not_found: 'bg-red-100 text-red-800',
  extra: 'bg-blue-100 text-blue-800',
};

export function TractorBadge({ status }: { status: TractorStatus }) {
  const short: Record<TractorStatus, string> = { ...TRACTOR_STATUS_LABEL, mismatch: 'Mismatch', extra: 'Extra' };
  return <span className={cx('inline-block rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap', tractorTone[status])}>{short[status]}</span>;
}

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[1000] flex items-end justify-center bg-black/40 sm:items-center sm:p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-label={title}
        className={cx('flex max-h-[95vh] w-full flex-col rounded-t-2xl bg-white sm:rounded-2xl', wide ? 'sm:max-w-3xl' : 'sm:max-w-lg')}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h2 className="font-semibold">{title}</h2>
          <button onClick={onClose} className="rounded-lg p-1 text-2xl leading-none text-slate-500 hover:bg-slate-100" aria-label="Close">
            ×
          </button>
        </div>
        <div className="overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  );
}

export function Stat({ label, value, tone }: { label: string; value: ReactNode; tone?: 'green' | 'amber' | 'red' | 'blue' }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div
        className={cx(
          'mt-1 text-2xl font-semibold tabular-nums',
          tone === 'green' && 'text-green-700',
          tone === 'amber' && 'text-amber-600',
          tone === 'red' && 'text-red-600',
          tone === 'blue' && 'text-blue-700',
        )}
      >
        {value}
      </div>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-500">{children}</div>;
}

export function Loading() {
  return (
    <div className="flex items-center gap-2 p-8 text-slate-500">
      <Spinner /> Loading…
    </div>
  );
}

/** Small async-data hook with reload. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let live = true;
    setError(null);
    fn()
      .then((d) => live && setData(d))
      .catch((e) => live && setError(e.message));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  return { data, error, reload: () => setTick((t) => t + 1), setData };
}

export function Toast({ msg, onDone }: { msg: string | null; onDone: () => void }) {
  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(onDone, 3000);
    return () => clearTimeout(t);
  }, [msg, onDone]);
  if (!msg) return null;
  return (
    <div className="fixed bottom-6 left-1/2 z-[1100] -translate-x-1/2 rounded-lg bg-slate-900 px-4 py-2 text-sm text-white shadow-lg" role="status">
      {msg}
    </div>
  );
}
