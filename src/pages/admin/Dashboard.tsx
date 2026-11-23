import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { fmtDate, todayIST } from '../../lib/format';
import type { VisitRow } from '../../lib/types';
import { Card, Empty, ErrorBox, Loading, PageTitle, Stat, VisitBadge, useLoad } from '../../components/ui';

type Dash = { date: string; by_status: Record<string, number>; awaiting_review: number; auditors_on_site: number };

export default function Dashboard() {
  const today = todayIST();
  const dash = useLoad(() => api.get<Dash>(`/dashboard?date=${today}`));
  const visits = useLoad(() => api.get<VisitRow[]>(`/visits?from=${today}&to=${today}`));
  const review = useLoad(() => api.get<VisitRow[]>('/visits?status=submitted'));

  const s = dash.data?.by_status ?? {};
  const total = Object.values(s).reduce((a, b) => a + b, 0);
  const done = (s.submitted ?? 0) + (s.approved ?? 0);

  return (
    <div>
      <PageTitle
        title="Today"
        sub={fmtDate(today)}
        actions={
          <Link to="/upload" className="rounded-lg bg-brand-800 px-4 py-2 text-sm font-medium text-white hover:bg-brand-900">
            Upload stock statement
          </Link>
        }
      />
      <ErrorBox error={dash.error} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Centres scheduled today" value={total} />
        <Stat label="Audits completed today" value={`${done}/${total}`} tone="green" />
        <Stat label="Auditors on site now" value={dash.data?.auditors_on_site ?? '–'} tone="blue" />
        <Stat label="Waiting for your review" value={dash.data?.awaiting_review ?? '–'} tone={dash.data?.awaiting_review ? 'amber' : undefined} />
      </div>

      <h2 className="mt-8 mb-3 font-semibold">Today's centres</h2>
      {!visits.data ? (
        <Loading />
      ) : !visits.data.length ? (
        <Empty>
          No audits scheduled today. <Link to="/upload" className="text-brand-700 underline">Upload today's stock statement</Link> to create them.
        </Empty>
      ) : (
        <VisitTable rows={visits.data} />
      )}

      <h2 className="mt-8 mb-3 font-semibold">Waiting for your review</h2>
      {!review.data ? <Loading /> : !review.data.length ? <Empty>Nothing to review.</Empty> : <VisitTable rows={review.data} />}
    </div>
  );
}

export function VisitTable({ rows, selectable }: { rows: VisitRow[]; selectable?: { selected: Set<number>; toggle: (id: number) => void } }) {
  return (
    <Card className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs text-slate-500 uppercase">
          <tr>
            {selectable && <th className="w-8 px-3 py-2" />}
            <th className="px-3 py-2">Date</th>
            <th className="px-3 py-2">Centre</th>
            <th className="px-3 py-2">Auditor</th>
            <th className="px-3 py-2">Status</th>
            <th className="px-3 py-2 text-right">Checked</th>
            <th className="px-3 py-2 text-right">Short</th>
            <th className="px-3 py-2 text-right">Extra</th>
            <th className="px-3 py-2 text-right">Mismatch</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((v) => (
            <tr key={v.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
              {selectable && (
                <td className="px-3 py-2">
                  <input type="checkbox" checked={selectable.selected.has(v.id)} onChange={() => selectable.toggle(v.id)} aria-label={`Select ${v.centre_name}`} />
                </td>
              )}
              <td className="px-3 py-2 whitespace-nowrap">{fmtDate(v.audit_date)}</td>
              <td className="px-3 py-2">
                <Link to={`/visits/${v.id}`} className="font-medium text-brand-800 hover:underline">
                  {v.centre_name}
                </Link>
                <span className="ml-1 text-xs text-slate-400">{v.state}</span>
              </td>
              <td className="px-3 py-2">{v.auditor_name ?? <span className="text-red-600">Not assigned</span>}</td>
              <td className="px-3 py-2">
                <VisitBadge status={v.status} />
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {v.inventory_count - v.pending_count}/{v.inventory_count}
              </td>
              <td className={`px-3 py-2 text-right tabular-nums ${v.not_found_count ? 'font-semibold text-red-600' : ''}`}>{v.not_found_count}</td>
              <td className={`px-3 py-2 text-right tabular-nums ${v.extra_count ? 'font-semibold text-blue-700' : ''}`}>{v.extra_count}</td>
              <td className={`px-3 py-2 text-right tabular-nums ${v.mismatch_count ? 'font-semibold text-amber-600' : ''}`}>{v.mismatch_count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
