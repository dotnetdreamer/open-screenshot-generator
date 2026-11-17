// One design laid out again for other devices (src/lib/deviceSets/): how a
// board is read, the stacked and side by side layouts, the frame following
// the screenshot, the plan applied to another language, and the choices kept
// on the artboards.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type {
  ArtboardElement,
  ArtboardState,
  DeviceFrameElementProps,
  ShapeElementProps,
  TextElementProps,
} from '@/types/artboard';
import { applyPlan, layoutsFor, planBoard, readBoard, type TextMeasure } from '@/lib/deviceSets/layout';
import {
  boardOnDevice,
  boardsOnDevice,
  framesOn,
  planFor,
  projectSetFormats,
  takesPart,
  withBoardSet,
  withScreen,
  withSetFormats,
} from '@/lib/deviceSets/sets';
import { deviceSetTarget } from '@/lib/deviceSets/targets';
import { convertArtboardsToFormat, DEVICE_FORMAT_PRESETS, type DeviceFormat } from '@/lib/deviceRegistry';
import { elementVisualBounds, type Bounds } from '@/lib/elementGeometry';
import { collectMediaIds } from '@/lib/account/projectBundle';

const IPHONE = { width: 1206, height: 2622 };

function text(id: string, content: string, x: number, y: number, width: number, height: number, fontSize = 30): TextElementProps {
  return {
    id,
    type: 'text',
    content,
    position: { x, y },
    size: { width, height },
    rotation: 0,
    scale: 1,
    fontSize,
    color: '#111111',
    fontFamily: 'Arial',
    textAlign: 'center',
    lineHeight: 1.2,
  };
}

function phone(id: string, x: number, y: number, width: number, height: number, extra: Partial<DeviceFrameElementProps> = {}): DeviceFrameElementProps {
  return {
    id,
    type: 'device',
    deviceType: 'iphone-15',
    position: { x, y },
    size: { width, height },
    rotation: 0,
    scale: 1,
    screenshotSrc: '/data/projects/app-screens/app-list-light.png',
    screenshotObjectFit: 'cover',
    ...extra,
  };
}

function rect(id: string, x: number, y: number, width: number, height: number, extra: Partial<ShapeElementProps> = {}): ShapeElementProps {
  return {
    id,
    type: 'shape',
    shapeType: 'rectangle',
    position: { x, y },
    size: { width, height },
    rotation: 0,
    scale: 1,
    fillColor: '#ffcc00',
    strokeColor: 'transparent',
    strokeWidth: 0,
    ...extra,
  };
}

function board(elements: ArtboardElement[], size = IPHONE, id = 'b1'): ArtboardState {
  return {
    id,
    name: 'Screen 1',
    position: { x: 0, y: 0 },
    size: { ...size },
    elements,
    backgroundColor: '#ffffff',
    zoom: 1,
  };
}

const PHONE_Y = 900;
const PHONE_H = 1837;

/** The usual store screenshot: a headline, a line under it, a phone hanging off the bottom. */
function headlineAndPhone(extra: ArtboardElement[] = [], device: Partial<DeviceFrameElementProps> = {}): ArtboardState {
  return board([
    rect('bg', 0, 0, IPHONE.width, IPHONE.height, { fillColor: '#e0f2fe' }),
    text('title', 'Track every habit in one place', 80, 150, 1046, 300, 36),
    text('sub', 'Small steps, every day', 180, 470, 846, 110, 18),
    phone('phone', 203, PHONE_Y, 800, PHONE_H, device),
    ...extra,
  ]);
}

/** A stand in for the DOM measure: average letter width half the type size, 1.2 lines. */
const fakeMeasure: TextMeasure = (el) => {
  const px = el.fontSize / 0.3;
  const perLine = Math.max(1, Math.floor((el.size.width * (el.scale || 1) - 4) / (px * 0.5)));
  const words = el.content.split(/\s+/);
  let lines = 1;
  let used = 0;
  for (const word of words) {
    const length = word.length + (used ? 1 : 0);
    if (used + length > perLine && used > 0) {
      lines += 1;
      used = word.length;
    } else used += length;
  }
  return (lines * px * (el.lineHeight || 1.2) + 4) / (el.scale || 1);
};

function placed(boardIn: ArtboardState, id: string): ArtboardElement {
  const found = boardIn.elements.find((el) => el.id === id);
  assert.ok(found, `no element ${id}`);
  return found;
}

const boxOf = (el: ArtboardElement): Bounds => elementVisualBounds(el);
const bottomOf = (b: Bounds) => b.y + b.height;
const overlaps = (a: Bounds, b: Bounds) =>
  Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) *
  Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));

function onDevice(source: ArtboardState, format: DeviceFormat, measure: TextMeasure | null = fakeMeasure): ArtboardState {
  const plan = planFor(source, format, { measure });
  assert.ok(plan, 'no plan');
  return boardOnDevice(source, plan, source, format, null, measure);
}

test('a headline over a phone reads as text above the hero', () => {
  const reading = readBoard(headlineAndPhone());
  assert.deepEqual(reading.backdrops.map((item) => item.el.id), ['bg']);
  assert.deepEqual(reading.hero.map((item) => item.el.id), ['phone']);
  assert.deepEqual(reading.rows.map((row) => [row.place, row.texts.map((item) => item.el.id)]), [
    ['above', ['title']],
    ['above', ['sub']],
  ]);
});

test('on the iPad the phone design keeps its order, its frame and its edge', () => {
  const source = headlineAndPhone();
  const ipad = onDevice(source, 'ipad-pro-13');
  assert.deepEqual(ipad.size, { width: 2064, height: 2752 });

  const title = boxOf(placed(ipad, 'title'));
  const sub = boxOf(placed(ipad, 'sub'));
  const device = placed(ipad, 'phone') as DeviceFrameElementProps;
  const hero = boxOf(device);
  // Text first, then the device under it, nothing run into.
  assert.ok(bottomOf(title) <= sub.y + 1, 'the line under the headline stays under it');
  assert.ok(bottomOf(sub) <= hero.y + 1, 'the device stays under the text');
  assert.equal(overlaps(title, hero), 0);
  // A template's placeholder art is phone shaped, so the frame stays a phone.
  assert.equal(device.deviceType, 'iphone-15');
  // Still hanging off the bottom, by the same share of its height.
  const was = (PHONE_Y + PHONE_H - 2622) / PHONE_H;
  const now = (bottomOf(hero) - 2752) / hero.height;
  assert.ok(Math.abs(was - now) < 0.01, `hangs off by ${now}, was ${was}`);
  // Centred like the design.
  assert.ok(Math.abs(title.x + title.width / 2 - 1032) < 2);
  assert.ok(Math.abs(hero.x + hero.width / 2 - 1032) < 2);
});

test('an iPad screenshot turns the frame into an iPad that fills more of the width', () => {
  const source = withBoardSet([headlineAndPhone()], 'b1', 'ipad-pro-13', (set) =>
    withScreen(set, 'phone', null, { screenshotSrc: 'asset:asset_ipad', naturalScreenshotWidth: 2064, naturalScreenshotHeight: 2752 })
  )[0];
  const ipad = onDevice(source, 'ipad-pro-13');
  const device = placed(ipad, 'phone') as DeviceFrameElementProps;
  assert.equal(device.deviceType, 'ipad-pro-13');
  const hero = boxOf(device);
  const scaled = convertArtboardsToFormat([headlineAndPhone()], DEVICE_FORMAT_PRESETS.find((p) => p.id === 'ipad-pro-13')!).artboards[0];
  const oldHero = boxOf(placed(scaled, 'phone'));
  assert.ok(hero.width > oldHero.width * 1.2, `device ${hero.width} wide, the scaled one ${oldHero.width}`);
  assert.ok(bottomOf(hero) > 2752, 'the iPad hangs off the bottom like the phone did');
  assert.ok(bottomOf(boxOf(placed(ipad, 'sub'))) <= hero.y + 1);
});

test('the headline gets a longer line on a wider screen, and the type grows with the area', () => {
  const source = headlineAndPhone();
  const ipad = onDevice(source, 'ipad-pro-13');
  const title = placed(ipad, 'title') as TextElementProps;
  const ft = Math.sqrt((2064 / 1206) * (2752 / 2622));
  assert.ok(Math.abs(title.fontSize - 36 * ft) < 0.01, `font ${title.fontSize}`);
  // Measured: the headline fits its box in its new size.
  assert.ok(fakeMeasure(title) <= title.size.height + 1);
  // Wider than plain scaling would make it, so it wraps into fewer lines.
  assert.ok(title.size.width > 1046 * ft);
});

test('without a measure, text keeps its line breaks and is only scaled', () => {
  const source = headlineAndPhone();
  const ipad = onDevice(source, 'ipad-pro-13', null);
  const title = placed(ipad, 'title') as TextElementProps;
  const ft = Math.sqrt((2064 / 1206) * (2752 / 2622));
  assert.ok(Math.abs(title.size.width - 1046 * ft) < 0.01);
  assert.ok(Math.abs(title.size.height - 300 * ft) < 0.01);
});

test("an iPhone screenshot stays in an iPhone on the iPad, and an iPad screenshot gets an iPad", () => {
  const shot = { screenshotSrc: 'asset:asset_phone', naturalScreenshotWidth: 1206, naturalScreenshotHeight: 2622 };
  const source = headlineAndPhone([], shot);
  const target = deviceSetTarget('ipad-pro-13')!;
  assert.equal(framesOn(source, target).size, 0, 'the iPhone keeps its frame');
  assert.equal((placed(onDevice(source, 'ipad-pro-13'), 'phone') as DeviceFrameElementProps).deviceType, 'iphone-15');

  const withIpadShot = withBoardSet([source], 'b1', 'ipad-pro-13', (set) =>
    withScreen(set, 'phone', null, { screenshotSrc: 'asset:asset_ipad', naturalScreenshotWidth: 2064, naturalScreenshotHeight: 2752 })
  )[0];
  assert.equal(framesOn(withIpadShot, target).get('phone'), 'ipad-pro-13');
  const ipad = onDevice(withIpadShot, 'ipad-pro-13');
  const device = placed(ipad, 'phone') as DeviceFrameElementProps;
  assert.equal(device.deviceType, 'ipad-pro-13');
  assert.equal(device.screenshotSrc, 'asset:asset_ipad');
  assert.equal(device.naturalScreenshotWidth, 2064);
  // The base design is untouched.
  assert.equal((placed(withIpadShot, 'phone') as DeviceFrameElementProps).screenshotSrc, 'asset:asset_phone');
});

test('Google Play phones swap an iPhone for its Android counterpart', () => {
  const android = onDevice(headlineAndPhone(), 'android');
  assert.deepEqual(android.size, { width: 1080, height: 1920 });
  const device = placed(android, 'phone') as DeviceFrameElementProps;
  assert.equal(device.deviceType, 'android-punch-hole');
  const title = boxOf(placed(android, 'title'));
  assert.ok(bottomOf(title) <= boxOf(device).y + 1);
});

test('a Mac screenshot turns the frame into a MacBook, under the text', () => {
  const source = withBoardSet([headlineAndPhone()], 'b1', 'mac', (set) =>
    withScreen(set, 'phone', null, { screenshotSrc: 'asset:asset_mac', naturalScreenshotWidth: 2880, naturalScreenshotHeight: 1800 })
  )[0];
  const plan = planFor(source, 'mac', { measure: fakeMeasure });
  assert.equal(plan?.frames.get('phone'), 'macbook');
  assert.equal(plan?.layout, 'stacked');
  const mac = boardOnDevice(source, plan!, source, 'mac', null, fakeMeasure);
  const laptop = boxOf(placed(mac, 'phone'));
  assert.ok(bottomOf(boxOf(placed(mac, 'sub'))) <= laptop.y + 1);
});

test('the Mac puts the text beside an iPhone screenshot, inside the artboard', () => {
  const source = headlineAndPhone();
  assert.deepEqual(layoutsFor(source, { width: 2560, height: 1600 }), ['beside', 'stacked', 'beside-flipped', 'scaled']);
  const plan = planFor(source, 'mac', { measure: fakeMeasure });
  assert.equal(plan?.frames.size, 0, 'the iPhone stays an iPhone');
  assert.equal(plan?.layout, 'beside');
  const mac = boardOnDevice(source, plan!, source, 'mac', null, fakeMeasure);
  const title = boxOf(placed(mac, 'title'));
  const sub = boxOf(placed(mac, 'sub'));
  const hero = boxOf(placed(mac, 'phone'));
  for (const box of [title, sub]) {
    assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= 2560 && bottomOf(box) <= 1600, 'text inside the artboard');
    assert.ok(box.x + box.width <= hero.x, 'text to the left of the devices');
  }
  // The flipped one swaps the sides.
  const flipped = boardOnDevice(source, planFor(source, 'mac', { layout: 'beside-flipped', measure: fakeMeasure })!, source, 'mac', null, fakeMeasure);
  assert.ok(boxOf(placed(flipped, 'title')).x > boxOf(placed(flipped, 'phone')).x);
});

test('a Mac design with the text beside the Mac puts the text on top for a phone', () => {
  const mac = board(
    [
      text('title', 'Your inbox, calm again', 160, 520, 900, 360, 34),
      {
        id: 'laptop',
        type: 'device',
        deviceType: 'macbook',
        position: { x: 1150, y: 360 },
        size: { width: 1300, height: 753 },
        rotation: 0,
        scale: 1,
      } as DeviceFrameElementProps,
    ],
    { width: 2560, height: 1600 },
    'm1'
  );
  assert.equal(readBoard(mac).rows[0].place, 'left');
  const iphone = onDevice(mac, 'ios');
  const title = boxOf(placed(iphone, 'title'));
  const laptop = boxOf(placed(iphone, 'laptop'));
  assert.ok(bottomOf(title) <= laptop.y + 1, 'the text goes over the Mac');
  assert.ok(laptop.x >= -1 && laptop.x + laptop.width <= 1206 + 1, 'the Mac fits across the phone screen');
});

test('a badge on the phone and a group with it move with the phone', () => {
  const badge = rect('badge', 700, 1000, 200, 200, { shapeType: 'star' });
  const grouped = { ...rect('glow', 150, 2200, 300, 120), groupId: 'g1' };
  const source = headlineAndPhone([badge, grouped]);
  source.elements = source.elements.map((el) => (el.id === 'phone' ? { ...el, groupId: 'g1' } : el));
  const reading = readBoard(source);
  assert.deepEqual(reading.hero.map((item) => item.el.id).sort(), ['badge', 'glow', 'phone']);

  // Same place on the device, as a share of its size, whether the frame stays
  // a phone or becomes an iPad.
  const centre = (b: Bounds, d: Bounds) => ({ x: (b.x + b.width / 2 - d.x) / d.width, y: (b.y + b.height / 2 - d.y) / d.height });
  const was = centre({ x: 700, y: 1000, width: 200, height: 200 }, { x: 203, y: PHONE_Y, width: 800, height: PHONE_H });
  const withIpadShot = withBoardSet([source], 'b1', 'ipad-pro-13', (set) =>
    withScreen(set, 'phone', null, { screenshotSrc: 'asset:asset_ipad', naturalScreenshotWidth: 2064, naturalScreenshotHeight: 2752 })
  )[0];
  for (const shown of [source, withIpadShot]) {
    const ipad = onDevice(shown, 'ipad-pro-13');
    const device = placed(ipad, 'phone') as DeviceFrameElementProps;
    const now = centre(boxOf(placed(ipad, 'badge')), boxOf(device));
    assert.ok(
      Math.abs(was.x - now.x) < 0.02 && Math.abs(was.y - now.y) < 0.02,
      `${device.deviceType}: badge at ${JSON.stringify(now)}, was ${JSON.stringify(was)}`
    );
  }
});

test('a background that covers the artboard covers the new one too', () => {
  const ipad = onDevice(headlineAndPhone(), 'ipad-pro-13');
  const bg = placed(ipad, 'bg');
  assert.deepEqual(bg.position, { x: 0, y: 0 });
  assert.equal(bg.size.width * bg.scale, 2064);
  assert.equal(bg.size.height * bg.scale, 2752);
});

test('a plan worked out in the main language keeps its layout in another language and fits longer text', () => {
  const source = headlineAndPhone();
  const plan = planFor(source, 'ipad-pro-13', { measure: fakeMeasure })!;
  const german: ArtboardState = {
    ...source,
    elements: source.elements.map((el) =>
      el.id === 'title' ? { ...(el as TextElementProps), content: 'Verfolge jede Gewohnheit an einem einzigen Ort, jeden Tag und ohne Stress' } : el
    ),
  };
  const english = applyPlan(source, plan, fakeMeasure);
  const shown = applyPlan(german, plan, fakeMeasure);
  const a = placed(english, 'title') as TextElementProps;
  const b = placed(shown, 'title') as TextElementProps;
  assert.deepEqual(b.position, a.position);
  assert.deepEqual(b.size, a.size);
  assert.ok(b.fontSize < a.fontSize, 'the longer German line comes down in size');
  assert.ok(fakeMeasure(b) <= b.size.height + 1, 'and fits its box');
  assert.deepEqual(placed(shown, 'phone').position, placed(english, 'phone').position);
});

test('the scaled layout is the uniform conversion convertArtboardsToFormat makes', () => {
  const source = headlineAndPhone();
  const preset = DEVICE_FORMAT_PRESETS.find((p) => p.id === 'tablet-10')!;
  const plan = planBoard(source, preset.artboard, 'scaled');
  const mine = applyPlan(source, plan);
  const uniform = convertArtboardsToFormat([source], { ...preset, id: 'ios' }).artboards[0];
  for (const id of ['title', 'sub', 'bg']) {
    const a = placed(mine, id);
    const b = placed(uniform, id);
    assert.deepEqual(a.position, b.position, id);
    assert.ok(Math.abs(a.size.width * a.scale - b.size.width * b.scale) < 1e-6, id);
  }
});

test('the devices a project makes are kept on every artboard, in store order', () => {
  const boards = [headlineAndPhone(), { ...headlineAndPhone(), id: 'b2' }];
  assert.deepEqual(projectSetFormats(boards), []);
  const next = withSetFormats(boards, ['mac', 'ipad-pro-13', 'android']);
  assert.deepEqual(projectSetFormats(next), ['android', 'ipad-pro-13', 'mac']);
  assert.deepEqual(next[1].deviceSetFormats, ['android', 'ipad-pro-13', 'mac']);
});

test('a layout pick is kept per artboard and device, and clearing it leaves nothing behind', () => {
  const boards = [headlineAndPhone()];
  const picked = withBoardSet(boards, 'b1', 'mac', (set) => ({ ...set, layout: 'stacked' }));
  assert.equal(picked[0].deviceSets?.mac?.layout, 'stacked');
  assert.equal(planFor(picked[0], 'mac', { measure: fakeMeasure })?.layout, 'stacked');
  const cleared = withBoardSet(picked, 'b1', 'mac', (set) => ({ ...set, layout: undefined }));
  assert.equal(cleared[0].deviceSets, undefined);
});

test("another language's screenshot waits for the main language's, and goes with it", () => {
  const shot = { screenshotSrc: 'asset:asset_de', naturalScreenshotWidth: 2064, naturalScreenshotHeight: 2752 };
  assert.deepEqual(withScreen({}, 'phone', 'de-DE', shot), {}, 'nothing for German before the main language has one');
  const main = withScreen({}, 'phone', null, { ...shot, screenshotSrc: 'asset:asset_en' });
  const both = withScreen(main, 'phone', 'de-DE', shot);
  assert.equal(both.screens?.phone.localized?.['de-DE'].screenshotSrc, 'asset:asset_de');
  const source = withBoardSet([headlineAndPhone()], 'b1', 'ipad-pro-13', () => both)[0];
  const plan = planFor(source, 'ipad-pro-13', { measure: fakeMeasure })!;
  const de = boardOnDevice(source, plan, source, 'ipad-pro-13', 'de-DE', fakeMeasure);
  const fr = boardOnDevice(source, plan, source, 'ipad-pro-13', 'fr-FR', fakeMeasure);
  assert.equal((placed(de, 'phone') as DeviceFrameElementProps).screenshotSrc, 'asset:asset_de');
  assert.equal((placed(fr, 'phone') as DeviceFrameElementProps).screenshotSrc, 'asset:asset_en');
  const removed = withScreen(both, 'phone', null, null);
  assert.equal(removed.screens?.phone, undefined);
});

test('screenshots added for a device travel with the project', () => {
  const source = withBoardSet([headlineAndPhone()], 'b1', 'ipad-pro-13', (set) =>
    withScreen(withScreen(set, 'phone', null, { screenshotSrc: 'asset:asset_en' }), 'phone', 'de-DE', { screenshotSrc: 'asset:asset_de' })
  );
  const ids = collectMediaIds(source);
  assert.ok(ids.includes('asset_en'));
  assert.ok(ids.includes('asset_de'));
});

test('header art, Watch artboards and feature graphics are not laid out for devices', () => {
  assert.equal(takesPart(headlineAndPhone()), true);
  assert.equal(takesPart({ ...headlineAndPhone(), creativeAsset: 'header' }), false);
  assert.equal(takesPart(board([text('t', 'Big sale', 10, 10, 500, 100)], { width: 1024, height: 500 })), false);
  const watch = board([{ ...phone('w', 40, 40, 300, 360), deviceType: 'apple-watch' }], { width: 422, height: 514 });
  assert.equal(takesPart(watch), false);
  // Such an artboard is scaled to the size with one factor, so an export of the set still has it.
  const [out] = boardsOnDevice([watch], [watch], 'ipad-pro-13', null);
  assert.deepEqual(out.size, { width: 2064, height: 2752 });
});

test('every bundled template lays out on every device without text leaving the artboard', async () => {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const dir = path.join(process.cwd(), 'public', 'data', 'projects');
  const formats: DeviceFormat[] = ['ios', 'ios-large', 'ipad-pro-13', 'ipad-11', 'android', 'tablet-7', 'tablet-10', 'mac'];
  const layouts = new Map<string, number>();
  let boardsSeen = 0;
  for (const name of fs.readdirSync(dir).filter((file) => file.endsWith('.json'))) {
    const json = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
    const boards: ArtboardState[] = Array.isArray(json) ? json : json.projectData ?? [];
    for (const source of boards) {
      if (!takesPart(source)) continue;
      boardsSeen += 1;
      for (const format of formats) {
        const plan = planFor(source, format, { measure: fakeMeasure });
        assert.ok(plan, `${name} ${source.id} ${format}`);
        const out = boardOnDevice(source, plan, source, format, null, fakeMeasure);
        assert.equal(out.elements.length, source.elements.length, `${name} keeps every element`);
        const used = plan.fellBack ? 'fell back' : plan.layout;
        layouts.set(`${format}:${used}`, (layouts.get(`${format}:${used}`) ?? 0) + 1);
        // Shrunk to fit only when no rebuilt layout fits.
        if (plan.fellBack) {
          for (const other of ['stacked', 'beside', 'beside-flipped'] as const) {
            const tried = planFor(source, format, { layout: other, measure: fakeMeasure });
            assert.ok(!tried || tried.layout === 'scaled', `${name} ${source.id} ${format}: ${other} fits, yet the automatic layout shrank it`);
          }
        }
        if (plan.layout === 'scaled') continue;
        for (const el of out.elements) {
          if (el.type !== 'text') continue;
          const before = boxOf(source.elements.find((other) => other.id === el.id)!);
          const inside = (b: Bounds, w: number, h: number) =>
            b.x >= -2 && b.y >= -2 && b.x + b.width <= w + 2 && bottomOf(b) <= h + 2;
          if (!inside(before, source.size.width, source.size.height)) continue;
          const b = boxOf(el);
          assert.ok(inside(b, out.size.width, out.size.height), `${name} ${source.id} ${format}: text ${el.id} at ${JSON.stringify(b)}`);
          for (const value of [b.x, b.y, b.width, b.height, (el as TextElementProps).fontSize]) {
            assert.ok(Number.isFinite(value), `${name} ${source.id} ${format}: ${el.id} has a number that is not finite`);
          }
        }
      }
    }
  }
  assert.ok(boardsSeen > 300, `only ${boardsSeen} boards`);
  // How often each layout was used, for the record when this test is run alone.
  if (process.env.DEVICE_SET_REPORT) console.log(Object.fromEntries([...layouts].sort()));
});

test('a duplicated or moved artboard keeps its device screenshots on its frames', async () => {
  const { remapOverrideIds } = await import('@/lib/i18n/localization');
  const { remapDeviceSets } = await import('@/lib/tabs/transfer');
  const source = withBoardSet([headlineAndPhone()], 'b1', 'ipad-pro-13', (set) =>
    withScreen({ ...set, layout: 'stacked' }, 'phone', null, { screenshotSrc: 'asset:asset_ipad' })
  )[0];
  const duplicated = remapOverrideIds(source, { phone: 'phone-copy', title: 'title-copy' });
  assert.equal(duplicated.deviceSets?.['ipad-pro-13']?.screens?.['phone-copy']?.screenshotSrc, 'asset:asset_ipad');
  assert.equal(duplicated.deviceSets?.['ipad-pro-13']?.layout, 'stacked');
  // A move mints every id afresh, so a screenshot whose frame is not there goes.
  const moved = remapDeviceSets(source.deviceSets, new Map([['phone', 'moved-phone']]));
  assert.deepEqual(Object.keys(moved?.['ipad-pro-13']?.screens ?? {}), ['moved-phone']);
  assert.equal(remapDeviceSets(source.deviceSets, new Map())?.['ipad-pro-13']?.screens, undefined);
});

test('a screenshot added for a device turns the frame into that device whatever its shape', async () => {
  const { frameFor, framesOn: frames } = await import('@/lib/deviceSets/sets');
  const tablet7 = deviceSetTarget('tablet-7')!;
  // A 7-inch tablet screenshot is as tall as a phone's.
  const tall = withBoardSet([headlineAndPhone()], 'b1', 'tablet-7', (set) =>
    withScreen(set, 'phone', null, { screenshotSrc: 'asset:asset_tab', naturalScreenshotWidth: 1080, naturalScreenshotHeight: 1920 })
  )[0];
  assert.equal(frames(tall, tablet7).get('phone'), 'tablet-7');
  // An iPad screenshot taken sideways still belongs in an iPad.
  const ipad = deviceSetTarget('ipad-pro-13')!;
  const sideways = withBoardSet([headlineAndPhone()], 'b1', 'ipad-pro-13', (set) =>
    withScreen(set, 'phone', null, { screenshotSrc: 'asset:asset_wide', naturalScreenshotWidth: 2752, naturalScreenshotHeight: 2064 })
  )[0];
  assert.equal(frames(sideways, ipad).get('phone'), 'ipad-pro-13');
  // The design's own phone screenshot still keeps its phone frame.
  const phoneEl = headlineAndPhone().elements.find((el) => el.id === 'phone') as DeviceFrameElementProps;
  assert.equal(frameFor(tablet7, phoneEl, 1080 / 1920, false), 'android-punch-hole');
});

test('a device asks for its own screenshot where its frame does not fit the one in the design', async () => {
  const { framesOnDevice } = await import('@/lib/deviceSets/sets');
  // An iPad design: an iPad frame holding an iPad screenshot.
  const ipadDesign = {
    ...headlineAndPhone([], { deviceType: 'ipad-pro-13', naturalScreenshotWidth: 2064, naturalScreenshotHeight: 2752 }),
    size: { width: 2064, height: 2752 },
  };
  const on = (format: DeviceFormat) => framesOnDevice(ipadDesign, deviceSetTarget(format)!)[0];
  assert.equal(on('ios').wrongShape, true, 'an iPad screenshot does not fit an iPhone');
  assert.equal(on('android').wrongShape, true, 'nor an Android phone');
  assert.equal(on('tablet-10').wrongShape, true, 'nor a 10-inch Android tablet');
  assert.equal(on('ipad-11').wrongShape, false, 'the smaller iPad is near enough');
  assert.equal(on('mac').wrongShape, false, 'the Mac keeps the iPad');
  // An iPhone screenshot added for the iPhone puts it right.
  const added = withBoardSet([ipadDesign], 'b1', 'ios', (set) =>
    withScreen(set, 'phone', null, { screenshotSrc: 'asset:asset_iphone', naturalScreenshotWidth: 1206, naturalScreenshotHeight: 2622 })
  )[0];
  const fixed = framesOnDevice(added, deviceSetTarget('ios')!)[0];
  assert.equal(fixed.wrongShape, false);
  assert.equal(fixed.deviceType, 'iphone-17-pro-max');
  // A phone screenshot fits every phone, Android included.
  const phoneDesign = headlineAndPhone([], { naturalScreenshotWidth: 1206, naturalScreenshotHeight: 2622 });
  for (const format of ['ios-large', 'android'] as const) {
    assert.equal(framesOnDevice(phoneDesign, deviceSetTarget(format)!)[0].wrongShape, false, format);
  }
});

test("the project's own device is read from its size, not its frames", async () => {
  const { ownFormatOf } = await import('@/lib/deviceSets/sets');
  const ipadSized = { ...headlineAndPhone(), size: { width: 2064, height: 2752 } };
  assert.equal(ownFormatOf([ipadSized]), 'ipad-pro-13', 'an iPad set with phone frames is the iPad');
  assert.equal(ownFormatOf([headlineAndPhone()]), 'ios');
  const play = { ...headlineAndPhone(), size: { width: 1080, height: 1920 } };
  assert.equal(ownFormatOf([play]), 'android');
  const tabletFramed = { ...play, elements: play.elements.map((el) => (el.id === 'phone' ? { ...el, deviceType: 'tablet-7' } : el)) as ArtboardElement[] };
  assert.equal(ownFormatOf([tabletFramed]), 'tablet-7');
  assert.equal(ownFormatOf([headlineAndPhone(), { ...ipadSized, id: 'b2' }]), null, 'mixed sizes have no own device');
});

test('an artboard added later joins the devices the project exports, and keeps them', async () => {
  const { mirrorSetFormats } = await import('@/lib/deviceSets/sets');
  const made = withSetFormats([headlineAndPhone()], ['android']);
  const withNew = mirrorSetFormats([...made, { ...headlineAndPhone(), id: 'b2', deviceSetFormats: undefined }]);
  assert.deepEqual(withNew[1].deviceSetFormats, ['android']);
  // The first artboards deleted: the list stays with the one left.
  assert.deepEqual(projectSetFormats(withNew.slice(1)), ['android']);
  // Nothing to do comes back as it was.
  assert.equal(mirrorSetFormats(withNew), withNew);
});

test('converting a translated project lays every language out for the device', async () => {
  const { projectForDevice } = await import('@/lib/deviceSets/sets');
  let source = headlineAndPhone([], { screenshotSrc: 'asset:asset_phone_en', naturalScreenshotWidth: 1206, naturalScreenshotHeight: 2622 });
  source = {
    ...source,
    localization: { baseLocale: 'en-US', locales: [{ code: 'de-DE' }] },
    localized: {
      'de-DE': {
        title: { content: 'Jede Gewohnheit an einem Ort', position: { x: 10, y: 20 }, detached: ['position'] },
        phone: { screenshotSrc: 'asset:asset_phone_de' },
      },
    },
  };
  source = withBoardSet([source], 'b1', 'ipad-pro-13', (set) =>
    withScreen(withScreen(set, 'phone', null, { screenshotSrc: 'asset:asset_ipad_en', naturalScreenshotWidth: 2064, naturalScreenshotHeight: 2752 }), 'phone', 'de-DE', {
      screenshotSrc: 'asset:asset_ipad_de',
      naturalScreenshotWidth: 2064,
      naturalScreenshotHeight: 2752,
    })
  )[0];
  source = withBoardSet([source], 'b1', 'mac', (set) => ({ ...set, layout: 'stacked' }))[0];
  const [converted] = projectForDevice(withSetFormats([source], ['ipad-pro-13', 'mac']), 'ipad-pro-13', fakeMeasure, { keepChoices: true });
  const phone = converted.elements.find((el) => el.id === 'phone') as DeviceFrameElementProps;
  assert.equal(phone.deviceType, 'ipad-pro-13');
  assert.equal(phone.screenshotSrc, 'asset:asset_ipad_en');
  const german = converted.localized?.['de-DE'];
  // German keeps its words, shows its own iPad screenshot, and follows the new layout.
  assert.equal(german?.title?.content, 'Jede Gewohnheit an einem Ort');
  assert.equal(german?.title?.position, undefined);
  assert.equal(german?.title?.detached, undefined);
  assert.equal(german?.phone?.screenshotSrc, 'asset:asset_ipad_de');
  // What was chosen for the iPad is now the design; the Mac's choices stay.
  assert.equal(converted.deviceSets?.['ipad-pro-13'], undefined);
  assert.equal(converted.deviceSets?.mac?.layout, 'stacked');
  assert.deepEqual(converted.deviceSetFormats, ['mac']);
});

test('a background spanned across the artboards is sliced on the device the way the export slices it', async () => {
  const { deviceSetView } = await import('@/components/open-screenshot-generator/devices/useDeviceSets');
  const { normalizeBackgroundImage } = await import('@/lib/artboardBackground');
  const first: ArtboardState = { ...headlineAndPhone(), id: 'a', backgroundImage: '/data/bg.png', backgroundImageApply: 'span' };
  const second: ArtboardState = { ...headlineAndPhone(), id: 'b' };
  const boards = normalizeBackgroundImage([first, second]);
  assert.equal(boards[1].backgroundImageSlice?.totalWidth, 1206 * 2, 'the design is sliced at its own size');
  const view = deviceSetView(boards, boards, deviceSetTarget('ipad-pro-13')!, false, null);
  view.boards.forEach((board, index) => {
    assert.equal(board.shown.backgroundImageSlice?.totalWidth, 2064 * 2);
    assert.equal(board.shown.backgroundImageSlice?.offsetX, 2064 * index);
  });
});
