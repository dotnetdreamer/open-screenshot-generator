// The id and name `osg edit` and `osg call --save` write a project file back
// with (cli/src/projectIdentity.ts). The file keeps its own id, and its own
// name unless a tool renamed the project during the run. A file with no
// artboards never opens, so the editor starts a project of its own with the
// first artboard, under a generated id and a random name, and neither may
// reach the file.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { followEditorProject, writeBackIdentity, type EditorProject } from '../../cli/src/projectIdentity';

const file = { id: 'proj_cli_empty', name: 'Empty From Disk' };
const opened: EditorProject = { projectId: file.id, projectName: file.name };
const fresh: EditorProject = { projectId: null, projectName: 'Untitled Project' };
const started: EditorProject = { projectId: '1790878968492', projectName: 'Bold Board 833' };

/** Follow the editor through the status() seen after each call, from `start`. */
function follow(start: EditorProject | null, statuses: EditorProject[]): EditorProject | null {
  return statuses.reduce<EditorProject | null>((followed, now) => followEditorProject(followed, now), start);
}

test('an opened file keeps its id and name when no tool renamed it', () => {
  const followed = follow(opened, [opened, opened]);
  assert.deepEqual(writeBackIdentity(file, followed, opened), file);
});

test('an opened file takes the name a tool gave its project', () => {
  const renamed = { projectId: file.id, projectName: 'Droply screenshots' };
  const followed = follow(opened, [opened, renamed]);
  assert.deepEqual(writeBackIdentity(file, followed, renamed), { id: file.id, name: 'Droply screenshots' });
  // osg call follows nothing past the open: one call, compared with the file.
  assert.deepEqual(writeBackIdentity(file, opened, renamed), { id: file.id, name: 'Droply screenshots' });
});

test('a file with no artboards keeps its id and name when the first artboard starts a project', () => {
  // osg call: the file never opened, so nothing was followed.
  assert.deepEqual(writeBackIdentity(file, null, started), file);
  // osg edit: create_artboard, then add_element, each followed by status().
  const followed = follow(null, [started, started]);
  assert.deepEqual(followed, started);
  assert.deepEqual(writeBackIdentity(file, followed, started), file);
});

test('a file with no artboards takes a rename made after its first artboard', () => {
  const renamed = { projectId: started.projectId, projectName: 'Droply screenshots' };
  const followed = follow(null, [started, renamed]);
  assert.deepEqual(writeBackIdentity(file, followed, renamed), { id: file.id, name: 'Droply screenshots' });
});

test('a project the editor moves to brings its own name, which is not a rename', () => {
  // create_project_from_template while the file was open.
  const template = { projectId: 'project_1790878970000', projectName: 'Fitness Pro' };
  const followed = follow(opened, [template]);
  assert.deepEqual(writeBackIdentity(file, followed, template), file);
});

test('an editor that never had a project leaves the file as it was', () => {
  const followed = follow(null, [fresh, fresh]);
  assert.equal(followed, null);
  assert.deepEqual(writeBackIdentity(file, followed, fresh), file);
});
