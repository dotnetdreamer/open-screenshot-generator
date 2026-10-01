// window.__osg, the headless bridge the npm CLI drives, runs its MCP calls
// through a serial runner of its own, built like the desktop server's and the
// web relay's: one call at a time, a call that follows a write starts only
// once the editor has rendered that write, and no call starts while a project
// is still opening.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { McpDesignApi } from '@/lib/mcp/desktopMcpServer';
import { installHeadlessBridge, type HeadlessBridge, type HeadlessHost } from '@/lib/headless/bridge';

/**
 * A stand-in for the layout. Like the real one, each api it hands out closes
 * over the elements of the render that built it, and a write reaches the next
 * api only when the editor renders, on a later task, the way React does.
 */
function fakeEditor() {
  let elements: string[] = [];
  const build = (seen: string[]): McpDesignApi =>
    new Proxy({} as McpDesignApi, {
      get: (_target, key) => {
        if (key === 'agentReadsFolders' || key === 'agentMayHoldFolderData') return () => false;
        if (key === 'addElement') {
          return () => {
            elements = [...seen, `el_${seen.length + 1}`];
            setTimeout(() => {
              api = build(elements);
            }, 0);
            return { id: elements[elements.length - 1] };
          };
        }
        return () => true;
      },
    });
  let api = build(elements);
  return { getApi: () => api, count: () => elements.length };
}

function hostFor(getApi: () => McpDesignApi | null): HeadlessHost {
  return {
    getMcpApi: getApi,
    exportImages: async () => [],
    exportVideo: async () => [],
    capture: async () => [],
    loadProject: async () => true,
    getStatus: () => ({
      projectId: 'p1',
      projectName: 'Bridge',
      artboards: [],
      locales: [],
      baseLocale: null,
      activeArtboardId: null,
    }),
  };
}

/** The page's window, as far as the bridge reads and writes it. */
function headlessWindow(): { __OSG_HEADLESS?: boolean; __osg?: HeadlessBridge } {
  const scope = globalThis as { window?: { __OSG_HEADLESS?: boolean; __osg?: HeadlessBridge } };
  scope.window = { __OSG_HEADLESS: true };
  return scope.window;
}

let nextId = 1;
const addText = (line: number) => ({
  jsonrpc: '2.0',
  id: nextId++,
  method: 'tools/call',
  params: {
    name: 'add_element',
    arguments: { artboardId: 'ab_1', type: 'text', content: `Line ${line}`, x: 0, y: line * 40, width: 400, height: 40 },
  },
});

type CallResult = { result?: { isError?: boolean; content?: Array<{ text?: string }> } };
const textOf = (response: unknown) => (response as CallResult).result?.content?.[0]?.text ?? '';
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

test('calls awaited one after another inside the page keep every edit', async () => {
  const page = headlessWindow();
  const editor = fakeEditor();
  const remove = installHeadlessBridge(hostFor(editor.getApi));
  try {
    for (let line = 0; line < 10; line++) {
      const response = await page.__osg!.mcp(addText(line));
      assert.notEqual((response as CallResult).result?.isError, true, textOf(response));
    }
    await settle();
    assert.equal(editor.count(), 10);
  } finally {
    remove();
  }
});

test('calls sent all at once still run one at a time, each after the last one rendered', async () => {
  const page = headlessWindow();
  const editor = fakeEditor();
  const remove = installHeadlessBridge(hostFor(editor.getApi));
  try {
    const responses = await Promise.all(Array.from({ length: 5 }, (_, line) => page.__osg!.mcp(addText(line))));
    for (const response of responses) assert.notEqual((response as CallResult).result?.isError, true);
    await settle();
    assert.equal(editor.count(), 5);
  } finally {
    remove();
  }
});

/**
 * A stand-in for the layout while it opens a project: the canvas still holds
 * the outgoing document and every api says canvasReady() is false, until
 * land() puts the incoming document on the canvas and renders.
 */
function openingEditor(outgoing: string[], incoming: string[]) {
  let elements = outgoing;
  let landed = false;
  const build = (seen: string[], ready: boolean): McpDesignApi =>
    new Proxy({} as McpDesignApi, {
      get: (_target, key) => {
        if (key === 'canvasReady') return () => ready;
        if (key === 'agentReadsFolders' || key === 'agentMayHoldFolderData') return () => false;
        if (key === 'addElement') {
          return () => {
            elements = [...seen, `added_${seen.length + 1}`];
            setTimeout(() => {
              api = build(elements, landed);
            }, 0);
            return { id: elements[elements.length - 1] };
          };
        }
        return () => true;
      },
    });
  let api = build(elements, false);
  return {
    getApi: () => api,
    elements: () => elements,
    land: () => {
      elements = incoming;
      landed = true;
      api = build(elements, true);
    },
  };
}

test('a call sent while a project is opening waits for it, then edits the project that opened', async () => {
  const page = headlessWindow();
  const editor = openingEditor(['outgoing_1', 'outgoing_2'], ['opened_1', 'opened_2', 'opened_3']);
  const remove = installHeadlessBridge(hostFor(editor.getApi));
  try {
    let answered = false;
    const call = page.__osg!.mcp(addText(0)).then((response) => {
      answered = true;
      return response;
    });
    await settle();
    // Run now, the element would go onto the outgoing document, which the
    // opening project is about to replace.
    assert.equal(answered, false);
    assert.deepEqual(editor.elements(), ['outgoing_1', 'outgoing_2']);

    editor.land();
    const response = await call;
    assert.notEqual((response as CallResult).result?.isError, true, textOf(response));
    assert.deepEqual(editor.elements(), ['opened_1', 'opened_2', 'opened_3', 'added_4']);
  } finally {
    remove();
  }
});

test('a call is answered, and never run, when the project has not opened before its time is up', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const page = headlessWindow();
  const editor = openingEditor(['outgoing_1'], ['opened_1']);
  const remove = installHeadlessBridge(hostFor(editor.getApi));
  try {
    let response: unknown;
    void page.__osg!.mcp(addText(0)).then((answer) => {
      response = answer;
    });
    // An ordinary call has 10 s, and the line keeps the last second in hand.
    for (let ms = 0; ms <= 10_000 && response === undefined; ms += 10) {
      t.mock.timers.tick(10);
      await new Promise((resolve) => setImmediate(resolve));
    }
    const error = (response as { error?: { message?: string } } | undefined)?.error;
    assert.match(error?.message ?? '', /still opening a project/);
    assert.match(error?.message ?? '', /Nothing was changed/);
    assert.deepEqual(editor.elements(), ['outgoing_1']);
  } finally {
    remove();
    t.mock.timers.reset();
  }
});

test('a call still waiting when the bridge is removed is answered and never run', async () => {
  const page = headlessWindow();
  const editor = fakeEditor();
  const remove = installHeadlessBridge(hostFor(editor.getApi));
  const bridge = page.__osg!;
  await bridge.mcp(addText(0));
  // Waits for the first call's render, so it is still in line when the
  // bridge goes away.
  const late = bridge.mcp(addText(1));
  remove();
  assert.equal(page.__osg, undefined);
  assert.match(textOf(await late), /not ready/);
  await settle();
  assert.equal(editor.count(), 1);
});
