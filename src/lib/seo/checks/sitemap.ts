// Copied from github.com/dotnetdreamer/claude-seo osg/checks/sitemap.ts at da732e65be7f.
// Change it there and run npm run sync:seo-checks. Edits here are lost on the next sync.

// What a sitemap answer is, the way claude-seo reads it
// (scripts/sitemap_discovery.py, _read_body, _classify and _xml_entries):
// a gzip file inflated first, then XML (an index, a sitemap, an RSS or Atom
// feed) read strictly by lxml, or a text sitemap of one address a line, or
// nothing claude-seo accepts, with its reason in its own words.
//
// Two things here don't follow claude-seo all the way, and both say so
// instead of guessing (`unread`): an XML encoding libxml2 hands to iconv
// (anything but UTF-8, ISO-8859-1 and US-ASCII; the sitemap protocol asks
// for UTF-8), and an Atom link under an xml:base, which libxml2's own URI
// code resolves.

import { decodeAs } from './decode';
import { GzipError, GzipTooLarge, gunzip } from './gzip';
import { pyIsSpace, pyLower, pySplitLines, pyStrip } from './py';
import { PyUrlError, netlocFacts, pyUrljoin, pyUrlparse, unparseUrl } from './url';
import { XmlUnsupported, parseXml, type XmlElement, type XmlNode } from './xml';

/** MAX_SITEMAP_BYTES: the protocol's 50 MiB, after inflating. */
export const MAX_SITEMAP_BYTES = 50 * 1024 * 1024;
const MAX_SITEMAP_URLS = 50000;
const TOO_LARGE = 'Sitemap exceeds the 50 MiB uncompressed protocol limit';
const XML_BASE = '{http://www.w3.org/XML/1998/namespace}base';
const ENTRY_TAG: Record<string, string> = { urlset: 'url', sitemapindex: 'sitemap', rss: 'item', feed: 'entry' };

export type SitemapKind = 'urlset' | 'sitemapindex' | 'rss' | 'feed' | 'text';

export interface SitemapEntry {
  /** The page or sitemap address, null where an entry names none. */
  loc: string | null;
  lastmod: string | null;
  /** An Atom link under an xml:base, which this port doesn't resolve: its address isn't known here. */
  unresolved?: true;
}

export interface SitemapBody {
  /** What claude-seo takes the answer for, or null when it takes it for nothing. */
  kind: SitemapKind | null;
  /** claude-seo's reason, when kind is null ("invalid XML", "empty response", ...). */
  error: string | null;
  gzip: boolean;
  /** The entries of an XML sitemap, index or feed, in order. */
  entries: SitemapEntry[];
  /** A text sitemap's lines (also for one refused for being too long). */
  lines: string[] | null;
  /** Set when this port can't say what claude-seo would: see the top of this file. */
  unread?: string;
}

/** bytes.strip(): Python's ASCII whitespace, space, \t, \n, \r, \v and \f. */
const isAsciiSpace = (byte: number) => byte === 0x20 || (byte >= 0x09 && byte <= 0x0d);

/** Whether `content` holds "<!DOCTYPE", any case (content.upper(), ASCII only). */
function hasDoctype(content: Uint8Array): boolean {
  const word = [0x3c, 0x21, 0x44, 0x4f, 0x43, 0x54, 0x59, 0x50, 0x45];
  outer: for (let i = 0; i + word.length <= content.length; i++) {
    if (content[i] !== 0x3c) continue;
    for (let j = 1; j < word.length; j++) {
      let byte = content[i + j];
      if (byte >= 0x61 && byte <= 0x7a) byte -= 0x20;
      if (byte !== word[j]) continue outer;
    }
    return true;
  }
  return false;
}

/** urlparse(url).path, or "" where urlparse raises. */
function urlPath(url: string): string {
  try {
    return pyUrlparse(url).path;
  } catch (error) {
    if (error instanceof PyUrlError) return '';
    throw error;
  }
}

/** _valid_sitemap_url_syntax: one line of a text sitemap, without resolving or fetching it. */
export function validSitemapUrlSyntax(value: string): boolean {
  if (!value || Array.from(value).some(pyIsSpace) || value.includes('\\')) return false;
  try {
    const parts = pyUrlparse(value);
    const facts = netlocFacts(parts.netloc);
    return (parts.scheme === 'http' || parts.scheme === 'https') && facts.hostname !== '' && !facts.hasUser;
  } catch (error) {
    if (error instanceof PyUrlError) return false;
    throw error;
  }
}

/** lxml's tag without its namespace, lower case; "" for a comment or a processing instruction. */
function local(node: XmlNode): string {
  if (node.type !== 'element') return '';
  const brace = node.tag.lastIndexOf('}');
  return pyLower(brace >= 0 ? node.tag.slice(brace + 1) : node.tag);
}

/** root.iter(): the element and everything in it, in document order. */
function* iterate(node: XmlNode): Generator<XmlNode> {
  yield node;
  if (node.type === 'element') for (const child of node.children) yield* iterate(child);
}

/** Whether an element or one around it has an xml:base, so libxml2 would read its base from there. */
function underXmlBase(element: XmlElement): boolean {
  for (let at: XmlElement | null = element; at; at = at.parent) if (at.attributes.has(XML_BASE)) return true;
  return false;
}

/** _xml_entries: (loc, lastmod) for each entry of a sitemap, an index or a feed. */
function xmlEntries(kind: string, root: XmlElement, documentUrl: string): SitemapEntry[] {
  const feed = kind === 'rss' || kind === 'feed';
  const entries: SitemapEntry[] = [];
  const nodes = feed ? iterate(root) : root.children;
  for (const node of nodes) {
    if (local(node) !== ENTRY_TAG[kind] || node.type !== 'element') continue;
    let loc: string | null = null;
    let lastmod: string | null = null;
    let unresolved = false;
    for (const child of node.children) {
      const tag = local(child);
      if (child.type !== 'element') continue;
      const text = pyStrip(child.text ?? '');
      if (kind === 'feed') {
        if (tag === 'link' && loc === null && (child.attributes.get('rel') ?? 'alternate') === 'alternate') {
          loc = pyStrip(child.attributes.get('href') ?? '');
          if (loc) {
            if (underXmlBase(child)) {
              unresolved = true;
            } else {
              try {
                // No xml:base: libxml2's base is the document's address.
                loc = pyUrljoin(documentUrl, loc);
              } catch (error) {
                if (!(error instanceof PyUrlError)) throw error;
              }
            }
          }
        } else if (tag === 'updated' && lastmod === null) {
          lastmod = text;
        }
      } else if (kind === 'rss') {
        if (tag === 'link' && loc === null) loc = text;
      } else if (tag === 'loc' && loc === null) {
        loc = text;
      } else if (tag === 'lastmod' && lastmod === null) {
        lastmod = text;
      }
    }
    entries.push({ loc: unresolved ? null : loc || null, lastmod: lastmod || null, ...(unresolved ? { unresolved: true as const } : {}) });
  }
  return entries;
}

/** _classify: what a sitemap body is, after any inflating. */
function classify(content: Uint8Array, contentType: string, url: string): Omit<SitemapBody, 'gzip'> {
  const none = { entries: [] as SitemapEntry[], lines: null };
  if (content.every(isAsciiSpace)) return { kind: null, error: 'empty response', ...none };
  if (hasDoctype(content)) return { kind: null, error: 'DOCTYPE is not allowed in sitemap XML', ...none };
  let start = content[0] === 0xef && content[1] === 0xbb && content[2] === 0xbf ? 3 : 0;
  while (start < content.length && isAsciiSpace(content[start])) start++;
  const stripped = content.subarray(start);
  if (stripped[0] === 0x3c) {
    let root: XmlElement | null;
    try {
      root = parseXml(content);
    } catch (error) {
      if (error instanceof XmlUnsupported) return { kind: null, error: null, ...none, unread: error.message };
      throw error;
    }
    if (!root) return { kind: null, error: 'invalid XML', ...none };
    const name = local(root);
    if (name === 'urlset' || name === 'sitemapindex' || name === 'rss' || name === 'feed') {
      const entries = xmlEntries(name, root, url);
      return { kind: name, error: null, entries, lines: null, ...(entries.some((entry) => entry.unresolved) ? { unread: 'Atom links under an xml:base' } : {}) };
    }
    return { kind: null, error: 'unsupported XML root', ...none };
  }
  if (pyLower(contentType).includes('text/plain') || pyLower(urlPath(url)).endsWith('.txt')) {
    // The BOM-free bytes, so a leading BOM isn't part of the first address.
    const lines = pySplitLines(decodeAs(stripped, 'utf-8')).map((line) => pyStrip(line)).filter((line) => line !== '');
    if (lines.length > MAX_SITEMAP_URLS) return { kind: null, error: 'text sitemap exceeds the 50,000 URL protocol limit', entries: [], lines };
    if (lines.length && lines.every(validSitemapUrlSyntax)) return { kind: 'text', error: null, entries: [], lines };
    return { kind: null, error: 'invalid text sitemap', ...none };
  }
  return { kind: null, error: 'response is not a supported sitemap format', ...none };
}

/**
 * _read_body: a sitemap answer's body as claude-seo classifies it. A gzip
 * file (by its first two bytes) is inflated, up to 50 MiB, and read by the
 * name inside it (sitemap.txt.gz is a text sitemap).
 */
export function readSitemapBody(content: Uint8Array, contentType: string, url: string): SitemapBody {
  if (content[0] === 0x1f && content[1] === 0x8b) {
    let inflated: Uint8Array;
    try {
      inflated = gunzip(content, MAX_SITEMAP_BYTES);
    } catch (error) {
      if (error instanceof GzipError) return { kind: null, error: 'invalid gzip data', gzip: true, entries: [], lines: null };
      if (error instanceof GzipTooLarge) return { kind: null, error: TOO_LARGE, gzip: true, entries: [], lines: null };
      throw error;
    }
    let inner = url;
    try {
      const parts = pyUrlparse(url);
      if (pyLower(parts.path).endsWith('.gz')) inner = unparseUrl({ ...parts, path: parts.path.slice(0, -3) });
    } catch (error) {
      if (!(error instanceof PyUrlError)) throw error;
    }
    return { ...classify(inflated, contentType, inner), gzip: true };
  }
  return { ...classify(content, contentType, url), gzip: false };
}
