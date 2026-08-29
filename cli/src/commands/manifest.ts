/**
 * `osg manifest`: write osg.manifest.json, a description of everything that
 * currently exists.
 *
 * This is the cheap answer to "what has this project already produced", which
 * an agent otherwise answers by re-rendering. So it is deliberately measured
 * rather than assumed: every file is opened and its real dimensions read with
 * the same parsers `osg verify` audits with, and judged by the same rules, so
 * the manifest and the audit can never disagree. A manifest that said
 * 1290x2796 because the filename said so would be worse than no manifest.
 *
 * It also runs with no browser. The project file and the output directory are
 * both on disk, and booting an editor to describe them would make the fast
 * path slow. `--live` opens a session for the things only the running editor
 * knows.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { flagBool, flagString } from '../args.js';
import { DEFAULTS } from '../config.js';
import type { CommandContext } from '../context.js';
import { loadManifest } from '../editor/assets.js';
import { manifestPath, resolveEditor } from '../editor/resolve.js';
import { EXIT } from '../errors.js';
import { dim, emit, humanBytes, info, ok, step, warn } from '../log.js';
import { ensureDir } from '../paths.js';
import { readMp4File } from '../verify/mp4.js';
import { readPngFile } from '../verify/png.js';
import {
  checkMp4,
  checkPng,
  checkPreviewCount,
  checkScreenshotCount,
  rulesetFor,
  worstLevel,
  VERIFIED_ON,
  type Finding,
  type RuleLevel,
  type StoreRuleset,
} from '../verify/rules.js';
import { localesOf, readProjectFile, type ProjectBoard, type ProjectFileContents } from './render.js';

interface ManifestFile {
  /** Relative to the output directory, with forward slashes on every OS. */
  file: string;
  kind: 'png' | 'mp4' | 'other';
  bytes: number;
  modifiedAt: string;
  width: number | null;
  height: number | null;
  /** The store tier this size belongs to, null when it belongs to none. */
  tier: string | null;
  /** Read off the token a multi-language run prefixes the filename with. */
  locale: string | null;
  /** The board it came from, when the name still says so. */
  board: string | null;
  png: { bitDepth: number; colorType: number; hasAlpha: boolean; interlace: number } | null;
  mp4: {
    durationSeconds: number;
    fps: number;
    frames: number;
    codec: string;
    codecString: string | null;
    hasAudioTrack: boolean;
  } | null;
  verdict: RuleLevel;
  findings: Finding[];
}

interface ManifestSet {
  label: string;
  kind: 'screenshots' | 'previews';
  tier: string;
  locale: string | null;
  count: number;
  verdict: RuleLevel;
  findings: Finding[];
}

function walk(dir: string, depth = 0, prefix = ''): string[] {
  if (depth > 4) return [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const found: string[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.name.startsWith('.')) continue;
    // A partial download is not a produced file, it is a produced file's future.
    if (entry.name.endsWith('.crdownload') || entry.name.endsWith('.part')) continue;
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      found.push(...walk(path.join(dir, entry.name), depth + 1, rel));
    } else if (entry.isFile()) {
      found.push(rel);
    }
  }
  return found;
}

function kindOf(file: string): ManifestFile['kind'] {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.png') return 'png';
  if (ext === '.mp4' || ext === '.mov') return 'mp4';
  return 'other';
}

/** Only ever the token the export itself writes: "<locale>_01_Board_....png". */
function localeOf(file: string, locales: string[]): string | null {
  const name = path.basename(file);
  return locales.find((code) => name.startsWith(`${code}_`)) ?? null;
}

function boardOf(file: string, boards: { id: string; name: string }[]): string | null {
  const name = path.basename(file);
  // captureArtboards spells a board's name with underscores for spaces.
  const hit = boards.find((board) => board.name && name.includes(board.name.replace(/\s+/g, '_')));
  return hit ? hit.id : null;
}

/**
 * The tier a size belongs to, for grouping and for reading. The rules own the
 * tables; this only reads the label off the row that matches.
 */
function tierOf(width: number, height: number, kind: 'png' | 'mp4', ruleset: StoreRuleset): string | null {
  const sizes = kind === 'png' ? ruleset.png.acceptedSizes : ruleset.mp4?.acceptedSizes ?? [];
  for (const accepted of sizes) {
    if (accepted.width === width && accepted.height === height) return accepted.label;
    if (accepted.rotatable && accepted.width === height && accepted.height === width) return accepted.label;
  }
  if (kind === 'png') {
    const slot = ruleset.png.fixedSlots.find((entry) => entry.width === width && entry.height === height);
    if (slot) return slot.label;
  }
  return null;
}

function describeFile(
  outDir: string,
  rel: string,
  ruleset: StoreRuleset,
  locales: string[],
  boards: { id: string; name: string }[]
): ManifestFile {
  const file = path.join(outDir, rel);
  const stat = fs.statSync(file);
  const kind = kindOf(rel);
  const entry: ManifestFile = {
    file: rel,
    kind,
    bytes: stat.size,
    modifiedAt: new Date(stat.mtimeMs).toISOString(),
    width: null,
    height: null,
    tier: null,
    locale: localeOf(rel, locales),
    board: boardOf(rel, boards),
    png: null,
    mp4: null,
    verdict: 'ok',
    findings: [],
  };

  if (kind === 'png') {
    const info = readPngFile(file);
    if (!info) {
      entry.findings = [{ level: 'fail', code: 'png-unreadable', message: 'this file is not a PNG' }];
    } else {
      entry.width = info.width;
      entry.height = info.height;
      entry.png = {
        bitDepth: info.bitDepth,
        colorType: info.colorType,
        hasAlpha: info.hasAlpha,
        interlace: info.interlace,
      };
      entry.tier = tierOf(info.width, info.height, 'png', ruleset);
      entry.findings = checkPng(info, ruleset);
    }
  } else if (kind === 'mp4') {
    const info = readMp4File(file);
    if (!info) {
      entry.findings = [{ level: 'fail', code: 'mp4-unreadable', message: 'this file is not an MP4' }];
    } else {
      entry.width = info.width;
      entry.height = info.height;
      entry.mp4 = {
        durationSeconds: info.durationSeconds,
        fps: info.fps,
        frames: info.frames,
        codec: info.codec,
        codecString: info.codecString,
        hasAudioTrack: info.hasAudioTrack,
      };
      entry.tier = tierOf(info.width, info.height, 'mp4', ruleset);
      entry.findings = checkMp4(info, ruleset);
    }
  }

  entry.verdict = worstLevel(entry.findings);
  return entry;
}

/**
 * The count rules, which no single file can answer: how many screenshots this
 * tier has in this language. Files whose size matched no tier are left out,
 * because they are already failing on their own and counting them as a set
 * would invent a second complaint about the same file.
 */
function describeSets(files: ManifestFile[], ruleset: StoreRuleset): ManifestSet[] {
  const groups = new Map<string, { tier: string; locale: string | null; kind: 'png' | 'mp4'; count: number }>();
  for (const file of files) {
    if (file.kind === 'other' || !file.tier) continue;
    const key = `${file.kind}:${file.tier}:${file.locale ?? ''}`;
    const group = groups.get(key) ?? { tier: file.tier, locale: file.locale, kind: file.kind, count: 0 };
    group.count++;
    groups.set(key, group);
  }

  const sets: ManifestSet[] = [];
  for (const group of groups.values()) {
    const label = group.locale ? `${group.tier} (${group.locale})` : group.tier;
    const findings =
      group.kind === 'png'
        ? checkScreenshotCount(group.count, label, ruleset)
        : checkPreviewCount(group.count, label, ruleset);
    if (!findings.length) continue;
    sets.push({
      label,
      kind: group.kind === 'png' ? 'screenshots' : 'previews',
      tier: group.tier,
      locale: group.locale,
      count: group.count,
      verdict: worstLevel(findings),
      findings,
    });
  }
  return sets.sort((a, b) => a.label.localeCompare(b.label));
}

/** This package's own name and version, found by walking up from the module. */
function readPackage(): { name: string; version: string } | null {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 6; depth++) {
    const candidate = path.join(dir, 'package.json');
    if (fs.existsSync(candidate)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(candidate, 'utf8')) as { name?: string; version?: string };
        if (parsed.name && parsed.version) return { name: parsed.name, version: parsed.version };
      } catch {
        // Keep walking: an unreadable package.json is not the answer.
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export async function run(ctx: CommandContext): Promise<number> {
  const flags = ctx.args.flags;
  const live = flagBool(flags, 'live', false);

  // --out is the global output directory everywhere else in the CLI, and this
  // command's own --out names the file to write. A path ending in .json is the
  // file; anything else is the directory it already meant.
  const outFlag = flagString(flags, 'out');
  const namesAFile = !!outFlag && outFlag.toLowerCase().endsWith('.json');
  const outDir = namesAFile ? path.resolve(ctx.root, ctx.config.out ?? DEFAULTS.out) : ctx.outDir;
  const manifestFile = namesAFile ? path.resolve(ctx.root, outFlag) : path.resolve(ctx.root, 'osg.manifest.json');

  const ruleset = rulesetFor(ctx.config.store);

  let project: ProjectFileContents | null = null;
  try {
    project = readProjectFile(ctx.projectFile);
  } catch (error) {
    // A manifest of an output directory with no project file is still worth
    // writing: it is exactly what somebody who moved the project wants to see.
    warn((error as Error).message);
  }

  const fromFile = project ? localesOf(project.boards) : { base: null, codes: [] };
  let projectName = project?.name ?? null;
  let boards: { id: string; name: string; width: number; height: number; elements: number }[] = (
    project?.boards ?? []
  ).map((board: ProjectBoard) => ({
    id: board.id,
    name: board.name,
    width: board.size?.width ?? 0,
    height: board.size?.height ?? 0,
    elements: Array.isArray(board.elements) ? board.elements.length : 0,
  }));
  let locales = fromFile.codes;
  let baseLocale = fromFile.base;
  let activeArtboardId: string | null = null;
  let protocol: number | null = null;

  if (live) {
    step('opening a session for the live project state');
    const session = await ctx.session();
    const status = await session.status();
    projectName = status.projectName || projectName;
    boards = status.artboards.map((board) => ({
      id: board.id,
      name: board.name,
      width: board.width,
      height: board.height,
      elements: board.elements,
    }));
    // status.locales is the additional languages; the base is named separately.
    baseLocale = status.baseLocale;
    locales = [status.baseLocale, ...status.locales].filter((code): code is string => !!code);
    activeArtboardId = status.activeArtboardId;
    protocol = status.protocol;
  }

  const files: ManifestFile[] = [];
  if (fs.existsSync(outDir)) {
    for (const rel of walk(outDir)) {
      files.push(describeFile(outDir, rel, ruleset, locales, boards));
    }
  } else {
    warn(`no output directory at ${outDir}, nothing has been rendered yet`);
  }

  const sets = describeSets(files, ruleset);
  const bytes = files.reduce((sum, file) => sum + file.bytes, 0);
  const failed = files.filter((file) => file.verdict === 'fail');
  const warned = files.filter((file) => file.verdict === 'warn');
  const verdict = worstLevel([...files.flatMap((file) => file.findings), ...sets.flatMap((set) => set.findings)]);

  // What exists, counted the two ways somebody asks about it.
  const byTier: Record<string, number> = {};
  const byLocale: Record<string, number> = {};
  for (const file of files) {
    if (file.tier) byTier[file.tier] = (byTier[file.tier] ?? 0) + 1;
    const key = file.locale ?? baseLocale ?? 'base';
    byLocale[key] = (byLocale[key] ?? 0) + 1;
  }

  const pkg = readPackage();
  const editor = resolveEditor({
    editorUrl: flagString(flags, 'editor-url') ?? ctx.config.editorUrl,
    cwd: ctx.root,
    assetsBaseUrl: ctx.config.assetsBaseUrl ?? DEFAULTS.assetsBaseUrl,
  });

  const manifest = {
    formatVersion: 1,
    generatedAt: new Date().toISOString(),
    cli: {
      name: pkg?.name ?? 'open-screenshot-generator',
      version: pkg?.version ?? null,
      node: process.version,
      platform: process.platform,
    },
    editor: {
      source: editor.label,
      kind: editor.kind,
      // The bundle's own version, as stamped on the asset manifest it ships with.
      assets: loadManifest(manifestPath()).version,
      /** Null unless --live: the bridge only exists in a running page. */
      protocol,
    },
    config: {
      file: ctx.loaded.file,
      root: ctx.root,
      name: ctx.config.name ?? null,
      store: ruleset.id,
      project: ctx.projectFile,
      out: outDir,
      screenshots: ctx.config.screenshots ? path.resolve(ctx.root, ctx.config.screenshots) : null,
      template: ctx.config.template ?? null,
      formats: ctx.config.formats ?? DEFAULTS.formats,
      locales: ctx.config.locales ?? null,
      baseLocale: ctx.config.baseLocale ?? null,
      assetsBaseUrl: ctx.config.assetsBaseUrl ?? DEFAULTS.assetsBaseUrl,
      editorUrl: ctx.config.editorUrl ?? null,
      design: ctx.config.design ?? null,
      video: ctx.config.video ?? null,
      // Provider, model and the NAME of an env var. A key never lives in the
      // config, so nothing secret can reach this file.
      ai: ctx.config.ai ?? null,
    },
    project: {
      file: ctx.projectFile,
      exists: !!project,
      id: project?.id ?? null,
      name: projectName,
      savedAt: project?.timestamp ?? null,
      live,
      activeArtboardId,
      boards,
      locales,
      baseLocale,
      media: (project?.media ?? []).map((item) => ({
        id: item.id,
        name: item.name ?? null,
        mimeType: item.mimeType ?? null,
        bytes: item.size ?? null,
        width: item.width ?? null,
        height: item.height ?? null,
        durationSeconds: item.duration ?? null,
      })),
      fonts: (project?.fonts ?? []).map((font) => ({
        id: font.id,
        family: font.family,
        fileName: font.fileName ?? null,
        bytes: font.size ?? null,
      })),
    },
    out: {
      dir: outDir,
      files: files.length,
      bytes,
      byTier,
      byLocale,
    },
    verify: {
      store: ruleset.id,
      rulesVerifiedOn: VERIFIED_ON,
      verdict,
      ok: verdict !== 'fail',
      files: files.length,
      failed: failed.length,
      warned: warned.length,
      sets,
    },
    files,
  };

  ensureDir(path.dirname(manifestFile));
  fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);

  info(
    `  ${files.length} ${files.length === 1 ? 'file' : 'files'}, ${humanBytes(bytes)}, ` +
      `${failed.length} failing, ${warned.length} with warnings`
  );
  for (const file of failed) {
    info(`  ${file.file} ${dim(file.findings.map((finding) => finding.message).join('; '))}`);
  }
  // The verdict lives in the file. Exit 3 belongs to `osg verify`, which is the
  // command whose job is to gate on it.
  ok(path.relative(ctx.root, manifestFile) || manifestFile);

  if (ctx.json) emit(manifest);
  return EXIT.ok;
}
