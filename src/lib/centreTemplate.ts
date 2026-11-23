import ExcelJS from 'exceljs';
import { cellText, centreKey, isShortMapsLink, parseCoords } from '../../shared/domain';
import type { Centre } from './types';

/** Columns of the centre details sheet (the importer matches these headers loosely). */
export const CENTRE_COLUMNS = [
  { key: 'state', header: 'State', width: 8 },
  { key: 'name', header: 'Centre Name', width: 18 },
  { key: 'address', header: 'Centre Address', width: 48 },
  { key: 'maps', header: 'Google Maps location (link or coordinates)', width: 44 },
  { key: 'manager_name', header: 'Outlet Manager Name', width: 22 },
  { key: 'manager_phone', header: 'Manager Mobile', width: 16 },
  { key: 'opening_hours', header: 'Opening Hours', width: 18 },
  { key: 'weekly_off', header: 'Weekly Off', width: 12 },
  { key: 'remarks', header: 'Remarks', width: 36 },
] as const;

type Key = (typeof CENTRE_COLUMNS)[number]['key'];
export type CentreDetailRow = Record<Key, string>;

/** Build the template pre-filled with the given centres (and any extra rows, e.g. names to confirm). */
export async function centreTemplate(centres: Pick<Centre, 'state' | 'name' | 'address' | 'lat' | 'lng'>[], extra: Partial<CentreDetailRow>[] = []) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Centres', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = CENTRE_COLUMNS.map((c) => ({ key: c.key, header: c.header, width: c.width }));
  const head = ws.getRow(1);
  head.height = 34;
  head.eachCell((cell, col) => {
    const toFill = col >= 4 && col <= 8;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: toFill ? 'FF15803D' : 'FF374151' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  });
  const thin = { style: 'thin' as const, color: { argb: 'FFD1D5DB' } };
  const addRow = (r: Partial<CentreDetailRow>, highlight = false) => {
    const row = ws.addRow(r);
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      if (col > CENTRE_COLUMNS.length) return;
      cell.border = { top: thin, left: thin, bottom: thin, right: thin };
      cell.alignment = { vertical: 'top', wrapText: true };
      if (col === 6) cell.numFmt = '@'; // keep mobile numbers as text
      if (highlight) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF3C7' } };
    });
  };
  for (const c of centres)
    addRow({ state: c.state, name: c.name, address: c.address ?? '', maps: c.lat != null && c.lng != null ? `${c.lat}, ${c.lng}` : '' });
  for (const e of extra) addRow(e, true);

  const help = wb.addWorksheet('How to fill');
  help.getColumn(1).width = 110;
  [
    'Centre details – please fill the green columns for each centre',
    '',
    'Google Maps location – easiest way (at the showroom, on a phone):',
    '   1. Open Google Maps and tap the blue dot (your location), or long-press exactly on the showroom.',
    '   2. Tap "Share" → "Copy link" and paste the link in the green column.',
    '   Or paste the two numbers shown at the top, e.g. 23.800827, 79.454768',
    '',
    'Outlet Manager Name / Mobile – the person who signs the stock verification sheet at the centre.',
    'Opening Hours – e.g. 9:30 am – 7:00 pm.     Weekly Off – e.g. Tuesday, or "None".',
    '',
    'Rows in yellow: please confirm in Remarks whether it is a separate centre or the same as another centre (write which).',
    'New centre not in the list? Add a row at the bottom with State, Centre Name and Address.',
  ].forEach((t, i) => {
    const cell = help.getCell(i + 1, 1);
    cell.value = t;
    if (i === 0) cell.font = { bold: true, size: 13 };
  });
  return new Blob([await wb.xlsx.writeBuffer()], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

export type ParsedCentreRow = CentreDetailRow & {
  centre_id: number | null;
  coords: { lat: number; lng: number } | null;
  linkToResolve: boolean;
};

/** Read a filled template back and match each row to an existing centre (by name or saved other name). */
export async function parseCentreDetails(
  file: File,
  centres: Centre[],
  aliases: { alias: string; centre_id: number }[],
): Promise<ParsedCentreRow[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());
  const ws = wb.worksheets.find((w) => w.name.toLowerCase().includes('centre')) ?? wb.worksheets[0];
  // Find the header row and map columns by header text
  let headerRow = 0;
  const colOf: Partial<Record<Key, number>> = {};
  for (let r = 1; r <= Math.min(ws.rowCount, 10) && !headerRow; r++) {
    ws.getRow(r).eachCell((cell, col) => {
      const h = cellText(cell.value).toLowerCase();
      if (h.includes('centre name') || h.includes('center name')) colOf.name = col;
      else if (h === 'state') colOf.state = col;
      else if (h.includes('address')) colOf.address = col;
      else if (h.includes('map') || h.includes('location') || h.includes('coordinate')) colOf.maps = col;
      else if (h.includes('manager') && (h.includes('mobile') || h.includes('phone'))) colOf.manager_phone = col;
      else if (h.includes('manager')) colOf.manager_name = col;
      else if (h.includes('hour') || h.includes('timing')) colOf.opening_hours = col;
      else if (h.includes('off')) colOf.weekly_off = col;
      else if (h.includes('remark')) colOf.remarks = col;
    });
    if (colOf.name) headerRow = r;
  }
  if (!headerRow) throw new Error('Could not find a "Centre Name" column in this file.');

  const byName = new Map(centres.map((c) => [`${c.state}|${centreKey(c.name)}`, c.id]));
  const anyState = new Map(centres.map((c) => [centreKey(c.name), c.id]));
  const byAlias = new Map(aliases.map((a) => [a.alias, a.centre_id]));
  const rows: ParsedCentreRow[] = [];
  for (let r = headerRow + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const get = (k: Key) => (colOf[k] ? cellText(row.getCell(colOf[k]!).value) : '');
    const name = get('name');
    if (!name) continue;
    const state = (get('state') || 'MP').toUpperCase();
    const k = centreKey(name);
    const maps = get('maps');
    rows.push({
      state,
      name,
      address: get('address'),
      maps,
      manager_name: get('manager_name'),
      manager_phone: get('manager_phone'),
      opening_hours: get('opening_hours'),
      weekly_off: get('weekly_off'),
      remarks: get('remarks'),
      centre_id: byName.get(`${state}|${k}`) ?? byAlias.get(k) ?? anyState.get(k) ?? null,
      coords: parseCoords(maps),
      linkToResolve: !parseCoords(maps) && isShortMapsLink(maps),
    });
  }
  return rows;
}
