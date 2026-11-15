// The report files Apple hands out: gzipped, tab separated, with a header row.
//
// Sales and Trends answers /v1/salesReports with the gzip file as the body
// (application/a-gzip), and the analytics reports are `.csv.gz` objects on a
// pre-signed storage URL. Neither is a Content-Encoding, so nothing in the
// transport inflates them, except that a storage host may one day serve the
// object with that header and the HTTP stack will. So the magic number decides,
// never the URL or the content type.

/** The two bytes every gzip member starts with. */
export function isGzip(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

export async function gunzip(bytes: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('This app cannot unpack Apple\'s report files here. Update the app or your system web view.');
  }
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** A report body as text, inflated when it is gzip, without a byte order mark. */
export async function reportText(bytes: Uint8Array): Promise<string> {
  const plain = isGzip(bytes) ? await gunzip(bytes) : bytes;
  const text = new TextDecoder('utf-8').decode(plain);
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

export interface DelimitedTable {
  header: string[];
  rows: string[][];
}

/**
 * Parse a report. The delimiter is whichever of tab and comma the header line
 * holds more of: Sales and Trends is tab separated, and the analytics files
 * carry a .csv name over what has been tab separated content, so trusting the
 * name would be the wrong way round. Quotes are honoured for commas, which is
 * the only case where they appear.
 */
export function parseDelimited(text: string): DelimitedTable {
  const lines = text.split(/\r?\n/);
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
  if (lines.length === 0) return { header: [], rows: [] };

  const first = lines[0];
  const tabs = first.split('\t').length;
  const commas = first.split(',').length;
  const delimiter = tabs >= commas ? '\t' : ',';

  const split = delimiter === '\t' ? splitTabs : splitCsv;
  const header = split(first).map((cell) => cell.trim());
  const rows: string[][] = [];
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) continue;
    rows.push(split(line));
  }
  return { header, rows };
}

function splitTabs(line: string): string[] {
  return line.split('\t').map(unquote);
}

function unquote(cell: string): string {
  const trimmed = cell.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/""/g, '"');
  }
  return trimmed;
}

function splitCsv(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (quoted) {
      if (char === '"' && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        current += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      cells.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

/** The index of the first header matching any of `names`, case and spacing ignored. */
export function columnIndex(header: string[], ...names: string[]): number {
  const wanted = names.map(simplify);
  return header.findIndex((cell) => wanted.includes(simplify(cell)));
}

function simplify(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** A number cell; empty, dashes and junk read as zero. */
export function numberCell(value: string | undefined): number {
  if (!value) return 0;
  const parsed = Number(value.replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}
