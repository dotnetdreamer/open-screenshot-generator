// Google Play's foldable screenshots: the canvas offers them at the sizes
// Google's capture guide makes, nothing puts them in an API slot (Play
// Console is the only way in), and `osg verify` warns instead of failing them.
// Play's phone and tablet limit, a long side up to 2.3 times the short one, is
// pinned here too, since the same check refuses the foldables.

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

test('osg verify warns about a foldable shot and leaves it out of the per-size counts', () => {
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
