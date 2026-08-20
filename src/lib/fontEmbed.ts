// The web fonts one capture needs, resolved by the app instead of by
// html-to-image.
//
// A capture rebuilds the artboard inside an SVG foreignObject and hands that
// SVG to an <img>. An SVG used as an image loads nothing external, so every
// @font-face the board renders in has to travel with it as a data: URL.
// html-to-image works that out on its own, but only from stylesheets it can
// read, and reading `cssRules` on a cross-origin sheet throws SecurityError.
// Its recovery for one of those is to fetch the whole stylesheet and inline
// EVERY url() in it, before anything has been narrowed to the families the
// node actually uses. Our Google Fonts sheet declares around fifty families and
// the CJK ones carry a hundred-odd unicode-range subsets each, so exporting a
// board fired thousands of parallel woff2 requests (Chrome answers
// net::ERR_INSUFFICIENT_RESOURCES and drops them), re-inserted every parsed
// rule into the document's own first stylesheet, and then did it all again for
// the next board. A six board project logged it six times over.
//
// Resolving fonts here and passing the result as `fontEmbedCSS` makes
// html-to-image skip its font pass entirely, and lets the work be scoped to
// what the picture needs:
//   - only families the node renders in
//   - only subsets whose unicode-range covers characters the node contains
//   - every file fetched at most once per session, a few at a time
//   - the embedded rule text cached, so board 2 of 6 costs no network at all
//
// fontService injects the Google Fonts CSS as a same-origin <style> so these
// rules can be read here at all. The cross-origin branch below is what happens
// when that injection could not run and the app fell back to a <link>.

/** A single @font-face, before its files have been inlined. */
interface FontFaceSource {
  /** Lowercased and unquoted, so it can be matched against computed styles. */
  family: string;
  /** Null means the face covers every character. */
  unicodeRange: string | null;
  cssText: string;
  /** What a relative url() in `cssText` resolves against. */
  baseUrl: string | null;
}

/** What a node renders with: which families, and which characters. */
interface FontUsage {
  families: Set<string>;
  codePoints: Set<number>;
}

// Enough to keep a capture quick, low enough that a board using a CJK family
// can never exhaust the browser's connection pool the way the old path did.
const MAX_PARALLEL_FONT_FETCHES = 8;

/** url -> data: URL, or null when the file could not be fetched. */
const fileCache = new Map<string, Promise<string | null>>();
/** Rule text -> the same rule with its files inlined. Null when one failed. */
const embeddedFaceCache = new Map<string, Promise<string | null>>();
/** Cross-origin stylesheet href -> the faces parsed out of its source text. */
const remoteSheetCache = new Map<string, Promise<FontFaceSource[]>>();

let fetchesInFlight = 0;
const waitingForSlot: (() => void)[] = [];

/** Run `work` once a fetch slot is free. */
async function withFetchSlot<T>(work: () => Promise<T>): Promise<T> {
  if (fetchesInFlight >= MAX_PARALLEL_FONT_FETCHES) {
    await new Promise<void>((resolve) => waitingForSlot.push(resolve));
  }
  fetchesInFlight += 1;
  try {
    return await work();
  } finally {
    fetchesInFlight -= 1;
    waitingForSlot.shift()?.();
  }
}

function normalizeFamily(value: string): string {
  return value.trim().replace(/["']/g, '').toLowerCase();
}

/**
 * Every family the node or anything inside it resolves to, plus every
 * character it contains. Fallbacks count as used: the browser paints whichever
 * entry of the list first has the glyph, so the export needs them all.
 */
function collectUsage(node: HTMLElement): FontUsage {
  const families = new Set<string>();
  const codePoints = new Set<number>();

  const addFamilies = (element: Element) => {
    const value = window.getComputedStyle(element).fontFamily;
    if (!value) return;
    value.split(',').forEach((family) => {
      const normalized = normalizeFamily(family);
      if (normalized) families.add(normalized);
    });
  };

  addFamilies(node);
  node.querySelectorAll('*').forEach(addFamilies);

  // textContent covers every descendant in one read. A few characters more
  // than the picture shows (text under a filtered-out node, say) only ever
  // costs one extra subset, while a character missed here would export as a
  // notdef box.
  for (const character of node.textContent || '') {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined) codePoints.add(codePoint);
  }
  // A board being edited holds its text in a textarea, whose value is not text
  // content at all.
  node.querySelectorAll('input, textarea').forEach((field) => {
    for (const character of (field as HTMLInputElement | HTMLTextAreaElement).value || '') {
      const codePoint = character.codePointAt(0);
      if (codePoint !== undefined) codePoints.add(codePoint);
    }
  });

  return { families, codePoints };
}

/**
 * Does a `unicode-range` value cover any character the node contains?
 *
 * Tokens are `U+4E2D`, `U+0100-024F` or `U+30??`. Anything unparseable keeps
 * the face: a subset wrongly kept costs one download, a subset wrongly dropped
 * loses glyphs from the export.
 */
function coversAnyCodePoint(unicodeRange: string | null, codePoints: Set<number>): boolean {
  if (!unicodeRange) return true;
  for (const token of unicodeRange.split(',')) {
    const text = token.trim().replace(/^u\+/i, '');
    if (!text) continue;
    let first: number;
    let last: number;
    if (text.includes('-')) {
      const [from, to] = text.split('-');
      first = parseInt(from, 16);
      last = parseInt(to, 16);
    } else if (text.includes('?')) {
      first = parseInt(text.replace(/\?/g, '0'), 16);
      last = parseInt(text.replace(/\?/g, 'F'), 16);
    } else {
      first = parseInt(text, 16);
      last = first;
    }
    if (Number.isNaN(first) || Number.isNaN(last)) return true;
    for (const codePoint of codePoints) {
      if (codePoint >= first && codePoint <= last) return true;
    }
  }
  return false;
}

const FONT_FACE_BLOCK = /@font-face\s*\{[^}]*\}/gi;

function declarationValue(block: string, property: string): string | null {
  const match = new RegExp(`(?:^|[{;])\\s*${property}\\s*:([^;}]+)`, 'i').exec(block);
  return match ? match[1].trim() : null;
}

/** The @font-face rules in a stylesheet we can only read as text. */
function parseFacesFromText(cssText: string, baseUrl: string): FontFaceSource[] {
  const faces: FontFaceSource[] = [];
  for (const match of cssText.match(FONT_FACE_BLOCK) || []) {
    const family = declarationValue(match, 'font-family');
    if (!family) continue;
    faces.push({
      family: normalizeFamily(family),
      unicodeRange: declarationValue(match, 'unicode-range'),
      cssText: match,
      baseUrl,
    });
  }
  return faces;
}

function remoteSheetFaces(href: string): Promise<FontFaceSource[]> {
  const cached = remoteSheetCache.get(href);
  if (cached) return cached;
  const pending = fetch(href)
    .then((response) => {
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      return response.text();
    })
    .then((cssText) => parseFacesFromText(cssText, href))
    .catch(() => []);
  remoteSheetCache.set(href, pending);
  return pending;
}

/** Every @font-face in the document that this node's text actually needs. */
async function collectNeededFaces(usage: FontUsage): Promise<FontFaceSource[]> {
  const faces: FontFaceSource[] = [];
  const unreadable: Promise<FontFaceSource[]>[] = [];

  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList | null = null;
    try {
      rules = sheet.cssRules;
    } catch {
      // Cross-origin. Its text is still readable over fetch, and parsing it is
      // what keeps an export in the right face when the same-origin injection
      // in fontService could not run.
      if (sheet.href) unreadable.push(remoteSheetFaces(sheet.href));
      continue;
    }
    for (const rule of Array.from(rules || [])) {
      if (rule.type !== CSSRule.FONT_FACE_RULE) continue;
      const fontFaceRule = rule as CSSFontFaceRule;
      const family = normalizeFamily(fontFaceRule.style.getPropertyValue('font-family'));
      if (!usage.families.has(family)) continue;
      const unicodeRange = fontFaceRule.style.getPropertyValue('unicode-range') || null;
      if (!coversAnyCodePoint(unicodeRange, usage.codePoints)) continue;
      // cssText is built on read, so it is only asked for once a rule is known
      // to be needed: a document holding every family's subsets has thousands
      // of these.
      faces.push({ family, unicodeRange, cssText: fontFaceRule.cssText, baseUrl: sheet.href });
    }
  }

  for (const sheetFaces of await Promise.all(unreadable)) {
    for (const face of sheetFaces) {
      if (!usage.families.has(face.family)) continue;
      if (!coversAnyCodePoint(face.unicodeRange, usage.codePoints)) continue;
      faces.push(face);
    }
  }

  return faces;
}

function fetchFileAsDataUrl(url: string): Promise<string | null> {
  const cached = fileCache.get(url);
  if (cached) return cached;
  const pending = withFetchSlot(async () => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const blob = await response.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error(`Could not read ${url}`));
      reader.readAsDataURL(blob);
    });
  }).catch(() => null);
  fileCache.set(url, pending);
  return pending;
}

const CSS_URL = /url\((['"]?)([^'"()]+)\1\)/g;

/**
 * One rule with its files inlined, or null when a file could not be fetched.
 * Dropping the rule is deliberate: a face left pointing at fonts.gstatic.com
 * inside the capture would resolve to nothing and render as a notdef box,
 * where dropping it renders in the next family of the fallback list.
 */
function embedFaceFiles(face: FontFaceSource): Promise<string | null> {
  const cached = embeddedFaceCache.get(face.cssText);
  if (cached) return cached;

  const urls = new Set<string>();
  for (const match of face.cssText.matchAll(CSS_URL)) {
    if (!match[2].startsWith('data:')) urls.add(match[2]);
  }
  if (urls.size === 0) return Promise.resolve(face.cssText);

  const pending = (async () => {
    const inlined = new Map<string, string>();
    await Promise.all(
      Array.from(urls).map(async (url) => {
        const absolute = new URL(url, face.baseUrl || document.baseURI).href;
        const dataUrl = await fetchFileAsDataUrl(absolute);
        if (dataUrl) inlined.set(url, dataUrl);
      })
    );
    if (inlined.size !== urls.size) return null;
    return face.cssText.replace(CSS_URL, (whole, _quote, url: string) =>
      url.startsWith('data:') ? whole : `url(${inlined.get(url)})`
    );
  })();

  embeddedFaceCache.set(face.cssText, pending);
  return pending;
}

/**
 * The @font-face CSS to hand a capture of `node`, ready to be passed to
 * html-to-image as `fontEmbedCSS`. Empty when the node needs no web font,
 * which is a complete answer: html-to-image treats any string as the final
 * word and does no font work of its own.
 */
export async function resolveFontEmbedCss(node: HTMLElement): Promise<string> {
  const usage = collectUsage(node);
  if (usage.families.size === 0 || usage.codePoints.size === 0) return '';
  const faces = await collectNeededFaces(usage);
  const embedded = await Promise.all(faces.map(embedFaceFiles));
  // The same face can be declared twice (a stylesheet loaded from two places,
  // an imported family that shadows a built-in). Keeping the first is what the
  // cascade does anyway, and it keeps the capture's <style> small.
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const cssText of embedded) {
    if (!cssText || seen.has(cssText)) continue;
    seen.add(cssText);
    unique.push(cssText);
  }
  return unique.join('\n');
}
