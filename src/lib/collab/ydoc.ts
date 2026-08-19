// The shared document: an artboard project expressed as a Yjs CRDT.
//
// ## Why a mirror rather than a rewrite
//
// The editor's state is a plain `ArtboardState[]` and every mutation goes
// through one door (`handleArtboardsUpdate`). Rebuilding all of that on Yjs
// types would touch every panel, every element renderer and the whole undo
// stack. So instead the Y.Doc is a MIRROR of that array, and this file is the
// two functions that keep them equal:
//
//   writeArtboards(doc, boards)   the canvas changed, push it into the doc
//   readArtboards(doc)            the doc changed, build the array back
//
// The mirror is not a blob. Every board is a Y.Map, every element is a Y.Map,
// and every property is a key in one of them, because that granularity IS the
// merge: two people dragging different elements never touch the same key, two
// people editing one element's colour and its size both keep their change, and
// only two people setting the SAME property at the same moment resolve by "last
// writer wins". Storing a board as one JSON string would make every edit
// conflict with every other edit on that board.
//
// ## Keyed maps plus an order list, not arrays of maps
//
// The obvious shape is `Y.Array<Y.Map>` in canvas order. It has two failures
// this shape does not:
//
//   1. **Two peers seeding the same project produce two of everything.** A Yjs
//      array has no notion of "an item with this id already exists", so two
//      clients that both write board `ab_1` into an empty room merge into a
//      document with two `ab_1`s. Keyed by id, the same write from two peers
//      converges on one entry, which is what makes the seeding race below
//      harmless rather than corrupting.
//   2. **Reordering destroys identity.** This Yjs has no move operation, so
//      moving an item in an array means delete plus re-insert, and a peer
//      editing that element at the same moment loses the edit. With order in
//      its own `Y.Array<string>`, moving a board rewrites a list of ids and the
//      element maps are never touched.
//
// ## What is deliberately not in here
//
//   - `position` on a board. It is derived: `calculateArtboardPositions` rewrites
//     it on every commit, so syncing it would be a permanent stream of updates
//     that every client recomputes to the same answer anyway.
//   - media blobs. A screen recording is up to 96MB and a WebRTC data channel
//     refuses a message over ~256KB, so the bytes travel the way they always
//     have (the cloud copy) and the document carries only the reference. See
//     `fetchMissingAssets` in session.ts.
//
// ## The one rule
//
// Every write from this device happens in a transaction tagged LOCAL_ORIGIN.
// The observer ignores those, which is what stops the obvious infinite loop:
// apply remote change, re-render, publish, apply, publish.

import * as Y from 'yjs';
import type { ArtboardElement, ArtboardState } from '@/types/artboard';

/** Transactions we started ourselves. Remote ones carry anything but this. */
export const LOCAL_ORIGIN = 'osg-local';

/** Board fields handled specially, or not synced at all. */
const BOARD_SKIP = new Set(['id', 'elements', 'position']);
/** Element fields handled specially. */
const ELEMENT_SKIP = new Set(['id']);

const BOARDS = 'boards';
const BOARD_ORDER = 'boardOrder';
const ELEMENTS = 'elements';
const ELEMENT_ORDER = 'elementOrder';

export function boardMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>(BOARDS);
}

export function boardOrder(doc: Y.Doc): Y.Array<string> {
  return doc.getArray<string>(BOARD_ORDER);
}

export function metaMap(doc: Y.Doc): Y.Map<unknown> {
  return doc.getMap('meta');
}

/**
 * Cheap structural equality for the values that live on an element.
 *
 * Everything here is JSON: numbers, strings, and small objects like `{x, y}` or
 * a shadow. Both sides are built by the same code from the same shapes, so key
 * order is stable and stringify is a sound comparison, at a fraction of the
 * cost of walking two objects for every property of every element on every
 * commit.
 */
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === undefined || b === undefined || a === null || b === null) return false;
  if (typeof a !== 'object' && typeof b !== 'object') return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Make one Y.Map say what one plain object says, touching only what differs.
 *
 * The "only what differs" half is the important one: every Yjs write is an
 * operation on the wire and in every peer's history, so re-setting forty
 * unchanged keys because one moved would multiply the cost of a drag by forty.
 */
function applyPlain(map: Y.Map<unknown>, source: Record<string, unknown>, skip: Set<string>): void {
  for (const [key, value] of Object.entries(source)) {
    if (skip.has(key)) continue;
    // Yjs cannot hold `undefined`, and an absent key and a key set to undefined
    // mean the same thing to the editor, so absence is how it is expressed.
    if (value === undefined) {
      if (map.has(key)) map.delete(key);
      continue;
    }
    if (!same(map.get(key), value)) map.set(key, value as never);
  }
  for (const key of [...map.keys()]) {
    if (skip.has(key) || key === ELEMENTS || key === ELEMENT_ORDER) continue;
    if (!(key in source) || source[key] === undefined) map.delete(key);
  }
}

function plainOf(map: Y.Map<unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of map.entries()) {
    if (value instanceof Y.AbstractType) continue; // the nested element collections
    out[key] = value;
  }
  return out;
}

/**
 * Make a Y.Array of ids read exactly as `next` does.
 *
 * Rewritten wholesale when it differs rather than patched, because it is a list
 * of short strings: the whole array of a 12 board project is smaller than one
 * element's property. Duplicates (which a concurrent insert on both sides can
 * produce) disappear here as a side effect, and `readArtboards` tolerates them
 * in the meantime.
 */
function reconcileOrder(order: Y.Array<string>, next: string[]): void {
  if (order.length === next.length && order.toArray().every((id, i) => id === next[i])) return;
  if (order.length > 0) order.delete(0, order.length);
  if (next.length > 0) order.insert(0, next);
}

function writeElement(map: Y.Map<unknown>, element: ArtboardElement): void {
  applyPlain(map, element as unknown as Record<string, unknown>, ELEMENT_SKIP);
}

/**
 * Push the canvas into the shared document.
 *
 * One transaction, so peers see one update rather than one per element, and
 * tagged LOCAL_ORIGIN so our own observer skips it.
 */
export function writeArtboards(doc: Y.Doc, boards: ArtboardState[], projectName?: string): void {
  doc.transact(() => {
    if (projectName !== undefined) {
      const meta = metaMap(doc);
      if (meta.get('name') !== projectName) meta.set('name', projectName);
    }

    const boardsMap = boardMap(doc);
    const wantedBoards = new Set(boards.map((board) => board.id));
    for (const id of [...boardsMap.keys()]) {
      if (!wantedBoards.has(id)) boardsMap.delete(id);
    }

    for (const board of boards) {
      let entry = boardsMap.get(board.id);
      if (!entry) {
        entry = new Y.Map<unknown>();
        boardsMap.set(board.id, entry);
        entry.set('id', board.id);
      }
      applyPlain(entry, board as unknown as Record<string, unknown>, BOARD_SKIP);

      let elements = entry.get(ELEMENTS);
      if (!(elements instanceof Y.Map)) {
        elements = new Y.Map<Y.Map<unknown>>();
        entry.set(ELEMENTS, elements);
      }
      const elementMap = elements as Y.Map<Y.Map<unknown>>;
      const wantedElements = new Set((board.elements ?? []).map((element) => element.id));
      for (const id of [...elementMap.keys()]) {
        if (!wantedElements.has(id)) elementMap.delete(id);
      }
      for (const element of board.elements ?? []) {
        let elementEntry = elementMap.get(element.id);
        if (!elementEntry) {
          elementEntry = new Y.Map<unknown>();
          elementMap.set(element.id, elementEntry);
          elementEntry.set('id', element.id);
        }
        writeElement(elementEntry, element);
      }

      let order = entry.get(ELEMENT_ORDER);
      if (!(order instanceof Y.Array)) {
        order = new Y.Array<string>();
        entry.set(ELEMENT_ORDER, order);
      }
      reconcileOrder(order as Y.Array<string>, (board.elements ?? []).map((element) => element.id));
    }

    reconcileOrder(boardOrder(doc), boards.map((board) => board.id));
  }, LOCAL_ORIGIN);
}

/**
 * The ids of a keyed collection, in order.
 *
 * Tolerant on purpose: an id listed twice (two peers inserting at once) is kept
 * once, an id listed but missing is dropped, and anything present but unlisted
 * is appended. A missing order entry must never hide somebody's new board.
 */
function orderedIds(order: Y.Array<string>, present: Y.Map<any>): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const id of order) {
    if (typeof id !== 'string' || seen.has(id) || !present.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  for (const id of present.keys()) {
    if (!seen.has(id)) ids.push(id);
  }
  return ids;
}

/**
 * Build the editor's array back out of the document.
 *
 * `position` comes back as a zero placeholder: it is derived, and the caller
 * runs the same `calculateArtboardPositions` it runs for every other update, so
 * every client lays the boards out identically without syncing a coordinate.
 */
export function readArtboards(doc: Y.Doc): ArtboardState[] {
  const boardsMap = boardMap(doc);
  const boards: ArtboardState[] = [];

  for (const id of orderedIds(boardOrder(doc), boardsMap)) {
    const entry = boardsMap.get(id);
    if (!entry) continue;
    const plain = plainOf(entry);
    const elements: ArtboardElement[] = [];
    const elementMap = entry.get(ELEMENTS);
    const order = entry.get(ELEMENT_ORDER);
    if (elementMap instanceof Y.Map) {
      const list =
        order instanceof Y.Array
          ? orderedIds(order as Y.Array<string>, elementMap as Y.Map<unknown>)
          : [...(elementMap as Y.Map<unknown>).keys()];
      for (const elementId of list) {
        const element = (elementMap as Y.Map<Y.Map<unknown>>).get(elementId);
        if (element) elements.push(plainOf(element) as unknown as ArtboardElement);
      }
    }
    boards.push({
      ...(plain as unknown as ArtboardState),
      id,
      position: { x: 0, y: 0 },
      elements,
    });
  }

  return boards;
}

/** The project name somebody in the room last set, if anybody has. */
export function readProjectName(doc: Y.Doc): string | null {
  const name = metaMap(doc).get('name');
  return typeof name === 'string' && name ? name : null;
}

/** True when nobody has written anything yet, so this room is a blank slate. */
export function isEmptyDoc(doc: Y.Doc): boolean {
  return boardMap(doc).size === 0;
}
