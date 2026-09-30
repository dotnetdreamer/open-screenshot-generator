// The agent's system prompt and skills live in src-tauri/claude-agent/ and are
// compiled into the desktop app. They name the design tools by hand, and a
// renamed or removed tool fails without an error anywhere: the agent reaches
// for something that is not there. So the Markdown is held to the MCP server's
// own tools/list, read the way the agent reads it. (That every skill folder is
// compiled in is checked on the Rust side, next to the list that does it.)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { runMcpRequest } from '@/lib/mcp/desktopMcpServer';

const ROOT = path.join(process.cwd(), 'src-tauri', 'claude-agent');

/** The skill folders. Folders only: Finder leaves a .DS_Store beside them. */
function skillNames(): string[] {
  return fs
    .readdirSync(path.join(ROOT, 'skills'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

function brief(): Array<{ file: string; text: string }> {
  return ['system-prompt.md', ...skillNames().map((skill) => `skills/${skill}/SKILL.md`)].map((file) => ({
    file,
    text: fs.readFileSync(path.join(ROOT, file), 'utf8'),
  }));
}

/**
 * Every snake_case word, with no word boundary in front, so a tool written as
 * mcp__osg-editor__list_artboards is found too. Tool names are all snake_case;
 * the other snake_case words in the brief are the made-up ids of its examples.
 */
const SNAKE_CASE = /[a-z][a-z0-9]*(?:_[a-z0-9]+)+/g;
const EXAMPLE_IDS = new Set(['project_123', 'artboard_1', 'el_9', 'asset_1727_ab12cd', 'template_somnia_sleep']);

async function toolNames(): Promise<Set<string>> {
  const response = (await runMcpRequest({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, null)) as {
    result: { tools: Array<{ name: string }> };
  };
  return new Set(response.result.tools.map((tool) => tool.name));
}

test('every tool the brief names is one the server has', async () => {
  const tools = await toolNames();
  assert.ok(tools.size > 40, `tools/list answered with ${tools.size} tools`);
  let named = 0;
  for (const { file, text } of brief()) {
    const mentioned = [...new Set(text.match(SNAKE_CASE) ?? [])].filter((word) => !EXAMPLE_IDS.has(word));
    named += mentioned.length;
    assert.deepEqual(
      mentioned.filter((name) => !tools.has(name)),
      [],
      `${file} names tools the osg-editor server does not have`
    );
  }
  // The pattern still finds the names, so an empty result above means something.
  assert.ok(named > 40, `only ${named} tool names found in the brief`);
});

test('the brief loads its skills by the names they have', () => {
  const skills = skillNames();
  const files = brief();
  const prompt = files.find((entry) => entry.file === 'system-prompt.md')!.text;
  for (const skill of skills) {
    const text = files.find((entry) => entry.file === `skills/${skill}/SKILL.md`)!.text;
    assert.match(text, new RegExp(`^---\\nname: ${skill}\\n`), `skills/${skill}/SKILL.md is named after its folder`);
    assert.ok(prompt.includes(`osg-agent:${skill}`), `the system prompt never mentions osg-agent:${skill}`);
  }
  // And the other way round: nothing sends the agent to a skill that is not there.
  for (const { file, text } of files) {
    for (const [, name] of text.matchAll(/osg-agent:([a-z0-9-]*[a-z0-9])/g)) {
      assert.ok(skills.includes(name), `${file} mentions osg-agent:${name}, which is not a skill folder`);
    }
  }
});
