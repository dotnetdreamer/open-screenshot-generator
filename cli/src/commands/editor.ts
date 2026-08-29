/**
 * `osg editor` - which editor bundle the CLI is driving, and how to change it.
 *
 * This exists because "the CLI renders something different from the app" is the
 * one bug class this package cannot afford, and the usual cause is that the two
 * are not the same build. editor/resolve.ts tries five sources in order and
 * says nothing about the four it skipped, so `status` walks the same ladder and
 * prints every rung: what it looked for, whether it was there, and which one
 * won. A contributor whose `npm run build` output is being ignored can see why
 * in one line instead of guessing.
 *
 * `use` pins a directory into the machine-wide cache root (not into the project
 * and not into the config), because it is a property of this machine's
 * checkout, not a decision about the design that belongs in a committed file.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { CommandContext } from '../context.js';
import { flagString } from '../args.js';
import { EXIT, usageError } from '../errors.js';
import { bold, cyan, dim, emit, green, info, ok, yellow } from '../log.js';
import {
  looksLikeEditor,
  manifestPath,
  readPinnedDir,
  resolveEditor,
  writePinnedDir,
  type EditorSource,
} from '../editor/resolve.js';
import { loadManifest } from '../editor/assets.js';
import { cacheRoot } from '../paths.js';
import { DEFAULTS } from '../config.js';

interface Candidate {
  id: string;
  /** What the user would set to choose this one. */
  how: string;
  /** Where it points, when it points anywhere. */
  target: string | null;
  available: boolean;
  /** Why it is or is not usable, in one line. */
  why: string;
}

export async function run(ctx: CommandContext): Promise<number> {
  const sub = (ctx.args.positionals[0] ?? 'status').toLowerCase();
  switch (sub) {
    case 'status':
      return status(ctx);
    case 'use':
      return use(ctx);
    case 'reset':
      return reset(ctx);
    default:
      throw usageError(`Unknown editor action: ${sub}`, 'Use one of: status, use <dir>, reset');
  }
}

// --- status -----------------------------------------------------------------

function status(ctx: CommandContext): number {
  const candidates = describeCandidates(ctx);
  // The truth, rather than our reading of it: whichever source this actually
  // resolves to is the one every other command will drive.
  const source = resolveEditor({
    editorUrl: flagString(ctx.args.flags, 'editor-url'),
    cwd: ctx.root,
    assetsBaseUrl: ctx.config.assetsBaseUrl ?? DEFAULTS.assetsBaseUrl,
  });
  const active = matchCandidate(candidates, source);
  const manifest = loadManifest(manifestPath());

  if (ctx.json) {
    emit({
      ok: true,
      source: {
        kind: source.kind,
        label: source.label,
        dir: source.kind === 'local' ? source.dir : null,
        origin: source.kind === 'remote' ? source.origin : null,
      },
      active,
      candidates,
      pin: readPinnedDir(),
      pinFile: path.join(cacheRoot(), 'editor-dir.json'),
      manifest: { path: manifestPath(), version: manifest.version, entries: Object.keys(manifest.entries).length },
    });
    return EXIT.ok;
  }

  info(`\n  ${bold('editor')}  ${source.label}`);
  info(`  ${dim(source.kind === 'local' ? source.dir : source.origin)}\n`);

  const width = Math.max(...candidates.map((entry) => entry.id.length));
  for (const candidate of candidates) {
    const mark = candidate.id === active ? green('use') : candidate.available ? yellow('had') : dim(' - ');
    info(`  ${mark} ${candidate.id.padEnd(width)}  ${dim(candidate.why)}`);
  }

  const entries = Object.keys(manifest.entries).length;
  info(
    `\n  ${dim('artwork')}  ${
      entries ? `${entries} manifest entries, hydrated on demand` : 'no manifest in this build, nothing hydrates'
    }`
  );
  info(`  ${dim('pin')}      ${readPinnedDir() ?? 'none'}\n`);
  if (source.kind === 'remote' && !flagString(ctx.args.flags, 'editor-url')) {
    info(`  ${dim('No local bundle was found, so renders go through the hosted editor and need a network.')}`);
    info(`  ${dim('Point at a checkout with')} ${cyan('osg editor use <dir>/out')}\n`);
  }
  return EXIT.ok;
}

/**
 * The same ladder resolve.ts climbs, described rather than climbed.
 *
 * Kept in step with resolveEditor by hand, which is a real cost: the reason it
 * is worth paying is that resolveEditor answers "which one" and this answers
 * "why not the others", and merging them would make the hot path carry
 * reporting it never needs.
 */
function describeCandidates(ctx: CommandContext): Candidate[] {
  const url = flagString(ctx.args.flags, 'editor-url')?.trim() || process.env.OSG_EDITOR_URL?.trim();
  const envDir = process.env.OSG_EDITOR_DIR?.trim();
  const pinned = readPinnedDir();
  // Derived from the manifest rather than from this file's own location, so the
  // packaged layout is defined in exactly one place (editor/resolve.ts).
  const packaged = path.join(path.dirname(manifestPath()), 'editor');
  const checkout = findCheckoutBuild(ctx.root);
  const hosted = (ctx.config.assetsBaseUrl ?? DEFAULTS.assetsBaseUrl).replace(/\/+$/, '');

  return [
    {
      id: 'editor-url',
      how: '--editor-url, or OSG_EDITOR_URL',
      target: url ?? null,
      available: !!url,
      why: url ? `driving ${url}` : 'not set',
    },
    {
      id: 'env-dir',
      how: 'OSG_EDITOR_DIR',
      target: envDir ?? null,
      available: !!envDir && looksLikeEditor(envDir),
      why: !envDir
        ? 'not set'
        : looksLikeEditor(envDir)
          ? envDir
          : `${envDir} has no index.html and _next, so it is ignored`,
    },
    {
      id: 'pinned',
      how: 'osg editor use <dir>',
      target: pinned,
      available: !!pinned && looksLikeEditor(pinned),
      why: !pinned
        ? 'nothing pinned'
        : looksLikeEditor(pinned)
          ? pinned
          : `${pinned} is pinned but is no longer a build, so it is ignored`,
    },
    {
      id: 'packaged',
      how: 'shipped inside this npm package',
      target: packaged,
      available: looksLikeEditor(packaged),
      why: looksLikeEditor(packaged)
        ? packaged
        : 'not in this install, which is normal in a source checkout of the repo',
    },
    {
      id: 'checkout',
      how: 'out/ of a checkout at or above the working directory',
      target: checkout,
      available: !!checkout,
      why: checkout ?? 'no repository build found above the working directory. Run `npm run build` there',
    },
    {
      id: 'hosted',
      how: 'the project deployment, used when nothing local exists',
      target: hosted,
      available: true,
      why: `${hosted}, which always works and always needs a network`,
    },
  ];
}

/** Which candidate resolveEditor actually chose, by what it points at. */
function matchCandidate(candidates: Candidate[], source: EditorSource): string {
  const target = source.kind === 'local' ? path.resolve(source.dir) : source.origin;
  for (const candidate of candidates) {
    if (!candidate.available || !candidate.target) continue;
    const value = source.kind === 'local' ? path.resolve(candidate.target) : candidate.target.replace(/\/+$/, '');
    if (value === target) return candidate.id;
  }
  return 'hosted';
}

/** Mirrors findCheckoutBuild in editor/resolve.ts, which does not export it. */
function findCheckoutBuild(from: string): string | null {
  let dir = path.resolve(from);
  for (let depth = 0; depth < 8; depth++) {
    const out = path.join(dir, 'out');
    const pkg = path.join(dir, 'package.json');
    if (looksLikeEditor(out) && fs.existsSync(pkg)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(pkg, 'utf8')) as { name?: string };
        if (parsed.name === 'open-screenshot-generator') return out;
      } catch {
        // An unreadable package.json means this is not the checkout we want.
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

// --- use and reset ----------------------------------------------------------

function use(ctx: CommandContext): number {
  const raw = ctx.args.positionals[1];
  if (!raw) {
    throw usageError('`osg editor use` needs a directory.', 'osg editor use ../open-screenshot-generator/out');
  }
  // Resolved against the shell's directory, not the config root: this is a path
  // the user just typed and tab completed.
  const dir = path.resolve(process.cwd(), raw);

  if (!fs.existsSync(dir)) {
    throw usageError(`No such directory: ${dir}`);
  }
  if (!looksLikeEditor(dir)) {
    const hint = looksLikeEditor(path.join(dir, 'out')) ? `Did you mean ${path.join(dir, 'out')}?` : '';
    throw usageError(
      `${dir} is not an editor build: it has no index.html and no _next directory.`,
      `${hint} A build is what \`npm run build\` writes to out/ in a checkout of this repo.`.trim()
    );
  }

  writePinnedDir(dir);
  const file = path.join(cacheRoot(), 'editor-dir.json');
  if (ctx.json) {
    emit({ ok: true, pinned: dir, pinFile: file });
    return EXIT.ok;
  }
  ok(`pinned ${dir}`);
  info(dim(`  Stored in ${file}, so it survives an npm upgrade and never touches the project`));
  info(dim('  Undo with `osg editor reset`'));
  return EXIT.ok;
}

function reset(ctx: CommandContext): number {
  const previous = readPinnedDir();
  writePinnedDir(null);
  if (ctx.json) {
    emit({ ok: true, cleared: previous });
    return EXIT.ok;
  }
  ok(previous ? `cleared the pin on ${previous}` : 'there was no pin to clear');
  info(dim('  `osg editor status` shows what the CLI falls back to'));
  return EXIT.ok;
}
