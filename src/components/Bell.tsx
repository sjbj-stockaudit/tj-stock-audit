import { useEffect, useState } from 'react';
import { NavLink } from 'react-router-dom';
import { api } from '../lib/api';
import { cx } from './ui';

/** Bell with the number of unread notifications; refreshed every minute and when an alert arrives. */
export default function Bell({ className }: { className?: string }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    let alive = true;
    const load = () => api.get<{ unread: number }>('/notifications/unread').then((r) => alive && setN(r.unread), () => {});
    load();
    const t = setInterval(load, 60_000);
    const onVis = () => document.visibilityState === 'visible' && load();
    window.addEventListener('tj:notify', load);
    document.addEventListener('visibilitychange', onVis);
    return () => {
      alive = false;
      clearInterval(t);
      window.removeEventListener('tj:notify', load);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);
  return (
    <NavLink to="/notifications" className={cx('relative inline-flex items-center', className)} aria-label={n ? `Notifications, ${n} unread` : 'Notifications'}>
      <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8" />
        <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
      </svg>
      {n > 0 && (
        <span className="absolute -top-1.5 -right-2 min-w-5 rounded-full bg-red-600 px-1 text-center text-[11px] leading-5 font-semibold text-white">{n > 99 ? '99+' : n}</span>
      )}
    </NavLink>
  );
}
