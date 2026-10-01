// bundleFromJson reads the project file a person picked to import. A file whose
// projectData holds no artboards is refused, with the message the import shows,
// before anything is stored: the editor opens no project without an artboard.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bundleFromJson } from '@/lib/account/projectBundle';

const BOARD = {
  id: 'ab_1',
  name: 'Only board',
  position: { x: 0, y: 0 },
  size: { width: 1024, height: 500 },
  backgroundColor: '#ffffff',
  zoom: 1,
  elements: [],
};

test('a project file with no artboards is refused, with the message the import shows', () => {
  assert.throws(() => bundleFromJson({ id: 'proj_empty', name: 'Empty', projectData: [] }), {
    message: 'This file has no artboards, so there is nothing to import.',
  });
});

test('a project file with one artboard reads as before', () => {
  const bundle = bundleFromJson({ id: 'proj_one', name: 'One board', projectData: [BOARD] });
  assert.equal(bundle.manifest.name, 'One board');
  assert.equal(bundle.manifest.projectData.length, 1);
  assert.deepEqual(bundle.media, []);
});

test('a file with no artboard data at all keeps its own message', () => {
  assert.throws(() => bundleFromJson({ hello: 'world' }), {
    message: 'This file is missing its artboard data.',
  });
});
