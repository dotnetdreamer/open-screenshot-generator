// The Mac app runs in the system's web view, and macOS 10.15 goes no further
// than Safari 15.6. A pattern that WebKit can't parse, built when a module
// loads, stops the whole editor loading. So:
// - no regular expression in src/ has a lookbehind (WebKit before Safari
//   16.4 can't parse one) or the v flag (Safari 17), whether it's a literal,
//   a string handed to RegExp, or text a pattern is built from;
// - nothing of the SEO view loads with the editor but its loader: its checks
//   are ports of Python patterns, and the view loads on its own
//   (LazySeoWorkspace), so whatever one web view can't read fails there, not
//   in the editor;
// - every package the app bundles that WebKit 15 can't parse is in
//   transpilePackages (next.config.ts). Next compiles the app's own code for
//   older browsers but ships packages as they come, and three.js's class
//   static blocks stopped every 3D device loading in WebKit 15.4.

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

/** The whole app as esbuild bundles it from the page, dynamic imports and all; built once for the tests below. */
let built: Promise<import('esbuild').BuildResult<{ metafile: true; write: false }>> | null = null;
function bundle() {
  const esbuild = load('esbuild') as typeof import('esbuild');
  built ??= esbuild.build({
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
  return built;
}

test("the editor loads nothing of the SEO view's at the start but its loader", async () => {
  // What the page reaches by static imports: a dynamic import() is a chunk loaded later.
  const inputs = (await bundle()).metafile.inputs;
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

/** The package a bundled file comes from: "three", "@scope/name". */
function packageOf(file: string): string {
  const parts = file.slice(file.lastIndexOf('node_modules/') + 'node_modules/'.length).split('/');
  return parts[0].startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0];
}

/** What WebKit 15 can't parse in a file: a class static block (Safari 16.4), a pattern with a lookbehind (16.4) or the v flag (17). */
function tooNewSyntax(text: string, acorn: typeof import('acorn')): string[] {
  const options = { ecmaVersion: 'latest', allowHashBang: true, allowReturnOutsideFunction: true, allowAwaitOutsideFunction: true, allowImportExportEverywhere: true } as const;
  let tree: unknown;
  try {
    tree = acorn.parse(text, { ...options, sourceType: 'module' });
  } catch {
    // Old CommonJS can be sloppy-mode code that a module can't be.
    tree = acorn.parse(text, { ...options, sourceType: 'script' });
  }
  const found = new Set<string>();
  const stack: unknown[] = [tree];
  while (stack.length) {
    const node = stack.pop();
    if (!node || typeof node !== 'object') continue;
    const { type, regex } = node as { type?: string; regex?: { pattern: string; flags: string } };
    if (type === 'StaticBlock') found.add('a class static block');
    if (type === 'Literal' && regex) {
      if (hasLookbehind(regex.pattern)) found.add('a lookbehind');
      if (regex.flags.includes('v')) found.add('the v flag');
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) for (const child of value) stack.push(child);
      else if (value && typeof value === 'object') stack.push(value);
    }
  }
  return [...found];
}

/** The packages next.config.ts has Next compile like the app's own code. */
function transpiled(): string[] {
  const text = fs.readFileSync(path.join(repo, 'next.config.ts'), 'utf8');
  const list = /transpilePackages:\s*\[([^\]]*)\]/.exec(text);
  return list ? [...list[1].matchAll(/'([^']+)'|"([^"]+)"/g)].map((match) => match[1] ?? match[2]) : [];
}

test("every package the app bundles that WebKit 15 can't parse is compiled like the app's code (transpilePackages)", async () => {
  const acorn = load('acorn') as typeof import('acorn');
  // The scan finds each kind, or a package needing the list would pass unseen.
  assert.deepEqual(tooNewSyntax('class A { static { A.x = 1; } }\nconst a = /(?<=a)b/;\nconst b = /[a]/v;\nconst c = /(?:a)[(?<=]/;', acorn).sort(), ['a class static block', 'a lookbehind', 'the v flag']);
  const inputs = (await bundle()).metafile.inputs;
  const needs = new Map<string, Set<string>>();
  const scanned = new Set<string>();
  for (const file of Object.keys(inputs)) {
    if (!file.includes('node_modules/') || !/\.[cm]?js$/.test(file)) continue;
    const name = packageOf(file);
    scanned.add(name);
    for (const what of tooNewSyntax(fs.readFileSync(path.resolve(repo, file), 'utf8'), acorn)) {
      if (!needs.has(name)) needs.set(name, new Set());
      needs.get(name)!.add(what);
    }
  }
  const listed = transpiled();
  const missing = [...needs].filter(([name]) => !listed.includes(name)).map(([name, what]) => `${name}: ${[...what].join(', ')}`);
  assert.deepEqual(missing, []);
  // three.js is reached only through the 3D devices' dynamic import, so this proves the scan follows those.
  assert.ok(scanned.has('three'), 'the scan never reached three.js: it missed what loads later');
  assert.ok(scanned.size > 50, `only ${scanned.size} packages scanned: the build missed most of the app`);
});
