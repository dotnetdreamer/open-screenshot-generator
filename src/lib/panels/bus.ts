"use client";

// The wire between the editor window and its detached panel windows.
//
// Two drivers behind one interface, because the two shells have nothing in
// common at this layer:
//
//   desktop  Tauri events. A detached panel is a real OS window with its own
//            webview, so there is no shared JS realm to lean on. `emit` fans a
//            payload out to every window in the app, which is exactly the shape
//            we want, with the one catch that it comes back to the sender too.
//   web      BroadcastChannel. A popup opened from the editor is same origin,
//            so the browser already has a fan-out channel, and it does not
//            deliver to the sender.
//
// Every message carries the sending window's id and the reader drops its own,
// which makes the two behave the same and makes one shared channel safe.
//
// The Tauri driver is behind a dynamic import for the usual reason: the web
// bundle must never pull @tauri-apps/api in at module-evaluation time.

import { isTauri } from '@/lib/desktop';
import type { PanelMessage } from './protocol';

/** Tauri event name. Matches the abs- prefix the other app channels use. */
const TAURI_EVENT = 'abs-panels-bus';
/** BroadcastChannel name. Per origin, so the editor and its popups share it. */
const WEB_CHANNEL = 'abs-panels-bus';

/**
 * This window's id on the bus.
 *
 * One per document, generated at module load, and never persisted: a reload
 * gives a window a new id on purpose, so a stale registration on the other side
 * is replaced rather than shadowed.
 */
export const PANEL_WINDOW_ID: string = `w_${Math.random().toString(36).slice(2, 10)}`;

export interface PanelBus {
  /** Fan a message out to every other window. Never throws. */
  post(message: PanelMessage): void;
  /** Stop listening and release the channel. Safe to call twice. */
  close(): void;
}

const NO_BUS: PanelBus = { post: () => {}, close: () => {} };

/**
 * Join the bus.
 *
 * Resolves once the channel is actually listening, so the caller's first
 * message (a hello, a snapshot) is guaranteed to be heard by whoever is already
 * on the wire.
 */
export async function joinPanelBus(
  onMessage: (message: PanelMessage) => void
): Promise<PanelBus> {
  let closed = false;

  const receive = (message: PanelMessage | undefined) => {
    if (closed || !message || typeof message !== 'object') return;
    // Our own emit, echoed back by Tauri. Not an error, just not for us.
    if (message.from === PANEL_WINDOW_ID) return;
    onMessage(message);
  };

  if (isTauri()) {
    const { emit, listen } = await import('@tauri-apps/api/event');
    const unlisten = await listen<PanelMessage>(TAURI_EVENT, (event) => receive(event.payload));
    return {
      post: (message) => {
        void emit(TAURI_EVENT, message).catch((error) => {
          console.error('Could not reach the other window', error);
        });
      },
      close: () => {
        if (closed) return;
        closed = true;
        unlisten();
      },
    };
  }

  // The web driver. BroadcastChannel is missing in no browser this editor
  // supports, but a hardened profile can still take it away, and a panel window
  // is better off saying it lost the editor than throwing on mount.
  if (typeof BroadcastChannel === 'undefined') return NO_BUS;

  const channel = new BroadcastChannel(WEB_CHANNEL);
  channel.onmessage = (event: MessageEvent<PanelMessage>) => receive(event.data);
  return {
    post: (message) => {
      try {
        channel.postMessage(message);
      } catch (error) {
        console.error('Could not reach the other window', error);
      }
    },
    close: () => {
      if (closed) return;
      closed = true;
      channel.onmessage = null;
      channel.close();
    },
  };
}
