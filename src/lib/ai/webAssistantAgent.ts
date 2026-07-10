/**
 * Runs inside the desktop app's embedded provider window (WebView2 / WKWebView).
 *
 * This is the "chromium part": instead of a separate browser extension, the
 * Tauri shell opens the assistant site in a hidden in-app window, the user signs
 * in there once (the session persists in the app's own browser profile), and
 * this agent drives the page on-device. It is the same idea as gpt4free's
 * nodriver providers, except the real Chromium is the one the app already ships,
 * so there is no server, no bundled browser and no cookies leaving the machine.
 *
 * Injected as a Tauri initialization script, so it runs before the page's own
 * scripts on every top-level navigation. Two channels:
 *   - Rust -> here: the shell calls window.__absAgent.dispatch / .cancel via eval.
 *   - here -> app:  Tauri events on WEB_EVENT_CHANNEL (progress / result / error
 *     / ready), authorised for this remote origin by the assistant capability.
 *
 * Bundled to src-tauri/assistant/agent.js by `npm run build:assistant-agent`.
 */

import { emit } from '@tauri-apps/api/event';
import { WEB_EVENT_CHANNEL, adapterForHost, type WebAdapter } from './webAdapters';
import { DriverError, runSession, detectLoginState, type DriverImage } from './webDriverCore';

interface DispatchJob {
  requestId: string;
  prompt: string;
  images: DriverImage[];
}

interface AgentApi {
  dispatch: (job: DispatchJob) => void;
  cancel: (requestId: string) => void;
}

declare global {
  interface Window {
    __absAgent?: AgentApi;
  }
}

const FLAG = '__absAgentInstalled';

function send(payload: Record<string, unknown>): void {
  // A remote page without IPC access (wrong capability, or an intermediate
  // login origin) would throw here; never let that break the page.
  void emit(WEB_EVENT_CHANNEL, payload).catch(() => {});
}

function install(config: WebAdapter): void {
  let cancelledId: string | null = null;
  let running = false;

  const api: AgentApi = {
    cancel(requestId: string) {
      cancelledId = requestId;
    },
    dispatch(job: DispatchJob) {
      if (running) return; // one run per window at a time
      running = true;
      cancelledId = null;
      const rid = job.requestId;

      void runSession(
        config,
        { prompt: job.prompt, images: job.images ?? [] },
        {
          progress: (stage) => send({ type: 'progress', requestId: rid, provider: config.id, stage }),
          isCancelled: () => cancelledId === rid,
        }
      )
        .then((text) => send({ type: 'result', requestId: rid, provider: config.id, text }))
        .catch((error: unknown) => {
          const code = error instanceof DriverError ? error.code : 'unknown';
          const message =
            error instanceof Error ? error.message : 'The assistant could not be driven.';
          send({ type: 'error', requestId: rid, provider: config.id, code, message });
        })
        .finally(() => {
          running = false;
        });
    },
  };

  window.__absAgent = api;

  // Announce readiness once the chat UI (or a login wall) has settled, so the
  // shell knows whether to dispatch a queued job or surface a sign-in. If the
  // page is not signed in yet, keep watching: a slow SPA boot or an in-page
  // sign-in never re-runs this init script, so a second `ready` is the only
  // way a queued job would still get dispatched.
  //
  // Crucially, a `ready` with loggedIn:false is what makes the shell reveal the
  // (otherwise hidden) window for a manual sign-in. So we only send it on a
  // *definite* signed-out marker, never on the 'unknown' of a still-booting
  // page: a slow-but-signed-in start would otherwise flash the window open and
  // then closed once the run finished. On 'unknown' we keep the window hidden
  // and keep polling; a genuinely stuck page still surfaces after a long stall.
  void (async () => {
    const startedAt = Date.now();
    const REVEAL_AFTER_STALL_MS = 30_000; // a blank/stuck page still gets a window
    const DEADLINE = startedAt + 15 * 60_000; // leave a manual sign-in plenty of time
    let revealed = false; // have we already asked the shell to show the window?

    for (;;) {
      const state = await detectLoginState(config, 4000);
      if (state === 'in') {
        // Signed in: let the shell dispatch the queued job. Safe to repeat, it
        // only re-dispatches while a job is still queued.
        send({ type: 'ready', requestId: '', provider: config.id, loggedIn: true });
        return;
      }
      if (Date.now() >= DEADLINE) return;
      const stalled = Date.now() - startedAt >= REVEAL_AFTER_STALL_MS;
      if (!revealed && (state === 'out' || stalled)) {
        revealed = true;
        send({ type: 'ready', requestId: '', provider: config.id, loggedIn: false });
      }
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  })();
}

function boot(): void {
  const config = adapterForHost(location.hostname);
  if (!config) return; // an intermediate login origin, not a driven site
  // The init script re-runs on every navigation; install the agent once.
  const w = window as unknown as Record<string, boolean>;
  if (w[FLAG]) return;
  w[FLAG] = true;
  install(config);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
