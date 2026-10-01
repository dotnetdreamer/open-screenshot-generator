// The letter outline and the Lilita One family reach agents through MCP: the
// element tools describe both outline fields, a call hands them to the editor
// as given, and list_fonts offers the family that game titles are set in.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleMcpMessage, runMcpRequest, type McpDesignApi } from '@/lib/mcp/desktopMcpServer';

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

type ToolList = { result: { tools: Array<{ name: string; inputSchema: any }> } };
type CallResult = { result?: { isError?: boolean; content?: Array<{ type: string; text?: string }> } };
const textOf = (response: unknown) => (response as CallResult).result?.content?.[0]?.text ?? '';

async function schemaOf(name: string) {
  const list = (await runMcpRequest({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, null)) as ToolList;
  const tool = list.result.tools.find((entry) => entry.name === name);
  assert.ok(tool, `tools/list has ${name}`);
  return tool!.inputSchema;
}

test('the element tools describe both outline fields', async () => {
  for (const name of ['add_element', 'update_element', 'set_locale_override']) {
    const { properties } = await schemaOf(name);
    assert.equal(properties.outlineColor?.type, 'string', `${name} outlineColor`);
    assert.equal(properties.outlineWidth?.type, 'number', `${name} outlineWidth`);
  }
  const batch = (await schemaOf('add_elements')).properties.elements.items.properties;
  assert.equal(batch.outlineColor?.type, 'string');
  assert.equal(batch.outlineWidth?.type, 'number');
  // Agents size type from these words, so the unit has to be in them.
  const { properties } = await schemaOf('update_element');
  assert.match(properties.outlineWidth.description, /same units as fontSize/);
});

test('an outline reaches the editor as the agent wrote it, and null clears it', async () => {
  const { api, calls } = recordingApi();
  await handleMcpMessage(
    call('update_element', { elementId: 'el_1', outlineColor: '#14100c', outlineWidth: 3.4 }),
    api,
    { agent: false }
  );
  const set = calls.find((entry) => entry.method === 'updateElement');
  assert.deepEqual(set?.args.props, { outlineColor: '#14100c', outlineWidth: 3.4 });

  await handleMcpMessage(call('update_element', { elementId: 'el_1', outlineColor: null, outlineWidth: null }), api, {
    agent: false,
  });
  const cleared = calls.filter((entry) => entry.method === 'updateElement')[1];
  assert.ok(cleared, 'the clearing call reached the editor');
  assert.equal(cleared.args.props.outlineColor, undefined);
  assert.equal(cleared.args.props.outlineWidth, undefined);
  assert.ok('outlineColor' in cleared.args.props && 'outlineWidth' in cleared.args.props, 'null is passed on as a removal');
});

test('add_element takes Lilita One in any spelling and keeps the outline', async () => {
  const { api, calls } = recordingApi();
  const response = await handleMcpMessage(
    call('add_element', {
      type: 'text',
      content: 'STREET MARBLES',
      fontFamily: 'lilita  one',
      fontSize: 39,
      outlineColor: '#14100c',
      outlineWidth: 2.9,
      shadow: { x: 0, y: 22, blur: 0, color: '#14100c' },
      x: 64,
      y: 180,
      width: 1162,
      height: 300,
    }),
    api,
    { agent: false }
  );
  assert.equal((response as CallResult).result?.isError, undefined, textOf(response));
  const added = calls.find((entry) => entry.method === 'addElement');
  assert.equal(added?.args.props.fontFamily, 'Lilita One');
  assert.equal(added?.args.props.outlineColor, '#14100c');
  assert.equal(added?.args.props.outlineWidth, 2.9);
});

test('list_fonts offers Lilita One', async () => {
  const { api } = recordingApi();
  const response = await handleMcpMessage(call('list_fonts', {}), api, { agent: false });
  assert.match(textOf(response), /"Lilita One"/);
});

test('an outline colour that would load something is refused for an agent holding folder data', async () => {
  const { api, calls } = recordingApi();
  const agentWithFolder = new Proxy(api, {
    get: (target, key) => (key === 'agentReadsFolders' || key === 'agentMayHoldFolderData' ? () => true : (target as any)[key]),
  });
  const response = await handleMcpMessage(
    call('update_element', { elementId: 'el_1', outlineColor: 'red, 0 0 url(https://x.example/?d=1)', outlineWidth: 2 }),
    agentWithFolder,
    { agent: true }
  );
  assert.equal((response as CallResult).result?.isError, true);
  assert.equal(calls.some((entry) => entry.method === 'updateElement'), false);
});
