"use client";

// The editor's own clipboard for layers, one for the whole app.
//
// Copy and paste work between projects (issue #47): copy in one tab, paste in
// another, in a project opened later, or in another window of the editor. So
// the clipboard cannot live in one window's React state. It is kept in
// localStorage, which every window of the app shares, with a copy in memory
// that the canvas menu reads on every render. A copy made in another window
// arrives through the `storage` event, and through a fresh read when this
// window gets focus and when it pastes, which also covers a webview that never
// delivers the event.
//
// What it holds is a transfer (tabs/transfer.ts), the thing Move to tab
// carries: the layers with their translations and the languages they were
// written in, so a paste into another project lands the way a move does.
// Media needs nothing, because elements carry `asset:<id>` and `mediaId`, and
// the media table belongs to the device, not to a project. Imported fonts are
// the same, apart from one window not yet knowing a font another one imported,
// which the paste puts on the page before it measures anything
// (tabs/transferFonts.ts).
//
// The system clipboard is a different thing: it carries images into the
// screenshot intake, and nothing here reads or writes it.

import { useSyncExternalStore } from 'react';
import type { ElementTransfer } from '@/lib/tabs/transfer';

const STORAGE_KEY = 'abs-element-clipboard';
/** Bumped when the shape changes, so an older build's copy is ignored rather than misread. */
const FORMAT = 1;

export interface ElementClipboard {
  format: typeof FORMAT;
  transfer: ElementTransfer;
  /** Where the layers were copied from: a paste on that same artboard lands beside them. */
  source: { projectId: string | null; projectName: string; artboardId: string };
  copiedAt: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const isNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const isPoint = (value: unknown) => isRecord(value) && isNumber(value.x) && isNumber(value.y);
const isSize = (value: unknown) => isRecord(value) && isNumber(value.width) && isNumber(value.height);

/** Anything else in storage (another build's copy, a hand edit) reads as an empty clipboard. */
export function isElementClipboard(value: unknown): value is ElementClipboard {
  if (!isRecord(value) || value.format !== FORMAT || !isNumber(value.copiedAt)) return false;
  const { transfer, source } = value;
  if (!isRecord(transfer) || !isRecord(source) || typeof source.artboardId !== 'string') return false;
  if (!isSize(transfer.sourceSize) || !isRecord(transfer.localized)) return false;
  const { elements } = transfer;
  return (
    Array.isArray(elements) &&
    elements.length > 0 &&
    elements.every(
      (element) =>
        isRecord(element) &&
        typeof element.id === 'string' &&
        typeof element.type === 'string' &&
        isPoint(element.position) &&
        isSize(element.size)
    )
  );
}

function parse(raw: string | null): ElementClipboard | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    return isElementClipboard(value) ? value : null;
  } catch {
    return null;
  }
}

let current: ElementClipboard | null = null;
/** The stored string `current` was last compared against. */
let lastRaw: string | null = null;
let primed = false;
/** This window's last copy did not fit in storage, so only this window has it. */
let unstored = false;
const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach((listener) => listener());
}

/** Catch up with storage. True when what this window holds changed. */
function refresh(): boolean {
  primed = true;
  if (typeof window === 'undefined') return false;
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    // Storage switched off: this window's own copies are all there is.
    return false;
  }
  if (raw === lastRaw) return false;
  lastRaw = raw;
  const stored = parse(raw);
  if (stored) {
    if (current && stored.copiedAt < current.copiedAt) return false;
    current = stored;
    unstored = false;
    return true;
  }
  // Gone from storage: another window copied something too big to store, which
  // makes what this window holds the older copy. Unless this window's own copy
  // is the one that did not fit.
  if (unstored || !current) return false;
  current = null;
  return true;
}

let watching = false;
function watch(): void {
  if (watching || typeof window === 'undefined') return;
  watching = true;
  window.addEventListener('storage', (event) => {
    if (event.key !== STORAGE_KEY && event.key !== null) return;
    if (refresh()) notify();
  });
  window.addEventListener('focus', () => {
    if (refresh()) notify();
  });
}

/** Put layers on the clipboard, for every project and window of the app. */
export function writeElementClipboard(clip: Omit<ElementClipboard, 'format'>): void {
  const value: ElementClipboard = { ...clip, format: FORMAT };
  current = value;
  primed = true;
  unstored = false;
  if (typeof window !== 'undefined') {
    try {
      const raw = JSON.stringify(value);
      window.localStorage.setItem(STORAGE_KEY, raw);
      lastRaw = raw;
    } catch (error) {
      // Over the storage quota. This window keeps the copy, and the stored one,
      // which is older, goes, so no other window pastes that instead.
      console.warn('The copied layers are too big to share with other windows', error);
      unstored = true;
      try {
        window.localStorage.removeItem(STORAGE_KEY);
      } catch {
        // Nothing stored to take away.
      }
      lastRaw = null;
    }
  }
  notify();
}

/** The latest copy, made in this window or any other. What a paste reads. */
export function readElementClipboard(): ElementClipboard | null {
  watch();
  if (refresh()) notify();
  return current;
}

/** Told whenever the clipboard changes, whichever window copied. */
export function subscribeElementClipboard(listener: () => void): () => void {
  listeners.add(listener);
  watch();
  return () => {
    listeners.delete(listener);
  };
}

function snapshot(): ElementClipboard | null {
  // The first read primes from storage. Every later change comes through
  // refresh and notify, so this stays the same object between them.
  if (!primed) refresh();
  return current;
}

/** The clipboard, live, for whatever shows whether there is something to paste. */
export function useElementClipboard(): ElementClipboard | null {
  return useSyncExternalStore(subscribeElementClipboard, snapshot, () => null);
}
