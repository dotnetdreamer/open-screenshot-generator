// The translator's CSV coming back into a project: matching rows to text
// layers, reading each column as a language, and adding a language the project
// does not have yet when a column for it arrives with strings in it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyCsvImport, planCsvImport, toCsv } from '@/lib/i18n/translationCsv';
import {
  appendProjectLocales,
  getProjectLocales,
  normalizeLocalization,
} from '@/lib/i18n/localization';
import { handleMcpMessage, type McpDesignApi, type McpLocaleState } from '@/lib/mcp/desktopMcpServer';
import type { ArtboardState, ProjectLocalization, TextElementProps } from '@/types/artboard';

function headline(id: string, content: string): TextElementProps {
  return {
    id,
    type: 'text',
    content,
    position: { x: 0, y: 0 },
    size: { width: 900, height: 200 },
    rotation: 0,
    scale: 1,
    fontSize: 24,
    color: '#111111',
    fontFamily: 'Inter',
  };
}

function board(id: string, elements: TextElementProps[], localization?: ProjectLocalization): ArtboardState {
  return {
    id,
    name: id,
    position: { x: 0, y: 0 },
    size: { width: 1290, height: 2796 },
    elements,
    backgroundColor: '#ffffff',
    zoom: 1,
    ...(localization ? { localization } : {}),
  };
}

const GERMAN: ProjectLocalization = { baseLocale: 'en-US', locales: [{ code: 'de-DE' }] };

/** Two boards written in English, with German as the one export language. */
function project(): ArtboardState[] {
  return [
    board('b1', [headline('h1', 'Track every workout')], GERMAN),
    board('b2', [headline('h2', 'Sleep better tonight')], GERMAN),
  ];
}

const csv = (...rows: string[][]) => rows.map((row) => row.join(',')).join('\r\n');
const codes = (boards: ArtboardState[]) => getProjectLocales(boards).map((entry) => entry.code);

test('an exported sheet with a language column added to it brings that language in', () => {
  const boards = project();
  // What an agent editing the file does: one more column, one string per row.
  const [header, ...rows] = toCsv(boards, ['de-DE']).split('\r\n');
  const spanish = ['Registra cada entrenamiento', 'Duerme mejor esta noche'];
  const edited = [`${header},es-ES`, ...rows.map((row, i) => `${row},${spanish[i]}`)].join('\r\n');

  const plan = planCsvImport(boards, edited);
  assert.deepEqual(plan.newLocales, ['es-ES']);
  assert.deepEqual(plan.ignoredColumns, []);
  assert.equal(plan.unmatched, 0);
  assert.deepEqual(
    plan.changes.map((change) => `${change.locale} ${change.elementId} "${change.from}" -> "${change.to}"`),
    ['es-ES h1 "" -> "Registra cada entrenamiento"', 'es-ES h2 "" -> "Duerme mejor esta noche"']
  );

  const next = applyCsvImport(boards, plan.changes);
  assert.deepEqual(codes(next), ['de-DE', 'es-ES']);
  // Mirrored onto every board, which is what keeps the language after a save.
  assert.ok(next.every((b) => b.localization === next[0].localization));
  assert.equal(next[1].localized?.['es-ES']?.h2?.content, 'Duerme mejor esta noche');
  assert.equal(next[1].localized?.['es-ES']?.h2?.origin, 'manual');
  // The sweep that runs on load finds nothing to drop, so the strings survive
  // a reload.
  assert.equal(normalizeLocalization(next), next);
});

test('a language the project has and a new one are read from the same sheet', () => {
  const boards = project();
  const plan = planCsvImport(
    boards,
    csv(
      ['artboardId', 'artboardName', 'elementId', 'label', 'en-US', 'de-DE', 'ja'],
      ['b1', 'b1', 'h1', 'Headline', 'Track every workout', 'Jedes Training im Blick', 'すべてのワークアウトを記録'],
      ['b2', 'b2', 'h2', 'Headline', 'Sleep better tonight', '', '今夜はぐっすり']
    )
  );
  assert.deepEqual(plan.newLocales, ['ja']);
  assert.deepEqual(
    plan.changes.map((change) => `${change.locale} ${change.elementId}`),
    ['de-DE h1', 'ja h1', 'ja h2']
  );
  const next = applyCsvImport(boards, plan.changes);
  assert.equal(next[0].localized?.['de-DE']?.h1?.content, 'Jedes Training im Blick');
  assert.equal(next[0].localized?.ja?.h1?.content, 'すべてのワークアウトを記録');
});

test('a project with no languages yet takes them from the sheet, keeping the base it was read against', () => {
  const boards = [board('b1', [headline('h1', 'Track every workout')])];
  const plan = planCsvImport(
    boards,
    csv(['artboardId', 'elementId', 'en-US', 'fr-FR'], ['b1', 'h1', 'Track every workout', 'Suivez chaque séance'])
  );
  assert.deepEqual(plan.newLocales, ['fr-FR']);
  const next = applyCsvImport(boards, plan.changes);
  assert.deepEqual(next[0].localization, { baseLocale: 'en-US', locales: [{ code: 'fr-FR' }] });
  assert.equal(next[0].localized?.['fr-FR']?.h1?.content, 'Suivez chaque séance');
});

test('headers resolve the way add_locales reads a code, and the rest are reported instead of guessed', () => {
  const plan = planCsvImport(
    project(),
    csv(
      ['artboardId', 'elementId', 'en-US', 'fr', 'de', 'notes', 'Japanese', 'pt_BR'],
      ['b1', 'h1', 'Track every workout', 'Suivez', 'Jedes Training', 'keep it short', 'すべて', 'Acompanhe']
    )
  );
  // "de" can only be German, which the project has; a name and an underscore
  // spelling both land on catalog codes.
  assert.deepEqual(plan.changes.map((change) => change.locale), ['de-DE', 'ja', 'pt-BR']);
  assert.deepEqual(plan.newLocales, ['ja', 'pt-BR']);
  assert.deepEqual(plan.ignoredColumns, [
    { column: 'fr', reason: 'could be fr-CA or fr-FR' },
    { column: 'notes', reason: 'not a language this app knows' },
  ]);
});

test('the base language under another spelling stays the base column', () => {
  // No ids, so the row can only be matched on its base string, and the column
  // holding that string is headed en_US rather than en-US.
  const plan = planCsvImport(project(), csv(['en_US', 'de-DE'], ['Track every workout', 'Jedes Training']));
  assert.deepEqual(
    plan.changes.map((change) => `${change.locale} ${change.elementId} ${change.matchedBy}`),
    ['de-DE h1 text']
  );
  assert.equal(plan.unmatched, 0);
  assert.deepEqual(plan.newLocales, []);
  assert.deepEqual(plan.ignoredColumns, []);
});

test('a language comes in only with at least one of its strings', () => {
  const boards = project();
  const plan = planCsvImport(
    boards,
    csv(
      ['artboardId', 'elementId', 'en-US', 'de-DE', 'ja', 'ko'],
      ['b1', 'h1', 'Track every workout', 'Jedes Training', 'すべて', '']
    )
  );
  // An empty column asks for nothing, the same way an empty cell does.
  assert.deepEqual(plan.newLocales, ['ja']);
  // Leaving every string of a new language out leaves the language out too.
  const germanOnly = applyCsvImport(
    boards,
    plan.changes.filter((change) => change.locale === 'de-DE')
  );
  assert.deepEqual(codes(germanOnly), ['de-DE']);
});

test('a second column for one language is reported, and the first one is read', () => {
  const plan = planCsvImport(
    project(),
    csv(['artboardId', 'elementId', 'en-US', 'de-DE', 'DE_de'], ['b1', 'h1', 'Track every workout', 'Erste', 'Zweite'])
  );
  assert.deepEqual(plan.changes.map((change) => change.to), ['Erste']);
  assert.deepEqual(plan.ignoredColumns, [{ column: 'DE_de', reason: 'a second column for de-DE' }]);
});

test('appendProjectLocales adds catalog languages once and leaves the rest of the list alone', () => {
  const kept = { code: 'de-DE', autoFont: false };
  const boards = [board('b1', [headline('h1', 'Hi')], { baseLocale: 'en-US', locales: [kept] })];
  // The base, a language already listed and a code outside the catalog add nothing.
  assert.equal(appendProjectLocales(boards, ['en-US', 'de-DE', 'xx-YY', '']), boards);
  const next = appendProjectLocales(boards, ['ja', 'ja']);
  assert.deepEqual(next[0].localization?.locales, [kept, { code: 'ja' }]);
  // A listed language keeps its own entry, flags and all.
  assert.equal(next[0].localization?.locales[0], kept);
});

// --- the MCP tool --------------------------------------------------------------

function localeApi(): { api: McpDesignApi; imports: Array<{ locales?: string[] }> } {
  const state: McpLocaleState = {
    baseLocale: 'en-US',
    activeLocale: null,
    locales: [
      { code: 'en-US', name: 'English (US)', nativeName: 'English (US)', base: true, active: true, translated: 0, total: 0 },
      { code: 'de-DE', name: 'German', nativeName: 'Deutsch', base: false, active: false, translated: 0, total: 2 },
    ],
  };
  const imports: Array<{ locales?: string[] }> = [];
  const api = new Proxy({} as McpDesignApi, {
    get: (_target, key) => {
      if (key === 'listLocales') return () => state;
      if (key === 'importTranslationsCsv') {
        return (input: { locales?: string[] }) => {
          imports.push(input);
          return { applied: 0, unmatched: 0, dryRun: true, changes: [], newLocales: [], ignoredColumns: [] };
        };
      }
      return () => false;
    },
  });
  return { api, imports };
}

let nextId = 1;
const importCall = (args: Record<string, unknown>) => ({
  jsonrpc: '2.0',
  id: nextId++,
  method: 'tools/call',
  params: { name: 'import_translations_csv', arguments: { csv: 'artboardId,elementId', dryRun: true, ...args } },
});
const isError = (response: unknown) =>
  (response as { result?: { isError?: boolean } }).result?.isError === true;

test('import_translations_csv narrows to a language the project has not added yet', async () => {
  const { api, imports } = localeApi();
  await handleMcpMessage(importCall({ locales: ['ja', 'de'] }), api);
  // "de" is the project's German; "ja" is not in the project, so the catalog names it.
  assert.deepEqual(imports[0].locales, ['ja', 'de-DE']);
});

test('import_translations_csv refuses a filter that names no language, rather than importing every column', async () => {
  const { api, imports } = localeApi();
  const response = await handleMcpMessage(importCall({ locales: ['xx', 'fr'] }), api);
  assert.equal(isError(response), true);
  assert.equal(imports.length, 0);
});
