/**
 * The entry point.
 *
 * Three jobs and nothing else: parse argv, load the config, and dispatch to a
 * command module. Commands are imported lazily so that `osg --version` and
 * `osg help` cost one file read rather than the whole program, and so a broken
 * command cannot stop the others from loading.
 *
 * Exit codes are contractual, because agents and CI read them:
 *   0 ok, 1 usage or config, 2 driver or render, 3 verify. See errors.ts.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, flagBool, flagString } from './args.js';
import { loadConfig } from './config.js';
import { buildContext, type CommandContext } from './context.js';
import { EXIT, OsgError } from './errors.js';
import { configureOutput, info, fail, dim, bold, cyan, emit, isJsonMode } from './log.js';

interface CommandSpec {
  name: string;
  summary: string;
  usage: string;
  load: () => Promise<{ run: (ctx: CommandContext) => Promise<number> }>;
}

const COMMANDS: CommandSpec[] = [
  {
    name: 'doctor',
    summary: 'Check everything this machine needs, with a fix for each failure',
    usage: 'osg doctor [--json] [--install-browser]',
    load: () => import('./commands/doctor.js'),
  },
  {
    name: 'init',
    summary: 'Create osg/osg.config.ts so later prompts edit a committed file',
    usage: 'osg init [--template <slug>] [--name <app>]',
    load: () => import('./commands/init.js'),
  },
  {
    name: 'templates',
    summary: 'List and search the bundled templates, with no browser',
    usage: 'osg templates [query] [--category <id>] [--json]',
    load: () => import('./commands/templates.js'),
  },
  {
    name: 'import',
    summary: "Pull an app's existing App Store listing, screenshots and icon",
    usage: 'osg import <url or search terms> [--out <dir>] [--limit <n>]',
    load: () => import('./commands/import.js'),
  },
  {
    name: 'new',
    summary: 'Create a project from a template with your screenshots in it',
    usage: 'osg new --template <slug> [--screenshots <dir>] [--text <id>=<string>]',
    load: () => import('./commands/new.js'),
  },
  {
    name: 'fill',
    summary: 'Rank every template against your screenshots and fill the best, offline and free',
    usage: 'osg fill --screenshots <dir> [--template auto|<slug>] [--format <id>]',
    load: () => import('./commands/fill.js'),
  },
  {
    name: 'design',
    summary: 'The AI agent: screenshots and an instruction become a finished project',
    usage: 'osg design "<instruction>" --screenshots <dir> [--provider <p>] [--model <m>]',
    load: () => import('./commands/design.js'),
  },
  {
    name: 'edit',
    summary: 'Run design tool calls against the open project',
    usage: 'osg edit [--tool <name> --args <json>] [--script <file>] [--stdin]',
    load: () => import('./commands/edit.js'),
  },
  {
    name: 'call',
    summary: 'One design tool call, raw JSON on stdout',
    usage: "osg call <tool> '<json>'   |   osg call --list",
    load: () => import('./commands/call.js'),
  },
  {
    name: 'render',
    summary: 'Render the store PNGs, per format and per language',
    usage: 'osg render [--formats <ids>] [--locales all|<codes>] [--out <dir>]',
    load: () => import('./commands/render.js'),
  },
  {
    name: 'video',
    summary: 'Render the App Store preview video',
    usage: 'osg video [--mode store-raw|store-text|styled] [--recording <file>] [--fps 30]',
    load: () => import('./commands/video.js'),
  },
  {
    name: 'localize',
    summary: 'Add languages, translate, and round trip the copy through CSV',
    usage: 'osg localize [--add <codes>] [--translate] [--csv-out <f>] [--csv-in <f>]',
    load: () => import('./commands/localize.js'),
  },
  {
    name: 'verify',
    summary: 'Audit the rendered files against the store rules. Exit 3 on a failure',
    usage: 'osg verify [<dir>] [--store appstore|play] [--json]',
    load: () => import('./commands/verify.js'),
  },
  {
    name: 'manifest',
    summary: 'Write osg.manifest.json: every board, every file, every verdict',
    usage: 'osg manifest [--out <file>] [--live]',
    load: () => import('./commands/manifest.js'),
  },
  {
    name: 'studio',
    summary: 'Open the real editor on this project so a person can take over',
    usage: 'osg studio [--no-open]',
    load: () => import('./commands/studio.js'),
  },
  {
    name: 'upload',
    summary: 'Push the rendered set to App Store Connect or Google Play',
    usage: 'osg upload --store appstore|play [--locales <codes>] [--dry-run]',
    load: () => import('./commands/upload.js'),
  },
  {
    name: 'mcp',
    summary: 'Serve all the design tools over MCP, for any coding agent',
    usage: 'osg mcp --stdio   |   osg mcp --http [--port 8722]',
    load: () => import('./commands/mcp.js'),
  },
  {
    name: 'install',
    summary: 'Write the MCP entry into your coding agent config',
    usage: 'osg install [--agent claude-code|cursor|vscode|codex] [--all] [--print]',
    load: () => import('./commands/install.js'),
  },
  {
    name: 'cache',
    summary: 'Warm, inspect or prune the artwork and font caches',
    usage: 'osg cache warm|info|prune|seed [--tier <t>] [--fonts] [--from <dir>]',
    load: () => import('./commands/cache.js'),
  },
  {
    name: 'editor',
    summary: 'Show or override which editor bundle the CLI drives',
    usage: 'osg editor status|use <dir>|reset',
    load: () => import('./commands/editor.js'),
  },
  {
    name: 'all',
    summary: 'The whole pipeline: doctor, build, render, video, manifest, verify',
    usage: 'osg all [--design "<instruction>"] [--formats <ids>] [--locales <codes>] [--video]',
    load: () => import('./commands/all.js'),
  },
];

const GLOBAL_FLAGS = `
--config <path>        Use this config file. Also read from OSG_CONFIG
--project <path>       The project file to read and write
--out <dir>            Where rendered files land
--editor-url <url>     Drive a running editor instead of the bundled one
--browser <path>       Use this Chrome, Edge or Chromium
--headed               Show the browser window
--offline              Never reach the network. Fails on an uncached asset
--assets-base-url <u>  Where artwork is hydrated from
--json                 Machine readable output on stdout
--verbose              Explain what is happening, including page errors
--quiet                Only errors
`.trim();

function packageVersion(): string {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(fs.readFileSync(path.resolve(here, '..', 'package.json'), 'utf8')) as {
      version?: string;
    };
    return pkg.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

function printHelp(commandName?: string): void {
  if (commandName) {
    const spec = COMMANDS.find((entry) => entry.name === commandName);
    if (spec) {
      info(`\n  ${bold(spec.name)}  ${spec.summary}\n`);
      info(`  ${cyan(spec.usage)}\n`);
      info(`  ${dim('Global flags')}\n${GLOBAL_FLAGS.replace(/^/gm, '  ')}\n`);
      return;
    }
  }
  const width = Math.max(...COMMANDS.map((entry) => entry.name.length));
  info(`\n  ${bold('open-screenshot-generator')} ${dim(packageVersion())}`);
  info(`  ${dim('App Store and Play Store screenshots, preview videos, and design tools for coding agents')}\n`);
  info(`  ${cyan('npx -y open-screenshot-generator@0 <command>')}\n`);
  for (const spec of COMMANDS) {
    info(`  ${spec.name.padEnd(width)}  ${dim(spec.summary)}`);
  }
  info(`\n  ${dim('Global flags')}\n${GLOBAL_FLAGS.replace(/^/gm, '  ')}`);
  info(`\n  ${dim('Docs')}  https://github.com/dotnetdreamer/open-screenshot-generator/blob/main/docs/CLI.md\n`);
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);

  configureOutput({
    json: flagBool(args.flags, 'json', false),
    verbose: flagBool(args.flags, 'verbose', false),
    quiet: flagBool(args.flags, 'quiet', false),
  });

  if (flagBool(args.flags, 'version', false) || args.command === 'version') {
    if (isJsonMode()) emit({ version: packageVersion() });
    else process.stdout.write(`${packageVersion()}\n`);
    return EXIT.ok;
  }

  if (args.command === 'help' || flagBool(args.flags, 'help', false) || flagBool(args.flags, 'h', false)) {
    printHelp(args.command === 'help' ? args.positionals[0] : args.command);
    return EXIT.ok;
  }

  const spec = COMMANDS.find((entry) => entry.name === args.command);
  if (!spec) {
    fail(`Unknown command: ${args.command}`);
    // A near miss is nearly always a typo, so name the closest rather than
    // dumping the whole list a second time.
    const near = COMMANDS.map((entry) => entry.name).filter(
      (name) => name.startsWith(args.command.slice(0, 2)) || args.command.startsWith(name.slice(0, 2))
    );
    if (near.length) info(`Did you mean: ${near.join(', ')}`);
    printHelp();
    return EXIT.usage;
  }

  const loaded = await loadConfig(flagString(args.flags, 'config'));
  const ctx = buildContext(args, loaded);

  try {
    const mod = await spec.load();
    return await mod.run(ctx);
  } finally {
    // Always tear the browser and the local server down, including on the way
    // out of a failure, or a killed run leaves a headless Chrome behind.
    await ctx.dispose().catch(() => {});
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    if (error instanceof OsgError) {
      fail(error.message);
      if (error.fix) info(`      ${dim(error.fix)}`);
      if (isJsonMode()) emit({ ok: false, error: error.message, fix: error.fix, ...error.detail });
      process.exitCode = error.code;
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    fail(message);
    if (process.env.OSG_DEBUG && error instanceof Error && error.stack) info(error.stack);
    else info(dim('Re-run with --verbose, or set OSG_DEBUG=1 for a stack trace.'));
    if (isJsonMode()) emit({ ok: false, error: message });
    process.exitCode = EXIT.driver;
  });
