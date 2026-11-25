import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import ExcelJS from 'exceljs';
import { api } from '../lib/api';
import { fmtDate, fmtDistance, todayIST } from '../lib/format';
import { addLogoRows, loadLogos, saveBlob } from '../lib/reports';
import type { Tractor } from '../lib/types';
import { METER_FLAG_LABEL, idKey, type TractorStatus } from '../../shared/domain';
import { useAuth } from '../App';
import { Button, Card, Empty, ErrorBox, Loading, PageTitle, Stat, TractorBadge, cx, inputCls, useLoad } from '../components/ui';

type CentreRow = {
  id: number;
  name: string;
  state: string;
  book_visit_id: number | null;
  book_date: string | null;
  book_count: number;
  audit_visit_id: number | null;
  audit_date: string | null;
  audit_status: string | null;
  audit_outcome: string | null;
  audit_book_count: number;
  verified: number;
  short: number;
  extra: number;
  accessory_qty: number;
};
type Summary = { centres: CentreRow[]; accessories: { centre_id: number; name: string; qty: number }[] };

const AS_OF_NOTE =
  'Book stock is the latest stock statement for each centre; verified / short / extra come from the latest audit. Figures are as of those dates – sales or arrivals after them are not included.';

/** Same accessory typed differently ("hood", "Hood ") counts as one item. */
const itemKey = (n: string) => n.trim().replace(/\s+/g, ' ').toLowerCase();
const itemLabel = (n: string) => n.trim().replace(/\s+/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase());

function headerRow(ws: ExcelJS.Worksheet, values: (string | number)[]) {
  const r = ws.addRow(values);
  r.eachCell((c) => {
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF374151' } };
    c.alignment = { vertical: 'middle', wrapText: true };
  });
  r.height = 32;
  return r;
}
const thin = { style: 'thin' as const, color: { argb: 'FFCBD5E1' } };
const boxed = (r: ExcelJS.Row) => r.eachCell({ includeEmpty: true }, (c) => (c.border = { top: thin, left: thin, bottom: thin, right: thin }));

// ------------------------------------------------------------------ overview: location-wise, tractor search, accessories

export default function Inventory() {
  const { me } = useAuth();
  const sum = useLoad(() => api.get<Summary>('/inventory/summary'));
  const [tab, setTab] = useState<'location' | 'tractor' | 'accessory'>('location');
  const [state, setState] = useState('');
  const [error, setError] = useState<string | null>(null);

  const rows = useMemo(() => (sum.data?.centres ?? []).filter((c) => !state || c.state === state), [sum.data, state]);
  const states = useMemo(() => [...new Set((sum.data?.centres ?? []).map((c) => c.state))], [sum.data]);
  const totals = rows.reduce(
    (t, c) => ({ book: t.book + c.book_count, verified: t.verified + c.verified, short: t.short + c.short, extra: t.extra + c.extra, acc: t.acc + c.accessory_qty }),
    { book: 0, verified: 0, short: 0, extra: 0, acc: 0 },
  );

  // Accessories item × centre (latest audit of each centre)
  const items = useMemo(() => {
    const ids = new Set(rows.map((c) => c.id));
    const m = new Map<string, { label: string; total: number; by: Map<number, number> }>();
    for (const a of sum.data?.accessories ?? []) {
      if (!ids.has(a.centre_id)) continue;
      const k = itemKey(a.name);
      const e = m.get(k) ?? { label: itemLabel(a.name), total: 0, by: new Map<number, number>() };
      e.total += a.qty;
      e.by.set(a.centre_id, (e.by.get(a.centre_id) ?? 0) + a.qty);
      m.set(k, e);
    }
    return [...m.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [sum.data, rows]);
  const centreName = (id: number) => rows.find((c) => c.id === id)?.name ?? '';

  async function exportExcel() {
    setError(null);
    try {
      const wb = new ExcelJS.Workbook();
      const logos = await loadLogos();
      const ws = wb.addWorksheet('Location-wise');
      ws.columns = [14, 20, 14, 12, 14, 12, 10, 10, 12, 30].map((width) => ({ width }));
      addLogoRows(wb, ws, logos, 7.5);
      ws.addRow([`Inventory – location-wise${state ? ` (${state})` : ''}`]).font = { bold: true, size: 13 };
      ws.addRow([AS_OF_NOTE]).font = { italic: true, color: { argb: 'FF64748B' } };
      ws.addRow([]);
      headerRow(ws, ['State', 'Centre', 'Stock statement date', 'Book stock', 'Last audit date', 'Verified', 'Short', 'Extra', 'Accessory qty', 'Note']);
      for (const c of rows)
        boxed(
          ws.addRow([c.state, c.name, c.book_date ? fmtDate(c.book_date) : '', c.book_count, c.audit_date ? fmtDate(c.audit_date) : 'Not audited', c.verified, c.short, c.extra, c.accessory_qty, noteFor(c)]),
        );
      const t = ws.addRow(['Total', '', '', totals.book, '', totals.verified, totals.short, totals.extra, totals.acc, '']);
      t.font = { bold: true };
      boxed(t);

      const wa = wb.addWorksheet('Accessories item-wise');
      const cs = rows.filter((c) => items.some((i) => i.by.has(c.id)));
      wa.columns = [{ width: 26 }, { width: 10 }, ...cs.map(() => ({ width: 12 }))];
      addLogoRows(wb, wa, logos, Math.max(2, cs.length + 0.5));
      wa.addRow(['Accessories – item-wise (latest audit of each centre)']).font = { bold: true, size: 13 };
      wa.addRow([]);
      headerRow(wa, ['Item', 'Total', ...cs.map((c) => c.name)]);
      for (const i of items) boxed(wa.addRow([i.label, i.total, ...cs.map((c) => i.by.get(c.id) ?? '')]));
      saveBlob(new Blob([await wb.xlsx.writeBuffer()]), `Inventory_${todayIST()}.xlsx`);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (!sum.data) return sum.error ? <ErrorBox error={sum.error} /> : <Loading />;
  return (
    <div>
      <PageTitle
        title="Inventory"
        sub={AS_OF_NOTE}
        actions={
          <Button variant="secondary" onClick={exportExcel} disabled={!rows.length}>
            Download Excel
          </Button>
        }
      />
      <ErrorBox error={error} />
      {!sum.data.centres.length ? (
        <Empty>No stock statement or {me.role === 'client' ? 'approved ' : ''}audit yet.</Empty>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
            <Stat label="Book stock (tractors)" value={totals.book} />
            <Stat label="Verified" value={totals.verified} tone="green" />
            <Stat label="Short" value={totals.short} tone={totals.short ? 'red' : undefined} />
            <Stat label="Extra" value={totals.extra} tone={totals.extra ? 'blue' : undefined} />
            <Stat label="Accessory items (qty)" value={totals.acc} />
          </div>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {(
              [
                ['location', 'Location-wise'],
                ['tractor', 'Find a tractor'],
                ['accessory', 'Accessories item-wise'],
              ] as const
            ).map(([k, l]) => (
              <button
                key={k}
                onClick={() => setTab(k)}
                className={cx('rounded-full px-3 py-1.5 text-sm', tab === k ? 'bg-brand-800 text-white' : 'bg-white text-slate-700 ring-1 ring-slate-200')}
              >
                {l}
              </button>
            ))}
            {states.length > 1 && tab !== 'tractor' && (
              <select className={`${inputCls} ml-auto w-auto`} value={state} onChange={(e) => setState(e.target.value)} aria-label="State">
                <option value="">All states</option>
                {states.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            )}
          </div>

          {tab === 'location' && (
            <Card className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs text-slate-500 uppercase">
                  <tr>
                    <th className="px-3 py-2">Centre</th>
                    <th className="px-3 py-2 text-right">Book stock</th>
                    <th className="px-3 py-2">Last audit</th>
                    <th className="px-3 py-2 text-right">Verified</th>
                    <th className="px-3 py-2 text-right">Short</th>
                    <th className="px-3 py-2 text-right">Extra</th>
                    <th className="px-3 py-2 text-right">Accessories</th>
                    <th className="px-3 py-2">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c) => (
                    <tr key={c.id} className="border-b border-slate-100 last:border-0">
                      <td className="px-3 py-2">
                        <Link to={`/inventory/${c.id}`} className="font-medium text-brand-800 hover:underline">
                          {c.name}
                        </Link>
                        <div className="text-xs text-slate-500">
                          {c.state}
                          {c.book_date && ` · statement ${fmtDate(c.book_date)}`}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right font-semibold">{c.book_count}</td>
                      <td className="px-3 py-2 text-xs">{c.audit_date ? fmtDate(c.audit_date) : <span className="text-slate-400">Not audited</span>}</td>
                      <td className="px-3 py-2 text-right text-green-700">{c.audit_visit_id && c.audit_outcome !== 'not_done' ? c.verified : '–'}</td>
                      <td className={cx('px-3 py-2 text-right', c.short > 0 && 'font-semibold text-red-600')}>{c.audit_visit_id && c.audit_outcome !== 'not_done' ? c.short : '–'}</td>
                      <td className={cx('px-3 py-2 text-right', c.extra > 0 && 'text-blue-700')}>{c.audit_visit_id && c.audit_outcome !== 'not_done' ? c.extra : '–'}</td>
                      <td className="px-3 py-2 text-right">{c.audit_visit_id && c.audit_outcome !== 'not_done' ? c.accessory_qty : '–'}</td>
                      <td className="px-3 py-2 text-xs text-amber-700">{noteFor(c)}</td>
                    </tr>
                  ))}
                  <tr className="bg-slate-50 font-semibold">
                    <td className="px-3 py-2">Total ({rows.length} centres)</td>
                    <td className="px-3 py-2 text-right">{totals.book}</td>
                    <td />
                    <td className="px-3 py-2 text-right">{totals.verified}</td>
                    <td className="px-3 py-2 text-right">{totals.short}</td>
                    <td className="px-3 py-2 text-right">{totals.extra}</td>
                    <td className="px-3 py-2 text-right">{totals.acc}</td>
                    <td />
                  </tr>
                </tbody>
              </table>
            </Card>
          )}
          {tab === 'tractor' && <TractorSearch />}
          {tab === 'accessory' &&
            (!items.length ? (
              <Empty>No accessories recorded in the latest audits.</Empty>
            ) : (
              <Card className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs text-slate-500 uppercase">
                    <tr>
                      <th className="px-3 py-2">Item</th>
                      <th className="px-3 py-2 text-right">Total qty</th>
                      <th className="px-3 py-2">By centre</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((i) => (
                      <tr key={i.label} className="border-b border-slate-100 align-top last:border-0">
                        <td className="px-3 py-2 font-medium">{i.label}</td>
                        <td className="px-3 py-2 text-right font-semibold">{i.total}</td>
                        <td className="px-3 py-2 text-xs text-slate-600">
                          {[...i.by.entries()].map(([cid, q]) => `${centreName(cid)} ${q}`).join(' · ')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            ))}
        </>
      )}
    </div>
  );
}

function noteFor(c: CentreRow) {
  if (!c.audit_visit_id) return 'Not audited yet';
  if (c.audit_outcome === 'not_done') return 'Last visit: centre closed / not carried out';
  if (c.book_date && c.audit_date && c.book_date > c.audit_date) return `Newer statement (${fmtDate(c.book_date)}) not audited yet`;
  if (c.audit_status === 'submitted') return 'Awaiting your approval';
  return '';
}

// ------------------------------------------------------------------ item-wise: one tractor's history

type HistoryRow = Tractor & { visit_id: number; audit_date: string; visit_status: string; centre_name: string; state: string; location_name: string | null };

function TractorSearch() {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<HistoryRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function search(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      setRows(await api.get<HistoryRow[]>(`/inventory/tractor?q=${encodeURIComponent(q)}`));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // one card per physical tractor (by chassis)
  const groups = useMemo(() => {
    const m = new Map<string, HistoryRow[]>();
    for (const r of rows ?? []) {
      const k = idKey(r.verified_chassis || r.chassis_no) || `#${r.id}`;
      m.set(k, [...(m.get(k) ?? []), r]);
    }
    return [...m.entries()];
  }, [rows]);

  return (
    <div className="space-y-3">
      <form onSubmit={search} className="flex gap-2">
        <input className={`${inputCls} font-mono uppercase`} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Chassis or registration number (part is fine)" aria-label="Tractor search" />
        <Button type="submit" busy={busy} disabled={q.trim().length < 4}>
          Search
        </Button>
      </form>
      <ErrorBox error={error} />
      {rows && !groups.length && <Empty>No tractor found for "{q}".</Empty>}
      {groups.map(([k, hist]) => {
        const first = hist[0];
        return (
          <Card key={k} className="p-3">
            <div className="mb-2">
              <div className="font-mono font-semibold">{first.verified_chassis || first.chassis_no}</div>
              <div className="text-xs text-slate-500">
                Reg {first.verified_reg || first.reg_no || '—'} {first.engine_no || first.seen_engine ? `· Engine ${first.seen_engine || first.engine_no}` : ''}
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="text-left text-slate-500">
                  <tr>
                    <th className="py-1 pr-3">Date</th>
                    <th className="py-1 pr-3">Centre</th>
                    <th className="py-1 pr-3">Result</th>
                    <th className="py-1 pr-3">Where shown</th>
                    <th className="py-1 pr-3">Meter</th>
                    <th className="py-1" />
                  </tr>
                </thead>
                <tbody>
                  {hist.map((h) => (
                    <tr key={h.id} className="border-t border-slate-100">
                      <td className="py-1.5 pr-3 whitespace-nowrap">{fmtDate(h.audit_date)}</td>
                      <td className="py-1.5 pr-3">{h.centre_name}</td>
                      <td className="py-1.5 pr-3">
                        {(h.status as string) === 'listed' || h.status === 'pending' ? (
                          <span className="text-slate-500">In stock statement (audit pending)</span>
                        ) : (
                          <TractorBadge status={h.status as TractorStatus} />
                        )}
                      </td>
                      <td className="py-1.5 pr-3">{h.status === 'verified' || h.status === 'extra' ? h.location_name ?? 'Centre' : ''}</td>
                      <td className="py-1.5 pr-3 whitespace-nowrap">{h.meter_reading != null ? `${h.meter_reading} ${h.meter_unit === 'hours' ? 'h' : 'km'}` : ''}</td>
                      <td className="py-1.5">
                        {(h.visit_status === 'approved' || h.visit_status === 'submitted') && (
                          <Link to={`/visits/${h.visit_id}`} className="text-brand-700 hover:underline">
                            Audit →
                          </Link>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        );
      })}
    </div>
  );
}

// ------------------------------------------------------------------ one centre: statement vs. last audit

type CentreDetail = {
  centre: { id: number; name: string; state: string; address: string | null };
  book: { visit_id: number; date: string; tractors: { reg_no: string | null; engine_no: string | null; chassis_no: string | null }[] } | null;
  audit: {
    visit_id: number;
    date: string;
    status: string;
    outcome: string | null;
    tractors: Tractor[];
    locations: { id: number; name: string; kind: string | null; distance_m: number | null }[];
  } | null;
  accessories: { name: string; qty: number; remarks: string | null }[];
};

export function InventoryCentre() {
  const { id } = useParams();
  const d = useLoad(() => api.get<CentreDetail>(`/inventory/centre/${id}`), [id]);
  const [error, setError] = useState<string | null>(null);
  if (!d.data) return d.error ? <ErrorBox error={d.error} /> : <Loading />;
  const { centre, book, audit, accessories } = d.data;
  const auditedAgainstSame = !!book && !!audit && book.visit_id === audit.visit_id;
  const found = new Map((audit?.tractors ?? []).filter((t) => t.source === 'inventory').map((t) => [idKey(t.chassis_no), t]));
  const lines = (book?.tractors ?? []).map((b) => ({ b, a: found.get(idKey(b.chassis_no)) ?? null }));
  const extras = (audit?.tractors ?? []).filter((t) => t.source === 'extra');
  const place = (t: Tractor) => (t.location_id ? audit?.locations.find((l) => l.id === t.location_id)?.name ?? 'Other place' : 'Centre');
  const resultOf = (a: Tractor | null): string =>
    !audit || audit.outcome === 'not_done' ? 'Not audited' : !a ? (auditedAgainstSame ? 'Not found' : 'Not in last audit') : a.status === 'verified' ? 'Verified' : a.status === 'not_found' ? 'Short' : a.status;
  const meter = (t: Tractor | null) => (t?.meter_reading != null ? `${t.meter_reading} ${t.meter_unit === 'hours' ? 'h' : 'km'}` : '');

  async function exportExcel() {
    setError(null);
    try {
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet(centre.name.slice(0, 31));
      ws.columns = [16, 22, 18, 16, 16, 14, 18, 30].map((width) => ({ width }));
      addLogoRows(wb, ws, await loadLogos(), 6.5);
      ws.addRow([`Inventory – ${centre.name}, ${centre.state}`]).font = { bold: true, size: 13 };
      ws.addRow([`Stock statement: ${book ? fmtDate(book.date) : '—'} · Last audit: ${audit ? fmtDate(audit.date) : '—'}`]);
      ws.addRow([]);
      headerRow(ws, ['Registration No', 'Chassis No', 'Engine No', 'Result', 'Where shown', 'Meter', 'Change since last audit', 'Remarks']);
      for (const { b, a } of lines) {
        const r = ws.addRow([b.reg_no ?? '', b.chassis_no ?? '', b.engine_no ?? '', resultOf(a), a && a.status === 'verified' ? place(a) : '', meter(a), a?.meter_diff != null ? a.meter_diff : '', a?.meter_flag ? METER_FLAG_LABEL[a.meter_flag] : a?.remarks ?? '']);
        r.getCell(2).numFmt = '@';
        boxed(r);
      }
      if (extras.length) {
        ws.addRow([]);
        headerRow(ws, ['Extra – Registration No', 'Chassis No', 'Engine No', 'Result', 'Where shown', 'Meter', '', 'Remarks']);
        for (const t of extras) boxed(ws.addRow([t.verified_reg ?? '', t.verified_chassis ?? '', t.seen_engine ?? '', 'Extra', place(t), meter(t), '', t.remarks ?? '']));
      }
      if (accessories.length) {
        ws.addRow([]);
        headerRow(ws, ['Accessory', 'Qty', 'Remarks']);
        for (const a of accessories) boxed(ws.addRow([a.name, a.qty, a.remarks ?? '']));
      }
      saveBlob(new Blob([await wb.xlsx.writeBuffer()]), `Inventory_${centre.name.replace(/\W+/g, '_')}.xlsx`);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const short = lines.filter(({ a }) => resultOf(a) === 'Short' || resultOf(a) === 'Not found').length;
  return (
    <div>
      <div className="mb-2 text-sm">
        <Link to="/inventory" className="text-brand-700 hover:underline">
          ← Inventory
        </Link>
      </div>
      <PageTitle
        title={`${centre.name}, ${centre.state}`}
        sub={`Stock statement ${book ? fmtDate(book.date) : '—'} · last audit ${audit ? fmtDate(audit.date) : 'none yet'}${audit?.status === 'submitted' ? ' (awaiting approval)' : ''}`}
        actions={
          <>
            {audit && (
              <Link to={`/visits/${audit.visit_id}`} className="rounded-lg px-3 py-2 text-sm text-brand-800 ring-1 ring-slate-300 hover:bg-slate-50">
                Open audit
              </Link>
            )}
            <Button variant="secondary" onClick={exportExcel}>
              Download Excel
            </Button>
          </>
        }
      />
      <ErrorBox error={error} />
      {book && audit && !auditedAgainstSame && (
        <p className="mb-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
          The latest stock statement ({fmtDate(book.date)}) has not been audited yet. Results below are from the audit of {fmtDate(audit.date)}, matched by chassis number.
        </p>
      )}
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Book stock" value={lines.length} />
        <Stat label="Verified" value={lines.filter(({ a }) => a?.status === 'verified').length} tone="green" />
        <Stat label="Short / not found" value={short} tone={short ? 'red' : undefined} />
        <Stat label="Extra" value={extras.length} tone={extras.length ? 'blue' : undefined} />
        <Stat label="Accessory qty" value={accessories.reduce((n, a) => n + a.qty, 0)} />
      </div>
      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs text-slate-500 uppercase">
            <tr>
              <th className="px-3 py-2">Reg. no</th>
              <th className="px-3 py-2">Chassis</th>
              <th className="px-3 py-2">Result</th>
              <th className="px-3 py-2">Where shown</th>
              <th className="px-3 py-2">Meter</th>
            </tr>
          </thead>
          <tbody>
            {lines.map(({ b, a }, i) => {
              const res = resultOf(a);
              return (
                <tr key={i} className="border-b border-slate-100 last:border-0">
                  <td className="px-3 py-2 font-mono text-xs">{b.reg_no}</td>
                  <td className="px-3 py-2 font-mono text-xs">{b.chassis_no}</td>
                  <td className="px-3 py-2">
                    <span className={cx('text-xs font-medium', res === 'Verified' ? 'text-green-700' : res === 'Short' || res === 'Not found' ? 'text-red-600' : 'text-slate-500')}>{res}</span>
                  </td>
                  <td className="px-3 py-2 text-xs">{a?.status === 'verified' ? place(a) : ''}</td>
                  <td className="px-3 py-2 text-xs whitespace-nowrap">
                    {meter(a)}
                    {a?.meter_diff != null && <span className="text-slate-500"> ({a.meter_diff >= 0 ? '+' : ''}{a.meter_diff})</span>}
                    {a?.meter_flag && <div className="font-semibold text-red-600">⚠ {METER_FLAG_LABEL[a.meter_flag]}</div>}
                  </td>
                </tr>
              );
            })}
            {!lines.length && (
              <tr>
                <td colSpan={5} className="px-3 py-4 text-center text-slate-500">
                  No stock statement uploaded for this centre yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Card>
      {extras.length > 0 && (
        <>
          <h2 className="mt-6 mb-2 font-semibold">Extra – shown but not in the records ({extras.length})</h2>
          <Card className="overflow-x-auto">
            <table className="w-full text-sm">
              <tbody>
                {extras.map((t) => (
                  <tr key={t.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-3 py-2 font-mono text-xs">{t.verified_reg}</td>
                    <td className="px-3 py-2 font-mono text-xs">{t.verified_chassis}</td>
                    <td className="px-3 py-2 text-xs">{place(t)}</td>
                    <td className="px-3 py-2 text-xs">{meter(t)}</td>
                    <td className="px-3 py-2 text-xs text-slate-600">{t.remarks}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}
      {audit && audit.locations.length > 0 && (
        <p className="mt-3 text-xs text-slate-500">
          Other places tractors were shown at: {audit.locations.map((l) => `${l.name}${l.distance_m != null ? ` (${fmtDistance(l.distance_m)} away)` : ''}`).join(', ')}
        </p>
      )}
      <h2 className="mt-6 mb-2 font-semibold">Accessories ({accessories.length})</h2>
      {!accessories.length ? (
        <p className="text-sm text-slate-500">None recorded in the last audit.</p>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full text-sm">
            <tbody>
              {accessories.map((a, i) => (
                <tr key={i} className="border-b border-slate-100 last:border-0">
                  <td className="px-3 py-2 font-medium">{a.name}</td>
                  <td className="px-3 py-2 text-right">{a.qty}</td>
                  <td className="px-3 py-2 text-xs text-slate-600">{a.remarks}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
