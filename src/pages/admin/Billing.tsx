import { Fragment, useMemo, useState } from 'react';
import ExcelJS from 'exceljs';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { fmtDate, fmtHours, fmtTime, hoursBetween, todayIST } from '../../lib/format';
import { saveBlob } from '../../lib/reports';
import { Button, Card, Empty, ErrorBox, Loading, PageTitle, Stat, inputCls, useLoad } from '../../components/ui';

type BillVisit = {
  visit_id: number;
  audit_date: string;
  checkin_at: string | null;
  checkout_at: string | null;
  status: 'approved' | 'submitted';
  outcome: 'not_done' | null;
  outcome_reason: string | null;
  checkin_distance_m: number | null;
  centre_name: string;
  state: string;
  auditor_id: number;
  auditor_name: string;
  username: string;
  home_area: string | null;
  phone: string | null;
  tractor_count: number;
};

type Person = { id: number; name: string; team: string; approved: BillVisit[]; closed: BillVisit[]; pending: BillVisit[]; days: number; hours: number };

export default function Billing() {
  const [month, setMonth] = useState(todayIST().slice(0, 7));
  const data = useLoad(() => api.get<{ month: string; visits: BillVisit[] }>(`/billing?month=${month}`), [month]);
  const [open, setOpen] = useState<number | null>(null);

  const people = useMemo<Person[]>(() => {
    const map = new Map<number, Person>();
    for (const v of data.data?.visits ?? []) {
      const p = map.get(v.auditor_id) ?? { id: v.auditor_id, name: v.auditor_name, team: v.home_area ?? '', approved: [], closed: [], pending: [], days: 0, hours: 0 };
      // Approved audits and approved "centre closed" visits are counted separately, so you decide how to bill the latter
      (v.status !== 'approved' ? p.pending : v.outcome === 'not_done' ? p.closed : p.approved).push(v);
      map.set(v.auditor_id, p);
    }
    for (const p of map.values()) {
      p.days = new Set([...p.approved, ...p.closed].map((v) => v.audit_date)).size;
      p.hours = p.approved.reduce((a, v) => a + (hoursBetween(v.checkin_at, v.checkout_at) ?? 0), 0);
    }
    return [...map.values()].sort((a, b) => a.team.localeCompare(b.team) || a.name.localeCompare(b.name));
  }, [data.data]);

  const totalApproved = people.reduce((a, p) => a + p.approved.length, 0);
  const totalPending = people.reduce((a, p) => a + p.pending.length, 0);
  const monthLabel = new Date(`${month}-01T00:00:00Z`).toLocaleString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' });

  async function exportExcel() {
    const wb = new ExcelJS.Workbook();
    const head = (ws: ExcelJS.Worksheet, cols: string[]) => {
      const r = ws.addRow(cols);
      r.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      r.eachCell((c) => (c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF374151' } }));
    };
    const s = wb.addWorksheet('Summary');
    s.columns = [28, 24, 18, 14, 14, 18].map((width) => ({ width }));
    s.addRow([`Auditor visits – ${monthLabel}`]).font = { bold: true, size: 13 };
    s.addRow(['Counted = audits approved by the administrator. Audits awaiting review are not counted yet.']);
    s.addRow([]);
    head(s, ['Auditor', 'Base area', 'Audits approved', 'Centre closed (approved)', 'Days worked', 'Hours on site', 'Awaiting review']);
    for (const p of people) s.addRow([p.name, p.team, p.approved.length, p.closed.length, p.days, Number(p.hours.toFixed(2)), p.pending.length]);
    s.addRow(['Total', '', totalApproved, '', '', totalPending]).font = { bold: true };

    const d = wb.addWorksheet('Visit details');
    d.columns = [24, 20, 12, 18, 8, 12, 12, 12, 10, 14].map((width) => ({ width }));
    head(d, ['Auditor', 'Base area', 'Date', 'Centre', 'State', 'Check-in', 'Check-out', 'Hours', 'Tractors', 'Status']);
    for (const p of people)
      for (const v of [...p.approved, ...p.closed, ...p.pending])
        d.addRow([
          p.name,
          p.team,
          fmtDate(v.audit_date),
          v.centre_name,
          v.state,
          fmtTime(v.checkin_at),
          fmtTime(v.checkout_at),
          Number((hoursBetween(v.checkin_at, v.checkout_at) ?? 0).toFixed(2)),
          v.tractor_count,
          v.status !== 'approved' ? 'Awaiting review' : v.outcome === 'not_done' ? `Centre closed – ${v.outcome_reason ?? ''}` : 'Approved',
        ]);
    saveBlob(new Blob([await wb.xlsx.writeBuffer()]), `Auditor_Visits_${month}.xlsx`);
  }

  return (
    <div>
      <PageTitle
        title="Monthly visits"
        sub="Approved centre visits per auditor for the month. One approved centre audit = one visit."
        actions={
          <>
            <input type="month" className={`${inputCls} w-auto`} value={month} max={todayIST().slice(0, 7)} onChange={(e) => setMonth(e.target.value)} aria-label="Month" />
            <Button onClick={exportExcel} disabled={!people.length}>
              Download Excel
            </Button>
          </>
        }
      />
      <ErrorBox error={data.error} />
      {!data.data ? (
        <Loading />
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3">
            <Stat label={`Audits approved · ${monthLabel}`} value={totalApproved} tone="green" />
            <Stat label="Awaiting your review" value={totalPending} tone={totalPending ? 'amber' : undefined} />
            <Stat label="Auditors with visits" value={people.length} />
          </div>
          {totalPending > 0 && (
            <p className="mb-3 text-sm text-amber-700">
              {totalPending} visit(s) are submitted but not approved yet. <Link to="/visits?status=submitted" className="underline">Review them</Link> before
              finalising the month.
            </p>
          )}
          {!people.length ? (
            <Empty>No visits in {monthLabel}.</Empty>
          ) : (
            <Card className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs text-slate-500 uppercase">
                  <tr>
                    <th className="px-3 py-2">Auditor</th>
                    <th className="px-3 py-2">Base area</th>
                    <th className="px-3 py-2 text-right">Audits approved</th>
                    <th className="px-3 py-2 text-right">Centre closed</th>
                    <th className="px-3 py-2 text-right">Days worked</th>
                    <th className="px-3 py-2 text-right">Hours on site</th>
                    <th className="px-3 py-2 text-right">Awaiting review</th>
                  </tr>
                </thead>
                <tbody>
                  {people.map((p) => (
                    <Fragment key={p.id}>
                      <tr className="cursor-pointer border-b border-slate-100 hover:bg-slate-50" onClick={() => setOpen(open === p.id ? null : p.id)}>
                        <td className="px-3 py-2 font-medium">
                          <span className="mr-1 text-slate-400">{open === p.id ? '▾' : '▸'}</span>
                          {p.name}
                        </td>
                        <td className="px-3 py-2 text-slate-600">{p.team}</td>
                        <td className="px-3 py-2 text-right font-semibold tabular-nums">{p.approved.length}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-slate-600">{p.closed.length || ''}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{p.days}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmtHours(p.hours)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-amber-600">{p.pending.length || ''}</td>
                      </tr>
                      {open === p.id &&
                        [...p.approved, ...p.closed, ...p.pending].map((v) => (
                          <tr key={`v${v.visit_id}`} className="border-b border-slate-100 bg-slate-50/60 text-xs">
                            <td className="py-1.5 pr-3 pl-9">
                              <Link to={`/visits/${v.visit_id}`} className="text-brand-800 hover:underline">
                                {fmtDate(v.audit_date)} · {v.centre_name}
                              </Link>
                            </td>
                            <td className="px-3 py-1.5">
                              {fmtTime(v.checkin_at)} – {fmtTime(v.checkout_at)}
                            </td>
                            <td className="px-3 py-1.5 text-right">{v.status === 'approved' && v.outcome !== 'not_done' ? '1' : ''}</td>
                            <td className="px-3 py-1.5 text-right text-slate-600" title={v.outcome_reason ?? ''}>
                              {v.status === 'approved' && v.outcome === 'not_done' ? '1' : ''}
                            </td>
                            <td />
                            <td className="px-3 py-1.5 text-right">{fmtHours(hoursBetween(v.checkin_at, v.checkout_at))}</td>
                            <td className="px-3 py-1.5 text-right text-amber-600">{v.status === 'submitted' ? 'awaiting' : ''}</td>
                          </tr>
                        ))}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
