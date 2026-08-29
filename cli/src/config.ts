/**
 * osg.config.ts is the committed source of truth for every visible choice, the
 * same way goldie.config.ts is for goldie. That matters more than it sounds:
 * it is what makes "make it darker" a one line edit and one cheap re-render
 * instead of a re-run of the whole pipeline, and it is what lets a coding agent
 * pick up somebody else's project six months later and know what was intended.
 *
 * Nothing here lives only in the CLI's head. If a command took a flag that
 * changed how the design looks, the flag has a config field, and the doctrine
 * in the skills is: a one run flag is a try, a config edit is a decision.
 *
 * Resolution order, first hit wins:
 *   --config <path>
 *   $OSG_CONFIG
 *   ./osg/osg.config.{ts,mts,js,mjs,json}
 *   ./osg.config.{ts,mts,js,mjs,json}
 *   the "osg" key in ./package.json
 * A missing config is not an error. Every field has a default, so `npx
 * open-screenshot-generator all` works in a bare directory.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { usageError } from './errors.js';
import { debug } from './log.js';

export interface OsgDesignConfig {
  /** Solid colour or gradient css applied to every board's background. */
  background?: string;
  /** Font family for headlines, one of the app's 61 families or an imported one. */
  headlineFont?: string;
  headlineColor?: string;
  subheadColor?: string;
  /** Device type id, e.g. 'iphone-16-pro-max'. Swaps every device frame. */
  device?: string;
  /** Named layout rhythm applied across the set, e.g. 'alternating'. */
  layout?: string;
}

export interface OsgVideoConfig {
  mode?: 'store-raw' | 'store-text' | 'styled';
  fps?: number;
  /** Seconds. Apple accepts 15 to 30. */
  duration?: number;
  /** A screen recording on disk, served to the page over the local origin. */
  recording?: string;
}

export interface OsgAiConfig {
  /** 'anthropic' | 'openai' | 'google' | 'openai-compatible' | a free provider id. */
  provider?: string;
  model?: string;
  baseUrl?: string;
  /** Never put a key here. Use OSG_API_KEY or --api-key. */
  apiKeyEnv?: string;
}

export interface OsgConfig {
  /** App name, used in filenames and in the manifest. */
  name?: string;
  /** The committed project file this repo's store assets are built from. */
  project?: string;
  /** Where rendered files land. */
  out?: string;
  /** Directory of the app screenshots that get placed into the device frames. */
  screenshots?: string;
  /** Template slug to start from, or 'auto' to rank and pick. */
  template?: string;
  /** Size preset ids to render, e.g. ['ios-6-9', 'ipad-13']. */
  formats?: string[];
  /** Locale codes. The first is the base unless baseLocale says otherwise. */
  locales?: string[];
  baseLocale?: string;
  store?: 'appstore' | 'play';
  design?: OsgDesignConfig;
  video?: OsgVideoConfig;
  ai?: OsgAiConfig;
  /** Where artwork the templates reference is hydrated from. */
  assetsBaseUrl?: string;
  /** Drive a running editor instead of the packaged bundle. */
  editorUrl?: string;
  /** Absolute path to a Chrome, Edge or Chromium executable. */
  browser?: string;
}

export interface LoadedConfig {
  config: OsgConfig;
  /** Absolute path of the file it came from, or null for defaults only. */
  file: string | null;
  /** Everything relative in the config resolves against this. */
  root: string;
}

const CANDIDATES = [
  'osg/osg.config.ts',
  'osg/osg.config.mts',
  'osg/osg.config.mjs',
  'osg/osg.config.js',
  'osg/osg.config.json',
  'osg.config.ts',
  'osg.config.mts',
  'osg.config.mjs',
  'osg.config.js',
  'osg.config.json',
];

export const DEFAULTS: Required<Pick<OsgConfig, 'out' | 'project' | 'formats' | 'store' | 'assetsBaseUrl'>> = {
  out: 'osg/out',
  project: 'osg/project.json',
  formats: ['ios-6-9'],
  store: 'appstore',
  // The project's own published deployment. A CLI run fetches exactly the files
  // a browser would fetch visiting the site, and caches them per machine. It is
  // deliberately NOT a redistributed archive: see THIRD-PARTY-ASSETS.md.
  assetsBaseUrl: 'https://editor.openscrgen.app',
};

async function loadModule(file: string): Promise<unknown> {
  if (file.endsWith('.json')) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  }
  if (/\.(ts|mts|cts)$/.test(file)) {
    // jiti is the only reason a TypeScript config is loadable without asking
    // the user to have a build step. goldie takes the same dependency.
    const { createJiti } = (await import('jiti')) as typeof import('jiti');
    const jiti = createJiti(import.meta.url, { interopDefault: true });
    return await jiti.import(file, { default: true });
  }
  const mod = (await import(pathToFileURL(file).href)) as { default?: unknown };
  return mod.default ?? mod;
}

function unwrap(value: unknown): OsgConfig {
  if (!value || typeof value !== 'object') return {};
  const record = value as Record<string, unknown>;
  // Accept `export default defineConfig({...})`, a bare object, or `{ default: {...} }`.
  if (record.default && typeof record.default === 'object') return record.default as OsgConfig;
  return record as OsgConfig;
}

export async function loadConfig(explicitPath: string | undefined, cwd = process.cwd()): Promise<LoadedConfig> {
  const named = explicitPath ?? process.env.OSG_CONFIG?.trim();
  if (named) {
    const file = path.resolve(cwd, named);
    if (!fs.existsSync(file)) {
      throw usageError(`Config not found: ${file}`, 'Pass --config <path>, set OSG_CONFIG, or run `osg init` to create one.');
    }
    debug(`config: ${file}`);
    return { config: unwrap(await loadModule(file)), file, root: path.dirname(file) };
  }

  for (const candidate of CANDIDATES) {
    const file = path.resolve(cwd, candidate);
    if (fs.existsSync(file)) {
      debug(`config: ${file}`);
      // A config in osg/ still resolves its relative paths against the repo, not
      // against osg/, because `screenshots: 'screenshots'` should mean the repo's
      // screenshots directory. Only a config at the root keeps its own directory.
      const root = candidate.startsWith('osg/') ? path.dirname(path.dirname(file)) : path.dirname(file);
      return { config: unwrap(await loadModule(file)), file, root };
    }
  }

  const pkgPath = path.resolve(cwd, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as { osg?: OsgConfig; name?: string };
      if (pkg.osg) {
        debug(`config: ${pkgPath} (osg key)`);
        return { config: pkg.osg, file: pkgPath, root: cwd };
      }
    } catch {
      // A broken package.json is the user's problem elsewhere, not here.
    }
  }

  debug('config: none found, using defaults');
  return { config: {}, file: null, root: cwd };
}

/** Absolute path for a config value that may be relative to the config's root. */
export function resolveFromConfig(loaded: LoadedConfig, value: string | undefined, fallback: string): string {
  return path.resolve(loaded.root, value ?? fallback);
}
