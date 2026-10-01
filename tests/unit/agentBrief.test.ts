// The agent's brief lives in src-tauri/claude-agent/ and is compiled into the
// desktop app: the system prompt, the skills, and project-folders.md, which Rust
// adds to the prompt when the user attached their app's code folder to the chat.
// They name the design tools by hand, and a renamed or removed tool fails
// without an error anywhere: the agent reaches for something that is not there.
// So the Markdown is held to the MCP server's own tools/list, read the way the
// agent reads it. (That every skill folder is compiled in is checked on the Rust
// side, next to the list that does it.)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { runMcpRequest } from '@/lib/mcp/desktopMcpServer';

const ROOT = path.join(process.cwd(), 'src-tauri', 'claude-agent');

/** What the agent reads about the user's code folder, only in a chat that has one. */
const FOLDERS = 'project-folders.md';

/** The skill folders. Folders only: Finder leaves a .DS_Store beside them. */
function skillNames(): string[] {
  return fs
    .readdirSync(path.join(ROOT, 'skills'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
}

function brief(): Array<{ file: string; text: string }> {
  return ['system-prompt.md', FOLDERS, ...skillNames().map((skill) => `skills/${skill}/SKILL.md`)].map((file) => ({
    file,
    text: fs.readFileSync(path.join(ROOT, file), 'utf8'),
  }));
}

/**
 * Every snake_case word, with no word boundary in front, so a tool written as
 * mcp__osg-editor__list_artboards is found too. Tool names are all snake_case;
 * the other snake_case words in the brief are the made-up ids of its examples,
 * plus the real names in project-folders.md below.
 */
const SNAKE_CASE = /[a-z][a-z0-9]*(?:_[a-z0-9]+)+/g;
const EXAMPLE_IDS = new Set(['project_123', 'artboard_1', 'el_9', 'asset_1727_ab12cd', 'template_somnia_sleep']);

/**
 * Names from the user's own app code (Android's app_name and ic_launcher,
 * fastlane's metadata files, flutter_launcher_icons) and Grep's arguments.
 * project-folders.md names them so the agent opens the right file first. They
 * are allowed in that file only: anywhere else a snake_case word is a tool.
 */
const FILE_WORDS = new Set([
  'app_name',
  'ic_launcher',
  'promotional_text',
  'short_description',
  'full_description',
  'release_notes',
  'flutter_launcher_icons',
  'files_with_matches',
  'head_limit',
  'output_mode',
]);

function isToolName(file: string, word: string): boolean {
  return !EXAMPLE_IDS.has(word) && !(file === FOLDERS && FILE_WORDS.has(word));
}

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
  const files = brief();
  for (const { file, text } of files) {
    const mentioned = [...new Set(text.match(SNAKE_CASE) ?? [])].filter((word) => isToolName(file, word));
    named += mentioned.length;
    assert.deepEqual(
      mentioned.filter((name) => !tools.has(name)),
      [],
      `${file} names tools the osg-editor server does not have`
    );
  }
  // The pattern still finds the names, so an empty result above means something.
  assert.ok(named > 40, `only ${named} tool names found in the brief`);
  // A name the file stops using leaves the list too, so the exception stays as small as the file.
  const folders = files.find((entry) => entry.file === FOLDERS)!.text;
  assert.deepEqual(
    [...FILE_WORDS].filter((word) => !folders.includes(word)),
    [],
    `FILE_WORDS allows names ${FOLDERS} no longer uses`
  );
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

test('the brief is plain ASCII text', () => {
  const files = brief();
  for (const { file, text } of files) {
    // ASCII also keeps out the em and en dashes the copy rules ban, and curly quotes.
    assert.doesNotMatch(text, /[^\x00-\x7f]/, `${file} has a character outside ASCII`);
    // .gitattributes pins src-tauri/claude-agent/ to LF, so every platform ships the same bytes.
    assert.ok(!text.includes('\r'), `${file} has CRLF line endings`);
    // Claude Code runs a `!` line in a skill as the skill loads. None belongs anywhere here.
    assert.ok(!text.includes('!`') && !text.includes('```!'), `${file} has a shell line`);
  }
  // project-folders.md is appended to the system prompt, so it has no frontmatter of its own.
  assert.ok(!files.find((entry) => entry.file === FOLDERS)!.text.startsWith('---'), `${FOLDERS} opens with frontmatter`);
});
