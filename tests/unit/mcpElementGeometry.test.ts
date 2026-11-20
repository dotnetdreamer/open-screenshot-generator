// add_element and update_element take x, y, width and height one at a time: a
// value left out keeps the element's own, or its default for a new element, so
// a call never moves or resizes an element along an axis it did not name.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleMcpMessage, type McpDesignApi } from '@/lib/mcp/desktopMcpServer';
import { listLibraryItems, resolveLibraryItem } from '@/lib/mcp/assetLibrary';
import { positionWith, sizeWith } from '@/lib/mcp/geometry';

/** An api that says yes to everything and keeps the arguments it was given. */
function recordingApi(): { api: McpDesignApi; calls: Array<{ method: string; args: any }> } {
  const calls: Array<{ method: string; args: any }> = [];
  const api = new Proxy({} as McpDesignApi, {
    get: (_target, key) => {
      if (key === 'agentReadsFolders' || key === 'agentMayHoldFolderData') return () => false;
      return (...args: unknown[]) => {
        calls.push({ method: String(key), args: args[0] });
        return key === 'addElement' ? { id: 'el_new' } : key === 'addElements' ? { ids: ['el_a'] } : true;
      };
    },
  });
  return { api, calls };
}

let nextId = 1;
const call = (name: string, args: Record<string, unknown>) => ({
  jsonrpc: '2.0',
  id: nextId++,
  method: 'tools/call',
  params: { name, arguments: args },
});

test('a y or a height alone keeps the rest of the place and size', () => {
  const position = { x: 72, y: 230 };
  const size = { width: 1062, height: 300 };
  assert.deepEqual(positionWith(position, { y: 190 }), { x: 72, y: 190 });
  assert.deepEqual(positionWith(position, { x: -40 }), { x: -40, y: 230 }, 'an element may start off the board');
  assert.deepEqual(sizeWith(size, { height: 500 }), { width: 1062, height: 500 });
  assert.deepEqual(sizeWith(size, { width: 800 }), { width: 800, height: 300 });
  assert.deepEqual(positionWith(position, undefined), position);
  assert.deepEqual(sizeWith(size, {}), size);
});

test('a value that is not a usable number keeps the one there', () => {
  const position = { x: 10, y: 20 };
  const size = { width: 30, height: 40 };
  assert.deepEqual(positionWith(position, { x: Number.NaN, y: Number.POSITIVE_INFINITY }), position);
  assert.deepEqual(sizeWith(size, { width: 0, height: -5 }), size);
});

test('update_element hands the editor only the coordinates it was given', async () => {
  const { api, calls } = recordingApi();
  await handleMcpMessage(call('update_element', { elementId: 'el_1', y: 190, height: 500, lineHeight: 1.08 }), api, { agent: false });
  const update = calls.find((entry) => entry.method === 'updateElement');
  assert.deepEqual(update?.args.props, { lineHeight: 1.08, position: { y: 190 }, size: { height: 500 } });

  await handleMcpMessage(call('update_element', { elementId: 'el_1', x: 72, width: 1062 }), api, { agent: false });
  const second = calls.filter((entry) => entry.method === 'updateElement')[1];
  assert.deepEqual(second?.args.props, { position: { x: 72 }, size: { width: 1062 } });
});

test('a null coordinate is left alone rather than read as 0', async () => {
  const { api, calls } = recordingApi();
  await handleMcpMessage(call('update_element', { elementId: 'el_1', x: null, y: 40 }), api, { agent: false });
  const update = calls.find((entry) => entry.method === 'updateElement');
  assert.deepEqual(update?.args.props, { position: { y: 40 } });
});

test('add_element passes a lone width on for the editor to fill in', async () => {
  const { api, calls } = recordingApi();
  await handleMcpMessage(call('add_element', { type: 'text', content: 'Hello', width: 600 }), api, { agent: false });
  const added = calls.find((entry) => entry.method === 'addElement');
  assert.deepEqual(added?.args.props.size, { width: 600 });
  assert.equal(added?.args.props.position, undefined, 'no x or y, so the editor centres it');
});

test('a width alone on a palette item keeps the item\'s own height', async () => {
  const libraryId = listLibraryItems('devices').items.find((item) => resolveLibraryItem(item.libraryId)?.defaultSize)?.libraryId;
  assert.ok(libraryId, 'some device in the palette has a size of its own');
  const own = resolveLibraryItem(libraryId)!.defaultSize!;
  const { api, calls } = recordingApi();
  await handleMcpMessage(call('add_element', { libraryId, width: 321 }), api, { agent: false });
  const added = calls.find((entry) => entry.method === 'addElement');
  assert.deepEqual(added?.args.props.size, { width: 321, height: own.height });
});

test('a null, zero or negative height on a palette item keeps the item\'s own, as leaving it out does', async () => {
  const libraryId = listLibraryItems('devices').items.find((item) => resolveLibraryItem(item.libraryId)?.defaultSize)?.libraryId;
  const own = resolveLibraryItem(libraryId!)!.defaultSize!;
  const { api, calls } = recordingApi();
  for (const height of [null, 0, -10]) {
    await handleMcpMessage(call('add_element', { libraryId, width: 321, height }), api, { agent: false });
  }
  await handleMcpMessage(call('add_element', { libraryId, width: 0, height: 654 }), api, { agent: false });
  const sizes = calls.filter((entry) => entry.method === 'addElement').map((entry) => entry.args.props.size);
  assert.deepEqual(sizes, [
    { width: 321, height: own.height },
    { width: 321, height: own.height },
    { width: 321, height: own.height },
    { width: own.width, height: 654 },
  ]);
});
