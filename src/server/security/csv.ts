/**
 * CSV writing with formula injection escaped.
 *
 * A cell that starts with =, +, -, @, tab or carriage return is executed as a formula when the
 * file is opened in Excel or Sheets. Our data includes learner text and concept labels that a
 * learner can influence, so every cell is neutralised before it is written. The guard lives
 * here rather than at each call site, so a new export cannot forget it.
 */

const DANGEROUS_PREFIX = /^[=+\-@\t\r]/;

/** True when a spreadsheet would treat this value as a formula rather than text. */
export function isFormula(value: string): boolean {
  return DANGEROUS_PREFIX.test(value);
}

/**
 * Escapes one cell. A leading apostrophe is the conventional way to force a spreadsheet to
 * read the value as text, and it survives a round trip through Excel and Sheets.
 */
export function escapeCell(value: unknown): string {
  if (value === null || value === undefined) return "";

  let text: string;
  if (value instanceof Date) {
    text = value.toISOString();
  } else if (typeof value === "object") {
    text = JSON.stringify(value);
  } else {
    text = String(value);
  }

  // Strip characters that would break the row structure or hide content from a reviewer,
  // and the explicit bidi overrides that can silently reorder the rest of a cell.
  text = text.replace(/[\u0000\u202A-\u202E\u2066-\u2069]/g, "");

  const needsQuotes = /[",\n\r]/.test(text) || isFormula(text);
  if (isFormula(text)) {
    text = `'${text}`;
  }
  if (needsQuotes) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export interface CsvColumn {
  key: string;
  header: string;
}

/** Builds a complete CSV document, header row included. */
export function toCsv(columns: CsvColumn[], rows: Array<Record<string, unknown>>): string {
  const lines = [columns.map((c) => escapeCell(c.header)).join(",")];
  for (const row of rows) {
    lines.push(columns.map((c) => escapeCell(row[c.key])).join(","));
  }
  // CRLF is what the CSV spec says and what Excel expects.
  return lines.join("\r\n") + "\r\n";
}

/** A safe filename for the download, with no path separators or quotes. */
export function csvFilename(widget: string, now = new Date()): string {
  const safe = widget.replace(/[^a-zA-Z0-9_-]/g, "");
  return `mashq-${safe || "export"}-${now.toISOString().slice(0, 10)}.csv`;
}
