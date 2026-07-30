// Pure RFC-4180 CSV serialization — no IO, unit-tested. A cell is quoted
// only when it contains a comma, quote, or newline; embedded quotes double.

export function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * Spreadsheet formula-injection guard (CWE-1236): a cell starting with
 * = + - @ tab or CR is evaluated as a formula by Excel/Sheets. Prefix such
 * values with an apostrophe so they render as literal text. Apply to
 * untrusted text cells only — not to numeric columns (a leading "-" is a
 * legitimate negative number).
 */
export function neutralizeFormula(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

/** Rows -> CSV text with CRLF line endings and a trailing newline. */
export function buildCsv(rows: string[][]): string {
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
