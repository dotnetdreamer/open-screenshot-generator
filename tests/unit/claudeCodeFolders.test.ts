// Code folders on a Claude Code chat: the rules the store follows when a
// folder is added, removed or goes missing, and how a picture from one is
// sized. The store itself needs Tauri and IndexedDB, so its decisions live in
// folders.ts, where node can reach them.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FOLDERS_CHANGED_NOTE,
  FOLDERS_REMOVED_NOTE,
  MAX_FOLDERS,
  alreadyAddedNotice,
  folderChangeNote,
  folderLabels,
  folderNameOf,
  folderPaths,
  folderRelativePath,
  hasUnreadFolder,
  missingFolderNotice,
  sameFolderSet,
  sanitizeFolders,
  sanitizePaths,
  savedRanFolders,
  savedReadFolders,
  unreferencedPaths,
} from '@/lib/claudeCode/folders';
import { projectImageMimeType, svgIntrinsicSize } from '@/lib/claudeCode/projectImages';

const ios = { name: 'ios', path: '/Users/me/code/marbly/ios' };
const android = { name: 'android', path: '/Users/me/code/marbly/android' };
const web = { name: 'web', path: '/Users/me/code/marbly/web' };

test('a stored folder list comes back well formed, one per path, three at most', () => {
  assert.deepEqual(sanitizeFolders(undefined), []);
  assert.deepEqual(sanitizeFolders('nope'), []);
  const four = [ios, { ...ios, name: 'again' }, { name: '', path: 'C:\\code\\Marbly\\' }, android, web, { path: 42 }, null];
  const kept = sanitizeFolders(four);
  assert.equal(kept.length, MAX_FOLDERS);
  assert.deepEqual(kept[0], ios);
  // A folder with no name takes the last part of its path.
  assert.deepEqual(kept[1], { name: 'Marbly', path: 'C:\\code\\Marbly\\' });
  assert.deepEqual(kept[2], android);
  assert.deepEqual(sanitizeFolders([{ name: 'x', path: `/${'a'.repeat(2000)}` }]), []);

  assert.equal(sanitizePaths(undefined), null);
  assert.deepEqual(sanitizePaths(['/b', '/a', '/b', 7, '']), ['/a', '/b']);
});

test('a process restarts only when its folder set changes, whatever the order', () => {
  assert.deepEqual(folderPaths([web, ios]), [ios.path, web.path]);
  assert.equal(sameFolderSet([ios.path, web.path], folderPaths([web, ios])), true);
  assert.equal(sameFolderSet([], []), true);
  assert.equal(sameFolderSet([ios.path], [ios.path, web.path]), false);
  assert.equal(sameFolderSet([android.path], [ios.path]), false);
  // A process whose folders nobody knows is never taken to have the right ones.
  assert.equal(sameFolderSet(null, []), false);
  assert.equal(sameFolderSet(null, [ios.path]), false);
});

test('the agent hears about a folder change once, and never on a first turn', () => {
  // A conversation's first turn: the instructions already list the folders.
  assert.equal(folderChangeNote(null, [ios.path], false), null);
  assert.equal(folderChangeNote([], [ios.path], false), null);
  // Same folders as last time.
  assert.equal(folderChangeNote([ios.path], [ios.path], true), null);
  assert.equal(folderChangeNote([], [], true), null);
  // Added, swapped, or one of two removed.
  assert.equal(folderChangeNote([], [ios.path], true), FOLDERS_CHANGED_NOTE);
  assert.equal(folderChangeNote([ios.path], [android.path], true), FOLDERS_CHANGED_NOTE);
  assert.equal(folderChangeNote([ios.path, android.path], [android.path], true), FOLDERS_CHANGED_NOTE);
  // All gone: removed by the user, or started without the last one.
  assert.equal(folderChangeNote([ios.path], [], true), FOLDERS_REMOVED_NOTE);
  // A chat this page never ran (reopened, or after a reload) with folders.
  assert.equal(folderChangeNote(null, [ios.path], true), FOLDERS_CHANGED_NOTE);
  assert.equal(folderChangeNote(null, [], true), null);
  assert.equal(FOLDERS_CHANGED_NOTE, "The user's app folders changed. Your instructions list the folders you can read now.");
  assert.equal(FOLDERS_REMOVED_NOTE, 'The user removed their app folders, so you can no longer read them.');
});

test('a folder the agent was not started with lets an empty message go', () => {
  assert.equal(hasUnreadFolder([], null), false);
  assert.equal(hasUnreadFolder([ios], null), true);
  assert.equal(hasUnreadFolder([ios], [ios.path]), false);
  assert.equal(hasUnreadFolder([ios, web], [ios.path]), true);
  // A removal leaves nothing new to read.
  assert.equal(hasUnreadFolder([ios], [ios.path, android.path]), false);
});

test('a folder that went missing is named in the transcript', () => {
  assert.equal(
    missingFolderNotice({ name: 'Marbly', path: '/x/Marbly' }),
    'The agent can no longer read the Marbly folder. Add it again if you still want it used'
  );
  assert.equal(alreadyAddedNotice('ios/app'), 'ios/app is already added');
});

test('a saved chat comes back knowing what it ran with and whether it read a folder', () => {
  // A chat that never ran a turn has run with nothing yet, whatever it holds.
  assert.equal(savedRanFolders(null, [ios.path], [ios]), null);
  assert.deepEqual(savedRanFolders('s1', [web.path, ios.path], [ios]), [ios.path, web.path]);
  // Saved before the set was kept: taken to have run with its folders.
  assert.deepEqual(savedRanFolders('s1', undefined, [web, ios]), [ios.path, web.path]);
  assert.deepEqual(savedRanFolders('s1', 'junk', []), []);

  assert.equal(savedReadFolders(true, []), true);
  assert.equal(savedReadFolders(false, [ios]), false);
  // Saved before the flag: a chat with folders may have read them.
  assert.equal(savedReadFolders(undefined, [ios]), true);
  assert.equal(savedReadFolders(undefined, []), false);
});

test('Rust forgets a folder only once no chat holds it', () => {
  assert.deepEqual(unreferencedPaths([ios.path, web.path], [[ios], undefined, [android]]), [web.path]);
  assert.deepEqual(unreferencedPaths([ios.path, ios.path], [[]]), [ios.path]);
  assert.deepEqual(unreferencedPaths([], [[ios]]), []);
});

test('a path inside a folder reads from that folder on', () => {
  const folders = [{ name: 'Marbly', path: 'C:\\Users\\me\\code\\Marbly' }, ios];
  assert.equal(folderRelativePath('C:\\Users\\me\\code\\Marbly\\android\\app\\build.gradle', folders), 'android/app/build.gradle');
  assert.equal(folderRelativePath('C:/Users/Me/Code/marbly/README.md', folders), 'README.md');
  assert.equal(folderRelativePath('/Users/me/code/marbly/ios/Info.plist', folders), 'Info.plist');
  // A sibling that only starts with the folder's name is not inside it.
  assert.equal(folderRelativePath('C:\\Users\\me\\code\\Marbly2\\x.txt', folders), null);
  assert.equal(folderRelativePath('C:\\Users\\me\\code\\Marbly', folders), null);
  assert.equal(folderRelativePath('/etc/hosts', folders), null);
  assert.equal(folderNameOf('C:\\code\\Marbly\\'), 'Marbly');
  assert.equal(folderNameOf('/Users/me/icon.png'), 'icon.png');
});

test('two folders of one name are told apart by their parent', () => {
  const app = (parent: string) => ({ name: 'app', path: `/Users/me/code/${parent}/app` });
  assert.deepEqual(folderLabels([app('ios'), app('android'), web]), ['ios/app', 'android/app', 'web']);
  assert.deepEqual(folderLabels([ios, web]), ['ios', 'web']);
  assert.deepEqual(folderLabels([{ name: 'App', path: 'C:\\a\\App' }, { name: 'app', path: 'C:\\b\\app' }]), ['a/App', 'b/app']);
});

test('only the five picture types are imported, by extension', () => {
  assert.equal(projectImageMimeType('/code/Marbly/icon.PNG'), 'image/png');
  assert.equal(projectImageMimeType('C:\\code\\Marbly\\shot.jpeg'), 'image/jpeg');
  assert.equal(projectImageMimeType('/a/b.jpg'), 'image/jpeg');
  assert.equal(projectImageMimeType('/a/b.webp'), 'image/webp');
  assert.equal(projectImageMimeType('/a/b.gif'), 'image/gif');
  assert.equal(projectImageMimeType('/a/logo.svg'), 'image/svg+xml');
  assert.equal(projectImageMimeType('/a/ic_launcher.xml'), null);
  assert.equal(projectImageMimeType('/a/AppIcon.pdf'), null);
  assert.equal(projectImageMimeType('/a/.png/README'), null);
  assert.equal(projectImageMimeType('/a/noextension'), null);
});

test('an SVG is sized from its own attributes, since a probe cannot size every one', () => {
  assert.deepEqual(svgIntrinsicSize('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="48"></svg>'), {
    width: 120,
    height: 48,
  });
  assert.deepEqual(svgIntrinsicSize("<?xml version='1.0'?>\n<svg width='64px' height='32px'>"), { width: 64, height: 32 });
  // Percentages say nothing about pixels, so the viewBox decides.
  assert.deepEqual(svgIntrinsicSize('<svg width="100%" height="100%" viewBox="0 0 1024 512">'), { width: 1024, height: 512 });
  assert.deepEqual(svgIntrinsicSize('<svg viewBox="0,0,24,24" stroke-width="2">'), { width: 24, height: 24 });
  // stroke-width is not width.
  assert.equal(svgIntrinsicSize('<svg stroke-width="2" fill="none">'), null);
  assert.equal(svgIntrinsicSize('<svg viewBox="0 0 0 10">'), null);
  assert.equal(svgIntrinsicSize('not an svg at all'), null);
});
