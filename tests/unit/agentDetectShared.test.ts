// The Agent panel looks for Claude Code and Codex itself (its store's detect,
// and Check again). Translation and Growth go by the same answer, through the
// cache in agentPrompt.ts, so a sign-in the panel saw counts for them at once.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CODEX_READY, answers, resetAnswers } from './helpers/claudeDesktop';
import { claudeAgent } from '@/lib/claudeCode/store';
import { knownAgentWriters } from '@/lib/ai/agentPrompt';
import { availableEngines } from '@/lib/i18n/engines';

test('what the Agent panel finds is what translation goes by', async () => {
  answers.abs_claude_detect = () => ({ found: true, loggedIn: false });
  await claudeAgent.detect(true);
  assert.equal(knownAgentWriters()?.claude.ready, false);
  // Nothing else is set up in this stand-in: no AI panel key, no server.
  assert.deepEqual(availableEngines(), []);

  // Signed in from a terminal, then Check again in the panel.
  answers.abs_claude_detect = () => ({ found: true, loggedIn: true, authMethod: 'claude.ai', subscriptionType: 'max' });
  await claudeAgent.detect(true);
  assert.equal(knownAgentWriters()?.claude.label, 'Claude Code (Max plan)');
  assert.deepEqual(availableEngines(), ['claude']);

  answers.abs_codex_detect = () => CODEX_READY;
  await claudeAgent.detectCodex(true);
  assert.deepEqual(availableEngines(), ['claude', 'codex']);
  resetAnswers();
});
