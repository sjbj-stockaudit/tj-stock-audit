import ExcelJS from 'exceljs';
import { jsPDF } from 'jspdf';
import JSZip from 'jszip';
import { TRACTOR_STATUS_LABEL } from '../../shared/domain';
import { api, fetchBlob } from './api';
import { fmtDate, fmtDateTime, safeName } from './format';
import type { Photo, Settings, Tractor, VisitDetail } from './types';

// ------------------------------------------------------------------ helpers

export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

const tractorName = (t: Tractor) => t.verified_reg || t.reg_no || t.verified_chassis || t.chassis_no || `Tractor-${t.id}`;
const baseName = (d: VisitDetail) => `${safeName(d.visit.centre_name)}_${d.visit.audit_date}`;

export function summarise(d: VisitDetail) {
  const inv = d.tractors.filter((t) => t.source === 'inventory');
  return {
    inventory: inv.length,
    verified: inv.filter((t) => t.status === 'verified').length,
    mismatch: inv.filter((t) => t.status === 'mismatch'),
    short: inv.filter((t) => t.status === 'not_found'),
    extra: d.tractors.filter((t) => t.source === 'extra'),
    pending: inv.filter((t) => t.status === 'pending').length,
  };
}

const HEADER_FILL: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF374151' } };
const STATUS_FILL: Record<string, string> = {
  verified: 'FFDCFCE7',
  mismatch: 'FFFEF3C7',
  not_found: 'FFFEE2E2',
  extra: 'FFDBEAFE',
};
const thin: Partial<ExcelJS.Borders> = {
  top: { style: 'thin' },
  left: { style: 'thin' },
  bottom: { style: 'thin' },
  right: { style: 'thin' },
};

function styleHeader(row: ExcelJS.Row) {
  row.eachCell((c) => {
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = HEADER_FILL;
    c.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
    c.border = thin;
  });
  row.height = 46;
}

type Img = { bytes: Uint8Array; w: number; h: number; type: 'JPEG' | 'PNG' };
/** Client's logo (top left) and the audit firm's logo (top right) on every report. */
export type Logos = { client: Img | null; firm: Img | null };

async function loadStatic(url: string): Promise<Img | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    const bmp = await createImageBitmap(blob);
    const img: Img = { bytes: new Uint8Array(await blob.arrayBuffer()), w: bmp.width, h: bmp.height, type: 'PNG' };
    bmp.close();
    return img;
  } catch {
    return null;
  }
}

let logosCache: Promise<Logos> | null = null;
export function loadLogos(): Promise<Logos> {
  logosCache ??= Promise.all([loadStatic('/brand/tj-logo.png'), loadStatic('/brand/sjbj-logo.png')]).then(([client, firm]) => ({ client, firm }));
  return logosCache;
}

const logoIds = new WeakMap<ExcelJS.Workbook, { client?: number; firm?: number }>();
/** Reserve rows at the top of a sheet and place both logos: client left, firm right (col = 0-based column of the right edge). */
function addLogoRows(wb: ExcelJS.Workbook, ws: ExcelJS.Worksheet, logos: Logos | undefined, rightCol: number) {
  for (let i = 0; i < 4; i++) ws.addRow([]).height = 19;
  if (!logos) return;
  let ids = logoIds.get(wb);
  if (!ids) {
    ids = {
      client: logos.client ? wb.addImage({ buffer: logos.client.bytes as unknown as ExcelJS.Buffer, extension: 'png' }) : undefined,
      firm: logos.firm ? wb.addImage({ buffer: logos.firm.bytes as unknown as ExcelJS.Buffer, extension: 'png' }) : undefined,
    };
    logoIds.set(wb, ids);
  }
  if (ids.client !== undefined && logos.client) {
    const h = 88;
    ws.addImage(ids.client, { tl: { col: 0.05, row: 0.1 }, ext: { width: (logos.client.w / logos.client.h) * h, height: h } });
  }
  if (ids.firm !== undefined && logos.firm) {
    const w = 230;
    ws.addImage(ids.firm, { tl: { col: rightCol, row: 1.2 }, ext: { width: w, height: (logos.firm.h / logos.firm.w) * w } });
  }
}

/** One worksheet in the client's "Physical stock count and reconciliation" format. */
function addCentreSheet(wb: ExcelJS.Workbook, d: VisitDetail, s: Settings, logos?: Logos, sheetName?: string) {
  const v = d.visit;
  const ws = wb.addWorksheet((sheetName ?? v.centre_name).slice(0, 31));
  ws.columns = [{ width: 24 }, { width: 22 }, { width: 24 }, { width: 28 }, { width: 40 }];
  ws.pageSetup = { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0, margins: { left: 0.4, right: 0.4, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 } };
  addLogoRows(wb, ws, logos, 4.15);
  const top = ws.addRow(['Physical stock count and reconciliation and Chassis number verification']);
  top.font = { bold: true, size: 13 };
  ws.mergeCells(top.number, 1, top.number, 5);
  ws.addRow(['Firm:', s.client_name]);
  ws.addRow(['Location:', `${v.centre_name}, ${v.state}`]);
  ws.addRow(['Date:', fmtDate(v.audit_date)]);
  ws.addRow(['Verified By:', s.firm_name]);
  ws.addRow(['Auditor:', v.auditor_name ?? '']);
  for (let r = top.number + 1; r <= top.number + 5; r++) ws.getCell(r, 1).font = { bold: true };
  ws.addRow([]);

  styleHeader(
    ws.addRow([
      'chassisNumber',
      'RC Number (as verified by the auditor)',
      'Chassis Number (as verified by the auditor)',
      'Status: Verified / Chassis Number Mismatch / Not Found',
      'Remarks',
    ]),
  );
  for (const t of d.tractors) {
    const row = ws.addRow([
      t.source === 'extra' ? '(not in inventory)' : t.chassis_no ?? '',
      t.status === 'not_found' ? '' : t.verified_reg ?? t.reg_no ?? '',
      t.status === 'not_found' ? '' : t.verified_chassis ?? '',
      TRACTOR_STATUS_LABEL[t.status],
      t.remarks || (t.source === 'inventory' && t.status === 'not_found' ? `Listed as ${t.reg_no ?? ''}` : 'NA'),
    ]);
    row.eachCell({ includeEmpty: true }, (c, col) => {
      c.border = thin;
      c.alignment = { vertical: 'middle', wrapText: col === 5 };
      // keep long chassis numbers as text so Excel does not turn them into 9.3E+11
      if (col <= 3) c.numFmt = '@';
    });
    const fill = STATUS_FILL[t.status];
    if (fill) row.getCell(4).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
  }

  const sum = summarise(d);
  ws.addRow([]);
  styleHeader(ws.addRow(['Summary', 'Count']));
  const lines: [string, number][] = [
    ['Tractors in inventory list', sum.inventory],
    ['Verified', sum.verified],
    ['Chassis number mismatch', sum.mismatch.length],
    ['Short (in inventory, not found)', sum.short.length],
    ['Extra (found, not in inventory)', sum.extra.length],
  ];
  for (const l of lines) ws.addRow(l).eachCell((c) => (c.border = thin));

  if (sum.short.length || sum.extra.length) {
    ws.addRow([]);
    styleHeader(ws.addRow(['Short / Extra', 'Registration No', 'Chassis No', 'Engine No', 'Remarks']));
    for (const t of sum.short) ws.addRow(['Short', t.reg_no, t.chassis_no, t.engine_no, t.remarks ?? '']).eachCell((c) => (c.border = thin));
    for (const t of sum.extra) ws.addRow(['Extra', t.reg_no, t.chassis_no, '', t.remarks ?? '']).eachCell((c) => (c.border = thin));
  }

  ws.addRow([]);
  styleHeader(ws.addRow(['Accessories', 'Qty', 'Remark']));
  ws.mergeCells(ws.rowCount, 3, ws.rowCount, 5);
  if (!d.accessories.length) ws.addRow(['None recorded', '', '']);
  for (const a of d.accessories) {
    const row = ws.addRow([a.name, a.qty, a.remarks || 'NA']);
    ws.mergeCells(row.number, 3, row.number, 5);
    row.eachCell((c) => (c.border = thin));
  }

  ws.addRow([]);
  ws.addRow(['Name of Auditor:', v.auditor_name ?? '', '', 'Name of Manager:', v.manager_name ?? '']);
  ws.addRow(['Check-in:', fmtDateTime(v.checkin_at), '', 'Check-out:', fmtDateTime(v.checkout_at)]);
  if (v.general_remarks) ws.addRow(['General remarks:', v.general_remarks]);
  return ws;
}

export async function centreWorkbook(d: VisitDetail, s: Settings): Promise<Blob> {
  const wb = new ExcelJS.Workbook();
  wb.creator = s.firm_name;
  addCentreSheet(wb, d, s, await loadLogos());
  return new Blob([await wb.xlsx.writeBuffer()], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

// ------------------------------------------------------------------ PDF of photos

async function loadImg(path: string): Promise<Img | null> {
  try {
    const blob = await fetchBlob(path);
    const bmp = await createImageBitmap(blob);
    const img: Img = { bytes: new Uint8Array(await blob.arrayBuffer()), w: bmp.width, h: bmp.height, type: blob.type.includes('png') ? 'PNG' : 'JPEG' };
    bmp.close();
    return img;
  } catch {
    return null;
  }
}

/** Load all photos of a visit once; reused for the PDF and the photo folder in the zip. */
async function loadPhotos(d: VisitDetail, onProgress?: (msg: string) => void) {
  const map = new Map<number, Img>();
  let done = 0;
  const queue = [...d.photos];
  const worker = async () => {
    for (let p = queue.shift(); p; p = queue.shift()) {
      const img = await loadImg(`/photos/${p.id}`);
      if (img) map.set(p.id, img);
      onProgress?.(`${d.visit.centre_name}: photos ${++done}/${d.photos.length}`);
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  return map;
}

function photoPdf(
  d: VisitDetail,
  s: Settings,
  imgs: Map<number, Img>,
  sigs: { auditor: Img | null; manager: Img | null; selfie: Img | null },
  logos?: Logos,
): Blob {
  const v = d.visit;
  const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = 210;
  const M = 12;
  const sum = summarise(d);

  // Cover page: client logo top left, audit firm logo top right
  if (logos?.client) {
    const h = 20;
    pdf.addImage(logos.client.bytes, 'PNG', M, 8, (logos.client.w / logos.client.h) * h, h);
  }
  if (logos?.firm) {
    const w = 55;
    pdf.addImage(logos.firm.bytes, 'PNG', W - M - w, 13, w, (logos.firm.h / logos.firm.w) * w);
  }
  pdf.setDrawColor(220).line(M, 30, W - M, 30);
  const T = 19; // everything below the logo band moves down by this much
  pdf.setFont('helvetica', 'bold').setFontSize(15).text('Stock Verification – Photo Report', M, 20 + T);
  pdf.setFont('helvetica', 'normal').setFontSize(10);
  const info = [
    ['Firm', s.client_name],
    ['Location', `${v.centre_name}, ${v.state}`],
    ['Date', fmtDate(v.audit_date)],
    ['Verified by', s.firm_name],
    ['Auditor', v.auditor_name ?? ''],
    ['Outlet manager', v.manager_name ?? ''],
    ['Check-in / out', `${fmtDateTime(v.checkin_at)}  to  ${fmtDateTime(v.checkout_at)}`],
  ];
  info.forEach(([k, val], i) => {
    pdf.setFont('helvetica', 'bold').text(`${k}:`, M, 32 + T + i * 6);
    pdf.setFont('helvetica', 'normal').text(String(val), M + 32, 32 + T + i * 6, { maxWidth: 110 });
  });
  // Auditor's live selfie at check-in, top right of the cover page
  if (sigs.selfie) {
    const r = Math.min(45 / sigs.selfie.w, 60 / sigs.selfie.h);
    const w = sigs.selfie.w * r;
    pdf.addImage(sigs.selfie.bytes, sigs.selfie.type, W - M - w, 26 + T, w, sigs.selfie.h * r);
    pdf.setFontSize(7).setTextColor(100).text('Auditor selfie at check-in', W - M - w, 26 + T + sigs.selfie.h * r + 4);
    pdf.setFontSize(10).setTextColor(0);
  }
  let y = 32 + T + info.length * 6 + 6;
  pdf.setFont('helvetica', 'bold').text('Summary', M, y);
  pdf.setFont('helvetica', 'normal');
  [
    `Tractors in inventory: ${sum.inventory}`,
    `Verified: ${sum.verified}`,
    `Chassis number mismatch: ${sum.mismatch.length}`,
    `Short (not found): ${sum.short.length}`,
    `Extra (not in inventory): ${sum.extra.length}`,
    `Accessory lines: ${d.accessories.length}`,
  ].forEach((l, i) => pdf.text(l, M + 4, y + 6 + i * 5));
  y += 6 + 6 * 5 + 4;
  const listBlock = (title: string, items: Tractor[]) => {
    if (!items.length) return;
    pdf.setFont('helvetica', 'bold').text(title, M, y);
    pdf.setFont('helvetica', 'normal');
    for (const t of items) {
      // Long remarks wrap onto following lines instead of running off the page
      const lines: string[] = pdf.splitTextToSize(`• ${t.reg_no ?? ''}   Chassis ${t.chassis_no ?? ''}${t.remarks ? `   – ${t.remarks}` : ''}`, W - 2 * M - 8);
      for (const [i, line] of lines.entries()) {
        y += 5;
        if (y > 280) (pdf.addPage(), (y = 20));
        pdf.text(i ? `   ${line}` : line, M + 4, y);
      }
    }
    y += 8;
  };
  listBlock('Short tractors (in inventory, not physically present)', sum.short);
  listBlock('Extra tractors (physically present, not in inventory)', sum.extra);
  listBlock('Chassis number mismatches', sum.mismatch);

  // Photo pages: two photos per page, each captioned with the registration number
  const entries: { caption: string; sub: string; img: Img }[] = [];
  for (const p of d.photos.filter((x) => x.kind === 'storefront')) {
    const img = imgs.get(p.id);
    if (img) entries.push({ caption: `Storefront – ${v.centre_name}`, sub: `Taken: ${fmtDateTime(p.taken_at)}`, img });
  }
  for (const t of d.tractors) {
    const ps = d.photos.filter((p) => p.tractor_id === t.id).sort((a, b) => (a.kind === 'chassis' ? -1 : b.kind === 'chassis' ? 1 : 0));
    for (const p of ps) {
      const img = imgs.get(p.id);
      if (img)
        entries.push({
          caption: `${tractorName(t)} – ${p.kind === 'chassis' ? 'Chassis number' : 'Tractor'}`,
          sub: `Chassis: ${t.verified_chassis || t.chassis_no || '—'}   Status: ${TRACTOR_STATUS_LABEL[t.status]}   Taken: ${fmtDateTime(p.taken_at)}`,
          img,
        });
    }
  }
  for (const a of d.accessories)
    for (const p of d.photos.filter((x) => x.accessory_id === a.id)) {
      const img = imgs.get(p.id);
      if (img) entries.push({ caption: `Accessory – ${a.name} (Qty ${a.qty})`, sub: a.remarks ?? '', img });
    }

  const slotH = 130;
  entries.forEach((e, i) => {
    if (i % 2 === 0) pdf.addPage();
    const top = 12 + (i % 2) * (slotH + 8);
    pdf.setFont('helvetica', 'bold').setFontSize(11).text(e.caption, M, top + 4);
    pdf.setFont('helvetica', 'normal').setFontSize(8).text(e.sub, M, top + 9, { maxWidth: W - 2 * M });
    const maxW = W - 2 * M;
    const maxH = slotH - 14;
    const r = Math.min(maxW / e.img.w, maxH / e.img.h);
    const iw = e.img.w * r;
    const ih = e.img.h * r;
    pdf.addImage(e.img.bytes, e.img.type, M + (maxW - iw) / 2, top + 12, iw, ih);
  });

  // Signatures
  pdf.addPage();
  pdf.setFont('helvetica', 'bold').setFontSize(12).text('Signatures', M, 20);
  const sig = (img: Img | null, label: string, name: string, x: number) => {
    if (img) {
      const r = Math.min(80 / img.w, 40 / img.h);
      pdf.addImage(img.bytes, img.type, x, 28, img.w * r, img.h * r);
    }
    pdf.setFont('helvetica', 'normal').setFontSize(10).text(`${label}: ${name}`, x, 75);
  };
  sig(sigs.auditor, 'Auditor', v.auditor_name ?? '', M);
  sig(sigs.manager, 'Outlet manager', v.manager_name ?? '', 110);

  const pages = pdf.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    pdf.setPage(i);
    pdf.setFontSize(8).setTextColor(120).text(`${v.centre_name} · ${fmtDate(v.audit_date)} · ${s.firm_name} · Page ${i}/${pages}`, M, 290);
    pdf.setTextColor(0);
  }
  return pdf.output('blob');
}

// ------------------------------------------------------------------ zips

async function addCentreToZip(folder: JSZip, d: VisitDetail, s: Settings, onProgress?: (m: string) => void) {
  const imgs = await loadPhotos(d, onProgress);
  const sigs = {
    auditor: d.visit.has_auditor_signature ? await loadImg(`/visits/${d.visit.id}/signature/auditor`) : null,
    manager: d.visit.has_manager_signature ? await loadImg(`/visits/${d.visit.id}/signature/manager`) : null,
    selfie: d.visit.has_checkin_selfie ? await loadImg(`/visits/${d.visit.id}/checkin-selfie`) : null,
  };
  const name = baseName(d);
  folder.file(`Stock_Verification_${name}.xlsx`, await centreWorkbook(d, s));
  folder.file(`Photos_${name}.pdf`, photoPdf(d, s, imgs, sigs, await loadLogos()));
  // Individual photos, each named by the tractor's registration number
  const used = new Set<string>();
  const unique = (n: string) => {
    let f = n;
    for (let i = 2; used.has(f); i++) f = n.replace(/(\.\w+)$/, `_${i}$1`);
    used.add(f);
    return f;
  };
  const ext = (p: Photo) => (imgs.get(p.id)?.type === 'PNG' ? 'png' : 'jpg');
  for (const t of d.tractors)
    for (const p of d.photos.filter((x) => x.tractor_id === t.id)) {
      const img = imgs.get(p.id);
      if (img) folder.file(`photos/${unique(`${safeName(tractorName(t))}${p.kind === 'tractor' ? '_tractor' : ''}.${ext(p)}`)}`, img.bytes);
    }
  for (const p of d.photos.filter((x) => x.kind === 'storefront')) {
    const img = imgs.get(p.id);
    if (img) folder.file(`photos/${unique(`Storefront.${ext(p)}`)}`, img.bytes);
  }
  for (const a of d.accessories)
    for (const p of d.photos.filter((x) => x.accessory_id === a.id)) {
      const img = imgs.get(p.id);
      if (img) folder.file(`photos/accessories/${unique(`${safeName(a.name)}.${ext(p)}`)}`, img.bytes);
    }
}

export async function loadDetail(id: number) {
  return api.get<VisitDetail>(`/visits/${id}`);
}

/** Excel + photo PDF + photos for one centre. */
export async function downloadCentreReport(id: number, onProgress?: (m: string) => void) {
  const [d, s] = await Promise.all([loadDetail(id), api.get<Settings>('/settings')]);
  const zip = new JSZip();
  await addCentreToZip(zip, d, s, onProgress);
  onProgress?.('Creating zip…');
  saveBlob(await zip.generateAsync({ type: 'blob' }), `Stock_Verification_${baseName(d)}.zip`);
}

export async function downloadCentreExcel(id: number) {
  const [d, s] = await Promise.all([loadDetail(id), api.get<Settings>('/settings')]);
  saveBlob(await centreWorkbook(d, s), `Stock_Verification_${baseName(d)}.xlsx`);
}

/** Weekly deliverable: one consolidated Excel for all centres plus each centre's folder. */
export async function downloadConsolidated(ids: number[], label: string, onProgress?: (m: string) => void) {
  const s = await api.get<Settings>('/settings');
  const details: VisitDetail[] = [];
  for (const [i, id] of ids.entries()) {
    onProgress?.(`Loading audit ${i + 1}/${ids.length}…`);
    details.push(await loadDetail(id));
  }
  details.sort((a, b) => a.visit.audit_date.localeCompare(b.visit.audit_date) || a.visit.centre_name.localeCompare(b.visit.centre_name));

  const wb = new ExcelJS.Workbook();
  wb.creator = s.firm_name;
  const summary = wb.addWorksheet('Summary');
  summary.columns = [12, 18, 14, 18, 12, 12, 12, 12, 12, 20].map((width) => ({ width }));
  const logos = await loadLogos();
  summary.pageSetup = { orientation: 'landscape', paperSize: 9, fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  addLogoRows(wb, summary, logos, 7.2);
  summary.addRow([`Consolidated stock verification – ${label}`]).font = { bold: true, size: 13 };
  summary.addRow([`${s.client_name} · Verified by ${s.firm_name}`]);
  summary.addRow([]);
  styleHeader(summary.addRow(['Date', 'Centre', 'State', 'Auditor', 'Inventory', 'Verified', 'Mismatch', 'Short', 'Extra', 'Manager']));
  const all = wb.addWorksheet('Full inventory');
  all.columns = [12, 16, 16, 22, 22, 22, 26, 30].map((width) => ({ width }));
  styleHeader(all.addRow(['Date', 'Centre', 'Registration No (inventory)', 'Chassis No (inventory)', 'RC No (verified)', 'Chassis No (verified)', 'Status', 'Remarks']));

  const sheetNames = new Set<string>();
  for (const d of details) {
    const sum = summarise(d);
    summary
      .addRow([fmtDate(d.visit.audit_date), d.visit.centre_name, d.visit.state, d.visit.auditor_name, sum.inventory, sum.verified, sum.mismatch.length, sum.short.length, sum.extra.length, d.visit.manager_name])
      .eachCell((c) => (c.border = thin));
    for (const t of d.tractors) {
      const row = all.addRow([
        fmtDate(d.visit.audit_date),
        d.visit.centre_name,
        t.source === 'extra' ? '' : t.reg_no,
        t.source === 'extra' ? '' : t.chassis_no,
        t.verified_reg,
        t.verified_chassis,
        TRACTOR_STATUS_LABEL[t.status],
        t.remarks ?? '',
      ]);
      row.eachCell({ includeEmpty: true }, (c) => (c.border = thin));
      const fill = STATUS_FILL[t.status];
      if (fill) row.getCell(7).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
    }
    let sn = d.visit.centre_name.slice(0, 24);
    if (sheetNames.has(sn)) sn = `${sn.slice(0, 18)} ${d.visit.audit_date.slice(5)}`;
    sheetNames.add(sn);
    addCentreSheet(wb, d, s, logos, sn);
  }
  const zip = new JSZip();
  zip.file(`Consolidated_Stock_Verification_${safeName(label)}.xlsx`, await wb.xlsx.writeBuffer());
  for (const d of details) await addCentreToZip(zip.folder(baseName(d))!, d, s, onProgress);
  onProgress?.('Creating zip…');
  saveBlob(await zip.generateAsync({ type: 'blob' }), `Stock_Verification_${safeName(label)}.zip`);
}
