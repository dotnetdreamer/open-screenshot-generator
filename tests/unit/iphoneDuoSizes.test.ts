// The iPhone Duo's App Store screenshot sizes: intake puts screenshots at them
// in the Duo, the canvas offers them, and publishing and `osg verify` say they
// have to wait for App Store Connect instead of calling them wrong.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectDevice } from '@/lib/intake/screenshotAnalysis';
import { canvasSizeSlug, findMatchingPreset } from '@/lib/sizePresets';
import { appleDisplayAwaitingUpload, appleTargetForSize, missesRequiredIphoneSlot } from '@/lib/publish/storeTargets';
import { checkPng, rulesetFor } from '../../cli/src/verify/rules';

const INNER = { width: 2007, height: 2853 };
const OUTER = { width: 1398, height: 2034 };
const turned = ({ width, height }: { width: number; height: number }) => ({ width: height, height: width });

test("screenshots at the iPhone Duo's sizes go in the iPhone Duo, either way up", () => {
  for (const size of [INNER, OUTER]) {
    assert.deepEqual(detectDevice(size.width, size.height), { device: 'iphone-duo', confidence: 1 });
    const side = turned(size);
    assert.deepEqual(detectDevice(side.width, side.height), { device: 'iphone-duo', confidence: 0.9 });
  }
});

test('the canvas offers both Duo displays both ways up, and exports name them', () => {
  assert.equal(findMatchingPreset(INNER)?.id, 'ios-duo-inner');
  assert.equal(findMatchingPreset(OUTER)?.id, 'ios-duo-outer');
  assert.equal(findMatchingPreset(turned(INNER))?.id, 'ios-duo-inner-landscape');
  assert.equal(findMatchingPreset(turned(OUTER))?.id, 'ios-duo-outer-landscape');
  assert.equal(canvasSizeSlug(INNER), 'iPhone-Duo-inner-display-Portrait_2007x2853');
});

test('Duo sizes wait for an App Store Connect slot instead of failing as wrong sizes', () => {
  for (const size of [INNER, OUTER, turned(INNER), turned(OUTER)]) {
    assert.equal(appleTargetForSize(size.width, size.height), null, 'there is no display type to upload them to');
    assert.equal(appleDisplayAwaitingUpload(size.width, size.height)?.label, 'iPhone Duo');
  }
  assert.equal(appleDisplayAwaitingUpload(1206, 2622), null);
  // Not an iPhone upload, so a Duo board neither fills nor misses the required iPhone set.
  assert.equal(missesRequiredIphoneSlot([INNER]), false);

  const png = { ...INNER, bitDepth: 8, colorType: 2, hasAlpha: false, interlace: 0, bytes: 1_000_000 };
  const findings = checkPng(png, rulesetFor('appstore'));
  const sizeFinding = findings.find((finding) => finding.code.startsWith('png-size'));
  assert.equal(sizeFinding?.code, 'png-size-awaiting-upload');
  assert.equal(sizeFinding?.level, 'warn');
  assert.equal(findings.some((finding) => finding.level === 'fail'), false, JSON.stringify(findings));
});
