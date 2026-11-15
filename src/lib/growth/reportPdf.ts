// A Growth report as a PDF, made in the page without a PDF library.
//
// The browser draws the report from its print layout (ReportSheet in
// GrowthReports.tsx) through captureNodeToPng, the app's one capture entry
// point; the picture is cut into A4 pages between the layout's blocks
// (`data-pdf-block`), and each page goes into the PDF as a JPEG. Drawing it
// this way keeps every script an app name, a review or an AI summary can be
// in: the fonts a PDF has built in cover Latin only, and embedding a font for
// every script is a library's worth of work. The cost is text that cannot be
// selected, which the Markdown and text saves cover.
//
// The page numbers are real PDF text, in the built-in Helvetica.
//
// The capture code is loaded when a PDF is made, which keeps this module's
// page cutting and file writing importable where there is no DOM (the tests).

/** A4 in points. */
export const A4 = { width: 595.28, height: 841.89 };
const MARGIN = 40;
const FOOTER = 22;
/** The most pixels one capture may hold: WebKit refuses a bigger canvas without a word. */
const MAX_CAPTURE_PIXELS = 16_000_000;

export interface Span {
  top: number;
  bottom: number;
}

/**
 * Where to end each page, in the sheet's own pixels: at the top of the last
 * block that starts inside the page, so no line is cut in half. A block
 * taller than a whole page is cut where the page ends.
 */
export function pageCuts(blocks: Span[], total: number, pageHeight: number): Array<[number, number]> {
  const tops = Array.from(new Set(blocks.map((block) => Math.round(block.top)))).sort((a, b) => a - b);
  const cuts: Array<[number, number]> = [];
  let start = 0;
  while (total - start > pageHeight) {
    const limit = start + pageHeight;
    let end = limit;
    for (const top of tops) {
      // Past a quarter of the page, so a page is never a single heading.
      if (top > start + pageHeight / 4 && top <= limit) end = top;
    }
    cuts.push([start, end]);
    start = end;
  }
  cuts.push([start, total]);
  return cuts;
}

function offsetWithin(element: HTMLElement, root: HTMLElement): number {
  return element.getBoundingClientRect().top - root.getBoundingClientRect().top;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('The report picture could not be read'));
    image.src = src;
  });
}

async function jpegBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92));
  if (!blob) throw new Error('The report page could not be saved as a picture');
  return new Uint8Array(await blob.arrayBuffer());
}

interface PdfPage {
  jpeg: Uint8Array;
  pixelWidth: number;
  pixelHeight: number;
  /** Height on the page, in points. */
  height: number;
}

/** The sheet as a PDF, one A4 page per cut. */
export async function reportPdf(sheet: HTMLElement, title: string): Promise<Blob> {
  const width = sheet.offsetWidth;
  const total = sheet.scrollHeight;
  const contentWidth = A4.width - 2 * MARGIN;
  const pointsPerPixel = contentWidth / width;
  const pageHeight = Math.floor((A4.height - 2 * MARGIN - FOOTER) / pointsPerPixel);
  const blocks = Array.from(sheet.querySelectorAll<HTMLElement>('[data-pdf-block]')).map((element) => {
    const top = offsetWithin(element, sheet);
    return { top, bottom: top + element.offsetHeight };
  });
  const cuts = pageCuts(blocks, total, pageHeight);

  const ratio = Math.min(2, Math.sqrt(MAX_CAPTURE_PIXELS / Math.max(1, width * total)));
  const { captureNodeToPng } = await import('@/lib/exportRaster');
  const png = await captureNodeToPng(sheet, {
    pixelRatio: ratio,
    backgroundColor: '#ffffff',
    // The sheet is set in system fonts, which the capture can draw without
    // downloading a single font file.
    skipFonts: true,
    width,
    height: total,
  });
  const picture = await loadImage(png);
  const scale = picture.naturalHeight / total;

  const pages: PdfPage[] = [];
  for (const [start, end] of cuts) {
    const canvas = document.createElement('canvas');
    canvas.width = picture.naturalWidth;
    canvas.height = Math.max(1, Math.round((end - start) * scale));
    const context = canvas.getContext('2d', { alpha: false });
    if (!context) throw new Error('The report page could not be drawn');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(picture, 0, Math.round(start * scale), canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
    pages.push({
      jpeg: await jpegBytes(canvas),
      pixelWidth: canvas.width,
      pixelHeight: canvas.height,
      height: (end - start) * pointsPerPixel,
    });
  }
  return new Blob([writePdf(pages, title, contentWidth)], { type: 'application/pdf' });
}

/** Helvetica advance widths, per 1000 units, for the characters a page number uses. */
const HELVETICA: Record<string, number> = { P: 667, a: 556, g: 556, e: 556, o: 556, f: 278, ' ': 278 };

function textWidth(text: string, size: number): number {
  let units = 0;
  for (const char of text) units += HELVETICA[char] ?? 556;
  return (units / 1000) * size;
}

function latin1(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let index = 0; index < text.length; index += 1) bytes[index] = text.charCodeAt(index) & 0xff;
  return bytes;
}

/** A PDF text string: literal when it is plain ASCII, UTF-16 otherwise, so a title in any script survives. */
export function pdfString(text: string): string {
  if (/^[\x20-\x7e]*$/.test(text)) return `(${text.replace(/[\\()]/g, (char) => `\\${char}`)})`;
  let hex = 'FEFF';
  for (let index = 0; index < text.length; index += 1) hex += text.charCodeAt(index).toString(16).padStart(4, '0').toUpperCase();
  return `<${hex}>`;
}

function pdfDate(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `D:${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`;
}

/**
 * The file itself: catalog, page tree, font and info, then a page, its
 * content stream and its picture for each page, and the cross reference
 * table pointing at every object's byte offset.
 */
export function writePdf(pages: PdfPage[], title: string, contentWidth = A4.width - 2 * MARGIN): Uint8Array {
  const chunks: Uint8Array[] = [];
  let length = 0;
  const offsets: number[] = [];
  const push = (data: string | Uint8Array) => {
    const bytes = typeof data === 'string' ? latin1(data) : data;
    chunks.push(bytes);
    length += bytes.length;
  };
  const object = (id: number, ...body: Array<string | Uint8Array>) => {
    offsets[id] = length;
    push(`${id} 0 obj\n`);
    body.forEach(push);
    push('\nendobj\n');
  };

  push('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n');
  const pageIds = pages.map((_, index) => 5 + index * 3);
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  object(2, `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`);
  object(3, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  object(4, `<< /Title ${pdfString(title)} /Producer (Open Screenshot Generator) /CreationDate (${pdfDate(new Date())}) >>`);

  pages.forEach((page, index) => {
    const pageId = pageIds[index];
    const contentId = pageId + 1;
    const imageId = pageId + 2;
    const top = A4.height - MARGIN;
    const footer = `Page ${index + 1} of ${pages.length}`;
    const footerX = A4.width - MARGIN - textWidth(footer, 8);
    const content = [
      `q ${contentWidth.toFixed(2)} 0 0 ${page.height.toFixed(2)} ${MARGIN} ${(top - page.height).toFixed(2)} cm /Im0 Do Q`,
      `BT /F1 8 Tf 0.45 0.45 0.45 rg ${footerX.toFixed(2)} ${(MARGIN - 14).toFixed(2)} Td ${pdfString(footer)} Tj ET`,
    ].join('\n');
    object(
      pageId,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${A4.width} ${A4.height}] /Resources << /XObject << /Im0 ${imageId} 0 R >> /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`
    );
    object(contentId, `<< /Length ${content.length} >>\nstream\n`, content, '\nendstream');
    object(
      imageId,
      `<< /Type /XObject /Subtype /Image /Width ${page.pixelWidth} /Height ${page.pixelHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>\nstream\n`,
      page.jpeg,
      '\nendstream'
    );
  });

  const size = 5 + pages.length * 3;
  const xref = length;
  push(`xref\n0 ${size}\n0000000000 65535 f \n`);
  for (let id = 1; id < size; id += 1) push(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`);
  push(`trailer\n<< /Size ${size} /Root 1 0 R /Info 4 0 R >>\nstartxref\n${xref}\n%%EOF\n`);

  const out = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}
