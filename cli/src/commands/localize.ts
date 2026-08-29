/**
 * osg localize: the same design, in more languages.
 *
 * A language in this app is an OVERLAY, not a copy: one set of artboards, one
 * layout, and per language only the strings, the typeface where the script
 * needs one, and the screenshot inside the frame. That is what makes this a
 * cheap command, and it is also why nothing here creates artboards.
 *
 * Every step is one of the app's own locale tools, called through the bridge,
 * so a CSV round trip from here is the CSV round trip the language dialog does.
 * The tools this drives: list_locales, add_locales, set_base_locale,
 * list_translations, set_localized_texts, translate_locales,
 * export_translations_csv and import_translations_csv. Per language layout
 * tweaks (a smaller size for a long German string, a localized screenshot, a
 * badge hidden in one market) are element edits rather than language edits, so
 * they live in `osg edit --tool set_locale_override`.
 *
 * On machine translation: the engine is a build time choice in the editor
 * (NEXT_PUBLIC_TRANSLATION_PRIMARY_URL, see src/services/translation.ts). A
 * build without one translates nothing, and this command says so and points at
 * the better path rather than reporting a run of zero strings as a success.
 * Writing the copy yourself with --text is the better path anyway: a machine
 * translator is worst at exactly the short punchy copy a store listing is made
 * of.
 */
import fs from 'node:fs';
import path from 'node:path';
import { flagBool, flagList, flagNumber, flagString } from '../args.js';
import type { CommandContext } from '../context.js';
import type { Session } from '../driver/session.js';
import { EXIT, usageError } from '../errors.js';
import { debug, dim, emit, humanBytes, info, ok, step, warn } from '../log.js';
import { openProject } from './render.js';

/** What list_locales answers with. Mirrors McpLocaleState in the app. */
interface LocaleSummary {
  code: string;
  name: string;
  nativeName: string;
  base: boolean;
  active: boolean;
  translated: number;
  total: number;
}

interface LocaleState {
  baseLocale: string;
  activeLocale: string | null;
  locales: LocaleSummary[];
}

interface LocaleConfigResult {
  baseLocale: string;
  added: string[];
  updated: string[];
  removed: string[];
  ignored: { code: string; reason: string }[];
  droppedStrings: number;
}

interface TranslateResult {
  /** Null means no engine is configured in this editor build. */
  engine: 'ai' | 'libre' | null;
  runs: { locale: string; translated: number; failed: number; skipped: number; rateLimited: boolean; error?: string }[];
  completion: { locale: string; translated: number; total: number }[];
}

interface BulkTextResult {
  written: number;
  cleared: number;
  unchanged: number;
  misses: { elementId: string; locale: string; reason: string }[];
  /** How complete each language is after this call, counted by the tool itself. */
  completion: { locale: string; translated: number; total: number }[];
}

interface CsvExport {
  csv: string;
  locales: string[];
  rows: number;
}

interface CsvImport {
  applied: number;
  unmatched: number;
  dryRun: boolean;
  changes: { artboardId: string; elementId: string; locale: string; label: string; from: string; to: string }[];
}

interface TranslationView {
  baseLocale: string;
  locales: string[];
  total: number;
  rows: {
    artboardId: string;
    artboardName: string;
    elementId: string;
    label: string;
    base: string;
    translations: Record<string, { text: string | null; state: string }>;
  }[];
}

interface TextWrite {
  locale: string;
  elementId: string;
  artboardId?: string;
  text: string;
}

const ONLY_VALUES = new Set(['empty', 'stale', 'all']);

/**
 * `--text de-DE:el_1a2b=Verfolge jedes Workout`, and with two artboards holding
 * the same element id, `--text de-DE:board_2/el_1a2b=...`.
 *
 * Read off the raw flag rather than through flagList, because copy contains
 * commas and splitting on them would cut a sentence in half.
 */
function parseTextFlags(value: string | boolean | string[] | undefined): TextWrite[] {
  if (value === undefined || typeof value === 'boolean') return [];
  const raw = Array.isArray(value) ? value : [value];
  return raw.map((entry) => {
    const colon = entry.indexOf(':');
    const equals = entry.indexOf('=', colon + 1);
    if (colon < 1 || equals < colon + 2) {
      throw usageError(
        `--text "${entry}" is not <locale>:<elementId>=<copy>`,
        'For example: --text de-DE:el_1a2b="Verfolge jedes Workout"'
      );
    }
    const locale = entry.slice(0, colon).trim();
    const target = entry.slice(colon + 1, equals).trim();
    const text = entry.slice(equals + 1);
    const slash = target.lastIndexOf('/');
    return slash === -1
      ? { locale, elementId: target, text }
      : { locale, artboardId: target.slice(0, slash), elementId: target.slice(slash + 1), text };
  });
}

/** The only keys on a board that a language owns. The rest is shared design. */
const LOCALE_KEYS = ['localized', 'localization', 'language'] as const;

/**
 * The languages are merged back INTO the file's own boards, rather than the
 * file being rewritten from what the page hands out.
 *
 * That is not a preference, it is the only correct way round. The editor
 * externalizes inline media as it opens a project (issue #19), so a screenshot
 * that arrived in the file as a data URL is an `asset:<id>` by the time
 * get_artboard sees it, and that reference lives in a browser profile this run
 * throws away. Replacing the document with the page's copy would quietly strip
 * every screenshot out of the project file. A language only ever writes the
 * three keys above, so only those come back, and every byte the run did not
 * touch stays exactly as it was.
 */
async function writeLocalization(ctx: CommandContext, session: Session): Promise<{ bytes: number; boards: number }> {
  const status = await session.status();
  const live = new Map<string, Record<string, unknown>>();
  for (const board of status.artboards) {
    live.set(board.id, (await session.call('get_artboard', { artboardId: board.id })) as Record<string, unknown>);
  }

  const file = ctx.projectFile;
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
  const boards = Array.isArray(parsed.projectData) ? (parsed.projectData as Record<string, unknown>[]) : [];

  let merged = 0;
  for (const board of boards) {
    const source = live.get(String(board.id));
    if (!source) continue;
    for (const key of LOCALE_KEYS) {
      if (source[key] === undefined) delete board[key];
      else board[key] = source[key];
    }
    merged += 1;
  }
  if (merged < boards.length) {
    warn(`${boards.length - merged} boards in the file were not on the canvas, their languages are unchanged`);
  }

  parsed.timestamp = new Date().toISOString();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
  return { bytes: fs.statSync(file).size, boards: merged };
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

const clip = (text: string, max = 56) => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}...` : flat;
};

const refresh = async (session: Session) => (await session.call('list_locales')) as LocaleState;

const exportLocales = (state: LocaleState) => state.locales.filter((entry) => !entry.base).map((entry) => entry.code);

/**
 * translate_locales answers with an error result when the editor build has no
 * translation service wired in. That is a fact about the build, not a bad
 * request, so it comes back as a usage error naming the better path rather than
 * as a driver failure nobody can act on.
 */
async function translateInto(
  session: Session,
  locales: string[],
  only: string,
  guidance: string | undefined
): Promise<TranslateResult> {
  try {
    return (await session.call('translate_locales', {
      locales,
      only,
      ...(guidance ? { guidance } : {}),
    })) as TranslateResult;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/no translation engine/i.test(message)) {
      throw usageError(
        'This editor build has no translation engine, so nothing was translated.',
        'Write the copy yourself, which is better copy anyway: `osg localize --missing` lists what is empty, ' +
          '`osg localize --text de-DE:<elementId>="<copy>"` writes it, and a CSV round trip is `--csv-out` then `--csv-in`.'
      );
    }
    throw error;
  }
}

/**
 * `counted` overrides what list_locales says about a language.
 *
 * A mutating tool returns the completion it just computed, and that number is
 * the one to trust: list_locales is answered from the artboards the last render
 * closed over, so straight after a write it can still be counting the document
 * from before it. The file on disk is written from the boards themselves and is
 * right either way, but a table that says 0 of 18 right after writing a string
 * reads as a failure.
 */
function printLocales(state: LocaleState, counted: Map<string, { translated: number; total: number }>): void {
  if (state.locales.length === 0) {
    info(dim('this project has no languages yet, add some with --add'));
    return;
  }
  const codeWidth = Math.max(...state.locales.map((entry) => entry.code.length));
  const nameWidth = Math.max(...state.locales.map((entry) => entry.name.length));
  for (const entry of state.locales) {
    const counts = counted.get(entry.code) ?? entry;
    const written = entry.base ? 'the design itself' : `${counts.translated} of ${counts.total} strings`;
    info(`  ${entry.code.padEnd(codeWidth)}  ${entry.name.padEnd(nameWidth)}  ${written}`);
  }
}

/**
 * The read half of translating: what has no copy yet, in a form somebody (or
 * something) can translate and hand straight back through --text.
 */
function printMissing(view: TranslationView, limit: number): void {
  if (view.rows.length === 0) {
    info(dim('nothing untranslated'));
    return;
  }
  for (const row of view.rows.slice(0, limit)) {
    const gaps = Object.entries(row.translations)
      .filter(([, cell]) => cell.state === 'inherited')
      .map(([code]) => code);
    if (gaps.length === 0) continue;
    info(`  ${row.elementId}  ${dim(row.artboardName)}  "${clip(row.base)}"  ${dim(`missing: ${gaps.join(', ')}`)}`);
  }
  if (view.total > limit) info(dim(`  and ${view.total - limit} more, raise the count with --missing ${view.total}`));
}

export async function run(ctx: CommandContext): Promise<number> {
  const { flags } = ctx.args;
  const add = flagList(flags, 'add');
  const base = flagString(flags, 'base');
  const translate = flagBool(flags, 'translate', false);
  const csvOut = flagString(flags, 'csv-out');
  const csvIn = flagString(flags, 'csv-in');
  const scope = flagList(flags, 'locales');
  const guidance = flagString(flags, 'guidance');
  const dryRun = flagBool(flags, 'dry-run', false);
  const texts = parseTextFlags(flags.text);
  const wantsMissing = flags.missing !== undefined;
  const missingLimit = flagNumber(flags, 'missing') ?? 20;

  const only = flagString(flags, 'only') ?? 'empty';
  if (!ONLY_VALUES.has(only)) {
    throw usageError(`--only "${only}" is not one of empty, stale, all`, 'Leave it out to fill only what has no copy yet.');
  }

  // Nothing asked for is a request to see what is there, which is what somebody
  // typing `osg localize` on its own means.
  const acts = !!add || !!base || translate || !!csvOut || !!csvIn || texts.length > 0 || wantsMissing;
  const wantsList = flagBool(flags, 'list', false) || !acts;

  const session = await ctx.session();
  await openProject(ctx, session);

  let state = (await session.call('list_locales')) as LocaleState;
  let snapshot = JSON.stringify(state);
  const counted = new Map<string, { translated: number; total: number }>();
  const noteCompletion = (rows: { locale: string; translated: number; total: number }[] | undefined) => {
    for (const row of rows ?? []) counted.set(row.locale, { translated: row.translated, total: row.total });
  };
  const result: Record<string, unknown> = { command: 'localize', baseLocale: state.baseLocale };
  let mutated = false;

  /**
   * Wait for a write to become readable before the next one starts.
   *
   * The driver serializes tool CALLS, but the editor commits into React state
   * and every tool is answered from the artboards the last render closed over.
   * Two mutations in one run can therefore both be computed from the document
   * as it was before either of them, and the second commit silently drops the
   * first. Adding a language and then writing copy into it is exactly that
   * pair, and it costs the copy. Watching the language state change is the
   * cheapest proof that the render has landed.
   */
  const waitForCommit = async (changed: boolean): Promise<void> => {
    if (!changed) return;
    mutated = true;
    for (let attempt = 0; attempt < 12; attempt++) {
      const next = JSON.stringify(await refresh(session));
      if (next !== snapshot) {
        snapshot = next;
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    warn('the editor has not committed the last change yet, re-run to check that it landed');
  };

  if (base && !add) {
    const config = (await session.call('set_base_locale', { locale: base })) as LocaleConfigResult;
    for (const entry of config.ignored) warn(`${entry.code}: ${entry.reason}`);
    await waitForCommit(true);
    result.baseLocale = config.baseLocale;
    ok(`base language: ${config.baseLocale}`);
  }

  let added: string[] = [];
  if (add) {
    step(`adding ${add.join(', ')}`);
    const config = (await session.call('add_locales', {
      locales: add,
      ...(base ? { baseLocale: base } : {}),
    })) as LocaleConfigResult;
    for (const entry of config.ignored) warn(`${entry.code}: ${entry.reason}`);
    added = config.added;
    await waitForCommit(config.added.length > 0 || config.updated.length > 0);
    result.added = config.added;
    result.ignored = config.ignored;
    if (config.added.length > 0) ok(`added ${config.added.join(', ')}`);
    else info('nothing added, every language asked for was already there');
  }

  if (texts.length > 0) {
    const written = (await session.call('set_localized_texts', {
      writes: texts.map((entry) => ({
        elementId: entry.elementId,
        locale: entry.locale,
        text: entry.text,
        ...(entry.artboardId ? { artboardId: entry.artboardId } : {}),
      })),
    })) as BulkTextResult;
    for (const miss of written.misses) warn(`${miss.locale} ${miss.elementId}: ${miss.reason}`);
    noteCompletion(written.completion);
    await waitForCommit(written.written > 0 || written.cleared > 0);
    result.texts = { written: written.written, cleared: written.cleared, unchanged: written.unchanged };
    ok(`wrote ${plural(written.written, 'string')}, cleared ${written.cleared}, unchanged ${written.unchanged}`);
  }

  if (csvIn) {
    const file = path.resolve(ctx.root, csvIn);
    if (!fs.existsSync(file)) {
      throw usageError(`No spreadsheet at ${file}`, 'Export one first with `osg localize --csv-out strings.csv`.');
    }
    const imported = (await session.call('import_translations_csv', {
      csv: fs.readFileSync(file, 'utf8'),
      dryRun,
      ...(scope ? { locales: scope } : {}),
    })) as CsvImport;
    await waitForCommit(!imported.dryRun && imported.applied > 0);
    result.csvIn = { file, applied: imported.applied, unmatched: imported.unmatched, dryRun: imported.dryRun };
    if (imported.unmatched > 0) warn(`${imported.unmatched} rows matched nothing in this project`);
    for (const change of imported.changes.slice(0, 10)) {
      debug(`${change.locale} ${change.elementId}: ${clip(change.from)} -> ${clip(change.to)}`);
    }
    ok(
      `${imported.dryRun ? 'would apply' : 'applied'} ${plural(imported.applied, 'string')} from ${path.basename(file)}`
    );
  }

  if (translate) {
    // Everything the project can be translated into, unless the run was scoped.
    const targets = scope ?? (added.length > 0 ? added : exportLocales(await refresh(session)));
    if (targets.length === 0) {
      throw usageError(
        'This project has no export languages to translate into.',
        'Add some first: `osg localize --add de-DE,ja,fr-FR`.'
      );
    }
    step(`translating ${targets.join(', ')}`);
    const run = await translateInto(session, targets, only, guidance);
    noteCompletion(run.completion);
    await waitForCommit(run.runs.some((entry) => entry.translated > 0));
    result.translated = run.runs;
    for (const entry of run.runs) {
      if (entry.error) warn(`${entry.locale}: ${entry.error}`);
      else if (entry.rateLimited) warn(`${entry.locale}: the engine stopped answering, ${entry.failed} strings never went`);
      else ok(`${entry.locale}: ${entry.translated} translated, ${entry.skipped} left alone`);
    }
    info(dim('machine copy is a draft, read it before you ship it'));
  }

  if (csvOut) {
    const exported = (await session.call('export_translations_csv', scope ? { locales: scope } : {})) as CsvExport;
    const file = path.resolve(ctx.root, csvOut);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, exported.csv, 'utf8');
    result.csvOut = { file, rows: exported.rows, locales: exported.locales };
    ok(
      `${plural(exported.rows, 'row')} to ${path.relative(ctx.root, file) || file} (${humanBytes(fs.statSync(file).size)})`
    );
  }

  if (wantsMissing) {
    const view = (await session.call('list_translations', {
      filter: 'untranslated',
      limit: Math.min(Math.max(missingLimit, 1), 500),
      ...(scope ? { locales: scope } : {}),
    })) as TranslationView;
    result.missing = { total: view.total, rows: view.rows };
    step(`${plural(view.total, 'string')} untranslated`);
    printMissing(view, missingLimit);
    if (view.total > 0) {
      info(dim('write one with: osg localize --text <locale>:<elementId>="<copy>"'));
    }
  }

  if (mutated) {
    // Safe to read the boards back: waitForCommit has already seen every write
    // in this run become readable.
    const written = await writeLocalization(ctx, session);
    debug(`merged languages into ${written.boards} boards, ${humanBytes(written.bytes)}`);
    result.projectFile = ctx.projectFile;
  }

  state = await refresh(session);
  result.locales = state.locales.map((entry) => ({ ...entry, ...(counted.get(entry.code) ?? {}) }));

  if (ctx.json) {
    emit(result);
    return EXIT.ok;
  }
  if (wantsList || mutated) {
    step(plural(state.locales.length, 'language'));
    printLocales(state, counted);
  }
  if (mutated) info(`saved to ${path.relative(ctx.root, ctx.projectFile) || ctx.projectFile}`);
  return EXIT.ok;
}
