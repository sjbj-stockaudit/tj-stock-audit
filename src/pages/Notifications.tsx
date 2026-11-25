import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { fmtDateTime } from '../lib/format';
import { useT } from '../lib/i18n';
import { Card, Empty, ErrorBox, Loading, PageTitle, cx, useLoad } from '../components/ui';

type Item = { id: number; kind: string; title: string; body: string | null; link: string | null; created_at: string; read_at: string | null };
const ICON: Record<string, string> = { allocation: '📅', reminder: '⏰', late: '⚠️', findings: '🔎', not_done: '🚫', far_checkin: '📍', digest: '📋', plan_live: '✅' };

export default function Notifications() {
  const t = useT();
  const list = useLoad(() => api.get<{ items: Item[]; unread: number }>('/notifications'));
  // Opening the list marks everything as read
  useEffect(() => {
    if (list.data?.unread) api.post('/notifications/read').then(() => window.dispatchEvent(new Event('tj:notify')), () => {});
  }, [list.data]);
  if (!list.data) return list.error ? <ErrorBox error={list.error} /> : <Loading />;
  return (
    <div className="max-w-2xl">
      <PageTitle title={t('Notifications')} />
      {!list.data.items.length ? (
        <Empty>{t('No notifications yet.')}</Empty>
      ) : (
        <div className="space-y-2">
          {list.data.items.map((n) => {
            const inner = (
              <div className="flex gap-3 p-3">
                <div className="text-xl" aria-hidden="true">
                  {ICON[n.kind] ?? '🔔'}
                </div>
                <div className="min-w-0">
                  <div className={cx('text-sm', !n.read_at && 'font-semibold')}>{n.title}</div>
                  {n.body && <div className="text-sm text-slate-600">{n.body}</div>}
                  <div className="mt-0.5 text-xs text-slate-400">{fmtDateTime(n.created_at)}</div>
                </div>
              </div>
            );
            return (
              <Card key={n.id} className={cx(!n.read_at && 'border-brand-300 bg-brand-50/40')}>
                {n.link ? <Link to={n.link}>{inner}</Link> : inner}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
