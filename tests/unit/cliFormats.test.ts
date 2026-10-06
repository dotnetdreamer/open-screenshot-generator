import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EXIT, OsgError } from '../../cli/src/errors';
import { isCanvasFormat, resolveDeviceFormat } from '../../cli/src/formats';
import { DEVICE_FORMAT_PRESETS } from '@/lib/deviceRegistry';
import { ALL_CANVAS_SIZE_PRESETS } from '@/lib/sizePresets';

function dimensions(id: string): { width: number; height: number } | undefined {
  const format = resolveDeviceFormat(id);
  return DEVICE_FORMAT_PRESETS.find((preset) => preset.id === format)?.artboard;
}

test('the iPhone aliases resolve to the required medium display dimensions', () => {
  for (const id of ['ios-6-3', 'ios', 'iphone', ' IOS-6-3 ']) {
    assert.equal(resolveDeviceFormat(id), 'ios');
    assert.deepEqual(dimensions(id), { width: 1206, height: 2622 });
    assert.equal(isCanvasFormat(id), false);
  }
});

test('the explicit legacy iPhone size keeps the large display dimensions', () => {
  for (const id of ['ios-6-9', 'ios-large', ' IOS-6-9 ']) {
    assert.equal(resolveDeviceFormat(id), 'ios-large');
    assert.deepEqual(dimensions(id), { width: 1290, height: 2796 });
    assert.equal(isCanvasFormat(id), false);
  }
});

test('canvas aliases keep the current boards without selecting a generated size', () => {
  for (const id of ['as-is', 'asis', 'canvas', 'current', 'none', ' AS-IS ', ' Canvas ']) {
    assert.equal(isCanvasFormat(id), true);
    assert.equal(resolveDeviceFormat(id), null);
  }
});

test('unknown and inherited object names fail as CLI usage errors', () => {
  for (const id of ['unknown', '', 'ios-6-1-landscape', 'constructor', 'toString', '__proto__']) {
    assert.equal(isCanvasFormat(id), false);
    assert.throws(
      () => resolveDeviceFormat(id),
      (error: unknown) => error instanceof OsgError && error.code === EXIT.usage
    );
  }
});

test('a canvas preset id converts at exactly that preset\'s size', () => {
  const convertible = ALL_CANVAS_SIZE_PRESETS.filter((preset) => {
    try {
      return resolveDeviceFormat(preset.id) !== null;
    } catch {
      return false;
    }
  });
  assert.ok(convertible.some((preset) => preset.id === 'ios-6-3'));
  for (const preset of convertible) {
    assert.deepEqual(dimensions(preset.id), { width: preset.width, height: preset.height }, preset.id);
  }
});
