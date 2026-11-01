// A tab dragged out of one window lands in whichever other window the pointer
// is over (tabDrag.ts). The geometry is the part worth testing without a
// browser: which window wins, and when none does.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { containsPoint, pickDropWindow } from '@/lib/tabs/tabDrag';

const own = { left: 0, top: 0, right: 1280, bottom: 820 };
const main = { windowId: 'main', rect: { left: 1400, top: 0, right: 2680, bottom: 820 }, focusedAt: 5 };

test('a point is inside up to, not including, the right and bottom edges', () => {
  assert.equal(containsPoint(own, { x: 0, y: 0 }), true);
  assert.equal(containsPoint(own, { x: 1279, y: 819 }), true);
  assert.equal(containsPoint(own, { x: 1280, y: 400 }), false);
  assert.equal(containsPoint(own, { x: 400, y: 820 }), false);
});

test('over the window it came from, a tab lands nowhere else', () => {
  const behind = { ...main, rect: { left: 0, top: 0, right: 1920, bottom: 1080 } };
  assert.equal(pickDropWindow({ x: 600, y: 300 }, own, [behind]), null);
});

test('over another window, it lands there, and the last one focused wins where they overlap', () => {
  const point = { x: 2000, y: 300 };
  assert.equal(pickDropWindow(point, own, [main]), 'main');
  assert.equal(
    pickDropWindow(point, own, [
      { windowId: 'behind', rect: main.rect, focusedAt: 5 },
      { windowId: 'front', rect: main.rect, focusedAt: 9 },
      { windowId: 'elsewhere', rect: { left: 3000, top: 0, right: 4000, bottom: 800 }, focusedAt: 12 },
    ]),
    'front'
  );
});

test('the point decides: one past a window a moment ago is over none', () => {
  // The last frame had the pointer over the main window; the release is past its edge.
  assert.equal(pickDropWindow({ x: 2000, y: 300 }, own, [main]), 'main');
  assert.equal(pickDropWindow({ x: 2700, y: 300 }, own, [main]), null);
});

test('a window out of sight is never landed in, and with no place of its own any other one can be', () => {
  assert.equal(pickDropWindow({ x: 2000, y: 300 }, own, [{ ...main, rect: null }]), null);
  assert.equal(pickDropWindow({ x: 2000, y: 300 }, null, [main]), 'main');
});
