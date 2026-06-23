/**
 * Lightweight CSV export — builds a UTF-8 CSV (with a BOM so Excel renders
 * Hindi/accented text correctly) and triggers a browser download. No deps.
 */

export interface CsvColumn {
  header: string;
  key: string;
}

// UTF-8 byte-order mark, kept as an escape (not a literal) to satisfy linting.
const BOM = '\uFEFF';

function escapeCell(v: unknown): string {
  const s = v === null || v === undefined ? '' : String(v);
  // Quote if the value contains a comma, quote, or newline.
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Serialize rows → CSV text (no BOM, no download). */
export function toCsvBody(columns: CsvColumn[], rows: Record<string, unknown>[]): string {
  const header = columns.map((c) => escapeCell(c.header)).join(',');
  const body = rows.map((r) => columns.map((c) => escapeCell(r[c.key])).join(',')).join('\r\n');
  return `${header}\r\n${body}`;
}

/**
 * Build a CSV and download it as `<filename>.csv`.
 * `preamble` rows (e.g. report metadata) are written above the table, each as
 * its own comma-separated line, followed by a blank line.
 */
export function exportToCsv(
  filename: string,
  columns: CsvColumn[],
  rows: Record<string, unknown>[],
  preamble?: (string | number)[][],
): void {
  const pre = preamble && preamble.length
    ? preamble.map((r) => r.map(escapeCell).join(',')).join('\r\n') + '\r\n\r\n'
    : '';
  const csv = BOM + pre + toCsvBody(columns, rows);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
