// Google Play's foldable screenshots: the canvas offers them at the sizes
// Google's capture guide makes, nothing puts them in an API slot (Play
// Console is the only way in), and `osg verify` warns instead of failing them.
// Play's phone and tablet limit, a long side up to 2.3 times the short one, is
// pinned here too, since the same check refuses the foldables, with the other
// slots' shapes and the slot each size starts in.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALL_CANVAS_SIZE_PRESETS, CANVAS_SIZE_PRESET_GROUPS, canvasSizeSlug, findMatchingPreset } from '@/lib/sizePresets';
import {
  PLAY_FOLDABLE_PROBLEM,
  PLAY_FOLDABLE_SIZES,
  PLAY_IMAGE_TARGETS,
  isPlayFoldableSize,
  suggestPlayImageType,
  validatePlayImage,
} from '@/lib/publish/storeTargets';
import { uploadPlayScreenshotsForLanguages } from '@/lib/publish/googlePlay';
import { StoreRejectedError } from '@/lib/publish/types';
import { checkPng, isPlayConsoleOnlyArt, rulesetFor } from '../../cli/src/verify/rules';

const SQUARE = { width: 2106, height: 2106 };
const INNER = { width: 2688, height: 2016 };
const OUTER = { width: 1260, height: 2016 };
const SCREENSHOT_SLOTS = PLAY_IMAGE_TARGETS.filter((slot) => !slot.exactSize).map((slot) => slot.imageType);

test('the canvas offers every Play foldable size once, in its own group, inside Play\'s foldable bounds', () => {
  const group = CANVAS_SIZE_PRESET_GROUPS.find((entry) => entry.key === 'play-foldable');
  assert.ok(group, 'a Google Play Foldable group');
  assert.deepEqual(
    group.presets.map(({ width, height }) => ({ width, height })),
    [...PLAY_FOLDABLE_SIZES],
    'the group and the upload check list the same sizes'
  );
  for (const size of PLAY_FOLDABLE_SIZES) {
    const same = ALL_CANVAS_SIZE_PRESETS.filter((preset) => preset.width === size.width && preset.height === size.height);
    assert.equal(same.length, 1, `${size.width}x${size.height} is no other preset's size`);
    assert.equal(findMatchingPreset(size)?.id, same[0].id);
    // answer 9866151: "each side between 960 px and 3,840 px".
    assert.ok(Math.min(size.width, size.height) >= 960 && Math.max(size.width, size.height) <= 3840);
  }
  assert.equal(findMatchingPreset(SQUARE)?.id, 'play-fold-square');
  assert.equal(findMatchingPreset(INNER)?.id, 'play-fold-inner');
  assert.equal(findMatchingPreset(OUTER)?.id, 'play-fold-outer');
  assert.equal(canvasSizeSlug(INNER), 'Foldable-inner-display-Landscape_2688x2016');
});

test('a foldable shot goes in no API slot, while tablet shots of the same shape still do', () => {
  for (const size of PLAY_FOLDABLE_SIZES) {
    assert.equal(isPlayFoldableSize(size.width, size.height), true);
    for (const slot of SCREENSHOT_SLOTS) {
      assert.equal(validatePlayImage(size.width, size.height, slot), PLAY_FOLDABLE_PROBLEM, `${size.width}x${size.height} in ${slot}`);
    }
  }
  // 10:16 and 16:10, the foldable outer screen's shapes, are tablet sizes too.
  for (const [width, height] of [[1600, 2560], [2560, 1600], [1200, 1920]]) {
    assert.equal(isPlayFoldableSize(width, height), false);
    const slot = suggestPlayImageType(width, height);
    assert.equal(validatePlayImage(width, height, slot), null, `${width}x${height} still goes in ${slot}`);
  }
  // The fixed slots keep their own wording.
  assert.equal(validatePlayImage(INNER.width, INNER.height, 'featureGraphic'), 'Feature graphic has to be exactly 1024x500');
});

test('Play takes a long side up to 2.3 times the short side, so 20:9 phones and the iPhone canvas fit', () => {
  const tooLong = 'Play needs the long side to be at most 2.3 times the short side';
  assert.equal(validatePlayImage(1080, 2400, 'phoneScreenshots'), null, '20:9');
  assert.equal(validatePlayImage(1080, 2484, 'phoneScreenshots'), null, 'exactly 2.3');
  assert.equal(validatePlayImage(1080, 2485, 'phoneScreenshots'), tooLong);
  assert.equal(validatePlayImage(2484, 1080, 'phoneScreenshots'), null, 'exactly 2.3, landscape');
  assert.equal(validatePlayImage(2485, 1080, 'phoneScreenshots'), tooLong);
  assert.equal(validatePlayImage(1000, 2300, 'sevenInchScreenshots'), null);
  assert.equal(validatePlayImage(1000, 2301, 'sevenInchScreenshots'), tooLong);
  assert.equal(validatePlayImage(1206, 2622, 'phoneScreenshots'), null, 'the iPhone canvas is 2.17:1');
  assert.equal(validatePlayImage(1080, 1920, 'phoneScreenshots'), null);
  assert.equal(validatePlayImage(319, 600, 'phoneScreenshots'), 'Play needs every side to be at least 320 px');
  assert.equal(validatePlayImage(1700, 3841, 'phoneScreenshots'), 'Play needs every side to be at most 3840 px');
});

test('each Google Play canvas size starts in the slot it is named for', () => {
  const slotFor: Record<string, string> = {
    'play-phone': 'phoneScreenshots',
    'play-phone-tall': 'phoneScreenshots',
    'play-phone-landscape': 'phoneScreenshots',
    'play-7': 'sevenInchScreenshots',
    'play-10': 'tenInchScreenshots',
    'play-10-hd': 'tenInchScreenshots',
    'play-tablet-landscape': 'tenInchScreenshots',
    'play-feature-graphic': 'featureGraphic',
    'app-icon': 'icon',
  };
  const play = CANVAS_SIZE_PRESET_GROUPS.filter((group) => group.key === 'play-phone' || group.key === 'play-tablet').flatMap((group) => group.presets);
  assert.deepEqual(play.map((preset) => preset.id).sort(), Object.keys(slotFor).filter((id) => id.startsWith('play-') && id !== 'play-feature-graphic').sort(), 'a new Play preset gets a slot here');
  for (const [id, slot] of Object.entries(slotFor)) {
    const preset = ALL_CANVAS_SIZE_PRESETS.find((entry) => entry.id === id);
    assert.ok(preset, id);
    assert.equal(suggestPlayImageType(preset.width, preset.height), slot, `${id} ${preset.width}x${preset.height}`);
    assert.equal(validatePlayImage(preset.width, preset.height, slot), null, `${id} fits ${slot}`);
  }
});

test('a phone shot longer than 16:9 starts in the phone slot, held either way', () => {
  // Before, 1080 x 2400 started in the 10-inch tablet slot and 2400 x 1080 in the TV one.
  for (const [width, height] of [[1080, 2400], [2400, 1080], [1080, 2160], [2160, 1080], [1206, 2622], [2622, 1206], [1080, 2484], [1440, 3200]]) {
    assert.equal(suggestPlayImageType(width, height), 'phoneScreenshots', `${width}x${height}`);
  }
  // 16:9 held sideways is a landscape game's phone shot; only a 4K one is a TV's.
  assert.equal(suggestPlayImageType(1920, 1080), 'phoneScreenshots');
  assert.equal(suggestPlayImageType(3840, 2160), 'tvScreenshots');
  // Tablet shapes held sideways are tablet shots, not TV ones.
  assert.equal(suggestPlayImageType(2560, 1600), 'tenInchScreenshots');
  assert.equal(suggestPlayImageType(1920, 1200), 'sevenInchScreenshots');
  assert.equal(suggestPlayImageType(1800, 1800), 'tenInchScreenshots');
});

test('Wear OS takes only squares of 384 px and up, and Android TV keeps the 2:1 limit', () => {
  assert.equal(validatePlayImage(384, 840, 'wearScreenshots'), 'Wear OS screenshots have to be square');
  assert.equal(validatePlayImage(450, 451, 'wearScreenshots'), 'Wear OS screenshots have to be square');
  assert.equal(validatePlayImage(383, 383, 'wearScreenshots'), 'Wear OS screenshots have to be at least 384x384');
  assert.equal(validatePlayImage(384, 384, 'wearScreenshots'), null);
  assert.equal(validatePlayImage(1800, 1800, 'wearScreenshots'), null);
  assert.equal(suggestPlayImageType(384, 384), 'wearScreenshots');
  assert.equal(suggestPlayImageType(454, 454), 'wearScreenshots');
  // A small screenshot that is not square was offered Wear OS before; it fits the phone slot.
  assert.equal(suggestPlayImageType(400, 600), 'phoneScreenshots');
  assert.equal(suggestPlayImageType(383, 383), 'phoneScreenshots');

  const twice = 'Play needs the long side to be at most twice the short side';
  assert.equal(validatePlayImage(2400, 1080, 'tvScreenshots'), twice);
  assert.equal(validatePlayImage(2161, 1080, 'tvScreenshots'), twice);
  assert.equal(validatePlayImage(2160, 1080, 'tvScreenshots'), null);
  assert.equal(validatePlayImage(1920, 1080, 'tvScreenshots'), null);
  // Phones and tablets have the 2.3 limit.
  assert.equal(validatePlayImage(2400, 1080, 'phoneScreenshots'), null);
  assert.equal(validatePlayImage(2400, 1080, 'tenInchScreenshots'), null);
});

test('every size Play takes as a phone shot starts in a slot that takes it', () => {
  const sides = [320, 383, 384, 400, 454, 600, 601, 720, 1080, 1199, 1200, 1260, 1439, 1440, 1600, 1920, 2016, 2106, 2160, 2400, 2484, 2560, 2688, 3200, 3840];
  let checked = 0;
  for (const width of sides) {
    for (const height of sides) {
      if (validatePlayImage(width, height, 'phoneScreenshots') !== null) continue;
      const slot = suggestPlayImageType(width, height);
      assert.equal(validatePlayImage(width, height, slot), null, `${width}x${height} starts in ${slot}, which refuses it`);
      checked += 1;
    }
  }
  assert.ok(checked > 300, `${checked} sizes`);
});

test('osg verify warns about a foldable shot and leaves it out of the set counts', () => {
  const play = rulesetFor('play');
  for (const size of PLAY_FOLDABLE_SIZES) {
    const png = { ...size, bitDepth: 8, colorType: 2, hasAlpha: false, interlace: 0, bytes: 1_000_000 };
    const findings = checkPng(png, play);
    const sizeFinding = findings.find((finding) => finding.code.startsWith('png-size'));
    assert.equal(sizeFinding?.code, 'png-size-play-console-only');
    assert.equal(sizeFinding?.level, 'warn');
    assert.equal(findings.some((finding) => finding.level === 'fail'), false, JSON.stringify(findings));
    assert.equal(isPlayConsoleOnlyArt(size.width, size.height, play), true);
    // Apple's rules know nothing of Play's foldables.
    assert.equal(isPlayConsoleOnlyArt(size.width, size.height, rulesetFor('appstore')), false);
  }
  assert.equal(isPlayConsoleOnlyArt(1600, 2560, play), false);
  const phone = checkPng({ width: 1080, height: 2400, bitDepth: 8, colorType: 2, hasAlpha: false, interlace: 0, bytes: 1_000_000 }, play);
  assert.equal(phone.some((finding) => finding.level !== 'ok'), false, JSON.stringify(phone));
});

test('an upload of foldable shots stops before signing in to Google, and says where they go', async () => {
  const image = { artboardId: 'fold', fileName: 'fold.png', bytes: new Uint8Array(8), ...INNER };
  await assert.rejects(
    uploadPlayScreenshotsForLanguages(
      { serviceAccountJson: '{}', packageName: 'com.example.fold' },
      { entries: [{ language: 'en-US', imageType: 'tenInchScreenshots', images: [image] }], replaceExisting: true }
    ),
    (error: unknown) => {
      assert.ok(error instanceof StoreRejectedError);
      assert.equal(error.message, `fold.png skipped: ${PLAY_FOLDABLE_PROBLEM}`);
      return true;
    }
  );
});
