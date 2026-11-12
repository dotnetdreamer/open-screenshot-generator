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
  iphoneAreaFor,
  iphoneCropFor,
  iphoneHeaderButtonsFor,
  minReadableGlyph,
  safeAreaFor,
  screenshotBoards,
} from '@/lib/creative/specs';
import { hash32 } from '@/lib/i18n/hash';
import { checkPng, isCreativeArt, rulesetFor } from '../../cli/src/verify/rules';
import {
  boardFacesMissing,
  boardFacesPending,
  buildCreativeBoard,
  canRebuildCreativeBoard,
  CREATIVE_LOOKS,
  lookFacesPending,
  readProjectLook,
  rebuildCreativeBoard,
  suggestedAppName,
} from '@/lib/creative/layouts';
import { checkCreativeBoard, checkCreativeView, countIssues } from '@/lib/creative/check';
import { fitGlyph, roughWidth, type Face } from '@/lib/creative/typeFit';
import { headerTopEdge } from '@/lib/creative/topEdge';
import { decodeCreativeLookChoice, encodeCreativeLookChoice } from '@/lib/creative/paletteDrag';
import { computeSpill, reachedArtboardIds, stripBoards } from '@/lib/spanArtboards';
import { normalizeBackgroundImage } from '@/lib/artboardBackground';
import { convertArtboardsToFormat, detectArtboardsFormat, DEVICE_FORMAT_PRESETS } from '@/lib/deviceRegistry';
import { projectArtboards } from '@/lib/i18n/project';
import type {
  ArtboardElement,
  ArtboardState,
  CreativeAssetKind,
  DeviceFrameElementProps,
  ImageElementProps,
  ProjectLocalization,
  ShapeElementProps,
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
    const art = { creativeAsset: spec.kind, size: { width: spec.width, height: spec.height } };
    assert.ok(rectInside(spec.safe, canvas, 0), spec.kind);
    for (const placement of spec.placements) {
      const crop = iphoneCropFor(art, placement)!;
      assert.ok(rectInside(crop, canvas, 0.5), `${spec.kind} ${placement} crop`);
      // Whatever is inside the safe area shows on an iPhone.
      assert.ok(rectInside(spec.safe, crop, 1), `${spec.kind} ${placement}`);
    }
  }
  assert.deepEqual(creativeSpec('universal').imageFormats, ['PNG']);
  assert.equal(creativeSpec('universal').video, null);
});

test('an iPhone shows far more than the safe area: all of a header top to bottom, and search art from edge to edge', () => {
  const header = { creativeAsset: 'header' as const, size: { width: 3840, height: 1646 } };
  const search = { creativeAsset: 'search' as const, size: { width: 3840, height: 2560 } };
  const universal = { creativeAsset: 'universal' as const, size: { width: 5244, height: 2950 } };

  // A header keeps its full height and loses about 8% at each side.
  const headerCrop = iphoneCropFor(header, 'header')!;
  assert.equal(headerCrop.y, 0);
  assert.equal(headerCrop.height, 1646);
  assert.ok(headerCrop.width / 3840 > 0.82 && headerCrop.width / 3840 < 0.86, `${headerCrop.width}`);
  assert.equal(Math.round(headerCrop.x * 2 + headerCrop.width), 3840);
  // The safe area is about half as wide as that, and two fifths as tall.
  assert.ok(safeAreaFor(header)!.width / headerCrop.width < 0.55);

  // Search art keeps its whole width and its top, and loses a strip along the bottom.
  const searchCrop = iphoneCropFor(search, 'search')!;
  assert.deepEqual([searchCrop.x, searchCrop.y, searchCrop.width], [0, 0, 3840]);
  assert.ok(searchCrop.height / 2560 > 0.82 && searchCrop.height / 2560 < 0.86, `${searchCrop.height}`);

  // What App Store Connect's iPhone preview showed of the design in issue #46:
  // the search card was 296 x 165 on screen, the copy began 75 pixels in and
  // the phone 65 pixels down. The design looks like this editor's own, and is
  // taken to have had no layer moved, which puts its copy at x 966 and its
  // phone at y 844. The project itself was not to hand.
  assert.ok(Math.abs(966 / searchCrop.width - 75 / 296) < 0.01);
  assert.ok(Math.abs(844 / searchCrop.height - 65 / 165) < 0.01);

  // A smaller search board is cropped the same way.
  const half = iphoneCropFor({ creativeAsset: 'search', size: { width: 1920, height: 1280 } }, 'search')!;
  assert.equal(half.width, 1920);
  assert.equal(Math.round(half.height * 2), Math.round(searchCrop.height));

  // A universal image is as wide as either window, so it keeps its width in
  // both and its top; the header window is the shorter of the two.
  const asHeader = iphoneCropFor(universal, 'header')!;
  const asSearch = iphoneCropFor(universal, 'search')!;
  assert.deepEqual([asHeader.x, asHeader.y, asHeader.width], [0, 0, 5244]);
  assert.deepEqual([asSearch.x, asSearch.y, asSearch.width], [0, 0, 5244]);
  assert.ok(asHeader.height < asSearch.height && asSearch.height < 2950);
  assert.deepEqual(iphoneAreaFor(universal), asHeader);
  assert.deepEqual(iphoneAreaFor(header), headerCrop);

  // Art is only cropped for a placement it fills, and a screenshot never is.
  assert.equal(iphoneCropFor(header, 'search'), null);
  assert.equal(iphoneCropFor(search, 'header'), null);
  assert.equal(iphoneCropFor({ size: { width: 1206, height: 2622 } }, 'header'), null);
  assert.equal(iphoneAreaFor({ size: { width: 1206, height: 2622 } }), null);
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

test('creative presets are the MCP way in, and the summary carries the two areas an agent cannot see', () => {
  assert.equal(creativeSpecForPreset('appstore-header')?.kind, 'header');
  assert.equal(creativeSpecForPreset('ios-6-3'), undefined);
  assert.deepEqual(creativeSummary({ creativeAsset: 'header', size: { width: 3840, height: 1646 } }), {
    creativeAsset: 'header',
    safeArea: { x: 1097, y: 493, width: 1646, height: 661 },
    iphoneArea: { x: 315, y: 0, width: 3210, height: 1646 },
  });
  assert.deepEqual(creativeSummary({ creativeAsset: 'search', size: { width: 3840, height: 2560 } }).iphoneArea, {
    x: 0,
    y: 0,
    width: 3840,
    height: 2145,
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

test('every look lands at Apple size, its text inside the safe area at a size that reads, its screens inside what an iPhone shows', () => {
  const look = readProjectLook(screenshotsProject(), 'Habit Garden');
  for (const kind of KINDS) {
    for (const entry of CREATIVE_LOOKS[kind]) {
      const made = buildCreativeBoard(kind, entry.id, look, 'seed');
      const label = `${kind}/${entry.id}`;
      assert.equal(made.creativeAsset, kind, label);
      assert.deepEqual(made.size, { width: creativeSpec(kind).width, height: creativeSpec(kind).height }, label);
      const safe = safeAreaFor(made)!;
      const shown = iphoneAreaFor(made)!;
      const minGlyph = minReadableGlyph(made);
      const texts = made.elements.filter((el): el is TextElementProps => el.type === 'text');
      assert.ok(texts.length > 0, `${label} has copy`);
      for (const t of texts) {
        assert.ok(inside(t, safe), `${label}: "${t.content}" inside the safe area`);
        assert.ok(t.fontSize / 0.3 >= minGlyph * 0.99, `${label}: "${t.content}" readable on an iPhone`);
      }
      // A screen may run off the bottom, never off a side the phone shows.
      for (const d of made.elements.filter((el) => el.type === 'device')) {
        assert.ok(d.position.x >= shown.x - 1, `${label}: a screen is cut at the left on an iPhone`);
        assert.ok(d.position.x + d.size.width <= shown.x + shown.width + 1, `${label}: a screen is cut at the right`);
        assert.ok(d.position.y < shown.y + shown.height, `${label}: a screen is below what an iPhone shows`);
      }
      const ids = made.elements.map((el) => el.id);
      assert.equal(new Set(ids).size, ids.length, `${label} ids are unique`);
      assert.ok(ids.every((id) => id.startsWith('cr-seed-')), label);
    }
  }
});

test('the type is sized for the phone that shows the art smallest, which is an iPhone at full width', () => {
  // 11pt on an iPhone, in artboard pixels: a header shows 3210 of them across
  // 393 points, a search card 3840 across 353, a universal image 5244 across 353.
  assert.equal(Math.round(minReadableGlyph({ creativeAsset: 'header', size: { width: 3840, height: 1646 } })), 90);
  assert.equal(Math.round(minReadableGlyph({ creativeAsset: 'search', size: { width: 3840, height: 2560 } })), 120);
  assert.equal(Math.round(minReadableGlyph({ creativeAsset: 'universal', size: { width: 5244, height: 2950 } })), 163);
  assert.equal(minReadableGlyph({ size: { width: 1206, height: 2622 } }), 0);
});

test('the screens sit beside the safe area, so the copy has all of it and the design fills the phone', () => {
  const look = readProjectLook(screenshotsProject(), 'Habit Garden');
  /** How much of the width an iPhone shows the design covers, from its first element to its last. */
  const span = (made: ArtboardState) => {
    const shown = iphoneAreaFor(made)!;
    const left = Math.min(...made.elements.map((el) => el.position.x));
    const right = Math.max(...made.elements.map((el) => el.position.x + el.size.width));
    return (Math.min(right, shown.x + shown.width) - Math.max(left, shown.x)) / shown.width;
  };
  const devices = (made: ArtboardState) => made.elements.filter((el) => el.type === 'device');

  const search = buildCreativeBoard('search', 'headline-phone', look, 'f');
  const safe = safeAreaFor(search)!;
  const headline = search.elements.find((el) => el.type === 'text' && el.name === 'Headline') as TextElementProps;
  // The headline takes the width of the safe area, at about twice the least that reads.
  assert.ok(headline.size.width > safe.width * 0.85);
  assert.ok(headline.fontSize / 0.3 > minReadableGlyph(search) * 1.6, `${headline.fontSize / 0.3}`);
  // A search result prints the app name right above the art, so the art does not repeat it.
  assert.equal(search.elements.some((el) => el.name === 'App name'), false);
  assert.ok(devices(search)[0].position.x >= safe.x + safe.width);
  assert.ok(span(search) > 0.7, `${span(search)}`);

  // A screen each side of the headline.
  const pair = buildCreativeBoard('search', 'two-phones', look, 'f');
  const [left, right] = devices(pair).sort((a, b) => a.position.x - b.position.x);
  assert.ok(left.position.x + left.size.width <= safe.x && right.position.x >= safe.x + safe.width);
  assert.ok(span(pair) > 0.9, `${span(pair)}`);

  // A header's screen stays out from under the share button over its corner.
  const header = buildCreativeBoard('header', 'name-phone', look, 'f');
  const [, share] = iphoneHeaderButtonsFor(header);
  const screen = devices(header)[0];
  assert.ok(screen.position.x >= safeAreaFor(header)!.x + safeAreaFor(header)!.width);
  assert.ok(screen.position.y >= share.y + share.height, `${screen.position.y} under the button at ${share.y + share.height}`);
  assert.ok(span(header) > 0.65, `${span(header)}`);
  assert.ok(span(buildCreativeBoard('header', 'showcase', look, 'f')) > 0.75);
});

test('a line with no room at a size that reads is left out, and the name takes its place', () => {
  const look = readProjectLook(screenshotsProject(), 'Habit Garden');
  // The universal safe area is about 94 points wide in a search result. A
  // tagline does not fit there at 11pt, so the wordmark stands alone, on two
  // lines because that sets it bigger.
  const universal = buildCreativeBoard('universal', 'wordmark', look, 'u');
  const texts = universal.elements.filter((el): el is TextElementProps => el.type === 'text');
  assert.deepEqual(texts.map((t) => t.content), ['Habit\nGarden']);
  // The same wordmark on search art has the room, and keeps its line.
  const search = buildCreativeBoard('search', 'wordmark', look, 'u');
  assert.deepEqual(
    search.elements.filter((el) => el.type === 'text').map((el) => el.name),
    ['App name', 'Subheadline']
  );
  // A header never has one: the page prints the name and subtitle right under it.
  const header = buildCreativeBoard('header', 'wordmark', look, 'u');
  assert.deepEqual(header.elements.map((el) => el.name), ['App name']);
});

// --- type that fits its box ------------------------------------------------------

/**
 * Arial Bold's own advance widths for these letters, in ems. They come to 9.72
 * for "MOMMY MORNINGS", which is what a browser measures for it.
 */
const ARIAL_BOLD: Record<string, number> = {
  M: 0.833,
  O: 0.778,
  Y: 0.667,
  R: 0.722,
  N: 0.722,
  I: 0.278,
  G: 0.778,
  S: 0.667,
  ' ': 0.278,
};

/** A project whose headline is set in Arial and is too long to sit under a name on the universal image. */
function arialProject(): ArtboardState[] {
  return [board('shot', [text('h1', 'Calm mornings for the whole family', 48, { fontFamily: 'Arial' }), phone('p1')])];
}

test("a name in capitals fits its box by Arial Bold's own widths, which an average letter falls short of", () => {
  // Found reviewing the fix for issue #46: sized by one average letter,
  // "MORNINGS" was taken to be narrower than Arial sets it, broke onto a line
  // its box had no room for, and the box cut it off. Every design that sets
  // the name is held to the real widths here.
  const look = readProjectLook(arialProject(), 'MOMMY MORNINGS');
  let named = 0;
  for (const kind of KINDS) {
    for (const entry of CREATIVE_LOOKS[kind]) {
      const made = buildCreativeBoard(kind, entry.id, look, 'caps');
      const name = made.elements.find((el) => el.name === 'App name') as TextElementProps | undefined;
      if (!name) continue;
      named += 1;
      const label = `${kind}/${entry.id}`;
      assert.equal(name.fontFamily, 'Arial', label);
      const glyph = name.fontSize / 0.3;
      const tracking = (name.letterSpacing ?? 0) / 0.3;
      const lines = name.content.split('\n');
      for (const line of lines) {
        const width = [...line].reduce((sum, char) => sum + ARIAL_BOLD[char] * glyph + tracking, 0);
        // The box's own padding is 2px each side.
        assert.ok(width <= name.size.width - 4, `${label}: "${line}" is ${Math.round(width)}px in a ${name.size.width}px box`);
      }
      assert.ok(name.size.height >= lines.length * glyph * name.lineHeight! + 4, `${label}: the box holds its lines`);
      assert.ok(glyph >= minReadableGlyph(made) * 0.99, `${label}: still a size that reads`);
    }
  }
  // Wordmark, name and screen, and showcase on a header; the wordmark on search art; both universal designs.
  assert.equal(named, 6);
});

test('a name with no room on two lines takes three, at a size that still reads', () => {
  // The universal safe area is 94 points wide on a phone. "Open Screenshot" is
  // too long for one line of it at 11pt, so the name goes a word to a line.
  const look = readProjectLook(arialProject(), 'Open Screenshot Generator');
  const made = buildCreativeBoard('universal', 'wordmark', look, 'three');
  const [name] = made.elements.filter((el): el is TextElementProps => el.type === 'text');
  assert.equal(name.content, 'Open\nScreenshot\nGenerator');
  assert.ok(name.fontSize / 0.3 >= minReadableGlyph(made) * 0.99);
  assert.ok(inside(name, safeAreaFor(made)!));
  // In every language the name reads the same, broken the same way.
  assert.deepEqual(checkCreativeView(made, null).filter((issue) => /^(clipped|small|safe):/.test(issue.key)), []);

  // A header is wide enough for two lines, which set the name far bigger than
  // three would in its shallow safe area.
  const header = buildCreativeBoard('header', 'wordmark', look, 'three');
  const wide = header.elements[0] as TextElementProps;
  assert.equal(wide.content, 'Open Screenshot\nGenerator');
  assert.ok(wide.fontSize / 0.3 > minReadableGlyph(header) * 1.5, `${wide.fontSize / 0.3}`);
});

test('a name with no room at a size that reads is set whole and smaller, never cut and never broken inside a word', () => {
  // One word of twenty letters, in a safe area that holds about twelve at 11pt.
  const look = readProjectLook(arialProject(), 'Supercalifragilistic');
  const made = buildCreativeBoard('universal', 'wordmark', look, 'long');
  const [name] = made.elements.filter((el): el is TextElementProps => el.type === 'text');
  assert.equal(name.content, 'Supercalifragilistic');
  const glyph = name.fontSize / 0.3;
  const face: Face = { fontFamily: 'Arial', fontWeight: '700', lineHeight: name.lineHeight!, tracking: -0.02 };
  // On one line, inside its box.
  assert.ok(roughWidth(name.content, face) * glyph <= name.size.width - 4);
  assert.ok(name.size.height >= glyph * name.lineHeight! + 4);
  assert.ok(inside(name, safeAreaFor(made)!));
  // Under the size that reads, by no more than half, and the check says so.
  assert.ok(glyph < minReadableGlyph(made) && glyph >= minReadableGlyph(made) * 0.5, `${glyph}`);
  const keys = checkCreativeView(made, null).map((issue) => issue.key.split(':')[0]);
  assert.ok(keys.includes('small'));
  assert.ok(!keys.includes('clipped'));

  // The headline of search art is held to the same: one word far too long for
  // its line comes out smaller, and the design still has its headline.
  const wordy = [board('shot', [text('h1', 'Pneumonoultramicroscopicsilicovolcanoconiosis explained', 48), phone('p1')])];
  const search = buildCreativeBoard('search', 'headline-phone', readProjectLook(wordy, 'Lexicon'), 'long');
  const headline = search.elements.find((el) => el.name === 'Headline') as TextElementProps;
  assert.ok(headline, 'the headline is never left out');
  const copy: Face = { fontFamily: headline.fontFamily, fontWeight: '700', lineHeight: headline.lineHeight!, tracking: -0.015 };
  assert.ok(roughWidth('Pneumonoultramicroscopicsilicovolcanoconiosis', copy) * (headline.fontSize / 0.3) <= headline.size.width - 4);
});

test('the fit never breaks a word to make it fit, and says when the smallest size is still too big', () => {
  const face: Face = { fontFamily: 'Arial', fontWeight: '700', lineHeight: 1.1, tracking: 0 };
  const box = { width: 1000, height: 600 };
  // Two words that fit a line each: as big as the box's height takes two lines.
  const two = fitGlyph('Habit Garden', box, { max: 400, min: 60, maxLines: 2, face });
  assert.equal(two.fits, true);
  assert.equal(two.lines, 2);
  assert.ok(two.glyph * 1.1 * 2 + 4 <= box.height);
  assert.ok(roughWidth('Garden', face) * two.glyph <= box.width - 4);
  // The same copy held to one line comes out smaller, and never under `min`.
  const one = fitGlyph('Habit Garden', box, { max: 400, min: 60, maxLines: 1, face });
  assert.equal(one.lines, 1);
  assert.ok(one.glyph < two.glyph && one.glyph >= 60);
  // A word wider than the box at the smallest size is not made to fit by
  // breaking it across the lines it is allowed.
  const long = fitGlyph('Supercalifragilistic', box, { max: 400, min: 120, maxLines: 4, face });
  assert.equal(long.fits, false);
  assert.ok(Math.abs(long.glyph - 120) < 0.5);
  // A size a text element can store, to one decimal of its fontSize.
  for (const fit of [two, one, long]) assert.ok(Math.abs(fit.glyph * 3 - Math.round(fit.glyph * 3)) < 1e-6);
  // Capitals are counted wider than lower case, and a CJK glyph as a full em.
  assert.ok(roughWidth('MORNINGS', face) > roughWidth('mornings', face) * 1.1);
  assert.ok(roughWidth('MORNINGS', face) >= 5.5, 'no narrower than Arial Bold sets it');
  assert.equal(roughWidth('日本語', face), 3);
});

test('copy that several languages share is fitted to the base language as well as the longest one', () => {
  // Longer by the letter, in short words.
  const german = 'Kurz und gut ist es hier wohl';
  // Shorter, with one word that needs a line to itself.
  const english = 'Internationalization rocks';
  const face: Face = { fontFamily: 'Arial', fontWeight: '700', lineHeight: 1.1, tracking: 0 };
  const box = { width: 1000, height: 420 };
  const word = roughWidth('Internationalization', face);
  const germanOnly = fitGlyph(german, box, { max: 300, min: 40, maxLines: 3, face });
  const both = fitGlyph([english, german], box, { max: 300, min: 40, maxLines: 3, face });
  // Sized for the German alone, the English word is wider than its line.
  assert.ok(word * germanOnly.glyph > box.width - 4);
  assert.equal(both.fits, true);
  assert.ok(word * both.glyph <= box.width - 4, `${both.glyph}`);

  // A translation that runs long is shrunk to fit when it is drawn. The base
  // language is not, so a design has to fit the base copy as it stands.
  const project = [
    board('shot', [text('h1', english, 60), phone('p1')], {
      localization: LOCALIZATION,
      localized: { 'de-DE': { h1: { content: german, origin: 'manual' } } },
    }),
  ];
  const made = buildCreativeBoard('search', 'headline-phone', readProjectLook(project, 'Lexicon'), 'langs');
  const headline = made.elements.find((el) => el.name === 'Headline') as TextElementProps;
  assert.equal(headline.content, english);
  assert.equal(made.localized?.['de-DE']?.[headline.id]?.content, german);
  const set: Face = { fontFamily: headline.fontFamily, fontWeight: '700', lineHeight: headline.lineHeight!, tracking: -0.015 };
  assert.ok(roughWidth('Internationalization', set) * (headline.fontSize / 0.3) <= headline.size.width - 4);
});

// --- art that is already in the project ----------------------------------------------

/**
 * Search art the way the first designs laid it out: an eyebrow with the app
 * name, the headline, a line under it and the phone, all inside the safe area.
 * The user has since changed the headline, translated it, swapped the screen
 * and added a layer of their own.
 */
function firstDesignSearch(): ArtboardState {
  return board(
    'artboard_old1s_search',
    [
      text('cr-old1s-search-name', 'Habit Garden', 13.5, {
        name: 'App name',
        position: { x: 966, y: 880 },
        size: { width: 1000, height: 60 },
        color: '#C7D2FE',
        fontWeight: '600',
      }),
      text('cr-old1s-search-headline', 'Plan every habit\nyour own way', 42, {
        name: 'Headline',
        position: { x: 966, y: 960 },
        size: { width: 1100, height: 330 },
        color: '#FDE68A',
      }),
      text('cr-old1s-search-subhead', 'Streaks that forgive a day off', 17, {
        name: 'Subheadline',
        position: { x: 966, y: 1320 },
        size: { width: 1100, height: 80 },
        color: '#A5B4FC',
        fontWeight: '400',
      }),
      phone('cr-old1s-search-phone', {
        name: 'Phone',
        position: { x: 2250, y: 844 },
        size: { width: 500, height: 1060 },
        screenshotSrc: 'asset:mine',
      }),
      text('badge', 'Beta', 20, { name: 'Badge', position: { x: 3300, y: 200 }, size: { width: 300, height: 100 } }),
    ],
    {
      name: 'Winter search',
      creativeAsset: 'search',
      size: { width: 3840, height: 2560 },
      backgroundColor: '#1E1B4B',
      localization: LOCALIZATION,
      localized: {
        'de-DE': {
          'cr-old1s-search-name': { content: 'Habit Garden', origin: 'manual' },
          'cr-old1s-search-headline': { content: 'Plane jede Gewohnheit\nauf deine Art', origin: 'manual' },
          'cr-old1s-search-phone': { screenshotSrc: 'asset:mine-de' },
          badge: { content: 'Beta', origin: 'manual' },
        },
      },
    }
  );
}

test('art made before the designs were sized for an iPhone is laid out again, with its own words, screens and translations', () => {
  const old = firstDesignSearch();
  const project = [old, ...screenshotsProject()];
  // The check says what is wrong with it: type nobody can read, and screens that leave the phone bare.
  const before = checkCreativeView(old, null).map((issue) => issue.key);
  assert.ok(before.includes('small:cr-old1s-search-name'));
  assert.ok(before.includes('screens'));
  assert.equal(canRebuildCreativeBoard(old), true);

  const rebuilt = rebuildCreativeBoard(old, project, { seed: 'fresh', appName: 'Habit Garden' })!;
  const byId = (id: string) => rebuilt.elements.find((el) => el.id === id);
  const safe = safeAreaFor(rebuilt)!;

  // The artboard is still the user's: its id, its name, its ground, its size.
  assert.equal(rebuilt.id, old.id);
  assert.equal(rebuilt.name, 'Winter search');
  assert.equal(rebuilt.backgroundColor, '#1E1B4B');
  assert.deepEqual(rebuilt.size, old.size);

  // The words as they were edited, in the colours they were given, on the same layers.
  const headline = byId('cr-old1s-search-headline') as TextElementProps;
  assert.equal(headline.content, 'Plan every habit\nyour own way');
  assert.equal(headline.color, '#FDE68A');
  assert.ok(headline.fontSize / 0.3 > minReadableGlyph(rebuilt) * 1.5, `${headline.fontSize / 0.3}`);
  const line = byId('cr-old1s-search-subhead') as TextElementProps;
  assert.equal(line.content, 'Streaks that forgive a day off');
  assert.equal(line.color, '#A5B4FC');
  assert.ok(line.fontSize / 0.3 >= minReadableGlyph(rebuilt) * 0.99);
  // Search art no longer repeats the app name over its headline.
  assert.equal(byId('cr-old1s-search-name'), undefined);

  // The screen the user put in, now beside the safe area where an iPhone shows it.
  const screen = byId('cr-old1s-search-phone') as DeviceFrameElementProps;
  assert.equal(screen.screenshotSrc, 'asset:mine');
  assert.ok(screen.position.x >= safe.x + safe.width);
  assert.ok(screen.size.height > 1060 * 1.4, `${screen.size.height}`);

  // Translations stay on their layers, the dropped layer's go with it, and the user's own layer is untouched.
  assert.equal(rebuilt.localized?.['de-DE']?.['cr-old1s-search-headline']?.content, 'Plane jede Gewohnheit\nauf deine Art');
  assert.equal(rebuilt.localized?.['de-DE']?.['cr-old1s-search-phone']?.screenshotSrc, 'asset:mine-de');
  assert.equal(rebuilt.localized?.['de-DE']?.['cr-old1s-search-name'], undefined);
  assert.deepEqual(rebuilt.localized?.['de-DE']?.badge, { content: 'Beta', origin: 'manual' });
  assert.deepEqual(byId('badge'), old.elements[4]);
  assert.equal(rebuilt.elements[rebuilt.elements.length - 1].id, 'badge');

  // Nothing left for the check to say about the design's own layers.
  const after = checkCreativeView(rebuilt, null)
    .map((issue) => issue.key)
    .filter((key) => !key.endsWith(':badge'));
  assert.deepEqual(after, []);
  // And doing it again changes nothing.
  assert.deepEqual(rebuildCreativeBoard(rebuilt, [rebuilt, ...screenshotsProject()], { seed: 'again', appName: 'Habit Garden' }), rebuilt);
});

test('a duplicated design is rebuilt from the names of its layers, with each screen kept on its side', () => {
  const project = screenshotsProject();
  const look = readProjectLook(project, 'Habit Garden');
  const made = buildCreativeBoard('search', 'two-phones', look, 'pair');
  const sides = (from: ArtboardState) =>
    from.elements
      .filter((el): el is DeviceFrameElementProps => el.type === 'device')
      .sort((a, b) => a.position.x - b.position.x)
      .map((el) => el.screenshotSrc);
  // Duplicating an artboard gives every layer a new id, and moves the
  // translations onto the new ids.
  const renamed = new Map(made.elements.map((el, index) => [el.id, `el_copy_${index}`]));
  const copy: ArtboardState = {
    ...made,
    id: 'artboard_copy',
    elements: made.elements.map((el) => ({ ...el, id: renamed.get(el.id)! }) as ArtboardElement),
    localized: Object.fromEntries(
      Object.entries(made.localized ?? {}).map(([locale, layers]) => [
        locale,
        Object.fromEntries(Object.entries(layers).map(([id, override]) => [renamed.get(id) ?? id, override])),
      ])
    ),
  };
  assert.equal(canRebuildCreativeBoard(copy), true);
  const rebuilt = rebuildCreativeBoard(copy, [copy, ...project], { seed: 'dup', appName: 'Habit Garden' })!;
  assert.deepEqual(sides(rebuilt), sides(made));
  assert.ok(rebuilt.elements.every((el) => el.id.startsWith('cr-dup-search-')));
  assert.deepEqual(
    rebuilt.elements.map((el) => [el.name, el.position, el.size]),
    made.elements.map((el) => [el.name, el.position, el.size])
  );

  // Art no design here made has nothing to lay out again.
  const own = board('own', [text('title', 'Plan your week', 40, { name: 'Title' })], {
    creativeAsset: 'header',
    size: { width: 3840, height: 1646 },
  });
  assert.equal(canRebuildCreativeBoard(own), false);
  assert.equal(rebuildCreativeBoard(own, [own, ...project], { seed: 'x', appName: 'Habit Garden' }), null);
  assert.equal(canRebuildCreativeBoard(project[0]), false);
});

test('laying a design out again changes nothing that was right, and puts right type fitted in the wrong face', () => {
  // A long line under the name, so the designs that carry one have to make room for it.
  const wordy = screenshotsProject();
  (wordy[0].elements[0] as TextElementProps).content = 'Internationalization made wonderfully simple';
  for (const project of [screenshotsProject(), wordy]) {
    for (const name of ['Habit Garden', 'MOMMY MORNINGS', 'Open Screenshot Generator']) {
      const look = readProjectLook(project, name);
      for (const kind of KINDS) {
        for (const entry of CREATIVE_LOOKS[kind]) {
          const label = `${name}: ${kind}/${entry.id}`;
          const made = { ...buildCreativeBoard(kind, entry.id, look, 'same'), localization: LOCALIZATION };
          // Pressing Rebuild design on art that is already right is not a change.
          const again = rebuildCreativeBoard(made, [made, ...project], { seed: 'unused', appName: 'Other' })!;
          assert.deepEqual(again.elements, made.elements, label);
          assert.deepEqual(again.localized, made.localized, label);

          // What the editor does once a face that was too slow arrives: the art
          // went in with its type fitted in the fallback, here a third too big.
          const misfit: ArtboardState = {
            ...made,
            elements: made.elements.map((el) => (el.type === 'text' ? { ...el, fontSize: el.fontSize * 1.3 } : el)),
          };
          const refit = rebuildCreativeBoard(misfit, [misfit, ...project], { seed: 'unused', appName: 'Other' })!;
          assert.deepEqual(refit.elements, made.elements, label);
        }
      }
    }
  }
  // With no page there are no faces to wait for or to be on their way.
  const made = buildCreativeBoard('header', 'wordmark', readProjectLook(screenshotsProject(), 'Habit Garden'), 'late');
  assert.equal(boardFacesPending(made), null);
  assert.equal(boardFacesMissing(made), false);
});

test('search art at a smaller size Apple takes is built and rebuilt at that size', () => {
  const project = screenshotsProject();
  const look = readProjectLook(project, 'Habit Garden');
  const half = { width: 1920, height: 1280 };
  const made = buildCreativeBoard('search', 'headline-phone', look, 'half', { size: half });
  assert.deepEqual(made.size, half);
  const safe = safeAreaFor(made)!;
  const full = buildCreativeBoard('search', 'headline-phone', look, 'half');
  for (const [index, el] of made.elements.entries()) {
    if (el.type === 'text') assert.ok(inside(el, safe), `"${el.name}" inside the safe area at half size`);
    // Half the size, to the pixel or two that rounding moves it.
    assert.ok(Math.abs(el.size.width * 2 - full.elements[index].size.width) <= 4, `${el.name}`);
  }
  assert.deepEqual(checkCreativeView(made, null).map((issue) => issue.key), []);
  const rebuilt = rebuildCreativeBoard(made, [made, ...project], { seed: 'x', appName: 'Habit Garden' })!;
  assert.deepEqual(rebuilt.size, half);
  assert.deepEqual(rebuilt.elements.map((el) => [el.id, el.position, el.size]), made.elements.map((el) => [el.id, el.position, el.size]));
});

test('with no page to load fonts into, a design is built right away', () => {
  assert.equal(lookFacesPending(readProjectLook(screenshotsProject(), 'Habit Garden')), null);
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
  const mark = buildCreativeBoard('search', 'wordmark', look, 's2');
  const name = mark.elements.find((el) => el.name === 'App name') as TextElementProps;
  assert.equal(name.content, 'Habit Garden');
  assert.equal(mark.localized?.['de-DE']?.[name.id]?.content, 'Habit Garden');
  assert.equal(mark.localized?.['ja']?.[name.id]?.origin, 'manual');

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
          .filter((issue) => issue.level === 'error' || /^(safe|small|button|clipped|screens)(:|$)/.test(issue.key))
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
  const header = buildCreativeBoard('header', 'name-phone', mixed, 'm');
  const name = header.elements.find((el) => el.type === 'text' && el.name === 'App name') as TextElementProps;
  const line = header.elements.find((el) => el.type === 'text' && el.name === 'Subheadline') as TextElementProps;
  assert.equal(name.fontFamily, 'Playfair Display');
  assert.equal(name.color, '#F4A261');
  assert.equal(line.fontFamily, 'Inter');
  const search = buildCreativeBoard('search', 'headline-phone', mixed, 'm');
  assert.equal((search.elements.find((el) => el.name === 'Headline') as TextElementProps).fontFamily, 'Inter');
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

/** Copy in the middle of the header's safe area, in a box a short phrase fits. */
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

test("the header's back and share buttons sit over the top corners of what an iPhone shows, clear of the safe area", () => {
  const header = { creativeAsset: 'header' as const, size: { width: 3840, height: 1646 } };
  const [back, share] = iphoneHeaderButtonsFor(header);
  const safe = safeAreaFor(header)!;
  const shown = iphoneCropFor(header, 'header')!;
  // One in each top corner of the part the phone shows.
  assert.ok(rectInside(back, shown) && rectInside(share, shown));
  assert.ok(back.x - shown.x < shown.width * 0.05 && back.y < shown.height * 0.02);
  assert.ok(shown.x + shown.width - (share.x + share.width) < shown.width * 0.05 && share.y < shown.height * 0.02);
  // Neither reaches the safe area, so copy kept inside it is never covered.
  assert.ok(back.x + back.width < safe.x && back.y + back.height < safe.y);
  assert.ok(share.x > safe.x + safe.width && share.y + share.height < safe.y);
  const universal = { creativeAsset: 'universal' as const, size: { width: 5244, height: 2950 } };
  const universalSafe = safeAreaFor(universal)!;
  const buttons = iphoneHeaderButtonsFor(universal);
  assert.equal(buttons.length, 2);
  assert.ok(buttons[0].x + buttons[0].width < universalSafe.x && buttons[1].x > universalSafe.x + universalSafe.width);
  assert.deepEqual(iphoneHeaderButtonsFor({ creativeAsset: 'search', size: { width: 3840, height: 2560 } }), []);

  // Text dragged out to a corner is reported for both reasons.
  const corner = text('corner', 'Plan your week', 50, { position: { x: 500, y: 100 }, size: { width: 500, height: 150 } });
  const keys = checkCreativeView(headerWith(corner), null).map((issue) => issue.key);
  assert.ok(keys.includes('button:corner'));
  assert.ok(keys.includes('safe:corner'));
});

test('the strip above a header takes the layers that reach its top edge, not only the ground', () => {
  const header = (elements: ArtboardElement[]): ArtboardState =>
    board('hdr', elements, { size: { width: 3840, height: 1646 }, creativeAsset: 'header', backgroundColor: '#FFFFFF' });
  const layer = { rotation: 0, scale: 1 };
  const picture: ImageElementProps = {
    ...layer,
    id: 'pic',
    type: 'image',
    position: { x: 0, y: 0 },
    size: { width: 3840, height: 1646 },
    imageSrc: 'asset:photo',
  };
  // The preview's strip is one screen pixel of the art deep: about 8 of its own.
  const depth = 8;
  const shown = iphoneCropFor(header([]), 'header')!;

  // A picture laid over a white artboard is the top edge of that art. Cut from
  // the ground alone, the strip came out white above it.
  const covered = headerTopEdge(header([picture]), shown, depth);
  assert.deepEqual(covered.board.elements.map((el) => el.id), ['pic']);
  assert.equal(covered.cover, 'picture');

  // Layers that start lower are not part of the edge, and the ground sets its colour.
  const lower = headerTopEdge(header([{ ...picture, position: { x: 0, y: 200 } }, inSafe('t', 'Plan your week')]), shown, depth);
  assert.deepEqual(lower.board.elements, []);
  assert.equal(lower.cover, 'ground');

  // A solid rectangle over the edge gives its own colour, which is what the status icons go by.
  const band: ShapeElementProps = {
    ...layer,
    id: 'band',
    type: 'shape',
    shapeType: 'rectangle',
    position: { x: 0, y: 0 },
    size: { width: 3840, height: 400 },
    fillColor: '#0B132B',
    strokeColor: '#000000',
    strokeWidth: 0,
  };
  assert.deepEqual(headerTopEdge(header([band]), shown, depth).cover, { fill: '#0B132B' });
  // A logo in one corner reaches the edge and is drawn, without changing what the status bar sits on.
  const logo = { ...picture, id: 'logo', position: { x: 400, y: 0 }, size: { width: 300, height: 300 } };
  const cornered = headerTopEdge(header([band, logo]), shown, depth);
  assert.deepEqual(cornered.board.elements.map((el) => el.id), ['band', 'logo']);
  assert.deepEqual(cornered.cover, { fill: '#0B132B' });

  // A 3D device costs a WebGL context to draw, so it is left out even when it reaches the edge.
  const tilted = phone('tilt', { position: { x: 1500, y: -100 }, size: { width: 800, height: 1700 }, styleType: '3d-left' });
  const flat = phone('flat', { position: { x: 1500, y: -100 }, size: { width: 800, height: 1700 } });
  assert.deepEqual(headerTopEdge(header([tilted]), shown, depth).board.elements, []);
  assert.deepEqual(headerTopEdge(header([flat]), shown, depth).board.elements.map((el) => el.id), ['flat']);
});

test('text outside the safe area, text too small to read and the wrong size are all reported', () => {
  // Past the left edge of what an iPhone shows of a header.
  const outside = text('out', 'Plan your week', 60, { position: { x: 100, y: 100 }, size: { width: 900, height: 200 } });
  // Under the safe area, where an iPhone still shows it.
  const below = text('below', 'Plan your week', 60, { position: { x: 1400, y: 1300 }, size: { width: 900, height: 200 } });
  const tiny = text('tiny', 'Fine print', 9, { position: { x: 1200, y: 600 }, size: { width: 600, height: 100 } });
  const issues = checkCreativeView(headerWith(outside, below, tiny), null);
  assert.match(issues.find((issue) => issue.key === 'safe:out')!.detail!, /is cut off on an iPhone$/);
  assert.match(issues.find((issue) => issue.key === 'safe:below')!.detail!, /shows on an iPhone, but other devices can cut it off$/);
  assert.ok(issues.some((issue) => issue.key === 'small:tiny'));
  assert.ok(!issues.some((issue) => issue.key === 'safe:tiny'));

  // 80px type is under 10pt on a header, where an iPhone fits 3210 pixels
  // into 393 points. 90px is 11pt.
  const small = (fontSize: number) =>
    checkCreativeView(headerWith({ ...inSafe('s', 'Plan your week'), fontSize }), null).some((issue) => issue.key === 'small:s');
  assert.equal(small(24), true);
  assert.equal(small(27), false);

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

test('a design dragged from the Header tab arrives as the choice it left as, and anything else is refused', () => {
  for (const kind of Object.keys(CREATIVE_LOOKS) as CreativeAssetKind[]) {
    for (const look of CREATIVE_LOOKS[kind]) {
      const choice = { kind, lookId: look.id, appName: 'Somnia, "sleep" & more' };
      assert.deepEqual(decodeCreativeLookChoice(encodeCreativeLookChoice(choice)), choice);
    }
  }
  // An older or foreign drag without a name still lands, with the name empty.
  assert.deepEqual(decodeCreativeLookChoice('{"kind":"search","lookId":"two-phones"}'), {
    kind: 'search',
    lookId: 'two-phones',
    appName: '',
  });
  for (const raw of ['', 'not json', 'null', '[]', '{"kind":"poster","lookId":"wordmark"}', '{"kind":"header"}', '{"kind":"header","lookId":""}']) {
    assert.equal(decodeCreativeLookChoice(raw), null, raw);
  }
});

test('every design the Header tab offers builds an artboard of its kind at Apple size', () => {
  const look = readProjectLook([], 'Somnia');
  for (const kind of Object.keys(CREATIVE_LOOKS) as CreativeAssetKind[]) {
    const spec = creativeSpec(kind);
    for (const entry of CREATIVE_LOOKS[kind]) {
      const board = buildCreativeBoard(kind, entry.id, look, `palette-${kind}-${entry.id}`);
      assert.equal(board.creativeAsset, kind, entry.id);
      assert.deepEqual(board.size, { width: spec.width, height: spec.height }, entry.id);
      assert.ok(board.elements.length > 0, `${kind}/${entry.id} has something on it`);
    }
  }
});
