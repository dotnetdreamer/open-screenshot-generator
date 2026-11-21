// Copied from github.com/dotnetdreamer/claude-seo osg/checks/pyJson.ts at da732e65be7f.
// Change it there and run npm run sync:seo-checks. Edits here are lost on the next sync.

// Whether a JSON-LD block reads as Python's json.loads reads it, and when it
// doesn't, the words of Python's error, which page_checks.py puts in its
// evidence ("block 1: Expecting ',' delimiter: line 3 column 5 (char 41)").
//
// CPython reads JSON with its C scanner (Modules/_json.c), and this follows
// it step by step: the same grammar (NaN, Infinity and -Infinity read, which
// JSON.parse refuses), the same messages at the same places, positions
// counted in code points as Python counts a str, and the 4300-digit limit on
// whole numbers. How deep a block may nest is CPython 3.13's limit on macOS
// and Linux (Py_C_RECURSION_LIMIT, 10000): Python stops at 9998 nested arrays
// or objects, and a little sooner when it has an error to build down there.

/** What page_checks.py writes when json.loads runs out of recursion. */
export const NESTED_TOO_DEEPLY = 'nested too deeply to parse';

/** Arrays and objects open at once before Python gives up. */
const DEEPEST = 9998;
/** The deepest a JSONDecodeError can still be made: building one costs four more levels. */
const DEEPEST_ERROR = 9994;
/** The deepest a StopIteration ("Expecting value") or int()'s ValueError can still be made. */
const DEEPEST_STOP = 9997;
/** sys.get_int_max_str_digits() by default. */
const INT_MAX_DIGITS = 4300;

const QUOTE = 0x22;
const BACKSLASH = 0x5c;

class JsonError {
  readonly message: string;
  constructor(message: string) {
    this.message = message;
  }
}
/** Python's StopIteration(idx): "Expecting value" once it reaches the top. */
class Stop {
  readonly at: number;
  constructor(at: number) {
    this.at = at;
  }
}
const TOO_DEEP = Symbol('too deep');

const isSpace = (c: number | undefined) => c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d;
const isDigit = (c: number | undefined) => c !== undefined && c >= 0x30 && c <= 0x39;

function hexValue(c: number): number {
  if (c >= 0x30 && c <= 0x39) return c - 0x30;
  if (c >= 0x61 && c <= 0x66) return c - 0x61 + 10;
  if (c >= 0x41 && c <= 0x46) return c - 0x41 + 10;
  return -1;
}

/** null when `text` reads as JSON, otherwise what page_checks.py would write after "block N: ". */
export function pythonJsonError(text: string): string | null {
  const s = Array.from(text, (char) => char.codePointAt(0) as number);
  const length = s.length;
  const endIdx = length - 1;

  const where = (message: string, pos: number) => {
    let lineno = 1;
    let lastNewline = -1;
    for (let i = 0; i < pos; i++) {
      if (s[i] === 0x0a) {
        lineno++;
        lastNewline = i;
      }
    }
    return `${message}: line ${lineno} column ${pos - lastNewline} (char ${pos})`;
  };

  if (length && s[0] === 0xfeff) return where('Unexpected UTF-8 BOM (decode using utf-8-sig)', 0);

  let depth = 0;
  const raise = (message: string, pos: number): never => {
    if (depth > DEEPEST_ERROR) throw TOO_DEEP;
    throw new JsonError(where(message, pos));
  };
  const stop = (pos: number): never => {
    if (depth > DEEPEST_STOP) throw TOO_DEEP;
    throw new Stop(pos);
  };
  const skipSpace = (idx: number) => {
    while (idx <= endIdx && isSpace(s[idx])) idx++;
    return idx;
  };
  const matches = (idx: number, word: string) => {
    for (let i = 0; i < word.length; i++) if (s[idx + i] !== word.charCodeAt(i)) return false;
    return true;
  };

  // scanstring_unicode: `end` is just past the opening quote; returns just past the closing one.
  const scanString = (end: number): number => {
    const begin = end - 1;
    for (;;) {
      let next = end;
      let c = 0;
      for (; next < length; next++) {
        c = s[next];
        if (c === QUOTE || c === BACKSLASH) break;
        if (c <= 0x1f) raise('Invalid control character at', next);
      }
      if (next >= length || (c !== QUOTE && c !== BACKSLASH)) raise('Unterminated string starting at', begin);
      next++;
      if (c === QUOTE) return next;
      if (next === length) raise('Unterminated string starting at', begin);
      c = s[next];
      if (c !== 0x75 /* u */) {
        end = next + 1;
        // " \ / b f n r t
        if (![0x22, 0x5c, 0x2f, 0x62, 0x66, 0x6e, 0x72, 0x74].includes(c)) raise('Invalid \\escape', end - 2);
        continue;
      }
      next++;
      end = next + 4;
      if (end >= length) raise('Invalid \\uXXXX escape', next - 1);
      let unit = 0;
      for (; next < end; next++) {
        const digit = hexValue(s[next]);
        if (digit < 0) raise('Invalid \\uXXXX escape', end - 5);
        unit = (unit << 4) | digit;
      }
      // A high surrogate followed by \u and a low one is one character.
      if (unit >= 0xd800 && unit <= 0xdbff && end + 6 < length && s[next] === BACKSLASH && s[next + 1] === 0x75) {
        next += 2;
        end += 6;
        let low = 0;
        for (; next < end; next++) {
          const digit = hexValue(s[next]);
          if (digit < 0) raise('Invalid \\uXXXX escape', end - 5);
          low = (low << 4) | digit;
        }
        if (low < 0xdc00 || low > 0xdfff) end -= 6;
      }
    }
  };

  // _match_number_unicode
  const scanNumber = (start: number): number => {
    let idx = start;
    if (s[idx] === 0x2d /* - */) {
      idx++;
      if (idx > endIdx) stop(start);
    }
    const digitsFrom = idx;
    if (s[idx] >= 0x31 && s[idx] <= 0x39) {
      idx++;
      while (idx <= endIdx && isDigit(s[idx])) idx++;
    } else if (s[idx] === 0x30) {
      idx++;
    } else {
      stop(start);
    }
    const intDigits = idx - digitsFrom;
    let isFloat = false;
    if (idx < endIdx && s[idx] === 0x2e /* . */ && isDigit(s[idx + 1])) {
      isFloat = true;
      idx += 2;
      while (idx <= endIdx && isDigit(s[idx])) idx++;
    }
    if (idx < endIdx && (s[idx] === 0x65 || s[idx] === 0x45) /* e E */) {
      const eStart = idx;
      idx++;
      if (idx < endIdx && (s[idx] === 0x2d || s[idx] === 0x2b)) idx++;
      while (idx <= endIdx && isDigit(s[idx])) idx++;
      if (isDigit(s[idx - 1])) isFloat = true;
      else idx = eStart;
    }
    if (!isFloat && intDigits > INT_MAX_DIGITS) {
      if (depth > DEEPEST_STOP) throw TOO_DEEP;
      throw new JsonError(
        `Exceeds the limit (${INT_MAX_DIGITS} digits) for integer string conversion: value has ${intDigits} digits; use sys.set_int_max_str_digits() to increase the limit`
      );
    }
    return idx;
  };

  // scan_once_unicode, _parse_object_unicode and _parse_array_unicode, with
  // the open arrays and objects on a list rather than the call stack, so a
  // block nested as deep as Python allows doesn't run JavaScript out of stack.
  // Returns where the value at `start` ends.
  // NaN and the infinities go through json's parse_constant, a call that costs one more level.
  const constant = (end: number): number => {
    if (depth > DEEPEST_STOP) throw TOO_DEEP;
    return end;
  };

  const scanValue = (start: number): number => {
    const open: Array<'object' | 'array'> = [];
    let idx = start;
    // The key of an object, its ":" and the space after it; `idx` is where the key should start.
    const objectKey = () => {
      if (idx > endIdx || s[idx] !== QUOTE) raise('Expecting property name enclosed in double quotes', idx);
      idx = skipSpace(scanString(idx + 1));
      if (idx > endIdx || s[idx] !== 0x3a /* : */) raise("Expecting ':' delimiter", idx);
      idx = skipSpace(idx + 1);
    };
    for (;;) {
      // A value starts at idx.
      if (idx >= length) stop(idx);
      const c = s[idx];
      let end = -1;
      if (c === QUOTE) end = scanString(idx + 1);
      else if (c === 0x7b /* { */ || c === 0x5b /* [ */) {
        if (depth >= DEEPEST) throw TOO_DEEP;
        depth++;
        const object = c === 0x7b;
        open.push(object ? 'object' : 'array');
        idx = skipSpace(idx + 1);
        if (idx <= endIdx && s[idx] === (object ? 0x7d : 0x5d)) {
          open.pop();
          depth--;
          end = idx + 1;
        } else {
          if (object) objectKey();
          continue;
        }
      } else if (c === 0x6e && idx + 3 < length && matches(idx, 'null')) end = idx + 4;
      else if (c === 0x74 && idx + 3 < length && matches(idx, 'true')) end = idx + 4;
      else if (c === 0x66 && idx + 4 < length && matches(idx, 'false')) end = idx + 5;
      else if (c === 0x4e && idx + 2 < length && matches(idx, 'NaN')) end = constant(idx + 3);
      else if (c === 0x49 && idx + 7 < length && matches(idx, 'Infinity')) end = constant(idx + 8);
      else if (c === 0x2d && idx + 8 < length && matches(idx, '-Infinity')) end = constant(idx + 9);
      else end = scanNumber(idx);

      // A value ended at `end`: close what it closes, then find the next one.
      idx = end;
      for (;;) {
        const container = open[open.length - 1];
        if (!container) return idx;
        const close = container === 'object' ? 0x7d : 0x5d;
        idx = skipSpace(idx);
        if (idx <= endIdx && s[idx] === close) {
          open.pop();
          depth--;
          idx += 1;
          continue;
        }
        if (idx > endIdx || s[idx] !== 0x2c /* , */) raise("Expecting ',' delimiter", idx);
        const comma = idx;
        idx = skipSpace(idx + 1);
        if (idx <= endIdx && s[idx] === close) {
          raise(container === 'object' ? 'Illegal trailing comma before end of object' : 'Illegal trailing comma before end of array', comma);
        }
        if (container === 'object') objectKey();
        break;
      }
    }
  };

  try {
    let end: number;
    try {
      end = scanValue(skipSpace(0));
    } catch (error) {
      if (error instanceof Stop) return where('Expecting value', error.at);
      throw error;
    }
    end = skipSpace(end);
    return end === length ? null : where('Extra data', end);
  } catch (error) {
    if (error === TOO_DEEP) return NESTED_TOO_DEEPLY;
    if (error instanceof JsonError) return error.message;
    throw error;
  }
}
