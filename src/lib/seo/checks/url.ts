// Copied from github.com/dotnetdreamer/claude-seo osg/checks/url.ts at da732e65be7f.
// Change it there and run npm run sync:seo-checks. Edits here are lost on the next sync.

// URL helpers shared by the checks: the comparison form page_checks.py uses
// to decide that two addresses name the same page.

const TRACKING_KEYS = new Set(['fbclid', 'gclid', 'mc_cid', 'mc_eid', '_ga', 'ref']);
const UNRESERVED = /^[A-Za-z0-9\-._~]$/;

export interface SplitUrl {
  scheme: string;
  netloc: string;
  path: string;
  params: string;
  query: string;
  fragment: string;
}

const RELATIVE_SCHEMES = new Set(['', 'ftp', 'http', 'gopher', 'nntp', 'imap', 'wais', 'file', 'https', 'shttp', 'mms', 'prospero', 'rtsp', 'rtsps', 'rtspu', 'sftp', 'svn', 'svn+ssh', 'ws', 'wss']);
const NETLOC_SCHEMES = new Set(['', 'ftp', 'http', 'gopher', 'nntp', 'telnet', 'imap', 'wais', 'file', 'mms', 'https', 'shttp', 'snews', 'prospero', 'rtsp', 'rtsps', 'rtspu', 'rsync', 'svn', 'svn+ssh', 'sftp', 'nfs', 'git', 'git+ssh', 'ws', 'wss', 'itms-services']);
const PARAM_SCHEMES = new Set(['', 'ftp', 'hdl', 'prospero', 'http', 'imap', 'https', 'shttp', 'rtsp', 'rtsps', 'rtspu', 'sip', 'sips', 'mms', 'sftp', 'tel']);
const SCHEME_CHARS = /^[A-Za-z][A-Za-z0-9+\-.]*$/;

/**
 * Python's urllib.parse.urlparse: the parts as written, nothing normalised
 * except a lower case scheme. Browsers tidy an address (lower case host,
 * escapes), and the facts and evidence show addresses the way the page wrote
 * them, as the script does.
 */
export function splitUrl(raw: string, defaultScheme = ''): SplitUrl {
  let url = raw.replace(/^[\x00-\x20]+/, '').replace(/[\t\r\n]/g, '');
  let scheme = defaultScheme;
  const colon = url.indexOf(':');
  if (colon > 0 && SCHEME_CHARS.test(url.slice(0, colon))) {
    scheme = url.slice(0, colon).toLowerCase();
    url = url.slice(colon + 1);
  }
  let netloc = '';
  if (url.startsWith('//')) {
    let end = url.length;
    for (const stop of ['/', '?', '#']) {
      const at = url.indexOf(stop, 2);
      if (at >= 0) end = Math.min(end, at);
    }
    netloc = url.slice(2, end);
    url = url.slice(end);
  }
  let fragment = '';
  const hash = url.indexOf('#');
  if (hash >= 0) {
    fragment = url.slice(hash + 1);
    url = url.slice(0, hash);
  }
  let query = '';
  const question = url.indexOf('?');
  if (question >= 0) {
    query = url.slice(question + 1);
    url = url.slice(0, question);
  }
  let params = '';
  if (PARAM_SCHEMES.has(scheme) && url.includes(';')) {
    const at = url.includes('/') ? url.indexOf(';', url.lastIndexOf('/')) : url.indexOf(';');
    if (at >= 0) {
      params = url.slice(at + 1);
      url = url.slice(0, at);
    }
  }
  return { scheme, netloc, path: url, params, query, fragment };
}

/** Where Python's urlsplit raises ValueError. */
export class PyUrlError extends Error {}

/** ipaddress.IPv4Address's parse: four decimal octets, no leading zeros, each up to 255. */
function isIPv4(text: string): boolean {
  if (!text || text.includes('/')) return false;
  const octets = text.split('.');
  return octets.length === 4 && octets.every((octet) => /^[0-9]{1,3}$/.test(octet) && (octet === '0' || octet[0] !== '0') && Number(octet) <= 255);
}

/** ipaddress.IPv6Address's parse, a scope after "%" allowed. */
function isIPv6(text: string): boolean {
  if (text.includes('/')) return false;
  const percent = text.indexOf('%');
  let address = text;
  if (percent >= 0) {
    const scope = text.slice(percent + 1);
    if (!scope || scope.includes('%')) return false;
    address = text.slice(0, percent);
  }
  if (!address || address.length > 45) return false;
  const parts = address.split(':');
  if (parts.length < 3) return false;
  if (parts[parts.length - 1].includes('.')) {
    if (!isIPv4(parts.pop()!)) return false;
    parts.push('0', '0');
  }
  if (parts.length > 9) return false;
  let skip = -1;
  for (let i = 1; i < parts.length - 1; i++) {
    if (!parts[i]) {
      if (skip >= 0) return false;
      skip = i;
    }
  }
  let hi: number;
  let lo: number;
  if (skip >= 0) {
    hi = skip;
    lo = parts.length - skip - 1;
    if (!parts[0] && --hi) return false;
    if (!parts[parts.length - 1] && --lo) return false;
    if (8 - (hi + lo) < 1) return false;
  } else {
    if (parts.length !== 8 || !parts[0] || !parts[parts.length - 1]) return false;
    hi = parts.length;
    lo = 0;
  }
  const hextet = (part: string) => /^[0-9a-fA-F]{1,4}$/.test(part);
  for (let i = 0; i < hi; i++) if (!hextet(parts[i])) return false;
  for (let i = parts.length - lo; i < parts.length; i++) if (!hextet(parts[i])) return false;
  return true;
}

/**
 * Python's urlparse, raising where its urlsplit raises ValueError: a "[" or
 * "]" without the other, a bracketed host that isn't an IPv6 (or IPvFuture)
 * address, or a host that NFKC turns into one with "/", "?", "#", "@" or ":".
 */
export function pyUrlparse(raw: string, defaultScheme = ''): SplitUrl {
  const parts = splitUrl(raw, defaultScheme);
  const { netloc } = parts;
  const open = netloc.includes('[');
  const close = netloc.includes(']');
  if (open !== close) throw new PyUrlError('Invalid IPv6 URL');
  if (open && close) {
    const hostAndPort = netloc.slice(netloc.lastIndexOf('@') + 1);
    let host: string;
    const at = hostAndPort.indexOf('[');
    if (at >= 0) {
      if (at > 0) throw new PyUrlError('Invalid IPv6 URL');
      const bracketed = hostAndPort.slice(at + 1);
      const end = bracketed.indexOf(']');
      host = end >= 0 ? bracketed.slice(0, end) : bracketed;
      const port = end >= 0 ? bracketed.slice(end + 1) : '';
      if (port && !port.startsWith(':')) throw new PyUrlError('Invalid IPv6 URL');
    } else {
      const colon = hostAndPort.indexOf(':');
      host = colon >= 0 ? hostAndPort.slice(0, colon) : hostAndPort;
    }
    if (host.startsWith('v')) {
      if (!/^v[a-fA-F0-9]+\.[^\n]+$/.test(host)) throw new PyUrlError('IPvFuture address is invalid');
    } else if (isIPv4(host) || !isIPv6(host)) {
      throw new PyUrlError('Invalid IPv6 URL');
    }
  }
  // _checknetloc
  if (netloc && /[^\x00-\x7f]/.test(netloc)) {
    const bare = netloc.replace(/[@:#?]/g, '');
    const normal = bare.normalize('NFKC');
    if (normal !== bare && /[/?#@:]/.test(normal)) throw new PyUrlError('netloc contains invalid characters under NFKC normalization');
  }
  return parts;
}

/** urlparse(...).hostname, .port and whether there's a user part, as Python reads a netloc; .port raises as Python's does. */
export function netlocFacts(netloc: string): { hostname: string; port: number | null; hasUser: boolean } {
  const hostinfo = netloc.slice(netloc.lastIndexOf('@') + 1);
  let hostname: string;
  let port: string;
  const open = hostinfo.indexOf('[');
  if (open >= 0) {
    const bracketed = hostinfo.slice(open + 1);
    const end = bracketed.indexOf(']');
    hostname = end >= 0 ? bracketed.slice(0, end) : bracketed;
    const rest = end >= 0 ? bracketed.slice(end + 1) : '';
    port = rest.includes(':') ? rest.slice(rest.indexOf(':') + 1) : '';
  } else {
    const colon = hostinfo.indexOf(':');
    hostname = colon >= 0 ? hostinfo.slice(0, colon) : hostinfo;
    port = colon >= 0 ? hostinfo.slice(colon + 1) : '';
  }
  let number: number | null = null;
  if (port) {
    if (!/^[0-9]+$/.test(port)) throw new PyUrlError(`Port could not be cast to integer value as '${port}'`);
    number = Number(port);
    if (number > 65535) throw new PyUrlError('Port out of range 0-65535');
  }
  return { hostname, port: number, hasUser: netloc.includes('@') };
}

/** Python's urljoin, raising where it raises (pyUrlparse). */
export function pyUrljoin(base: string, href: string): string {
  if (!base) return href;
  if (!href) return base;
  const scheme = pyUrlparse(base).scheme;
  pyUrlparse(href, scheme);
  return joinUrl(base, href);
}

/** Python's urlunparse of urlparse's parts. */
export function unparseUrl(parts: SplitUrl): string {
  return unsplit(parts);
}

function unsplit({ scheme, netloc, path, params, query, fragment }: SplitUrl): string {
  let url = params ? `${path};${params}` : path;
  if (netloc) {
    if (url && !url.startsWith('/')) url = `/${url}`;
    url = `//${netloc}${url}`;
  } else if (url.startsWith('//')) {
    url = `//${url}`;
  } else if (scheme && NETLOC_SCHEMES.has(scheme) && (!url || url.startsWith('/'))) {
    url = `//${url}`;
  }
  if (scheme) url = `${scheme}:${url}`;
  if (query) url = `${url}?${query}`;
  if (fragment) url = `${url}#${fragment}`;
  return url;
}

/** `href` read against `base` the way Python's urljoin does it. */
export function joinUrl(base: string, href: string): string {
  if (!base) return href;
  if (!href) return base;
  const b = splitUrl(base);
  const u = splitUrl(href, b.scheme);
  if (u.scheme !== b.scheme || !RELATIVE_SCHEMES.has(u.scheme)) return href;
  let { netloc } = u;
  if (NETLOC_SCHEMES.has(u.scheme)) {
    if (netloc) return unsplit(u);
    netloc = b.netloc;
  }
  if (!u.path && !u.params) {
    return unsplit({ ...u, netloc, path: b.path, params: b.params, query: u.query || b.query });
  }
  const baseParts = b.path.split('/');
  if (baseParts[baseParts.length - 1] !== '') baseParts.pop();
  let segments: string[];
  if (u.path.startsWith('/')) {
    segments = u.path.split('/');
  } else {
    segments = [...baseParts, ...u.path.split('/')];
    if (segments.length > 2) segments = [segments[0], ...segments.slice(1, -1).filter(Boolean), segments[segments.length - 1]];
  }
  const resolved: string[] = [];
  for (const segment of segments) {
    if (segment === '..') resolved.pop();
    else if (segment !== '.') resolved.push(segment);
  }
  const last = segments[segments.length - 1];
  if (last === '.' || last === '..') resolved.push('');
  return unsplit({ ...u, netloc, path: resolved.join('/') || '/' });
}

/** The scheme and the host (lower case, no port) of an address, as Python's urlparse gives them. */
export function schemeAndHost(url: string): { scheme: string; host: string } {
  const { scheme, netloc } = splitUrl(url);
  const hostPort = netloc.includes('@') ? netloc.slice(netloc.lastIndexOf('@') + 1) : netloc;
  let host = hostPort;
  if (host.startsWith('[')) host = host.slice(1, host.indexOf(']') > 0 ? host.indexOf(']') : undefined);
  else if (host.includes(':')) host = host.slice(0, host.indexOf(':'));
  return { scheme, host: host.toLowerCase() };
}

function utf8Escapes(text: string): string {
  let out = '';
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (code < 0x80) {
      out += ch;
      continue;
    }
    for (const byte of new TextEncoder().encode(ch)) out += `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
  }
  return out;
}

/**
 * One spelling for the percent-encoding of a path or query (RFC 3986, 6.2.2):
 * "%c3%a9", "%C3%A9" and a literal "é" all become "%C3%A9", and the escape of
 * an unreserved character becomes the character. Escapes of reserved
 * characters keep their meaning.
 */
export function oneEscapeSpelling(part: string): string {
  const spelled = part.replace(/%([0-9A-Fa-f]{2})/g, (whole, hex: string) => {
    const ch = String.fromCharCode(parseInt(hex, 16));
    return UNRESERVED.test(ch) ? ch : whole.toUpperCase();
  });
  return /^[\x00-\x7f]*$/.test(spelled) ? spelled : utf8Escapes(spelled);
}

function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/**
 * The comparison form of an address: lower case host (browsers already give
 * Punycode), no fragment, no tracking parameters, one spelling for escapes.
 * Null for anything that is not an http or https address.
 */
export function canonicalizeUrl(url: string): string | null {
  if (!url || /\s/.test(url)) return null;
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  const scheme = parsed.protocol.replace(/:$/, '').toLowerCase();
  if ((scheme !== 'http' && scheme !== 'https') || !parsed.hostname) return null;
  const host = parsed.hostname.toLowerCase().replace(/\.$/, '');
  const netloc = parsed.port ? `${host}:${parsed.port}` : host;
  const path = oneEscapeSpelling((parsed.pathname || '/').replace(/\/{2,}/g, '/'));
  const kept: string[] = [];
  for (const pair of parsed.search.replace(/^\?/, '').split('&')) {
    if (!pair) continue;
    const key = safeDecode(pair.split('=', 1)[0]).toLowerCase();
    if (key.startsWith('utm_') || TRACKING_KEYS.has(key)) continue;
    kept.push(oneEscapeSpelling(pair));
  }
  return `${scheme}://${netloc}${path}${kept.length ? `?${kept.join('&')}` : ''}`;
}

/** The key for deciding two addresses name the same page: a trailing slash makes no difference. */
export function urlMatchKey(url: string): string {
  const canonical = canonicalizeUrl(url);
  if (canonical === null) return url;
  const parsed = new URL(canonical);
  let path = parsed.pathname;
  if (path !== '/' && path.endsWith('/')) path = path.replace(/\/+$/, '') || '/';
  return `${parsed.protocol}//${parsed.host}${path}${parsed.search}`;
}

/** The site's root ("https://example.com"), with no slash at the end. */
export function siteRoot(url: string): string {
  const parsed = new URL(url);
  return `${parsed.protocol}//${parsed.host}`;
}
