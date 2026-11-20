// Copied from github.com/dotnetdreamer/claude-seo osg/checks/html.ts at da732e65be7f.
// Change it there and run npm run sync:seo-checks. Edits here are lost on the next sync.

// A small, forgiving HTML reader for the checks in this folder.
//
// The Python scripts read pages with BeautifulSoup and lxml. This file builds
// the same tree from the same markup, so a check written against it finds
// what the script finds, in a browser, in Node and in a desktop app alike,
// with no library: it follows libxml2's HTML parser (below) and the way
// BeautifulSoup turns its calls into strings.

import { NAMED_REFERENCES } from './entities';
import { DATA_MODES, DEFAULT_END_PRIORITY, EMPTY_ELEMENTS, END_PRIORITY, START_CLOSES } from './libxml';
import { pySplit, pyStrip } from './py';

export interface HtmlElement {
  readonly kind: 'element';
  /** Lower case, e.g. "div". The document itself is "#document". */
  readonly name: string;
  /** Attribute names in lower case. The first copy of a repeated attribute wins, as in browsers. */
  readonly attrs: Record<string, string>;
  readonly children: HtmlNode[];
  parent: HtmlElement | null;
}

export interface HtmlText {
  readonly kind: 'text';
  readonly value: string;
  /**
   * What kind of string this is, as BeautifulSoup sees it: a string inside
   * a script, style, template, rt or rp element takes that kind (the
   * innermost one), and an element's text holds only strings of its own
   * kind, plain text for every other element.
   */
  readonly flavour: 'text' | 'script' | 'style' | 'template' | 'rt' | 'rp';
  parent: HtmlElement | null;
}

export type HtmlNode = HtmlElement | HtmlText;

function element(name: string, attrs: Record<string, string>, parent: HtmlElement | null): HtmlElement {
  return { kind: 'element', name, attrs, children: [], parent };
}

function append(parent: HtmlElement, node: HtmlNode): void {
  node.parent = parent;
  parent.children.push(node);
}

// --- Character references -----------------------------------------------

// lxml 6 (libxml2 2.14) reads character references as HTML5 does, and so does
// this: the whole named table, the legacy names a page may write without a
// semicolon (&copy 2026), and numbers with or without one.

// What HTML5 puts in place of a numeric reference to a C1 control
// ("numeric character reference end state"). The five it leaves out stay.
const WINDOWS_1252: Record<number, number> = {
  0x80: 0x20ac, 0x82: 0x201a, 0x83: 0x0192, 0x84: 0x201e, 0x85: 0x2026, 0x86: 0x2020, 0x87: 0x2021,
  0x88: 0x02c6, 0x89: 0x2030, 0x8a: 0x0160, 0x8b: 0x2039, 0x8c: 0x0152, 0x8e: 0x017d, 0x91: 0x2018,
  0x92: 0x2019, 0x93: 0x201c, 0x94: 0x201d, 0x95: 0x2022, 0x96: 0x2013, 0x97: 0x2014, 0x98: 0x02dc,
  0x99: 0x2122, 0x9a: 0x0161, 0x9b: 0x203a, 0x9c: 0x0153, 0x9e: 0x017e, 0x9f: 0x0178,
};

/** The longest name in the table, "CounterClockwiseContourIntegral;", without its semicolon. */
const LONGEST_NAME = 31;
const ALNUM = /[A-Za-z0-9]/;
const DIGIT = /[0-9]/;
const HEX = /[0-9A-Fa-f]/;

function numberText(value: number): string {
  if (value === 0 || value > 0x10ffff || (value >= 0xd800 && value <= 0xdfff)) return '\u{FFFD}';
  return String.fromCodePoint(WINDOWS_1252[value] ?? value);
}

/**
 * The text a reference at `at` (an "&") stands for and where it ends, or
 * null when it stands for nothing and the "&" is plain text. In an attribute
 * value, a name without its semicolon followed by "=" or a letter or digit is
 * left as written, as HTML5 says.
 */
function readReference(text: string, at: number, inAttribute: boolean): { value: string; end: number } | null {
  let i = at + 1;
  if (text[i] === '#') {
    i++;
    const hex = text[i] === 'x' || text[i] === 'X';
    if (hex) i++;
    const digit = hex ? HEX : DIGIT;
    const first = i;
    let value = 0;
    while (i < text.length && digit.test(text[i])) {
      // Past the last code point the value stops growing: it is replaced anyway.
      if (value <= 0x10ffff) value = value * (hex ? 16 : 10) + parseInt(text[i], 16);
      i++;
    }
    if (i === first) return null;
    if (text[i] === ';') i++;
    return { value: numberText(value), end: i };
  }
  let run = i;
  while (run < text.length && run - i <= LONGEST_NAME && ALNUM.test(text[run])) run++;
  if (run === i) return null;
  if (text[run] === ';') {
    const named = NAMED_REFERENCES.get(text.slice(i, run + 1));
    if (named !== undefined) return { value: named, end: run + 1 };
  }
  for (let end = run; end > i; end--) {
    const named = NAMED_REFERENCES.get(text.slice(i, end));
    if (named === undefined) continue;
    if (inAttribute && end < text.length && (text[end] === '=' || ALNUM.test(text[end]))) return null;
    return { value: named, end };
  }
  return null;
}

/** Text with its character references read, as in page text; `inAttribute` for an attribute's value. */
export function decodeEntities(text: string, inAttribute = false): string {
  let at = text.indexOf('&');
  if (at < 0) return text;
  let out = '';
  let from = 0;
  while (at >= 0) {
    const reference = readReference(text, at, inAttribute);
    if (reference) {
      out += text.slice(from, at) + reference.value;
      from = reference.end;
      at = text.indexOf('&', reference.end);
    } else {
      at = text.indexOf('&', at + 1);
    }
  }
  return out + text.slice(from);
}

// --- Reading a page: libxml2's HTML parser, as lxml feeds BeautifulSoup -----
//
// page_checks.py reads a page with BeautifulSoup(html, "lxml"): libxml2
// 2.14's push parser reads it and calls BeautifulSoup back for every element
// it opens or closes and every run of text, and BeautifulSoup builds its tree
// from those calls. libxml2 is not an HTML5 tree builder. It opens and closes
// elements by three tables (libxml.ts) and a few rules of its own
// (htmlCheckImplied, htmlAutoClose, htmlAutoCloseOnClose, htmlParseStartTag,
// htmlParseEndTag, htmlCharDataSAXCallback in HTMLparser.c), and those are
// what this follows, step for step. osg/tests/trees.test.ts compares the
// trees on thousands of made-up documents.

/** HTML whitespace, as libxml2's IS_WS_HTML has it (no vertical tab). */
const WS = /[\t\n\f\r ]/;
const ASCII_LETTER = /[A-Za-z]/;
/** Whitespace BeautifulSoup folds into one character when a string holds nothing else. */
const ASCII_SPACES = /^[\x20\x0a\x09\x0c\x0d]*$/;
/** Strings inside these take their kind (BeautifulSoup's string containers). */
const CONTAINERS: Readonly<Record<string, HtmlText['flavour']>> = { script: 'script', style: 'style', template: 'template', rt: 'rt', rp: 'rp' };
/** Elements whose whitespace BeautifulSoup keeps as it is. */
const PRESERVE_WHITESPACE = new Set(['pre', 'textarea']);
/** Elements htmlCheckImplied puts in an implied <head>. */
const HEAD_ELEMENTS = new Set(['script', 'style', 'meta', 'link', 'title', 'base']);
/** htmlnamePush's ctxt->html: an <head> seen, a <body> seen. */
const INSERT_IN_HEAD = 3;
const INSERT_IN_BODY = 10;

function asciiLower(text: string): string {
  return text.replace(/[A-Z]+/g, (letters) => letters.toLowerCase());
}

const endPriority = (name: string): number => END_PRIORITY[name] ?? DEFAULT_END_PRIORITY;

/**
 * Read a page into a tree, the tree BeautifulSoup builds with lxml. The
 * result is the document; it holds the <html> element when the page has any
 * content at all, with the <head> and <body> libxml2 makes up when the page
 * leaves them out.
 */
export function parseHtml(markup: string): HtmlElement {
  // BeautifulSoup drops one byte order mark at the start, and libxml2 the
  // next one when it detects the encoding. Then HTML5's first step, which
  // libxml2 takes for the whole page: every CR or CR LF becomes LF, and NUL
  // becomes U+FFFD. A reference such as &#13; still stands for a CR: it is read later.
  let source = markup.startsWith('\u{FEFF}') ? markup.slice(1) : markup;
  if (source.startsWith('\u{FEFF}')) source = source.slice(1);
  source = source.replace(/\r\n?/g, '\n').replace(/\0/g, '\u{FFFD}');
  const n = source.length;

  const doc = element('#document', {}, null);
  /** libxml2's name stack, holding the elements themselves. */
  const open: HtmlElement[] = [];
  let level = 0;
  let depth = 0;
  let state: 'misc' | 'prolog' | 'content' = 'misc';
  // BeautifulSoup gathers text until the next element, comment or doctype.
  let pending = '';

  const top = (): HtmlElement | null => open[open.length - 1] ?? null;
  const parent = (): HtmlElement => top() ?? doc;
  const flavourHere = (): HtmlText['flavour'] => {
    for (let index = open.length - 1; index >= 0; index--) {
      const kind = CONTAINERS[open[index].name];
      if (kind) return kind;
    }
    return 'text';
  };
  /** BeautifulSoup's endData: the gathered text becomes one string. */
  const endData = (): void => {
    if (!pending) return;
    let value = pending;
    pending = '';
    if (!open.some((el) => PRESERVE_WHITESPACE.has(el.name)) && ASCII_SPACES.test(value)) value = value.includes('\n') ? '\n' : ' ';
    append(parent(), { kind: 'text', value, flavour: flavourHere(), parent: null });
  };
  const characters = (text: string): void => {
    pending += text;
  };
  const push = (name: string, attrs: Record<string, string>): void => {
    endData();
    if (level < INSERT_IN_HEAD && name === 'head') level = INSERT_IN_HEAD;
    if (level < INSERT_IN_BODY && name === 'body') level = INSERT_IN_BODY;
    const el = element(name, attrs, null);
    append(parent(), el);
    open.push(el);
  };
  const pop = (): void => {
    endData();
    open.pop();
  };

  /** htmlAutoClose: a new tag closes the open elements the table says it closes. */
  const autoClose = (name: string): void => {
    const closes = START_CLOSES[name];
    while (closes && top() && closes.has((top() as HtmlElement).name)) pop();
  };
  /** htmlCheckImplied: the <html>, <head> or <body> a new tag needs. */
  const checkImplied = (name: string): void => {
    if (name === 'html') return;
    if (open.length === 0) push('html', {});
    if (name === 'body' || name === 'head') return;
    if (open.length <= 1 && HEAD_ELEMENTS.has(name)) {
      if (level >= INSERT_IN_HEAD) return;
      push('head', {});
    } else if (name !== 'noframes' && name !== 'frame' && name !== 'frameset') {
      if (level >= INSERT_IN_BODY) return;
      if (open.some((el) => el.name === 'body' || el.name === 'head')) return;
      push('body', {});
    }
  };
  /** htmlStartCharData: text that isn't space needs a body. */
  const startCharData = (): void => {
    if (top()?.name === 'head') autoClose('p');
    checkImplied('p');
  };
  /** htmlCharDataSAXCallback: space in <html> or <head> stays there, the rest opens the body. */
  const text = (value: string): void => {
    if (!value) return;
    const name = top()?.name;
    if (name === undefined || name === 'html' || name === 'head') {
      let i = 0;
      while (i < value.length && WS.test(value[i])) i++;
      if (i > 0) characters(value.slice(0, i));
      if (i === value.length) return;
      value = value.slice(i);
      startCharData();
    }
    characters(value);
  };
  /** A comment or a doctype: BeautifulSoup keeps it as its own node, so the text around it is two strings. */
  const boundary = (): void => endData();

  /**
   * The first half of htmlParseStartTag, which happens before the tag's
   * attributes are read, so a tag the page ends inside has done it too.
   * True when the tag is discarded: an <html> inside the page, a <head>
   * anywhere but first, a second <body>.
   */
  const beginStartTag = (name: string): boolean => {
    autoClose(name);
    checkImplied(name);
    let discard = false;
    if (open.length > 0 && name === 'html') {
      discard = true;
      depth++;
    }
    if (open.length !== 1 && name === 'head') {
      discard = true;
      depth++;
    }
    if (name === 'body') {
      for (const el of open) {
        if (el.name === 'body') {
          discard = true;
          depth++;
        }
      }
    }
    return discard;
  };

  /** The rest of htmlParseStartTag, then htmlParseElementInternal. Returns the data mode the element's text is read in. */
  const finishStartTag = (name: string, attrs: Record<string, string>, selfClosing: boolean, discard: boolean): string | null => {
    if (!discard) push(name, attrs);
    const current = top();
    if (!current) return null;
    // "<x/>" closes whatever element is open now, like an empty one.
    if (selfClosing || EMPTY_ELEMENTS.has(current.name)) {
      pop();
      return null;
    }
    return DATA_MODES[current.name] ?? null;
  };

  /** htmlParseEndTag. */
  const endTag = (name: string): void => {
    if (depth > 0 && (name === 'html' || name === 'body' || name === 'head')) {
      depth--;
      return;
    }
    let index = open.length - 1;
    while (index >= 0 && open[index].name !== name) index--;
    if (index < 0) return;
    // htmlAutoCloseOnClose: an end tag can't reach past an element of higher priority.
    const priority = endPriority(name);
    for (let i = open.length - 1; i >= 0; i--) {
      if (open[i].name === name) break;
      if (endPriority(open[i].name) > priority) return;
    }
    while (top() && (top() as HtmlElement).name !== name) pop();
    if (top()?.name === name) pop();
  };

  /** An attribute name and value (htmlParseAttribute), the value's references read. */
  const readAttribute = (at: number): { name: string; value: string | null; end: number } => {
    let i = at + 1;
    while (i < n && source[i] !== '/' && source[i] !== '>' && source[i] !== '=' && !WS.test(source[i])) i++;
    const name = asciiLower(source.slice(at, i));
    while (i < n && WS.test(source[i])) i++;
    if (source[i] !== '=') return { name, value: null, end: i };
    i++;
    while (i < n && WS.test(source[i])) i++;
    const quote = source[i];
    let value: string;
    if (quote === '"' || quote === "'") {
      const close = source.indexOf(quote, i + 1);
      const stop = close < 0 ? n : close;
      value = source.slice(i + 1, stop);
      i = close < 0 ? n : close + 1;
    } else {
      let stop = i;
      while (stop < n && source[stop] !== '>' && !WS.test(source[stop])) stop++;
      value = source.slice(i, stop);
      i = stop;
    }
    return { name, value: decodeEntities(value, true), end: i };
  };

  /** The attributes of a tag from `at` to its ">" or "/>"; null when the page ends first (the tag is dropped). */
  const readTag = (at: number): { attrs: Record<string, string>; end: number; selfClosing: boolean } | null => {
    // No prototype: an attribute may be called "constructor" or "__proto__".
    const attrs: Record<string, string> = Object.create(null);
    let i = at;
    while (i < n && WS.test(source[i])) i++;
    while (i < n && source[i] !== '>' && !(source[i] === '/' && source[i + 1] === '>')) {
      if (source[i] === '/') {
        i++;
        while (i < n && WS.test(source[i])) i++;
        continue;
      }
      const attribute = readAttribute(i);
      // The first copy of a repeated attribute wins.
      if (!(attribute.name in attrs)) attrs[attribute.name] = attribute.value ?? '';
      i = attribute.end;
      while (i < n && WS.test(source[i])) i++;
    }
    if (i >= n) return null;
    if (source[i] === '>') return { attrs, end: i + 1, selfClosing: false };
    return { attrs, end: i + 2, selfClosing: true };
  };

  /** The text of a raw text element up to its end tag (htmlParseCharData in a data mode). */
  const rawText = (from: number, mode: string, name: string): number => {
    if (mode === 'plaintext') {
      text(source.slice(from));
      return n;
    }
    let escape: 0 | 1 | 2 = 0;
    let i = from;
    while (i < n) {
      const ch = source[i];
      if (ch === '<') {
        let j = i + 1;
        if (mode === 'script' && escape === 0 && source[j] === '!') {
          if (source.startsWith('--', j + 1)) escape = 1;
        } else {
          const solidus = source[j] === '/';
          if (solidus) j++;
          if (solidus || escape === 1) {
            let k = 0;
            // (byte | 0x20) as libxml2 compares: ASCII case doesn't matter.
            while (k < name.length && j < n && (source.charCodeAt(j) | 0x20) === name.charCodeAt(k)) {
              k++;
              j++;
            }
            if (k === name.length && j < n && (source[j] === '>' || source[j] === '/' || WS.test(source[j]))) {
              if (escape === 1 && !solidus) escape = 2;
              else if (escape === 2) escape = 1;
              else break;
            }
          }
        }
      } else if (ch === '-' && escape !== 0 && source.startsWith('->', i + 1)) {
        escape = 0;
      }
      i++;
    }
    const raw = source.slice(from, i);
    if (raw) text(mode === 'rcdata' ? decodeEntities(raw) : raw);
    return i;
  };

  let i = 0;
  while (i < n) {
    if (state !== 'content') {
      while (i < n && WS.test(source[i])) i++;
      if (i >= n) break;
    }
    if (source[i] !== '<') {
      state = 'content';
      let end = source.indexOf('<', i);
      if (end < 0) end = n;
      text(decodeEntities(source.slice(i, end)));
      i = end;
      continue;
    }
    const next = source[i + 1];
    if (next === '!') {
      if (source.startsWith('--', i + 2)) {
        // A comment (htmlParseComment): "<!-->" and "<!--->" are empty, otherwise it ends at "-->" or "--!>".
        let end: number;
        if (source[i + 4] === '>') end = i + 5;
        else if (source.startsWith('->', i + 4)) end = i + 6;
        else {
          const a = source.indexOf('-->', i + 4);
          const b = source.indexOf('--!>', i + 4);
          end = a < 0 && b < 0 ? n : b < 0 || (a >= 0 && a < b) ? a + 3 : b + 4;
        }
        boundary();
        i = end;
        continue;
      }
      if (/^[dD][oO][cC][tT][yY][pP][eE]/.test(source.slice(i + 2, i + 9))) {
        const close = source.indexOf('>', i + 9);
        boundary();
        i = close < 0 ? n : close + 1;
        state = state === 'misc' ? 'prolog' : 'content';
        continue;
      }
      // A bogus comment, to the next ">".
      state = 'content';
      const close = source.indexOf('>', i + 2);
      boundary();
      i = close < 0 ? n : close + 1;
      continue;
    }
    if (next === '?') {
      const close = source.indexOf('>', i + 1);
      boundary();
      i = close < 0 ? n : close + 1;
      continue;
    }
    if (next === '/') {
      state = 'content';
      if (i + 2 >= n) {
        startCharData();
        characters('</');
        i = n;
        continue;
      }
      if (source[i + 2] === '>') {
        i += 3;
        continue;
      }
      if (!ASCII_LETTER.test(source[i + 2])) {
        const close = source.indexOf('>', i + 2);
        boundary();
        i = close < 0 ? n : close + 1;
        continue;
      }
      let nameEnd = i + 3;
      while (nameEnd < n && source[nameEnd] !== '/' && source[nameEnd] !== '>' && !WS.test(source[nameEnd])) nameEnd++;
      const name = asciiLower(source.slice(i + 2, nameEnd));
      const tag = readTag(nameEnd);
      if (!tag) {
        i = n;
        continue;
      }
      i = tag.end;
      endTag(name);
      continue;
    }
    if (next !== undefined && ASCII_LETTER.test(next)) {
      state = 'content';
      let nameEnd = i + 2;
      while (nameEnd < n && source[nameEnd] !== '/' && source[nameEnd] !== '>' && !WS.test(source[nameEnd])) nameEnd++;
      const name = asciiLower(source.slice(i + 1, nameEnd));
      const discard = beginStartTag(name);
      const tag = readTag(nameEnd);
      if (!tag) {
        // The page ends inside the tag: libxml2 drops it.
        i = n;
        continue;
      }
      i = tag.end;
      const mode = finishStartTag(name, tag.attrs, tag.selfClosing, discard);
      if (mode) i = rawText(i, mode, (top() as HtmlElement).name);
      continue;
    }
    // A "<" that starts nothing is text.
    state = 'content';
    startCharData();
    characters('<');
    i++;
  }
  // htmlAutoCloseOnEnd.
  while (open.length) pop();
  endData();
  return doc;
}

// --- Queries ------------------------------------------------------------

export function isElement(node: HtmlNode | null | undefined): node is HtmlElement {
  return node?.kind === 'element';
}

/** Every element under `root` in document order, `root` itself left out. */
export function* descendants(root: HtmlElement): Generator<HtmlElement> {
  const stack: HtmlNode[] = [...root.children].reverse();
  while (stack.length) {
    const node = stack.pop() as HtmlNode;
    if (node.kind !== 'element') continue;
    yield node;
    for (let index = node.children.length - 1; index >= 0; index--) stack.push(node.children[index]);
  }
}

export function findAll(root: HtmlElement, names: string | readonly string[]): HtmlElement[] {
  const wanted = typeof names === 'string' ? new Set([names]) : new Set(names);
  const out: HtmlElement[] = [];
  for (const el of descendants(root)) if (wanted.has(el.name)) out.push(el);
  return out;
}

export function find(root: HtmlElement, names: string | readonly string[]): HtmlElement | null {
  const wanted = typeof names === 'string' ? new Set([names]) : new Set(names);
  for (const el of descendants(root)) if (wanted.has(el.name)) return el;
  return null;
}

export function findBy(root: HtmlElement, test: (el: HtmlElement) => boolean): HtmlElement | null {
  for (const el of descendants(root)) if (test(el)) return el;
  return null;
}

/** The nearest ancestor named one of `names`, or null. */
export function closest(el: HtmlElement, names: string | readonly string[]): HtmlElement | null {
  const wanted = typeof names === 'string' ? new Set([names]) : new Set(names);
  let node = el.parent;
  while (node && node.name !== '#document') {
    if (wanted.has(node.name)) return node;
    node = node.parent;
  }
  return null;
}

export function hasAncestor(el: HtmlElement, ancestor: HtmlElement): boolean {
  let node = el.parent;
  while (node) {
    if (node === ancestor) return true;
    node = node.parent;
  }
  return false;
}

/**
 * Attributes BeautifulSoup holds as a list of words, split on Python's
 * whitespace: class on every element, rel on links and so on.
 */
const LIST_ATTRIBUTES: Record<string, readonly string[]> = {
  '*': ['class', 'accesskey', 'dropzone'],
  a: ['rel', 'rev'],
  link: ['rel', 'rev'],
  td: ['headers'],
  th: ['headers'],
  form: ['accept-charset'],
  object: ['archive'],
  area: ['rel'],
  icon: ['sizes'],
  iframe: ['sandbox'],
  output: ['for'],
};

/**
 * An attribute's value as page_checks.py's _attr reads it, or "" when the
 * attribute is missing: Python's strip(), or the words of a list attribute
 * joined by one space.
 */
export function attr(el: HtmlElement | null | undefined, name: string): string {
  const value = el?.attrs[name];
  if (value === undefined || !el) return '';
  return isListAttribute(el, name) ? pySplit(value).join(' ') : pyStrip(value);
}

/** Whether BeautifulSoup holds this attribute of this element as a list of words. */
export function isListAttribute(el: HtmlElement, name: string): boolean {
  return LIST_ATTRIBUTES['*'].includes(name) || (LIST_ATTRIBUTES[el.name]?.includes(name) ?? false);
}

export function hasAttr(el: HtmlElement, name: string): boolean {
  return Object.prototype.hasOwnProperty.call(el.attrs, name);
}

/** BeautifulSoup's interesting_string_types: a script's text is its script, a template's its template strings, any other element's plain text. */
function textFlavourKept(node: HtmlText, root: HtmlElement): boolean {
  return node.flavour === (CONTAINERS[root.name] ?? 'text');
}

/**
 * The strings under `root`, as BeautifulSoup's `get_text(" ", strip=True)`
 * gives them: each string trimmed, empty ones left out, joined by a space.
 */
export function textParts(root: HtmlElement): string[] {
  const parts: string[] = [];
  const stack: HtmlNode[] = [...root.children].reverse();
  while (stack.length) {
    const node = stack.pop() as HtmlNode;
    if (node.kind === 'text') {
      if (!textFlavourKept(node, root)) continue;
      // BeautifulSoup strips each string with Python's strip().
      const trimmed = pyStrip(node.value);
      if (trimmed) parts.push(trimmed);
      continue;
    }
    for (let index = node.children.length - 1; index >= 0; index--) stack.push(node.children[index]);
  }
  return parts;
}

/** `root`'s text in one line: the strings joined by a space, every run of space made one. */
export function textOf(root: HtmlElement): string {
  // re.sub(r"\s+", " ", ...).strip(), with Python's whitespace.
  return pySplit(textParts(root).join(' ')).join(' ');
}

/** Every string under `root`, untrimmed and with nothing left out (a script's JSON, for one). */
export function rawText(root: HtmlElement): string {
  let out = '';
  const stack: HtmlNode[] = [...root.children].reverse();
  while (stack.length) {
    const node = stack.pop() as HtmlNode;
    if (node.kind === 'text') out += node.value;
    else for (let index = node.children.length - 1; index >= 0; index--) stack.push(node.children[index]);
  }
  return out;
}

/** The element children of `el`. */
export function childElements(el: HtmlElement): HtmlElement[] {
  return el.children.filter(isElement);
}

/** A copy of the tree with the elements `drop` says yes to taken out, for text that leaves parts out. */
export function without(root: HtmlElement, drop: (el: HtmlElement) => boolean): HtmlElement {
  const copy = (el: HtmlElement, parent: HtmlElement | null): HtmlElement => {
    const out = element(el.name, el.attrs, parent);
    for (const child of el.children) {
      if (child.kind === 'text') out.children.push({ ...child, parent: out });
      else if (!drop(child)) out.children.push(copy(child, out));
    }
    return out;
  };
  return copy(root, null);
}
