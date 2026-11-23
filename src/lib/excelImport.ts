import ExcelJS from 'exceljs';
import { cellText, idKey } from '../../shared/domain';

export type ParsedRow = { reg_no: string; engine_no: string; chassis_no: string };
export type ParsedSheet = { sheet_name: string; rows: ParsedRow[]; warnings: string[] };

/**
 * Read the client's stock statement: one worksheet per centre with columns
 * "Registration No", "engineNumber", "chassisNumber" (header names matched loosely).
 */
export async function parseStockStatement(file: File): Promise<ParsedSheet[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());
  const sheets: ParsedSheet[] = [];
  wb.eachSheet((ws) => {
    if (ws.state && ws.state !== 'visible') return;
    let headerRow = 0;
    let cols = { reg: 0, engine: 0, chassis: 0 };
    for (let r = 1; r <= Math.min(ws.rowCount, 10) && !headerRow; r++) {
      const found = { reg: 0, engine: 0, chassis: 0 };
      ws.getRow(r).eachCell((cell, col) => {
        const h = cellText(cell.value).toLowerCase().replace(/[^a-z]/g, '');
        if (!found.chassis && h.includes('chassis')) found.chassis = col;
        else if (!found.engine && h.includes('engine')) found.engine = col;
        else if (!found.reg && (h.includes('registration') || h.startsWith('reg') || h.includes('rcno') || h === 'rc')) found.reg = col;
      });
      if (found.chassis) {
        headerRow = r;
        cols = found;
      }
    }
    if (!headerRow) return; // not a stock sheet
    const rows: ParsedRow[] = [];
    const warnings: string[] = [];
    for (let r = headerRow + 1; r <= ws.rowCount; r++) {
      const row = ws.getRow(r);
      const get = (c: number) => (c ? cellText(row.getCell(c).value) : '');
      const item = { reg_no: get(cols.reg).toUpperCase(), engine_no: get(cols.engine).toUpperCase(), chassis_no: get(cols.chassis).toUpperCase() };
      if (!idKey(item.reg_no) && !idKey(item.chassis_no)) continue;
      if (!idKey(item.chassis_no) || item.chassis_no === '0') warnings.push(`${item.reg_no || 'Row ' + r}: no chassis number in the statement`);
      if (item.reg_no && !/^[A-Z]{2}\d{1,2}[A-Z]{0,3}\d{3,4}$/.test(idKey(item.reg_no)))
        warnings.push(`${item.reg_no}: unusual registration number`);
      rows.push(item);
    }
    const seen = new Set<string>();
    for (const r of rows) {
      const k = idKey(r.chassis_no);
      if (k && k !== '0' && seen.has(k)) warnings.push(`${r.chassis_no}: chassis number appears twice`);
      seen.add(k);
    }
    sheets.push({ sheet_name: ws.name.trim(), rows, warnings });
  });
  return sheets;
}
