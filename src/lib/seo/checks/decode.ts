// Copied from github.com/dotnetdreamer/claude-seo osg/checks/decode.ts at da732e65be7f.
// Change it there and run npm run sync:seo-checks. Edits here are lost on the next sync.

// A page's bytes made text the way claude-seo does it (scripts/url_safety.py,
// decode_body): a byte order mark, else the charset of the Content-Type
// header, else a <meta> charset in the first 4096 bytes, else UTF-8. Each is
// decoded with Python's codec of that name, errors="replace", and with UTF-8
// when Python has no text codec by that name. A browser's TextDecoder knows
// other names and other tables ("iso-8859-1" is windows-1252 there, and
// windows-1252 has no undefined bytes), so this follows Python's lookup and
// its one-byte tables (codecs.ts). The Chinese, Japanese and Korean codecs
// are the exception: TextDecoder reads them, as a browser does, which differs
// from Python on bytes their tables don't share (see osg/README.md).

import { CODEC_ALIASES, CODEC_MODULES, CODEC_TABLES } from './codecs';
import { PY_SPACE, PY_SPACE_CHARS, pyIgnoreCase, pyRstrip, pyStrip } from './py';

const has = (record: object, key: string) => Object.prototype.hasOwnProperty.call(record, key);

/**
 * Python's codec for `label`, or null when bytes.decode has none (a
 * LookupError, or a codec that isn't a text encoding). codecs.lookup
 * normalises the name first (_Py_normalize_encoding): ASCII letters, digits
 * and "." stay, in lower case, and every other run becomes one "_", never
 * at the start. encodings.search_function then tries the alias, then the name.
 */
export function pythonCodec(label: string): string | null {
  let name = '';
  let punct = false;
  for (const byte of new TextEncoder().encode(label)) {
    const ch = String.fromCharCode(byte);
    if (/[A-Za-z0-9.]/.test(ch)) {
      if (punct && name) name += '_';
      punct = false;
      name += ch.toLowerCase();
    } else {
      punct = true;
    }
  }
  const alias = has(CODEC_ALIASES, name) ? CODEC_ALIASES[name] : has(CODEC_ALIASES, name.replace(/\./g, '_')) ? CODEC_ALIASES[name.replace(/\./g, '_')] : null;
  for (const module of alias ? [alias, name] : [name]) {
    if (!module || module.includes('.') || !has(CODEC_MODULES, module)) continue;
    return CODEC_MODULES[module] === 'bytes' ? null : module;
  }
  return null;
}

/** TextDecoder for the codecs this file has no table for: what a browser reads them as. */
const WEB_DECODERS: Readonly<Record<string, string>> = {
  shift_jis: 'shift_jis', cp932: 'shift_jis', shift_jis_2004: 'shift_jis', shift_jisx0213: 'shift_jis',
  euc_jp: 'euc-jp', euc_jis_2004: 'euc-jp', euc_jisx0213: 'euc-jp',
  iso2022_jp: 'iso-2022-jp', iso2022_jp_1: 'iso-2022-jp', iso2022_jp_2: 'iso-2022-jp', iso2022_jp_2004: 'iso-2022-jp', iso2022_jp_3: 'iso-2022-jp', iso2022_jp_ext: 'iso-2022-jp',
  gb2312: 'gbk', gbk: 'gbk', gb18030: 'gb18030', big5: 'big5', big5hkscs: 'big5', cp950: 'big5', euc_kr: 'euc-kr', cp949: 'euc-kr',
};

function web(raw: Uint8Array, label: string): string {
  return new TextDecoder(label, { ignoreBOM: true }).decode(raw);
}

/** UTF-8 with errors="replace": a U+FFFD for each broken sequence, as TextDecoder writes them. A BOM stays a character. */
const utf8 = (raw: Uint8Array) => web(raw, 'utf-8');

function utf32(raw: Uint8Array, little: boolean): string {
  let out = '';
  let i = 0;
  for (; i + 4 <= raw.length; i += 4) {
    const value = little ? (raw[i] | (raw[i + 1] << 8) | (raw[i + 2] << 16) | (raw[i + 3] << 24)) >>> 0 : ((raw[i] << 24) | (raw[i + 1] << 16) | (raw[i + 2] << 8) | raw[i + 3]) >>> 0;
    out += value > 0x10ffff || (value >= 0xd800 && value <= 0xdfff) ? '\u{FFFD}' : String.fromCodePoint(value);
  }
  return i < raw.length ? `${out}\u{FFFD}` : out;
}

const startsWith = (raw: Uint8Array, bytes: readonly number[]) => bytes.every((byte, index) => raw[index] === byte);

/** bytes.decode(codec, errors="replace"). */
function decodeWith(raw: Uint8Array, codec: string): string {
  switch (codec) {
    case 'utf_8':
      return utf8(raw);
    case 'utf_8_sig':
      return utf8(startsWith(raw, [0xef, 0xbb, 0xbf]) ? raw.subarray(3) : raw);
    case 'utf_16':
      if (startsWith(raw, [0xff, 0xfe])) return web(raw.subarray(2), 'utf-16le');
      if (startsWith(raw, [0xfe, 0xff])) return web(raw.subarray(2), 'utf-16be');
      // No BOM: the machine's own order, little-endian on the Macs and PCs Python runs on.
      return web(raw, 'utf-16le');
    case 'utf_16_le':
      return web(raw, 'utf-16le');
    case 'utf_16_be':
      return web(raw, 'utf-16be');
    case 'utf_32':
      if (startsWith(raw, [0xff, 0xfe, 0, 0])) return utf32(raw.subarray(4), true);
      if (startsWith(raw, [0, 0, 0xfe, 0xff])) return utf32(raw.subarray(4), false);
      return utf32(raw, true);
    case 'utf_32_le':
      return utf32(raw, true);
    case 'utf_32_be':
      return utf32(raw, false);
    case 'latin_1':
    case 'charmap':
      return Array.from(raw, (byte) => String.fromCharCode(byte)).join('');
    case 'ascii':
      return Array.from(raw, (byte) => (byte < 0x80 ? String.fromCharCode(byte) : '\u{FFFD}')).join('');
  }
  if (has(CODEC_TABLES, codec)) {
    const table = Array.from(CODEC_TABLES[codec]);
    const offset = 256 - table.length;
    let out = '';
    for (const byte of raw) {
      const ch = byte < offset ? String.fromCharCode(byte) : table[byte - offset];
      out += ch === '\u{FFFE}' ? '\u{FFFD}' : ch;
    }
    return out;
  }
  if (has(WEB_DECODERS, codec)) return web(raw, WEB_DECODERS[codec]);
  // utf_7, unicode_escape, raw_unicode_escape, punycode, idna, hz, johab,
  // iso2022_kr and undefined are left to UTF-8 here (osg/README.md).
  return utf8(raw);
}

/** _decode_bytes: Python's codec by that name, or UTF-8 when there is none. */
export function decodeAs(raw: Uint8Array, label: string): string {
  const codec = pythonCodec(label);
  return codec ? decodeWith(raw, codec) : utf8(raw);
}

const CONTENT_TYPE_CHARSET = new RegExp(`${pyIgnoreCase('charset')}${PY_SPACE}*=${PY_SPACE}*['"]?([^;,'"${PY_SPACE_CHARS}>]+)`, 'u');

/** _extract_charset_from_content_type: the charset a Content-Type value names, or null. */
export function charsetFromContentType(contentType: string): string | null {
  const match = CONTENT_TYPE_CHARSET.exec(contentType || '');
  return match ? pyStrip(match[1]) : null;
}

// The prescan runs on the first 4096 bytes read as ASCII (other bytes dropped),
// so its patterns only ever see ASCII, and Python's \s there includes U+001C to U+001F.
// On ASCII, re.I is each letter and its other case, written out (no i flag, py.ts).
const META_TAG = /<[mM][eE][tT][aA]\b([^>]*)>/g;
const META_ATTRIBUTE = new RegExp(`([^${PY_SPACE_CHARS}=/>]+)(?:${PY_SPACE}*=${PY_SPACE}*(?:"([^"]*)"|'([^']*)'|([^${PY_SPACE_CHARS}>]+)))?`, 'g');

/**
 * _extract_meta_charset: the encoding a <meta> in the first 4096 bytes
 * declares. A charset attribute wins; a content attribute counts only in a
 * tag whose http-equiv is content-type.
 */
export function metaCharset(raw: Uint8Array): string | null {
  let head = '';
  for (const byte of raw.subarray(0, 4096)) if (byte < 0x80) head += String.fromCharCode(byte);
  for (const tag of head.matchAll(META_TAG)) {
    let charset: string | null = null;
    let gotPragma = false;
    let needPragma: boolean | null = null;
    const seen = new Set<string>();
    for (const attribute of tag[1].matchAll(META_ATTRIBUTE)) {
      const name = attribute[1].toLowerCase();
      if (seen.has(name)) continue;
      seen.add(name);
      const value = attribute[2] ?? attribute[3] ?? attribute[4] ?? '';
      if (name === 'http-equiv' && value.toLowerCase() === 'content-type') {
        gotPragma = true;
      } else if (name === 'content') {
        const extracted = charsetFromContentType(value);
        if (extracted && charset === null) {
          charset = extracted;
          needPragma = true;
        }
      } else if (name === 'charset') {
        charset = pyStrip(value);
        needPragma = false;
      }
    }
    // An unquoted value keeps the "/" of a self-closing tag, which no label ends in.
    charset = pyRstrip(pyStrip(charset ?? ''), '/');
    if (!charset || needPragma === null) continue;
    if (needPragma && !gotPragma) continue;
    return charset;
  }
  return null;
}

/** decode_body: the page's text from its bytes and its Content-Type header. */
export function decodeBody(raw: Uint8Array, contentType = ''): string {
  if (startsWith(raw, [0xef, 0xbb, 0xbf])) return decodeAs(raw.subarray(3), 'utf-8');
  if (startsWith(raw, [0xff, 0xfe])) return decodeAs(raw.subarray(2), 'utf-16-le');
  if (startsWith(raw, [0xfe, 0xff])) return decodeAs(raw.subarray(2), 'utf-16-be');
  const header = charsetFromContentType(contentType);
  if (header) return decodeAs(raw, header);
  const meta = metaCharset(raw);
  if (meta) return decodeAs(raw, meta);
  return utf8(raw);
}
