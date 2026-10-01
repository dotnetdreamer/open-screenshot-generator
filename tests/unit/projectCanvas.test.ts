// The two rules in src/lib/projectCanvas.ts: when work built in one render of
// the editor may still write to the canvas, and which documents may open as a
// project. The layout's commit paths and the MCP line both ask the first.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canOpenAsProject, canvasStillHolds } from '@/lib/projectCanvas';

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
