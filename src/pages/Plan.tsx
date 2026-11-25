import { useMemo, useRef, useState } from 'react';
import ExcelJS from 'exceljs';
import { api } from '../lib/api';
import { fmtDate, fmtDateTime, todayIST, weekRange } from '../lib/format';
import { addLogoRows, loadLogos, saveBlob } from '../lib/reports';
import { VISIT_STATUS_LABEL, type VisitStatus } from '../../shared/domain';
import { useAuth } from '../App';
import { Button, Card, ErrorBox, Loading, Modal, PageTitle, Stat, VisitBadge, cx, inputCls, useLoad } from '../components/ui';
import { parsePlan, planTemplate, type PlanImportRow } from '../lib/planTemplate';

type Options = {
  centres: { id: number; state: string; name: string; address: string | null; opening_hours: string | null; weekly_off: string | null }[];
  auditors: { id: number; name: string; phone: string | null; home_area: string | null }[];
};
type PlanRow = {
  id: number;
  plan_date: string;
  centre_id: number;
  centre_name: string;
  state: string;
  weekly_off: string | null;
  auditor_id: number | null;
  auditor_name: string | null;
  home_area: string | null;
  notes: string | null;
  reach_by: string | null;
  visit_status: VisitStatus | null;
  visit_outcome: string | null;
};
type Plans = { rows: PlanRow[]; locked_weeks: { week_start: string; locked_at: string; locked_by: string | null }[] };

const DAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);
const dayName = (d: string) => DAY[new Date(`${d}T00:00:00Z`).getUTCDay()];

/** Weekly audit plan: which centre on which date, by which auditor. Used by the planner and the office. */
export default function Plan() {
  const { me } = useAuth();
  const isAdmin = me.role === 'admin';
  const [week, setWeek] = useState(weekRange(todayIST(7)).from); // default: next week
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(week, i)), [week]);
  const opts = useLoad(() => api.get<Options>('/plan/options'));
  const plans = useLoad(() => api.get<Plans>(`/plans?from=${days[0]}&to=${days[6]}`), [week]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const lock = plans.data?.locked_weeks.find((w) => w.week_start === week) ?? null;
  const editable = isAdmin || !lock;
  const rows = plans.data?.rows ?? [];

  async function run(fn: () => Promise<unknown>) {
    setError(null);
    setBusy(true);
    try {
      await fn();
      plans.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // Helpful checks for the planner
  const warnings = useMemo(() => {
    const w: string[] = [];
    const perCentre = new Map<number, string[]>();
    for (const r of rows) perCentre.set(r.centre_id, [...(perCentre.get(r.centre_id) ?? []), r.plan_date]);
    for (const [, dates] of perCentre) if (dates.length > 1) w.push(`${rows.find((r) => r.plan_date === dates[0])!.centre_name} is planned ${dates.length} times this week`);
    for (const r of rows) {
      if (!r.auditor_id) w.push(`${fmtDate(r.plan_date)} ${r.centre_name}: no auditor chosen`);
      if (r.weekly_off && dayName(r.plan_date).toLowerCase().startsWith(r.weekly_off.trim().toLowerCase().slice(0, 3)))
        w.push(`${fmtDate(r.plan_date)} ${r.centre_name}: centre is closed on ${r.weekly_off}`);
    }
    const perAuditorDay = new Map<string, number>();
    for (const r of rows) if (r.auditor_id) perAuditorDay.set(`${r.auditor_id}|${r.plan_date}`, (perAuditorDay.get(`${r.auditor_id}|${r.plan_date}`) ?? 0) + 1);
    for (const [k, n] of perAuditorDay)
      if (n > 2) {
        const [aid, d] = k.split('|');
        w.push(`${opts.data?.auditors.find((a) => a.id === Number(aid))?.name ?? 'An auditor'} has ${n} centres on ${fmtDate(d)}`);
      }
    return w;
  }, [rows, opts.data]);

  // Excel allocation sheet: download (pre-filled, with drop-downs) → fill → upload
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<PlanImportRow[] | null>(null);
  const [importing, setImporting] = useState(false);
  async function downloadTemplate() {
    setError(null);
    try {
      saveBlob(await planTemplate(days, opts.data!, rows), `Auditor_Allocation_${days[0]}_to_${days[6]}.xlsx`);
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function readFile(f: File | undefined) {
    if (!f) return;
    setError(null);
    try {
      setPreview(await parsePlan(f, days, opts.data!, rows));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  }
  async function importPlan() {
    if (!preview) return;
    setImporting(true);
    setError(null);
    try {
      for (const r of preview) {
        if (r.action === 'add') await api.post('/plans', { plan_date: r.date, centre_id: r.centre_id, auditor_id: r.auditor_id, notes: r.notes, reach_by: r.reach_by });
        if (r.action === 'update') await api.patch(`/plans/${r.existing_id}`, { auditor_id: r.auditor_id, notes: r.notes, reach_by: r.reach_by });
      }
      setPreview(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setImporting(false);
      plans.reload();
    }
  }

  const planned = new Set(rows.map((r) => r.centre_id));
  const notPlanned = (opts.data?.centres ?? []).filter((c) => !planned.has(c.id));

  async function exportExcel() {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Audit plan');
    ws.columns = [12, 12, 20, 8, 24, 18, 10, 36].map((width) => ({ width }));
    ws.pageSetup = { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
    addLogoRows(wb, ws, await loadLogos(), 5.3);
    ws.addRow([`Stock audit plan – week ${fmtDate(days[0])} to ${fmtDate(days[6])}`]).font = { bold: true, size: 13 };
    ws.addRow([lock ? `Approved ${fmtDateTime(lock.locked_at)}` : 'Draft – not yet approved']).font = { italic: true, color: { argb: 'FF64748B' } };
    ws.addRow([]);
    const head = ws.addRow(['Date', 'Day', 'Centre', 'State', 'Auditor', 'Auditor base', 'Reach by', 'Notes']);
    head.eachCell((c) => {
      c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF374151' } };
    });
    const thin = { style: 'thin' as const, color: { argb: 'FFCBD5E1' } };
    for (const r of rows)
      ws.addRow([fmtDate(r.plan_date), dayName(r.plan_date), r.centre_name, r.state, r.auditor_name ?? '', r.home_area ?? '', r.reach_by ?? '10:00', r.notes ?? '']).eachCell({ includeEmpty: true }, (c) => {
        c.border = { top: thin, left: thin, bottom: thin, right: thin };
        c.alignment = { vertical: 'top', wrapText: true };
      });
    ws.addRow([]);
    ws.addRow([`${rows.length} centre visits planned. Please share the stock statement for each day's centres on the day.`]);
    saveBlob(new Blob([await wb.xlsx.writeBuffer()]), `Audit_Plan_${days[0]}_to_${days[6]}.xlsx`);
  }

  if (!opts.data) return opts.error ? <ErrorBox error={opts.error} /> : <Loading />;

  return (
    <div>
      <PageTitle
        title="Weekly plan"
        sub="Which centre is audited on which date, and by whom. The office approves the week and sends it to the client."
        actions={
          <>
            <Button variant="secondary" onClick={exportExcel} disabled={!rows.length}>
              Download plan (Excel)
            </Button>
            <Button variant="secondary" onClick={downloadTemplate} disabled={!plans.data}>
              Allocation sheet (Excel)
            </Button>
            {editable && (
              <>
                <Button variant="secondary" onClick={() => fileRef.current?.click()} disabled={!plans.data}>
                  Upload filled plan
                </Button>
                <input ref={fileRef} type="file" accept=".xlsx" className="hidden" onChange={(e) => readFile(e.target.files?.[0])} aria-label="Filled allocation sheet" />
              </>
            )}
            {isAdmin &&
              (lock ? (
                <Button variant="secondary" busy={busy} onClick={() => run(() => api.post(`/plans/week/${week}/unlock`))}>
                  Unlock week
                </Button>
              ) : (
                <Button busy={busy} disabled={!rows.length} onClick={() => run(() => api.post(`/plans/week/${week}/lock`))}>
                  Approve &amp; lock week
                </Button>
              ))}
          </>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" onClick={() => setWeek(addDays(week, -7))} aria-label="Previous week">
          ←
        </Button>
        <input type="date" className={`${inputCls} w-auto`} value={week} onChange={(e) => e.target.value && setWeek(weekRange(e.target.value).from)} aria-label="Week" />
        <Button variant="secondary" size="sm" onClick={() => setWeek(addDays(week, 7))} aria-label="Next week">
          →
        </Button>
        <span className="text-sm text-slate-600">
          {fmtDate(days[0])} – {fmtDate(days[6])}
        </span>
        {lock ? (
          <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-800">
            Approved {fmtDateTime(lock.locked_at)}
            {lock.locked_by && ` by ${lock.locked_by}`}
          </span>
        ) : (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">Draft</span>
        )}
      </div>
      {!editable && <p className="mb-3 text-sm text-slate-600">This week is approved and locked. Ask the office to unlock it if something must change.</p>}
      <ErrorBox error={error ?? plans.error} />

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Visits planned" value={rows.length} />
        <Stat label="Centres not planned this week" value={notPlanned.length} tone={notPlanned.length ? 'amber' : undefined} />
        <Stat label="Auditors used" value={new Set(rows.map((r) => r.auditor_id).filter(Boolean)).size} />
        <Stat label="Things to check" value={warnings.length} tone={warnings.length ? 'red' : 'green'} />
      </div>
      {warnings.length > 0 && (
        <Card className="mb-4 border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <ul className="list-disc pl-5">
            {warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </Card>
      )}

      {!plans.data ? (
        <Loading />
      ) : (
        <div className="space-y-3">
          {days.map((d) => (
            <DayCard key={d} date={d} rows={rows.filter((r) => r.plan_date === d)} opts={opts.data!} editable={editable} busy={busy} run={run} showStatus={isAdmin || me.role === 'planner'} />
          ))}
        </div>
      )}
      <Modal open={!!preview} onClose={() => !importing && setPreview(null)} title="Upload filled plan – check before importing" wide>
        {preview && (
          <div className="space-y-3 text-sm">
            <p>
              <b>{preview.filter((r) => r.action === 'add').length}</b> new · <b>{preview.filter((r) => r.action === 'update').length}</b> changed ·{' '}
              {preview.filter((r) => r.action === 'same').length} unchanged ·{' '}
              <span className={preview.some((r) => r.problem) ? 'font-semibold text-red-700' : ''}>{preview.filter((r) => r.problem).length} with problems (skipped)</span>
            </p>
            <div className="max-h-[55vh] overflow-auto rounded-lg border border-slate-200">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-slate-50 text-left text-slate-500">
                  <tr>
                    <th className="px-2 py-1.5">Row</th>
                    <th className="px-2 py-1.5">Date</th>
                    <th className="px-2 py-1.5">Centre</th>
                    <th className="px-2 py-1.5">Auditor</th>
                    <th className="px-2 py-1.5">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.map((r) => (
                    <tr key={r.line} className={cx('border-t border-slate-100', r.problem && 'bg-red-50')}>
                      <td className="px-2 py-1.5 text-slate-400">{r.line}</td>
                      <td className="px-2 py-1.5">{r.label.date}</td>
                      <td className="px-2 py-1.5">{r.label.centre}</td>
                      <td className="px-2 py-1.5">{r.label.auditor}</td>
                      <td className="px-2 py-1.5">
                        {r.problem ? (
                          <span className="text-red-700">{r.problem}</span>
                        ) : (
                          <span className={r.action === 'same' ? 'text-slate-400' : 'text-green-700'}>{{ add: 'New', update: 'Change', same: 'No change' }[r.action!]}</span>
                        )}
                        {r.warning && <div className="text-amber-700">⚠ {r.warning}</div>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setPreview(null)} disabled={importing}>
                Cancel
              </Button>
              <Button onClick={importPlan} busy={importing} disabled={!preview.some((r) => r.action === 'add' || r.action === 'update')}>
                Import {preview.filter((r) => r.action === 'add' || r.action === 'update').length} lines
              </Button>
            </div>
          </div>
        )}
      </Modal>
      {notPlanned.length > 0 && (
        <p className="mt-4 text-xs text-slate-500">Not planned this week: {notPlanned.map((c) => c.name).join(', ')}</p>
      )}
    </div>
  );
}

function DayCard({
  date,
  rows,
  opts,
  editable,
  busy,
  run,
  showStatus,
}: {
  date: string;
  rows: PlanRow[];
  opts: Options;
  editable: boolean;
  busy: boolean;
  run: (fn: () => Promise<unknown>) => Promise<void>;
  showStatus: boolean;
}) {
  const [centre, setCentre] = useState('');
  const [auditor, setAuditor] = useState('');
  const isPast = date < todayIST();
  const taken = new Set(rows.map((r) => r.centre_id));
  const auditorLabel = (a: Options['auditors'][number]) => `${a.name}${a.home_area ? ` (${a.home_area})` : ''}`;

  return (
    <Card className={cx('p-3', isPast && 'opacity-80')}>
      <div className="mb-2 flex items-center justify-between">
        <div className="font-semibold">
          {dayName(date)} <span className="font-normal text-slate-500">{fmtDate(date)}</span>
        </div>
        <span className="text-xs text-slate-500">{rows.length} centre(s)</span>
      </div>
      {rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-slate-100">
                  <td className="py-1.5 pr-2 font-medium">
                    {r.centre_name} <span className="text-xs font-normal text-slate-400">{r.state}</span>
                  </td>
                  <td className="py-1.5 pr-2">
                    {editable ? (
                      <select
                        className={`${inputCls} py-1 text-sm`}
                        value={r.auditor_id ?? ''}
                        disabled={busy}
                        onChange={(e) => run(() => api.patch(`/plans/${r.id}`, { auditor_id: e.target.value ? Number(e.target.value) : null }))}
                        aria-label={`Auditor for ${r.centre_name} on ${fmtDate(date)}`}
                      >
                        <option value="">Choose auditor…</option>
                        {opts.auditors.map((a) => (
                          <option key={a.id} value={a.id}>
                            {auditorLabel(a)}
                          </option>
                        ))}
                      </select>
                    ) : (
                      (r.auditor_name ?? '—') + (r.home_area ? ` (${r.home_area})` : '')
                    )}
                  </td>
                  <td className="py-1.5 pr-2 whitespace-nowrap">
                    {editable ? (
                      <input
                        type="time"
                        className={`${inputCls} w-28 py-1 text-sm`}
                        defaultValue={r.reach_by ?? '10:00'}
                        title="Reach the showroom by"
                        onBlur={(e) => e.target.value && e.target.value !== (r.reach_by ?? '10:00') && run(() => api.patch(`/plans/${r.id}`, { reach_by: e.target.value }))}
                        aria-label={`Reach by for ${r.centre_name}`}
                      />
                    ) : (
                      <span className="text-slate-600">by {r.reach_by ?? '10:00'}</span>
                    )}
                  </td>
                  <td className="py-1.5 pr-2">
                    {editable ? (
                      <input
                        className={`${inputCls} py-1 text-sm`}
                        defaultValue={r.notes ?? ''}
                        placeholder="Notes"
                        onBlur={(e) => e.target.value !== (r.notes ?? '') && run(() => api.patch(`/plans/${r.id}`, { notes: e.target.value }))}
                        aria-label={`Notes for ${r.centre_name}`}
                      />
                    ) : (
                      <span className="text-slate-600">{r.notes}</span>
                    )}
                  </td>
                  <td className="py-1.5 pr-2 whitespace-nowrap">
                    {showStatus &&
                      (r.visit_status ? (
                        <span title={VISIT_STATUS_LABEL[r.visit_status]}>
                          <VisitBadge status={r.visit_status} />
                          {r.visit_outcome === 'not_done' && <span className="ml-1 text-xs text-red-600">not carried out</span>}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-400">waiting for stock statement</span>
                      ))}
                  </td>
                  <td className="py-1.5 text-right">
                    {editable && (
                      <button
                        className="text-sm text-red-600"
                        disabled={busy}
                        onClick={() => confirm(`Remove ${r.centre_name} from ${fmtDate(date)}?`) && run(() => api.del(`/plans/${r.id}`))}
                      >
                        Remove
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editable && (
        <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
          <select className={`${inputCls} py-1.5 text-sm`} value={centre} onChange={(e) => setCentre(e.target.value)} aria-label={`Add centre on ${fmtDate(date)}`}>
            <option value="">Add a centre…</option>
            {opts.centres
              .filter((c) => !taken.has(c.id))
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.state}){c.weekly_off ? ` – closed ${c.weekly_off}` : ''}
                </option>
              ))}
          </select>
          <select className={`${inputCls} py-1.5 text-sm`} value={auditor} onChange={(e) => setAuditor(e.target.value)} aria-label={`Auditor for new centre on ${fmtDate(date)}`}>
            <option value="">Auditor…</option>
            {opts.auditors.map((a) => (
              <option key={a.id} value={a.id}>
                {auditorLabel(a)}
              </option>
            ))}
          </select>
          <Button
            size="sm"
            disabled={!centre || busy}
            onClick={() =>
              run(async () => {
                await api.post('/plans', { plan_date: date, centre_id: Number(centre), auditor_id: auditor ? Number(auditor) : null });
                setCentre('');
              })
            }
          >
            Add
          </Button>
        </div>
      )}
    </Card>
  );
}
