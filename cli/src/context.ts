/**
 * What every command is handed, and what every command hands back.
 *
 * A command is a module exporting `run(ctx): Promise<number>` where the number
 * is the process exit code (see errors.ts for the contract). Commands never
 * call process.exit themselves and never print to stdout except through
 * `emit`, so `--json` stays parseable and a command stays callable from
 * another command (which `osg all` relies on).
 */
import path from 'node:path';
import type { ParsedArgs } from './args.js';
import type { LoadedConfig, OsgConfig } from './config.js';
import { DEFAULTS } from './config.js';
import { flagBool, flagString } from './args.js';
import type { Session, SessionOptions } from './driver/session.js';
import { startSession } from './driver/session.js';

export interface CommandContext {
  args: ParsedArgs;
  loaded: LoadedConfig;
  config: OsgConfig;
  /** Everything relative resolves against this: the config's directory. */
  root: string;
  json: boolean;
  offline: boolean;
  /** Absolute output directory (config.out, or --out). */
  outDir: string;
  /** Absolute path of the committed project file (config.project, or --project). */
  projectFile: string;
  /** Lazily started, and reused: a command that needs the browser twice pays once. */
  session(overrides?: Partial<SessionOptions>): Promise<Session>;
  /** Close a session if one was started. Called by the CLI, not by commands. */
  dispose(): Promise<void>;
}

export function buildContext(args: ParsedArgs, loaded: LoadedConfig): CommandContext {
  const config = loaded.config;
  const root = loaded.root;
  const outDir = path.resolve(root, flagString(args.flags, 'out') ?? config.out ?? DEFAULTS.out);
  const projectFile = path.resolve(root, flagString(args.flags, 'project') ?? config.project ?? DEFAULTS.project);
  const offline = flagBool(args.flags, 'offline', false);
  const assetsBaseUrl = flagString(args.flags, 'assets-base-url') ?? config.assetsBaseUrl ?? DEFAULTS.assetsBaseUrl;

  let started: Session | null = null;

  return {
    args,
    loaded,
    config,
    root,
    json: flagBool(args.flags, 'json', false),
    offline,
    outDir,
    projectFile,

    async session(overrides = {}) {
      if (started) return started;
      started = await startSession({
        editorUrl: flagString(args.flags, 'editor-url') ?? config.editorUrl,
        assetsBaseUrl,
        browser: flagString(args.flags, 'browser') ?? config.browser,
        headed: flagBool(args.flags, 'headed', false),
        offline,
        downloadDir: outDir,
        cwd: root,
        ...overrides,
      });
      return started;
    },

    async dispose() {
      if (started) {
        const session = started;
        started = null;
        await session.close();
      }
    },
  };
}
