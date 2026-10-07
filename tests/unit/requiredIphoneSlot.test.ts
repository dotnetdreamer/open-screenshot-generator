import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultAppStoreUploadSize, missesRequiredIphoneSlot } from '@/lib/publish/storeTargets';
import { checkRequiredIphoneSlot, rulesetFor } from '../../cli/src/verify/rules';

const LARGE = { width: 1290, height: 2796 };
const MEDIUM = { width: 1206, height: 2622 };

test('a set has the required iPhone size when any shot is at a medium display size, either way round', () => {
  assert.equal(missesRequiredIphoneSlot([MEDIUM]), false);
  assert.equal(missesRequiredIphoneSlot([{ width: 1179, height: 2556 }]), false);
  assert.equal(missesRequiredIphoneSlot([{ width: 2622, height: 1206 }]), false);
  assert.equal(missesRequiredIphoneSlot([LARGE, MEDIUM]), false);
});

test('iPhone shots at an optional size only miss the required iPhone size', () => {
  assert.equal(missesRequiredIphoneSlot([LARGE]), true);
  assert.equal(missesRequiredIphoneSlot([{ width: 1242, height: 2688 }]), true);
  assert.equal(missesRequiredIphoneSlot([LARGE, { width: 2064, height: 2752 }]), true);
});

test('a set with no iPhone shots has nothing to miss', () => {
  assert.equal(missesRequiredIphoneSlot([]), false);
  assert.equal(missesRequiredIphoneSlot([{ width: 2064, height: 2752 }]), false);
  assert.equal(missesRequiredIphoneSlot([{ width: 1080, height: 1920 }]), false);
});

test('an App Store upload of iPhone boards at an optional size starts on the required size', () => {
  assert.equal(defaultAppStoreUploadSize([LARGE], 'ios-large'), 'ios');
  assert.equal(defaultAppStoreUploadSize([LARGE], 'ios'), 'ios');
  assert.equal(defaultAppStoreUploadSize([LARGE], null), 'ios');
  assert.equal(defaultAppStoreUploadSize([MEDIUM], 'ios'), 'current');
  assert.equal(defaultAppStoreUploadSize([LARGE], 'android'), 'current');
  assert.equal(defaultAppStoreUploadSize([LARGE], 'mixed'), 'current');
  assert.equal(defaultAppStoreUploadSize([{ width: 2064, height: 2752 }], 'ipad-pro-13'), 'current');
});

test('verify warns about a listing with no required iPhone size, and only for the App Store', () => {
  const findings = checkRequiredIphoneSlot([LARGE], rulesetFor('appstore'));
  assert.equal(findings.length, 1);
  assert.equal(findings[0].level, 'warn');
  assert.equal(findings[0].code, 'set-required-iphone-missing');
  assert.match(findings[0].message, /ios-6-3/);
  assert.deepEqual(checkRequiredIphoneSlot([LARGE, MEDIUM], rulesetFor('appstore')), []);
  assert.deepEqual(checkRequiredIphoneSlot([LARGE], rulesetFor('play')), []);
});
