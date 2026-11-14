// Capture's pure parts: the language a device opens the app in, the grid of
// frames by language, which device suits a frame, how screenshots and
// recordings go into one language without touching the others, and the
// still-screen check.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appLanguageFor } from '@/lib/capture/locales';
import { captureCells, captureTargets, cellKey, isOwnPicture } from '@/lib/capture/frames';
import { bestRunningDevice, deviceFit, modelForFrame, shapeDifference, SHAPE_WARNING } from '@/lib/capture/match';
import { placeClip, placeShots } from '@/lib/capture/place';
import { frameDifference, STILL_BELOW } from '@/lib/capture/settle';
import { projectArtboards } from '@/lib/i18n/project';
import type { CaptureDevice } from '@/lib/capture/types';
import type {
  ArtboardElement,
  ArtboardState,
  DeviceFrameElementProps,
  ProjectLocalization,
  TextElementProps,
  VideoDeviceElementProps,
} from '@/types/artboard';

const LOCALIZATION: ProjectLocalization = { baseLocale: 'en-US', locales: [{ code: 'de-DE' }, { code: 'ja' }] };

function phone(id: string, extra: Partial<DeviceFrameElementProps> = {}): DeviceFrameElementProps {
  return {
    id,
    type: 'device',
    deviceType: 'iphone-17-pro-max',
    position: { x: 100, y: 400 },
    size: { width: 1100, height: 2390 },
    rotation: 0,
    scale: 1,
    screenshotSrc: '/elements/devices/placeholder.png',
    screenshotRect: { left: 3, top: 3, width: 94, height: 94 },
    ...extra,
  } as DeviceFrameElementProps;
}

function videoPhone(id: string): VideoDeviceElementProps {
  return {
    id,
    type: 'video-device',
    deviceType: 'iphone-17-pro-max',
    position: { x: 100, y: 400 },
    size: { width: 1100, height: 2390 },
    rotation: 0,
    scale: 1,
    trimStart: 2,
    trimEnd: 9,
  } as VideoDeviceElementProps;
}

function text(id: string): TextElementProps {
  return {
    id,
    type: 'text',
    content: 'Hello',
    position: { x: 0, y: 0 },
    size: { width: 800, height: 200 },
    rotation: 0,
    scale: 1,
    fontSize: 40,
    color: '#111111',
    fontFamily: 'Inter',
  } as TextElementProps;
}

function board(id: string, elements: ArtboardElement[], extra: Partial<ArtboardState> = {}): ArtboardState {
  return {
    id,
    name: `Screen ${id}`,
    position: { x: 0, y: 0 },
    size: { width: 1320, height: 2868 },
    elements,
    backgroundColor: '#ffffff',
    localization: LOCALIZATION,
    ...extra,
  } as ArtboardState;
}

function device(partial: Partial<CaptureDevice>): CaptureDevice {
  return { id: 'X', platform: 'ios', kind: 'simulator', name: 'iPhone 17 Pro', state: 'running', os: 'iOS 26.5', ...partial };
}

test('each platform gets the language code it reads', () => {
  assert.deepEqual(appLanguageFor('de-DE', 'ios'), { language: 'de-DE', region: 'de_DE' });
  assert.deepEqual(appLanguageFor('zh-Hans', 'ios'), { language: 'zh-Hans' });
  assert.deepEqual(appLanguageFor('ar-SA', 'ios'), { language: 'ar-SA', region: 'ar_SA' });
  // Android reads Google Play's code: zh-CN is Simplified Chinese there.
  assert.deepEqual(appLanguageFor('zh-Hans', 'android'), { language: 'zh-CN' });
  assert.deepEqual(appLanguageFor('eu', 'android'), { language: 'eu-ES' });
  assert.equal(appLanguageFor('not a code', 'ios'), null);
});

test('a target per device frame, App Store art left out, video frames as recordings', () => {
  const boards = [
    board('a', [text('t1'), phone('p1')]),
    board('art', [phone('p2')], { creativeAsset: 'header' }),
    board('b', [phone('p3', { captureScreen: { link: 'myapp://settings' } }), videoPhone('v1')]),
  ];
  const targets = captureTargets(boards);
  assert.deepEqual(
    targets.map((target) => [target.key, target.kind, target.boardIndex, target.frameNumber, target.frameCount]),
    [
      ['a:p1', 'screenshot', 0, 1, 1],
      ['b:p3', 'screenshot', 1, 1, 2],
      ['b:v1', 'recording', 1, 2, 2],
    ]
  );
  assert.equal(targets[0].platform, 'ios');
  assert.equal(targets[0].deviceLabel, 'iPhone 17 Pro Max');
  assert.ok(targets[0].screenAspect && Math.abs(targets[0].screenAspect - 0.46) < 0.03, `aspect ${targets[0].screenAspect}`);
  assert.deepEqual(targets[1].screen, { link: 'myapp://settings' });
});

test('a template placeholder is not the user picture, an asset is', () => {
  assert.equal(isOwnPicture('/elements/devices/placeholder.png'), false);
  assert.equal(isOwnPicture('asset:asset_1'), true);
  assert.equal(isOwnPicture('data:image/png;base64,AAA'), true);
  assert.equal(isOwnPicture(undefined), false);
});

test('a screenshot for one language changes that language only', () => {
  const base = [board('a', [phone('p1')]), board('b', [phone('p2')])];
  const { artboards, missed } = placeShots(base, [{ boardId: 'a', elementId: 'p1', locale: 'de-DE', ref: 'asset:de', width: 1320, height: 2868 }]);
  assert.equal(missed, 0);
  const basePhone = artboards[0].elements[0] as DeviceFrameElementProps;
  assert.equal(basePhone.screenshotSrc, '/elements/devices/placeholder.png', 'the base language keeps its picture');
  assert.deepEqual(basePhone.screenshotRect, { left: 3, top: 3, width: 94, height: 94 }, 'the shared rect is not touched');
  const german = projectArtboards(artboards, 'de-DE')[0].elements[0] as DeviceFrameElementProps;
  assert.equal(german.screenshotSrc, 'asset:de');
  const japanese = projectArtboards(artboards, 'ja')[0].elements[0] as DeviceFrameElementProps;
  assert.equal(japanese.screenshotSrc, '/elements/devices/placeholder.png');
  assert.equal(artboards[1], base[1], 'an artboard nobody touched stays the same object');
});

test('a screenshot in the base language is written the way Upload Screenshot writes it', () => {
  const base = [board('a', [phone('p1')])];
  const { artboards } = placeShots(base, [
    { boardId: 'a', elementId: 'p1', locale: null, ref: 'asset:en', width: 1320, height: 2868 },
  ]);
  const placed = artboards[0].elements[0] as DeviceFrameElementProps;
  assert.equal(placed.screenshotSrc, 'asset:en');
  assert.equal(placed.naturalScreenshotWidth, 1320);
  assert.deepEqual(placed.screenshotRect, { left: 0, top: 0, width: 100, height: 100 });
  // The base language named by its code is the same as null.
  const again = placeShots(base, [{ boardId: 'a', elementId: 'p1', locale: 'en-US', ref: 'asset:en2', width: 1, height: 2 }]);
  assert.equal((again.artboards[0].elements[0] as DeviceFrameElementProps).screenshotSrc, 'asset:en2');
});

test('several languages in one go, each into its own language', () => {
  const base = [board('a', [phone('p1')])];
  const { artboards, missed } = placeShots(base, [
    { boardId: 'a', elementId: 'p1', locale: null, ref: 'asset:en', width: 1320, height: 2868 },
    { boardId: 'a', elementId: 'p1', locale: 'de-DE', ref: 'asset:de', width: 1320, height: 2868 },
    { boardId: 'a', elementId: 'p1', locale: 'ja', ref: 'asset:ja', width: 1320, height: 2868 },
  ]);
  assert.equal(missed, 0);
  const shown = (locale: string | null) => (projectArtboards(artboards, locale)[0].elements[0] as DeviceFrameElementProps).screenshotSrc;
  assert.deepEqual([shown(null), shown('de-DE'), shown('ja')], ['asset:en', 'asset:de', 'asset:ja']);
});

test('a language the project lacks, a gone frame and a hidden frame are missed, and the base stays', () => {
  const hidden = board('a', [phone('p1')], { localized: { ja: { p1: { hidden: true } } } });
  const base = [hidden];
  const result = placeShots(base, [
    { boardId: 'a', elementId: 'p1', locale: 'fr-FR', ref: 'asset:fr', width: 1, height: 2 },
    { boardId: 'a', elementId: 'gone', locale: null, ref: 'asset:x', width: 1, height: 2 },
    { boardId: 'a', elementId: 'p1', locale: 'ja', ref: 'asset:ja', width: 1, height: 2 },
  ]);
  assert.equal(result.missed, 3);
  assert.equal(result.artboards, base);
  assert.equal((result.artboards[0].elements[0] as DeviceFrameElementProps).screenshotSrc, '/elements/devices/placeholder.png');
});

test('the grid says what each frame shows in each language', () => {
  const base = [board('a', [phone('p1')], { localized: { ja: { p1: { hidden: true } } } })];
  const placed = placeShots(base, [{ boardId: 'a', elementId: 'p1', locale: 'de-DE', ref: 'asset:de', width: 1320, height: 2868 }]).artboards;
  const targets = captureTargets(placed);
  const cells = captureCells(placed, targets, ['en-US', 'de-DE', 'ja'], 'en-US');
  const en = cells.get(cellKey('a:p1', 'en-US'));
  const de = cells.get(cellKey('a:p1', 'de-DE'));
  const ja = cells.get(cellKey('a:p1', 'ja'));
  assert.equal(en?.own, false);
  assert.equal(de?.src, 'asset:de');
  assert.equal(de?.own, true);
  assert.equal(ja?.hidden, true);
});

test('a recording goes into one language with its own length and no old trim, and the base gets its size and loses old trims', () => {
  const base = [board('a', [{ ...videoPhone('v1'), mediaId: 'media_en', durationSeconds: 30, keepAudio: true } as VideoDeviceElementProps])];
  const local = placeClip(base, { boardId: 'a', elementId: 'v1', locale: 'de-DE', mediaId: 'media_de', width: 1080, height: 2400, duration: 6 });
  assert.equal(local.missed, 0);
  const german = projectArtboards(local.artboards, 'de-DE')[0].elements[0] as VideoDeviceElementProps;
  assert.equal(german.mediaId, 'media_de');
  assert.equal(german.durationSeconds, 6);
  assert.equal(german.naturalVideoWidth, 1080);
  assert.equal(german.trimStart, undefined);
  assert.equal(german.trimEnd, undefined);
  assert.equal(german.keepAudio, undefined);
  // Every other language still plays the English clip, trimmed as before.
  for (const locale of [null, 'ja']) {
    const other = projectArtboards(local.artboards, locale)[0].elements[0] as VideoDeviceElementProps;
    assert.deepEqual(
      [other.mediaId, other.durationSeconds, other.trimStart, other.trimEnd, other.keepAudio],
      ['media_en', 30, 2, 9, true]
    );
  }
  const own = placeClip(base, { boardId: 'a', elementId: 'v1', locale: null, mediaId: 'media_new', width: 1320, height: 2868, duration: 6 });
  const element = own.artboards[0].elements[0] as VideoDeviceElementProps;
  assert.equal(element.mediaId, 'media_new');
  assert.equal(element.durationSeconds, 6);
  assert.equal(element.trimStart, undefined);
  assert.equal(element.trimEnd, undefined);
  assert.equal(placeClip(base, { boardId: 'a', elementId: 'nope', locale: null, mediaId: 'm', width: 1, height: 1, duration: 1 }).missed, 1);
});

test('a recording in one language keeps its own length, size and no trim when the base clip changes later', () => {
  // German records the same length and size as the English clip, and neither has a trim.
  const english = { ...videoPhone('v1'), mediaId: 'media_en', durationSeconds: 6, naturalVideoWidth: 1080, naturalVideoHeight: 2400, trimStart: undefined, trimEnd: undefined } as VideoDeviceElementProps;
  const local = placeClip([board('a', [english])], { boardId: 'a', elementId: 'v1', locale: 'de-DE', mediaId: 'media_de', width: 1080, height: 2400, duration: 6 });
  assert.equal(local.missed, 0);
  // Then English gets a 20 second clip of another size, trimmed to 10 to 19 seconds, with sound.
  const replaced = placeClip(local.artboards, { boardId: 'a', elementId: 'v1', locale: null, mediaId: 'media_en2', width: 1320, height: 2868, duration: 20 });
  const trimmed = replaced.artboards.map((b) => ({
    ...b,
    elements: b.elements.map((element) => ({ ...element, trimStart: 10, trimEnd: 19, keepAudio: true }) as ArtboardElement),
  }));
  const german = projectArtboards(trimmed, 'de-DE')[0].elements[0] as VideoDeviceElementProps;
  assert.deepEqual(
    [german.mediaId, german.durationSeconds, german.naturalVideoWidth, german.naturalVideoHeight, german.trimStart, german.trimEnd, german.keepAudio],
    ['media_de', 6, 1080, 2400, undefined, undefined, undefined]
  );
  const japanese = projectArtboards(trimmed, 'ja')[0].elements[0] as VideoDeviceElementProps;
  assert.deepEqual(
    [japanese.mediaId, japanese.durationSeconds, japanese.naturalVideoWidth, japanese.trimStart, japanese.trimEnd, japanese.keepAudio],
    ['media_en2', 20, 1320, 10, 19, true]
  );
});

test('the device with the frame model wins, then the same platform, then anything running', () => {
  const target = { deviceLabel: 'iPhone 17 Pro Max', platform: 'ios' as const };
  const pro = device({ id: 'pro', name: 'iPhone 17 Pro' });
  const max = device({ id: 'max', name: 'iPhone 17 Pro Max' });
  const pixel = device({ id: 'emulator-5554', platform: 'android', kind: 'emulator', name: 'Pixel 9 Pro API 35' });
  const off = device({ id: 'off', name: 'iPhone 17 Pro Max', state: 'off' });
  assert.equal(deviceFit(target, max), 'same-model');
  assert.equal(deviceFit(target, pro), 'same-platform');
  assert.equal(deviceFit(target, pixel), 'other');
  assert.equal(bestRunningDevice(target, [pixel, pro, max])?.id, 'max');
  assert.equal(bestRunningDevice(target, [pixel, off])?.id, 'emulator-5554');
  assert.equal(bestRunningDevice(target, [off]), null);
  // An AVD name carries "API 35"; the model is what counts.
  assert.equal(deviceFit({ deviceLabel: 'Pixel 9 Pro', platform: 'android' }, pixel), 'same-model');
});

test('the simulator model with the frame name is offered, Android never', () => {
  const models = [
    { id: 'com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro', name: 'iPhone 17 Pro', family: 'iPhone' },
    { id: 'com.apple.CoreSimulator.SimDeviceType.iPhone-17-Pro-Max', name: 'iPhone 17 Pro Max', family: 'iPhone' },
  ];
  assert.equal(modelForFrame({ deviceLabel: 'iPhone 17 Pro Max', platform: 'ios' }, models)?.id, models[1].id);
  assert.equal(modelForFrame({ deviceLabel: 'Pixel 10 Pro', platform: 'android' }, models), null);
});

test('a screenshot of another shape is told apart from one that fits', () => {
  // iPhone 17 Pro Max: 1320 x 2868. iPhone SE: 750 x 1334.
  const frame = 1320 / 2868;
  assert.ok((shapeDifference(frame, 1320, 2868) ?? 1) < 0.001);
  assert.ok((shapeDifference(frame, 750, 1334) ?? 0) > SHAPE_WARNING);
  assert.equal(shapeDifference(null, 750, 1334), null);
});

test('two grey samples that match are still, a changed screen is not', () => {
  const a = new Uint8ClampedArray(24 * 52).fill(120);
  const b = new Uint8ClampedArray(a);
  b[5] = 125;
  assert.ok(frameDifference(a, b) < STILL_BELOW);
  const c = new Uint8ClampedArray(a.length).fill(200);
  assert.ok(frameDifference(a, c) > STILL_BELOW);
  assert.equal(frameDifference(a, new Uint8ClampedArray(3)), 255);
});
