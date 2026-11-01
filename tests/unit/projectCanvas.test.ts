// The rules in src/lib/projectCanvas.ts: when work built in one render of the
// editor may still write to the canvas, which documents may open as a project,
// and when two documents are the same one. The layout's commit paths and the
// MCP line both ask the first; a change from a live session asks the last.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canOpenAsProject, canvasStillHolds, sameDocument } from '@/lib/projectCanvas';
import type { ArtboardState } from '@/types/artboard';

test('a render whose canvas holds the open project may write while nothing replaces it', () => {
  assert.equal(canvasStillHolds({ activeProjectId: 'proj_a', canvasProjectId: 'proj_a', serial: 3 }, 3), true);
  // A fresh editor with nothing saved yet: the first write creates the project.
  assert.equal(canvasStillHolds({ activeProjectId: null, canvasProjectId: null, serial: 0 }, 0), true);
});

test('a render made while a project opens may not write', () => {
  // A reload into ?projectId=, before the stored project has been read.
  assert.equal(canvasStillHolds({ activeProjectId: 'proj_a', canvasProjectId: null, serial: 0 }, 0), false);
  // Recent projects or a past chat picked another project, which is being read.
  assert.equal(canvasStillHolds({ activeProjectId: 'proj_b', canvasProjectId: 'proj_a', serial: 2 }, 2), false);
});

test('a render from before a document went onto the canvas may not write', () => {
  // The opened project is on the canvas, and the render still shows the one before.
  assert.equal(canvasStillHolds({ activeProjectId: 'proj_a', canvasProjectId: 'proj_a', serial: 2 }, 3), false);
  // The same project opened again replaces the document too.
  assert.equal(canvasStillHolds({ activeProjectId: 'proj_a', canvasProjectId: 'proj_a', serial: 4 }, 5), false);
  // The first write created a project; a second write from the same render
  // would create another from the state before the first.
  assert.equal(canvasStillHolds({ activeProjectId: null, canvasProjectId: null, serial: 0 }, 1), false);
});

test('only a document with an artboard opens as a project', () => {
  assert.equal(canOpenAsProject([]), false);
  assert.equal(canOpenAsProject(undefined), false);
  assert.equal(canOpenAsProject({ projectData: [] }), false);
  assert.equal(canOpenAsProject([{ id: 'ab_1', elements: [] }]), true);
});

test('two documents are the same when they say the same thing, whatever order their keys arrived in', () => {
  const board = {
    id: 'ab_1',
    name: 'One',
    size: { width: 1290, height: 2796 },
    position: { x: 0, y: 0 },
    elements: [{ id: 'el_1', type: 'shape', position: { x: 1, y: 2 }, size: { width: 3, height: 4 } }],
  } as unknown as ArtboardState;
  // As a live session's room hands it back: keys in another order, nothing
  // undefined, and placed again.
  const fromRoom = {
    elements: [{ size: { height: 4, width: 3 }, position: { y: 2, x: 1 }, type: 'shape', id: 'el_1' }],
    position: { x: 400, y: 0 },
    size: { height: 2796, width: 1290 },
    name: 'One',
    id: 'ab_1',
  } as unknown as ArtboardState;
  assert.equal(sameDocument([board], [{ ...fromRoom, backgroundColor: undefined } as unknown as ArtboardState]), true);

  assert.equal(sameDocument([board], [{ ...fromRoom, name: 'Two' }]), false);
  const moved = { ...fromRoom.elements[0], position: { x: 5, y: 2 } };
  assert.equal(sameDocument([board], [{ ...fromRoom, elements: [moved] }]), false);
  assert.equal(sameDocument([board], [{ ...fromRoom, elements: [...fromRoom.elements, moved] }]), false);
  assert.equal(sameDocument([board], [fromRoom, fromRoom]), false);
});
