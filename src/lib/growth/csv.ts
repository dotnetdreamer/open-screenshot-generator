// A cell of a CSV file that a spreadsheet opens, for Growth's exports.

/** The value as a CSV cell: quoted when it holds a comma, a quote or a line break. */
export function csvCell(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? '' : String(value);
  // A cell that a spreadsheet would run as a formula is written as text.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** Rows as a CSV file, with the line endings spreadsheets expect. */
export function csvText(rows: Array<Array<string | number | null | undefined>>): string {
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
