// Builds the publishable CLI: cli/dist/cli.js and cli/tools.json.
//
// One esbuild pass produces the executable, because the CLI imports node-pure
// modules out of the app's own src/ through the `@` alias (template metadata,
// store rules, the AI prompt builders) and shipping those as loose TypeScript
// would mean a second toolchain in the tarball. Bundling is also what keeps
// the runtime dependency list at three packages.
//
// A second pass writes tools.json, the static tool table the MCP server answers
// tools/list from. Without it `osg mcp` would have to boot a browser before it
// could tell an agent what it can do, which is a two second stall on a call
// every MCP client makes at connect time.
//
// esbuild comes from the repository root's node_modules via createRequire, the
// same way scripts/gen-ai-catalog.mjs gets it: the CLI package deliberately
// does not depend on a bundler, since nobody installing `osg` should download
// one.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const cliRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = path.resolve(cliRoot, '..');
const { build } = createRequire(path.join(repo, 'package.json'))('esbuild');

const pkg = JSON.parse(fs.readFileSync(path.join(cliRoot, 'package.json'), 'utf8'));

// Everything that must stay a runtime import.
//
// The three real dependencies are external so their own native and dynamic
// bits keep working. The AI SDK is external for a harder reason: `ai` reaches
// @ai-sdk/gateway, which reaches @vercel/oidc, which does a dynamic require of
// a path esbuild cannot see. Inlined, that dies at import time and takes the
// whole CLI down before it prints its first line, including for the commands
// that never touch a model. The agent runs inside the editor page anyway, so
// nothing on the node side should be pulling these in to begin with; leaving
// them external means a stray import fails loudly at that command instead of
// silently bloating every run.
const EXTERNAL = [
  'puppeteer-core',
  '@puppeteer/browsers',
  'jiti',
  'ai',
  '@ai-sdk/*',
  '@vercel/*',
  // Only ever reached behind isTauri(), which is false in node.
  '@tauri-apps/*',
];

const SHARED = {
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  // The app's own modules resolve through `@`, exactly as they do in the Next
  // build and in scripts/gen-ai-catalog.mjs.
  alias: { '@': path.join(repo, 'src') },
  external: EXTERNAL,
  logLevel: 'silent',
};

async function buildCli() {
  const entry = path.join(cliRoot, 'src/cli.ts');
  if (!fs.existsSync(entry)) {
    throw new Error(`Missing entry ${path.relative(repo, entry)}`);
  }
  const outfile = path.join(cliRoot, 'dist/cli.js');

  await build({
    ...SHARED,
    entryPoints: [entry],
    outfile,
    // npm restores the executable bit from the tarball, but a local `node
    // scripts/build.mjs` followed by `npm link` has to work too.
    banner: { js: '#!/usr/bin/env node' },
  });

  try {
    fs.chmodSync(outfile, 0o755);
  } catch {
    // No-op on Windows, where the mode is not meaningful.
  }
  return { outfile, bytes: fs.statSync(outfile).size };
}

async function buildTools() {
  // The tool table lives in the app, not here, so that a tool added to the
  // editor is a tool the CLI's MCP server advertises with no second edit.
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'osg-tools-'));
  const entryFile = path.join(workDir, 'entry.mjs');
  const bundleFile = path.join(workDir, 'bundle.mjs');
  fs.writeFileSync(
    entryFile,
    `export { getMcpToolSummaries, handleMcpMessage } from ${JSON.stringify(
      path.join(repo, 'src/lib/mcp/desktopMcpServer.ts')
    )};\n`
  );

  await build({ ...SHARED, entryPoints: [entryFile], outfile: bundleFile });

  const lib = await import(pathToFileURL(bundleFile).href);

  // The TOOLS array itself is module-private, so ask the module the same way a
  // client would. handleMcpMessage answers tools/list with a null api, which is
  // the point: the schemas are static and need no canvas.
  const response = await lib.handleMcpMessage({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, null);
  const tools = response?.result?.tools;
  if (!Array.isArray(tools) || tools.length === 0) {
    throw new Error('tools/list returned no tools, the MCP module changed shape');
  }

  // getMcpToolSummaries is the app's own static view of the same array. If the
  // two ever disagree, tools/list has grown a filter and this file would ship a
  // table that does not match the server, so stop rather than guess.
  const summaries = lib.getMcpToolSummaries();
  if (summaries.length !== tools.length) {
    throw new Error(`tool count mismatch: tools/list ${tools.length}, summaries ${summaries.length}`);
  }

  for (const tool of tools) {
    if (!tool.name || !tool.description || !tool.inputSchema) {
      throw new Error(`tool ${tool.name ?? '(unnamed)'} is missing a name, description or inputSchema`);
    }
  }

  // The handshake, taken from the app rather than restated here. Asking the
  // real handleMcpMessage for `initialize` is what keeps the CLI's server
  // introducing itself with the same serverInfo and the same usage paragraph
  // the desktop and relay transports send. Restating them in the CLI is how
  // they drift, which is the bug this whole manifest exists to avoid.
  const hello = await lib.handleMcpMessage(
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
    null
  );
  const handshake = hello?.result;
  if (!handshake?.serverInfo?.name || !handshake?.protocolVersion) {
    throw new Error('initialize returned no serverInfo or protocolVersion, the MCP module changed shape');
  }

  const outfile = path.join(cliRoot, 'tools.json');
  // Sorted, so a rebuild with no tool change produces a byte identical file and
  // the package diff stays readable.
  const sorted = [...tools].sort((a, b) => a.name.localeCompare(b.name));
  fs.writeFileSync(
    outfile,
    `${JSON.stringify(
      {
        version: pkg.version,
        protocolVersion: handshake.protocolVersion,
        serverInfo: handshake.serverInfo,
        instructions: handshake.instructions,
        count: sorted.length,
        tools: sorted.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        })),
      },
      null,
      2
    )}\n`
  );

  fs.rmSync(workDir, { recursive: true, force: true });
  return { outfile, bytes: fs.statSync(outfile).size, count: sorted.length };
}

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;

try {
  fs.mkdirSync(path.join(cliRoot, 'dist'), { recursive: true });

  const cli = await buildCli();
  console.log(`build: ${path.relative(repo, cli.outfile).replace(/\\/g, '/')} ${kb(cli.bytes)}`);

  const tools = await buildTools();
  console.log(
    `build: ${path.relative(repo, tools.outfile).replace(/\\/g, '/')} ${kb(tools.bytes)} (${tools.count} tools)`
  );
} catch (error) {
  console.error(`build failed: ${error.message}`);
  process.exitCode = 1;
}
