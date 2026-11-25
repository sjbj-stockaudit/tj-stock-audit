import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { fmtDate, mapsLink, todayIST } from '../../lib/format';
import type { VisitRow } from '../../lib/types';
import { useAuth } from '../../App';
import { useT } from '../../lib/i18n';
import { Card, Empty, ErrorBox, Loading, VisitBadge, useLoad } from '../../components/ui';

export default function AuditorHome() {
  const { me } = useAuth();
  const t = useT();
  const since = todayIST(-30);
  const visits = useLoad(() => api.get<VisitRow[]>(`/visits?from=${since}`));
  const today = todayIST();

  if (!visits.data) return visits.error ? <ErrorBox error={visits.error} /> : <Loading />;
  const rows = visits.data;
  const active = rows.filter((v) => v.status === 'in_progress');
  const returned = rows.filter((v) => v.status === 'returned');
  const todo = rows.filter((v) => v.status === 'assigned' && v.audit_date <= today).sort((a, b) => a.audit_date.localeCompare(b.audit_date));
  const upcoming = rows.filter((v) => v.status === 'assigned' && v.audit_date > today);
  const done = rows.filter((v) => v.status === 'submitted' || v.status === 'approved').slice(0, 10);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-semibold">{t('Namaste, {name}', { name: me.name.split(' ')[0] })}</h1>
        <p className="text-sm text-slate-500">{fmtDate(today)}</p>
      </div>
      {active.length > 0 && <Section title="Checked in now" rows={active} cta="Continue audit" highlight />}
      {returned.length > 0 && <Section title="Sent back for correction" rows={returned} cta="Fix and resubmit" />}
      <Section title="To audit" rows={todo} cta="Start" empty="No centres assigned to you right now." />
      {upcoming.length > 0 && <Section title="Coming up" rows={upcoming} />}
      {done.length > 0 && <Section title="Submitted" rows={done} />}
    </div>
  );
}

function Section({ title, rows, cta, empty, highlight }: { title: string; rows: VisitRow[]; cta?: string; empty?: string; highlight?: boolean }) {
  const t = useT();
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold tracking-wide text-slate-500 uppercase">{t(title)}</h2>
      {!rows.length ? (
        <Empty>{empty && t(empty)}</Empty>
      ) : (
        <div className="space-y-2">
          {rows.map((v) => (
            <Card key={v.id} className={highlight ? 'border-blue-300 ring-2 ring-blue-100' : ''}>
              <Link to={`/audit/${v.id}`} className="block p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="text-base font-semibold">{v.centre_name}</div>
                    <div className="text-xs text-slate-500">
                      {fmtDate(v.audit_date)}
                    </div>
                  </div>
                  <VisitBadge status={v.status} />
                </div>
                {v.address && <div className="mt-1 line-clamp-2 text-xs text-slate-500">{v.address}</div>}
              </Link>
              {cta && (
                <div className="flex border-t border-slate-100 text-sm">
                  <a href={mapsLink(v.lat, v.lng, v.address, v.centre_name)} target="_blank" rel="noreferrer" className="flex-1 py-2.5 text-center text-slate-600">
                    {t('Directions')}
                  </a>
                  <Link to={`/audit/${v.id}`} className="flex-1 border-l border-slate-100 py-2.5 text-center font-medium text-brand-800">
                    {t(cta)} →
                  </Link>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </section>
  );
}
