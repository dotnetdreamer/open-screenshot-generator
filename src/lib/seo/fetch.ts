// Fetching the pages of a site to check.
//
// The desktop app reads any https:// site through the Tauri HTTP plugin,
// which skips the browser's same-origin rule. The plugin would follow a
// redirect to any host it is told to, and only its first address is checked
// against the app's scope, so redirects are followed here, one hop at a time,
// and every hop has to be a public address: a page cannot send the check to
// the user's router or to this computer. In a browser, a site can only be
// read when it allows other sites to read it (GitHub Pages does).

import { isTauri } from '@/lib/desktop';
import { decodeBody } from './checks';

export const MAX_REDIRECTS = 5;
const TIMEOUT_MS = 20_000;
/** Bigger answers are not read: Google stops at 2 MB of HTML anyway. */
export const MAX_BYTES = 8 * 1024 * 1024;
// A browser's agent string, so a site's bot shield answers the way it does
// for people, with the check named at the end.
const AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15 OpenScreenshotGenerator-SiteCheck/1.0';

export interface Fetched {
  /** The address asked for. */
  url: string;
  /** The address the answer came from, after redirects. */
  finalUrl: string;
  /** Every address on the way, the first included, when there were redirects. */
  redirects: string[];
  status: number | null;
  headers: Record<string, string>;
  text: string | null;
  bytes: number;
  /** The answer's bytes as they came, when asked for (keepBody): a sitemap is read from them, gzip and all. */
  body?: Uint8Array;
  /** Why nothing could be read. */
  problem?: FetchProblem;
}

export type FetchProblem = 'private' | 'insecure' | 'blocked' | 'offline' | 'timeout' | 'too-big' | 'too-many-redirects' | 'stopped';

export const FETCH_PROBLEM_WORDS: Record<FetchProblem, string> = {
  private: 'The address is on this computer or a private network, so the check leaves it alone',
  insecure: 'The desktop app reads https:// sites only',
  blocked: "This browser can't read other sites. Check it in the desktop app, or check your Website view's pages before you publish",
  offline: "The site didn't answer. Check the address and your internet connection",
  timeout: 'The site took longer than 20 seconds to answer',
  'too-big': 'The page is larger than 8 MB, so the check left it out',
  'too-many-redirects': 'The page redirects more than five times',
  stopped: 'Stopped',
};

/** Hosts a public site never has: this computer, private networks, link-local and made-up names. */
export function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!host) return true;
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') || host.endsWith('.lan') || host.endsWith('.home.arpa')) return true;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return a === 0 || a === 10 || a === 127 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224;
  }
  if (host.includes(':')) {
    if (host === '::' || host === '::1') return true;
    const first = host.split(':')[0];
    if (/^f[cd]/.test(first) || /^fe[89ab]/.test(first)) return true;
    const mapped = /::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(host);
    return mapped ? isPrivateHost(mapped[1]) : false;
  }
  // A name with no dot is a local one ("router", "nas").
  return !host.includes('.');
}

/** Whether the check may ask for this address at all. */
export function mayFetch(url: string, httpsOnly = isTauri()): FetchProblem | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 'offline';
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return 'blocked';
  if (isPrivateHost(parsed.hostname)) return 'private';
  if (httpsOnly && parsed.protocol === 'http:') return 'insecure';
  return null;
}

function headerMap(headers: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((value, key) => {
    const name = key.toLowerCase();
    out[name] = out[name] ? `${out[name]}, ${value}` : value;
  });
  return out;
}

type TauriFetch = (input: string, init?: RequestInit & { maxRedirections?: number; connectTimeout?: number }) => Promise<Response>;
let tauriFetch: TauriFetch | null = null;

/**
 * How a request goes out. The desktop app's follows no redirect by itself
 * (`manualRedirects`), so every hop is checked here; a browser's follows them
 * and says only where it ended. The unit tests hand in one of their own.
 */
export interface Transport {
  send(url: string, accept: string, signal: AbortSignal): Promise<Response>;
  manualRedirects: boolean;
}

const desktopTransport: Transport = {
  manualRedirects: true,
  async send(url, accept, signal) {
    if (!tauriFetch) tauriFetch = (await import('@tauri-apps/plugin-http')).fetch as unknown as TauriFetch;
    return tauriFetch(url, {
      method: 'GET',
      headers: { Accept: accept, 'User-Agent': AGENT },
      maxRedirections: 0,
      connectTimeout: 10_000,
      signal,
      cache: 'no-store',
    });
  },
};

const browserTransport: Transport = {
  manualRedirects: false,
  send: (url, accept, signal) => window.fetch(url, { method: 'GET', headers: { Accept: accept }, redirect: 'follow', signal, cache: 'no-store', credentials: 'omit' }),
};

export function defaultTransport(): Transport {
  return isTauri() ? desktopTransport : browserTransport;
}

const isAbortLike = (error: unknown): boolean =>
  (error instanceof DOMException && error.name === 'AbortError') || /cancel/i.test(String(error));

/**
 * Read one address. Never throws for an answer the site gave: a 404 is a
 * result. A Stop from the user ends with problem "stopped".
 */
export async function fetchUrl(url: string, options: { accept?: string; signal?: AbortSignal; transport?: Transport; keepBody?: boolean; maxBytes?: number } = {}): Promise<Fetched> {
  const accept = options.accept ?? 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8';
  const transport = options.transport ?? defaultTransport();
  const redirects: string[] = [];
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const refused = mayFetch(current, transport.manualRedirects);
    if (refused) return { url, finalUrl: current, redirects, status: null, headers: {}, text: null, bytes: 0, problem: refused };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    const stop = () => controller.abort();
    options.signal?.addEventListener('abort', stop, { once: true });
    try {
      const response = await transport.send(current, accept, controller.signal);
      const headers = headerMap(response.headers);
      if (response.status >= 300 && response.status < 400 && headers.location) {
        redirects.push(current);
        let next: string;
        try {
          next = new URL(headers.location, current).href;
        } catch {
          return { url, finalUrl: current, redirects, status: response.status, headers, text: null, bytes: 0 };
        }
        current = next;
        continue;
      }
      // The browser followed any redirects on its own and shows only where it ended.
      const finalUrl = !transport.manualRedirects && response.url ? response.url : current;
      if (!transport.manualRedirects && response.redirected && response.url && response.url !== url) redirects.push(url);
      const buffer = new Uint8Array(await response.arrayBuffer());
      if (buffer.byteLength > (options.maxBytes ?? MAX_BYTES)) return { url, finalUrl, redirects, status: response.status, headers, text: null, bytes: buffer.byteLength, problem: 'too-big' };
      // As claude-seo reads it (url_safety.decode_body): BOM, the header's charset, a meta charset, else UTF-8.
      const text = decodeBody(buffer, headers['content-type'] ?? '');
      return { url, finalUrl, redirects: redirects.length ? [...redirects, finalUrl] : [], status: response.status, headers, text, bytes: buffer.byteLength, ...(options.keepBody ? { body: buffer } : {}) };
    } catch (error) {
      if (options.signal?.aborted) return { url, finalUrl: current, redirects, status: null, headers: {}, text: null, bytes: 0, problem: 'stopped' };
      if (controller.signal.aborted || isAbortLike(error)) return { url, finalUrl: current, redirects, status: null, headers: {}, text: null, bytes: 0, problem: 'timeout' };
      // A browser says nothing more than "Failed to fetch" when a site keeps other sites out.
      return { url, finalUrl: current, redirects, status: null, headers: {}, text: null, bytes: 0, problem: transport.manualRedirects ? 'offline' : 'blocked' };
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', stop);
    }
  }
  return { url, finalUrl: current, redirects, status: null, headers: {}, text: null, bytes: 0, problem: 'too-many-redirects' };
}

/** Whether an answer is a page of HTML. */
export function isHtml(fetched: Fetched): boolean {
  const type = fetched.headers['content-type'] ?? '';
  if (/html|xhtml/i.test(type)) return true;
  return !type && /^\s*(<!doctype html|<html)/i.test(fetched.text ?? '');
}

/**
 * The start address as typed, made whole: "example.com" becomes
 * "https://example.com/". Null when it can't be a web address.
 */
export function normaliseStart(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  // "mailto:me@a.example" is another kind of address, not a site; "a.example:8080" is a site.
  if (/^[a-z][a-z0-9+.-]*:(?!\/\/)(?!\d)/i.test(trimmed)) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(withScheme);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return null;
    if (parsed.username || parsed.password) return null;
    if (!parsed.hostname.includes('.') && parsed.hostname !== 'localhost') return null;
    parsed.hash = '';
    if (!parsed.pathname.endsWith('/') && !/\.[a-z0-9]{2,5}$/i.test(parsed.pathname)) parsed.pathname += '/';
    return parsed.href;
  } catch {
    return null;
  }
}
