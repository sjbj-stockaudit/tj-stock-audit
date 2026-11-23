import { useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api';
import { weekRange } from '../../lib/format';
import type { Centre, User, VisitRow } from '../../lib/types';
import { VISIT_STATUS_LABEL } from '../../../shared/domain';
import { Empty, ErrorBox, Loading, PageTitle, inputCls, useLoad } from '../../components/ui';
import { VisitTable } from './Dashboard';

export default function Visits() {
  const [params, setParams] = useSearchParams();
  const wk = weekRange();
  const from = params.get('from') ?? wk.from;
  const to = params.get('to') ?? wk.to;
  const status = params.get('status') ?? '';
  const centre = params.get('centre_id') ?? '';
  const auditor = params.get('auditor_id') ?? '';
  const set = (k: string, v: string) => {
    const p = new URLSearchParams(params);
    if (v) p.set(k, v);
    else p.delete(k);
    if (!p.has('from')) p.set('from', from);
    if (!p.has('to')) p.set('to', to);
    setParams(p, { replace: true });
  };

  const q = new URLSearchParams({ from, to, ...(status && { status }), ...(centre && { centre_id: centre }), ...(auditor && { auditor_id: auditor }) });
  const visits = useLoad(() => api.get<VisitRow[]>(`/visits?${q}`), [q.toString()]);
  const centres = useLoad(() => api.get<{ centres: Centre[] }>('/centres'));
  const users = useLoad(() => api.get<User[]>('/users'));

  return (
    <div>
      <PageTitle title="Audits" sub="Every centre visit. Click a centre to see photos, review and download its report." />
      <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-5">
        <input type="date" className={inputCls} value={from} onChange={(e) => set('from', e.target.value)} aria-label="From date" />
        <input type="date" className={inputCls} value={to} onChange={(e) => set('to', e.target.value)} aria-label="To date" />
        <select className={inputCls} value={status} onChange={(e) => set('status', e.target.value)} aria-label="Status">
          <option value="">All statuses</option>
          {Object.entries(VISIT_STATUS_LABEL).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </select>
        <select className={inputCls} value={centre} onChange={(e) => set('centre_id', e.target.value)} aria-label="Centre">
          <option value="">All centres</option>
          {centres.data?.centres.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select className={inputCls} value={auditor} onChange={(e) => set('auditor_id', e.target.value)} aria-label="Auditor">
          <option value="">All auditors</option>
          {users.data
            ?.filter((u) => u.role === 'auditor')
            .map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
        </select>
      </div>
      <ErrorBox error={visits.error} />
      {!visits.data ? <Loading /> : !visits.data.length ? <Empty>No audits match these filters.</Empty> : <VisitTable rows={visits.data} />}
    </div>
  );
}
