// The editor's clipboard for layers is one for the whole app (issue #47): what
// one window copies is what a paste in any other reads. The module shares it
// through localStorage and hears about other windows' copies through the
// `storage` event, so these run it against stand-ins for both. One module for
// the whole file, so the tests run in order, each from where the last left it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isElementClipboard,
  readElementClipboard,
  subscribeElementClipboard,
  writeElementClipboard,
  type ElementClipboard,
} from '@/lib/elementClipboard';
import type { ElementTransfer } from '@/lib/tabs/transfer';

const KEY = 'abs-element-clipboard';
const stored = new Map<string, string>();
/** How long a stored string may be before setItem throws, the way a full storage does. */
let quota = Infinity;
const page = new EventTarget();
Object.assign(globalThis, {
  window: {
    localStorage: {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (value.length > quota) throw new Error('QuotaExceededError');
        stored.set(key, value);
      },
      removeItem: (key: string) => {
        stored.delete(key);
      },
    },
    addEventListener: page.addEventListener.bind(page),
    removeEventListener: page.removeEventListener.bind(page),
  },
});

/** Another window's copy landing in storage, and the event that window's write raises here. */
function copyInAnotherWindow(clip: ElementClipboard, { announce = true } = {}): void {
  stored.set(KEY, JSON.stringify(clip));
  if (!announce) return;
  const event = new Event('storage');
  Object.defineProperty(event, 'key', { value: KEY });
  page.dispatchEvent(event);
}

function transferOf(name: string, extra: Partial<ElementTransfer> = {}): ElementTransfer {
  return {
    elements: [
      {
        id: `${name}_el`,
        type: 'text',
        name,
        content: name,
        fontFamily: 'Inter',
        position: { x: 10, y: 20 },
        size: { width: 300, height: 80 },
        rotation: 0,
        scale: 1,
      } as unknown as ElementTransfer['elements'][number],
    ],
    localized: {},
    sourceArtboardId: `${name}_board`,
    sourceSize: { width: 1290, height: 2796 },
    ...extra,
  };
}

function clipOf(name: string, copiedAt: number): ElementClipboard {
  return {
    format: 1,
    transfer: transferOf(name),
    source: { projectId: `${name}_project`, projectName: name, artboardId: `${name}_board` },
    copiedAt,
  };
}

test('nothing copied yet reads as an empty clipboard', () => {
  assert.equal(readElementClipboard(), null);
});

test('a copy is what the next paste reads, and it is shared with the other windows', () => {
  const clip = clipOf('Alpha', 1000);
  writeElementClipboard({ transfer: clip.transfer, source: clip.source, copiedAt: clip.copiedAt });
  assert.equal(readElementClipboard()?.source.projectName, 'Alpha');
  const shared = JSON.parse(stored.get(KEY) ?? 'null');
  assert.ok(isElementClipboard(shared), 'in storage, where every window reads it');
  assert.equal(shared.transfer.elements[0].id, 'Alpha_el');
});

test('a copy made in another window arrives through the storage event', () => {
  let told = 0;
  const stop = subscribeElementClipboard(() => told++);
  copyInAnotherWindow(clipOf('Beta', 2000));
  stop();
  assert.equal(told, 1, 'whatever shows Paste hears about it');
  assert.equal(readElementClipboard()?.source.projectName, 'Beta');
});

test('and a paste reads storage itself, for a webview that never raises the event', () => {
  copyInAnotherWindow(clipOf('Gamma', 3000), { announce: false });
  assert.equal(readElementClipboard()?.source.projectName, 'Gamma');
});

test('a copy too big to share stays in this window, and the older shared one goes', () => {
  quota = 10;
  writeElementClipboard({ ...clipOf('Huge', 4000) });
  quota = Infinity;
  assert.equal(stored.has(KEY), false, 'no other window pastes the older copy instead');
  assert.equal(readElementClipboard()?.source.projectName, 'Huge', 'this window still has its own');

  // Until another window copies something newer.
  copyInAnotherWindow(clipOf('Delta', 5000));
  assert.equal(readElementClipboard()?.source.projectName, 'Delta');
});

test('a copy older than the one this window holds does not replace it', () => {
  copyInAnotherWindow(clipOf('Stale', 4500));
  assert.equal(readElementClipboard()?.source.projectName, 'Delta');
});

test('anything else in storage reads as nothing to paste', () => {
  const clip = clipOf('Epsilon', 6000);
  assert.equal(isElementClipboard(clip), true);
  assert.equal(isElementClipboard({ ...clip, format: 2 }), false, 'another build');
  assert.equal(isElementClipboard({ ...clip, transfer: { ...clip.transfer, elements: [] } }), false);
  const noBox = { ...clip.transfer.elements[0], size: undefined };
  assert.equal(isElementClipboard({ ...clip, transfer: { ...clip.transfer, elements: [noBox] } }), false);
  assert.equal(isElementClipboard('not json at all'), false);

  stored.set(KEY, '{"format":1,"copiedAt":7000}');
  assert.equal(readElementClipboard(), null);
});
