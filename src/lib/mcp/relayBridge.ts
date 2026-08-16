// The web half of the MCP server: connect this tab to the relay so an AI client
// can drive it.
//
// The desktop app opens a socket on 127.0.0.1 and Rust hands each JSON-RPC
// request to the webview. A browser tab can open no socket, so instead it dials
// out to the relay (infra/vps/mcp-relay) and holds an event stream open:
//
//     Claude Code ──POST /mcp/<code>──►  relay  ──SSE /tab/<code>──►  this tab
//                 ◄─────── JSON ───────        ◄── POST .../reply ───
//
// Everything below the transport is shared with the desktop path: the same
// protocol, the same 42 tools, the same runMcpRequest(). Only the wire differs.
//
// With NEXT_PUBLIC_MCP_RELAY_URL unset the whole feature is off and nothing in
// here ever runs — same shape as NEXT_PUBLIC_DISCOVER_URL.

import { runMcpRequest, type McpDesignApi } from '@/lib/mcp/desktopMcpServer';

/** Base URL of the relay, e.g. https://mcp.openscrgen.app. Empty = feature off. */
export const MCP_RELAY_URL = (process.env.NEXT_PUBLIC_MCP_RELAY_URL ?? '').trim().replace(/\/+$/, '');

/** Whether the web build can offer an MCP connection at all. */
export function relayConfigured(): boolean {
  return MCP_RELAY_URL.length > 0;
}

// The code is the whole credential, so it is generated here and kept here. It
// lives in localStorage rather than memory so that the URL a user pasted into
// their client config still works after a reload — a code that changed every
// refresh would make the feature useless.
const CODE_KEY = 'osg-mcp-relay-code';
const ENABLED_KEY = 'osg-mcp-relay-enabled';

/** 128 bits of hex. Stable per browser until the user disconnects. */
export function getRelayCode(): string {
  if (typeof window === 'undefined') return '';
  const existing = window.localStorage.getItem(CODE_KEY);
  if (existing && /^[a-f0-9]{24,64}$/.test(existing)) return existing;
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const code = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  window.localStorage.setItem(CODE_KEY, code);
  return code;
}

/** Forget the current code so the next connection mints a new one. The way to
 *  revoke a link that got out. */
export function resetRelayCode(): void {
  if (typeof window !== 'undefined') window.localStorage.removeItem(CODE_KEY);
}

/** The URL to paste into Claude Code, Cursor, VS Code or Claude Desktop. */
export function relayClientUrl(code: string): string {
  return `${MCP_RELAY_URL}/mcp/${code}`;
}

/** Opt-in, and it stays opt-in across reloads: nothing connects until asked. */
export function relayEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(ENABLED_KEY) === '1';
}

export function setRelayEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  if (enabled) window.localStorage.setItem(ENABLED_KEY, '1');
  else window.localStorage.removeItem(ENABLED_KEY);
}

export type RelayState = 'off' | 'connecting' | 'connected' | 'error';

/**
 * Hold the connection open until the returned function is called.
 *
 * EventSource reconnects on its own, so a dropped stream (relay restart, laptop
 * lid, flaky wifi) needs nothing here beyond reporting the state; the code and
 * therefore the client URL survive it.
 */
export function startRelayMcpBridge(options: {
  getApi: () => McpDesignApi | null;
  code: string;
  onState?: (state: RelayState) => void;
}): () => void {
  const { getApi, code, onState } = options;
  if (!relayConfigured() || !code || typeof window === 'undefined') return () => {};

  let closed = false;
  onState?.('connecting');

  const source = new EventSource(`${MCP_RELAY_URL}/tab/${code}`);

  source.onopen = () => {
    if (!closed) onState?.('connected');
  };

  // EventSource retries by itself; readyState tells the two cases apart, and
  // CLOSED here means it gave up (a 4xx from the relay, typically).
  source.onerror = () => {
    if (closed) return;
    onState?.(source.readyState === EventSource.CLOSED ? 'error' : 'connecting');
  };

  source.onmessage = async (event) => {
    if (closed) return;
    let callId: string | undefined;
    let message: unknown;
    try {
      ({ callId, message } = JSON.parse(event.data));
    } catch {
      return;
    }
    if (!callId) return;

    const response = await runMcpRequest(message as any, getApi());
    if (closed) return;
    try {
      await fetch(`${MCP_RELAY_URL}/tab/${code}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // Deliberately not `keepalive: true`: that caps the body at 64KB, and
        // an export_png reply is a base64 image well past it.
        body: JSON.stringify({ callId, response }),
      });
    } catch {
      // The relay drops the call at its own deadline; the client sees a timeout
      // rather than a hang, and there is nothing useful to do from here.
    }
  };

  return () => {
    closed = true;
    source.close();
    onState?.('off');
  };
}
