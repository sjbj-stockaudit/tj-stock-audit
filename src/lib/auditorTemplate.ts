import ExcelJS from 'exceljs';
import { cellText } from '../../shared/domain';
import type { User } from './types';

const COLUMNS = [
  { key: 'name', header: 'Full Name *', width: 26 },
  { key: 'phone', header: 'Mobile Number *', width: 16 },
  { key: 'home_area', header: 'Home Town / Base Area *', width: 22 },
  { key: 'id_type', header: 'ID Proof Type (Aadhaar / PAN / DL / Voter ID)', width: 22 },
  { key: 'id_last4', header: 'ID Number – last 4 digits only', width: 16 },
  { key: 'phone_type', header: 'Phone (Android / iPhone)', width: 16 },
  { key: 'remarks', header: 'Remarks', width: 26 },
] as const;

/** Blank template for collecting auditor details (no mention of who supplies the staff). */
export async function auditorTemplate(): Promise<Blob> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Auditors', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = COLUMNS.map((c) => ({ key: c.key, header: c.header, width: c.width }));
  const head = ws.getRow(1);
  head.height = 36;
  head.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF15803D' } };
    cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  });
  const thin = { style: 'thin' as const, color: { argb: 'FFD1D5DB' } };
  for (let r = 2; r <= 31; r++) {
    const row = ws.getRow(r);
    for (let c = 1; c <= COLUMNS.length; c++) {
      const cell = row.getCell(c);
      cell.border = { top: thin, left: thin, bottom: thin, right: thin };
      if (c === 2 || c === 5) cell.numFmt = '@'; // keep numbers as text
    }
    ws.getCell(r, 4).dataValidation = { type: 'list', allowBlank: true, formulae: ['"Aadhaar,PAN,Driving Licence,Voter ID,Passport"'] };
    ws.getCell(r, 6).dataValidation = { type: 'list', allowBlank: true, formulae: ['"Android,iPhone"'] };
  }
  const help = wb.addWorksheet('How to fill');
  help.getColumn(1).width = 100;
  [
    'Auditor details – one row per person',
    '',
    'Full Name, Mobile Number and Home Town / Base Area are required.',
    'Mobile Number: the 10-digit number the person will carry on audits (their login is linked to it).',
    'Home Town / Base Area: where they are based, so nearby centres can be assigned to them.',
    'ID Proof: write only the type and the LAST 4 DIGITS of the number (do not send full Aadhaar numbers).',
    'Phone: Android is recommended for field work (location keeps working with the screen locked).',
  ].forEach((t, i) => {
    help.getCell(i + 1, 1).value = t;
    if (i === 0) help.getCell(1, 1).font = { bold: true, size: 13 };
  });
  return new Blob([await wb.xlsx.writeBuffer()], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

export type AuditorRow = {
  name: string;
  phone: string;
  home_area: string;
  id_proof: string;
  phone_type: string;
  remarks: string;
  problem: string | null; // why this row cannot be imported
  existing: User | null;
};

/** 10-digit Indian mobile number, or '' if it is not one. */
export function cleanMobile(raw: string): string {
  const d = raw.replace(/\D/g, '').replace(/^(91|0)(?=\d{10}$)/, '');
  return /^[6-9]\d{9}$/.test(d) ? d : '';
}

export async function parseAuditors(file: File, users: User[]): Promise<AuditorRow[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());
  const ws = wb.getWorksheet('Auditors') ?? wb.worksheets[0];
  const col: Record<string, number> = {};
  ws.getRow(1).eachCell((cell, c) => {
    const h = cellText(cell.value).toLowerCase();
    if (h.includes('name')) col.name ??= c;
    else if (h.includes('mobile')) col.phone ??= c;
    else if (h.includes('home') || h.includes('area') || h.includes('base')) col.home_area ??= c;
    else if (h.includes('type') && h.includes('id')) col.id_type ??= c;
    else if (h.includes('last 4') || h.includes('digits')) col.id_last4 ??= c;
    else if (h.includes('android') || h.includes('iphone') || h === 'phone') col.phone_type ??= c;
    else if (h.includes('remark')) col.remarks ??= c;
  });
  if (!col.name || !col.phone) throw new Error('Could not find the "Full Name" and "Mobile Number" columns.');
  const seen = new Set<string>();
  const rows: AuditorRow[] = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const get = (k: string) => (col[k] ? cellText(ws.getRow(r).getCell(col[k]).value) : '');
    const name = get('name').replace(/\s+/g, ' ').trim();
    if (!name) continue;
    const phone = cleanMobile(get('phone'));
    const last4 = get('id_last4').replace(/\D/g, '').slice(-4);
    const idType = get('id_type');
    const existing = phone ? users.find((u) => cleanMobile(u.phone ?? '') === phone) ?? null : null;
    let problem: string | null = null;
    if (!phone) problem = `Mobile number "${get('phone')}" is not a valid 10-digit number`;
    else if (seen.has(phone)) problem = 'Same mobile number appears twice in the file';
    else if (existing) problem = `Already in the app as ${existing.name} (${existing.username})`;
    else if (!get('home_area')) problem = 'Home town / base area is missing';
    seen.add(phone);
    rows.push({
      name,
      phone,
      home_area: get('home_area'),
      id_proof: idType || last4 ? `${idType || 'ID'} ••••${last4}` : '',
      phone_type: get('phone_type'),
      remarks: get('remarks'),
      problem,
      existing,
    });
  }
  return rows;
}

/** Login name like "rahul4821": first name + last 4 digits of the mobile number. */
export function makeUsername(name: string, phone: string, taken: Set<string>): string {
  const base = (name.toLowerCase().split(' ')[0].replace(/[^a-z]/g, '') || 'auditor') + phone.slice(-4);
  let u = base;
  for (let i = 2; taken.has(u); i++) u = `${base}${i}`;
  taken.add(u);
  return u;
}

/** Easy-to-type starting password (no look-alike characters). */
export function makePassword(): string {
  const letters = 'abcdefghjkmnpqrstuvwxyz';
  const digits = '23456789';
  const pick = (set: string, n: number) => Array.from(crypto.getRandomValues(new Uint32Array(n)), (x) => set[x % set.length]).join('');
  return `${pick(letters, 1).toUpperCase()}${pick(letters, 4)}${pick(digits, 4)}`;
}

/** Sheet of the new logins to hand out (passwords appear only here, once). */
export async function credentialsSheet(rows: { name: string; phone: string; home_area: string; username: string; password: string }[], appUrl: string) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Logins');
  ws.columns = [
    { header: 'Full Name', width: 26 },
    { header: 'Mobile', width: 14 },
    { header: 'Base Area', width: 18 },
    { header: 'Username', width: 18 },
    { header: 'Starting password', width: 18 },
    { header: 'Message to send', width: 90 },
  ];
  ws.getRow(1).font = { bold: true };
  for (const r of rows)
    ws.addRow([r.name, r.phone, r.home_area, r.username, r.password, loginMessage(r.name, r.username, r.password, appUrl)]);
  return new Blob([await wb.xlsx.writeBuffer()], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

export function loginMessage(name: string, username: string, password: string, appUrl: string) {
  return `Hi ${name.split(' ')[0]}, your Stock Audit login: ${appUrl}  Username: ${username}  Password: ${password}  (please change the password after first sign-in: tap your name → change password)`;
}
