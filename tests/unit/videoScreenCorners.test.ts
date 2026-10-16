import assert from 'node:assert/strict';
import test from 'node:test';
import { DEVICE_REGISTRY } from '@/lib/deviceRegistry';
import { deviceScreenRectLocal, drawFitted, roundRectPath } from '@/lib/video/videoExport';
import type { VideoDeviceElementProps } from '@/types/artboard';

function device(deviceType: VideoDeviceElementProps['deviceType'], scale = 1): VideoDeviceElementProps {
  return {
    id: 'recording',
    type: 'video-device',
    deviceType,
    position: { x: 0, y: 0 },
    size: { width: 767, height: 1580 },
    scale,
    rotation: 0,
  };
}

function drawingContext(native = true) {
  const calls: { name: string; args: unknown[] }[] = [];
  const methods: Record<string, (...args: unknown[]) => void> = {};
  for (const name of ['beginPath', 'moveTo', 'arcTo', 'closePath', 'save', 'clip', 'drawImage', 'restore']) {
    methods[name] = (...args) => { calls.push({ name, args }); };
  }
  if (native) methods.roundRect = (...args) => { calls.push({ name: 'roundRect', args }); };
  return { ctx: methods as unknown as CanvasRenderingContext2D, calls };
}

test('Pixel 3 XL recording export keeps its smaller bottom screen corners at every scale', () => {
  for (const scale of [0.5, 1, 2]) {
    const screen = deviceScreenRectLocal(device('pixel-3-xl', scale));
    assert.ok(Math.abs(screen.radius - 54.1 * scale) < 1e-9);
    assert.ok(Math.abs(screen.radiusBottom! - 28 * scale) < 1e-9);
    assert.ok(Math.abs(screen.width - 702.3 * scale) < 1e-9);
    assert.ok(Math.abs(screen.height - 1442 * scale) < 1e-9);
  }
});

test('devices with matching screen corners retain their single-radius geometry', () => {
  for (const descriptor of Object.values(DEVICE_REGISTRY)) {
    if (!descriptor.screen || descriptor.id === 'pixel-3-xl') continue;
    const screen = deviceScreenRectLocal(device(descriptor.id));
    assert.equal(screen.radius, 767 * descriptor.screen.radiusFactor, descriptor.id);
    assert.equal(Object.hasOwn(screen, 'radiusBottom'), false, descriptor.id);
  }
});

test('native canvas clipping uses top and bottom screen radii in corner order', () => {
  const { ctx, calls } = drawingContext();
  roundRectPath(ctx, 10, 20, 702.3, 1442, 54.1, 28);
  assert.deepEqual(calls, [
    { name: 'beginPath', args: [] },
    { name: 'roundRect', args: [10, 20, 702.3, 1442, [54.1, 54.1, 28, 28]] },
  ]);
  const uniform = drawingContext();
  roundRectPath(uniform.ctx, 10, 20, 30, 100, 40);
  assert.deepEqual(uniform.calls[1].args, [10, 20, 30, 100, 15]);
});

test('canvas clipping without roundRect keeps the same asymmetric corners', () => {
  const { ctx, calls } = drawingContext(false);
  roundRectPath(ctx, 10, 20, 702.3, 1442, 54.1, 28);
  assert.deepEqual(calls.filter((call) => call.name === 'arcTo').map((call) => call.args[4]), [54.1, 28, 28, 54.1]);
  assert.equal(calls.at(-1)?.name, 'closePath');
});

test('short asymmetric screens normalize adjacent corner sums like CSS in both canvas paths', () => {
  const cases = [
    { width: 702.3, height: 100, top: 54.1, bottom: 28 },
    { width: 702.3, height: 60, top: 54.1 * 60 / 82.1, bottom: 28 * 60 / 82.1 },
    { width: 60, height: 100, top: 30, bottom: 28 * 60 / 108.2 },
  ];
  for (const native of [true, false]) {
    for (const expected of cases) {
      const { ctx, calls } = drawingContext(native);
      roundRectPath(ctx, 10, 20, expected.width, expected.height, 54.1, 28);
      const radii = native
        ? calls.find((call) => call.name === 'roundRect')!.args[4] as number[]
        : calls.filter((call) => call.name === 'arcTo').map((call) => call.args[4]) as number[];
      const ordered = native
        ? [expected.top, expected.top, expected.bottom, expected.bottom]
        : [expected.top, expected.bottom, expected.bottom, expected.top];
      for (let i = 0; i < 4; i++) assert.ok(Math.abs(radii[i] - ordered[i]) < 1e-9);
    }
  }
});

test('fitted recording pixels use both radii from the device screen geometry', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'HTMLVideoElement');
  Object.defineProperty(globalThis, 'HTMLVideoElement', { value: class {}, configurable: true });
  try {
    const screen = deviceScreenRectLocal(device('pixel-3-xl'));
    const { ctx, calls } = drawingContext();
    const image = { naturalWidth: 702.3, naturalHeight: 1442 } as HTMLImageElement;
    drawFitted(ctx, image, screen.x, screen.y, screen.width, screen.height, 'fill', screen.radius, screen.radiusBottom);
    const radii = calls.find((call) => call.name === 'roundRect')!.args[4] as number[];
    assert.ok(Math.abs(radii[0] - 54.1) < 1e-9);
    assert.ok(Math.abs(radii[2] - 28) < 1e-9);
    assert.ok(calls.findIndex((call) => call.name === 'clip') < calls.findIndex((call) => call.name === 'drawImage'));
    assert.equal(calls.at(-1)?.name, 'restore');
  } finally {
    if (previous) Object.defineProperty(globalThis, 'HTMLVideoElement', previous);
    else Reflect.deleteProperty(globalThis, 'HTMLVideoElement');
  }
});
