/**
 * osg verify: the gate.
 *
 * Every other command in this CLI produces files. This is the one that refuses
 * them, which is why it owns an exit code of its own: 3 says the run happened
 * and a store rule rejects the result, and CI can tell that apart from a
 * browser that never started (2) or a config nobody wrote (1). The competitor
 * ships this and this project did not, so an agent could hand back a set App
 * Store Connect would bounce and nothing in the loop would know until a person
 * tried to upload it.
 *
 * No rule is written here. verify/png.ts and verify/mp4.ts read the real
 * headers, verify/rules.ts holds the store tables (imported from the app's own
 * publish path, so they cannot drift from what the editor uploads), and this
 * file only decides what to read, how to group it and how to print it.
 *
 * Two kinds of finding: per file, and per set. A store counts screenshots per
 * size, so "too few to publish" is not a fact about any one PNG, which is what
 * checkScreenshotCount and the grouping below exist for.
 *
 * Warnings never fail the run. A 9 MB PNG is worth saying out loud and is not
 * worth failing somebody's release build over.
 */
import fs from 'node:fs';
import path from 'node:path';
import { flagString } from '../args.js';
import { DEFAULTS } from '../config.js';
import type { CommandContext } from '../context.js';
import { EXIT, usageError } from '../errors.js';
import { emit, fail, green, humanBytes, info, ok, red, step, warn, yellow } from '../log.js';
import { readMp4File } from '../verify/mp4.js';
import { readPngFile } from '../verify/png.js';
import {
  checkMp4,
  checkPng,
  checkPreviewCount,
  checkScreenshotCount,
  rulesetFor,
  worstLevel,
  type Finding,
  type RuleLevel,
  type StoreId,
  type StoreRuleset,
} from '../verify/rules.js';

const PNG_EXT = new Set(['.png']);
const VIDEO_EXT = new Set(['.mp4', '.m4v', '.mov']);

interface FileReport {
  /** Relative to the audited directory, forward slashes on every OS. */
  file: string;
  kind: 'png' | 'video';
  width: number | null;
  height: number | null;
  /** Seconds, videos only. */
  duration: number | null;
  bytes: number;
  level: RuleLevel;
  findings: Finding[];
}

interface SetReport {
  label: string;
  kind: 'png' | 'video';
  files: number;
  level: RuleLevel;
  findings: Finding[];
}

function resolveStore(value: string): StoreId {
  if (value === 'appstore' || value === 'play') return value;
  throw usageError(
    `Unknown store "${value}".`,
    'Pass --store appstore or --store play, or set `store` in osg.config.ts.'
  );
}

function walk(dir: string, out: string[]): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    // A dot entry here is somebody's .git or .DS_Store, never a store file.
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

function auditFile(file: string, rel: string, ruleset: StoreRuleset): FileReport {
  const bytes = fs.statSync(file).size;
  const kind: 'png' | 'video' = PNG_EXT.has(path.extname(file).toLowerCase()) ? 'png' : 'video';

  if (kind === 'png') {
    const header = readPngFile(file);
    // The readers answer null rather than throwing, because "these bytes are
    // not a PNG" is a finding about the file, not an error in the run.
    if (!header) {
      return {
        file: rel,
        kind,
        width: null,
        height: null,
        duration: null,
        bytes,
        level: 'fail',
        findings: [{ level: 'fail', code: 'png-unreadable', message: 'not a PNG, or truncated before its header' }],
      };
    }
    const findings = checkPng(header, ruleset);
    return {
      file: rel,
      kind,
      width: header.width,
      height: header.height,
      duration: null,
      bytes,
      level: worstLevel(findings),
      findings,
    };
  }

  const header = readMp4File(file);
  if (!header) {
    return {
      file: rel,
      kind,
      width: null,
      height: null,
      duration: null,
      bytes,
      level: 'fail',
      findings: [{ level: 'fail', code: 'mp4-unreadable', message: 'not an MP4, or truncated before its headers' }],
    };
  }
  const findings = checkMp4(header, ruleset);
  return {
    file: rel,
    kind,
    width: header.width,
    height: header.height,
    duration: header.durationSeconds,
    bytes,
    level: worstLevel(findings),
    findings,
  };
}

/**
 * A set is one folder at one pixel size, because that is how a store counts:
 * per display size, per locale. Grouping on the folder alone would call two
 * formats rendered side by side one set of twenty and fail a good run; grouping
 * on the size alone would merge every locale into one.
 */
function auditSets(rows: FileReport[], ruleset: StoreRuleset): SetReport[] {
  const groups = new Map<string, { label: string; kind: 'png' | 'video'; files: number }>();
  for (const row of rows) {
    if (!row.width || !row.height) continue;
    const folder = path.posix.dirname(row.file);
    const label = `${folder === '.' ? '' : `${folder} `}${row.width}x${row.height}`;
    const key = `${row.kind}:${label}`;
    const existing = groups.get(key);
    if (existing) existing.files += 1;
    else groups.set(key, { label, kind: row.kind, files: 1 });
  }

  const sets: SetReport[] = [];
  for (const group of [...groups.values()].sort((a, b) => a.label.localeCompare(b.label))) {
    const findings =
      group.kind === 'png'
        ? checkScreenshotCount(group.files, group.label, ruleset)
        : checkPreviewCount(group.files, group.label, ruleset);
    if (findings.length === 0) continue;
    sets.push({ label: group.label, kind: group.kind, files: group.files, level: worstLevel(findings), findings });
  }
  return sets;
}

const BADGE: Record<RuleLevel, string> = { ok: 'ok  ', warn: 'warn', fail: 'FAIL' };

function badge(level: RuleLevel): string {
  if (level === 'fail') return red(BADGE.fail);
  return level === 'warn' ? yellow(BADGE.warn) : green(BADGE.ok);
}

function paint(finding: Finding): string {
  if (finding.level === 'fail') return red(finding.message);
  return finding.level === 'warn' ? yellow(finding.message) : finding.message;
}

function measure(row: FileReport): string {
  if (!row.width || !row.height) return '?';
  const size = `${row.width}x${row.height}`;
  return row.duration ? `${size} ${row.duration.toFixed(1)}s` : size;
}

function printTable(rows: FileReport[], sets: SetReport[]): void {
  // Padded before the colour goes on, or every escape sequence counts toward
  // the column width and the table shears on a TTY.
  const nameWidth = Math.max(...rows.map((row) => row.file.length));
  const sizeWidth = Math.max(...rows.map((row) => measure(row).length));
  const byteWidth = Math.max(...rows.map((row) => humanBytes(row.bytes).length));
  const gutter = ' '.repeat(4 + 2 + nameWidth + 2 + sizeWidth + 2 + byteWidth);

  for (const row of rows) {
    // An 'ok' finding is the rule saying it looked and found nothing, which is
    // worth having in --json and is noise in a table.
    const notes = row.findings.filter((finding) => finding.level !== 'ok');
    const head = `  ${badge(row.level)}  ${row.file.padEnd(nameWidth)}  ${measure(row).padStart(sizeWidth)}  ${humanBytes(row.bytes).padStart(byteWidth)}`;
    info(notes.length > 0 ? `${head}  ${paint(notes[0])}` : head);
    for (const note of notes.slice(1)) info(`  ${gutter}  ${paint(note)}`);
  }

  // A set that passes says so in the summary line's set count. A project with
  // five formats in ten languages has fifty sets, and fifty rows of "3
  // screenshots" would bury the two that matter.
  for (const set of sets) {
    for (const finding of set.findings) {
      if (finding.level !== 'ok') info(`  ${badge(finding.level)}  ${paint(finding)}`);
    }
  }
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export async function run(ctx: CommandContext): Promise<number> {
  const store = resolveStore(flagString(ctx.args.flags, 'store') ?? ctx.config.store ?? DEFAULTS.store);
  const ruleset = rulesetFor(store);
  const dir = path.resolve(ctx.root, ctx.args.positionals[0] ?? ctx.outDir);

  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    throw usageError(
      `Nothing to verify: ${dir} is not a directory.`,
      'Run `osg render` first, or name the directory to check: `osg verify <dir>`.'
    );
  }

  const files = walk(dir, [])
    .filter((file) => {
      const ext = path.extname(file).toLowerCase();
      return PNG_EXT.has(ext) || VIDEO_EXT.has(ext);
    })
    .sort();

  // Nothing produced is not a rule violation, it is a run that never happened,
  // so this exits 1 rather than 3 and says which of the two it is.
  if (files.length === 0) {
    throw usageError(
      `No PNG or MP4 files under ${dir}.`,
      'Run `osg render` first, or point verify at the directory that holds the store files.'
    );
  }

  step(`verify: ${plural(files.length, 'file')} against the ${ruleset.label} rules`);

  const rows = files.map((file) => auditFile(file, path.relative(dir, file).split(path.sep).join('/'), ruleset));
  const sets = auditSets(rows, ruleset);

  const failures = rows.filter((row) => row.level === 'fail').length + sets.filter((set) => set.level === 'fail').length;
  const warnings = rows.filter((row) => row.level === 'warn').length + sets.filter((set) => set.level === 'warn').length;
  const passed = rows.length - rows.filter((row) => row.level !== 'ok').length;
  const summary =
    `${plural(rows.length, 'file')} in ${plural(sets.length, 'set')}, ` +
    `${passed} ok, ${plural(warnings, 'warning')}, ${plural(failures, 'failure')}`;

  if (ctx.json) {
    emit({
      command: 'verify',
      store,
      dir,
      ok: failures === 0,
      summary: { files: rows.length, ok: passed, warnings, failures },
      files: rows,
      sets,
    });
  } else {
    printTable(rows, sets);
    if (failures > 0) fail(summary);
    else if (warnings > 0) warn(summary);
    else ok(summary);
  }

  return failures > 0 ? EXIT.verify : EXIT.ok;
}
