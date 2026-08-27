/**
 * The one HTTP seam the AI transports share.
 *
 * Two things every provider call needs and neither the browser nor the Vercel
 * AI SDK gives us:
 *
 *  - A fetch that is not subject to CORS. Local runtimes (Ollama, LM Studio,
 *    vLLM) and most third party OpenAI-compatible hosts send no CORS headers
 *    for our origin, so in a plain browser the request dies as an opaque
 *    "Failed to fetch". In the Tauri shell `tauri-plugin-http` performs the
 *    request in Rust, where CORS does not apply. The plugin is imported
 *    dynamically so it never lands in the web bundle.
 *  - A signal that is both the caller's cancel and a timeout, without
 *    `AbortSignal.any`, which is too new for every WebView we ship on.
 */

import { isTauri } from '@/lib/desktop';

/** window.fetch, or the plain global during SSR where there is no window. */
function browserFetch(): typeof fetch {
  return typeof window === 'undefined' ? fetch : window.fetch.bind(window);
}

interface Bridge {
  impl: typeof fetch;
  /** false when this is just the webview's own fetch, CORS and all. */
  viaBridge: boolean;
}

let bridgePromise: Promise<Bridge> | null = null;

function resolveBridge(): Promise<Bridge> {
  if (!isTauri()) return Promise.resolve({ impl: browserFetch(), viaBridge: false });
  if (!bridgePromise) {
    bridgePromise = import('@tauri-apps/plugin-http')
      .then((mod) => ({ impl: mod.fetch as unknown as typeof fetch, viaBridge: true }))
      // A shell without the plugin registered is still better off with the
      // webview's own fetch than with a hard failure.
      .catch(() => ({ impl: browserFetch(), viaBridge: false }));
  }
  return bridgePromise;
}

/**
 * The best fetch this platform has: the Tauri HTTP bridge on desktop, the
 * browser's own everywhere else. Resolved once and cached, because the dynamic
 * import costs a module fetch on first use.
 */
export async function resolveBridgeFetch(): Promise<typeof fetch> {
  return (await resolveBridge()).impl;
}

/**
 * Tauri commands reject with the *serialized* error, so a plugin error arrives
 * as a plain string, not an Error. Reading `.message` off it silently yields
 * undefined and every check downstream misses.
 */
function messageOf(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error instanceof Error) return error.message;
  return '';
}

/**
 * The bridge only carries hosts listed in the app's HTTP scope
 * (src-tauri/capabilities/default.json), and a user's own endpoint is by
 * definition not known when that file is written. A refusal there is not the
 * end of the road: the webview's own fetch still reaches any host that sends
 * CORS headers for us, so it gets the second try, and only its failure is
 * reported.
 */
function isScopeRefusal(error: unknown): boolean {
  return /not allowed on the configured scope|url not allowed/i.test(messageOf(error));
}

/**
 * The same thing shaped like `fetch` itself, for libraries that take a `fetch`
 * option and call it synchronously (the AI SDK does). Awaiting the import
 * inside the call is free: the result was going to be a promise anyway.
 */
export const bridgeFetch: typeof fetch = async (input, init) => {
  const { impl, viaBridge } = await resolveBridge();
  if (!viaBridge) return impl(input, init);
  try {
    return await impl(input, init);
  } catch (error) {
    if (isScopeRefusal(error)) return browserFetch()(input, init);
    // Same reason: a bare string thrown out of here reaches the AI SDK, which
    // passes anything that is not an Error straight through, and the caller
    // then reports "something went wrong" instead of what the bridge said.
    throw error instanceof Error ? error : new Error(messageOf(error) || 'The request failed.');
  }
};

/** Combine a caller's AbortSignal with a timeout into one signal. */
export function combineSignal(
  signal: AbortSignal | undefined,
  timeoutMs: number
): { signal: AbortSignal; dispose: () => void } {
  const controller = new AbortController();
  const onAbort = () => controller.abort(signal?.reason);
  const timer = setTimeout(
    () => controller.abort(new DOMException('Timed out', 'TimeoutError')),
    timeoutMs
  );
  if (signal) {
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort);
  }
  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    },
  };
}
