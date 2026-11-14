// The editor's side of the Growth browser (growth_browser.rs): open a console
// page, place the browser over the pane the Ask AI screen lays out, run the
// driver's commands (driver.ts), and hear what Rust reports: page loads,
// titles, blocked sites and key files.
//
// One browser per app, in the window that opened it. The state here is the
// page's view of it, shared by the pane that draws its toolbar and the
// assistant that drives it.
//
// Desktop only, and safe to import on the web, where `available()` is false
// and nothing reaches Tauri.

import { isTauri } from '@/lib/desktop';
import type {
  ActionAnswer,
  ControlDescription,
  CopiedAnswer,
  DriverCommand,
  Expected,
  PageSnapshot,
  PingAnswer,
} from './protocol';

/** Must match EVENT in src-tauri/src/growth_browser.rs. */
export const GROWTH_BROWSER_EVENT = 'abs-growth-browser';

export interface PaneBox {
  x: number;
  y: number;
  width: number;
  height: number;
  /** The page's own height, which tells Rust where the page starts in its webview. */
  viewport?: number;
}

export interface BrowserState {
  open: boolean;
  /** Drawn inside the window. False on Linux, where the browser has a window of its own. */
  embedded: boolean;
  url: string | null;
  title: string | null;
  loading: boolean;
  /** The last site the browser would not open, for the toolbar to offer. */
  blocked: { url: string; host: string; at: number } | null;
  /** The last download turned away, with why. */
  refused: { fileName: string; reason: string; at: number } | null;
}

export interface CaughtKeyFile {
  kind: 'apple-key' | 'play-key';
  fileName: string;
  content: string;
}

type RustEvent =
  | { type: 'page'; phase: 'started' | 'finished'; url: string }
  | { type: 'title'; title: string }
  | { type: 'blocked'; url: string; host: string }
  | { type: 'external'; url: string }
  | { type: 'key-file'; kind: CaughtKeyFile['kind']; fileName: string; content: string }
  | { type: 'download-refused'; fileName: string; reason: string };

const CLOSED: BrowserState = { open: false, embedded: true, url: null, title: null, loading: false, blocked: null, refused: null };

let state: BrowserState = CLOSED;
const listeners = new Set<() => void>();
const keyFileListeners = new Set<(file: CaughtKeyFile) => void>();
let pane: { box: PaneBox; visible: boolean } = { box: { x: 0, y: 0, width: 1, height: 1, viewport: 0 }, visible: false };
let listening: Promise<void> | null = null;

function update(patch: Partial<BrowserState>): void {
  state = { ...state, ...patch };
  listeners.forEach((listener) => listener());
}

export function available(): boolean {
  return isTauri();
}

export function browserState(): BrowserState {
  return state;
}

export function subscribeBrowser(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Key files the consoles download. They go to whoever listens and never into a prompt. */
export function onKeyFile(listener: (file: CaughtKeyFile) => void): () => void {
  keyFileListeners.add(listener);
  return () => keyFileListeners.delete(listener);
}

async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) throw new Error('The Growth browser works in the desktop app only');
  const { invoke: tauriInvoke } = await import('@tauri-apps/api/core');
  try {
    return await tauriInvoke<T>(command, args);
  } catch (error) {
    throw error instanceof Error ? error : new Error(String(error));
  }
}

function listen(): Promise<void> {
  if (listening || !isTauri()) return listening ?? Promise.resolve();
  listening = (async () => {
    const { listen: tauriListen } = await import('@tauri-apps/api/event');
    await tauriListen<RustEvent>(GROWTH_BROWSER_EVENT, ({ payload }) => {
      switch (payload.type) {
        case 'page':
          update({ url: payload.url, loading: payload.phase === 'started' });
          break;
        case 'title':
          update({ title: payload.title });
          break;
        case 'blocked':
          update({ blocked: { url: payload.url, host: payload.host, at: Date.now() } });
          break;
        case 'download-refused':
          update({ refused: { fileName: payload.fileName, reason: payload.reason, at: Date.now() } });
          break;
        case 'key-file':
          keyFileListeners.forEach((listener) =>
            listener({ kind: payload.kind, fileName: payload.fileName, content: payload.content })
          );
          break;
        case 'external':
          break;
      }
    });
    // A browser this page did not open, left by the page before a reload,
    // closes when that page loads again (growth_browser.rs on_page_load).
  })();
  return listening;
}

/** Where the pane is, and whether it is on screen. The browser follows. */
export function setPane(box: PaneBox, visible: boolean): void {
  const rounded = {
    x: Math.round(box.x),
    y: Math.round(box.y),
    width: Math.max(1, Math.round(box.width)),
    height: Math.max(1, Math.round(box.height)),
    viewport: typeof window === 'undefined' ? 0 : window.innerHeight,
  };
  const same =
    pane.visible === visible &&
    pane.box.x === rounded.x &&
    pane.box.y === rounded.y &&
    pane.box.width === rounded.width &&
    pane.box.height === rounded.height &&
    pane.box.viewport === rounded.viewport;
  pane = { box: rounded, visible };
  if (same || !state.open) return;
  void invoke('abs_growth_browser_place', { bounds: rounded, visible }).catch((error) =>
    console.error('Placing the Growth browser failed', error)
  );
}

/** Open `url`, making the browser if there is none. */
export async function openPage(url: string): Promise<void> {
  await listen();
  const answer = await invoke<{ embedded: boolean }>('abs_growth_browser_open', {
    url,
    bounds: pane.box,
    visible: pane.visible,
  });
  update({ open: true, embedded: answer.embedded, url, loading: true, blocked: null });
}

export async function goTo(url: string): Promise<void> {
  if (!state.open) return openPage(url);
  await invoke('abs_growth_browser_go', { url });
  update({ url, loading: true, blocked: null });
}

export async function navigate(action: 'back' | 'forward' | 'reload'): Promise<void> {
  if (!state.open) return;
  await invoke('abs_growth_browser_nav', { action });
}

/** Open a site the user said yes to, such as their company's sign-in page. */
export async function allowSite(url: string): Promise<void> {
  if (!state.open) return;
  await invoke('abs_growth_browser_allow', { url });
  update({ blocked: null, loading: true });
}

export async function closeBrowser(): Promise<void> {
  if (!state.open) return;
  update(CLOSED);
  await invoke('abs_growth_browser_close').catch((error) => console.error('Closing the Growth browser failed', error));
}

/** One driver command. Null while the page is between documents. */
export async function runDriver<T>(command: DriverCommand): Promise<T | null> {
  if (!state.open) throw new Error('The browser is closed');
  const text = await invoke<string>('abs_growth_browser_run', { command: JSON.stringify(command) });
  if (!text) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

function pause(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Stopped', 'AbortError'));
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new DOMException('Stopped', 'AbortError'));
      },
      { once: true }
    );
  });
}

/**
 * Wait until the page has loaded and stopped changing for a moment, or
 * `limitMs` has passed. Consoles keep a request or two open for good, so
 * quiet counts for more than requests.
 */
export async function settle(options: { signal?: AbortSignal; limitMs?: number; quietMs?: number } = {}): Promise<PingAnswer | null> {
  const limit = Date.now() + (options.limitMs ?? 12_000);
  const quiet = options.quietMs ?? 700;
  let last: PingAnswer | null = null;
  // A click that starts a navigation needs a moment before the old page goes.
  await pause(250, options.signal);
  while (Date.now() < limit) {
    try {
      last = await runDriver<PingAnswer>({ cmd: 'ping' });
    } catch {
      last = null;
    }
    const loaded = last && last.ready === 'complete' && !state.loading;
    if (loaded && last!.quietMs >= quiet && (last!.pending === 0 || last!.quietMs >= quiet * 3)) return last;
    await pause(250, options.signal);
  }
  return last;
}

export const driver = {
  snapshot: (max?: number) => runDriver<PageSnapshot>({ cmd: 'snapshot', max }),
  describe: (ref: number) => runDriver<ControlDescription>({ cmd: 'describe', ref }),
  /** `expect` is the control as the app judged it; the driver acts only while it still matches. */
  click: (ref: number, expect?: Expected) => runDriver<ActionAnswer>({ cmd: 'click', ref, expect }),
  type: (ref: number, text: string, expect?: Expected) => runDriver<ActionAnswer>({ cmd: 'type', ref, text, expect }),
  pick: (ref: number, option: string, mode: { preview?: boolean; exact?: boolean; expect?: Expected } = {}) =>
    runDriver<ActionAnswer>({ cmd: 'pick', ref, option, ...mode }),
  scroll: (to: 'up' | 'down' | 'top' | 'bottom') => runDriver<ActionAnswer>({ cmd: 'scroll', to }),
  point: (ref: number, note?: string) => runDriver<ActionAnswer>({ cmd: 'point', ref, note }),
  clear: () => runDriver<ActionAnswer>({ cmd: 'clear' }),
  copied: () => runDriver<CopiedAnswer>({ cmd: 'copied' }),
};

/** Everything the assistant uses, in one object, so a test can hand it a stand-in. */
export const growthBrowser = {
  state: browserState,
  subscribe: subscribeBrowser,
  open: openPage,
  go: goTo,
  close: closeBrowser,
  settle,
  driver,
};

export type BrowserPort = typeof growthBrowser;
