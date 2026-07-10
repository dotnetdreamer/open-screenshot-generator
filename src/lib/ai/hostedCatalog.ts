import type { Project } from '@/types/artboard';
import { buildFullCatalogArtifacts, type AliasMap } from './aliasCatalog';
import { buildTemplateCatalog } from './templateCatalog';

/**
 * The repository-hosted template catalog.
 *
 * The full catalog (every template, full slot detail, aliased refs, preview
 * PNG links) is published as a plain text file on the deployed site, and the
 * agent prompt carries only its URL. A provider that can browse fetches it
 * server-side, so the typed message stays tiny.
 *
 * Trust, but verify: consumer chat UIs sometimes skip the fetch or invent
 * page content. The file's first line is a VERIFICATION-TOKEN derived from a
 * hash of the file body, and the prompt requires the model to echo it in the
 * reply. The client computes the same token from its own template data
 * (`buildHostedCatalog` runs identically in the build script and in the
 * browser), so a missing or wrong echo means the model never really read the
 * file and the caller falls back to the inline prompt. The hash also guards
 * ref alignment: if the deployed file was generated from different templates
 * than the running client holds, tokens differ and the fallback kicks in
 * before any mis-mapped ids are accepted.
 */

/** Where the static export is published. Forks can override at build time. */
export const PUBLIC_SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ?? 'https://dotnetdreamer.github.io/artboard-studio'
).replace(/\/$/, '');

export const HOSTED_CATALOG_PATH = '/data/ai/catalog.txt';
export const HOSTED_CATALOG_URL = `${PUBLIC_SITE_URL}${HOSTED_CATALOG_PATH}`;

const TOKEN_LINE_PREFIX = 'VERIFICATION-TOKEN: ';

export interface HostedCatalog {
  /** Full file contents, token line included. What the script writes. */
  fileText: string;
  /** The token the model must echo as "sourceToken". */
  token: string;
  aliasMap: AliasMap;
}

/** FNV-1a, hex. Tiny, dependency-free, identical in node and the browser. */
function fnv1a(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function absoluteUrl(path: string): string {
  if (!path || !path.startsWith('/') || path.startsWith('//')) return path;
  return `${PUBLIC_SITE_URL}${path}`;
}

/**
 * Builds the hosted catalog file from a loaded template list. Deterministic:
 * the build script and the running client must call this with templates
 * loaded the same way (projectService order and field fallbacks) to agree on
 * the token and the refs.
 */
export function buildHostedCatalog(templates: Project[]): HostedCatalog {
  const entries = buildTemplateCatalog(templates);
  const artifacts = buildFullCatalogArtifacts(entries);

  const previews = templates
    .map((template, i) => `t${i} preview: ${absoluteUrl(template.previewImage ?? '')}`)
    .filter((line) => !line.endsWith(': '));

  const body = [
    'Artboard Studio template catalog. Templates are t<n>; within each, device slots are d<k> and text slots are x<k>, numbered across the whole template. Refer to templates and slots ONLY by these refs.',
    '',
    artifacts.catalogText,
    '',
    'Template previews (PNG):',
    ...previews,
    '',
  ].join('\n');

  const token = `abs-${fnv1a(body)}`;
  return {
    fileText: `${TOKEN_LINE_PREFIX}${token}\n${body}`,
    token,
    aliasMap: artifacts.aliasMap,
  };
}

// --- per-provider fetch capability cache -------------------------------------
//
// A provider that failed the token handshake once (no browsing, toggle off,
// hallucinated fetch) would fail it every run, wasting a full round trip
// before the inline fallback. Remember the outcome per provider, scoped to
// the current token: a redeploy (new token) clears the verdict so providers
// get retried against the fresh file.

export type UrlFetchCapability = 'ok' | 'fail';

/** A 'fail' verdict expires, so a provider whose browsing toggle was merely
 * switched off gets another chance without the user clearing storage. */
const FAIL_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function cacheKey(provider: string): string {
  return `agent-url-fetch:${provider}`;
}

/** `<capability>|<token>|<epochMs>`. An unparseable value (older format, hand
 * edit) reads as unknown, which retries rather than blocks. */
export function readUrlFetchCapability(provider: string, token: string): UrlFetchCapability | null {
  try {
    const parts = (window.localStorage.getItem(cacheKey(provider)) ?? '').split('|');
    if (parts.length !== 3) return null;
    const [capability, storedToken, stamp] = parts;
    if (storedToken !== token) return null;
    if (capability === 'ok') return 'ok';
    if (capability === 'fail') {
      return Date.now() - Number(stamp) < FAIL_TTL_MS ? 'fail' : null;
    }
  } catch {
    // Storage unavailable: treat as unknown.
  }
  return null;
}

export function writeUrlFetchCapability(
  provider: string,
  token: string,
  capability: UrlFetchCapability
): void {
  try {
    window.localStorage.setItem(cacheKey(provider), `${capability}|${token}|${Date.now()}`);
  } catch {
    // Best-effort.
  }
}

// --- preflight ---------------------------------------------------------------

export type CatalogReachability = 'ok' | 'unreachable' | 'stale';

const PREFLIGHT_TIMEOUT_MS = 6000;

/**
 * Can a provider actually be expected to read the hosted catalog right now?
 *
 * The app fetches the file itself and checks the token on its first line. This
 * separates "this provider cannot browse" from "the catalog is missing, not
 * deployed yet, or was built from different templates than this client holds".
 * Only the former is a fact about the provider worth remembering; without this
 * check, a run against an undeployed catalog would blame the provider and
 * cache a verdict that never expires, because the token is a hash of file
 * content and redeploying the same content does not change it.
 */
export async function verifyHostedCatalog(
  expectedToken: string,
  signal?: AbortSignal
): Promise<CatalogReachability> {
  // An `abort` listener never fires for a signal that aborted before it was
  // attached, so a cancelled run would otherwise sail through the fetch.
  if (signal?.aborted) return 'unreachable';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PREFLIGHT_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort);
  try {
    const response = await fetch(HOSTED_CATALOG_URL, {
      // Revalidate rather than re-download: a stale copy would defeat the point.
      cache: 'no-cache',
      signal: controller.signal,
    });
    if (!response.ok) return 'unreachable';
    const firstLine = (await response.text()).split('\n', 1)[0].trim();
    if (!firstLine.startsWith(TOKEN_LINE_PREFIX)) return 'stale';
    return firstLine.slice(TOKEN_LINE_PREFIX.length).trim() === expectedToken ? 'ok' : 'stale';
  } catch {
    // Offline, blocked, timed out, or cancelled: not the provider's fault.
    return 'unreachable';
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}
