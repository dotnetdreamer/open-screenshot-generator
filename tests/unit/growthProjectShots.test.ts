// The open project in Competitors: which artboards show next to the apps
// followed, and what each one shows of the art that spans into it from its
// neighbours, worked out over the whole project as the export does.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { boardDevice, projectBoards } from '@/lib/growth/projectShots';
import { NO_SPILL, spillFor } from '@/lib/spanArtboards';
import type { ArtboardElement, ArtboardState, ShapeElementProps } from '@/types/artboard';

function board(id: string, elements: ArtboardElement[] = [], width = 1290, height = 2796): ArtboardState {
  return { id, name: id, position: { x: 0, y: 0 }, size: { width, height }, elements, backgroundColor: '#ffffff', zoom: 1 };
}

function shape(id: string, x: number, extra: Partial<ShapeElementProps> = {}): ShapeElementProps {
  return {
    id,
    type: 'shape',
    shapeType: 'rectangle',
    position: { x, y: 800 },
    size: { width: 600, height: 600 },
    rotation: 0,
    scale: 1,
    fill: '#000000',
    ...extra,
  } as ShapeElementProps;
}

test('art spanning into an empty artboard stays on that artboard, and the artboard shows', () => {
  // A's art reaches 300px into B, which has nothing of its own.
  const boards = [board('a', [shape('art', 990, { spanArtboards: true })]), board('b'), board('c', [shape('own', 100)])];
  const { boards: shown, spill } = projectBoards(boards, 'iphone');
  assert.deepEqual(shown.map((one) => one.id), ['a', 'b', 'c']);
  assert.equal(spillFor(spill, 'b').front.length, 1);
  assert.equal(spillFor(spill, 'c'), NO_SPILL, 'the next artboard shown does not get the art');
});

test('an artboard with nothing on it and nothing reaching it is left out, and the others keep their own art', () => {
  const boards = [board('a', [shape('art', 100)]), board('b'), board('c', [shape('own', 100)])];
  const result = projectBoards(boards, 'iphone');
  assert.equal(result.any, true);
  assert.deepEqual(result.boards.map((one) => one.id), ['a', 'c']);
  assert.equal(spillFor(result.spill, 'c'), NO_SPILL);
});

test('one device at a time, and a project with only empty artboards has nothing to show', () => {
  const boards = [board('phone', [shape('art', 100)]), board('tablet', [shape('art2', 100)], 2048, 2732)];
  assert.equal(boardDevice(boards[1]), 'ipad');
  assert.deepEqual(projectBoards(boards, 'iphone').boards.map((one) => one.id), ['phone']);
  assert.deepEqual(projectBoards(boards, 'ipad').boards.map((one) => one.id), ['tablet']);
  assert.equal(projectBoards([board('a'), board('b')], 'iphone').any, false);
});
