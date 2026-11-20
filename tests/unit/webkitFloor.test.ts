// The Mac app runs in the system's web view, and macOS 10.15 goes no further
// than Safari 15.6. A pattern that WebKit can't parse, built when a module
// loads, stops the whole editor loading. So:
// - no regular expression in src/ has a lookbehind (WebKit before Safari
//   16.4 can't parse one) or the v flag (Safari 17), whether it's a literal,
//   a string handed to RegExp, or text a pattern is built from;
// - nothing of the SEO view loads with the editor but its loader: its checks
//   are ports of Python patterns, and the view loads on its own
//   (LazySeoWorkspace), so whatever one web view can't read fails there, not
//   in the editor.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const repo = process.cwd();
// Loaded from the repo at run time, not bundled into the test.
const load = createRequire(path.join(repo, 'package.json'));
const ts = load('typescript') as typeof import('typescript');

/** Whether a pattern's source has a lookbehind: "(?<=" or "(?<!" outside a class and not escaped. */
function hasLookbehind(source: string): boolean {
  for (let i = 0; i < source.length; i++) {
    if (source[i] === '\\') i++;
    else if (source[i] === '[') {
      for (i++; i < source.length && source[i] !== ']'; i++) if (source[i] === '\\') i++;
    } else if (source[i] === '(' && source[i + 1] === '?' && source[i + 2] === '<' && (source[i + 3] === '=' || source[i + 3] === '!')) {
      return true;
    }
  }
  return false;
}

function* sourceFiles(dir: string): Generator<string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* sourceFiles(full);
    else if (/\.(ts|tsx|js|mjs|cjs)$/.test(entry.name)) yield full;
  }
}

test('no regular expression in src/ has a lookbehind or the v flag, as a literal, a RegExp string or text a pattern is built from', () => {
  const problems: string[] = [];
  let literals = 0;
  for (const file of sourceFiles(path.join(repo, 'src'))) {
    const text = fs.readFileSync(file, 'utf8');
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const where = (node: import('typescript').Node) => `${path.relative(repo, file)}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;
    const visit = (node: import('typescript').Node) => {
      if (ts.isRegularExpressionLiteral(node)) {
        literals++;
        const end = node.text.lastIndexOf('/');
        const body = node.text.slice(1, end);
        const flags = node.text.slice(end + 1);
        if (hasLookbehind(body)) problems.push(`${where(node)}: a lookbehind in ${node.text.slice(0, 60)}`);
        if (flags.includes('v')) problems.push(`${where(node)}: the v flag on ${node.text.slice(0, 60)}`);
      } else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) {
        // Text a pattern may be built from: the strictest reading, any "(?<=" or "(?<!" at all.
        if (/\(\?<[=!]/.test(node.text)) problems.push(`${where(node)}: "(?<" with = or ! in text that may become a pattern`);
      } else if ((ts.isNewExpression(node) || ts.isCallExpression(node)) && node.expression.getText(source) === 'RegExp' && node.arguments && node.arguments.length > 1) {
        const flags = node.arguments[1];
        if ((ts.isStringLiteral(flags) || ts.isNoSubstitutionTemplateLiteral(flags)) && flags.text.includes('v')) problems.push(`${where(node)}: the v flag on a RegExp`);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  assert.deepEqual(problems, []);
  assert.ok(literals > 500, `only ${literals} literals found: the scan missed files`);
});

test("the editor loads nothing of the SEO view's at the start but its loader", async () => {
  const esbuild = load('esbuild') as typeof import('esbuild');
  const result = await esbuild.build({
    entryPoints: [path.join(repo, 'src/app/page.tsx')],
    bundle: true,
    write: false,
    metafile: true,
    splitting: true,
    format: 'esm',
    outdir: path.join(repo, '.webkit-floor-unused'),
    platform: 'browser',
    jsx: 'automatic',
    logLevel: 'silent',
    alias: { '@': path.join(repo, 'src') },
    loader: Object.fromEntries(['.css', '.svg', '.png', '.jpg', '.webp', '.woff2', '.woff', '.ttf', '.wasm', '.glb', '.mp3', '.mp4'].map((ext) => [ext, 'empty'])),
    define: { 'process.env.NODE_ENV': '"production"' },
    external: ['fs', 'path', 'crypto', 'child_process', 'os', 'url', 'stream', 'zlib', 'http', 'https', 'net', 'tls', 'worker_threads'],
  });
  // What the page reaches by static imports: a dynamic import() is a chunk loaded later.
  const inputs = result.metafile.inputs;
  const entry = Object.keys(inputs).find((file) => file.endsWith('src/app/page.tsx'))!;
  const reached = new Set([entry]);
  const queue = [entry];
  while (queue.length) {
    for (const imported of inputs[queue.pop()!]?.imports ?? []) {
      if (imported.kind === 'dynamic-import' || imported.external || reached.has(imported.path)) continue;
      reached.add(imported.path);
      queue.push(imported.path);
    }
  }
  const seo = [...reached].filter((file) => file.includes('src/lib/seo/') || file.includes('components/open-screenshot-generator/seo/'));
  assert.deepEqual(seo, ['src/components/open-screenshot-generator/seo/LazySeoWorkspace.tsx']);
  assert.ok(reached.size > 1000, `only ${reached.size} modules reached: the build missed the editor`);
});
