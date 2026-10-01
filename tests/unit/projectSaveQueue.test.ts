// The debounced project write in src/lib/projectSaveQueue.ts. The rule these
// pin down: a waiting write is only ever replaced by a newer write of the same
// project. A write of another project, or another project going onto the
// canvas, writes it first, because those are the last edits of the project
// being left, and the editor already showed them as done.

import { afterEach, beforeEach, mock, test } from 'node:test';
import assert from 'node:assert/strict';
import { createProjectSaveQueue, PROJECT_SAVE_DELAY_MS, type ProjectSave } from '@/lib/projectSaveQueue';
import type { ArtboardState } from '@/types/artboard';

/** A save of `id` whose one artboard holds `elements` elements. */
function save(id: string, elements: number): ProjectSave {
  const board = { id: `ab_${id}`, elements: Array.from({ length: elements }, (_, i) => ({ id: `el_${i}` })) };
  return { id, name: `Project ${id}`, artboards: [board as unknown as ArtboardState] };
}

/** The writes so far, as `<id>:<element count>`. */
function recorder() {
  const written: string[] = [];
  const queue = createProjectSaveQueue(async (row) => {
    written.push(`${row.id}:${row.artboards[0].elements.length}`);
  });
  return { written, queue };
}

beforeEach(() => mock.timers.enable({ apis: ['setTimeout'] }));
afterEach(() => mock.timers.reset());

test('a save is written once the edits go quiet, and a newer save of the same project replaces it', () => {
  const { written, queue } = recorder();
  queue.schedule(save('a', 1));
  mock.timers.tick(PROJECT_SAVE_DELAY_MS - 100);
  queue.schedule(save('a', 2));
  mock.timers.tick(PROJECT_SAVE_DELAY_MS - 1);
  assert.deepEqual(written, []);
  mock.timers.tick(1);
  assert.deepEqual(written, ['a:2']);
  mock.timers.tick(PROJECT_SAVE_DELAY_MS * 2);
  assert.deepEqual(written, ['a:2']);
});

test('a save of another project writes the one waiting first', () => {
  const { written, queue } = recorder();
  queue.schedule(save('a', 4));
  // The project opened next is edited before the first one's delay is up.
  queue.schedule(save('b', 1));
  assert.deepEqual(written, ['a:4']);
  mock.timers.tick(PROJECT_SAVE_DELAY_MS);
  assert.deepEqual(written, ['a:4', 'b:1']);
});

test('another project going onto the canvas writes the save waiting for the one before', () => {
  const { written, queue } = recorder();
  queue.schedule(save('a', 4));
  void queue.flushOtherThan('a');
  assert.deepEqual(written, [], 'the same project stays on the canvas, so its save keeps waiting');
  void queue.flushOtherThan('b');
  assert.deepEqual(written, ['a:4']);
  mock.timers.tick(PROJECT_SAVE_DELAY_MS * 2);
  assert.deepEqual(written, ['a:4'], 'written once, and the timer is gone');
});

test('drop forgets the save of that project only', () => {
  const { written, queue } = recorder();
  queue.schedule(save('a', 2));
  queue.drop('b');
  mock.timers.tick(PROJECT_SAVE_DELAY_MS);
  assert.deepEqual(written, ['a:2']);

  queue.schedule(save('a', 3));
  queue.drop('a');
  mock.timers.tick(PROJECT_SAVE_DELAY_MS * 2);
  assert.deepEqual(written, ['a:2']);
});

test('flush writes the waiting save at once, and only once', async () => {
  const { written, queue } = recorder();
  await queue.flush();
  assert.deepEqual(written, []);
  queue.schedule(save('a', 5));
  await queue.flush();
  assert.deepEqual(written, ['a:5']);
  await queue.flush();
  mock.timers.tick(PROJECT_SAVE_DELAY_MS * 2);
  assert.deepEqual(written, ['a:5']);
});
