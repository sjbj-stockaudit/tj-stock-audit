import ExcelJS from 'exceljs';
import { cellText } from '../../shared/domain';
import { fmtDate } from './format';
import { addLogoRows, loadLogos } from './reports';

export type PlanOptions = {
  centres: { id: number; state: string; name: string; weekly_off: string | null }[];
  auditors: { id: number; name: string; phone: string | null; home_area: string | null }[];
};
export type ExistingPlan = { id: number; plan_date: string; centre_id: number; auditor_id: number | null; notes: string | null };

const DAY = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const dayName = (d: string) => DAY[new Date(`${d}T00:00:00Z`).getUTCDay()];
/** "25/11/2026 (Wednesday)" – what the planner picks in the Date column. */
const dateLabel = (d: string) => `${fmtDate(d)} (${dayName(d)})`;

/** Names shown in the dropdowns; made unique when two centres / auditors share a name. */
function labels(o: PlanOptions) {
  const centreCount = new Map<string, number>();
  for (const c of o.centres) centreCount.set(c.name.toLowerCase(), (centreCount.get(c.name.toLowerCase()) ?? 0) + 1);
  const auditorCount = new Map<string, number>();
  for (const a of o.auditors) auditorCount.set(a.name.toLowerCase(), (auditorCount.get(a.name.toLowerCase()) ?? 0) + 1);
  return {
    centre: new Map(o.centres.map((c) => [c.id, centreCount.get(c.name.toLowerCase())! > 1 ? `${c.name} (${c.state})` : c.name])),
    auditor: new Map(o.auditors.map((a) => [a.id, auditorCount.get(a.name.toLowerCase())! > 1 ? `${a.name} – ${a.phone ?? a.home_area ?? a.id}` : a.name])),
  };
}

const PLAN_ROWS = 120;

/**
 * Allocation sheet for one week: Date / Centre / Auditor / Notes, with drop-down lists of the
 * app's own centres and auditors. Lines already planned for the week are filled in.
 */
export async function planTemplate(days: string[], o: PlanOptions, existing: ExistingPlan[]): Promise<Blob> {
  const L = labels(o);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Plan', { views: [{ state: 'frozen', ySplit: 6 }] });
  ws.columns = [24, 26, 28, 20, 36].map((width) => ({ width }));
  addLogoRows(wb, ws, await loadLogos(), 3.6);
  // rows 1-4: logos; row 5: title; row 6: headers
  ws.getCell('A5').value = `Auditor allocation – week ${fmtDate(days[0])} to ${fmtDate(days[6])}`;
  ws.getCell('A5').font = { bold: true, size: 13 };
  const headers = ['Date *', 'Centre *', 'Auditor *', 'Centre weekly off', 'Notes'];
  const head = ws.getRow(6);
  headers.forEach((h, i) => (head.getCell(i + 1).value = h));
  head.height = 30;
  head.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF15803D' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  });

  // Lists sheet: the drop-down sources (and a reference for the planner)
  const lists = wb.addWorksheet('Lists');
  lists.columns = [{ width: 26 }, { width: 4 }, { width: 28 }, { width: 12 }, { width: 18 }, { width: 4 }, { width: 28 }, { width: 22 }, { width: 14 }];
  lists.getRow(1).values = ['Dates this week', '', 'Centres', 'State', 'Weekly off', '', 'Auditors', 'Base area', 'Mobile'];
  lists.getRow(1).font = { bold: true };
  days.forEach((d, i) => (lists.getCell(i + 2, 1).value = dateLabel(d)));
  o.centres.forEach((c, i) => (lists.getRow(i + 2).getCell(3).value = L.centre.get(c.id)!, lists.getRow(i + 2).getCell(4).value = c.state, lists.getRow(i + 2).getCell(5).value = c.weekly_off ?? ''));
  o.auditors.forEach((a, i) => {
    const r = lists.getRow(i + 2);
    r.getCell(7).value = L.auditor.get(a.id)!;
    r.getCell(8).value = a.home_area ?? '';
    r.getCell(9).value = a.phone ?? '';
  });
  const dateRange = `Lists!$A$2:$A$${days.length + 1}`;
  const centreRange = `Lists!$C$2:$C$${Math.max(2, o.centres.length + 1)}`;
  const auditorRange = `Lists!$G$2:$G$${Math.max(2, o.auditors.length + 1)}`;

  const thin = { style: 'thin' as const, color: { argb: 'FFD1D5DB' } };
  const sorted = [...existing].sort((a, b) => a.plan_date.localeCompare(b.plan_date) || (L.centre.get(a.centre_id) ?? '').localeCompare(L.centre.get(b.centre_id) ?? ''));
  for (let i = 0; i < Math.max(PLAN_ROWS, sorted.length + 40); i++) {
    const r = ws.getRow(7 + i);
    const p = sorted[i];
    if (p) {
      r.getCell(1).value = dateLabel(p.plan_date);
      r.getCell(2).value = L.centre.get(p.centre_id) ?? '';
      r.getCell(3).value = p.auditor_id ? L.auditor.get(p.auditor_id) ?? '' : '';
      r.getCell(5).value = p.notes ?? '';
    }
    // weekly off of the chosen centre, looked up automatically
    r.getCell(4).value = { formula: `IF(B${7 + i}="","",IFERROR(VLOOKUP(B${7 + i},Lists!$C:$E,3,FALSE),""))` };
    r.getCell(1).dataValidation = { type: 'list', allowBlank: true, formulae: [dateRange], showErrorMessage: true, errorTitle: 'Date', error: 'Choose a date of this week from the list.' };
    r.getCell(2).dataValidation = { type: 'list', allowBlank: true, formulae: [centreRange], showErrorMessage: true, errorTitle: 'Centre', error: 'Choose a centre from the list.' };
    r.getCell(3).dataValidation = { type: 'list', allowBlank: true, formulae: [auditorRange], showErrorMessage: true, errorTitle: 'Auditor', error: 'Choose an auditor from the list.' };
    for (let c = 1; c <= 5; c++) r.getCell(c).border = { top: thin, left: thin, bottom: thin, right: thin };
    r.getCell(4).font = { color: { argb: 'FF64748B' } };
  }

  const help = wb.addWorksheet('How to fill');
  help.getColumn(1).width = 110;
  [
    `How to fill the auditor allocation – week ${fmtDate(days[0])} to ${fmtDate(days[6])}`,
    '',
    'One line per centre visit. Pick from the drop-down lists in each cell:',
    '•  Date – a day of this week.',
    '•  Centre – the centre to be audited that day.',
    '•  Auditor – who audits it (see the "Lists" sheet for each auditor\'s base area and mobile).',
    '•  Notes – optional (e.g. "reach by 10 am", "manager on leave till 11").',
    '',
    '"Centre weekly off" fills in by itself – avoid planning a centre on its weekly off day.',
    'Lines already in the plan for this week are filled in; you can change the auditor or notes, or add new lines.',
    'A centre can be planned only once per day. Try not to give one auditor more than 2 centres a day,',
    'and avoid sending the same auditor to the same centre two weeks running.',
    '',
    'When done: open Weekly plan in the app → "Upload filled plan" → check the preview → Import.',
    'Lines removed from this sheet are NOT deleted in the app – remove them on the Weekly plan page.',
    'After the office approves and locks the week, it can no longer be changed by upload.',
  ].forEach((t, i) => {
    help.getCell(i + 1, 1).value = t;
    if (i === 0) help.getCell(1, 1).font = { bold: true, size: 13 };
  });
  return new Blob([await wb.xlsx.writeBuffer()], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

export type PlanImportRow = {
  line: number;
  date: string | null;
  centre_id: number | null;
  auditor_id: number | null;
  notes: string;
  label: { date: string; centre: string; auditor: string };
  action: 'add' | 'update' | 'same' | null; // null = cannot import
  existing_id: number | null;
  problem: string | null;
  warning: string | null;
};

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/** Read a filled allocation sheet and work out what will be added / changed. */
export async function parsePlan(file: File, days: string[], o: PlanOptions, existing: ExistingPlan[]): Promise<PlanImportRow[]> {
  const L = labels(o);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());
  const ws = wb.getWorksheet('Plan') ?? wb.worksheets[0];
  // find the header row (Date / Centre / Auditor)
  let headRow = 0;
  const col: Record<string, number> = {};
  for (let r = 1; r <= Math.min(15, ws.rowCount) && !headRow; r++) {
    ws.getRow(r).eachCell((cell, c) => {
      const h = norm(cellText(cell.value));
      if (h.startsWith('date')) col.date ??= c;
      else if (h.startsWith('centre') && !h.includes('off')) col.centre ??= c;
      else if (h.startsWith('auditor')) col.auditor ??= c;
      else if (h.startsWith('note')) col.notes ??= c;
    });
    if (col.date && col.centre && col.auditor) headRow = r;
    else for (const k of Object.keys(col)) delete col[k];
  }
  if (!headRow) throw new Error('Could not find the "Date", "Centre" and "Auditor" columns. Use the template from the Weekly plan page.');

  const centreBy = new Map<string, number>();
  for (const c of o.centres) {
    centreBy.set(norm(L.centre.get(c.id)!), c.id);
    centreBy.set(norm(`${c.name} (${c.state})`), c.id);
    if (!centreBy.has(norm(c.name))) centreBy.set(norm(c.name), c.id);
  }
  const auditorBy = new Map<string, number>();
  for (const a of o.auditors) {
    auditorBy.set(norm(L.auditor.get(a.id)!), a.id);
    if (!auditorBy.has(norm(a.name))) auditorBy.set(norm(a.name), a.id);
  }
  const weekSet = new Set(days);
  const seen = new Set<string>();
  const rows: PlanImportRow[] = [];
  for (let r = headRow + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const raw = (k: string) => (col[k] ? row.getCell(col[k]).value : null);
    const dateRaw = raw('date');
    const centreTxt = cellText(raw('centre'));
    const auditorTxt = cellText(raw('auditor'));
    const notes = cellText(raw('notes'));
    let dateTxt = cellText(dateRaw);
    if (!dateTxt && !centreTxt && !auditorTxt) continue;
    let date: string | null = null;
    if (dateRaw instanceof Date) date = dateRaw.toISOString().slice(0, 10);
    else {
      const m = dateTxt.match(/(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/);
      if (m) date = `${m[3].length === 2 ? `20${m[3]}` : m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
      else if (/^\d{4}-\d{2}-\d{2}/.test(dateTxt)) date = dateTxt.slice(0, 10);
    }
    if (date) dateTxt = dateLabel(date);
    const centre_id = centreBy.get(norm(centreTxt)) ?? null;
    const auditor_id = auditorBy.get(norm(auditorTxt)) ?? null;
    let problem: string | null = null;
    if (!date) problem = `Date "${cellText(dateRaw)}" not understood – pick it from the list`;
    else if (!weekSet.has(date)) problem = `${fmtDate(date)} is not in the week ${fmtDate(days[0])} – ${fmtDate(days[6])}`;
    else if (!centre_id) problem = centreTxt ? `Centre "${centreTxt}" is not in the app` : 'Centre is missing';
    else if (!auditorTxt) problem = 'Auditor is missing';
    else if (!auditor_id) problem = `Auditor "${auditorTxt}" is not in the app`;
    else if (seen.has(`${date}|${centre_id}`)) problem = 'Same centre twice on this date in the file';
    if (date && centre_id) seen.add(`${date}|${centre_id}`);
    const ex = date && centre_id ? existing.find((p) => p.plan_date === date && p.centre_id === centre_id) ?? null : null;
    let action: PlanImportRow['action'] = null;
    if (!problem) action = !ex ? 'add' : ex.auditor_id === auditor_id && (ex.notes ?? '') === notes ? 'same' : 'update';
    const c = centre_id ? o.centres.find((x) => x.id === centre_id) : null;
    const warning =
      c?.weekly_off && date && dayName(date).toLowerCase().startsWith(c.weekly_off.trim().toLowerCase().slice(0, 3)) ? `Centre is closed on ${c.weekly_off}` : null;
    rows.push({
      line: r,
      date,
      centre_id,
      auditor_id,
      notes,
      label: { date: dateTxt, centre: centreTxt, auditor: auditorTxt },
      action,
      existing_id: ex?.id ?? null,
      problem,
      warning,
    });
  }
  // more than 2 centres for one auditor on one day (counting what is already planned)
  const load = new Map<string, number>();
  const finalPlan = new Map<string, number | null>();
  for (const p of existing) finalPlan.set(`${p.plan_date}|${p.centre_id}`, p.auditor_id);
  for (const r of rows) if (r.action) finalPlan.set(`${r.date}|${r.centre_id}`, r.auditor_id);
  for (const [k, a] of finalPlan) if (a) load.set(`${k.split('|')[0]}|${a}`, (load.get(`${k.split('|')[0]}|${a}`) ?? 0) + 1);
  for (const r of rows)
    if (r.action && (load.get(`${r.date}|${r.auditor_id}`) ?? 0) > 2)
      r.warning = [r.warning, `${r.label.auditor} has ${load.get(`${r.date}|${r.auditor_id}`)} centres that day`].filter(Boolean).join('; ');
  return rows;
}
