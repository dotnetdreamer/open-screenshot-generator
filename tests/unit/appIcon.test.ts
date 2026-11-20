// The app icon (src/lib/appIcon/): what an icon board is and which boards
// stop being screenshots, its two layers, the starters built from a project's
// look, the checks and their pixel maths, every file an export writes (the
// iOS JSON compared with Xcode 26.6's own template), the zip and .icns
// writers, and where an icon goes in an app's own project.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ArtboardElement, ArtboardState, ShapeElementProps, TextElementProps } from '@/types/artboard';
import {
  ANDROID_SAFE_SHARE,
  ICON_SIZE,
  androidSafeCircle,
  iconBoards,
  isIconBoard,
  layerBoard,
  layerElements,
  projectIconBoard,
  superellipsePath,
  superellipsePoints,
  withLayersInOrder,
} from '@/lib/appIcon/specs';
import { creativeFileStems, isScreenshotBoard, screenshotBoards } from '@/lib/creative/specs';
import { ICON_STARTERS, brandColors, buildLogoIcon, buildStarterIcon, nameLetters } from '@/lib/appIcon/starters';
import { checkIcon, checkSummary, contrastOf, measureIcon, withCheckAction, type IconPixelStats } from '@/lib/appIcon/checks';
import {
  ICNS_ENTRIES,
  adaptiveIconXml,
  exportFolderName,
  iosContentsJson,
  macContentsJson,
  planIconExport,
  readmeText,
} from '@/lib/appIcon/exportPlan';
import { buildZip, crc32 } from '@/lib/appIcon/zip';
import { buildIcns } from '@/lib/appIcon/icns';
import { defaultPicks, leftAlone, picksOf, projectWrites, rivalAppIcons, rivalDevices, scanIsComplete, targetsForPicks, type IconProjectScan } from '@/lib/appIcon/projectWrite';
import type { ProjectLook } from '@/lib/creative/layouts';
import { isDark } from '@/lib/graphics/color';

function board(overrides: Partial<ArtboardState> = {}): ArtboardState {
  return {
    id: 'b1',
    name: 'Board',
    position: { x: 0, y: 0 },
    size: { width: 1290, height: 2796 },
    elements: [],
    backgroundColor: '#FFFFFF',
    zoom: 1,
    ...overrides,
  };
}

function shape(id: string, overrides: Partial<ShapeElementProps> = {}): ShapeElementProps {
  return {
    id,
    type: 'shape',
    shapeType: 'circle',
    fillColor: '#FFFFFF',
    strokeColor: 'transparent',
    strokeWidth: 0,
    position: { x: 100, y: 100 },
    size: { width: 200, height: 200 },
    rotation: 0,
    scale: 1,
    ...overrides,
  };
}

function text(id: string, fontSize: number, content = 'Pebble'): TextElementProps {
  return {
    id,
    type: 'text',
    content,
    fontSize,
    color: '#FFFFFF',
    fontFamily: 'Inter',
    position: { x: 100, y: 100 },
    size: { width: 600, height: 200 },
    rotation: 0,
    scale: 1,
  };
}

const LOOK = {
  appName: 'Pebble Notes',
  ground: { backgroundColor: '#312E81', backgroundType: 'gradient', backgroundGradient: { color1: '#312E81', color2: '#0F0D2E', angle: 160 } },
  darkGround: true,
  pictureGround: false,
  fontFamily: 'Bricolage Grotesque',
  textColor: '#FFFFFF',
  mutedColor: '#C7D2FE',
  nameStyle: null,
  headline: null,
  subhead: null,
  devices: [],
  locales: [],
} as unknown as ProjectLook;

// --- what an icon board is -------------------------------------------------------

test('an icon board is not a screenshot, and every screenshot path skips it like header art', () => {
  const icon = board({ id: 'icon', size: { width: 1024, height: 1024 }, appIcon: {} });
  const header = board({ id: 'header', creativeAsset: 'header', size: { width: 3840, height: 1646 } });
  const shot = board({ id: 'shot' });
  assert.equal(isIconBoard(icon), true);
  assert.equal(isIconBoard(shot), false);
  assert.deepEqual([icon, header, shot].map(isScreenshotBoard), [false, false, true]);
  assert.deepEqual(screenshotBoards([icon, shot, header]).map((entry) => entry.id), ['shot']);
  assert.deepEqual(iconBoards([shot, icon]).map((entry) => entry.id), ['icon']);
  assert.equal(projectIconBoard([shot, icon])?.id, 'icon');
  // Exported under its own name, never as screenshot 01.
  assert.equal(creativeFileStems([icon, shot])['icon'], 'AppIcon_1024x1024');
  assert.equal(creativeFileStems([icon, shot])['shot'], undefined);
});

test("the front layer has no ground, the back keeps the board's, and the canvas draws back under front", () => {
  const ring = shape('ring', { iconLayer: 'back' });
  const letter = text('letter', 120);
  const icon = board({
    size: { width: 1024, height: 1024 },
    appIcon: {},
    backgroundType: 'gradient',
    backgroundGradient: { color1: '#111111', color2: '#222222', angle: 90 },
    backgroundImage: 'asset:photo',
    elements: [letter, ring],
  });
  const front = layerBoard(icon, 'front');
  assert.deepEqual(front.elements.map((el) => el.id), ['letter']);
  assert.equal(front.backgroundColor, 'transparent');
  assert.equal(front.backgroundImage, undefined);
  assert.equal(front.backgroundGradient, undefined);
  const back = layerBoard(icon, 'back');
  assert.deepEqual(back.elements.map((el) => el.id), ['ring']);
  assert.equal(back.backgroundImage, 'asset:photo');
  assert.deepEqual(layerElements(icon, 'front').map((el) => el.id), ['letter']);
  // Back first; an order that is already right comes back as the same array.
  const ordered = withLayersInOrder(icon.elements);
  assert.deepEqual(ordered.map((el) => el.id), ['ring', 'letter']);
  assert.equal(withLayersInOrder(ordered), ordered);
});

test("Android's safe circle is 66 of the board's 72 dp, and Apple's shape is a closed curve inside the board", () => {
  const circle = androidSafeCircle({ width: 1024, height: 1024 });
  assert.equal(circle.cx, 512);
  assert.ok(Math.abs(circle.r - (1024 * 66) / 72 / 2) < 1e-9);
  assert.ok(Math.abs(ANDROID_SAFE_SHARE - 66 / 72) < 1e-12);
  const points = superellipsePoints(1024);
  assert.ok(points.every((point) => point.x >= -1e-6 && point.x <= 1024 + 1e-6 && point.y >= -1e-6 && point.y <= 1024 + 1e-6));
  // It touches the middle of each side, and stays inside the corners.
  assert.ok(points.some((point) => Math.abs(point.x - 1024) < 1e-6 && Math.abs(point.y - 512) < 1e-6));
  const corner = Math.min(...points.map((point) => Math.hypot(point.x - 1024, point.y - 1024)));
  assert.ok(corner > 60, `the corner is rounded off (${corner.toFixed(1)}px from it)`);
  const path = superellipsePath(1000);
  assert.ok(path.startsWith('M') && path.endsWith('Z'));
});

// --- starters ----------------------------------------------------------------------

test("a gradient ground keeps its own two stops, and a grey one gets the house indigo", () => {
  assert.deepEqual(brandColors(LOOK), { primary: '#312E81', secondary: '#0F0D2E' });
  const grey = brandColors({ ground: { backgroundColor: '#808080', backgroundType: 'solid' } } as ProjectLook);
  assert.equal(grey.primary, '#4F46E5');
});

test('the letters come from the name, whole characters and words', () => {
  assert.deepEqual(nameLetters('Pebble Notes'), { first: 'P', initials: 'PN', short: null });
  assert.deepEqual(nameLetters('ludo'), { first: 'L', initials: 'L', short: 'ludo' });
  assert.equal(nameLetters('𝒜lpha').first, '𝒜', 'a letter outside the BMP stays whole');
  assert.equal(nameLetters('   ').first, 'A');
});

test('every starter is a 1024 icon board with its mark inside the safe circle', () => {
  const safe = androidSafeCircle({ width: ICON_SIZE, height: ICON_SIZE });
  for (const starter of ICON_STARTERS) {
    const icon = buildStarterIcon(starter.id, LOOK, { appName: 'Pebble Notes', seed: 't' });
    assert.equal(isIconBoard(icon), true, starter.id);
    assert.deepEqual(icon.size, { width: ICON_SIZE, height: ICON_SIZE });
    assert.ok(icon.elements.length > 0, starter.id);
    for (const element of layerElements(icon, 'front')) {
      const cx = element.position.x + element.size.width / 2;
      const cy = element.position.y + element.size.height / 2;
      assert.ok(Math.hypot(cx - safe.cx, cy - safe.cy) < 2, `${starter.id}: ${element.id} is centred`);
    }
    assert.ok(new Set(icon.elements.map((el) => el.id)).size === icon.elements.length);
  }
  const ring = buildStarterIcon('ring', LOOK, { appName: 'Pebble Notes', seed: 't' });
  assert.deepEqual(ring.elements.map((el) => el.iconLayer ?? 'front'), ['back', 'front'], 'the ring sits in the background');
  const badge = buildStarterIcon('badge', LOOK, { appName: 'Pebble Notes', seed: 't' });
  assert.deepEqual(badge.elements.map((el) => el.iconLayer ?? 'front'), ['back', 'front'], 'the tile sits in the background, so dark mode shows the letter');
  // Dark type disappears on iOS's dark background, so a starter with it is white there from the start.
  const light = buildStarterIcon('light', LOOK, { appName: 'Pebble Notes', seed: 't' });
  assert.ok(isDark((light.elements[0] as TextElementProps).color));
  assert.equal(light.appIcon?.dark, 'light');
  const onBrand = buildStarterIcon('letter', LOOK, { appName: 'Pebble Notes', seed: 't' });
  assert.ok(!isDark((onBrand.elements[0] as TextElementProps).color));
  assert.equal(onBrand.appIcon?.dark, undefined, 'a light letter is left as designed');
  const letter = buildStarterIcon('letter', LOOK, { appName: 'Pebble Notes', seed: 't', nudge: () => 0.05 });
  const mark = letter.elements[0] as TextElementProps;
  assert.equal(mark.content, 'P');
  assert.equal(mark.position.y - buildStarterIcon('letter', LOOK, { appName: 'Pebble Notes', seed: 't' }).elements[0].position.y, 28, 'the ink nudge moves the letter');
});

test('a logo that is already an icon fills the board, and a cut-out one sits inside the safe circle', () => {
  const filled = buildLogoIcon(LOOK, { src: 'asset:logo', width: 1024, height: 1024, opaque: true, light: false }, { seed: 't' });
  assert.deepEqual(filled.elements[0].size, { width: 1024, height: 1024 });
  assert.equal(filled.elements[0].iconLayer, 'back');
  const cutout = buildLogoIcon(LOOK, { src: 'asset:logo', width: 800, height: 400, opaque: false, light: false }, { seed: 't' });
  const logo = cutout.elements[0];
  assert.deepEqual(logo.size, { width: 635, height: 318 });
  assert.equal(cutout.backgroundColor, '#FFFFFF');
  const safe = androidSafeCircle({ width: 1024, height: 1024 });
  const corner = Math.hypot(logo.position.x - safe.cx, logo.position.y - safe.cy);
  assert.ok(corner < safe.r, 'the corners are inside the circle');
  const light = buildLogoIcon(LOOK, { src: 'asset:logo', width: 600, height: 600, opaque: false, light: true }, { seed: 't' });
  assert.equal(light.backgroundType, 'gradient', 'a light logo gets the brand colour behind it');
});

// --- checks -----------------------------------------------------------------------

function pixels(width: number, fill: (x: number, y: number) => [number, number, number, number]) {
  const data = new Uint8ClampedArray(width * width * 4);
  for (let y = 0; y < width; y++) {
    for (let x = 0; x < width; x++) {
      data.set(fill(x, y), (y * width + x) * 4);
    }
  }
  return { data, width, height: width };
}

test('the pixel measure finds see-through parts, front ink past the safe circle, and how light the front is', () => {
  const opaque = pixels(64, () => [10, 20, 30, 255]);
  const clearCorner = pixels(64, (x, y) => (x < 8 && y < 8 ? [0, 0, 0, 0] : [10, 20, 30, 255]));
  const centred = pixels(64, (x, y) => (Math.hypot(x - 32, y - 32) < 16 ? [255, 255, 255, 255] : [0, 0, 0, 0]));
  const wide = pixels(64, (x, y) => (y > 28 && y < 36 ? [0, 0, 0, 255] : [0, 0, 0, 0]));
  const a = measureIcon(opaque, centred);
  assert.equal(a.seeThrough, 0);
  assert.equal(a.frontOutsideSafe, 0);
  assert.ok(Math.abs((a.frontLuminance ?? 0) - 1) < 1e-9);
  const b = measureIcon(clearCorner, wide);
  assert.ok(Math.abs(b.seeThrough - 64 / 4096) < 1e-9);
  assert.ok(b.frontOutsideSafe > 0.05, 'a bar across the board crosses the circle');
  assert.equal(b.frontLuminance, 0);
  assert.equal(measureIcon(opaque, pixels(64, () => [0, 0, 0, 0])).frontLuminance, null);
  assert.equal(a.frontReadShare, 1);
  assert.equal(b.frontReadShare, 0);
  // A white mark on a dark tile: dark on average, but the mark reads.
  const tile = pixels(64, (x, y) => (x > 8 && x < 56 && y > 8 && y < 56 ? (x > 28 && x < 36 ? [255, 255, 255, 255] : [20, 20, 30, 255]) : [0, 0, 0, 0]));
  const badge = measureIcon(opaque, tile);
  assert.ok((badge.frontLuminance ?? 1) < 0.2, 'the average says dark');
  assert.ok((badge.frontReadShare ?? 0) > 0.1, 'about a sixth of it is the white mark');
  assert.ok(contrastOf(1, 0) === 21);
});

const STEADY: IconPixelStats = { seeThrough: 0, frontCoverage: 0.2, frontOutsideSafe: 0, frontLuminance: 0.9, frontReadShare: 1 };

test('a sound icon passes, and each problem gets its own check with its fix', () => {
  const icon = board({ size: { width: 1024, height: 1024 }, appIcon: {}, elements: [text('mark', 168, 'P')] });
  const fine = checkIcon(icon, STEADY);
  assert.deepEqual(fine.filter((check) => check.level !== 'ok'), []);
  assert.deepEqual(checkSummary(fine), { level: 'ok', text: 'Ready' });

  const levels = (checks: ReturnType<typeof checkIcon>) => Object.fromEntries(checks.map((check) => [check.id, check.level]));
  assert.equal(levels(checkIcon(icon, { ...STEADY, seeThrough: 0.01 })).opaque, 'error');
  assert.equal(levels(checkIcon(icon, { ...STEADY, frontOutsideSafe: 0.1 })).safe, 'warn');
  const darkCheck = (target: ArtboardState) => checkIcon(target, { ...STEADY, frontLuminance: 0.02, frontReadShare: 0 }).find((check) => check.id === 'dark');
  const offered = (target: ArtboardState) =>
    (darkCheck(target)?.actions ?? []).map((action) =>
      action.kind === 'move-to-back' ? `move ${action.elementId}` : action.kind === 'move-to-back-and-white' ? `move ${action.elementId} and white` : action.kind
    );
  const dark = darkCheck(icon);
  assert.equal(dark?.level, 'warn');
  assert.deepEqual(offered(icon), ['light-in-dark']);
  // Choosing white in dark mode answers it.
  assert.equal(levels(checkIcon({ ...icon, appIcon: { dark: 'light' } }, { ...STEADY, frontLuminance: 0.01, frontReadShare: 0 })).dark, 'ok');
  // A dark tile with a white letter is dark on average and still reads.
  assert.equal(levels(checkIcon(icon, { ...STEADY, frontLuminance: 0.05, frontReadShare: 0.12 })).dark, 'ok');
  const at = (x: number, y: number, w: number, h: number) => ({ position: { x, y }, size: { width: w, height: h } });
  const icons = (elements: ArtboardElement[]) => board({ size: { width: 1024, height: 1024 }, appIcon: {}, elements });
  // A big shape under the letter is offered for the background, and white beside it.
  const letter = { ...text('mark', 168, 'P'), ...at(51, 147, 922, 732) };
  assert.deepEqual(offered(icons([shape('tile', { name: 'Badge', ...at(212, 212, 600, 600) }), letter])), ['move tile', 'light-in-dark']);
  assert.deepEqual(darkCheck(icons([shape('tile', { name: 'Badge', ...at(212, 212, 600, 600) }), letter]))?.actions?.[0], {
    kind: 'move-to-back',
    elementId: 'tile',
    label: 'Move Badge to the back',
  });
  // The audit's case: a dark star drawn over a smaller circle. The star is the mark, on top, and is never offered.
  const star = shape('star', { name: 'Star Logo', shapeType: 'star', ...at(112, 112, 800, 800) } as Partial<ShapeElementProps>);
  assert.deepEqual(offered(icons([shape('circle', { name: 'Circle', ...at(312, 312, 400, 400) }), star])), ['light-in-dark']);
  // The same with a circle big enough to be a backdrop: the circle is offered, the star still never.
  assert.deepEqual(offered(icons([shape('circle', { name: 'Circle', ...at(162, 162, 700, 700) }), star])), ['move circle', 'light-in-dark']);
  // The re-audit's case: a small circle drawn above the star does not make the star a backdrop.
  const sparkle = shape('sparkle', { name: 'Sparkle', ...at(470, 200, 90, 90) });
  assert.deepEqual(offered(icons([shape('circle', { name: 'Circle', ...at(312, 312, 400, 400) }), star, sparkle])), ['light-in-dark']);
  // A star is never a plate, however much is on top of it.
  const bigOnStar = shape('blob', { name: 'Blob', ...at(212, 212, 600, 600) });
  assert.ok(!offered(icons([star, bigOnStar])).some((fix) => fix.includes('star')));
  // A real plate under the star is offered, the star still never, with a sparkle on top or not.
  assert.deepEqual(offered(icons([shape('circle', { name: 'Circle', ...at(162, 162, 700, 700) }), star, sparkle])), ['move circle', 'light-in-dark']);
  // A plate with only a small detail on it is the mark itself.
  assert.deepEqual(offered(icons([shape('plate', { name: 'Plate', shapeType: 'rectangle', ...at(162, 162, 700, 700) }), shape('dot', { ...at(480, 480, 60, 60) })])), ['light-in-dark']);
  // A plate off to one side of the letter is not under it.
  assert.deepEqual(offered(icons([shape('corner', { name: 'Corner', shapeType: 'rectangle', ...at(0, 0, 505, 600) }), letter])), ['light-in-dark']);
  // A shape on top of everything is a mark too, even over a letter.
  assert.deepEqual(offered(icons([letter, shape('ring', { name: 'Ring', ...at(62, 62, 900, 900) })])), ['light-in-dark']);
  // Text and pictures are never offered, whatever their size.
  const logo = { id: 'logo', type: 'image', name: 'Logo', src: 'asset:logo', ...at(112, 112, 800, 800), rotation: 0, scale: 1 } as unknown as ArtboardElement;
  assert.deepEqual(offered(icons([logo, { ...letter, id: 'word' }])), ['light-in-dark']);
  // A dark letter on a dark tile stays dark with the tile behind it, so the fix that works is both at once.
  const darkLetter = { ...letter, color: '#111827' };
  const darkBadge = icons([shape('tile', { name: 'Badge', fillColor: '#1F2937', ...at(212, 212, 600, 600) }), darkLetter]);
  assert.deepEqual(offered(darkBadge), ['move tile and white', 'light-in-dark']);
  const both = withCheckAction(darkBadge, darkCheck(darkBadge)!.actions![0])!;
  assert.deepEqual(both.elements.map((element) => [element.id, element.iconLayer ?? 'front']), [['tile', 'back'], ['mark', 'front']]);
  assert.equal(both.appIcon?.dark, 'light');
  // A picture or a colour this can't read is not assumed dark: the plain move is offered.
  assert.deepEqual(offered(icons([shape('tile', { name: 'Badge', ...at(212, 212, 600, 600) }), { ...letter, color: 'rgb(0 0 0)' }])), ['move tile', 'light-in-dark']);
  // A small shape under the letter is a detail, not a backdrop.
  assert.deepEqual(offered(icons([shape('dot', { ...at(400, 400, 100, 100) }), letter])), ['light-in-dark']);
  // Each fix's preview is the icon after it.
  const tiled = icons([shape('tile', { name: 'Badge', ...at(212, 212, 600, 600) }), letter]);
  const [moved, white] = darkCheck(tiled)?.actions ?? [];
  assert.deepEqual(withCheckAction(tiled, moved)?.elements.map((element) => [element.id, element.iconLayer ?? 'front']), [['tile', 'back'], ['mark', 'front']]);
  assert.equal(withCheckAction(tiled, white)?.appIcon?.dark, 'light');
  assert.equal(withCheckAction(tiled, { kind: 'select', elementId: 'mark', label: 'Select it' }), null);

  // "The front covers the whole icon" moves the layer that fills it, never the letter on it.
  const filled = icons([shape('picture', { name: 'Picture', shapeType: 'rectangle', ...at(0, 0, 1024, 1024) }), letter]);
  const covering = checkIcon(filled, { ...STEADY, frontCoverage: 0.95 }).find((check) => check.id === 'front');
  assert.deepEqual(covering?.actions?.map((action) => (action.kind === 'move-to-back' ? action.elementId : action.kind)), ['picture']);
  // A front that is one picture moves as a whole; one that is only text has nothing to move.
  const onePicture = icons([{ ...logo, ...at(0, 0, 1024, 1024) }]);
  assert.equal(checkIcon(onePicture, { ...STEADY, frontCoverage: 0.95 }).find((check) => check.id === 'front')?.actions?.[0]?.kind, 'move-to-back');
  const covered = checkIcon(icon, { ...STEADY, frontCoverage: 0.95 }).find((check) => check.id === 'front');
  assert.equal(covered?.actions, undefined);
  const empty = board({ size: { width: 1024, height: 1024 }, appIcon: {}, elements: [shape('ground', { iconLayer: 'back' })] });
  assert.equal(levels(checkIcon(empty, null)).front, 'warn');

  // 46 is 153px type: about 9 points on a 60 point Home Screen icon.
  const small = checkIcon(board({ size: { width: 1024, height: 1024 }, appIcon: {}, elements: [text('word', 46, 'Notes')] }), null);
  const word = small.find((check) => check.id === 'text:word');
  assert.match(word?.detail ?? '', /"Notes" will be tiny on a phone/);
  const thin = checkIcon(board({ size: { width: 1024, height: 1024 }, appIcon: {}, elements: [shape('ring', { strokeWidth: 10, strokeColor: '#000000', name: 'Ring' })] }), null);
  assert.ok(thin.some((check) => check.id === 'line:ring'), 'a 10px outline is 0.28 pt in Settings');
  assert.equal(levels(checkIcon(board({ appIcon: {} }), null)).size, 'error');
  assert.deepEqual(checkSummary(small), { level: 'warn', text: '1 to check' });
});

// --- the export ---------------------------------------------------------------------

/** Xcode 26.6's AppIcon template (MultiPlatform, iOS Foveated Streaming App), as read off this Mac. */
const XCODE_TEMPLATE = {
  images: [
    { idiom: 'universal', platform: 'ios', size: '1024x1024' },
    { appearances: [{ appearance: 'luminosity', value: 'dark' }], idiom: 'universal', platform: 'ios', size: '1024x1024' },
    { appearances: [{ appearance: 'luminosity', value: 'tinted' }], idiom: 'universal', platform: 'ios', size: '1024x1024' },
  ],
  info: { author: 'xcode', version: 1 },
};

test("the iOS set is Xcode's own template with file names, and the Mac set has every size at 1x and 2x", () => {
  const ios = JSON.parse(iosContentsJson({ light: 'a.png', dark: 'b.png', tinted: 'c.png' }));
  const withoutNames = { ...ios, images: ios.images.map(({ filename: _f, ...rest }: { filename: string }) => rest) };
  assert.deepEqual(withoutNames, XCODE_TEMPLATE);
  assert.deepEqual(ios.images.map((image: { filename: string }) => image.filename), ['a.png', 'b.png', 'c.png']);
  const mac = JSON.parse(macContentsJson());
  assert.equal(mac.images.length, 10);
  assert.deepEqual(mac.images[0], { filename: 'icon_16x16.png', idiom: 'mac', scale: '1x', size: '16x16' });
  assert.deepEqual(mac.images[9], { filename: 'icon_512x512@2x.png', idiom: 'mac', scale: '2x', size: '512x512' });
  assert.match(adaptiveIconXml(), /<monochrome android:drawable="@mipmap\/ic_launcher_monochrome" \/>/);
});

test('each target writes exactly its files, with a README that only names those', () => {
  const count = (targets: Parameters<typeof planIconExport>[1]) => planIconExport('Pebble', targets).length;
  // README + 3 pictures and the JSON.
  assert.equal(count(['ios']), 5);
  // README + 2 XML + 5 densities x 5 pictures.
  assert.equal(count(['android']), 28);
  assert.equal(count(['play']), 2);
  // README + 10 pictures, the JSON and the .icns.
  assert.equal(count(['mac']), 13);
  assert.equal(count(['layers']), 3);
  assert.equal(count([]), 0);
  const all = planIconExport('Pebble', ['ios', 'android', 'play', 'mac', 'layers']);
  assert.equal(new Set(all.map((file) => file.path)).size, all.length, 'no two files share a path');
  const android = planIconExport('Pebble', ['android']);
  const xxx = android.filter((file) => file.path.includes('mipmap-xxxhdpi/'));
  assert.deepEqual(
    xxx.map((file) => [file.path.split('/').pop(), file.recipe?.size]),
    [
      ['ic_launcher_foreground.png', 432],
      ['ic_launcher_background.png', 432],
      ['ic_launcher_monochrome.png', 432],
      ['ic_launcher.png', 192],
      ['ic_launcher_round.png', 192],
    ]
  );
  const light = planIconExport('Pebble', ['ios']).find((file) => file.path.endsWith('/AppIcon.png'));
  assert.deepEqual(light?.recipe, { kind: 'full', size: 1024, noAlpha: true }, 'App Store Connect takes no alpha channel');
  assert.doesNotMatch(readmeText('Pebble', ['ios']), /android/i);
  assert.match(readmeText('Pebble', ['android']), /compileSdk 33/);
  assert.equal(exportFolderName('Pebble: Notes/Lists'), 'Pebble Notes Lists icon');
  assert.equal(exportFolderName('   '), 'App icon');
  const icns = new Set(ICNS_ENTRIES.map((entry) => entry.pixels));
  const macSizes = new Set(planIconExport('Pebble', ['mac']).flatMap((file) => (file.recipe?.kind === 'mac' ? [file.recipe.size] : [])));
  assert.ok([...icns].every((size) => macSizes.has(size)), 'every .icns entry has a Mac picture to come from');
});

test('a zip lists every file with its CRC and size, and reads back', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926, 'the standard CRC-32 check value');
  const files = [
    { path: 'Pebble icon/README.txt', bytes: new TextEncoder().encode('hello') },
    { path: 'Pebble icon/ios/AppIcon.appiconset/AppIcon.png', bytes: new Uint8Array([1, 2, 3, 4]) },
  ];
  const zip = buildZip(files, new Date(2026, 10, 18, 12, 30, 10));
  const view = new DataView(zip.buffer);
  assert.equal(view.getUint32(0, true), 0x04034b50);
  const end = zip.length - 22;
  assert.equal(view.getUint32(end, true), 0x06054b50);
  assert.equal(view.getUint16(end + 10, true), 2);
  let at = view.getUint32(end + 16, true);
  const decoder = new TextDecoder();
  for (const file of files) {
    assert.equal(view.getUint32(at, true), 0x02014b50);
    assert.equal(view.getUint16(at + 8, true), 0x0800, 'UTF-8 names');
    assert.equal(view.getUint32(at + 16, true), crc32(file.bytes));
    assert.equal(view.getUint32(at + 24, true), file.bytes.length);
    const nameLength = view.getUint16(at + 28, true);
    assert.equal(decoder.decode(zip.subarray(at + 46, at + 46 + nameLength)), file.path);
    // The local header it points at carries the same name, then the bytes.
    const local = view.getUint32(at + 42, true);
    assert.equal(view.getUint32(local, true), 0x04034b50);
    const localName = view.getUint16(local + 26, true);
    assert.deepEqual(Array.from(zip.subarray(local + 30 + localName, local + 30 + localName + file.bytes.length)), Array.from(file.bytes));
    at += 46 + nameLength;
  }
});

test('an .icns file is its header and its typed PNG entries', () => {
  const icns = buildIcns([
    { type: 'ic07', png: new Uint8Array([9, 9, 9]) },
    { type: 'ic10', png: new Uint8Array([7]) },
  ]);
  const view = new DataView(icns.buffer);
  assert.equal(new TextDecoder().decode(icns.subarray(0, 4)), 'icns');
  assert.equal(view.getUint32(4), icns.length);
  assert.equal(new TextDecoder().decode(icns.subarray(8, 12)), 'ic07');
  assert.equal(view.getUint32(12), 11);
  assert.equal(new TextDecoder().decode(icns.subarray(19, 23)), 'ic10');
  assert.throws(() => buildIcns([{ type: 'ic7', png: new Uint8Array() }]));
});

// --- into an app's own project -----------------------------------------------------------

test("the icon goes into each place found, in that place's own folders", () => {
  const scan: IconProjectScan = {
    root: '/work/pebble',
    iconSets: [
      { path: 'ios/Pebble/Images.xcassets/AppIcon.appiconset', platform: 'ios' },
      { path: 'macos/Runner/Assets.xcassets/AppIcon.appiconset', platform: 'mac' },
    ],
    androidRes: [{ path: 'android/app/src/main/res', anydpi: ['mipmap-anydpi', 'mipmap-anydpi-v33'] }],
    truncated: false,
  };
  const picks = picksOf(scan);
  assert.deepEqual(targetsForPicks(picks), ['ios', 'android', 'mac']);
  const bytes = new Uint8Array([1]);
  const json = (value: unknown) => new TextEncoder().encode(JSON.stringify(value));
  const files = [
    { path: 'README.txt', bytes },
    { path: 'ios/AppIcon.appiconset/AppIcon.png', bytes },
    { path: 'ios/AppIcon.appiconset/Contents.json', bytes: json({ images: [{ idiom: 'universal' }] }) },
    { path: 'macos/AppIcon.appiconset/icon_16x16.png', bytes },
    { path: 'macos/AppIcon.appiconset/Contents.json', bytes: json({ images: [{ idiom: 'mac' }] }) },
    { path: 'macos/AppIcon.icns', bytes },
    { path: 'android/res/mipmap-anydpi-v26/ic_launcher.xml', bytes },
    { path: 'android/res/mipmap-hdpi/ic_launcher.png', bytes },
  ];
  const { writes, clear, replaceResources } = projectWrites(picks, files);
  assert.deepEqual(writes.map((file) => file.path), [
    'ios/Pebble/Images.xcassets/AppIcon.appiconset/AppIcon.png',
    'ios/Pebble/Images.xcassets/AppIcon.appiconset/Contents.json',
    'macos/Runner/Assets.xcassets/AppIcon.appiconset/icon_16x16.png',
    'macos/Runner/Assets.xcassets/AppIcon.appiconset/Contents.json',
    // The project keeps its layered icon in two anydpi folders, so it goes into both: no Android version keeps the old one.
    'android/app/src/main/res/mipmap-anydpi/ic_launcher.xml',
    'android/app/src/main/res/mipmap-anydpi-v33/ic_launcher.xml',
    'android/app/src/main/res/mipmap-hdpi/ic_launcher.png',
  ]);
  assert.deepEqual(clear, ['ios/Pebble/Images.xcassets/AppIcon.appiconset', 'macos/Runner/Assets.xcassets/AppIcon.appiconset']);
  // The new launcher files replace an old ic_launcher.webp beside them.
  assert.deepEqual(replaceResources, ['android/app/src/main/res']);
  // A project with no anydpi folder yet gets the usual one.
  const fresh = projectWrites([{ kind: 'android', path: 'app/src/main/res', anydpi: [] }], files);
  assert.ok(fresh.writes.some((file) => file.path === 'app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml'));

  // One set for iOS and the Mac gets both, under one Contents.json.
  const both = projectWrites([{ kind: 'icon-set', path: 'App/Assets.xcassets/AppIcon.appiconset', platform: 'both' }], files);
  const contents = both.writes.find((file) => file.path.endsWith('Contents.json'));
  assert.deepEqual(JSON.parse(new TextDecoder().decode(contents!.bytes)).images, [{ idiom: 'universal' }, { idiom: 'mac' }]);
  assert.equal(both.writes.filter((file) => file.path.endsWith('.png')).length, 2);
});

test("the main icon places are ticked first, and Apple Watch sets are left alone", () => {
  const scan: IconProjectScan = {
    root: '/work/pebble',
    iconSets: [
      { path: 'ios/Pebble/Assets.xcassets/AppIcon-Pride.appiconset', platform: 'ios' },
      { path: 'ios/Pebble/Assets.xcassets/AppIcon.appiconset', platform: 'ios' },
      { path: 'ios/Watch/Assets.xcassets/AppIcon.appiconset', platform: 'watch' },
      { path: 'ios/Odd/Assets.xcassets/Brand.appiconset', platform: 'unknown' },
    ],
    androidRes: [
      { path: 'android/app/src/debug/res', anydpi: [] },
      { path: 'android/app/src/main/res', anydpi: ['mipmap-anydpi-v26'] },
    ],
    truncated: false,
  };
  const places = picksOf(scan);
  assert.deepEqual(places.map((place) => place.path), [
    'ios/Pebble/Assets.xcassets/AppIcon-Pride.appiconset',
    'ios/Pebble/Assets.xcassets/AppIcon.appiconset',
    'ios/Odd/Assets.xcassets/Brand.appiconset',
    'android/app/src/debug/res',
    'android/app/src/main/res',
  ]);
  assert.deepEqual(leftAlone(scan).map((place) => place.reason), ["Apple Watch icon, won't be changed"]);
  const ticked = (input: IconProjectScan) => defaultPicks(input).map((place) => place.path);
  // A set the scan can't read could be another app's icon, so with one in the folder nothing on iPhone is ticked.
  assert.deepEqual(ticked(scan), ['android/app/src/main/res']);
  const plain: IconProjectScan = { ...scan, iconSets: scan.iconSets.filter((set) => set.platform !== 'unknown') };
  // The app's own AppIcon is ticked; its alternate in the same catalog and the debug folder wait for the user.
  assert.deepEqual(ticked(plain), ['ios/Pebble/Assets.xcassets/AppIcon.appiconset', 'android/app/src/main/res']);
});

test('the note about icons left unticked names their devices, so it never reads as if Android were unticked too', () => {
  const base: IconProjectScan = { root: '/work', iconSets: [], androidRes: [{ path: 'android/app/src/main/res', anydpi: [] }], truncated: false };
  // The re-audit's shared catalog: both iPhone sets wait for the user, and Android is still ticked.
  const shared: IconProjectScan = {
    ...base,
    iconSets: [
      { path: 'Shared/Assets.xcassets/Notes/AppIcon.appiconset', platform: 'ios' },
      { path: 'Shared/Assets.xcassets/Tasks/AppIcon.appiconset', platform: 'ios' },
    ],
  };
  assert.deepEqual(defaultPicks(shared).map((place) => place.path), ['android/app/src/main/res']);
  assert.equal(rivalAppIcons(shared).length, 2);
  assert.equal(rivalDevices(rivalAppIcons(shared)), 'iPhone and iPad');
  const macs: IconProjectScan = {
    ...base,
    iconSets: [
      { path: 'Notes/Assets.xcassets/AppIcon.appiconset', platform: 'mac' },
      { path: 'Tasks/Assets.xcassets/AppIcon.appiconset', platform: 'mac' },
    ],
  };
  assert.equal(rivalDevices(rivalAppIcons(macs)), 'Mac');
  const mixed: IconProjectScan = {
    ...base,
    iconSets: [
      { path: 'Notes/Assets.xcassets/AppIcon.appiconset', platform: 'both' },
      { path: 'Tasks/Assets.xcassets/AppIcon.appiconset', platform: 'ios' },
    ],
  };
  assert.equal(rivalDevices(rivalAppIcons(mixed)), 'Apple devices');
  // No rivals, no note.
  assert.deepEqual(rivalAppIcons({ ...base, iconSets: [{ path: 'Pebble/Assets.xcassets/AppIcon.appiconset', platform: 'ios' }] }), []);
});

test('nothing is ticked where it could be the wrong app', () => {
  const base: IconProjectScan = { root: '/work', iconSets: [], androidRes: [], truncated: false };
  const ticked = (input: Partial<IconProjectScan>) => defaultPicks({ ...base, ...input }).map((place) => place.path);
  // The audit's case: an iPhone and Mac AppIcon beside another iPhone AppIcon. Both are iPhone icons.
  assert.deepEqual(
    ticked({
      iconSets: [
        { path: 'apps/notes/Shared/Assets.xcassets/AppIcon.appiconset', platform: 'both' },
        { path: 'apps/tasks/iOS/Assets.xcassets/AppIcon.appiconset', platform: 'ios' },
      ],
    }),
    []
  );
  // Two iPhone apps, and two main res folders.
  assert.deepEqual(
    ticked({
      iconSets: [
        { path: 'apps/notes/ios/Assets.xcassets/AppIcon.appiconset', platform: 'ios' },
        { path: 'apps/tasks/ios/Assets.xcassets/AppIcon.appiconset', platform: 'ios' },
      ],
      androidRes: [
        { path: 'apps/notes/android/app/src/main/res', anydpi: [] },
        { path: 'apps/tasks/android/app/src/main/res', anydpi: [] },
      ],
    }),
    []
  );
  // An App Clip has its own AppIcon in its own catalog.
  assert.deepEqual(
    ticked({
      iconSets: [
        { path: 'Pebble/Assets.xcassets/AppIcon.appiconset', platform: 'ios' },
        { path: 'PebbleClip/Assets.xcassets/AppIcon.appiconset', platform: 'ios' },
      ],
    }),
    []
  );
  // An old combined iPhone and Watch set elsewhere is another iPhone icon too, though it is left alone.
  assert.deepEqual(
    ticked({
      iconSets: [
        { path: 'Pebble/Assets.xcassets/AppIcon.appiconset', platform: 'ios' },
        { path: 'Legacy/Images.xcassets/AppIcon.appiconset', platform: 'mixed' },
      ],
    }),
    []
  );
  // The re-audit's case: one shared asset catalog holding two AppIcon sets, in groups.
  assert.deepEqual(
    ticked({
      iconSets: [
        { path: 'Shared/Assets.xcassets/Notes/AppIcon.appiconset', platform: 'ios' },
        { path: 'Shared/Assets.xcassets/Tasks/AppIcon.appiconset', platform: 'ios' },
      ],
    }),
    []
  );
  // A folder the scan couldn't look in might hold another app, so nothing is ticked.
  const lone = {
    iconSets: [{ path: 'Pebble/Assets.xcassets/AppIcon.appiconset', platform: 'ios' as const }],
    androidRes: [{ path: 'android/app/src/main/res', anydpi: [] }],
  };
  for (const reason of ['deep', 'unreadable', 'link'] as const) {
    assert.deepEqual(ticked({ ...lone, notLookedIn: [{ path: 'apps/other', reason }], notLookedInCount: 1 }), [], reason);
  }
  // Only the first few are named, but the count says there were more.
  assert.deepEqual(ticked({ ...lone, notLookedIn: [], notLookedInCount: 25 }), []);
  assert.equal(ticked({ ...lone, notLookedIn: [], notLookedInCount: 0 }).length, 2);
  // A sole alternate set, or a sole debug folder, is never ticked for the user.
  assert.deepEqual(ticked({ iconSets: [{ path: 'App/Assets.xcassets/Brand.appiconset', platform: 'ios' }] }), []);
  assert.deepEqual(ticked({ androidRes: [{ path: 'app/src/debug/res', anydpi: [] }] }), []);
  assert.equal(scanIsComplete({ ...base, notLookedInCount: 1 }), false);
  assert.equal(scanIsComplete(base), true);
  // A scan that stopped at its limit may have missed another app, so nothing is ticked.
  const one = {
    iconSets: [{ path: 'Pebble/Assets.xcassets/AppIcon.appiconset', platform: 'ios' as const }],
    androidRes: [{ path: 'android/app/src/main/res', anydpi: [] }],
  };
  assert.equal(ticked(one).length, 2);
  assert.deepEqual(ticked({ ...one, truncated: true }), []);
  // Flutter: one AppIcon for iPhone and one for the Mac, each the only one for its system.
  assert.deepEqual(
    ticked({
      iconSets: [
        { path: 'ios/Runner/Assets.xcassets/AppIcon.appiconset', platform: 'ios' },
        { path: 'macos/Runner/Assets.xcassets/AppIcon.appiconset', platform: 'mac' },
      ],
    }),
    ['ios/Runner/Assets.xcassets/AppIcon.appiconset', 'macos/Runner/Assets.xcassets/AppIcon.appiconset']
  );
  // A Watch app beside the iPhone app takes nothing away: it is not an iPhone icon.
  assert.deepEqual(
    ticked({
      iconSets: [
        { path: 'Pebble/Assets.xcassets/AppIcon.appiconset', platform: 'ios' },
        { path: 'PebbleWatch/Assets.xcassets/AppIcon.appiconset', platform: 'watch' },
      ],
    }),
    ['Pebble/Assets.xcassets/AppIcon.appiconset']
  );
});
