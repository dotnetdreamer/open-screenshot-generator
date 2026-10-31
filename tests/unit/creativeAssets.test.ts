// App Store header and search art (iOS 27): Apple's sizes and safe areas, the
// designs built from a project, the store rules check, and the places that
// must leave a creative artboard alone.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  acceptsSize,
  boardForPlacement,
  creativeFileStem,
  creativeFileStems,
  creativeSpec,
  creativeSpecForPreset,
  creativeSummary,
  CREATIVE_ASSETS,
  headerButtonClearance,
  iphoneHeaderButtonsFor,
  minReadableGlyph,
  safeAreaFor,
  screenshotBoards,
} from '@/lib/creative/specs';
import { hash32 } from '@/lib/i18n/hash';
import { checkPng, isCreativeArt, rulesetFor } from '../../cli/src/verify/rules';
import { buildCreativeBoard, CREATIVE_LOOKS, readProjectLook, suggestedAppName } from '@/lib/creative/layouts';
import { checkCreativeBoard, checkCreativeView, countIssues } from '@/lib/creative/check';
import { computeSpill, reachedArtboardIds, stripBoards } from '@/lib/spanArtboards';
import { normalizeBackgroundImage } from '@/lib/artboardBackground';
import { convertArtboardsToFormat, detectArtboardsFormat, DEVICE_FORMAT_PRESETS } from '@/lib/deviceRegistry';
import { projectArtboards } from '@/lib/i18n/project';
import type {
  ArtboardElement,
  ArtboardState,
  CreativeAssetKind,
  DeviceFrameElementProps,
  ProjectLocalization,
  TextElementProps,
} from '@/types/artboard';

const LOCALIZATION: ProjectLocalization = { baseLocale: 'en-US', locales: [{ code: 'de-DE' }, { code: 'ja' }] };

function board(id: string, elements: ArtboardElement[] = [], extra: Partial<ArtboardState> = {}): ArtboardState {
  return {
    id,
    name: id,
    position: { x: 0, y: 0 },
    size: { width: 1206, height: 2622 },
    elements,
    backgroundColor: '#101827',
    zoom: 1,
    ...extra,
  };
}

function text(id: string, content: string, fontSize: number, extra: Partial<TextElementProps> = {}): TextElementProps {
  return {
    id,
    type: 'text',
    position: { x: 100, y: 200 },
    size: { width: 1000, height: 400 },
    rotation: 0,
    scale: 1,
    content,
    fontSize,
    color: '#FFFFFF',
    fontFamily: 'Space Grotesk',
    fontWeight: '700',
    ...extra,
  };
}

function phone(id: string, extra: Partial<DeviceFrameElementProps> = {}): DeviceFrameElementProps {
  return {
    id,
    type: 'device',
    deviceType: 'iphone-16-pro',
    position: { x: 200, y: 900 },
    size: { width: 800, height: 1700 },
    rotation: 0,
    scale: 1,
    screenshotSrc: 'asset:shot-en',
    ...extra,
  };
}

/** A two-language screenshots project: German headline and German screenshot. */
function screenshotsProject(): ArtboardState[] {
  const first = board(
    'shot-1',
    [text('h1', 'Track every habit in one place', 60), text('sub', 'Daily streaks and gentle nudges', 30), phone('p1')],
    {
      backgroundType: 'gradient',
      backgroundGradient: { color1: '#312E81', color2: '#0F0D2E', angle: 160 },
      localization: LOCALIZATION,
      localized: {
        'de-DE': {
          h1: { content: 'Jede Gewohnheit an einem Ort verfolgen', origin: 'auto', sourceHash: 'x', detached: ['position'], position: { x: 1, y: 2 } },
          p1: { screenshotSrc: 'asset:shot-de' },
        },
      },
    }
  );
  const second = board('shot-2', [text('h2', 'See your progress', 60), phone('p2', { screenshotSrc: 'asset:shot-2' })], {
    localization: LOCALIZATION,
  });
  return [first, second];
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

function rectInside(inner: Rect, outer: Rect, slack = 2): boolean {
  return (
    inner.x >= outer.x - slack &&
    inner.y >= outer.y - slack &&
    inner.x + inner.width <= outer.x + outer.width + slack &&
    inner.y + inner.height <= outer.y + outer.height + slack
  );
}

function inside(el: ArtboardElement, rect: Rect, slack = 2): boolean {
  return rectInside({ ...el.position, ...el.size }, rect, slack);
}

// --- Apple's numbers -----------------------------------------------------------

test("the sizes and safe areas are Apple's, and each safe area sits inside its canvas and its iPhone crop", () => {
  assert.deepEqual(
    CREATIVE_ASSETS.map((spec) => [spec.kind, spec.width, spec.height]),
    [
      ['header', 3840, 1646],
      ['search', 3840, 2560],
      ['universal', 5244, 2950],
    ]
  );
  // The "Art Safe Area" rectangles in Apple's Sketch and Photoshop templates.
  assert.deepEqual(creativeSpec('header').safe, { x: 1097, y: 493, width: 1646, height: 661 });
  assert.deepEqual(creativeSpec('search').safe, { x: 836, y: 765, width: 2168, height: 1030 });
  assert.deepEqual(creativeSpec('universal').safe, { x: 1921, y: 660, width: 1402, height: 962 });
  for (const spec of CREATIVE_ASSETS) {
    const canvas = { x: 0, y: 0, width: spec.width, height: spec.height };
    assert.ok(rectInside(spec.safe, canvas, 0), spec.kind);
    for (const placement of spec.placements) {
      const crop = spec.iphone[placement]!;
      assert.ok(rectInside(crop, canvas, 0), `${spec.kind} ${placement} crop`);
      // Whatever is inside the safe area shows on an iPhone.
      assert.ok(rectInside(spec.safe, crop, 1), `${spec.kind} ${placement}`);
    }
  }
  assert.deepEqual(creativeSpec('universal').imageFormats, ['PNG']);
  assert.equal(creativeSpec('universal').video, null);
});

test('search art takes any 3:2 size Apple lists; the header and universal sizes are exact', () => {
  assert.ok(acceptsSize('search', { width: 3840, height: 2560 }));
  assert.ok(acceptsSize('search', { width: 1920, height: 1280 }));
  assert.ok(acceptsSize('search', { width: 2400, height: 1600 }));
  assert.ok(!acceptsSize('search', { width: 1800, height: 1200 }));
  assert.ok(!acceptsSize('search', { width: 3840, height: 2160 }));
  assert.ok(acceptsSize('header', { width: 3840, height: 1646 }));
  assert.ok(!acceptsSize('header', { width: 1920, height: 823 }));
  assert.ok(acceptsSize('universal', { width: 5244, height: 2950 }));

  // A smaller search board scales its safe area with it.
  const half = safeAreaFor({ creativeAsset: 'search', size: { width: 1920, height: 1280 } })!;
  assert.deepEqual(half, { x: 418, y: 382.5, width: 1084, height: 515 });
  assert.equal(safeAreaFor({ size: { width: 1206, height: 2622 } }), null);
});

test('creative presets are the MCP way in, and the summary carries the safe area an agent cannot see', () => {
  assert.equal(creativeSpecForPreset('appstore-header')?.kind, 'header');
  assert.equal(creativeSpecForPreset('ios-6-3'), undefined);
  assert.deepEqual(creativeSummary({ creativeAsset: 'header', size: { width: 3840, height: 1646 } }), {
    creativeAsset: 'header',
    safeArea: { x: 1097, y: 493, width: 1646, height: 661 },
  });
  assert.deepEqual(creativeSummary({ size: { width: 1206, height: 2622 } }), {});
});

test('exported files are named for their placement, with the artboard name only when it was changed', () => {
  assert.equal(
    creativeFileStem({ creativeAsset: 'header', name: 'Product page header', size: { width: 3840, height: 1646 } }),
    'AppStore_Header_3840x1646'
  );
  assert.equal(
    creativeFileStem({ creativeAsset: 'search', name: 'Winter test B', size: { width: 3840, height: 2560 } }),
    'AppStore_SearchResult_Winter_test_B_3840x2560'
  );
  assert.equal(creativeFileStem({ name: 'Screen 1', size: { width: 1206, height: 2622 } }), null);
});

test('two designs of one kind never share a file name, so a desktop export cannot write one over the other', () => {
  const header = (id: string, name = 'Product page header') =>
    board(id, [], { creativeAsset: 'header', name, size: { width: 3840, height: 1646 } });
  const search = board('s', [], { creativeAsset: 'search', name: 'Search result', size: { width: 3840, height: 2560 } });
  // Canvas order: the art added second sits in front of the first.
  const stems = creativeFileStems([
    header('h-new'),
    search,
    header('h-old'),
    board('shot'),
    header('h-third'),
    header('w-1', 'Winter'),
    // The Mac and Windows file systems would call these two one file.
    header('w-2', 'winter'),
  ]);
  assert.deepEqual(stems, {
    'h-new': 'AppStore_Header_3840x1646',
    s: 'AppStore_SearchResult_3840x2560',
    'h-old': 'AppStore_Header_3840x1646_2',
    'h-third': 'AppStore_Header_3840x1646_3',
    'w-1': 'AppStore_Header_Winter_3840x1646',
    'w-2': 'AppStore_Header_winter_3840x1646_2',
  });
});

test('osg verify takes header and search art for what it is, and still wants it opaque', () => {
  const png = (width: number, height: number, hasAlpha = false) => ({
    width,
    height,
    bitDepth: 8,
    colorType: hasAlpha ? 6 : 2,
    hasAlpha,
    interlace: 0,
    bytes: 2_000_000,
  });
  const appstore = rulesetFor('appstore');
  for (const [width, height] of [
    [3840, 1646],
    [3840, 2560],
    [2400, 1600],
    [5244, 2950],
  ]) {
    const findings = checkPng(png(width, height), appstore);
    assert.deepEqual(findings.map((finding) => finding.code), ['png-creative-ok'], `${width}x${height}`);
    assert.ok(isCreativeArt(width, height, appstore));
  }
  assert.ok(checkPng(png(3840, 1646, true), appstore).some((finding) => finding.code === 'png-alpha'));
  // Not creative art on Play, where 3840x2560 is an ordinary screenshot size.
  assert.equal(isCreativeArt(3840, 2560, rulesetFor('play')), false);
  assert.equal(isCreativeArt(1206, 2622, appstore), false);
});

test('a placement shows its own art first and falls back to a universal image', () => {
  const header = board('h', [], { creativeAsset: 'header' });
  const universal = board('u', [], { creativeAsset: 'universal' });
  const shot = board('s');
  assert.equal(boardForPlacement([shot, universal, header], 'header'), header);
  assert.equal(boardForPlacement([shot, universal, header], 'search'), universal);
  assert.equal(boardForPlacement([shot], 'search'), undefined);
  assert.deepEqual(screenshotBoards([header, shot, universal]), [shot]);
});

// --- designs built from the project ----------------------------------------------

const KINDS: CreativeAssetKind[] = ['header', 'search', 'universal'];

test('every look lands at Apple size, tagged, with its text inside the safe area at a readable size', () => {
  const look = readProjectLook(screenshotsProject(), 'Habit Garden');
  for (const kind of KINDS) {
    for (const entry of CREATIVE_LOOKS[kind]) {
      const made = buildCreativeBoard(kind, entry.id, look, 'seed');
      const label = `${kind}/${entry.id}`;
      assert.equal(made.creativeAsset, kind, label);
      assert.deepEqual(made.size, { width: creativeSpec(kind).width, height: creativeSpec(kind).height }, label);
      const safe = safeAreaFor(made)!;
      const minGlyph = minReadableGlyph(made);
      const texts = made.elements.filter((el): el is TextElementProps => el.type === 'text');
      assert.ok(texts.length > 0, `${label} has copy`);
      for (const t of texts) {
        assert.ok(inside(t, safe), `${label}: "${t.content}" inside the safe area`);
        assert.ok(t.fontSize / 0.3 >= minGlyph * 0.99, `${label}: "${t.content}" readable on an iPhone`);
      }
      const ids = made.elements.map((el) => el.id);
      assert.equal(new Set(ids).size, ids.length, `${label} ids are unique`);
      assert.ok(ids.every((id) => id.startsWith('cr-seed-')), label);
    }
  }
});

test('the copy and the screens keep every language the project has', () => {
  const look = readProjectLook(screenshotsProject(), 'Habit Garden');
  const made = buildCreativeBoard('search', 'headline-phone', look, 's1');
  const headline = made.elements.find((el) => el.type === 'text' && el.content === 'Track every habit in one place')!;
  const device = made.elements.find((el) => el.type === 'device') as DeviceFrameElementProps;
  assert.equal(made.localized?.['de-DE']?.[headline.id]?.content, 'Jede Gewohnheit an einem Ort verfolgen');
  // Geometry tuned for a phone screenshot does not follow it onto a 3:2 card.
  assert.equal(made.localized?.['de-DE']?.[headline.id]?.detached, undefined);
  assert.equal(made.localized?.['de-DE']?.[headline.id]?.position, undefined);
  assert.equal(device.screenshotSrc, 'asset:shot-en');
  assert.equal(made.localized?.['de-DE']?.[device.id]?.screenshotSrc, 'asset:shot-de');

  // The app name reads the same everywhere, so it is not left counting as
  // untranslated in German and Japanese.
  const name = made.elements.find((el) => el.type === 'text' && el.content === 'Habit Garden')!;
  assert.equal(made.localized?.['de-DE']?.[name.id]?.content, 'Habit Garden');
  assert.equal(made.localized?.['ja']?.[name.id]?.origin, 'manual');

  // And the German projection really shows German.
  const german = projectArtboards([{ ...made, localization: LOCALIZATION }], 'de-DE')[0];
  assert.ok(german.elements.some((el) => el.type === 'text' && el.content.startsWith('Jede Gewohnheit')));
});

test('a design built from a project passes its own App Store check in every language', () => {
  const project = screenshotsProject();
  const look = readProjectLook(project, 'Habit Garden');
  for (const kind of KINDS) {
    for (const entry of CREATIVE_LOOKS[kind]) {
      const made = { ...buildCreativeBoard(kind, entry.id, look, 'c'), localization: LOCALIZATION };
      const checks = checkCreativeBoard([made, ...project], made.id);
      const blocking = checks.flatMap((check) =>
        check.issues
          .filter((issue) => issue.level === 'error' || /^(safe|small|button|clipped):/.test(issue.key))
          .map((issue) => `${check.label}: ${issue.title} ${issue.detail ?? ''}`)
      );
      assert.deepEqual(blocking, [], `${kind}/${entry.id}`);
    }
  }
});

test('a tagline under a wordmark is reflowed, and its translations come along still current', () => {
  const project = screenshotsProject();
  const headline = project[0].elements[0] as TextElementProps;
  headline.content = 'Track every habit\nin one place';
  project[0].localized!['de-DE'].h1 = {
    content: 'Jede Gewohnheit\nan einem Ort verfolgen',
    origin: 'auto',
    sourceHash: hash32('Track every habit\nin one place'),
  };
  const look = readProjectLook(project, 'Habit Garden');

  const header = buildCreativeBoard('header', 'name-phone', look, 'r');
  const tagline = header.elements.find((el) => el.type === 'text' && el.name === 'Subheadline') as TextElementProps;
  assert.equal(tagline.content, 'Track every habit in one place');
  const german = header.localized?.['de-DE']?.[tagline.id];
  assert.equal(german?.content, 'Jede Gewohnheit an einem Ort verfolgen');
  assert.equal(german?.sourceHash, hash32('Track every habit in one place'));

  // A search headline is the main line, so it keeps the writer's breaks.
  const search = buildCreativeBoard('search', 'headline-phone', look, 'r');
  assert.ok(search.elements.some((el) => el.type === 'text' && el.content === 'Track every habit\nin one place'));
});

test('a headline set as several layers comes back as one, in every language that translated all of it', () => {
  const at = (x: number, y: number) => ({ position: { x, y } });
  const parts = [
    text('h-1', 'Wake Up', 60, at(100, 200)),
    text('h-2b', 'Rested', 60, at(620, 420)),
    text('h-2a', 'Actually', 60, { ...at(100, 420), color: '#F4A261' }),
    text('name', 'Somnia', 60, at(100, 2300)),
    text('sub', 'Sleep tracking that earns the nightstand', 24, at(100, 700)),
  ];
  const fresh = (content: string) => hash32(content);
  const shot = board('s1', parts, {
    localization: LOCALIZATION,
    localized: {
      'de-DE': {
        'h-1': { content: 'Wach auf', origin: 'auto', sourceHash: fresh('Wake Up') },
        'h-2a': { content: 'wirklich', origin: 'auto', sourceHash: fresh('Actually') },
        'h-2b': { content: 'erholt', origin: 'auto', sourceHash: fresh('Rested') },
      },
      ja: { 'h-1': { content: '目覚める' } },
    },
  });
  const look = readProjectLook([shot], 'Somnia');
  assert.equal(look.headline?.element.content, 'Wake Up\nActually Rested');
  assert.equal(look.headline?.overrides['de-DE']?.content, 'Wach auf\nwirklich erholt');
  assert.equal(look.headline?.overrides['de-DE']?.sourceHash, hash32('Wake Up\nActually Rested'));
  assert.equal(look.headline?.overrides['de-DE']?.origin, 'auto');
  // Only one of three parts in Japanese: shown as untranslated, not half and half.
  assert.equal(look.headline?.overrides.ja, undefined);
  assert.equal(look.subhead?.element.content, 'Sleep tracking that earns the nightstand');
});

test('a project with nothing in it still gets a finished design, with the name set once', () => {
  const look = readProjectLook([board('blank', [], { backgroundColor: '#FFFFFF' })], '');
  for (const kind of KINDS) {
    for (const entry of CREATIVE_LOOKS[kind]) {
      const made = buildCreativeBoard(kind, entry.id, look, 'b');
      const texts = made.elements.filter((el): el is TextElementProps => el.type === 'text');
      // With no headline the name is the headline, not also a line over it.
      assert.deepEqual(texts.map((t) => t.content.replace(/\s+/g, ' ')), ['Your App'], `${kind}/${entry.id}`);
      assert.equal(made.localized, undefined);
    }
  }
  const made = buildCreativeBoard('search', 'headline-phone', look, 'b');
  assert.ok(made.elements.some((el) => el.type === 'device' && (el as DeviceFrameElementProps).screenshotSrc));
});

test('a wordmark keeps its own face, colour and weight, even when the app name is the only text there is', () => {
  const brand = { fontFamily: 'Playfair Display', color: '#F4A261', fontWeight: '800' };
  const only = readProjectLook([board('s1', [text('mark', 'Somnia', 60, brand)])], 'Somnia');
  assert.equal(only.headline, null);
  assert.equal(only.fontFamily, 'Playfair Display');
  assert.equal(only.textColor, '#F4A261');
  for (const kind of KINDS) {
    for (const entry of CREATIVE_LOOKS[kind]) {
      const made = buildCreativeBoard(kind, entry.id, only, 'w');
      const names = made.elements.filter((el): el is TextElementProps => el.type === 'text' && el.name === 'App name');
      assert.equal(names.length, 1, `${kind}/${entry.id}`);
      assert.deepEqual(
        { fontFamily: names[0].fontFamily, color: names[0].color, fontWeight: names[0].fontWeight },
        brand,
        `${kind}/${entry.id}`
      );
    }
  }

  // A headline in another face sets the headline; the name still wears the wordmark's.
  const mixed = readProjectLook(
    [board('s2', [text('h', 'Sleep deeper tonight', 60, { fontFamily: 'Inter' }), text('mark', 'Somnia', 30, { ...brand, position: { x: 100, y: 2300 } })])],
    'Somnia'
  );
  assert.equal(mixed.fontFamily, 'Inter');
  const search = buildCreativeBoard('search', 'headline-phone', mixed, 'm');
  const name = search.elements.find((el) => el.type === 'text' && el.name === 'App name') as TextElementProps;
  const headline = search.elements.find((el) => el.type === 'text' && el.name === 'Headline') as TextElementProps;
  assert.equal(name.fontFamily, 'Playfair Display');
  assert.equal(name.color, '#F4A261');
  assert.equal(headline.fontFamily, 'Inter');
});

test('a headline the check would warn about is passed over for the next copy on the screenshot', () => {
  const look = readProjectLook(
    [
      board('s1', [
        text('claim', 'The #1 habit app', 70),
        text('real', 'Build habits that stick', 60, { position: { x: 100, y: 500 } }),
        text('long', 'Track every habit you care about with gentle reminders that keep you going all week', 20, {
          position: { x: 100, y: 900 },
        }),
      ]),
    ],
    'Habit Garden'
  );
  assert.equal(look.headline?.element.content, 'Build habits that stick');
  // Longer than Apple's short phrase, so not a tagline either.
  assert.equal(look.subhead, null);
});

test('the app name starts from the project name, never from a template name the check would turn away', () => {
  assert.equal(suggestedAppName('Calora Copy'), 'Calora');
  assert.equal(suggestedAppName('Calora Copy 2'), 'Calora');
  assert.equal(suggestedAppName('Habit Garden'), 'Habit Garden');
  // The Apple Watch template named after the badge it shows.
  assert.equal(suggestedAppName('Editors Choice Copy'), '');
});

// --- the store rules -------------------------------------------------------------

function headerWith(...texts: TextElementProps[]): ArtboardState {
  return board('hdr', texts, { creativeAsset: 'header', size: { width: 3840, height: 1646 } });
}

/**
 * Copy in the middle of the header's safe area, clear of the buttons over its
 * top corners, in a box a short phrase fits.
 */
function inSafe(id: string, content: string): TextElementProps {
  return text(id, content, 30, { position: { x: 1400, y: 700 }, size: { width: 1000, height: 300 } });
}

test('the rules App Review applies to creative art are caught, and ordinary copy is left alone', () => {
  const titles = (content: string) => checkCreativeView(headerWith(inSafe('t', content)), null).map((issue) => issue.title);
  assert.ok(titles('Now only $4.99').includes('No prices or discounts'));
  assert.ok(titles('50% off this week').includes('No prices or discounts'));
  assert.ok(titles('Visit calora.app').includes('No web addresses'));
  assert.ok(titles('© 2026 Calora').includes('No copyright symbols'));
  assert.ok(titles("Editors' Choice").includes('No Apple recognitions'));
  assert.ok(titles('Also on Android').includes('No other platforms or stores'));
  assert.ok(titles('The #1 habit app').includes('A claim Apple cannot verify'));
  assert.ok(titles('Rated 4.9 ★').includes('A claim Apple cannot verify'));
  assert.ok(titles('Free download today').includes('Reads like a price or an offer'));
  assert.deepEqual(titles('Ad-free focus for your best self'), []);
  assert.deepEqual(titles('Stress free mornings'), []);
  assert.ok(titles('one two three four five six seven eight nine ten eleven').includes('Long for a header or search card'));
});

test("the header's back and share buttons sit over the safe area's top corners, and the copy has to clear them", () => {
  const header = { creativeAsset: 'header' as const, size: { width: 3840, height: 1646 } };
  const [back, share] = iphoneHeaderButtonsFor(header);
  const safe = safeAreaFor(header)!;
  // Both overlap the top of the safe area, one at each end.
  assert.ok(back.x < safe.x + 400 && back.y < safe.y + safe.height / 2 && back.y + back.height > safe.y);
  assert.ok(share.x + share.width > safe.x + safe.width - 400);
  assert.equal(Math.round(headerButtonClearance(header)), 285);
  assert.equal(Math.round(headerButtonClearance({ creativeAsset: 'universal', size: { width: 5244, height: 2950 } })), 214);
  assert.equal(headerButtonClearance({ creativeAsset: 'search', size: { width: 3840, height: 2560 } }), 0);
  assert.deepEqual(iphoneHeaderButtonsFor({ creativeAsset: 'search', size: { width: 3840, height: 2560 } }), []);

  const corner = text('corner', 'Plan your week', 50, { position: { x: 1110, y: 500 }, size: { width: 500, height: 150 } });
  const keys = checkCreativeView(headerWith(corner), null).map((issue) => issue.key);
  assert.ok(keys.includes('button:corner'));
  assert.ok(!keys.includes('safe:corner'));
});

test('text the iPhone would crop, text too small to read and the wrong size are all reported', () => {
  const outside = text('out', 'Plan your week', 60, { position: { x: 100, y: 100 }, size: { width: 900, height: 200 } });
  const tiny = text('tiny', 'Fine print', 9, { position: { x: 1200, y: 600 }, size: { width: 600, height: 100 } });
  const issues = checkCreativeView(headerWith(outside, tiny), null);
  assert.ok(issues.some((issue) => issue.key === 'safe:out'));
  assert.ok(issues.some((issue) => issue.key === 'small:tiny'));
  assert.ok(!issues.some((issue) => issue.key === 'safe:tiny'));

  const wrong = { ...headerWith(inSafe('t', 'Plan your week')), size: { width: 1920, height: 823 } };
  assert.equal(checkCreativeView(wrong, null)[0].key, 'size');
  assert.equal(checkCreativeView(wrong, null)[0].level, 'error');
});

test('turned text is checked by the area it covers, and text cut off by its own box is reported', () => {
  const keys = (...texts: TextElementProps[]) => checkCreativeView(headerWith(...texts), null).map((issue) => issue.key);
  // Inside the safe area flat. Turned 30 degrees, the same box covers 1016 x 760
  // and reaches past the safe area's top and bottom.
  assert.deepEqual(keys(inSafe('flat', 'Plan your week')), []);
  assert.ok(keys({ ...inSafe('turned', 'Plan your week'), rotation: 30 }).includes('safe:turned'));
  // A quarter turn of a wide box is still inside if it fits on its end.
  assert.ok(!keys({ ...inSafe('end', 'Plan'), size: { width: 400, height: 200 }, rotation: 90 }).includes('safe:end'));

  // 200px type in a 20px box shows a sliver: TextElement clips at the box.
  const squeezed = text('squeezed', 'Plan your week', 60, { position: { x: 1400, y: 700 }, size: { width: 1000, height: 20 } });
  assert.ok(keys(squeezed).includes('clipped:squeezed'));
  // A second line the box has no room for.
  const twoLines = { ...inSafe('lines', 'Plan your week\nand stick to it'), size: { width: 1000, height: 130 } };
  assert.ok(keys(twoLines).includes('clipped:lines'));
  assert.ok(!keys({ ...twoLines, size: { width: 1000, height: 300 } }).includes('clipped:lines'));
});

test('a language that has no words of its own is reported in that language only', () => {
  const art = { ...headerWith(inSafe('t', 'Plan your week')), localization: LOCALIZATION, localized: { 'de-DE': { t: { content: 'Plane deine Woche' } } } };
  const checks = checkCreativeBoard([art], art.id);
  assert.deepEqual(checks.map((check) => check.locale), [null, 'de-DE', 'ja']);
  assert.equal(checks[0].issues.length, 0);
  assert.equal(checks[1].issues.length, 0);
  assert.deepEqual(checks[2].issues.map((issue) => issue.key), ['untranslated:ja']);
  assert.deepEqual(countIssues(checks), { errors: 0, warnings: 1 });
  assert.deepEqual(checkCreativeView(board('shot'), null), []);
});

// --- what has to leave creative artboards alone --------------------------------------

test('nothing continues across artboard edges onto header art, and the screenshots keep their places in the strip', () => {
  const header = board('hdr', [], { creativeAsset: 'header', size: { width: 3840, height: 1646 } });
  // A spanning phone hanging off the LEFT edge of the first screenshot, with
  // the header right before it on the canvas.
  const spanning = phone('span', { position: { x: -300, y: 800 }, spanArtboards: true });
  const shotA = board('a', [spanning]);
  const shotB = board('b', [phone('span-b', { position: { x: 900, y: 800 }, spanArtboards: true })]);
  const spill = computeSpill([header, shotA, shotB]);
  assert.equal(spill.has('hdr'), false);
  assert.deepEqual(reachedArtboardIds([header, shotA, shotB], 'span'), []);
  // b is the last screenshot, so its phone off the right edge reaches nothing.
  assert.deepEqual(reachedArtboardIds([header, shotA, shotB], 'span-b'), []);
  // With the header BETWEEN two screenshots, a phone off the second one's left
  // edge still lands on the first, one screenshot width along.
  const fromB = phone('from-b', { position: { x: -200, y: 800 }, spanArtboards: true });
  const spillB = computeSpill([shotA, header, board('b2', [fromB])]);
  assert.ok(spillB.has('a'), 'the screenshots stay neighbours with the header between them');
  assert.equal(spillB.get('a')!.front[0].shiftX, 1206);

  // A phone on the header itself never leaves it.
  const onHeader = board('hdr2', [phone('hp', { position: { x: 3500, y: 100 }, spanArtboards: true })], {
    creativeAsset: 'header',
    size: { width: 3840, height: 1646 },
  });
  assert.equal(computeSpill([onHeader, shotA]).size, 0);
  assert.deepEqual(stripBoards([onHeader, shotA, shotB], 'hdr2').map((b) => b.id), ['hdr2']);
  assert.deepEqual(stripBoards([onHeader, shotA, shotB], 'b').map((b) => b.id), ['a', 'b']);
});

test('a spanned background stays sliced across the screenshots when header art joins the project', () => {
  const picture = { backgroundImage: 'asset:panorama', backgroundImageApply: 'span' as const };
  const header = board('hdr', [], { creativeAsset: 'header', size: { width: 3840, height: 1646 } });
  const result = normalizeBackgroundImage([header, board('a', [], picture), board('b')]);
  const [h, a, b] = result;
  assert.equal(h.backgroundImage, undefined);
  assert.equal(h.backgroundImageSlice, undefined);
  assert.deepEqual(a.backgroundImageSlice, { offsetX: 0, totalWidth: 2412, totalHeight: 2622 });
  assert.equal(b.backgroundImage, 'asset:panorama');
  assert.deepEqual(b.backgroundImageSlice, { offsetX: 1206, totalWidth: 2412, totalHeight: 2622 });
});

test('converting the device format and detecting it both skip header and search art', () => {
  const header = board('hdr', [phone('hp', { deviceType: 'pixel-10-pro' })], {
    creativeAsset: 'header',
    size: { width: 3840, height: 1646 },
  });
  const shot = board('s', [phone('sp')]);
  assert.equal(detectArtboardsFormat([header, shot]), 'ios');
  const ipad = DEVICE_FORMAT_PRESETS.find((preset) => preset.id === 'ipad-pro-13')!;
  const converted = convertArtboardsToFormat([header, shot], ipad).artboards;
  assert.equal(converted[0], header);
  assert.deepEqual(converted[1].size, ipad.artboard);
});
