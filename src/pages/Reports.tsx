import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { fmtDate, weekRange } from '../lib/format';
import { downloadConsolidated } from '../lib/reports';
import type { VisitRow } from '../lib/types';
import { useAuth } from '../App';
import { Button, Empty, ErrorBox, Loading, PageTitle, Stat, inputCls, useLoad } from '../components/ui';
import { VisitTable } from './admin/Dashboard';

/** Weekly consolidated report (admin), and the client's home page. */
export default function Reports() {
  const { me } = useAuth();
  const wk = weekRange();
  const [from, setFrom] = useState(wk.from);
  const [to, setTo] = useState(wk.to);
  const visits = useLoad(() => api.get<VisitRow[]>(`/visits?from=${from}&to=${to}&status=approved`), [from, to]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setSelected(new Set((visits.data ?? []).map((v) => v.id))), [visits.data]);

  const rows = visits.data ?? [];
  const chosen = rows.filter((v) => selected.has(v.id));
  const label = from === to ? fmtDate(from) : `${fmtDate(from)} to ${fmtDate(to)}`;

  async function download() {
    setError(null);
    setProgress('Preparing…');
    try {
      await downloadConsolidated(
        chosen.map((v) => v.id),
        `${from}_to_${to}`,
        setProgress,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setProgress(null);
    }
  }

  return (
    <div>
      <PageTitle
        title={me.role === 'client' ? 'Stock verification reports' : 'Weekly reports'}
        sub={
          me.role === 'client'
            ? 'Approved audits for each centre. Open one to see its photos, or download the combined report for the period.'
            : 'Combine approved audits into the weekly deliverable: one consolidated Excel plus each centre’s Excel, photo PDF and photos.'
        }
      />
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <label className="text-sm">
          <span className="mb-1 block text-slate-600">From</span>
          <input type="date" className={inputCls} value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-slate-600">To</span>
          <input type="date" className={inputCls} value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
        <Button variant="secondary" onClick={() => ((setFrom(wk.from), setTo(wk.to)))}>
          This week
        </Button>
        <Button
          variant="secondary"
          onClick={() => {
            const prev = weekRange(new Date(Date.parse(wk.from) - 86400_000).toISOString().slice(0, 10));
            setFrom(prev.from);
            setTo(prev.to);
          }}
        >
          Last week
        </Button>
      </div>
      <ErrorBox error={error ?? visits.error} />
      {!visits.data ? (
        <Loading />
      ) : !rows.length ? (
        <Empty>No approved audits between {label}.</Empty>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label="Centres audited" value={chosen.length} />
            <Stat label="Tractors in inventory" value={chosen.reduce((a, v) => a + v.inventory_count, 0)} />
            <Stat label="Short" value={chosen.reduce((a, v) => a + v.not_found_count, 0)} tone="red" />
            <Stat label="Extra" value={chosen.reduce((a, v) => a + v.extra_count, 0)} tone="blue" />
          </div>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm text-slate-600">
              {chosen.length} of {rows.length} audits selected
            </span>
            <Button onClick={download} busy={!!progress} disabled={!chosen.length}>
              {progress ?? `Download combined report (${chosen.length})`}
            </Button>
          </div>
          <VisitTable
            rows={rows}
            selectable={{
              selected,
              toggle: (id) =>
                setSelected((s) => {
                  const n = new Set(s);
                  if (n.has(id)) n.delete(id);
                  else n.add(id);
                  return n;
                }),
            }}
          />
        </>
      )}
    </div>
  );
}
