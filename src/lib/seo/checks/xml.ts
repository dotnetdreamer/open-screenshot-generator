// Copied from github.com/dotnetdreamer/claude-seo osg/checks/xml.ts at da732e65be7f.
// Change it there and run npm run sync:seo-checks. Edits here are lost on the next sync.

// XML the way claude-seo's sitemap check reads it (scripts/sitemap_discovery.py,
// _classify): lxml 6 over libxml2 2.14, strict (recover=False), with no DTD
// (a document with "<!DOCTYPE" anywhere is refused before it gets here), no
// network, namespaces checked, CDATA read as text, and comments and
// processing instructions kept as nodes. parseXml gives the tree, or null
// where lxml raises XMLSyntaxError: any well-formedness or namespace error.
//
// Only what the sitemap check reads is kept: element tags as lxml writes
// them ("{namespace}local" or "local"), attributes by lxml's names, the
// character data before each element's first child (lxml's .text), and the
// order of children. Rules are XML 1.0 (fifth edition) and Namespaces in XML,
// as libxml2 applies them; tests/sitemaps.test.ts holds them to lxml.

const XML_NS = 'http://www.w3.org/XML/1998/namespace';
const XMLNS_NS = 'http://www.w3.org/2000/xmlns/';
/** libxml2's element depth without XML_PARSE_HUGE (lxml's huge_tree=False). */
const MAX_DEPTH = 256;
/** XML_MAX_TEXT_LENGTH: the most bytes in one text node, attribute value, comment or PI. */
const MAX_TEXT_BYTES = 10_000_000;
/** XML_MAX_NAME_LENGTH. */
const MAX_NAME = 50_000;
/** The most bytes in one start tag, CDATA section or PI this port says lxml reads (Parser.sizeFollowed). */
const MAX_FOLLOWED = 9_000_000;

export interface XmlElement {
  type: 'element';
  /** lxml's tag: "{namespace}local", or "local" for no namespace. */
  tag: string;
  /** Attribute values by lxml's names ("{namespace}local" or "local"). */
  attributes: Map<string, string>;
  /** Child elements, comments and processing instructions, in order. Text isn't a node here, as in lxml. */
  children: XmlNode[];
  /** lxml's .text: the character data before the first child node, null when there's none. */
  text: string | null;
  parent: XmlElement | null;
}

export type XmlNode = XmlElement | { type: 'comment' } | { type: 'pi' };

/** Why a document can't be read here although lxml might read it: an encoding this port doesn't decode. */
export class XmlUnsupported extends Error {}

class XmlError extends Error {}

const isS = (cp: number) => cp === 0x20 || cp === 0x09 || cp === 0x0a || cp === 0x0d;

function isChar(cp: number): boolean {
  return cp === 0x09 || cp === 0x0a || cp === 0x0d || (cp >= 0x20 && cp <= 0xd7ff) || (cp >= 0xe000 && cp <= 0xfffd) || (cp >= 0x10000 && cp <= 0x10ffff);
}

function isNameStart(cp: number): boolean {
  return (
    cp === 0x3a || (cp >= 0x41 && cp <= 0x5a) || cp === 0x5f || (cp >= 0x61 && cp <= 0x7a) ||
    (cp >= 0xc0 && cp <= 0xd6) || (cp >= 0xd8 && cp <= 0xf6) || (cp >= 0xf8 && cp <= 0x2ff) ||
    (cp >= 0x370 && cp <= 0x37d) || (cp >= 0x37f && cp <= 0x1fff) || (cp >= 0x200c && cp <= 0x200d) ||
    (cp >= 0x2070 && cp <= 0x218f) || (cp >= 0x2c00 && cp <= 0x2fef) || (cp >= 0x3001 && cp <= 0xd7ff) ||
    (cp >= 0xf900 && cp <= 0xfdcf) || (cp >= 0xfdf0 && cp <= 0xfffd) || (cp >= 0x10000 && cp <= 0xeffff)
  );
}

function isNameChar(cp: number): boolean {
  return isNameStart(cp) || cp === 0x2d || cp === 0x2e || (cp >= 0x30 && cp <= 0x39) || cp === 0xb7 || (cp >= 0x300 && cp <= 0x36f) || (cp >= 0x203f && cp <= 0x2040);
}

/**
 * libxml2's xmlParseURI (uri.c, 2.14): whether a namespace name parses as
 * an RFC 3986 URI reference, with none of the leniency some callers ask for.
 * Two of its quirks are kept: a host never parses as IPv4 (a missing step
 * skips the third octet) and so is read as a name, and inside [ ] anything
 * but "]" goes. libxml2 calls a namespace name that doesn't parse an
 * error, and a default namespace without a scheme a warning.
 */
function uriKind(text: string): 'absolute' | 'relative' | null {
  const at = (i: number) => (i < text.length ? text[i] : '');
  const alpha = (i: number) => /^[A-Za-z]$/.test(at(i));
  const digit = (i: number) => /^[0-9]$/.test(at(i));
  const hex = (i: number) => /^[0-9A-Fa-f]$/.test(at(i));
  const unreserved = (i: number) => alpha(i) || digit(i) || (at(i) !== '' && '-._~'.includes(at(i)));
  const subDelim = (i: number) => at(i) !== '' && "!$&()*+,;='".includes(at(i));
  const pct = (i: number) => at(i) === '%' && hex(i + 1) && hex(i + 2);
  const pchar = (i: number) => unreserved(i) || pct(i) || subDelim(i) || at(i) === ':' || at(i) === '@';
  const next = (i: number) => (at(i) === '%' ? i + 3 : i + 1);
  const segment = (i: number, forbid: string, empty: boolean): number => {
    if (!pchar(i) || (forbid !== '' && at(i) === forbid)) return empty ? i : -1;
    i = next(i);
    while (pchar(i) && !(forbid !== '' && at(i) === forbid)) i = next(i);
    return i;
  };
  const afterSlashes = (i: number) => {
    while (at(i) === '/') i = segment(i + 1, '', true);
    return i;
  };
  const authority = (i: number): number => {
    let j = i;
    while (unreserved(j) || pct(j) || subDelim(j) || at(j) === ':') j = next(j);
    if (at(j) === '@') i = j + 1;
    if (at(i) === '[') {
      i++;
      while (i < text.length && at(i) !== ']') i++;
      if (at(i) !== ']') return -1;
      i++;
    } else {
      while (unreserved(i) || pct(i) || subDelim(i)) i = next(i);
    }
    if (at(i) === ':') {
      i++;
      if (!digit(i)) return -1;
      let port = 0;
      while (digit(i)) {
        port = port * 10 + Number(at(i));
        if (port > 2147483647) return -1;
        i++;
      }
    }
    return i;
  };
  const tail = (i: number): boolean => {
    if (at(i) === '?') {
      i++;
      while (pchar(i) || at(i) === '/' || at(i) === '?') i = next(i);
    }
    if (at(i) === '#') {
      i++;
      while (pchar(i) || at(i) === '/' || at(i) === '?' || at(i) === '[' || at(i) === ']') i = next(i);
    }
    return i >= text.length;
  };
  const path = (i: number, noScheme: boolean): number => {
    if (at(i) === '/' && at(i + 1) === '/') {
      const end = authority(i + 2);
      return end < 0 ? -1 : afterSlashes(end);
    }
    if (at(i) === '/') {
      const first = segment(i + 1, '', false);
      return first < 0 ? i + 1 : afterSlashes(first);
    }
    if (pchar(i)) {
      const first = segment(i, noScheme ? ':' : '', false);
      return first < 0 ? -1 : afterSlashes(first);
    }
    return i;
  };
  // An absolute URI first: scheme ":" hier-part [ "?" query ] [ "#" fragment ].
  if (alpha(0)) {
    let i = 1;
    while (alpha(i) || digit(i) || at(i) === '+' || at(i) === '-' || at(i) === '.') i++;
    if (at(i) === ':') {
      const end = path(i + 1, false);
      if (end >= 0 && tail(end)) return 'absolute';
    }
  }
  // Then a relative reference.
  const end = path(0, true);
  return end >= 0 && tail(end) ? 'relative' : null;
}

function utf8Length(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    if (unit < 0x80) bytes += 1;
    else if (unit < 0x800) bytes += 2;
    else if (unit >= 0xd800 && unit <= 0xdbff) {
      bytes += 4;
      i++;
    } else bytes += 3;
  }
  return bytes;
}

/**
 * The document's characters, decoded as libxml2 decodes them: after a
 * UTF-8 BOM, UTF-8 whatever the declaration says; otherwise the
 * declaration's encoding when it's UTF-8, ISO-8859-1 or US-ASCII, the ones
 * libxml2 decodes itself. Any other goes through iconv there, which this
 * port doesn't copy, so it's XmlUnsupported. Bytes that aren't valid in the
 * encoding are an error.
 */
function decode(bytes: Uint8Array): string {
  let start = 0;
  const bom = bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  if (bom) start = 3;
  // libxml2 reads "<" NUL "?" NUL as UTF-16 and "<" NUL NUL NUL as UCS-4 (xmlDetectCharEncoding).
  if (!bom && bytes[0] === 0x3c && bytes[1] === 0 && ((bytes[2] === 0x3f && bytes[3] === 0) || (bytes[2] === 0 && bytes[3] === 0))) {
    throw new XmlUnsupported('UTF-16 or UCS-4 without a BOM');
  }
  let encoding = 'utf-8';
  const lead = bytes.subarray(start, Math.min(bytes.length, start + 65536));
  let head = '';
  for (let i = 0; i < lead.length; i += 8192) head += String.fromCharCode(...lead.subarray(i, i + 8192));
  if (!bom && head.startsWith('<?xml') && isS(head.charCodeAt(5))) {
    // The declaration first, read as libxml2 reads it before it switches encoding: a bad one is an error whatever it names.
    const name = new Parser(head).declarationEncoding();
    if (name !== null) {
      const lower = name.toLowerCase();
      if (lower === 'utf-8' || lower === 'utf8') encoding = 'utf-8';
      else if (lower === 'iso-8859-1' || lower === 'iso8859-1' || lower === 'latin1' || lower === 'iso-latin-1' || lower === 'iso_8859-1') encoding = 'latin1';
      else if (lower === 'us-ascii' || lower === 'ascii') encoding = 'ascii';
      else throw new XmlUnsupported(`encoding ${name}`);
    }
  }
  const body = bytes.subarray(start);
  if (encoding === 'latin1') {
    let out = '';
    for (let i = 0; i < body.length; i += 8192) out += String.fromCharCode(...body.subarray(i, i + 8192));
    return out;
  }
  // A declared encoding is converted all at once, so a bad byte anywhere is an error.
  if (encoding === 'ascii') {
    for (const byte of body) if (byte > 0x7f) throw new XmlError('not ASCII');
  }
  // UTF-8 is checked only as it's read: the text stops at the first bad sequence, with a NUL
  // there that is an error wherever the parser reads it, and nothing where it doesn't.
  const bad = firstBadUtf8(body);
  const good = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(body.subarray(0, bad));
  return bad < body.length ? `${good}\u{0}` : good;
}

/** Where the first byte sequence that isn't UTF-8 starts (Unicode's table 3-7), or the length. */
function firstBadUtf8(bytes: Uint8Array): number {
  for (let i = 0; i < bytes.length; ) {
    const b = bytes[i];
    if (b < 0x80) {
      i++;
      continue;
    }
    const cont = (at: number, lo = 0x80, hi = 0xbf) => at < bytes.length && bytes[at] >= lo && bytes[at] <= hi;
    let size = 0;
    if (b >= 0xc2 && b <= 0xdf) size = cont(i + 1) ? 2 : 0;
    else if (b === 0xe0) size = cont(i + 1, 0xa0) && cont(i + 2) ? 3 : 0;
    else if ((b >= 0xe1 && b <= 0xec) || b === 0xee || b === 0xef) size = cont(i + 1) && cont(i + 2) ? 3 : 0;
    else if (b === 0xed) size = cont(i + 1, 0x80, 0x9f) && cont(i + 2) ? 3 : 0;
    else if (b === 0xf0) size = cont(i + 1, 0x90) && cont(i + 2) && cont(i + 3) ? 4 : 0;
    else if (b >= 0xf1 && b <= 0xf3) size = cont(i + 1) && cont(i + 2) && cont(i + 3) ? 4 : 0;
    else if (b === 0xf4) size = cont(i + 1, 0x80, 0x8f) && cont(i + 2) && cont(i + 3) ? 4 : 0;
    if (!size) return i;
    i += size;
  }
  return bytes.length;
}

interface Scope {
  prefixes: Map<string, string>;
  defaultNs: string | null;
}

class Parser {
  private i = 0;
  private depth = 0;

  private readonly src: string;

  constructor(src: string) {
    this.src = src;
  }

  private cp(at = this.i): number {
    return at < this.src.length ? this.src.codePointAt(at)! : -1;
  }

  private step(cp: number): void {
    this.i += cp > 0xffff ? 2 : 1;
  }

  private startsWith(text: string): boolean {
    return this.src.startsWith(text, this.i);
  }

  private fail(why: string): never {
    throw new XmlError(why);
  }

  /**
   * Namespace errors and warnings recorded so far, and which came last.
   * libxml2 records 100 of each at most (XML_MAX_ERRORS), and one it
   * doesn't record can't be the last.
   */
  private nsErrors = 0;
  private warnings = 0;
  private last: 'error' | 'warning' | null = null;

  /** A namespace error: libxml2 reports it and reads on (xmlNsErr). */
  private nsError(why: string): void {
    void why;
    if (this.nsErrors >= 100) return;
    this.nsErrors++;
    this.last = 'error';
  }

  /** A warning: a version 1.x, a PI named xml..., a default namespace without a scheme, an xml:space value. */
  private warn(why: string): void {
    void why;
    if (this.warnings >= 100) return;
    this.warnings++;
    this.last = 'warning';
  }

  /** Whitespace; true when there was some. */
  private blanks(): boolean {
    const from = this.i;
    while (isS(this.cp())) this.i++;
    return this.i > from;
  }

  /** A Name. `whole` checks its length as one name (a PI target, an entity); an element or attribute name is checked by part (split). */
  private name(whole = false): string {
    const from = this.i;
    const first = this.cp();
    if (!isNameStart(first)) this.fail('invalid name');
    this.step(first);
    for (let cp = this.cp(); cp >= 0 && isNameChar(cp); cp = this.cp()) this.step(cp);
    const name = this.src.slice(from, this.i);
    if (whole && Array.from(name).length > MAX_NAME) this.fail('Name too long');
    return name;
  }

  document(): XmlElement {
    if (this.startsWith('<?xml') && isS(this.cp(this.i + 5))) this.declaration();
    this.misc();
    if (!(this.src[this.i] === '<' && isNameStart(this.cp(this.i + 1)))) this.fail('Start tag expected');
    const root = this.element(null, { prefixes: new Map([['xml', XML_NS]]), defaultNs: null });
    this.misc();
    // xmlParserCheckEOF: once any error is recorded, what follows the root isn't looked at.
    if (this.i < this.src.length && !this.nsErrors) this.fail('Extra content at the end of the document');
    // lxml takes a document whose last report was a warning, namespace errors and all, as well formed.
    if (this.last === 'error') this.fail('a namespace error');
    if (this.nsErrors) throw new XmlUnsupported('namespace errors lxml lets through after a warning');
    return root;
  }

  /** The XML declaration at the start: the encoding it names, or null when it names none. */
  declarationEncoding(): string | null {
    return this.declaration();
  }

  private declaration(): string | null {
    this.i += 5;
    this.blanks();
    if (!this.startsWith('version')) this.fail('Malformed declaration expecting version');
    this.i += 7;
    // xmlParseVersionNum: one digit, a dot, then digits.
    const version = this.quotedAfterEquals((value) => /^[0-9]\.[0-9]*$/.test(value));
    if (version !== '1.0' && !version.startsWith('1.')) this.fail(`Unsupported version '${version}'`);
    if (version !== '1.0') this.warn(`Unsupported version '${version}'`);
    let spaced = this.blanks();
    let encoding: string | null = null;
    if (this.startsWith('encoding')) {
      if (!spaced) this.fail('Blank needed here');
      this.i += 8;
      encoding = this.quotedAfterEquals((value) => /^[A-Za-z][A-Za-z0-9._-]*$/.test(value));
      spaced = this.blanks();
    }
    if (this.startsWith('standalone')) {
      if (!spaced) this.fail('Blank needed here');
      this.i += 10;
      this.quotedAfterEquals((value) => value === 'yes' || value === 'no');
      this.blanks();
    }
    if (!this.startsWith('?>')) this.fail("parsing XML declaration: '?>' expected");
    this.i += 2;
    return encoding;
  }

  private quotedAfterEquals(valid: (value: string) => boolean): string {
    this.blanks();
    if (this.src[this.i] !== '=') this.fail("'=' expected");
    this.i++;
    this.blanks();
    const quote = this.src[this.i];
    if (quote !== '"' && quote !== "'") this.fail('quote expected');
    const end = this.src.indexOf(quote, this.i + 1);
    if (end < 0) this.fail('quote not closed');
    const value = this.src.slice(this.i + 1, end);
    if (!valid(value)) this.fail(`invalid value ${value}`);
    this.i = end + 1;
    return value;
  }

  /** Comments, processing instructions and whitespace, before or after the root. */
  private misc(): void {
    for (;;) {
      this.blanks();
      if (this.startsWith('<!--')) this.comment();
      else if (this.startsWith('<?')) this.pi();
      else return;
    }
  }

  /** A comment: no "--" inside, so it ends at the first "--", which must be "-->". */
  private comment(): void {
    this.i += 4;
    const at = this.src.indexOf('--', this.i);
    if (at < 0) this.fail('Comment not terminated');
    this.checkChars(this.i, at);
    if (this.src[at + 2] !== '>') this.fail('Double hyphen within comment');
    if (utf8Length(this.src.slice(this.i, at)) > MAX_TEXT_BYTES) this.fail('Comment too big');
    this.i = at + 3;
  }

  private pi(): void {
    this.i += 2;
    const target = this.name(true);
    // xmlParsePITarget: xml itself, any case, is refused; another name that starts so is a warning.
    if (/^[xX][mM][lL]/.test(target)) {
      if (target === 'xml') this.fail('XML declaration allowed only at the start of the document');
      if (target.length === 3) this.fail('Invalid PI name');
      if (target !== 'xml-stylesheet' && target !== 'xml-model') this.warn("xmlParsePITarget: invalid name prefix 'xml'");
    }
    if (target.includes(':')) this.nsError('colons are forbidden from PI names');
    if (this.startsWith('?>')) {
      this.i += 2;
      return;
    }
    if (!this.blanks()) this.fail('ParsePI: PI space expected');
    const end = this.src.indexOf('?>', this.i);
    if (end < 0) this.fail('PI not terminated');
    this.checkChars(this.i, end);
    this.sizeFollowed(this.i, end);
    if (utf8Length(this.src.slice(this.i, end)) > MAX_TEXT_BYTES) this.fail('PI too big');
    this.i = end + 2;
  }

  private checkChars(from: number, to: number): void {
    for (let at = from; at < to; ) {
      const cp = this.src.codePointAt(at)!;
      if (!isChar(cp)) this.fail(`invalid Char value ${cp}`);
      at += cp > 0xffff ? 2 : 1;
    }
  }

  /** A character or entity reference, at "&". */
  private reference(): string {
    this.i++;
    if (this.src[this.i] === '#') {
      // xmlParseCharRef, to its counter: past ten hex digits it takes a
      // letter only at some places, where its buffer would have grown.
      this.i++;
      const hex = this.src[this.i] === 'x';
      if (hex) this.i++;
      let value = 0;
      let count = 0;
      while (this.src[this.i] !== ';') {
        if (count++ > 20) count = 0;
        const ch = this.src[this.i] ?? '';
        if (ch >= '0' && ch <= '9') value = value * (hex ? 16 : 10) + (ch.charCodeAt(0) - 48);
        else if (hex && ((ch >= 'a' && ch <= 'f') || (ch >= 'A' && ch <= 'F')) && count < 20) value = value * 16 + (ch.toLowerCase().charCodeAt(0) - 87);
        else this.fail('xmlParseCharRef: invalid value');
        if (value > 0x110000) value = 0x110000;
        this.i++;
        count++;
      }
      this.i++;
      if (!isChar(value)) this.fail(`xmlParseCharRef: invalid xmlChar value ${value}`);
      return String.fromCodePoint(value);
    }
    if (!isNameStart(this.cp())) this.fail('xmlParseEntityRef: no name');
    const name = this.name(true);
    if (this.src[this.i] !== ';') this.fail("EntityRef: expecting ';'");
    this.i++;
    const value = { lt: '<', gt: '>', amp: '&', apos: "'", quot: '"' }[name];
    if (value === undefined) this.fail(`Entity '${name}' not defined`);
    return value;
  }

  private attributeValue(): string {
    const quote = this.src[this.i];
    if (quote !== '"' && quote !== "'") this.fail('AttValue: " or \' expected');
    this.i++;
    let out = '';
    for (;;) {
      const cp = this.cp();
      if (cp < 0) this.fail('AttValue: not terminated');
      const ch = this.src[this.i];
      if (ch === quote) break;
      if (ch === '<') this.fail("Unescaped '<' not allowed in attributes values");
      if (ch === '&') {
        out += this.reference();
        continue;
      }
      if (!isChar(cp)) this.fail(`invalid Char value ${cp}`);
      out += isS(cp) ? ' ' : String.fromCodePoint(cp);
      this.step(cp);
    }
    this.i++;
    if (utf8Length(out) > MAX_TEXT_BYTES) this.fail('AttValue length too long');
    return out;
  }

  /**
   * A QName's prefix and local part, each an NCName of at most
   * XML_MAX_NAME_LENGTH characters. One that isn't a QName is a namespace
   * error, and libxml2 goes on with the whole name and no prefix.
   */
  private qname(raw: string): [string | null, string] {
    const long = (part: string) => part.length > MAX_NAME && Array.from(part).length > MAX_NAME;
    const ncname = (part: string) => part.length > 0 && !part.includes(':') && isNameStart(part.codePointAt(0)!);
    const colon = raw.indexOf(':');
    const prefix = colon < 0 ? null : raw.slice(0, colon);
    const local = colon < 0 ? raw : raw.slice(colon + 1);
    if (prefix !== null && long(prefix)) this.fail('NCName too long');
    if (long(local)) this.fail('NCName too long');
    if ((prefix !== null && !ncname(prefix)) || !ncname(local)) {
      this.nsError(`Failed to parse QName '${raw}'`);
      return [null, raw];
    }
    return [prefix, local];
  }

  /**
   * A start tag, CDATA section or PI read in one piece: libxml2 refuses one
   * once its input buffer passes ten million bytes, and where that falls
   * depends on its buffer, so past MAX_FOLLOWED this port says so instead.
   */
  private sizeFollowed(from: number, to: number): void {
    if ((to - from) * 3 > MAX_FOLLOWED && utf8Length(this.src.slice(from, to)) > MAX_FOLLOWED) throw new XmlUnsupported('a start tag, CDATA section or PI over 9 MB');
  }

  /**
   * An element, its start tag checked in libxml2's order (xmlParseStartTag2):
   * the name; then each attribute as it's read, a namespace declaration
   * checked and declared there; then the attributes' prefixes; then names
   * used twice; then the element's own prefix. Which comes last matters:
   * lxml refuses a document whose last error or warning is an error.
   */
  private element(parent: XmlElement | null, outer: Scope): XmlElement {
    this.depth++;
    if (this.depth > MAX_DEPTH) this.fail(`Excessive depth in document: ${MAX_DEPTH}`);
    const tagStart = this.i;
    this.i++;
    const qname = this.name();
    const [prefix, local] = this.qname(qname);
    const scope: Scope = { prefixes: outer.prefixes, defaultNs: outer.defaultNs };
    let copied = false;
    let declaredDefault = false;
    const declared = new Set<string>();
    const attrs: Array<{ prefix: string | null; local: string; value: string }> = [];
    let selfClosed = false;
    for (;;) {
      const spaced = this.blanks();
      if (this.startsWith('/>')) {
        this.i += 2;
        selfClosed = true;
        break;
      }
      if (this.src[this.i] === '>') {
        this.i++;
        break;
      }
      if (!spaced || !isNameStart(this.cp())) this.fail('attributes construct error');
      const [attrPrefix, attrLocal] = this.qname(this.name());
      this.blanks();
      if (this.src[this.i] !== '=') this.fail('Specification mandates value for attribute');
      this.i++;
      this.blanks();
      const value = this.attributeValue();
      if (attrPrefix === null && attrLocal === 'xmlns') {
        let keep = true;
        if (value !== '') {
          const uri = uriKind(value);
          if (uri === null) this.nsError(`xmlns: '${value}' is not a valid URI`);
          else if (uri === 'relative') this.warn(`xmlns: URI ${value} is not absolute`);
          if (value === XML_NS) {
            this.nsError('xml namespace URI cannot be the default namespace');
            keep = false;
          } else if (value === XMLNS_NS) {
            this.nsError('reuse of the xmlns namespace name is forbidden');
            keep = false;
          }
        }
        if (keep) {
          if (declaredDefault) this.fail('Attribute xmlns redefined');
          declaredDefault = true;
          scope.defaultNs = value === '' ? null : value;
        }
      } else if (attrPrefix === 'xmlns') {
        let keep = false;
        if (attrLocal === 'xml') {
          if (value !== XML_NS) this.nsError('xml namespace prefix mapped to wrong URI');
        } else if (value === XML_NS) this.nsError('xml namespace URI mapped to wrong prefix');
        else if (attrLocal === 'xmlns') this.nsError('redefinition of the xmlns prefix is forbidden');
        else if (value === XMLNS_NS) this.nsError('reuse of the xmlns namespace name is forbidden');
        else if (value === '') this.nsError(`xmlns:${attrLocal}: Empty XML namespace is not allowed`);
        else {
          // A name that isn't a URI is reported, and declared all the same.
          if (uriKind(value) === null) this.nsError(`xmlns:${attrLocal}: '${value}' is not a valid URI`);
          keep = true;
        }
        if (keep) {
          if (declared.has(attrLocal)) this.fail(`Attribute xmlns:${attrLocal} redefined`);
          declared.add(attrLocal);
          if (!copied) {
            scope.prefixes = new Map(outer.prefixes);
            copied = true;
          }
          scope.prefixes.set(attrLocal, value);
        }
      } else {
        if (attrPrefix === 'xml' && attrLocal === 'space' && value !== 'default' && value !== 'preserve') this.warn('Invalid value for xml:space');
        attrs.push({ prefix: attrPrefix, local: attrLocal, value });
      }
    }
    this.sizeFollowed(tagStart, this.i);

    // The attributes' prefixes, then each name in its namespace once.
    const resolved = attrs.map((attr) => {
      if (attr.prefix === null) return { ...attr, ns: null as string | null, unbound: false };
      const bound = scope.prefixes.get(attr.prefix);
      if (bound === undefined) this.nsError(`Namespace prefix ${attr.prefix} for ${attr.local} on ${local} is not defined`);
      return { ...attr, ns: bound ?? null, unbound: bound === undefined };
    });
    const element: XmlElement = { type: 'element', tag: local, attributes: new Map(), children: [], text: null, parent };
    if (resolved.length > 1) {
      const first = new Map<string, string | null>();
      for (const attr of resolved) {
        if (attr.unbound) continue;
        const key = JSON.stringify([attr.ns, attr.local]);
        if (!first.has(key)) first.set(key, attr.prefix);
        else if (first.get(key) === attr.prefix) this.fail(`Attribute ${attr.local} redefined`);
        else this.nsError(`Namespaced Attribute ${attr.local} in '${attr.ns}' redefined`);
      }
    }
    for (const attr of resolved) {
      const key = attr.unbound ? `${attr.prefix}:${attr.local}` : attr.ns ? `{${attr.ns}}${attr.local}` : attr.local;
      if (!element.attributes.has(key)) element.attributes.set(key, attr.value);
    }

    // The element's own namespace.
    if (prefix === null) {
      if (scope.defaultNs) element.tag = `{${scope.defaultNs}}${local}`;
    } else {
      const bound = scope.prefixes.get(prefix);
      if (bound === undefined) {
        this.nsError(`Namespace prefix ${prefix} on ${local} is not defined`);
        element.tag = qname;
      } else {
        element.tag = `{${bound}}${local}`;
      }
    }
    if (!selfClosed) this.content(element, qname, scope);
    this.depth--;
    return element;
  }

  private content(element: XmlElement, qname: string, scope: Scope): void {
    let text = '';
    let hasText = false;
    let textBytes = 0;
    const flush = () => {
      if (!element.children.length && hasText) element.text = (element.text ?? '') + text;
      text = '';
      hasText = false;
      textBytes = 0;
    };
    const addText = (chunk: string) => {
      text += chunk;
      hasText = true;
      textBytes += utf8Length(chunk);
      if (textBytes > MAX_TEXT_BYTES) this.fail('xmlSAX2Characters: huge text node');
    };
    for (;;) {
      if (this.i >= this.src.length) this.fail('Premature end of data');
      const ch = this.src[this.i];
      if (ch === '<') {
        if (this.src[this.i + 1] === '/') {
          this.i += 2;
          const name = this.name();
          if (name !== qname) this.fail(`Opening and ending tag mismatch: ${qname} and ${name}`);
          this.blanks();
          if (this.src[this.i] !== '>') this.fail("expected '>'");
          this.i++;
          flush();
          return;
        }
        if (this.startsWith('<![CDATA[')) {
          const end = this.src.indexOf(']]>', this.i + 9);
          if (end < 0) this.fail('CData section not finished');
          this.checkChars(this.i + 9, end);
          this.sizeFollowed(this.i, end + 3);
          addText(this.src.slice(this.i + 9, end));
          this.i = end + 3;
          continue;
        }
        flush();
        if (this.startsWith('<!--')) {
          this.comment();
          element.children.push({ type: 'comment' });
        } else if (this.startsWith('<?')) {
          this.pi();
          element.children.push({ type: 'pi' });
        } else if (isNameStart(this.cp(this.i + 1))) {
          element.children.push(this.element(element, scope));
        } else {
          this.fail('StartTag: invalid element name');
        }
        continue;
      }
      if (ch === '&') {
        addText(this.reference());
        continue;
      }
      // Character data up to the next markup.
      let end = this.i;
      while (end < this.src.length && this.src[end] !== '<' && this.src[end] !== '&') end++;
      const chunk = this.src.slice(this.i, end);
      if (chunk.includes(']]>')) this.fail("Sequence ']]>' not allowed in content");
      this.checkChars(this.i, end);
      addText(chunk);
      this.i = end;
    }
  }
}

/**
 * The document's root, as lxml builds it, or null where lxml raises
 * XMLSyntaxError. Throws XmlUnsupported for an encoding this port doesn't
 * decode, where lxml might read the document or might not.
 */
export function parseXml(bytes: Uint8Array): XmlElement | null {
  let text: string;
  try {
    text = decode(bytes);
  } catch (error) {
    if (error instanceof XmlError) return null;
    throw error;
  }
  // Line ends as XML reads them: CR LF and a lone CR are one LF.
  text = text.replace(/\r\n?/g, '\n');
  try {
    return new Parser(text).document();
  } catch (error) {
    if (error instanceof XmlError) return null;
    throw error;
  }
}
