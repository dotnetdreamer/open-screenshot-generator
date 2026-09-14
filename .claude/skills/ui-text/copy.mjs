#!/usr/bin/env node
/*
 * Checks UI copy before it lands, and finds the tests that read a string.
 *
 * The app's own strings are hardcoded in the components (there is no UI
 * dictionary; src/lib/i18n/ translates the user's screenshots, not the editor).
 * So there is nothing to edit in bulk. What goes wrong is a sentence that
 * breaks a house rule, or a reword that breaks a test matching the old text.
 *
 *   node .claude/skills/ui-text/copy.mjs check              lines added since HEAD
 *   node .claude/skills/ui-text/copy.mjs check --all <file> every line of a file
 *   node .claude/skills/ui-text/copy.mjs locked "<text>" [...]
 *
 * `check` only reads added lines by default, because the older strings in
 * OpenScreenshotGeneratorLayout.tsx break most of these rules and are not
 * worth rewriting on their own. It exits 1 when it finds something.
 *
 * `locked` searches every place that matches on UI text: the Playwright specs
 * and helpers, and the app-screenshots driver scripts.
 */

import { execSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const MATCHER_DIRS = ['tests/e2e', '.claude/skills/app-screenshots/scripts'];

/** Capitalised words that are names, not Title Case. */
const PROPER = new Set(
  `App Store Play Google Drive GitHub Gist Apple Android iPhone iPad Mac macOS Windows Linux
  Watch Wear OS TV Vision Pro Max Plus Pixel Galaxy Chrome Safari Edge Firefox AI MCP API
  PNG JPG JPEG SVG CSV JSON MP4 URL ID OK Cmd Ctrl Shift Alt Option Tauri Claude ChatGPT
  Gemini OpenAI Copilot DeepSeek Qwen Perplexity GLM Ollama LM Studio LibreTranslate I
  English Arabic Urdu Hindi Chinese Japanese Korean French German Spanish Portuguese RTL 3D 2D`
    .split(/\s+/)
    .filter(Boolean)
);

const SHORT_KINDS = new Set(['title', 'label', 'aria-label', 'placeholder', 'alt']);

const die = (msg) => {
  console.error(`copy: ${msg}`);
  process.exit(1);
};

/** Every UI string on one source line, with what kind of slot it sits in. */
function stringsOn(line) {
  const trimmed = line.trim();
  if (/^(\/\/|\/\*|\*)/.test(trimmed)) return [];
  const out = [];
  const lit = `(['"\`])((?:\\\\.|(?!\\2).)*)\\2`;
  const pairs = new RegExp(`\\b(title|description|label|placeholder)\\s*:\\s*${lit}`, 'g');
  const attrs = new RegExp(`\\b(title|aria-label|placeholder|label|description|alt)\\s*=\\s*\\{?\\s*${lit}`, 'g');
  for (const re of [pairs, attrs]) {
    for (const m of line.matchAll(re)) out.push({ kind: m[1], text: m[3] });
  }
  for (const m of line.matchAll(/>\s*([A-Z][^<>{}]*\s[^<>{}]*?)\s*</g)) out.push({ kind: 'text', text: m[1] });
  // A JSX text node that prettier put on a line of its own.
  if (!out.length && /^[A-Z][a-z']*( [^<>{}=;()|&]+){2,}$/.test(trimmed)) out.push({ kind: 'text', text: trimmed });
  // Single tokens like 'iphone-15' are ids in config objects, not copy.
  return out.filter((s) => s.text.includes(' ') || /^[A-Z][a-z]+$/.test(s.text));
}

function problems({ kind, text }) {
  const found = [];
  if (/[—–]/.test(text)) found.push('em or en dash, use a comma, period, colon or "to"');
  if (/[‘’“”]/.test(text)) found.push('curly quote');
  if (SHORT_KINDS.has(kind) && /[^.]\.$/.test(text.trim())) found.push(`trailing period on a ${kind}`);
  if (/see (the )?console|check the console/i.test(text)) found.push('points at the console, which a user never opens');
  if (/there was an error|an error occurred|something went wrong|^error$/i.test(text.trim())) {
    found.push('names no state, say what did not happen');
  }
  if (/^failed to\b/i.test(text.trim())) found.push('"Failed to ..." leads with the apology, say the state');
  const selling = text.match(/\b(simply|easily|instantly|seamless(ly)?|effortless(ly)?|powerful|oops|just)\b/i);
  if (selling) found.push(`"${selling[0]}" sells or hedges, cut it`);
  if (kind === 'title' || kind === 'label' || kind === 'aria-label') {
    const words = text.replace(/\$\{[^}]*\}/g, 'x').split(/\s+/).slice(1);
    const caps = words.filter((w) => /^[A-Z][a-z]+$/.test(w) && !PROPER.has(w));
    if (caps.length) found.push(`Title Case (${caps.join(', ')}), use sentence case`);
  }
  return found;
}

/** Lines added since HEAD, tracked or not, under src/. */
function addedLines() {
  const lines = [];
  const diff = execSync('git diff -U0 HEAD -- src', { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20 });
  let file = '';
  let at = 0;
  for (const row of diff.split('\n')) {
    if (row.startsWith('+++ ')) file = row.slice(6);
    else if (row.startsWith('@@')) at = Number(row.match(/\+(\d+)/)[1]);
    else if (row.startsWith('+') && file) lines.push({ file, n: at++, line: row.slice(1) });
  }
  const untracked = execSync('git ls-files --others --exclude-standard -- src', { cwd: ROOT, encoding: 'utf8' });
  for (const file of untracked.split('\n').filter((f) => /\.(tsx?|jsx?)$/.test(f))) {
    readFileSync(join(ROOT, file), 'utf8')
      .split('\n')
      .forEach((line, i) => lines.push({ file, n: i + 1, line }));
  }
  return lines.filter((l) => /\.(tsx?|jsx?)$/.test(l.file));
}

function walk(dir, visit) {
  let entries = [];
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (name === 'node_modules' || name.startsWith('.report')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, visit);
    else if (/\.(ts|tsx|js|mjs|json)$/.test(name)) visit(p);
  }
}

const [cmd, ...args] = process.argv.slice(2);

if (cmd === 'check') {
  let lines;
  if (args[0] === '--all') {
    if (!args[1]) die('check --all needs a file');
    lines = args.slice(1).flatMap((f) =>
      readFileSync(resolve(process.cwd(), f), 'utf8')
        .split('\n')
        .map((line, i) => ({ file: relative(ROOT, resolve(process.cwd(), f)), n: i + 1, line }))
    );
  } else {
    lines = addedLines();
  }
  let count = 0;
  for (const { file, n, line } of lines) {
    for (const s of stringsOn(line)) {
      for (const p of problems(s)) {
        count += 1;
        console.log(`${file}:${n}  ${p}\n    ${s.kind}: ${s.text}`);
      }
    }
  }
  console.log(count ? `\n${count} to look at. Title Case and selling words can be false alarms, the rest are not.` : 'copy: nothing to fix');
  process.exit(count ? 1 : 0);
} else if (cmd === 'locked') {
  if (!args.length) die('locked needs the text to look for');
  const files = [];
  for (const dir of MATCHER_DIRS) walk(join(ROOT, dir), (p) => files.push(p));
  for (const text of args) {
    const needle = text.toLowerCase();
    const hits = [];
    for (const p of files) {
      readFileSync(p, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (line.toLowerCase().includes(needle)) hits.push(`${relative(ROOT, p)}:${i + 1}  ${line.trim()}`);
        });
    }
    console.log(hits.length ? `LOCKED  "${text}"\n  ${hits.join('\n  ')}` : `free    "${text}"`);
  }
} else {
  console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0]);
  process.exit(cmd ? 1 : 0);
}
