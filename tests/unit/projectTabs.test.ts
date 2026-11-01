// Project tabs: the list model, the parking lot's sleep rules, the undo stacks
// kept on disk, the stored session, the tab summary and the transfer of layers
// between projects. The canvas side (park on leave, restore on return) is
// covered by tests/e2e/specs/project-tabs.spec.ts.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cycleTab,
  moveTab,
  nextActiveAfterClose,
  openTab,
  otherTabIds,
  rememberClosed,
  removeTab,
  reopenAt,
  tabForNumber,
  tabIdsRightOf,
  updateTab,
  MAX_CLOSED_TABS,
  type ProjectTab,
} from '@/lib/tabs/tabModel';
import {
  createParkingLot,
  DEFAULT_PARKING_BUDGET,
  parkedBytes,
  type ParkedProject,
  type SleepReason,
} from '@/lib/tabs/parking';
import { parseSession, serializeSession } from '@/lib/tabs/session';
import { sameSummary, summarizeProject } from '@/lib/tabs/summary';
import type { HistoryEntry } from '@/lib/historyLabels';
import type { ArtboardState } from '@/types/artboard';

const tab = (projectId: string, extra: Partial<ProjectTab> = {}): ProjectTab => ({
  projectId,
  name: projectId.toUpperCase(),
  lastActiveAt: 0,
  ...extra,
});
const ids = (tabs: ProjectTab[]) => tabs.map((entry) => entry.projectId);

test('a project opens in a tab right after the one it was opened from', () => {
  const { tabs, replaced } = openTab([tab('a'), tab('b'), tab('c')], 'x', { fromProjectId: 'a', name: 'X' });
  assert.deepEqual(ids(tabs), ['a', 'x', 'b', 'c']);
  assert.equal(replaced, null);
  assert.equal(tabs[1].name, 'X');
});

test('the + button puts the new tab last, even after a preview', () => {
  const { tabs, replaced } = openTab([tab('a', { preview: true }), tab('b')], 'x', {
    fromProjectId: 'a',
    forceNew: true,
  });
  assert.deepEqual(ids(tabs), ['a', 'b', 'x']);
  assert.equal(replaced, null);
});

test('a project opened from a preview tab takes its place', () => {
  const { tabs, replaced } = openTab([tab('a'), tab('p', { preview: true }), tab('b')], 'x', {
    fromProjectId: 'p',
    preview: true,
  });
  assert.deepEqual(ids(tabs), ['a', 'x', 'b']);
  assert.equal(replaced, 'p');
  assert.equal(tabs[1].preview, true);
});

test('opening a project that already has a tab adds nothing', () => {
  const start = [tab('a'), tab('b', { preview: true })];
  const { tabs, replaced } = openTab(start, 'a', { fromProjectId: 'b', name: 'Renamed' });
  assert.deepEqual(ids(tabs), ['a', 'b']);
  assert.equal(replaced, null, 'the preview survives switching to a tab that exists');
  assert.equal(tabs[0].name, 'Renamed');
});

test('with no tab to open from, the project goes last', () => {
  assert.deepEqual(ids(openTab([tab('a')], 'x', { fromProjectId: null }).tabs), ['a', 'x']);
  assert.deepEqual(ids(openTab([], 'x', { fromProjectId: 'gone' }).tabs), ['x']);
});

test('closing the active tab hands over to its right, then its left', () => {
  const tabs = [tab('a'), tab('b'), tab('c')];
  assert.equal(nextActiveAfterClose(tabs, 'b', 'b'), 'c');
  assert.equal(nextActiveAfterClose(tabs, 'c', 'c'), 'b');
  assert.equal(nextActiveAfterClose([tab('a')], 'a', 'a'), null);
  assert.equal(nextActiveAfterClose(tabs, 'a', 'c'), 'c', 'closing another tab keeps the active one');
});

test('remove, move, close others and close to the right', () => {
  const tabs = [tab('a'), tab('b'), tab('c'), tab('d')];
  assert.deepEqual(ids(removeTab(tabs, 'b')), ['a', 'c', 'd']);
  assert.equal(removeTab(tabs, 'zz'), tabs, 'an unknown id changes nothing');
  assert.deepEqual(ids(moveTab(tabs, 'a', 2)), ['b', 'c', 'a', 'd']);
  assert.deepEqual(ids(moveTab(tabs, 'd', 0)), ['d', 'a', 'b', 'c']);
  assert.deepEqual(ids(moveTab(tabs, 'b', 99)), ['a', 'c', 'd', 'b'], 'clamped to the end');
  assert.equal(moveTab(tabs, 'c', 2), tabs, 'moving onto itself returns the same list');
  assert.deepEqual(otherTabIds(tabs, 'c'), ['a', 'b', 'd']);
  assert.deepEqual(tabIdsRightOf(tabs, 'b'), ['c', 'd']);
  assert.deepEqual(tabIdsRightOf(tabs, 'd'), []);
});

test('cycling wraps, and the number keys follow the browser convention', () => {
  const tabs = [tab('a'), tab('b'), tab('c')];
  assert.equal(cycleTab(tabs, 'c', 1), 'a');
  assert.equal(cycleTab(tabs, 'a', -1), 'c');
  assert.equal(cycleTab(tabs, null, 1), 'a');
  assert.equal(cycleTab([], 'a', 1), null);
  assert.equal(tabForNumber(tabs, 2), 'b');
  assert.equal(tabForNumber(tabs, 9), 'c', '9 is always the last tab');
  assert.equal(tabForNumber(tabs, 5), null);
});

test('updateTab returns the same list when nothing changes, and drops a false preview', () => {
  const tabs = [tab('a', { preview: true })];
  assert.equal(updateTab(tabs, 'a', { name: 'A' }), tabs);
  const edited = updateTab(tabs, 'a', { preview: false });
  assert.notEqual(edited, tabs);
  assert.equal('preview' in edited[0], false);
});

test('closed tabs are newest first, once each, and capped', () => {
  let closed = rememberClosed([], { projectId: 'a', name: 'A', index: 0, closedAt: 1 });
  closed = rememberClosed(closed, { projectId: 'b', name: 'B', index: 1, closedAt: 2 });
  closed = rememberClosed(closed, { projectId: 'a', name: 'A', index: 3, closedAt: 3 });
  assert.deepEqual(closed.map((entry) => entry.projectId), ['a', 'b']);
  assert.equal(closed[0].index, 3);
  for (let i = 0; i < 20; i++) closed = rememberClosed(closed, { projectId: `p${i}`, name: '', index: 0, closedAt: i });
  assert.equal(closed.length, MAX_CLOSED_TABS);
  const reopened = reopenAt([tab('x'), tab('y')], { projectId: 'r', name: 'R', index: 1, closedAt: 0 });
  assert.deepEqual(ids(reopened), ['x', 'r', 'y']);
  assert.deepEqual(ids(reopenAt([tab('x')], { projectId: 'r', name: 'R', index: 9, closedAt: 0 })), ['x', 'r']);
});

// ---------------------------------------------------------------- parking lot

const board = (id: string): ArtboardState => ({
  id,
  name: id,
  position: { x: 0, y: 0 },
  size: { width: 100, height: 200 },
  elements: [],
  backgroundColor: '#ffffff',
  zoom: 1,
});

const entry = (bytes: number, label = 'Edit'): HistoryEntry => ({
  id: `h_${label}_${bytes}_${Math.random()}`,
  label,
  icon: 'edit',
  mergeKey: null,
  timestamp: 0,
  artboards: [],
  bytes,
});

function parked(projectId: string, parkedAt: number, steps: number, bytesPerStep = 1000): ParkedProject {
  const history = Array.from({ length: steps }, (_, i) => entry(bytesPerStep, `step${i}`));
  return {
    projectId,
    name: projectId,
    artboards: [board(`${projectId}_1`)],
    history,
    historyIndex: history.length - 1,
    selectedElementIds: [],
    openedSnapshot: null,
    parkedAt,
  };
}

test('parking moves the document by reference and take hands the same objects back', () => {
  const lot = createParkingLot();
  const project = parked('a', 1, 3);
  lot.park(project);
  assert.equal(lot.has('a'), true);
  const back = lot.take('a');
  assert.equal(back?.artboards, project.artboards, 'not a copy');
  assert.equal(back?.history.length, 3);
  assert.equal(lot.has('a'), false, 'take removes it');
  assert.equal(lot.take('a'), null);
});

const HOUR = 60 * 60 * 1000;
const roomy = { maxBytes: Infinity, maxProjects: 100, sleepAfterMs: HOUR };

test('a parked tab keeps its whole undo history, however many tabs are open', () => {
  const lot = createParkingLot(roomy);
  for (let i = 0; i < 30; i += 1) lot.park(parked(`p${i}`, i, 50));
  assert.equal(lot.ids().length, 30);
  for (const id of lot.ids()) assert.equal(lot.peek(id)?.history.length, 50, `${id} untrimmed`);
});

test('a tab sleeps an hour after it was left, and onSleep gets all it held', () => {
  const slept: Array<{ project: ParkedProject; reason: SleepReason }> = [];
  const lot = createParkingLot(roomy, (project, reason) => slept.push({ project, reason }));
  const early = parked('early', 1_000, 7);
  lot.park(early);
  lot.park(parked('late', 1_000 + 30 * 60 * 1000, 2));
  assert.equal(lot.nextSleepAt(), 1_000 + HOUR);
  lot.sweep(1_000 + HOUR - 1);
  assert.equal(slept.length, 0, 'not a moment early');
  lot.sweep(1_000 + HOUR);
  assert.deepEqual(lot.ids(), ['late']);
  assert.equal(slept.length, 1);
  assert.equal(slept[0].project, early, 'the same object, undo stack and all, for its last save');
  assert.equal(slept[0].project.history.length, 7);
  assert.equal(slept[0].reason, 'idle');
  assert.equal(lot.nextSleepAt(), 1_000 + 30 * 60 * 1000 + HOUR);
});

test('the default budget keeps a tab for an hour', () => {
  assert.equal(DEFAULT_PARKING_BUDGET.sleepAfterMs, HOUR);
});

test('past maxProjects the tabs left longest ago sleep, and are told about', () => {
  const slept: string[] = [];
  const lot = createParkingLot({ ...roomy, maxProjects: 2 }, (project, reason) => {
    assert.equal(reason, 'memory');
    slept.push(project.projectId);
  });
  lot.park(parked('a', 1, 1));
  lot.park(parked('b', 2, 1));
  lot.park(parked('c', 3, 1));
  assert.deepEqual(lot.ids(), ['c', 'b']);
  assert.deepEqual(slept, ['a']);
});

test('over the byte budget the oldest tabs sleep whole, never trimmed', () => {
  // Each project: 4 steps of 1000 bytes plus its current state counted again.
  const slept: ParkedProject[] = [];
  const lot = createParkingLot({ ...roomy, maxBytes: 9_000 }, (project) => slept.push(project));
  lot.park(parked('a', 1, 4));
  assert.equal(lot.bytes(), 5_000);
  lot.park(parked('b', 2, 4));
  assert.deepEqual(lot.ids(), ['b'], '10,000 is over 9,000, so the older one sleeps');
  assert.equal(lot.peek('b')?.history.length, 4);
  assert.equal(slept[0].history.length, 4, 'with its whole history, to be written to disk');
});

test('take and drop are not sleep', () => {
  const slept: string[] = [];
  const lot = createParkingLot(roomy, (project) => slept.push(project.projectId));
  lot.park(parked('a', 1, 1));
  lot.park(parked('b', 1, 1));
  lot.take('a');
  lot.drop('b');
  lot.sweep(10 * HOUR);
  assert.deepEqual(slept, []);
  assert.equal(lot.nextSleepAt(), null);
});

test('parkedBytes counts the current state twice', () => {
  assert.equal(parkedBytes(parked('a', 1, 3, 100)), 400);
});

test('update changes a parked project in place and reports a miss', () => {
  const lot = createParkingLot();
  lot.park(parked('a', 1, 1));
  const changed = lot.update('a', (project) => ({ ...project, name: 'Renamed' }));
  assert.equal(changed, true);
  assert.equal(lot.peek('a')?.name, 'Renamed');
  assert.equal(lot.update('nope', (project) => project), false);
});

// -------------------------------------------------------------------- session

test('a session survives a round trip', () => {
  const session = {
    tabs: [
      tab('a', {
        preview: true,
        summary: { artboards: 3, width: 1290, height: 2796, accent: '#123456', languages: 2 },
        view: { activeArtboardId: 'ab1', zoom: 0.8, scroll: { left: 10, top: 20 }, locale: 'de-DE' },
      }),
      tab('b'),
    ],
    activeProjectId: 'b',
    closed: [{ projectId: 'c', name: 'C', index: 1, closedAt: 5 }],
  };
  const back = parseSession(serializeSession(session));
  assert.deepEqual(back, session);
});

test('a damaged session is cleaned up rather than trusted', () => {
  assert.equal(parseSession(null), null);
  assert.equal(parseSession('not json'), null);
  assert.equal(parseSession(JSON.stringify({ v: 99, tabs: [] })), null, 'an unknown version is ignored');
  const back = parseSession(
    JSON.stringify({
      v: 1,
      tabs: [
        { projectId: 'a', name: 'A', lastActiveAt: 1, view: { zoom: -1 } },
        { projectId: 'a', name: 'duplicate' },
        { projectId: '' },
        null,
        { projectId: 'b', name: 42, summary: { artboards: 'x' } },
      ],
      activeProjectId: 'missing',
      closed: [{ projectId: 'c' }, { nope: true }],
    })
  );
  assert.deepEqual(back?.tabs.map((entry) => entry.projectId), ['a', 'b']);
  assert.equal(back?.tabs[0].view, undefined, 'a zoom of -1 is not a view');
  assert.equal(back?.tabs[1].name, '');
  assert.equal(back?.tabs[1].summary, undefined);
  assert.equal(back?.activeProjectId, null, 'an active id with no tab is dropped');
  assert.deepEqual(back?.closed, [{ projectId: 'c', name: '', index: 0, closedAt: 0 }]);
});

// -------------------------------------------------------------------- summary

test('the summary reads the first artboard and counts the rest', () => {
  const gradient: ArtboardState = {
    ...board('g'),
    size: { width: 1290, height: 2796 },
    backgroundType: 'gradient',
    backgroundGradient: { color1: '#ff0000', color2: '#0000ff', angle: 90 },
  };
  const summary = summarizeProject([gradient, board('b')]);
  assert.equal(summary.artboards, 2);
  assert.equal(summary.width, 1290);
  assert.match(summary.accent, /linear-gradient\(90deg, #ff0000, #0000ff\)/);
  assert.equal(summarizeProject([board('solid')]).accent, '#ffffff');
  assert.equal(summarizeProject([]).artboards, 0);
  assert.equal(sameSummary(summary, { ...summary }), true);
  assert.equal(sameSummary(summary, { ...summary, artboards: 3 }), false);
});

// ------------------------------------------------------------------- transfer

import { pickElements, placeElements, removeElements } from '@/lib/tabs/transfer';
import type { ArtboardElement } from '@/types/artboard';

const rect = (id: string, x: number, y: number, extra: Record<string, unknown> = {}): ArtboardElement =>
  ({
    id,
    type: 'shape',
    shapeType: 'rectangle',
    position: { x, y },
    size: { width: 100, height: 50 },
    rotation: 0,
    scale: 1,
    fillColor: '#000000',
    strokeColor: '#000000',
    strokeWidth: 0,
    ...extra,
  }) as unknown as ArtboardElement;

function sourceBoard(): ArtboardState {
  return {
    ...board('src'),
    size: { width: 1000, height: 2000 },
    elements: [rect('a', 100, 100, { groupId: 'g1' }), rect('b', 300, 100, { groupId: 'g1' }), rect('c', 500, 900)],
    localized: {
      'de-DE': { a: { hidden: true, position: { x: 110, y: 120 } }, c: { hidden: true } },
      ja: { b: { hidden: true } },
    },
  };
}

test('picking copies the elements in stacking order, with their translations', () => {
  const source = sourceBoard();
  const transfer = pickElements(source, ['c', 'a']);
  assert.ok(transfer);
  assert.deepEqual(transfer.elements.map((element) => element.id), ['a', 'c'], 'board order, not selection order');
  assert.notEqual(transfer.elements[0], source.elements[0], 'a copy');
  assert.deepEqual(Object.keys(transfer.localized['de-DE']).sort(), ['a', 'c']);
  assert.equal(transfer.localized.ja, undefined, 'b was not picked, so neither is its Japanese');
  assert.equal(pickElements(source, ['nope']), null);
});

import { stillHolds } from '@/lib/tabs/transfer';

test('a move takes layers out only while they are as they were picked', () => {
  const source = sourceBoard();
  const picked = pickElements(source, ['a', 'c'])!;
  const withElement = (id: string, change: Record<string, unknown>): ArtboardState => ({
    ...source,
    elements: source.elements.map((element) => (element.id === id ? ({ ...element, ...change } as ArtboardElement) : element)),
  });
  // The same layers, built again by a commit with their keys in another order.
  const rebuilt: ArtboardState = {
    ...source,
    elements: source.elements.map(
      (element) => Object.fromEntries(Object.entries(element).reverse()) as unknown as ArtboardElement
    ),
  };
  assert.equal(stillHolds(rebuilt, picked), true);
  // One of them edited, one of its translations edited, or one of them gone.
  assert.equal(stillHolds(withElement('a', { position: { x: 1, y: 1 } }), picked), false);
  const german = { ...source.localized!['de-DE'], c: { hidden: false } };
  assert.equal(stillHolds({ ...source, localized: { ...source.localized, 'de-DE': german } }, picked), false);
  assert.equal(stillHolds({ ...source, elements: source.elements.filter((element) => element.id !== 'c') }, picked), false);
  // A layer that is not moving can change all it likes.
  assert.equal(stillHolds(withElement('b', { fillColor: '#ffffff' }), picked), true);
});

test('placing keeps the set where it was relative to the artboard, with fresh ids and one new group', () => {
  const transfer = pickElements(sourceBoard(), ['a', 'b'])!;
  let n = 0;
  const target: ArtboardState = { ...board('dst'), size: { width: 2000, height: 1000 }, elements: [rect('x', 0, 0)] };
  const { board: placed, placedIds } = placeElements(target, transfer, {
    locales: new Set(['de-DE']),
    newId: () => `new${++n}`,
  });
  assert.deepEqual(placedIds, ['new1', 'new2']);
  assert.deepEqual(placed.elements.map((element) => element.id), ['x', 'new1', 'new2'], 'on top of what was there');
  // The pair spans x 100..400 (centre 250 of 1000) and y 100..150 (centre 125 of
  // 2000), so on a 2000 x 1000 board its centre lands at (500, 62.5).
  const [first, second] = placed.elements.slice(1);
  assert.deepEqual(first.position, { x: 350, y: 37.5 });
  assert.deepEqual(second.position, { x: 550, y: 37.5 });
  assert.equal(first.groupId, second.groupId, 'still one group');
  assert.notEqual(first.groupId, 'g1', 'but not the old one');
  // German came along, moved with its element; Japanese was not asked for.
  assert.deepEqual(placed.localized?.['de-DE']?.new1, { hidden: true, position: { x: 360, y: 57.5 } });
  assert.equal(placed.localized?.ja, undefined);
});

test('a drop point centres the set there, and nothing is pushed off the artboard', () => {
  const transfer = pickElements(sourceBoard(), ['c'])!;
  const target: ArtboardState = { ...board('dst'), size: { width: 400, height: 400 }, elements: [] };
  const at = placeElements(target, transfer, { at: { x: 200, y: 200 }, locales: new Set(), newId: () => 'n' });
  assert.deepEqual(at.board.elements[0].position, { x: 150, y: 175 });
  const corner = placeElements(target, transfer, { at: { x: 399, y: 0 }, locales: new Set(), newId: () => 'n' });
  assert.deepEqual(corner.board.elements[0].position, { x: 300, y: 0 }, 'clamped inside');
});

test('a layer taken without the rest of its group arrives as a layer of its own', () => {
  const source = sourceBoard();
  source.elements = source.elements.map((element) =>
    element.groupId ? ({ ...element, groupName: 'Badges' } as ArtboardElement) : element
  );
  const target: ArtboardState = { ...board('dst'), size: { width: 1000, height: 2000 }, elements: [] };
  const alone = placeElements(target, pickElements(source, ['a'])!, { locales: new Set(), newId: () => 'n' });
  const [element] = alone.board.elements;
  // Gone as keys, not set to undefined: Dexie would store those.
  assert.equal('groupId' in element, false);
  assert.equal('groupName' in element, false);

  const pair = placeElements(target, pickElements(source, ['a', 'b', 'c'])!, { locales: new Set() });
  const [first, second, third] = pair.board.elements;
  assert.ok(first.groupId);
  assert.equal(first.groupId, second.groupId);
  assert.equal(first.groupName, 'Badges', 'a whole group keeps its name');
  assert.equal('groupId' in third, false, 'c was never grouped');
});

test('a point or an offset is about where the language on screen draws the set', () => {
  // German draws the rectangle 200 pixels right of the base one.
  const source: ArtboardState = {
    ...board('src'),
    size: { width: 1000, height: 1000 },
    elements: [rect('a', 100, 100)],
    localized: { 'de-DE': { a: { detached: ['position'], position: { x: 300, y: 100 } } } },
  };
  const transfer = pickElements(source, ['a'])!;
  const target: ArtboardState = { ...board('dst'), size: { width: 1000, height: 1000 }, elements: [] };
  const options = { locales: new Set(['de-DE']), newId: () => 'n' };

  // German's box, centre (350, 125), lands centred on the point.
  const german = placeElements(target, transfer, { ...options, at: { x: 400, y: 400 }, viewLocale: 'de-DE' });
  assert.deepEqual(german.board.localized?.['de-DE']?.n?.position, { x: 350, y: 375 });
  assert.deepEqual(german.board.elements[0].position, { x: 150, y: 375 }, 'the base moves with it');

  // On the base language the same point centres the base box.
  const base = placeElements(target, transfer, { ...options, at: { x: 400, y: 400 } });
  assert.deepEqual(base.board.elements[0].position, { x: 350, y: 375 });

  // An offset moves the set from where it was, in every language alike.
  const beside = placeElements(target, transfer, { ...options, offset: { x: 20, y: 20 }, viewLocale: 'de-DE' });
  assert.deepEqual(beside.board.elements[0].position, { x: 120, y: 120 });
  assert.deepEqual(beside.board.localized?.['de-DE']?.n?.position, { x: 320, y: 120 });
});

test('removing takes the translations with the elements', () => {
  const after = removeElements(sourceBoard(), ['a', 'b']);
  assert.deepEqual(after.elements.map((element) => element.id), ['c']);
  assert.equal(after.localized?.['de-DE']?.a, undefined);
  assert.equal(after.localized?.ja?.b, undefined);
  assert.ok(after.localized?.['de-DE']?.c, 'the one left keeps its own');
  const untouched = sourceBoard();
  assert.equal(removeElements(untouched, ['zz']), untouched);
});

import { placeArtboard } from '@/lib/tabs/transfer';

test('an artboard arriving in another project takes that project languages and keeps its picture to itself', () => {
  const target: ArtboardState[] = [
    { ...board('t1'), localization: { baseLocale: 'en-US', locales: [{ code: 'de-DE' }] } },
    { ...board('t2'), localization: { baseLocale: 'en-US', locales: [{ code: 'de-DE' }] } },
  ];
  const source: ArtboardState = {
    ...sourceBoard(),
    backgroundImage: 'asset:sky',
    backgroundImageApply: 'span',
    backgroundImageSlice: { offsetX: 1000, totalWidth: 3000, totalHeight: 2000 },
    localization: { baseLocale: 'en-US', locales: [{ code: 'ja' }, { code: 'de-DE' }] },
  };
  let n = 0;
  const { boards, boardId } = placeArtboard(target, source, {
    index: 1,
    newId: () => `e${++n}`,
    newBoardId: () => 'moved',
  });
  assert.deepEqual(boards.map((entry) => entry.id), ['t1', 'moved', 't2']);
  assert.equal(boardId, 'moved');
  const moved = boards[1];
  assert.deepEqual(moved.elements.map((element) => element.id), ['e1', 'e2', 'e3']);
  assert.equal(moved.elements[0].groupId, moved.elements[1].groupId);
  assert.deepEqual(moved.localization, target[0].localization, "the target's language list");
  assert.deepEqual(Object.keys(moved.localized ?? {}), ['de-DE'], 'Japanese is not a language the target has');
  assert.deepEqual(Object.keys(moved.localized?.['de-DE'] ?? {}).sort(), ['e1', 'e3']);
  assert.equal(moved.backgroundImageApply, 'board');
  assert.equal('backgroundImageSlice' in moved, false);
  assert.equal(source.id, 'src', 'the source board is not touched');
});

// ----------------------------------------------------------- undo on disk

import {
  createUndoStore,
  resumeUndo,
  type EntryRow,
  type StackRow,
  type UndoStorage,
} from '@/lib/tabs/historyStore';

function memoryUndoStorage(delayMs = 0) {
  const stacks = new Map<string, StackRow>();
  const entries = new Map<string, EntryRow>();
  let entryWrites = 0;
  const storage: UndoStorage = {
    async transaction(work) {
      if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
      return work({
        getStack: async (projectId) => structuredClone(stacks.get(projectId)),
        putStack: async (row) => void stacks.set(row.projectId, structuredClone(row)),
        deleteStack: async (projectId) => void stacks.delete(projectId),
        entriesOf: async (projectId) =>
          [...entries.values()].filter((row) => row.projectId === projectId).map((row) => structuredClone(row)),
        putEntries: async (rows) => {
          for (const row of rows) {
            entries.set(row.key, structuredClone(row));
            entryWrites += 1;
          }
        },
        deleteEntries: async (keys) => keys.forEach((key) => entries.delete(key)),
        deleteEntriesOf: async (projectId) => {
          for (const [key, row] of entries) if (row.projectId === projectId) entries.delete(key);
        },
        allStacks: async () => [...stacks.values()].map((row) => structuredClone(row)),
      });
    },
  };
  return { storage, stacks, entries, entryWrites: () => entryWrites };
}

const undoOf = (history: HistoryEntry[], historyIndex = history.length - 1) => ({
  history,
  historyIndex,
  selectedElementIds: ['sel'],
  unedited: false,
});

/** A store for one window, with the windows alive given as a list. */
const storeFor = (storage: UndoStorage, sitting: string, live: string[] | null = [sitting], build = '1') =>
  createUndoStore(storage, { build, sitting, liveSittings: async () => (live ? new Set(live) : null) });

test('an undo stack comes back in order, under ids no window has handed out', async () => {
  const memory = memoryUndoStorage();
  const store = storeFor(memory.storage, 'first');
  const history = [entry(10, 'Open'), entry(10, 'Move'), entry(10, 'Text')];
  await store.save('p', undoOf(history, 1));
  const back = await store.load('p');
  assert.ok(back);
  assert.deepEqual(back.history.map((item) => item.label), ['Open', 'Move', 'Text']);
  assert.equal(back.historyIndex, 1, 'redo is kept too');
  assert.deepEqual(back.selectedElementIds, ['sel']);
  assert.equal(back.sameSitting, true);
  const ids = back.history.map((item) => item.id);
  assert.equal(new Set(ids).size, 3);
  for (const [i, id] of ids.entries()) assert.notEqual(id, history[i].id);
  assert.equal(await store.load('nothing'), null);
});

test('a stack counts while the window that wrote it lives, and a reload ends it', async () => {
  const memory = memoryUndoStorage();
  await storeFor(memory.storage, 'first').save('p', undoOf([entry(10, 'Open'), entry(10, 'Move')]));

  // Another window, with the first one still open: its stack counts.
  const other = await storeFor(memory.storage, 'second', ['first', 'second']).load('p');
  assert.equal(other?.history.length, 2);
  assert.equal(other?.sameSitting, false);

  // After a reload the first window's id is gone, so undo starts over (rule
  // 28), and the stack is deleted rather than kept for nobody.
  assert.equal(await storeFor(memory.storage, 'reloaded', ['reloaded']).load('p'), null);
  assert.equal(memory.stacks.size, 0);
  assert.equal(memory.entries.size, 0);
});

test('a stack handed to another window counts after the window that wrote it has gone', async () => {
  const memory = memoryUndoStorage();
  await storeFor(memory.storage, 'first').save('p', undoOf([entry(10)]), { handOver: true });
  assert.equal((await storeFor(memory.storage, 'second', ['second']).load('p'))?.history.length, 1);

  // One written as the tab slept can be marked for taking later.
  await storeFor(memory.storage, 'first').save('q', undoOf([entry(10)]));
  await storeFor(memory.storage, 'first').handOver('q');
  assert.equal((await storeFor(memory.storage, 'second', ['second']).load('q'))?.history.length, 1);
});

test("a window that takes another window's stack keeps it only for as long as it lives", async () => {
  const memory = memoryUndoStorage();
  // Handed over: the window it went to reads it, then that window reloads.
  await storeFor(memory.storage, 'first').save('p', undoOf([entry(10, 'Open'), entry(10, 'Move')]), { handOver: true });
  assert.equal((await storeFor(memory.storage, 'second', ['second']).load('p'))?.history.length, 2);
  assert.equal(memory.stacks.get('p')?.handOver, false, 'taken, so no other window takes it as well');
  assert.equal(await storeFor(memory.storage, 'second again', ['second again']).load('p'), null, 'rule 28');

  // Left when the first window closed its tab, and opened in a second one: the
  // first window still being open does not bring it back after a reload.
  await storeFor(memory.storage, 'first').save('q', undoOf([entry(10)]));
  assert.ok(await storeFor(memory.storage, 'second', ['first', 'second']).load('q'));
  assert.equal(await storeFor(memory.storage, 'second again', ['first', 'second again']).load('q'), null);
});

test('without locks to ask, only the window that wrote a stack uses it', async () => {
  const memory = memoryUndoStorage();
  await storeFor(memory.storage, 'first', null).save('p', undoOf([entry(10)]));
  assert.ok(await storeFor(memory.storage, 'first', null).load('p'));
  assert.equal(await storeFor(memory.storage, 'second', null).load('p'), null);
});

test('a save writes only the entries that are new, and deletes the ones that left', async () => {
  const memory = memoryUndoStorage();
  const store = storeFor(memory.storage, 'w');
  const [open, move, text] = [entry(10, 'Open'), entry(10, 'Move'), entry(10, 'Text')];
  await store.save('p', undoOf([open, move, text]));
  assert.equal(memory.entryWrites(), 3);
  // Undo twice, then a new edit: Text is gone from the stack.
  const color = entry(10, 'Color');
  await store.save('p', undoOf([open, color]));
  assert.equal(memory.entryWrites(), 4, 'one write for the one new entry');
  assert.equal(memory.entries.size, 2);
  assert.deepEqual((await store.load('p'))?.history.map((item) => item.label), ['Open', 'Color']);
  // A stack that came back from disk (the tab woke) is added to the same way
  // when it sleeps again.
  const loaded = (await store.load('p'))!;
  await store.save('p', undoOf([...loaded.history, entry(10, 'Rotate')]));
  assert.equal(memory.entryWrites(), 5);
});

test('a stack another build wrote, or one missing an entry, is not used', async () => {
  const memory = memoryUndoStorage();
  await storeFor(memory.storage, 'w').save('p', undoOf([entry(10), entry(10)]));
  assert.equal(await storeFor(memory.storage, 'w', ['w'], '2').load('p'), null);
  const store = storeFor(memory.storage, 'w');
  await store.save('p', undoOf([entry(10), entry(10)]));
  assert.ok(await store.load('p'));
  memory.entries.delete([...memory.entries.keys()][0]);
  assert.equal(await store.load('p'), null);
});

test('a load waits for the save asked for before it, an idle wait included', async () => {
  const store = storeFor(memoryUndoStorage(5).storage, 'w');
  let idle = () => {};
  const after = new Promise<void>((resolve) => (idle = resolve));
  void store.save('p', undoOf([entry(10, 'Open'), entry(10, 'Move')]), { after });
  const loading = store.load('p');
  setTimeout(idle, 20);
  assert.equal((await loading)?.history.length, 2);
});

test('remove and prune', async () => {
  const memory = memoryUndoStorage();
  const store = storeFor(memory.storage, 'w');
  await store.save('gone', undoOf([entry(10)]));
  await store.remove('gone');
  assert.equal(await store.load('gone'), null);
  assert.equal(memory.entries.size, 0);

  await store.save('mine', undoOf([entry(10)]));
  await storeFor(memory.storage, 'dead').save('left', undoOf([entry(10)]));
  const removed = await store.prune((row) => row.sitting === 'w');
  assert.equal(removed, 1);
  assert.deepEqual([...memory.stacks.keys()], ['mine']);
  assert.equal([...memory.entries.values()].every((row) => row.projectId === 'mine'), true);
});

test('a stored stack resumes on the document read, or steps back into it', () => {
  const stored = { ...undoOf([entry(10, 'Open'), entry(10, 'Move'), entry(10, 'Text')], 1), sameSitting: true, savedAt: 0 };
  const same = resumeUndo(stored, [], () => entry(10, 'Open'));
  assert.equal(same.matched, true);
  assert.equal(same.history, stored.history);
  assert.equal(same.historyIndex, 1);

  // The document moved on without the stack (its last save landed, the
  // stack's did not): it goes on top, where the redo was.
  const moved = resumeUndo(stored, [board('newer')], () => entry(10, 'Reopened'));
  assert.equal(moved.matched, false);
  assert.deepEqual(moved.history.map((item) => item.label), ['Open', 'Move', 'Reopened']);
  assert.equal(moved.historyIndex, 2);
});

// ------------------------------------------------ transfer, base languages

import { rebaseLanguages } from '@/lib/tabs/transfer';
import { resolveElementForLocale } from '@/lib/i18n/project';
import type { ElementLocaleOverride } from '@/types/artboard';

const words = (id: string, content: string, extra: Record<string, unknown> = {}): ArtboardElement =>
  ({
    id,
    type: 'text',
    content,
    position: { x: 100, y: 100 },
    size: { width: 400, height: 80 },
    rotation: 0,
    fontSize: 40,
    fontFamily: 'Inter',
    color: '#000000',
    ...extra,
  }) as unknown as ArtboardElement;

const english = { baseLocale: 'en-US', locales: [{ code: 'de-DE' }, { code: 'fr-FR' }] };
const german = { baseLocale: 'de-DE', locales: [{ code: 'en-US' }, { code: 'fr-FR' }, { code: 'ja' }] };

function englishBoard(): ArtboardState {
  return {
    ...board('en'),
    size: { width: 1000, height: 2000 },
    localization: english,
    elements: [words('t', 'Hello')],
    localized: {
      'de-DE': { t: { content: 'Hallo', origin: 'manual', sourceHash: 'abc' } },
      'fr-FR': { t: { content: 'Bonjour', origin: 'auto', sourceHash: 'abc' } },
    },
  };
}

test('layers moving into a project with another base language keep every translation', () => {
  const transfer = pickElements(englishBoard(), ['t'])!;
  assert.equal(transfer.baseLocale, 'en-US');
  const target: ArtboardState = { ...board('de'), size: { width: 1000, height: 2000 }, localization: german };
  const { board: placed, placedIds } = placeElements(target, transfer, {
    locales: new Set(['en-US', 'fr-FR', 'ja']),
    baseLocale: 'de-DE',
    newId: () => 'n1',
  });
  assert.deepEqual(placedIds, ['n1']);
  const element = placed.elements[0] as unknown as { content: string };
  assert.equal(element.content, 'Hallo', "the German is the target's base text now");
  assert.deepEqual(placed.localized?.['en-US']?.n1, { content: 'Hello', origin: 'manual' }, 'and the English an override');
  assert.deepEqual(placed.localized?.['fr-FR']?.n1, { content: 'Bonjour', origin: 'auto' }, 'stale marks do not cross');
  assert.equal(placed.localized?.ja, undefined, 'a language the source never had falls back to the base');
});

test('a language with its own box keeps it when it becomes the base, and the old base gets the shared one', () => {
  const element = words('t', 'Hello');
  const localized = {
    'de-DE': { t: { content: 'Hallo', detached: ['position'], position: { x: 300, y: 300 } } },
  };
  const out = rebaseLanguages([element], localized, { baseLocale: 'en-US' }, { baseLocale: 'de-DE', locales: new Set(['en-US']) });
  assert.deepEqual(out.elements[0].position, { x: 300, y: 300 });
  assert.deepEqual(out.localized['en-US'].t, {
    content: 'Hello',
    detached: ['position'],
    position: { x: 100, y: 100 },
    origin: 'manual',
  });
  assert.equal(element.position.x, 100, 'the source element is not touched');
});

test('the same base language, or a project with none set up, changes nothing but the language list', () => {
  const element = words('t', 'Hello');
  const localized = { 'de-DE': { t: { content: 'Hallo' } }, ja: { t: { content: 'Konnichiwa' } } };
  const same = rebaseLanguages([element], localized, { baseLocale: 'en-US' }, { baseLocale: 'en-US', locales: new Set(['de-DE']) });
  assert.equal(same.elements[0], element);
  assert.deepEqual(Object.keys(same.localized), ['de-DE']);
  const unset = rebaseLanguages([element], localized, {}, { baseLocale: 'de-DE', locales: new Set(['ja']) });
  assert.equal(unset.elements[0], element);
  assert.deepEqual(Object.keys(unset.localized), ['ja']);
});

test('an artboard moving into a project with another base language keeps every translation', () => {
  const target: ArtboardState[] = [{ ...board('d1'), localization: german }];
  const { boards } = placeArtboard(target, englishBoard(), { newId: () => 'e1', newBoardId: () => 'moved' });
  const moved = boards[1];
  assert.equal((moved.elements[0] as unknown as { content: string }).content, 'Hallo');
  assert.equal(moved.localized?.['en-US']?.e1?.content, 'Hello');
  assert.equal(moved.localized?.['fr-FR']?.e1?.content, 'Bonjour');
  assert.deepEqual(moved.localization, german);
});

/** An element as one language draws it, the way the canvas resolves it. */
const drawnIn = (element: ArtboardElement, override: ElementLocaleOverride | undefined, locale: string) =>
  resolveElementForLocale(element, override, { code: locale }) as unknown as Record<string, unknown>;

test('a detached property stored as null is unset in that language', () => {
  const element = words('t', 'Hallo', { opacity: 0.3 });
  const override = { content: 'Hello', detached: ['opacity'], opacity: null } as unknown as ElementLocaleOverride;
  const drawn = drawnIn(element, override, 'en-US');
  assert.equal('opacity' in drawn, false, 'so it draws the default');
  assert.equal(drawn.content, 'Hello');
  assert.equal((element as unknown as { opacity: number }).opacity, 0.3, 'the base element is not touched');
});

test('a property the old base never set stays unset there, whatever the new base sets', () => {
  // English draws at the default opacity, German pulled opacity apart at 0.3.
  const element = words('t', 'Hello');
  const localized = {
    'de-DE': { t: { content: 'Hallo', detached: ['opacity'], opacity: 0.3 } },
    'fr-FR': { t: { content: 'Bonjour' } },
  };
  const out = rebaseLanguages([element], localized, english, {
    baseLocale: 'de-DE',
    locales: new Set(['en-US', 'fr-FR']),
  });
  const [base] = out.elements;
  assert.equal((base as unknown as { opacity: number }).opacity, 0.3, "German's opacity is the shared one now");
  assert.deepEqual(out.localized['en-US'].t.detached, ['opacity']);
  assert.equal((out.localized['en-US'].t as unknown as { opacity: unknown }).opacity, null);
  // Every language draws the way the old project drew it.
  assert.equal('opacity' in drawnIn(base, out.localized['en-US'].t, 'en-US'), false, 'English is back at the default');
  assert.equal(drawnIn(base, out.localized['en-US'].t, 'en-US').content, 'Hello');
  assert.equal('opacity' in drawnIn(base, out.localized['fr-FR'].t, 'fr-FR'), false, 'and so is French');
  assert.equal(drawnIn(base, out.localized['fr-FR'].t, 'fr-FR').content, 'Bonjour');
});

test('a language with nothing of its own for an element follows the new base', () => {
  const localized = { 'de-DE': { t: { content: 'Hallo', detached: ['opacity'], opacity: 0.3 } } };
  const out = rebaseLanguages([words('t', 'Hello')], localized, english, {
    baseLocale: 'de-DE',
    locales: new Set(['en-US', 'fr-FR']),
  });
  assert.equal(out.localized['fr-FR'], undefined, 'French never translated it, so it shows the German, untranslated');
  assert.ok(out.localized['en-US']?.t);
});

test('a picture the old base did not have stays absent there', () => {
  const phone = {
    id: 'p',
    type: 'device',
    position: { x: 0, y: 0 },
    size: { width: 100, height: 200 },
    rotation: 0,
  } as unknown as ArtboardElement;
  const out = rebaseLanguages([phone], { 'de-DE': { p: { screenshotSrc: 'asset:de' } } }, english, {
    baseLocale: 'de-DE',
    locales: new Set(['en-US']),
  });
  assert.equal((out.elements[0] as unknown as { screenshotSrc: string }).screenshotSrc, 'asset:de');
  assert.equal(out.localized['en-US'].p.screenshotSrc, '', 'an empty picture is how a language says it has none');
});

test('the face the canvas picked for the new base language is kept, and others keep theirs', () => {
  // English in Inter, Japanese in the face the canvas picks for Japanese.
  const element = words('t', 'Hello');
  const localized = { ja: { t: { content: 'Konnichiwa' } }, 'fr-FR': { t: { content: 'Bonjour' } } };
  const picked = drawnIn(element, localized.ja.t, 'ja').fontFamily;
  assert.notEqual(picked, 'Inter', 'the canvas has a Japanese face to pick');

  const source = { baseLocale: 'en-US', locales: [{ code: 'ja' }, { code: 'fr-FR' }] };
  const intoJapanese = rebaseLanguages([element], localized, source, {
    baseLocale: 'ja',
    locales: new Set(['en-US', 'fr-FR']),
  });
  assert.equal((intoJapanese.elements[0] as unknown as { fontFamily: string }).fontFamily, picked);
  for (const locale of ['en-US', 'fr-FR']) {
    const own = intoJapanese.localized[locale].t;
    assert.equal(drawnIn(intoJapanese.elements[0], own, locale).fontFamily, 'Inter', `${locale} keeps its face`);
  }

  // Into a German project, Japanese stays a language the canvas picks for:
  // the base face did not change, so nothing is frozen.
  const intoGerman = rebaseLanguages(
    [element],
    { ...localized, 'de-DE': { t: { content: 'Hallo' } } },
    { baseLocale: 'en-US', locales: [{ code: 'de-DE' }, { code: 'ja' }] },
    { baseLocale: 'de-DE', locales: new Set(['ja']) }
  );
  const ja = intoGerman.localized.ja.t;
  assert.equal(ja.detached, undefined);
  assert.equal(drawnIn(intoGerman.elements[0], ja, 'ja').fontFamily, picked);
});

// ------------------------------------------------------------ faces to load

import { textFacesOf } from '@/lib/tabs/transfer';

test('the faces layers are measured in are theirs and the ones their languages draw them in', () => {
  const element = words('t', 'Hello', { fontWeight: 'bold' });
  const faces = textFacesOf(
    [element, words('u', 'Hi', { fontFamily: '' }), { id: 'r', type: 'shape' } as unknown as ArtboardElement],
    {
      // Japanese draws in the face the canvas picks for it, French in one picked there.
      ja: { t: { content: 'こんにちは' } },
      'fr-FR': { t: { content: 'Bonjour', detached: ['fontFamily'], fontFamily: 'Lobster' } },
      'de-DE': { gone: { content: 'Hallo' } },
    },
    [{ code: 'ja' }, { code: 'fr-FR' }]
  );
  const japanese = drawnIn(element, { content: 'こんにちは' }, 'ja').fontFamily as string;
  assert.notEqual(japanese, 'Inter');
  // A layer with no face is measured in Arial, as the canvas measures it.
  assert.deepEqual(faces.map((face) => face.family).sort(), ['Arial', 'Inter', 'Lobster', japanese].sort());
  // In the weight the layer has, with every character each face draws.
  const inter = faces.find((face) => face.family === 'Inter');
  assert.equal(inter?.font, 'normal bold 16px "Inter"');
  assert.equal(inter?.text, 'Helo');
  assert.equal(faces.find((face) => face.family === japanese)?.text, 'こんにちは');
  assert.equal(faces.find((face) => face.family === 'Lobster')?.text, 'Bonjur');
});

import { pickWithFacesIn, type TextFace } from '@/lib/tabs/transfer';
import type { LocaleEntry } from '@/types/artboard';

test("layers are picked again until the faces they need are in, a language's own face included", async () => {
  const element = words('t', 'Hello', { fontFamily: 'Lobster' });
  const localized = { ja: { t: { content: 'Konnichiwa' } } };
  // Japanese draws in the headline's face, until, while the first wait is on,
  // it is set to draw in one of its own. No layer changes.
  let locales: LocaleEntry[] = [{ code: 'ja', autoFont: false }];
  const pick = () => ({ elements: [element], localized, locales });
  const facesOf = (picked: ReturnType<typeof pick>) => textFacesOf(picked.elements, picked.localized, picked.locales);
  const japanese = drawnIn(element, { content: 'Konnichiwa' }, 'ja').fontFamily as string;
  const loaded = new Set<string>();
  const waits: string[][] = [];
  const waitFor = (faces: readonly TextFace[]) => {
    const missing = faces.filter((face) => !loaded.has(face.family)).map((face) => face.family);
    if (missing.length === 0) return null;
    waits.push(missing);
    return Promise.resolve().then(() => {
      missing.forEach((family) => loaded.add(family));
      locales = [{ code: 'ja' }];
    });
  };
  const settled = await pickWithFacesIn(pick(), pick, facesOf, waitFor);
  assert.deepEqual(waits, [['Lobster'], [japanese]]);
  assert.deepEqual(settled?.locales, [{ code: 'ja' }]);

  // Faces that never come are waited for once: not once a round, and not
  // again by the last check before writing, which is handed the same set.
  let waitedFor = 0;
  const never = () => {
    waitedFor += 1;
    return Promise.resolve();
  };
  const first = pick();
  const givenUp = new Set<string>();
  assert.deepEqual(await pickWithFacesIn(first, pick, facesOf, never, givenUp), first);
  assert.deepEqual(await pickWithFacesIn(first, pick, facesOf, never, givenUp), first);
  assert.equal(waitedFor, 1);
  // Gone meanwhile, or in a tab asleep, where nothing changes it.
  assert.equal(await pickWithFacesIn(first, () => null, facesOf, never), null);
  assert.equal(await pickWithFacesIn(first, () => undefined, facesOf, never), first);
});

// ------------------------------------------------------------- hand-overs

import {
  holdProjectLock,
  isProjectLockHeld,
  projectOpenElsewhere,
  releaseProjectLock,
  startHandOver,
} from '@/lib/tabs/projectLocks';

const LOCK = (projectId: string) => `open-screenshot-generator.project:${projectId}`;

/**
 * Web Locks for one test, the way one browser keeps them for every window: a
 * name is held by one asker at a time. Node 20 has none to use.
 */
function installLocks() {
  const holders = new Set<string>();
  const manager = {
    async request(name: string, options: { ifAvailable?: boolean }, callback: (lock: unknown) => Promise<void>) {
      // A browser answers later, never inside the call (projectLocks.ts counts on that).
      await Promise.resolve();
      if (holders.has(name)) {
        assert.equal(options.ifAvailable, true, 'only asks that do not wait are made here');
        return callback(null);
      }
      holders.add(name);
      try {
        await callback({ name });
      } finally {
        holders.delete(name);
      }
    },
    async query() {
      return { held: [...holders].map((name) => ({ name })) };
    },
  };
  const before = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { value: { locks: manager }, configurable: true });
  return {
    /** Another window takes `name`. Resolves with the function that lets go of it. */
    async takeElsewhere(name: string): Promise<() => void> {
      // A lock let go of here is free once its callback has settled.
      await new Promise((resolve) => setTimeout(resolve, 0));
      let release!: () => void;
      const granted = await new Promise<boolean>((answer) => {
        void manager.request(name, { ifAvailable: true }, (lock) => {
          answer(!!lock);
          return new Promise<void>((resolve) => (release = resolve));
        });
      });
      assert.equal(granted, true, 'the other window got it');
      return () => release();
    },
    restore() {
      if (before) Object.defineProperty(globalThis, 'navigator', before);
      else delete (globalThis as { navigator?: unknown }).navigator;
    },
  };
}

test('a project on its way to another window is turned down here until it has gone', async () => {
  const locks = installLocks();
  try {
    assert.equal(await holdProjectLock('leaving'), true);
    const handedOver = startHandOver('leaving');
    // Still held, for the last writes of the project and its undo stack, but
    // an open or a transfer that asks for it now is turned down, and the
    // project counts as open elsewhere.
    assert.equal(isProjectLockHeld('leaving'), true);
    assert.equal(await holdProjectLock('leaving'), false);
    assert.equal(await projectOpenElsewhere('leaving'), true);
    handedOver();
    assert.equal(isProjectLockHeld('leaving'), false);

    // The window it went to has it now.
    const letGo = await locks.takeElsewhere(LOCK('leaving'));
    assert.equal(await holdProjectLock('leaving'), false);
    assert.equal(await projectOpenElsewhere('leaving'), true);
    letGo();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(await holdProjectLock('leaving'), true, 'free again, so this window may have it back');
    releaseProjectLock('leaving');

    // Two hand-overs at once: the project stays turned down until both are done.
    const first = startHandOver('twice');
    const second = startHandOver('twice');
    first();
    first();
    assert.equal(await holdProjectLock('twice'), false);
    second();
    assert.equal(await holdProjectLock('twice'), true);
    releaseProjectLock('twice');
  } finally {
    locks.restore();
  }
});
