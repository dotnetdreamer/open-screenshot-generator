// The CSV round trip: hand a spreadsheet to a translator, get it back.
//
// This is the path that works with no translation service configured at all,
// which matters because machine output is a draft and marketing copy is the one
// thing it is worst at. One row per (artboard, element), one column per
// language, and the base string alongside so the translator has the source in
// front of them.
//
// Nothing here writes the base document blind. planCsvImport only reports what
// WOULD change and the dialog makes the user tick the rows, because everything
// lives in IndexedDB and there is no server-side copy to restore from.

import type {
  ArtboardState,
  ElementLocaleOverride,
  TextElementProps,
} from '@/types/artboard';
import {
  appendProjectLocales,
  getBaseLocale,
  getProjectLocales,
  isOverrideEmpty,
  localizableTextElements,
  overrideSourceValue,
} from './localization';
import { LOCALES, resolveCatalogLocale } from './locales';
import { hash32 } from './hash';

/** How much of the base string stands in for a layer with no name. */
const LABEL_LIMIT = 40;

export interface TranslationRow {
  artboardId: string;
  artboardName: string;
  elementId: string;
  /** A human hint, so a translator can tell the headline from the subtitle. */
  label: string;
  /** The base string, the thing being translated from. */
  base: string;
  /** locale -> what is stored for it. '' means nothing yet, so it falls back. */
  values: Record<string, string>;
}

/** The layer name, or the string itself when nobody named the layer. */
export function labelFor(el: TextElementProps): string {
  const name = el.name?.trim();
  if (name) return name;
  const text = el.content.replace(/\s+/g, ' ').trim();
  return text.length > LABEL_LIMIT ? `${text.slice(0, LABEL_LIMIT - 1)}…` : text;
}

/** The languages to put in columns, base always excluded (it has its own). */
function exportLocales(artboards: ArtboardState[], locales: string[]): string[] {
  const baseLocale = getBaseLocale(artboards);
  const seen = new Set<string>();
  return locales.filter((code) => {
    if (!code || code === baseLocale || seen.has(code)) return false;
    seen.add(code);
    return true;
  });
}

export function buildTranslationRows(
  artboards: ArtboardState[],
  locales: string[]
): TranslationRow[] {
  const columns = exportLocales(artboards, locales);
  const rows: TranslationRow[] = [];
  for (const board of artboards) {
    for (const el of localizableTextElements(board)) {
      const values: Record<string, string> = {};
      for (const locale of columns) {
        values[locale] = board.localized?.[locale]?.[el.id]?.content ?? '';
      }
      rows.push({
        artboardId: board.id,
        artboardName: board.name,
        elementId: el.id,
        label: labelFor(el),
        base: el.content,
        values,
      });
    }
  }
  return rows;
}

// --- writing -----------------------------------------------------------------

/** RFC4180: quote when the field carries a delimiter, and double the quotes. */
function csvField(value: string): string {
  if (!/[",\r\n]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

/**
 * The sheet a translator gets. Column order is artboardId, artboardName,
 * elementId, label, the base language, then one column per other language.
 *
 * The ids come first and are what the import matches on, so a translator may
 * reorder or delete language columns, add one for a new language, or send back
 * a subset of the rows, without the import losing track of which string is
 * which.
 */
export function toCsv(artboards: ArtboardState[], locales: string[]): string {
  const baseLocale = getBaseLocale(artboards);
  const columns = exportLocales(artboards, locales);
  const header = ['artboardId', 'artboardName', 'elementId', 'label', baseLocale, ...columns];
  const lines = [header.map(csvField).join(',')];
  for (const row of buildTranslationRows(artboards, columns)) {
    lines.push(
      [
        row.artboardId,
        row.artboardName,
        row.elementId,
        row.label,
        row.base,
        ...columns.map((locale) => row.values[locale] ?? ''),
      ]
        .map(csvField)
        .join(',')
    );
  }
  // CRLF, because that is what RFC4180 says and what Excel writes back.
  return lines.join('\r\n');
}

// --- reading -----------------------------------------------------------------

/**
 * A real parser, not a split on commas: a translated headline routinely
 * contains a comma, and Excel happily writes a quoted field with a newline in
 * it for anything that had a line break.
 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  // Excel writes a BOM on UTF-8 CSVs and it would otherwise glue itself to the
  // first header name, so the artboardId column would never be found.
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;

  const endRow = () => {
    row.push(field);
    field = '';
    rows.push(row);
    row = [];
  };

  while (i < text.length) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        // A doubled quote inside a quoted field is one literal quote.
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    // Only a quote that OPENS a field starts quoting. One in the middle of a
    // bare field is a literal, which is what a spreadsheet does too.
    if (ch === '"' && field === '') {
      quoted = true;
      i++;
      continue;
    }
    if (ch === ',') {
      row.push(field);
      field = '';
      i++;
      continue;
    }
    if (ch === '\r') {
      endRow();
      i += text[i + 1] === '\n' ? 2 : 1;
      continue;
    }
    if (ch === '\n') {
      endRow();
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  if (field !== '' || row.length > 0) endRow();

  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ''));
}

/** Text elements store '\n', so a cell that came back with CRLF must match. */
function normalizeCell(value: string | undefined): string {
  return (value ?? '').replace(/\r\n?/g, '\n');
}

export interface CsvImportChange {
  artboardId: string;
  elementId: string;
  locale: string;
  label: string;
  from: string;
  to: string;
  /** 'text' means the ids did not line up and the base string was the anchor. */
  matchedBy: 'id' | 'text';
}

/** A header the import did not read, and why. */
export interface CsvIgnoredColumn {
  column: string;
  reason: string;
}

export interface CsvImportPlan {
  changes: CsvImportChange[];
  unmatched: number;
  /**
   * Languages these changes write into that the project does not have yet.
   * applyCsvImport adds them to the project's list along with the strings.
   */
  newLocales: string[];
  ignoredColumns: CsvIgnoredColumn[];
}

/** Headers that are not languages: the ids, the hints and the base string. */
const NON_LOCALE_COLUMNS = new Set(['artboardid', 'artboardname', 'elementid', 'label', 'base']);

/**
 * The language a column header names, or why it names none. The project's own
 * codes come first, so a column keeps meaning what it meant when the sheet was
 * exported. After that the catalog decides, reading a header the way
 * add_locales reads a code: "de" and "German" both land on de-DE, and "fr"
 * lands nowhere, because fr-CA and fr-FR are separate store listings. An
 * underscore counts as a hyphen, for sheets that write pt_BR.
 */
function columnLocale(
  name: string,
  projectCodes: string[]
): { locale: string } | { reason: string } {
  const code = name.replace(/_/g, '-');
  const own = projectCodes.find((known) => known.toLowerCase() === code.toLowerCase());
  const locale = own ?? resolveCatalogLocale(code);
  if (locale) return { locale };
  const language = code.toLowerCase();
  const candidates = LOCALES.filter((def) => def.code.toLowerCase().split('-')[0] === language).map(
    (def) => def.code
  );
  if (candidates.length < 2) return { reason: 'not a language this app knows' };
  return {
    reason: `could be ${candidates.slice(0, -1).join(', ')} or ${candidates[candidates.length - 1]}`,
  };
}

/**
 * What this CSV would change, and nothing else. Only cells whose value actually
 * differs from what is stored are returned, so a translator who touched two
 * rows produces a two-row review rather than a wall of no-ops.
 *
 * Matching is artboardId + elementId first. When those do not line up (the
 * sheet was rebuilt by hand, or the rows came from a duplicated project) the
 * base string is the fallback anchor, but ONLY when exactly one element in the
 * project has that string: two screens both saying "Get started" would
 * otherwise take each other's translations.
 *
 * An empty cell means "I did not translate this one", never "delete what you
 * have". Clearing a translation is done in the table, where it is one visible
 * cell, rather than by a blank in a spreadsheet nobody reads to the end.
 *
 * A column for a language the project does not have yet is read like the
 * others when the catalog knows its code, and the plan lists that language in
 * `newLocales`: the strings and the language arrive in the same commit, so
 * normalizeLocalization never meets overrides for a language missing from the
 * list. A header that names no language (a typo, "fr" with two French listings
 * to pick from, a translator's notes) is left unread and listed in
 * `ignoredColumns` rather than guessed at.
 */
export function planCsvImport(artboards: ArtboardState[], csvText: string): CsvImportPlan {
  const table = parseCsv(csvText);
  if (table.length < 2) return { changes: [], unmatched: 0, newLocales: [], ignoredColumns: [] };

  const header = table[0].map((cell) => cell.trim());
  const columnOf = (name: string) =>
    header.findIndex((cell) => cell.toLowerCase() === name.toLowerCase());

  const artboardIdCol = columnOf('artboardId');
  const elementIdCol = columnOf('elementId');
  const labelCol = columnOf('label');

  const baseLocale = getBaseLocale(artboards);
  const projectCodes = getProjectLocales(artboards).map((entry) => entry.code);
  // What each header names, read once: a language, the reason it is none, or
  // null for the ids, the hints and a column headed "base".
  const named = header.map((name) =>
    !name || NON_LOCALE_COLUMNS.has(name.toLowerCase()) ? null : columnLocale(name, projectCodes)
  );
  // The base column anchors a row by its text when the ids do not line up, so
  // it is found under any spelling a language column accepts (en_US as well as
  // en-US), with a column headed "base" as the stand-in when there is none.
  const spelled = named.findIndex((found) => !!found && 'locale' in found && found.locale === baseLocale);
  const baseCol =
    columnOf(baseLocale) >= 0 ? columnOf(baseLocale) : spelled >= 0 ? spelled : columnOf('base');

  const localeColumns: Array<{ locale: string; col: number }> = [];
  const ignoredColumns: CsvIgnoredColumn[] = [];
  header.forEach((name, col) => {
    const found = named[col];
    if (!found || col === baseCol) return;
    if ('reason' in found) {
      ignoredColumns.push({ column: name, reason: found.reason });
      return;
    }
    // A second column in the base language is not a translation either.
    if (found.locale === baseLocale) return;
    // Only the first column for a language is read. A second would offer two
    // values for every string in it.
    if (localeColumns.some((entry) => entry.locale === found.locale)) {
      ignoredColumns.push({ column: name, reason: `a second column for ${found.locale}` });
      return;
    }
    localeColumns.push({ locale: found.locale, col });
  });
  if (localeColumns.length === 0) {
    return { changes: [], unmatched: 0, newLocales: [], ignoredColumns };
  }

  interface Target {
    board: ArtboardState;
    el: TextElementProps;
  }
  const byId = new Map<string, Target>();
  const byText = new Map<string, Target | null>();
  for (const board of artboards) {
    for (const el of localizableTextElements(board)) {
      byId.set(`${board.id}\u0000${el.id}`, { board, el });
      const key = el.content.replace(/\r\n?/g, '\n').trim();
      byText.set(key, byText.has(key) ? null : { board, el });
    }
  }

  const changes: CsvImportChange[] = [];
  let unmatched = 0;

  for (let r = 1; r < table.length; r++) {
    const cells = table[r];
    const artboardId = artboardIdCol >= 0 ? (cells[artboardIdCol] ?? '').trim() : '';
    const elementId = elementIdCol >= 0 ? (cells[elementIdCol] ?? '').trim() : '';

    let target = byId.get(`${artboardId}\u0000${elementId}`);
    let matchedBy: 'id' | 'text' = 'id';
    if (!target && baseCol >= 0) {
      const found = byText.get(normalizeCell(cells[baseCol]).trim());
      if (found) {
        target = found;
        matchedBy = 'text';
      }
    }
    if (!target) {
      unmatched++;
      continue;
    }

    const label =
      (labelCol >= 0 ? (cells[labelCol] ?? '').trim() : '') || labelFor(target.el);

    for (const { locale, col } of localeColumns) {
      const to = normalizeCell(cells[col]);
      if (to === '') continue;
      const from = target.board.localized?.[locale]?.[target.el.id]?.content ?? '';
      if (to === from) continue;
      changes.push({
        artboardId: target.board.id,
        elementId: target.el.id,
        locale,
        label,
        from,
        to,
        matchedBy,
      });
    }
  }

  // An empty column adds no language, the same way an empty cell adds no
  // translation.
  const known = new Set(projectCodes);
  const newLocales = localeColumns
    .map((entry) => entry.locale)
    .filter((locale) => !known.has(locale) && changes.some((change) => change.locale === locale));

  return { changes, unmatched, newLocales, ignoredColumns };
}

// --- writing overrides -------------------------------------------------------

/** One translated string going into one language. */
export interface LocaleTextWrite {
  artboardId: string;
  elementId: string;
  locale: string;
  /** '' clears the override, so the element falls back to the base string. */
  value: string;
}

/**
 * Writes translated strings into the base document, marked manual: a person
 * typed or reviewed every one of these, so "Update translations" must never
 * refresh them without an explicit opt-in.
 *
 * Returns the input BY REFERENCE when nothing actually differs, so a Save with
 * no edits does not push a history entry full of identical boards. This is the
 * single write path for both the translation table and the CSV import, so the
 * two cannot disagree about what origin and sourceHash a hand-typed string gets.
 */
export function applyLocaleTextWrites(
  artboards: ArtboardState[],
  writes: LocaleTextWrite[]
): ArtboardState[] {
  if (writes.length === 0) return artboards;

  const byBoard = new Map<string, LocaleTextWrite[]>();
  for (const write of writes) {
    const list = byBoard.get(write.artboardId);
    if (list) list.push(write);
    else byBoard.set(write.artboardId, [write]);
  }

  let changed = false;
  const next = artboards.map((board) => {
    const list = byBoard.get(board.id);
    if (!list) return board;

    const elements = new Map(board.elements.map((el) => [el.id, el]));
    let localized = board.localized;
    let boardChanged = false;

    for (const write of list) {
      const el = elements.get(write.elementId);
      if (!el || el.type !== 'text') continue;
      const current = localized?.[write.locale]?.[write.elementId];
      if ((current?.content ?? '') === write.value) continue;

      if (!boardChanged) {
        localized = { ...(board.localized || {}) };
        boardChanged = true;
      }
      const map = { ...(localized![write.locale] || {}) };

      let override: ElementLocaleOverride | undefined = { ...(current || {}) };
      if (write.value === '') delete override.content;
      else override.content = write.value;
      override.origin = 'manual';
      // Same source as unprojectArtboards hashes, so the staleness check and
      // the writer can never disagree about which base value this came from.
      const source = overrideSourceValue(el, override);
      if (source === undefined) delete override.sourceHash;
      else override.sourceHash = hash32(source);
      if (isOverrideEmpty(override)) override = undefined;

      if (override) map[write.elementId] = override;
      else delete map[write.elementId];

      // An emptied locale map is dropped rather than kept as {}, matching what
      // normalizeLocalization leaves behind.
      if (Object.keys(map).length > 0) localized![write.locale] = map;
      else delete localized![write.locale];
    }

    if (!boardChanged) return board;
    changed = true;
    if (!localized || Object.keys(localized).length === 0) {
      const { localized: _dropped, ...rest } = board;
      return rest as ArtboardState;
    }
    return { ...board, localized };
  });

  return changed ? next : artboards;
}

/**
 * Applies the rows the user ticked in the import review. A language they write
 * into that the project does not have yet joins its list in the same pass,
 * because normalizeLocalization sweeps away overrides for a language the list
 * does not name.
 */
export function applyCsvImport(
  artboards: ArtboardState[],
  changes: CsvImportChange[]
): ArtboardState[] {
  return applyLocaleTextWrites(
    appendProjectLocales(artboards, changes.map((change) => change.locale)),
    changes.map((change) => ({
      artboardId: change.artboardId,
      elementId: change.elementId,
      locale: change.locale,
      value: change.to,
    }))
  );
}
