// Copied from github.com/dotnetdreamer/claude-seo osg/checks/py.ts at da732e65be7f.
// Change it there and run npm run sync:seo-checks. Edits here are lost on the next sync.

// The few Python behaviours the checks depend on, so the TypeScript versions
// give the scripts' numbers and words to the last digit.

import { LOWER_RUNS, LOWER_SPECIALS, PACKED_RANGES } from './pyUnicode';

/**
 * Python's round(x, digits): the exact value of the double is rounded, and a
 * value exactly halfway goes to the even neighbour. JavaScript rounds a half
 * up, and toFixed works on a string, so both differ on values like 2.5 and
 * 0.0625.
 */
export function pyRound(value: number, digits = 0): number {
  if (!Number.isFinite(value) || value === 0) return value;
  // BigInt() calls, not 1n literals: the app compiles for ES2017.
  const ONE = BigInt(1);
  const TWO = BigInt(2);
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value);
  const bits = view.getBigUint64(0);
  const negative = bits >> BigInt(63) === ONE;
  const exponentBits = Number((bits >> BigInt(52)) & BigInt(0x7ff));
  let mantissa = bits & ((ONE << BigInt(52)) - ONE);
  let exponent: number;
  if (exponentBits === 0) {
    exponent = -1074;
  } else {
    mantissa |= ONE << BigInt(52);
    exponent = exponentBits - 1075;
  }
  let numerator = mantissa * BigInt(10) ** BigInt(digits);
  let denominator = ONE;
  if (exponent >= 0) numerator <<= BigInt(exponent);
  else denominator <<= BigInt(-exponent);
  let quotient = numerator / denominator;
  const twice = TWO * (numerator % denominator);
  if (twice > denominator || (twice === denominator && quotient % TWO === ONE)) quotient += ONE;
  const rounded = Number(quotient) / 10 ** digits;
  return negative ? -rounded : rounded;
}

/** Python's int(round(x)). */
export function pyRoundInt(value: number): number {
  return pyRound(value, 0);
}

/** Python's str.splitlines(): every line break Python knows, the last empty line dropped. */
export function pySplitLines(text: string): string[] {
  const lines = text.split(/\r\n|[\n\r\v\f\x1c\x1d\x1e\x85\u2028\u2029]/);
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

// --- Python's character tables (pyUnicode.ts) --------------------------------

type Ranges = ReadonlyArray<readonly [number, number]>;
type Table = keyof typeof PACKED_RANGES;
const decoded = new Map<Table, Ranges>();

/** One of Python's tables, as [first, last] code point pairs in order. */
export function pyTable(name: Table): Ranges {
  let ranges = decoded.get(name);
  if (!ranges) {
    const out: Array<[number, number]> = [];
    let last = -1;
    for (const pair of PACKED_RANGES[name].split(' ')) {
      const [gap, length] = pair.split('.').map((part) => parseInt(part, 36));
      const start = last + 1 + gap;
      last = start + length;
      out.push([start, last]);
    }
    ranges = out;
    decoded.set(name, ranges);
  }
  return ranges;
}

/** Whether the code point is in one of Python's tables. */
export function inTable(name: Table, cp: number): boolean {
  const ranges = pyTable(name);
  let lo = 0;
  let hi = ranges.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cp < ranges[mid][0]) hi = mid - 1;
    else if (cp > ranges[mid][1]) lo = mid + 1;
    else return true;
  }
  return false;
}

/** A regular expression class for a table. Code points past U+FFFF need the u flag. */
export function pyClass(name: Table, extra = '', negate = false): string {
  const escape = (cp: number) => (cp <= 0xffff ? `\\u${cp.toString(16).padStart(4, '0')}` : `\\u{${cp.toString(16)}}`);
  return `[${negate ? '^' : ''}${extra}${pyTable(name).map(([a, b]) => (a === b ? escape(a) : `${escape(a)}-${escape(b)}`)).join('')}]`;
}

/**
 * Python's \s and str.isspace(): U+001C to U+001F and U+0085 are spaces,
 * U+FEFF isn't, unlike JavaScript's \s and trim(). Every one is in the BMP,
 * so the class works with or without the u flag.
 */
export const PY_SPACE = pyClass('space');
/** The same characters without the brackets, to put in a class of one's own. */
export const PY_SPACE_CHARS = PY_SPACE.slice(1, -1);
export const PY_NOT_SPACE = pyClass('space', '', true);
/** Python's \w in a str pattern, for a regular expression with the u flag. */
export const PY_WORD = pyClass('alnum', '_');
export const PY_NOT_WORD = pyClass('alnum', '_', true);
/** Python's \w, under the name the port used first. */
export const WORD_CHAR = PY_WORD;
/** Python's \d in a str pattern: a decimal digit of any script (u flag). */
export const PY_DIGIT = pyClass('decimal');

const cp = (ch: string) => ch.codePointAt(0) ?? 0;
export const pyIsSpace = (ch: string) => inTable('space', cp(ch));
export const pyIsAlnum = (ch: string) => inTable('alnum', cp(ch));
export const pyIsAlpha = (ch: string) => inTable('alpha', cp(ch));
export const pyIsPrintable = (ch: string) => inTable('printable', cp(ch));

// --- Python's \b and "no \w just before", without a lookbehind ---------------
//
// No pattern in these checks has a lookbehind: WebKit before Safari 16.4
// can't parse one, and the newest WebKit macOS 10.15 runs is Safari 15.6. A
// pattern compiled at the top of a module would stop the whole app loading
// there. What a lookbehind looked at, the character before a match, is
// looked at here in code.

/** Python's \w in a str pattern: str.isalnum(), or "_". */
export const pyIsWord = (ch: string) => ch === '_' || pyIsAlnum(ch);

/** The code point that ends at `index` (a UTF-16 index), or '' at the start. */
function codePointBefore(text: string, index: number): string {
  if (index <= 0) return '';
  const low = text.charCodeAt(index - 1);
  if (low >= 0xdc00 && low <= 0xdfff && index >= 2) {
    const high = text.charCodeAt(index - 2);
    if (high >= 0xd800 && high <= 0xdbff) return text.slice(index - 2, index);
  }
  return text[index - 1];
}

/** Whether the character just before `index` is one of Python's \w. False at the start. */
export function pyWordBefore(text: string, index: number): boolean {
  const ch = codePointBefore(text, index);
  return ch !== '' && pyIsWord(ch);
}

/** Whether the character at `index` is one of Python's \w. False at the end. */
export function pyWordAt(text: string, index: number): boolean {
  const point = text.codePointAt(index);
  return point !== undefined && pyIsWord(String.fromCodePoint(point));
}

/** Python's \b at `index`: one of its \w on one side and not on the other. */
export function pyBoundaryAt(text: string, index: number): boolean {
  return pyWordBefore(text, index) !== pyWordAt(text, index);
}

/**
 * Python's finditer for a pattern that begins with a lookbehind for no \w, or
 * with \b just before one of its \w: `pattern` is the rest of it (flags g and u), and a
 * match counts only where the character before it isn't one of Python's \w.
 * Whether that holds depends on where a match starts and nothing else, so a
 * start that fails it is skipped as a whole, as Python's search skips it.
 */
export function* pyMatchesAfterNonWord(pattern: RegExp, text: string): Generator<RegExpExecArray> {
  if (!pattern.global || !pattern.unicode) throw new Error('pyMatchesAfterNonWord needs the g and u flags');
  pattern.lastIndex = 0;
  for (;;) {
    const match = pattern.exec(text);
    if (!match) return;
    if (!match[0]) throw new Error('pyMatchesAfterNonWord: the pattern matched an empty string');
    if (pyWordBefore(text, match.index)) {
      pattern.lastIndex = match.index + ((text.codePointAt(match.index) ?? 0) > 0xffff ? 2 : 1);
      continue;
    }
    const end = pattern.lastIndex;
    yield match;
    pattern.lastIndex = end;
  }
}

/** Python's search for the same kind of pattern: the first of pyMatchesAfterNonWord's matches, or null. */
export function pySearchAfterNonWord(pattern: RegExp, text: string): RegExpExecArray | null {
  for (const match of pyMatchesAfterNonWord(pattern, text)) return match;
  return null;
}

const SPACE_RUN = new RegExp(`${PY_SPACE}+`);
const LEADING = new RegExp(`^${PY_SPACE}+`);
const TRAILING = new RegExp(`${PY_SPACE}+$`);

/** Python's str.strip(), or str.strip(chars) with the characters given. */
export function pyStrip(text: string, chars?: string): string {
  return pyRstrip(pyLstrip(text, chars), chars);
}

export function pyLstrip(text: string, chars?: string): string {
  if (chars === undefined) return text.replace(LEADING, '');
  const drop = new Set(Array.from(chars));
  const list = Array.from(text);
  let start = 0;
  while (start < list.length && drop.has(list[start])) start++;
  return list.slice(start).join('');
}

export function pyRstrip(text: string, chars?: string): string {
  if (chars === undefined) return text.replace(TRAILING, '');
  const drop = new Set(Array.from(chars));
  const list = Array.from(text);
  let end = list.length;
  while (end > 0 && drop.has(list[end - 1])) end--;
  return list.slice(0, end).join('');
}

/** Python's str.split() with no separator: the words between runs of Python's whitespace. */
export function pySplit(text: string): string[] {
  return text.split(SPACE_RUN).filter((part) => part !== '');
}

let lowerMap: Map<number, string> | null = null;

function lowerTable(): Map<number, string> {
  if (lowerMap) return lowerMap;
  const map = new Map<number, string>();
  for (const run of LOWER_RUNS.split(' ')) {
    const [start, count, step, shift] = run.split('.');
    const from = parseInt(start, 36);
    const delta = shift.startsWith('-') ? -parseInt(shift.slice(1), 36) : parseInt(shift, 36);
    for (let i = 0; i < parseInt(count, 36); i++) {
      const at = from + i * Number(step);
      map.set(at, String.fromCodePoint(at + delta));
    }
  }
  for (const entry of LOWER_SPECIALS.split(' ').filter(Boolean)) {
    const [from, to] = entry.split(':');
    map.set(parseInt(from, 36), String.fromCodePoint(...to.split('.').map((part) => parseInt(part, 36))));
  }
  lowerMap = map;
  return map;
}

const ASCII = /^[\x00-\x7f]*$/;

/**
 * Python's str.lower(): its own table, not the browser's, and its final
 * sigma rule (a cased letter before U+03A3, case-ignorable ones skipped, and
 * none after it, gives U+03C2).
 */
export function pyLower(text: string): string {
  if (ASCII.test(text)) return text.toLowerCase();
  const table = lowerTable();
  const points = Array.from(text, cp);
  let out = '';
  for (let i = 0; i < points.length; i++) {
    const point = points[i];
    if (point === 0x3a3) {
      out += String.fromCodePoint(finalSigma(points, i) ? 0x3c2 : 0x3c3);
      continue;
    }
    out += table.get(point) ?? String.fromCodePoint(point);
  }
  return out;
}

function finalSigma(points: number[], at: number): boolean {
  let j = at - 1;
  while (j >= 0 && inTable('ignorable', points[j])) j--;
  if (j < 0 || !inTable('cased', points[j])) return false;
  j = at + 1;
  while (j < points.length && inTable('ignorable', points[j])) j++;
  return j === points.length || !inTable('cased', points[j]);
}

/** Python's order for strings: by code point, where JavaScript's sort goes by UTF-16 unit. */
export function pyCompare(a: string, b: string): number {
  const x = Array.from(a);
  const y = Array.from(b);
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const d = cp(x[i]) - cp(y[i]);
    if (d) return d;
  }
  return x.length - y.length;
}

// --- Python's re.I, without JavaScript's i flag ------------------------------
//
// JavaScript's i flag widens every class by case as well: under it the class
// for Python's \w also takes U+0345 and four letters of Unicode 16, which
// Python's \w leaves out (re.I never changes \w, \s or \d). So no pattern
// here has the i flag; each ASCII letter is written out with what re.I lets
// it match, measured over every code point (tests/generated.test.ts).

const IGNORE_CASE_EXTRA: Record<string, string> = { i: '\\u0130\\u0131', k: '\\u212a', s: '\\u017f' };

/**
 * A pattern source made case-blind the way Python's re.I reads it, for a
 * pattern compiled without the i flag. Escapes, classes and group names stay
 * as they are, so a class in it must be one of this file's (\w, \s, \d),
 * which re.I leaves alone; an ASCII letter in a class, or a cased letter
 * past ASCII anywhere, is refused, as re.I would read those its own way.
 */
export function pyIgnoreCaseSource(source: string): string {
  let out = '';
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ch === '\\') {
      const next = source[i + 1] ?? '';
      let end = i + 2;
      if ((next === 'u' || next === 'p' || next === 'P') && source[i + 2] === '{') end = source.indexOf('}', i) + 1;
      else if (next === 'u') end = i + 6;
      else if (next === 'x') end = i + 4;
      else if (next === 'k' && source[i + 2] === '<') end = source.indexOf('>', i) + 1;
      else if (next === 'c') end = i + 3;
      out += source.slice(i, end);
      i = end - 1;
    } else if (ch === '[') {
      let end = i + 1;
      while (end < source.length && source[end] !== ']') end += source[end] === '\\' ? 2 : 1;
      const body = source.slice(i, end + 1);
      if (/[A-Za-z]/.test(body.replace(/\\(u\{[^}]*\}|u[0-9a-fA-F]{4}|x[0-9a-fA-F]{2}|.)/g, ''))) throw new Error(`pyIgnoreCaseSource: a class with a letter in it reads differently under re.I: ${body}`);
      out += body;
      i = end;
    } else if (ch === '(' && source[i + 1] === '?' && source[i + 2] === '<' && source[i + 3] !== '=' && source[i + 3] !== '!') {
      const end = source.indexOf('>', i) + 1;
      out += source.slice(i, end);
      i = end - 1;
    } else if (/[A-Za-z]/.test(ch)) {
      const lower = ch.toLowerCase();
      out += `[${lower}${lower.toUpperCase()}${IGNORE_CASE_EXTRA[lower] ?? ''}]`;
    } else {
      const point = source.codePointAt(i) ?? 0;
      if (point > 0x7f && inTable('cased', point)) throw new Error(`pyIgnoreCaseSource: ${String.fromCodePoint(point)} has a case of its own under re.I`);
      out += ch;
    }
  }
  return out;
}

/** A literal, escaped and made case-blind the way Python's re.I reads it (pyIgnoreCaseSource). */
export function pyIgnoreCase(literal: string): string {
  return pyIgnoreCaseSource(literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
}

/** Python's $ without MULTILINE: the end, or just before a newline that ends the text. */
export const PY_END = '(?=\\n?$)';

/** Python's len() of a string: code points, not UTF-16 units. */
export function pyLen(text: string): number {
  let count = 0;
  for (const _ of text) count++;
  return count;
}

/**
 * Python's ^ under re.M, for a test() that only asks whether there's a match:
 * the start, or just after "\n" (not after "\r" or U+2028 as JavaScript's m
 * flag has it). The "\n" is part of the match, so the match itself, where it
 * starts and what it holds, isn't Python's.
 */
export const PY_LINE_START_TEST = '(?:^|\\n)';
/** Python's . without re.S: any character but "\n" (JavaScript's also stops at "\r", U+2028 and U+2029). */
export const PY_DOT = '[^\\n]';
/** Python's [^\S\n]: whitespace that isn't "\n". */
export const PY_SPACE_NOT_NEWLINE = `(?:(?!\\n)${PY_SPACE})`;

/** Python's sorted() of strings. */
export function pySorted(list: Iterable<string>): string[] {
  return [...list].sort(pyCompare);
}

/** Python's repr() of a string, as an f-string's !r writes it. */
export function pyRepr(text: string): string {
  const quote = text.includes("'") && !text.includes('"') ? '"' : "'";
  let out = quote;
  for (const ch of text) {
    const code = cp(ch);
    if (ch === '\\') out += '\\\\';
    else if (ch === quote) out += `\\${quote}`;
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else if (!pyIsPrintable(ch) || code === 0x7f) {
      out += code < 0x100 ? `\\x${code.toString(16).padStart(2, '0')}` : code < 0x10000 ? `\\u${code.toString(16).padStart(4, '0')}` : `\\U${code.toString(16).padStart(8, '0')}`;
    } else out += ch;
  }
  return out + quote;
}
