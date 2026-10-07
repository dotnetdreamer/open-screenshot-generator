// The Claude Code agent's pure parts: folding stream-json into a transcript,
// the lines written to stdin, and the small helpers around them. The stream
// fixture is a real run of Claude Code 2.1.202 against a stub design server,
// trimmed of thinking blocks and local paths.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  appendUserTurn,
  describeExit,
  markExited,
  reduceStreamLine,
  reduceStreamMessage,
  stripToolPrefix,
} from '@/lib/claudeCode/streamReducer';
import {
  buildAttachmentNote,
  buildFirstRunBrief,
  composeTurnText,
  defaultStartText,
  encodeInterrupt,
  encodeUserMessage,
} from '@/lib/claudeCode/prompt';
import { FOLDERS_CHANGED_NOTE } from '@/lib/claudeCode/folders';
import {
  INITIAL_AGENT_STATE,
  type AgentEditorContext,
  type AgentImage,
  type AgentItem,
  type AgentSessionState,
} from '@/lib/claudeCode/types';
import { slimAgentView, type AgentPanelView } from '@/lib/claudeCode/view';
import { pickCanvasSize, projectNameFromInstruction } from '@/lib/claudeCode/startProject';
import { KEEP_CHATS, chatListItems, chatTitle, chatUpdatedAt, upsertChatSummary, type AgentChatSummary } from '@/lib/claudeCode/chats';
import { agentContextLabel, buildAgentContext } from '@/lib/claudeCode/context';
import { toolDetail, toolImageAlt, toolLabel, toolSkipped } from '@/lib/claudeCode/toolLabels';
import type { ArtboardState } from '@/types/artboard';

const FIXTURE = path.join(process.cwd(), 'tests', 'unit', 'fixtures', 'claude', 'tool-turn.jsonl');

function replay(lines: string[], start: AgentSessionState = INITIAL_AGENT_STATE): AgentSessionState {
  let state = appendUserTurn(start, { id: 'u1', text: 'Add a text', attachments: 0 }, 1000);
  lines.forEach((line, index) => {
    state = reduceStreamLine(state, line, 2000 + index);
  });
  return state;
}

test('a real turn folds into a transcript', () => {
  const lines = fs.readFileSync(FIXTURE, 'utf8').split('\n').filter(Boolean);
  const state = replay(lines);

  assert.equal(state.status, 'ready');
  assert.equal(state.sessionId, '29fa411b-b24e-4d0c-b093-979843c48ffe');
  assert.equal(state.model, 'claude-haiku-4-5-20251001');
  assert.equal(state.toolsConnected, true);
  assert.equal(state.billedToApiKey, false);
  assert.equal(state.turnStartedAt, null);
  assert.equal(state.rateLimit?.status, 'allowed');
  assert.equal(state.lastTurn?.turns, 4);

  const kinds = state.items.map((item) => item.kind);
  assert.deepEqual(kinds, ['user', 'text', 'tool', 'tool', 'text']);

  const tools = state.items.filter((item): item is Extract<AgentItem, { kind: 'tool' }> => item.kind === 'tool');
  assert.equal(tools[0].name, 'Skill');
  assert.equal(tools[0].status, 'done');
  assert.equal(tools[1].name, 'add_text');
  assert.equal(tools[1].status, 'done');
  assert.match(tools[1].result ?? '', /el_1/);
  assert.equal(tools[1].detail, '"BANANA"');
  // Nothing in a successful turn should read as a problem.
  assert.equal(state.items.some((item) => item.kind === 'notice'), false);
});

test('replaying the same line twice adds nothing', () => {
  const lines = fs.readFileSync(FIXTURE, 'utf8').split('\n').filter(Boolean);
  const once = replay(lines);
  const twice = replay([...lines, ...lines]);
  assert.equal(twice.items.length, once.items.length);
});

test('tool names lose the server prefix', () => {
  assert.equal(stripToolPrefix('mcp__osg-editor__add_element'), 'add_element');
  assert.equal(stripToolPrefix('mcp__osg-editor__set_localized_texts'), 'set_localized_texts');
  assert.equal(stripToolPrefix('Skill'), 'Skill');
});

test('an interrupted turn ends as stopped, not as an error', () => {
  const working = appendUserTurn(INITIAL_AGENT_STATE, { id: 'u', text: 'go', attachments: 0 }, 1);
  const state = reduceStreamMessage(
    working,
    { type: 'result', subtype: 'error_during_execution', is_error: true, result: 'undefined', terminal_reason: 'aborted_streaming', uuid: 'r1' },
    5
  );
  assert.equal(state.status, 'ready');
  const notice = state.items.at(-1);
  assert.equal(notice?.kind, 'notice');
  assert.equal(notice?.kind === 'notice' && notice.tone, 'info');
  assert.equal(notice?.kind === 'notice' && notice.text, 'Stopped');
});

test('a failed turn explains itself', () => {
  const working = appendUserTurn(INITIAL_AGENT_STATE, { id: 'u', text: 'go', attachments: 0 }, 1);
  const stale = reduceStreamMessage(
    working,
    {
      type: 'result',
      subtype: 'error_during_execution',
      is_error: true,
      errors: ['No conversation found with session ID: 11111111-2222-3333-4444-555555555555'],
      uuid: 'r2',
    },
    5
  );
  const notice = stale.items.at(-1);
  assert.equal(notice?.kind === 'notice' && notice.tone, 'error');
  assert.match(notice?.kind === 'notice' ? notice.text : '', /No conversation found/);

  const signedOut = reduceStreamMessage(
    working,
    { type: 'result', subtype: 'success', is_error: true, result: 'Invalid API key · Please run /login', uuid: 'r3' },
    5
  );
  const last = signedOut.items.at(-1);
  assert.match(last?.kind === 'notice' ? last.text : '', /not signed in/);
});

test('missing design tools and API key billing are each said once', () => {
  const init = (uuid: string) => ({
    type: 'system',
    subtype: 'init',
    session_id: 's',
    model: 'm',
    mcp_servers: [{ name: 'osg-editor', status: 'failed' }],
    apiKeySource: 'ANTHROPIC_API_KEY',
    uuid,
  });
  let state = reduceStreamMessage(INITIAL_AGENT_STATE, init('a'), 1);
  state = reduceStreamMessage(state, init('b'), 2);
  const notices = state.items.filter((item) => item.kind === 'notice');
  assert.equal(notices.length, 2);
  assert.equal(state.toolsConnected, false);
  assert.equal(state.billedToApiKey, true);
});

test('design tools still connecting are not reported as unreachable', () => {
  const init = { type: 'system', subtype: 'init', session_id: 's', model: 'm', mcp_servers: [{ name: 'osg-editor', status: 'pending' }], uuid: 'p' };
  let state = reduceStreamMessage(INITIAL_AGENT_STATE, init, 1);
  assert.equal(state.items.filter((item) => item.kind === 'notice').length, 0);
  assert.equal(state.toolsConnected, null);
  // Claude Code's own Read answering says nothing about the design server.
  state = reduceStreamMessage(
    state,
    { type: 'assistant', uuid: 'a1', message: { content: [{ type: 'tool_use', id: 'r1', name: 'Read', input: { file_path: '/x/README.md' } }] } },
    2
  );
  state = reduceStreamMessage(state, { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'r1', content: 'ok' }] } }, 3);
  assert.equal(state.toolsConnected, null);
  // A design tool answering does.
  state = reduceStreamMessage(
    state,
    { type: 'assistant', uuid: 'a2', message: { content: [{ type: 'tool_use', id: 't1', name: 'mcp__osg-editor__list_artboards', input: {} }] } },
    4
  );
  state = reduceStreamMessage(state, { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: '[]' }] } }, 5);
  assert.equal(state.toolsConnected, true);
  // A later turn's init that still says pending keeps what the tool proved.
  state = reduceStreamMessage(state, { ...init, uuid: 'q' }, 6);
  assert.equal(state.toolsConnected, true);
  assert.equal(state.items.filter((item) => item.kind === 'notice').length, 0);
});

test('a process that dies mid-turn leaves nothing spinning', () => {
  let state = appendUserTurn(INITIAL_AGENT_STATE, { id: 'u', text: 'go', attachments: 0 }, 1);
  state = reduceStreamMessage(
    state,
    { type: 'assistant', uuid: 'a1', message: { content: [{ type: 'tool_use', id: 't1', name: 'mcp__osg-editor__export_png', input: { scale: 0.25 } }] } },
    2
  );
  assert.equal(state.items.at(-1)?.kind === 'tool' && (state.items.at(-1) as { status: string }).status, 'running');
  const exited = markExited(state, 3);
  assert.equal(exited.status, 'stopped');
  const tool = exited.items.find((item) => item.kind === 'tool');
  assert.equal(tool?.kind === 'tool' && tool.status, 'error');
});

test('exit messages come from stderr', () => {
  assert.match(describeExit(1, ['Error: Invalid API key · Please run /login']), /not signed in/);
  assert.equal(
    describeExit(1, ['Claude Code on Windows requires either Git for Windows (for bash) or PowerShell']),
    'Claude Code stopped: Claude Code on Windows requires either Git for Windows (for bash) or PowerShell'
  );
  assert.equal(describeExit(3, []), 'Claude Code stopped (exit code 3)');
});

test('user turns and interrupts encode as one line of stream-json', () => {
  const line = encodeUserMessage('hello', [{ mediaType: 'image/jpeg', data: 'QUJD' }]);
  assert.equal(line.includes('\n'), false);
  const parsed = JSON.parse(line);
  assert.equal(parsed.type, 'user');
  assert.equal(parsed.session_id, '');
  assert.equal(parsed.parent_tool_use_id, null);
  assert.deepEqual(parsed.message.content[0], { type: 'text', text: 'hello' });
  assert.deepEqual(parsed.message.content[1], {
    type: 'image',
    source: { type: 'base64', media_type: 'image/jpeg', data: 'QUJD' },
  });

  const interrupt = JSON.parse(encodeInterrupt('stop-1'));
  assert.deepEqual(interrupt, { type: 'control_request', request_id: 'stop-1', request: { subtype: 'interrupt' } });

  // The bytes Rust's stdin test accepts (stdin_takes_messages_and_interrupts_only
  // in claude_code.rs). Rust refuses a line with any other key, so the two
  // change together.
  assert.equal(
    encodeUserMessage('hi'),
    '{"type":"user","message":{"role":"user","content":[{"type":"text","text":"hi"}]},"parent_tool_use_id":null,"session_id":""}'
  );
  assert.equal(
    encodeInterrupt('interrupt-1727600000000'),
    '{"type":"control_request","request_id":"interrupt-1727600000000","request":{"subtype":"interrupt"}}'
  );
});

/**
 * The lines Rust's stdin allowlist is tested on. claude_code.rs reads this
 * file (the_lines_prompt_ts_writes_pass) and checks that each line passes and
 * goes on to Claude Code as the same message, so a change to the encoders that
 * Rust would refuse fails a test instead of every send. When prompt.ts or the
 * cases below change on purpose, write the file again with OSG_WRITE_GOLDEN=1
 * set for `npm run test:unit -- claudeCode.test`, then run `cargo test --lib`
 * in src-tauri.
 */
const STDIN_GOLDEN = path.join(process.cwd(), 'tests', 'unit', 'fixtures', 'claude', 'stdin-lines.jsonl');

const GOLDEN_CONTEXT: AgentEditorContext = {
  projectId: 'project_1727600000000',
  projectName: 'Marbly screenshots',
  artboards: [
    // The agent can rename a board, so a name can hold what Claude Code
    // would read as a file mention.
    { id: 'artboard_1', name: 'Hero @~/.claude.json x', width: 1290, height: 2796 },
    { id: 'artboard_2', name: 'Streaks \u{1F525}', width: 1290, height: 2796 },
  ],
  activeArtboardId: 'artboard_1',
  // Cut where a bare slice would keep half of the emoji, which Rust's JSON
  // parser refuses.
  selection: [{ id: 'el_1', type: 'text', name: 'Headline', text: `${'x'.repeat(159)}\u{1F525} and more` }],
  activeLocale: 'en',
};

function stdinGoldenLines(): string[] {
  const shot = { ref: 'asset:asset_1_a', width: 1290, height: 2796, fileName: 'home.png' };
  const png: AgentImage = { mediaType: 'image/png', data: 'iVBORw0KGgo=' };
  const jpeg: AgentImage = { mediaType: 'image/jpeg', data: '/9j/4AAQ' };
  const turn = (parts: Parameters<typeof composeTurnText>[0], images: AgentImage[] = []) =>
    encodeUserMessage(composeTurnText(parts), images);
  return [
    // A run's first message from the start screen: the brief, the default
    // words and a screenshot.
    turn(
      {
        context: null,
        preface: buildFirstRunBrief({
          projectName: 'Marbly screenshots',
          artboard: { id: 'artboard_blank_1', width: 1290, height: 2796 },
          screenshots: [shot],
          folders: [{ name: 'Marbly', path: '/Users/me/code/Marbly' }],
        }),
        text: defaultStartText({ screenshots: 1, folders: 1 }),
      },
      [png]
    ),
    // From the panel: the editor context first, and an @ in the words too.
    turn({ context: GOLDEN_CONTEXT, text: 'Mail me@b.com about @README.md' }),
    // A folder change, then two attached pictures, the way the store joins them.
    turn(
      {
        context: GOLDEN_CONTEXT,
        preface: [FOLDERS_CHANGED_NOTE, buildAttachmentNote([shot, { ...shot, ref: 'asset:asset_2_b', fileName: 'stats.png' }])].join('\n\n'),
        text: 'Put my app icon on the first artboard',
      },
      [jpeg, png]
    ),
    // A slash alone, after spaces, after U+FEFF, and after U+0085, which
    // trim() keeps and Rust skips.
    turn({ context: null, text: '/x' }),
    turn({ context: null, text: '  /x' }),
    turn({ context: null, text: '﻿/x' }),
    turn({ context: null, text: '\u0085/x' }),
    // The app's own words ahead of a slash.
    turn({ context: null, preface: 'Brief', text: '/help' }),
    // Mentions after the CJK comma, an ideographic space and the CJK full stop.
    turn({ context: null, text: 'Use these、@a.png and　@b.png。@c.png' }),
    // What Stop sends, with an id shaped like the store's.
    encodeInterrupt('stop-mg7x1k2q'),
  ];
}

test('the stdin lines Rust is tested on are the ones the page writes', () => {
  const lines = stdinGoldenLines();
  if (process.env.OSG_WRITE_GOLDEN === '1') fs.writeFileSync(STDIN_GOLDEN, `${lines.join('\n')}\n`);
  // A Windows checkout may hand the file over with CRLF endings.
  const golden = fs.readFileSync(STDIN_GOLDEN, 'utf8').split(/\r?\n/).filter(Boolean);
  assert.equal(golden.length, lines.length, 'one line in the file per case');
  lines.forEach((line, index) => assert.equal(line, golden[index], `line ${index + 1} of ${STDIN_GOLDEN}`));
  // Every line is one line, so Rust reads each as one message.
  assert.ok(lines.every((line) => !line.includes('\n')));
});

test('a turn carries the editor context ahead of the words', () => {
  const text = composeTurnText({
    context: {
      projectId: 'p1',
      projectName: 'Droply',
      artboards: [{ id: 'a1', name: 'Screen 1', width: 1290, height: 2796 }],
      activeArtboardId: 'a1',
      selection: [{ id: 'e1', type: 'text', text: 'x'.repeat(400) }],
      activeLocale: 'en',
    },
    preface: 'Brief',
    text: 'Make it bigger',
  });
  const [block, preface, words] = text.split('\n\n');
  assert.match(block, /^<editor-context>\n\{[\s\S]*\}\n<\/editor-context>$/);
  const json = JSON.parse(block.replace(/<\/?editor-context>/g, '').trim());
  assert.deepEqual(json.project, { id: 'p1', name: 'Droply' });
  assert.equal(json.artboards[0].active, true);
  assert.ok(json.selection[0].text.length < 200);
  assert.equal(preface, 'Brief');
  assert.equal(words, 'Make it bigger');

  assert.equal(composeTurnText({ context: null, text: ' just this ' }), 'just this');
});

test('a turn never starts with a slash, which Claude Code would run as a command', () => {
  // Rust refuses such a line (abs_claude_send), so the page must never write one.
  assert.equal(composeTurnText({ context: null, text: '/config permissionMode=acceptEdits' }), 'The user wrote: /config permissionMode=acceptEdits');
  assert.equal(composeTurnText({ context: null, text: '  /help ' }), 'The user wrote: /help');
  // Rust skips every char::is_whitespace before it looks for the slash, and
  // U+0085 is one of those that trim() keeps; U+FEFF is trimmed here anyway.
  assert.equal(composeTurnText({ context: null, text: '\u0085/config' }), 'The user wrote: \u0085/config');
  assert.equal(composeTurnText({ context: null, text: '\u0085 \u0085/x' }), 'The user wrote: \u0085 \u0085/x');
  assert.equal(composeTurnText({ context: null, text: '\uFEFF/config' }), 'The user wrote: /config');
  assert.equal(composeTurnText({ context: null, text: '\u0085 a/b' }), '\u0085 a/b');
  // Anything the app puts first already keeps the words off the front.
  assert.equal(composeTurnText({ context: null, preface: 'Brief', text: '/help' }), 'Brief\n\n/help');
  const withContext = composeTurnText({
    context: { projectId: null, projectName: null, artboards: [], activeArtboardId: null, selection: [], activeLocale: null },
    text: '/help',
  });
  assert.match(withContext, /^<editor-context>/);
  assert.equal(composeTurnText({ context: null, text: 'a/b is fine' }), 'a/b is fine');
  // The line itself starts its only text block with those words.
  const line = JSON.parse(encodeUserMessage(composeTurnText({ context: null, text: '/config' })));
  assert.equal(line.message.content[0].text.startsWith('/'), false);
});

test('the first-run brief names the project and every screenshot', () => {
  const brief = buildFirstRunBrief({
    projectName: 'Droply screenshots',
    artboard: { id: 'artboard_blank_1', width: 1290, height: 2796 },
    screenshots: [
      { ref: 'asset:asset_1_a', width: 1290, height: 2796, fileName: 'home.png' },
      { ref: 'asset:asset_2_b', width: 1290, height: 2796, fileName: 'stats.png' },
    ],
  });
  assert.match(brief, /"Droply screenshots"/);
  assert.match(brief, /artboard_blank_1, 1290x2796/);
  assert.match(brief, /0\. asset:asset_1_a \(1290x2796, home\.png\)/);
  assert.match(brief, /1\. asset:asset_2_b/);
  assert.match(brief, /apply_template/);

  assert.match(buildFirstRunBrief({ projectName: 'P', artboard: null, screenshots: [] }), /No screenshots/);
  assert.equal(buildAttachmentNote([]), '');
  assert.match(buildAttachmentNote([{ ref: 'asset:x', width: 1, height: 2, fileName: 'a.png' }]), /asset:x/);
});

test('the first-run brief says when the app code came with the screenshots, or instead of them', () => {
  const marbly = { name: 'Marbly', path: 'C:\\Users\\me\\code\\Marbly' };
  const shot = { ref: 'asset:asset_1_a', width: 1290, height: 2796, fileName: 'home.png' };

  const both = buildFirstRunBrief({ projectName: 'P', artboard: null, screenshots: [shot], folders: [marbly] });
  assert.ok(both.includes('The user also attached their app folder (Marbly). Your instructions list it; read it before you build.'));
  assert.match(both, /0\. asset:asset_1_a/);
  assert.doesNotMatch(both, /No screenshots/);
  // The paths are the system prompt's business, never the turn's.
  assert.equal(both.includes(marbly.path), false);

  const folderOnly = buildFirstRunBrief({ projectName: 'P', artboard: null, screenshots: [], folders: [marbly] });
  assert.ok(
    folderOnly.includes(
      "No screenshots were uploaded, but the user's app folder is attached. Look there for real screenshots first (fastlane/screenshots/<language>, fastlane/metadata/android/<language>/images/phoneScreenshots, a screenshots or store folder, images the README shows) and put the plain screens in the device frames with import_project_image, never finished store images that already have a frame or caption. If there are none, keep the device frames the templates come with, and say so in your reply."
    )
  );
  assert.equal(folderOnly.includes('No screenshots were uploaded. Keep'), false);
  assert.match(folderOnly, /\(Marbly\)/);

  // Two folders of one name are told apart by their parents.
  const two = buildFirstRunBrief({
    projectName: 'P',
    artboard: null,
    screenshots: [],
    folders: [
      { name: 'app', path: '/Users/me/code/ios/app' },
      { name: 'app', path: '/Users/me/code/android/app' },
    ],
  });
  assert.ok(two.includes('their app folders (ios/app, android/app). Your instructions list them'));
  assert.ok(two.includes("the user's app folders are attached"));

  // No folders: exactly the brief from before folders, word for word.
  const plain =
    'This chat was started from the new project dialog. A new, empty project named "P" is open. Build the design in this project. Use apply_template if a template fits, so the result stays in this project.\n\nNo screenshots were uploaded. Keep the device frames the templates come with, and say so in your reply.';
  assert.equal(buildFirstRunBrief({ projectName: 'P', artboard: null, screenshots: [], folders: [] }), plain);
  assert.equal(buildFirstRunBrief({ projectName: 'P', artboard: null, screenshots: [] }), plain);
});

test('the first message says what the user gave when they wrote nothing', () => {
  assert.equal(defaultStartText({ screenshots: 2, folders: 0 }), 'Design store screenshots for my app from these screenshots');
  assert.equal(defaultStartText({ screenshots: 0, folders: 1 }), 'Design store screenshots for my app from its code folder');
  assert.equal(
    defaultStartText({ screenshots: 1, folders: 2 }),
    'Design store screenshots for my app from these screenshots and its code folder'
  );
});

test('a picture a file read returned stays off its row; an export keeps its own', () => {
  const picture = [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'QUJD' } }];
  let state = appendUserTurn(INITIAL_AGENT_STATE, { id: 'u', text: 'go', attachments: 0 }, 1);
  state = reduceStreamMessage(
    state,
    {
      type: 'assistant',
      uuid: 'a1',
      message: {
        content: [
          { type: 'tool_use', id: 'r1', name: 'Read', input: { file_path: 'C:\\code\\Marbly\\icon.png' } },
          { type: 'tool_use', id: 'e1', name: 'mcp__osg-editor__export_png', input: { scale: 0.25 } },
        ],
      },
    },
    2,
    { folders: [{ name: 'Marbly', path: 'C:\\code\\Marbly' }] }
  );
  const read = state.items.find((item) => item.kind === 'tool' && item.toolUseId === 'r1');
  assert.equal(read?.kind === 'tool' && read.detail, 'icon.png');
  state = reduceStreamMessage(
    state,
    {
      type: 'user',
      message: {
        content: [
          { type: 'tool_result', tool_use_id: 'r1', content: picture },
          { type: 'tool_result', tool_use_id: 'e1', content: [...picture, { type: 'text', text: '{}' }] },
        ],
      },
    },
    3
  );
  const tools = state.items.filter((item): item is Extract<AgentItem, { kind: 'tool' }> => item.kind === 'tool');
  assert.equal(tools.find((tool) => tool.toolUseId === 'r1')?.image, undefined);
  assert.equal(tools.find((tool) => tool.toolUseId === 'e1')?.image, 'data:image/png;base64,QUJD');
});

test('the detached view is slim', () => {
  const items: AgentItem[] = Array.from({ length: 80 }, (_, index) => ({
    kind: 'tool' as const,
    id: `t${index}`,
    toolUseId: `tu${index}`,
    name: 'export_png',
    input: { scale: 0.25, big: 'x'.repeat(1000) },
    detail: '25%',
    status: 'done' as const,
    result: 'r'.repeat(2000),
    image: `data:image/png;base64,${'A'.repeat(5000)}`,
    at: index,
  }));
  const view: AgentPanelView = {
    available: true,
    detection: { status: 'done', result: { found: true }, error: null },
    status: 'ready',
    model: 'default',
    effort: 'max',
    resolvedModel: null,
    items,
    omitted: 0,
    toolsConnected: true,
    billedToApiKey: false,
    rateLimit: null,
    lastTurn: null,
    turnStartedAt: null,
    resumable: true,
    contextLabel: null,
    chats: Array.from({ length: 50 }, (_, index) => ({
      id: `chat-${index}`,
      title: 't'.repeat(80),
      projectId: `project_${index}`,
      projectName: 'n'.repeat(120),
      updatedAt: index,
      current: index === 0,
    })),
    projectId: 'project_0',
    folders: [
      { name: 'Marbly', path: 'C:\\Users\\me\\code\\Marbly', label: 'Marbly' },
      { name: 'n'.repeat(200), path: `/Users/me/${'p'.repeat(900)}`, label: 'l'.repeat(200) },
    ],
    folderPicking: true,
    folderNotice: 'You can add up to 3 folders. Remove one to add another',
    foldersLive: false,
    foldersPending: false,
    linksAsText: true,
  };
  const slim = slimAgentView(view);
  // The folders and their flags reach a detached window. A path stays whole,
  // since removing a folder sends it back; the words around it are cut.
  assert.equal(slim.folders.length, 2);
  assert.equal(slim.folders[0].path, 'C:\\Users\\me\\code\\Marbly');
  assert.equal(slim.folders[1].path, view.folders[1].path);
  assert.ok(slim.folders[1].name.length <= 81 && slim.folders[1].label.length <= 81);
  assert.equal(slim.folderPicking, true);
  assert.equal(slim.foldersLive, false);
  assert.equal(slim.foldersPending, false);
  // A chat whose agent once read a folder keeps its links as text in a
  // detached window too, with no process running.
  assert.equal(slim.linksAsText, true);
  assert.equal(slim.folderNotice, view.folderNotice);
  assert.equal(slim.items.length, 60);
  assert.equal(slim.omitted, 20);
  // Past chats travel too, fewer of them and cut short.
  assert.equal(slim.chats.length, 30);
  assert.ok(slim.chats.every((chat) => chat.title.length <= 61 && (chat.projectName?.length ?? 0) <= 41));
  assert.equal(slim.chats[0].current, true);
  const first = slim.items[0];
  assert.equal(first.kind === 'tool' && first.image, undefined);
  assert.deepEqual(first.kind === 'tool' && first.input, {});
  assert.equal(first.kind === 'tool' && first.detail, '25%');
  assert.ok(JSON.stringify(slim).length < 64 * 1024);

  // Long replies: a detached window cannot read past the cut, so the newest
  // keeps most of itself, and the budget drops the oldest instead.
  const replies: AgentItem[] = Array.from({ length: 30 }, (_, index) => ({
    kind: 'text' as const,
    id: `x${index}`,
    text: `${index} ${'w'.repeat(6000)}`,
    at: index,
  }));
  const long = slimAgentView({ ...view, items: replies });
  const newest = long.items.at(-1)!;
  assert.equal(newest.id, 'x29');
  assert.ok(newest.kind === 'text' && newest.text.length >= 4000, 'the newest reply keeps 4000 characters');
  assert.ok(long.items.length < 30 && long.omitted === 30 - long.items.length);
  assert.ok(JSON.stringify(long.items).length <= 32 * 1024);
});

test('past chats are named, ordered and listed under the name the project has now', () => {
  const items: AgentItem[] = [
    { kind: 'notice', id: 'n', tone: 'info', text: 'x', at: 5 },
    { kind: 'user', id: 'u', text: '  Dark   set for Droply ', attachments: 0, at: 10 },
    { kind: 'tool', id: 't', toolUseId: 'tu', name: 'add_elements', input: {}, status: 'done', at: 20, endedAt: 40 },
    { kind: 'text', id: 'r', text: 'Done', at: 30 },
  ];
  assert.equal(chatTitle(items), 'Dark set for Droply');
  assert.equal(chatTitle([]), null);
  assert.equal(chatTitle([{ kind: 'user', id: 'u', text: ' ', attachments: 2, at: 1 }]), 'Screenshots');
  assert.equal(chatTitle([{ kind: 'user', id: 'u', text: 'a'.repeat(200), attachments: 0, at: 1 }])!.length, 81);
  // The newest thing in it, a tool that ended last included.
  assert.equal(chatUpdatedAt(items, 99), 40);
  assert.equal(chatUpdatedAt([], 99), 99);

  const summary = (id: string, updatedAt: number, projectId: string | null = 'p1'): AgentChatSummary => ({
    id,
    sessionId: null,
    projectId,
    projectName: 'Old name',
    title: id,
    model: null,
    createdAt: 0,
    updatedAt,
  });
  let list: AgentChatSummary[] = [summary('a', 1), summary('b', 3)];
  list = upsertChatSummary(list, summary('a', 5));
  assert.deepEqual(list.map((chat) => chat.id), ['a', 'b']);
  for (let i = 0; i < KEEP_CHATS + 5; i++) list = upsertChatSummary(list, summary(`c${i}`, 10 + i));
  assert.equal(list.length, KEEP_CHATS);

  const rows = chatListItems([summary('a', 5), summary('b', 3, 'gone')], 'a', (id) => (id === 'p1' ? 'New name' : null));
  assert.deepEqual(
    rows.map((row) => [row.id, row.projectName, row.current]),
    [
      ['a', 'New name', true],
      ['b', 'Old name', false],
    ]
  );
});

test('the blank project fits the screenshots', () => {
  const fallback = { width: 1024, height: 500 };
  assert.deepEqual(pickCanvasSize([], fallback), fallback);
  // Any phone shot starts on the required App Store iPhone size.
  assert.deepEqual(pickCanvasSize([{ width: 1290, height: 2796 }], fallback), { width: 1206, height: 2622 });
  assert.deepEqual(pickCanvasSize([{ width: 2064, height: 2752 }], fallback), { width: 2064, height: 2752 });
  assert.deepEqual(pickCanvasSize([{ width: 410, height: 502 }], fallback), { width: 422, height: 514 });
  assert.deepEqual(pickCanvasSize([{ width: 2880, height: 1800 }], fallback), { width: 2560, height: 1600 });
  // Every iPad is a tablet, the 11" and the mini included, and an older phone is still a phone.
  for (const ipad of [{ width: 1668, height: 2388 }, { width: 1640, height: 2360 }, { width: 1488, height: 2266 }]) {
    assert.deepEqual(pickCanvasSize([ipad], fallback), { width: 2064, height: 2752 });
  }
  assert.deepEqual(pickCanvasSize([{ width: 750, height: 1334 }], fallback), { width: 1206, height: 2622 });
  assert.deepEqual(pickCanvasSize([{ width: 2796, height: 1290 }], fallback), { width: 2622, height: 1206 });
  // A shot shaped like no device (a window capture) leaves the default size.
  assert.deepEqual(pickCanvasSize([{ width: 830, height: 1000 }], fallback), fallback);
  assert.deepEqual(pickCanvasSize([{ width: 830, height: 1000 }, { width: 1668, height: 2388 }], fallback), {
    width: 2064,
    height: 2752,
  });
  // A tie goes to the phone.
  assert.deepEqual(
    pickCanvasSize([{ width: 2064, height: 2752 }, { width: 1179, height: 2556 }], fallback),
    { width: 1206, height: 2622 }
  );
  assert.equal(projectNameFromInstruction('Dark copy for a habit tracker called Droply.'), 'Droply screenshots');
  assert.equal(projectNameFromInstruction('an app named Kassa Money, please'), 'Kassa Money screenshots');
  assert.equal(projectNameFromInstruction('make it pretty'), 'Claude Code project');
});

test('the context names the selection', () => {
  const artboards = [
    {
      id: 'a1',
      name: 'Screen 1',
      size: { width: 1290, height: 2796 },
      elements: [
        { id: 'e1', type: 'text', content: 'Track every drop', name: 'Headline' },
        { id: 'e2', type: 'device', name: 'Phone' },
      ],
    },
  ] as unknown as ArtboardState[];
  const base = {
    projectId: 'p1',
    projectName: 'Droply',
    artboards,
    activeArtboardId: 'a1',
    activeLocale: null,
  };
  assert.equal(agentContextLabel({ ...base, selectedElementIds: ['e1'] }), '"Track every drop"');
  assert.equal(agentContextLabel({ ...base, selectedElementIds: ['e2'] }), 'Phone');
  assert.equal(agentContextLabel({ ...base, selectedElementIds: ['e1', 'e2'] }), '2 layers');
  assert.equal(agentContextLabel({ ...base, selectedElementIds: [] }), 'Screen 1');
  const context = buildAgentContext({ ...base, selectedElementIds: ['e1', 'gone'] });
  assert.deepEqual(context.selection, [{ id: 'e1', type: 'text', name: 'Headline', text: 'Track every drop' }]);
  assert.deepEqual(context.artboards, [{ id: 'a1', name: 'Screen 1', width: 1290, height: 2796 }]);
});

test('tool rows read as what happened', () => {
  assert.equal(toolLabel('apply_template', 'running'), 'Applying a template...');
  assert.equal(toolLabel('apply_template', 'done'), 'Applied a template');
  assert.equal(toolLabel('some_new_tool', 'done'), 'Some new tool');
  assert.equal(toolDetail('update_element', { elementId: 'e1', content: 'Hello   there' }), '"Hello there"');
  assert.equal(toolDetail('add_elements', { elements: [{}, {}, {}] }), '3 elements');
  assert.equal(toolDetail('apply_template', { templateId: 'template_droply' }), 'droply');
  assert.equal(toolLabel('rename_project', 'done'), 'Renamed the project');
  assert.equal(toolDetail('rename_project', { name: 'First one' }), 'First one');
  assert.equal(toolDetail('Skill', { skill: 'osg-agent:osg-design' }), null);
});

test('reading the code folder reads as what happened, and a refused secret is not an error', () => {
  assert.equal(toolLabel('Read', 'running'), 'Reading a file...');
  assert.equal(toolLabel('Read', 'done'), 'Read a file');
  assert.equal(toolLabel('Read', 'error', 'File does not exist.'), 'Could not read a file');
  assert.equal(toolLabel('Grep', 'running'), 'Searching your files...');
  assert.equal(toolLabel('Grep', 'done'), 'Searched your files');
  assert.equal(toolLabel('Grep', 'error'), 'Could not search your files');
  assert.equal(toolLabel('import_project_image', 'running'), 'Importing an image...');
  assert.equal(toolLabel('import_project_image', 'done'), 'Imported an image');
  // Tools with no error label of their own read as before.
  assert.equal(toolLabel('apply_template', 'error'), 'Applied a template');

  // What Claude Code 2.1.202 says when a deny rule stops a Read, and a Grep on
  // one file. The rules cover lock files and dependencies as well as secrets,
  // so the row says blocked, which is true of all of them.
  const deniedRead = '<tool_use_error>File is in a directory that is denied by your permission settings.</tool_use_error>';
  const deniedGrep = 'Permission to read C:\\code\\Marbly\\.env has been denied.';
  const deniedLock = 'Permission to read C:\\code\\Marbly\\package-lock.json has been denied.';
  assert.equal(toolLabel('Read', 'error', deniedRead), 'Skipped a blocked file');
  assert.equal(toolSkipped('Read', 'error', deniedRead), true);
  assert.equal(toolLabel('Grep', 'error', deniedGrep), 'Skipped a blocked file');
  assert.equal(toolLabel('Grep', 'error', deniedLock), 'Skipped a blocked file');
  // A read outside the folders is refused in other words, and stays an error.
  const outside = 'Permission to use Read has been denied because Claude Code is running in don\'t ask mode.';
  assert.equal(toolSkipped('Read', 'error', outside), false);
  assert.equal(toolLabel('Read', 'error', outside), 'Could not read a file');
  assert.equal(toolSkipped('Read', 'done', deniedRead), false);
  assert.equal(toolSkipped('update_element', 'error', deniedRead), false);

  const folders = [{ name: 'Marbly', path: 'C:\\Users\\me\\code\\Marbly' }];
  assert.equal(toolDetail('Read', { file_path: 'C:\\Users\\me\\code\\Marbly\\ios\\Info.plist' }, folders), 'ios/Info.plist');
  // The agent may write the path with forward slashes and another case.
  assert.equal(toolDetail('Read', { file_path: 'c:/users/me/code/marbly/README.md' }, folders), 'README.md');
  // Outside every folder: the path as it is, cut from the left.
  const far = toolDetail('Read', { file_path: 'D:\\elsewhere\\deep\\down\\in\\a\\very\\long\\path\\to\\Contents.json' }, folders)!;
  assert.ok(far.startsWith('...') && far.endsWith('/to/Contents.json') && far.length <= 48, far);
  const deep = toolDetail(
    'import_project_image',
    {
      path: 'C:\\Users\\me\\code\\Marbly\\ios\\Marbly\\Assets.xcassets\\AppIcon.appiconset\\AccentColor.colorset\\icon-1024.png',
      name: 'App icon',
    },
    folders
  )!;
  assert.ok(deep.startsWith('...') && deep.endsWith('AccentColor.colorset/icon-1024.png') && deep.length <= 48, deep);
  assert.equal(toolDetail('Grep', { pattern: 'CFBundleDisplayName', glob: '**/*.pbxproj' }), '"CFBundleDisplayName"');
  assert.equal(toolDetail('Read', {}), null);

  assert.equal(toolImageAlt('Read', { file_path: 'C:\\code\\Marbly\\icon.png' }), 'icon.png from your folder');
  assert.equal(toolImageAlt('import_project_image', { path: '/code/marbly/logo.svg' }), 'logo.svg from your folder');
  assert.equal(toolImageAlt('export_png', {}), 'The artboard as the agent saw it');
});
