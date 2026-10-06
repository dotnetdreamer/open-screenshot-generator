import { test } from 'node:test';
import assert from 'node:assert/strict';
import { convertArtboardsToFormat, DEVICE_FORMAT_PRESETS } from '@/lib/deviceRegistry';
import { suggestedFormat } from '@/lib/intake/autoFill';
import type { ArtboardState, DeviceFrameElementProps, DeviceType, Project } from '@/types/artboard';

function board(deviceType: DeviceType, width: number, height: number): ArtboardState {
  return {
    id: 'board-1',
    name: 'Hero',
    position: { x: 0, y: 0 },
    size: { width, height },
    backgroundColor: '#ffffff',
    zoom: 1,
    elements: [{
      id: 'phone-1',
      type: 'device',
      deviceType,
      position: { x: 180, y: 300 },
      size: { width: 600, height: 1300 },
      scale: 0.8,
      rotation: 12,
      screenshotSrc: 'asset:user-screenshot',
      screenshotObjectFit: 'contain',
      screenshotRect: { left: 3, top: 4, width: 91, height: 89 },
      naturalScreenshotWidth: 1080,
      naturalScreenshotHeight: 2400,
    }],
  };
}

test('large and medium iPhone conversions preserve an existing iPhone and its screenshot without mutating the source', () => {
  const source = [board('iphone-15-pro', 1080, 2400)];
  const original = structuredClone(source);
  const phone = source[0].elements[0] as DeviceFrameElementProps;
  for (const [format, width, height] of [
    ['ios', 1206, 2622],
    ['ios-large', 1290, 2796],
  ] as const) {
    const preset = DEVICE_FORMAT_PRESETS.find((entry) => entry.id === format)!;
    const result = convertArtboardsToFormat(source, preset);
    assert.deepEqual(result.artboards[0].size, { width, height });
    assert.equal(result.resized, 1);
    assert.equal(result.swapped, 0);
    assert.equal(result.skipped, 0);
    const converted = result.artboards[0].elements[0] as DeviceFrameElementProps;
    assert.equal(converted.deviceType, phone.deviceType);
    assert.equal(converted.screenshotSrc, phone.screenshotSrc);
    assert.equal(converted.screenshotObjectFit, phone.screenshotObjectFit);
    assert.deepEqual(converted.screenshotRect, phone.screenshotRect);
    assert.equal(converted.naturalScreenshotWidth, phone.naturalScreenshotWidth);
    assert.equal(converted.naturalScreenshotHeight, phone.naturalScreenshotHeight);
    assert.equal(converted.rotation, phone.rotation);
    assert.deepEqual(converted.size, phone.size);
    const factor = Math.min(width / source[0].size.width, height / source[0].size.height);
    assert.equal(converted.scale, phone.scale * factor);
    assert.deepEqual(converted.position, {
      x: phone.position.x * factor + (width - source[0].size.width * factor) / 2,
      y: phone.position.y * factor + (height - source[0].size.height * factor) / 2,
    });
  }
  assert.deepEqual(source, original);
});

test('the large iPhone format swaps an Android phone to iOS while preserving its screenshot', () => {
  const source = [board('android-punch-hole', 1080, 2400)];
  const original = structuredClone(source);
  const phone = source[0].elements[0] as DeviceFrameElementProps;
  const preset = DEVICE_FORMAT_PRESETS.find((entry) => entry.id === 'ios-large')!;
  const result = convertArtboardsToFormat(source, preset);
  assert.deepEqual(result.artboards[0].size, { width: 1290, height: 2796 });
  assert.equal(result.resized, 1);
  assert.equal(result.swapped, 1);
  assert.equal(result.skipped, 0);
  const converted = result.artboards[0].elements[0] as DeviceFrameElementProps;
  assert.equal(converted.deviceType, 'iphone-15');
  assert.equal(converted.screenshotSrc, phone.screenshotSrc);
  assert.equal(converted.screenshotObjectFit, phone.screenshotObjectFit);
  assert.deepEqual(converted.screenshotRect, phone.screenshotRect);
  assert.deepEqual(converted.size, phone.size);
  assert.deepEqual(source, original);
});

function template(deviceType: DeviceType, width: number, height: number): Project {
  return { id: 'template', name: 'Template', timestamp: new Date(0), projectData: [board(deviceType, width, height)] };
}

test('iPhone screenshots leave an iPhone template at either iPhone size alone', () => {
  for (const [width, height] of [[1290, 2796], [1206, 2622]] as const) {
    assert.equal(suggestedFormat(template('iphone-17-pro-max', width, height), 'iphone-15'), null);
  }
});

test('iPhone screenshots convert an Android template to the required iPhone size', () => {
  const preset = suggestedFormat(template('android-punch-hole', 1080, 1920), 'iphone-15');
  assert.equal(preset?.id, 'ios');
  assert.deepEqual(preset?.artboard, { width: 1206, height: 2622 });
});
