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
//   - every file that could be read fetched once per session, a few at a time
//   - the embedded rule text cached, so board 2 of 6 costs no network at all
//
// fontService injects the Google Fonts CSS as a same-origin <style> so these
// rules can be read here at all. The cross-origin branch below is what happens
// when that injection could not run and the app fell back to a <link>.
//
// Before any of that, the faces have to be on the page (whenNodeFontsLoaded):
// a rule that has not arrived cannot be embedded, and a board laid out in the
// fallback face is captured with the fallback's line breaks.
//
// Every wait in this file has an end. A font that stalls (the stylesheet, a
// face, a file read for the picture) holds a capture for about ten seconds,
// once: what was waited for in vain is remembered, so the next artboard of the
// same export does not wait for it again, and the families the pictures went
// without are kept for the caller to tell the person (takeFontsLeftOut).

import { GOOGLE_FONTS, whenBuiltInFacesDeclared } from '@/services/fontService';

/** A single @font-face, before its files have been inlined. */
interface FontFaceSource {
  /** Lowercased and unquoted, so it can be matched against computed styles. */
  family: string;
  /** The family as its rule writes it, for telling a person which one it was. */
  name: string;
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

// Each of these keeps what was read and forgets a read that failed (keepUnlessEmpty).

/** url -> data: URL. Null only while a failed read is being handed back. */
const fileCache = new Map<string, Promise<string | null>>();
/** Rule text -> the same rule with its files inlined. Null the same way. */
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
      name: family.trim().replace(/["']/g, ''),
      unicodeRange: declarationValue(match, 'unicode-range'),
      cssText: match,
      baseUrl,
    });
  }
  return faces;
}

/**
 * `fetch` that gives up after `waitMs`. A request that stalls neither answers
 * nor fails, and a capture cannot wait on it for ever. Reading the body with
 * `read` is part of the wait, because the headers can arrive and the rest
 * stall. `gaveUp` is called when the time ran out, as opposed to the request
 * failing on its own.
 */
async function fetchInTime<T>(
  url: string,
  waitMs: number,
  read: (response: Response) => Promise<T>,
  gaveUp: () => void
): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, waitMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return await read(response);
  } catch (error) {
    if (timedOut) gaveUp();
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Keeps `pending` under `key` while it is on its way and once it has an answer
 * worth keeping. A failed read is forgotten, so the next capture asks again:
 * kept, one bad moment on the network left every later export of the session
 * without the face.
 */
function keepUnlessEmpty<K, V>(cache: Map<K, Promise<V>>, key: K, pending: Promise<V>, empty: (value: V) => boolean): Promise<V> {
  cache.set(key, pending);
  void pending.then((value) => {
    if (empty(value) && cache.get(key) === pending) cache.delete(key);
  });
  return pending;
}

function remoteSheetFaces(href: string, waitMs: number): Promise<FontFaceSource[]> {
  const cached = remoteSheetCache.get(href);
  if (cached) return cached;
  const pending = fetchInTime(href, waitMs, (response) => response.text(), ranOutOfPatience)
    .then((cssText) => parseFacesFromText(cssText, href))
    .catch(() => []);
  return keepUnlessEmpty(remoteSheetCache, href, pending, (faces) => faces.length === 0);
}

/** Every @font-face in the document that this node's text actually needs. */
async function collectNeededFaces(usage: FontUsage, waitMs: number): Promise<FontFaceSource[]> {
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
      if (sheet.href) unreadable.push(remoteSheetFaces(sheet.href, waitMs));
      continue;
    }
    for (const rule of Array.from(rules || [])) {
      if (rule.type !== CSSRule.FONT_FACE_RULE) continue;
      const fontFaceRule = rule as CSSFontFaceRule;
      const written = fontFaceRule.style.getPropertyValue('font-family');
      const family = normalizeFamily(written);
      if (!usage.families.has(family)) continue;
      const unicodeRange = fontFaceRule.style.getPropertyValue('unicode-range') || null;
      if (!coversAnyCodePoint(unicodeRange, usage.codePoints)) continue;
      // cssText is built on read, so it is only asked for once a rule is known
      // to be needed: a document holding every family's subsets has thousands
      // of these.
      faces.push({ family, name: written.trim().replace(/["']/g, ''), unicodeRange, cssText: fontFaceRule.cssText, baseUrl: sheet.href });
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

/**
 * One font file as a data: URL, or null when it could not be read within
 * `waitMs`. The time runs from when the request goes out, not from when it
 * joined the queue. A file that ran out of time is not asked for again while
 * the trouble lasts (see `troubleUntil`): the next artboard of the same export
 * would only wait for it again.
 */
function fetchFileAsDataUrl(url: string, waitMs: number): Promise<string | null> {
  const cached = fileCache.get(url);
  if (cached) return cached;
  if (!inTrouble()) filesGivenUp.clear();
  else if (filesGivenUp.has(url)) return Promise.resolve(null);
  const pending = withFetchSlot(async () => {
    const blob = await fetchInTime(
      url,
      waitMs,
      (response) => response.blob(),
      () => {
        filesGivenUp.add(url);
        ranOutOfPatience();
      }
    );
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error(`Could not read ${url}`));
      reader.readAsDataURL(blob);
    });
  }).catch(() => null);
  return keepUnlessEmpty(fileCache, url, pending, (dataUrl) => dataUrl === null);
}

const CSS_URL = /url\((['"]?)([^'"()]+)\1\)/g;

/**
 * One rule with its files inlined, or null when a file could not be fetched.
 * Dropping the rule is deliberate: a face left pointing at fonts.gstatic.com
 * inside the capture would resolve to nothing and render as a notdef box,
 * where dropping it renders in the next family of the fallback list.
 */
function embedFaceFiles(face: FontFaceSource, waitMs: number): Promise<string | null> {
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
        const dataUrl = await fetchFileAsDataUrl(absolute, waitMs);
        if (dataUrl) inlined.set(url, dataUrl);
      })
    );
    if (inlined.size !== urls.size) return null;
    return face.cssText.replace(CSS_URL, (whole, _quote, url: string) =>
      url.startsWith('data:') ? whole : `url(${inlined.get(url)})`
    );
  })();

  return keepUnlessEmpty(embeddedFaceCache, face.cssText, pending, (cssText) => cssText === null);
}

/** The built-in families whose rules arrive with the Google Fonts stylesheet (fontService.ts). */
const FROM_STYLESHEET = new Map(GOOGLE_FONTS.map((font) => [font.family.toLowerCase(), font.family]));

/**
 * The longest a capture waits for its fonts to be on the page. Past this the
 * network is the trouble, and the picture is taken in the fallback the canvas
 * is showing.
 */
const FONT_WAIT_MS = 10_000;

/**
 * The longest one font file may take to be read into the picture. A face the
 * page has is in the browser's cache and comes at once, so all this ever ends
 * is a read that has stalled.
 */
const FONT_FILE_WAIT_MS = 10_000;

/**
 * What a capture allows once the fonts have been waited for and did not come:
 * long enough for what the cache holds, and no second wait.
 */
const FONT_GRACE_MS = 1_000;

/** How long the captures after one that waited in vain stay that short of patience. */
const TROUBLE_MS = 30_000;

/** A wait shorter than this found everything on the page already. */
const ALREADY_THERE_MS = 30;

// What the waits below remember from one capture to the next. An export is
// many captures: five artboards, times the languages, times the store sizes.
// Each of them waiting its own ten seconds for the same font that is not
// coming would turn one stalled file into minutes.

/** Until when the network counts as the trouble, on the wall clock. */
let troubleUntil = 0;
/** Faces a capture waited the whole time for, by CSS font shorthand. Gone from here once they arrive. */
const facesWaitedFor = new Set<string>();
/** The built-in stylesheet, the same. */
let sheetWaitedFor = false;
/** Font files that did not come in time, while the trouble lasts. */
const filesGivenUp = new Set<string>();
/** Families a picture was taken without, until someone asks (takeFontsLeftOut). */
const familiesLeftOut = new Set<string>();

function inTrouble(): boolean {
  return Date.now() < troubleUntil;
}

function ranOutOfPatience(): void {
  troubleUntil = Date.now() + TROUBLE_MS;
}

/** Something that was missing has arrived: the network is moving again. */
function patienceBack(): void {
  troubleUntil = 0;
  filesGivenUp.clear();
}

/** The family a CSS font shorthand asks for first, as written. */
function firstFamily(spec: string): string {
  const families = spec.slice(spec.indexOf('px ') + 3);
  return families.split(',')[0].trim().replace(/["']/g, '');
}

function leftOut(family: string): void {
  const name = family.trim().replace(/["']/g, '');
  if (name) familiesLeftOut.add(FROM_STYLESHEET.get(name.toLowerCase()) ?? name);
}

/**
 * The families the captures since the last call were taken without, because
 * they did not load in time or their files could not be read. Asking empties
 * the list. An export asks before it starts, to drop what older captures
 * left, and again when it is done, to tell the person.
 */
export function takeFontsLeftOut(): string[] {
  const families = [...familiesLeftOut].sort((a, b) => a.localeCompare(b));
  familiesLeftOut.clear();
  return families;
}

/** The faces the node's text is set in: each CSS font shorthand, and the characters set in it. */
function collectFaces(node: HTMLElement): Map<string, string> {
  const faces = new Map<string, string>();
  const take = (element: Element) => {
    let own = '';
    for (const child of Array.from(element.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) own += child.textContent ?? '';
    }
    // A board being edited holds its text in a textarea.
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) own += element.value;
    if (!own.trim()) return;
    const style = window.getComputedStyle(element);
    if (!style.fontFamily) return;
    const spec = `${style.fontStyle || 'normal'} ${style.fontWeight || '400'} 16px ${style.fontFamily}`;
    faces.set(spec, (faces.get(spec) ?? '') + own);
  };
  take(node);
  node.querySelectorAll('*').forEach(take);
  return faces;
}

/** Two frames, so a page that has just been given a face has laid its text out in it. */
function afterLayout(): Promise<void> {
  return new Promise((resolve) => {
    // A window that is covered or minimised is given no frames at all.
    const timer = setTimeout(resolve, 150);
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        clearTimeout(timer);
        resolve();
      })
    );
  });
}

/**
 * Settles once the faces `node` draws its text in are on the page, with true,
 * or once it is clear they will not be in time, with false. Every capture
 * waits on it, through resolveFontEmbedCss, and it is the only wait for fonts
 * a capture makes.
 *
 * `document.fonts.ready` does not do this job, in either direction. The
 * built-in families are declared by a stylesheet the app fetches after it has
 * started (preloadGoogleFonts), and until that lands the page has no rule for
 * them: no face is loading, so `ready` settles at once, and `check` calls a
 * family the page has no rule for ready. An export started in those first
 * seconds, on a slow connection or straight after opening a template,
 * rasterized the fallback face, with the headlines wrapped to fit it, and
 * reported nothing. And once the rule is in and its file has stalled, `ready`
 * does not settle at all: an export that awaited it never finished.
 *
 * So: the stylesheet first, when the node uses a family it declares; then each
 * face is asked for by name with the characters set in it, which is the one
 * signal that holds in WebKit too (fontsSettled.ts); then, if anything was
 * waited for, two frames for the text to be laid out in what arrived.
 *
 * It never rejects and gives up after FONT_WAIT_MS: the board is captured in
 * the fallback, as it is drawn. What it gave up on is remembered. The captures
 * that follow do not wait for the same stylesheet or the same faces again
 * while they are still on their way, and for FONT_GRACE_MS at most for faces
 * they meet for the first time in the next TROUBLE_MS, so an export of many
 * artboards pays for a stalled file once. A face that arrives is waited for
 * as before.
 */
export function whenNodeFontsLoaded(node: HTMLElement): Promise<boolean> {
  if (typeof document === 'undefined' || !document.fonts?.load) return Promise.resolve(true);
  const waitMs = inTrouble() ? FONT_GRACE_MS : FONT_WAIT_MS;
  // What is still on its way, whether this capture waits for it or not.
  const onTheirWay = new Set<string>();
  let sheetHere = true;
  let builtIn: string[] = [];
  const loaded = (async () => {
    try {
      const since = Date.now();
      const families = [...collectUsage(node).families];
      builtIn = families.filter((family) => FROM_STYLESHEET.has(family));
      const declared = builtIn.length > 0 ? whenBuiltInFacesDeclared() : null;
      if (declared) {
        sheetHere = false;
        const landed = declared.then(() => {
          sheetHere = true;
          if (sheetWaitedFor) patienceBack();
          sheetWaitedFor = false;
        });
        if (!sheetWaitedFor) await landed;
      }
      // Read after the stylesheet is in: the same text can resolve to another face now.
      const waits: Promise<void>[] = [];
      for (const [spec, text] of collectFaces(node)) {
        onTheirWay.add(spec);
        const arrival = document.fonts
          .load(spec, text)
          .catch(() => [])
          .then(() => {
            onTheirWay.delete(spec);
            if (facesWaitedFor.delete(spec)) patienceBack();
          });
        if (!facesWaitedFor.has(spec)) waits.push(arrival);
      }
      await Promise.all(waits);
      if (declared || Date.now() - since > ALREADY_THERE_MS) await afterLayout();
    } catch (error) {
      console.warn('Could not wait for the fonts of this capture', error);
    }
  })();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const givenUp = new Promise<'given up'>((resolve) => {
    timer = setTimeout(() => resolve('given up'), waitMs);
  });
  return Promise.race([loaded, givenUp]).then((outcome) => {
    clearTimeout(timer);
    if (outcome === 'given up') {
      ranOutOfPatience();
      if (!sheetHere) sheetWaitedFor = true;
      for (const spec of onTheirWay) facesWaitedFor.add(spec);
    }
    if (!sheetHere) builtIn.forEach(leftOut);
    for (const spec of onTheirWay) leftOut(firstFamily(spec));
    return sheetHere && onTheirWay.size === 0;
  });
}

/**
 * The @font-face CSS to hand a capture of `node`, ready to be passed to
 * html-to-image as `fontEmbedCSS`. Empty when the node needs no web font,
 * which is a complete answer: html-to-image treats any string as the final
 * word and does no font work of its own.
 *
 * It waits for the node's faces to be on the page first, so every capture
 * does: the PNG export, the store upload, the share picture, the MCP tools
 * and the video export, which resolves this once for all its sprites. Every
 * wait in here has an end (whenNodeFontsLoaded, fetchFileAsDataUrl), so a
 * capture is never held up for longer than a font is worth. A face whose file
 * cannot be read is left out of the picture and named by takeFontsLeftOut.
 */
export async function resolveFontEmbedCss(node: HTMLElement): Promise<string> {
  const arrived = await whenNodeFontsLoaded(node);
  const usage = collectUsage(node);
  if (usage.families.size === 0 || usage.codePoints.size === 0) return '';
  // Faces the page has come out of the cache. Faces it is still waiting for
  // are given the time that takes and no more.
  const fileWaitMs = arrived && !inTrouble() ? FONT_FILE_WAIT_MS : FONT_GRACE_MS;
  const faces = await collectNeededFaces(usage, fileWaitMs);
  const embedded = await Promise.all(faces.map((face) => embedFaceFiles(face, fileWaitMs)));
  // The same face can be declared twice (a stylesheet loaded from two places,
  // an imported family that shadows a built-in). Keeping the first is what the
  // cascade does anyway, and it keeps the capture's <style> small.
  const seen = new Set<string>();
  const unique: string[] = [];
  embedded.forEach((cssText, index) => {
    if (cssText === null) leftOut(faces[index].name);
    if (!cssText || seen.has(cssText)) return;
    seen.add(cssText);
    unique.push(cssText);
  });
  return unique.join('\n');
}
