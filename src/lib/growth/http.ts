// Requests for Growth's store clients (asc.ts for Apple, play.ts for Google),
// with the sync's Stop wired into each one.

import { bridgeFetch } from '@/lib/account/transport';

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException('The sync was stopped', 'AbortError');
}

/**
 * fetch with the sync's stop button wired to this one request only. The
 * desktop HTTP plugin keeps the abort listeners of requests that already
 * finished (see requestJson in account/transport.ts), so each request gets a
 * controller of its own that is unhooked from the sync's signal once it lands.
 */
export async function fetchWithStop(url: string, init: RequestInit, signal?: AbortSignal): Promise<Response> {
  throwIfAborted(signal);
  const doFetch = await bridgeFetch();
  const controller = signal ? new AbortController() : undefined;
  const onAbort = () => controller?.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const response = await doFetch(url, { ...init, signal: controller?.signal });
    throwIfAborted(signal);
    return response;
  } catch (error) {
    // The desktop HTTP plugin rejects a cancelled request with a plain
    // "Request cancelled" Error or string, never an AbortError, so a Stop
    // would otherwise be reported as a failed feed.
    throwIfAborted(signal);
    throw error;
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
}

/** A pause that the sync's Stop ends early. */
export function pause(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('The sync was stopped', 'AbortError'));
    const timer = setTimeout(done, ms);
    function done() {
      signal?.removeEventListener('abort', stopped);
      resolve();
    }
    function stopped() {
      clearTimeout(timer);
      reject(new DOMException('The sync was stopped', 'AbortError'));
    }
    signal?.addEventListener('abort', stopped, { once: true });
  });
}

/** How long the server asks to wait, from Retry-After in seconds, within reason. */
export function retryAfter(response: Response, fallbackMs: number): number {
  const seconds = Number(response.headers.get('retry-after'));
  return Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds * 1000, 30_000) : fallbackMs;
}
