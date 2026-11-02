// What the translation table hands to Save after a machine run: which override
// rows differ from the document the session opened on, bookkeeping included.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countChangedOverrides, overrideStateFor } from '@/lib/i18n/localization';
import { hash32 } from '@/lib/i18n/hash';
import type { ArtboardState, ElementLocaleOverride, TextElementProps } from '@/types/artboard';

function headline(content: string): TextElementProps {
  return {
    id: 'h1',
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

/** One board, one headline, and German as its one export language. */
function board(content: string, german?: ElementLocaleOverride): ArtboardState {
  return {
    id: 'b1',
    name: 'b1',
    position: { x: 0, y: 0 },
    size: { width: 1290, height: 2796 },
    elements: [headline(content)],
    backgroundColor: '#ffffff',
    zoom: 1,
    localization: { baseLocale: 'en-US', locales: [{ code: 'de-DE' }] },
    ...(german ? { localized: { 'de-DE': { h1: german } } } : {}),
  };
}

const stateOf = (boards: ArtboardState[]) =>
  overrideStateFor(boards[0].elements[0], boards[0].localized?.['de-DE']?.h1);

test('a stale machine translation refreshed into the same words counts as a change', () => {
  // Drafted from "Wake up", then the base gained a trailing space. The German
  // still fits; the hash it was made from does not.
  const before = [board('Wake up ', { content: 'Aufwachen', origin: 'auto', sourceHash: hash32('Wake up') })];
  const after = [board('Wake up ', { content: 'Aufwachen', origin: 'auto', sourceHash: hash32('Wake up ') })];
  assert.equal(stateOf(before), 'stale-auto');
  assert.equal(stateOf(after), 'auto');
  assert.equal(countChangedOverrides(before, after), 1);
});

test('a row nobody wrote counts nothing, whether shared or copied', () => {
  const row: ElementLocaleOverride = { content: 'Aufwachen', origin: 'auto', sourceHash: hash32('Wake up') };
  const before = [board('Wake up', row)];
  assert.equal(countChangedOverrides(before, before), 0);
  assert.equal(countChangedOverrides(before, [board('Wake up', row)]), 0);
  assert.equal(countChangedOverrides(before, JSON.parse(JSON.stringify(before)) as ArtboardState[]), 0);
});

test('a new row counts, and a row the caller skips does not', () => {
  const before = [board('Wake up')];
  const after = [board('Wake up', { content: 'Aufwachen', origin: 'auto', sourceHash: hash32('Wake up') })];
  assert.equal(countChangedOverrides(before, after), 1);
  const typedOver = (artboardId: string, elementId: string, locale: string) =>
    artboardId === 'b1' && elementId === 'h1' && locale === 'de-DE';
  assert.equal(countChangedOverrides(before, after, typedOver), 0);
});
