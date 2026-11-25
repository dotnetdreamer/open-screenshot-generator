// The Mac App Store build reports the helper in a detection's `unavailable`
// (src-tauri/src/outside.rs), and every place that says whether Claude Code or
// Codex can answer tells the user to add it rather than that it can't run.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CODEX_READY, answers, callsTo, resetAnswers } from './helpers/claudeDesktop';
import { helperNeed } from '@/lib/appStoreHelper';
import { claudeWriterStatus, codexWriterStatus, detectAgentWriters, knownAgentWriters } from '@/lib/ai/agentPrompt';
import { claudeAgent } from '@/lib/claudeCode/store';
import { growthAiLabel, growthAiUnavailableReason, isGrowthAiAvailable, onGrowthAiChange, refreshGrowthAi } from '@/lib/growth/ai';
import { setGrowthSettings } from '@/lib/growth/settings';

const MAX = { found: true, loggedIn: true, authMethod: 'claude.ai', subscriptionType: 'max' };
const CLAUDE_NO_HELPER = { found: false, unavailable: 'helper-missing' };
const CODEX_NO_HELPER = { found: false, models: [], unavailable: 'helper-missing' };

// Growth's settings listen for other windows' changes. Node has no window events.
Object.assign(globalThis, { addEventListener: () => {}, removeEventListener: () => {} });

/** Wait until `check` holds, for a look the code under test starts without returning it. False after `ms`. */
async function until(check: () => boolean, ms = 1000): Promise<boolean> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) return false;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return true;
}

test('the helper is read from the two values Rust sends, and from nothing else', () => {
  assert.equal(helperNeed('helper-missing'), 'missing');
  assert.equal(helperNeed('helper-outdated'), 'outdated');
  assert.equal(helperNeed('sandboxed'), null);
  assert.equal(helperNeed(null), null);
  assert.equal(helperNeed(undefined), null);
});

test('without the helper Claude Code is not ready, and the reason says how to add it', () => {
  const status = claudeWriterStatus({ found: false, unavailable: 'helper-missing' });
  assert.equal(status.ready, false);
  assert.equal(status.sandboxed, undefined);
  assert.equal(status.detail, "To use Claude Code, add the helper file in the editor's Agent tab");
});

test('an old helper asks for a newer one', () => {
  const status = codexWriterStatus({ found: false, models: [], unavailable: 'helper-outdated' });
  assert.equal(status.ready, false);
  assert.equal(status.detail, "To use Codex, update the helper file in the editor's Agent tab");
});

test('a build that can never run them is still called sandboxed', () => {
  assert.equal(claudeWriterStatus({ found: false, unavailable: 'sandboxed' }).sandboxed, true);
});

// The user saves the helper once, from either agent's card. A look that found
// it missing must not be handed out again, or the other agent keeps showing
// "Add the helper" for a minute after it is saved.
test('the Agent panel looks again after a look that found no helper, and keeps a ready answer', async () => {
  answers.abs_claude_detect = () => ({ found: false, unavailable: 'helper-missing' });
  answers.abs_codex_detect = () => ({ found: false, models: [], unavailable: 'helper-missing' });
  await claudeAgent.detect(true);
  await claudeAgent.detectCodex(true);

  // Saved from the Claude Code card, then the chat switches to Codex: an
  // unforced look, as the switch makes, asks Rust again.
  answers.abs_claude_detect = () => MAX;
  answers.abs_codex_detect = () => CODEX_READY;
  const claudeLooks = callsTo('abs_claude_detect').length;
  const codexLooks = callsTo('abs_codex_detect').length;
  assert.equal((await claudeAgent.detectCodex())?.found, true);
  assert.equal(callsTo('abs_codex_detect').length, codexLooks + 1);
  assert.equal((await claudeAgent.detect())?.found, true);
  assert.equal(callsTo('abs_claude_detect').length, claudeLooks + 1);

  // A ready answer is kept for its minute, as before.
  await claudeAgent.detect();
  await claudeAgent.detectCodex();
  assert.equal(callsTo('abs_claude_detect').length, claudeLooks + 1);
  assert.equal(callsTo('abs_codex_detect').length, codexLooks + 1);
  resetAnswers();
});

test('translation and Growth look again while the helper is missing', async () => {
  answers.abs_claude_detect = () => ({ found: false, unavailable: 'helper-missing' });
  answers.abs_codex_detect = () => ({ found: false, models: [], unavailable: 'helper-outdated' });
  await detectAgentWriters({ refresh: true });
  assert.equal(knownAgentWriters()?.claude.helper, 'missing');
  assert.equal(knownAgentWriters()?.codex.helper, 'outdated');

  answers.abs_claude_detect = () => MAX;
  answers.abs_codex_detect = () => CODEX_READY;
  const writers = await detectAgentWriters();
  assert.equal(writers.claude.ready, true);
  assert.equal(writers.codex.ready, true);
  assert.equal(knownAgentWriters()?.claude.helper, undefined);

  // Once both are ready the answer is kept until a refresh.
  const looks = callsTo('abs_claude_detect').length;
  await detectAgentWriters();
  assert.equal(callsTo('abs_claude_detect').length, looks);
  resetAnswers();
});

// Growth looked for both CLIs before the helper was saved, and the user wants
// Codex there. Saving the helper from the Claude Code card looks at Claude
// Code only, so that look has to bring Codex back as well.
test('a helper saved from the Claude Code card makes Codex ready in Growth too', async () => {
  setGrowthSettings({ aiWriter: 'codex' });
  answers.abs_claude_detect = () => CLAUDE_NO_HELPER;
  answers.abs_codex_detect = () => CODEX_NO_HELPER;
  refreshGrowthAi({ refresh: true });
  await detectAgentWriters();
  assert.equal(isGrowthAiAvailable(), false);
  assert.equal(growthAiUnavailableReason(), "To use Codex, add the helper file in the editor's Agent tab");

  answers.abs_claude_detect = () => MAX;
  answers.abs_codex_detect = () => CODEX_READY;
  const codexLooks = callsTo('abs_codex_detect').length;
  await claudeAgent.detect(true);
  assert.ok(await until(() => isGrowthAiAvailable()), 'Codex is ready in Growth');
  assert.equal(growthAiLabel(), 'Codex (ChatGPT Plus plan)');
  assert.equal(callsTo('abs_codex_detect').length, codexLooks + 1, 'one look at Codex');
  setGrowthSettings({ aiWriter: 'auto' });
  resetAnswers();
});

test('a helper found by a look at Codex brings Claude Code back the same way', async () => {
  answers.abs_claude_detect = () => CLAUDE_NO_HELPER;
  answers.abs_codex_detect = () => CODEX_NO_HELPER;
  await detectAgentWriters({ refresh: true });
  answers.abs_claude_detect = () => MAX;
  answers.abs_codex_detect = () => CODEX_READY;
  const claudeLooks = callsTo('abs_claude_detect').length;
  await claudeAgent.detectCodex(true);
  assert.ok(await until(() => knownAgentWriters()?.claude.ready === true), 'Claude Code is ready again');
  assert.equal(callsTo('abs_claude_detect').length, claudeLooks + 1);
  resetAnswers();
});

test('outside the Mac App Store a look at one CLI starts no look at the other', async () => {
  answers.abs_claude_detect = () => MAX;
  answers.abs_codex_detect = () => CODEX_READY;
  await detectAgentWriters({ refresh: true });
  const codexLooks = callsTo('abs_codex_detect').length;
  const claudeLooks = callsTo('abs_claude_detect').length;
  await claudeAgent.detect(true);
  await claudeAgent.detectCodex(true);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(callsTo('abs_codex_detect').length, codexLooks + 1);
  assert.equal(callsTo('abs_claude_detect').length, claudeLooks + 1);
  resetAnswers();
});

// Growth asks once and keeps the answer, so a helper saved some other way
// (by hand in Finder, say) showed only after a restart.
test('coming back to Growth looks again while the helper is missing, and only then', async () => {
  answers.abs_claude_detect = () => CLAUDE_NO_HELPER;
  answers.abs_codex_detect = () => CODEX_NO_HELPER;
  refreshGrowthAi({ refresh: true });
  await detectAgentWriters();
  assert.equal(knownAgentWriters()?.codex.helper, 'missing');

  answers.abs_claude_detect = () => MAX;
  answers.abs_codex_detect = () => CODEX_READY;
  const looks = callsTo('abs_codex_detect').length;
  onGrowthAiChange(() => {})();
  assert.ok(await until(() => knownAgentWriters()?.codex.ready === true), 'the second visit found the helper');
  assert.equal(callsTo('abs_codex_detect').length, looks + 1);

  onGrowthAiChange(() => {})();
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(callsTo('abs_codex_detect').length, looks + 1, 'a ready answer is kept');
  resetAnswers();
});

test('calls made while a look runs without the helper share that look', async () => {
  answers.abs_claude_detect = () => CLAUDE_NO_HELPER;
  answers.abs_codex_detect = () => CODEX_NO_HELPER;
  await detectAgentWriters({ refresh: true });

  let release = () => {};
  const gate = new Promise<void>((resolve) => (release = resolve));
  answers.abs_claude_detect = async () => (await gate, CLAUDE_NO_HELPER);
  answers.abs_codex_detect = async () => (await gate, CODEX_NO_HELPER);
  const looks = callsTo('abs_codex_detect').length;
  const claudeLooks = callsTo('abs_claude_detect').length;
  const calls = [detectAgentWriters(), detectAgentWriters(), detectAgentWriters()];
  release();
  await Promise.all(calls);
  assert.equal(callsTo('abs_codex_detect').length, looks + 1);
  assert.equal(callsTo('abs_claude_detect').length, claudeLooks + 1);

  // The next call, after that look, looks again.
  await detectAgentWriters();
  assert.equal(callsTo('abs_codex_detect').length, looks + 2);
  resetAnswers();
});
