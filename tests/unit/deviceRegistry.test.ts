import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  convertArtboardsToFormat,
  DEVICE_FORMAT_PRESETS,
  getDeviceDescriptor,
  getDeviceScreenRect,
  layersLeftBehind,
  picturesHolding,
  swapDeviceInElements,
} from '@/lib/deviceRegistry';
import { suggestedFormat } from '@/lib/intake/autoFill';
import type {
  ArtboardElement,
  ArtboardState,
  DeviceFrameElementProps,
  DeviceType,
  Project,
  ShapeElementProps,
} from '@/types/artboard';

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

// --- what is drawn to a frame's measure, when the frame becomes another kind ---

const PHONE = { x: 200, y: 300, width: 520, height: 1089 };

function heldPhone(rotation = 0): DeviceFrameElementProps {
  return {
    id: 'phone',
    type: 'device',
    deviceType: 'iphone-15-pro',
    position: { x: PHONE.x, y: PHONE.y },
    size: { width: PHONE.width, height: PHONE.height },
    scale: 1,
    rotation,
    groupId: 'held',
    screenshotSrc: '/data/projects/app-screens/app-list-light.png',
  };
}

function rectangle(id: string, x: number, y: number, width: number, height: number, extra: Partial<ShapeElementProps> = {}): ShapeElementProps {
  return {
    id,
    type: 'shape',
    shapeType: 'rectangle',
    position: { x, y },
    size: { width, height },
    rotation: 0,
    scale: 1,
    fillColor: '#4d4660',
    strokeColor: 'transparent',
    strokeWidth: 0,
    ...extra,
  };
}

function picture(id: string, x: number, y: number, width: number, height: number, groupId?: string): ArtboardElement {
  return { id, type: 'image', imageSrc: `/elements/images/${id}.png`, position: { x, y }, size: { width, height }, rotation: 0, scale: 1, groupId } as ArtboardElement;
}

const centreOf = (el: ArtboardElement) => ({
  x: el.position.x + (el.size.width * (el.scale || 1)) / 2,
  y: el.position.y + (el.size.height * (el.scale || 1)) / 2,
});
const byId = (elements: ArtboardElement[], id: string) => elements.find((el) => el.id === id)!;

test('a hand is the pictures grouped with a phone that lie across it, not a badge and not what is on its screen', () => {
  const device = heldPhone();
  const screen = getDeviceScreenRect(device)!;
  const elements: ArtboardElement[] = [
    // Drawn in two layers: the palm behind the phone, the fingers in front.
    picture('palm', 120, 700, 715, 988, 'held'),
    device,
    picture('fingers', 130, 720, 688, 544, 'held'),
    picture('badge', 640, 250, 130, 130, 'held'),
    picture('on-screen', screen.x, screen.y, screen.width, screen.height, 'held'),
    // The same palm in no group: nothing says it belongs to this phone.
    picture('palm-apart', 120, 700, 715, 988),
    rectangle('edge', PHONE.x - 5, PHONE.y - 5, PHONE.width + 10, PHONE.height + 10, { groupId: 'held', borderRadius: 78 }),
  ];
  assert.deepEqual(picturesHolding(elements, device).map((el) => el.id), ['palm', 'fingers']);

  // Another phone has the same box, so the hand still fits it.
  assert.deepEqual([...layersLeftBehind(elements, device, 'android-punch-hole')], []);
  // An iPad: the hand goes, and the swap itself draws the edge round the iPad.
  assert.deepEqual([...layersLeftBehind(elements, device, 'ipad-pro-13')], ['palm', 'fingers']);
  // A MacBook: there is no slab to draw the edge round either.
  assert.deepEqual([...layersLeftBehind(elements, device, 'macbook')].sort(), ['edge', 'fingers', 'palm']);
});

test('a swap to another kind of frame draws a rim, a case and a shadow round the new frame', () => {
  for (const turn of [0, -9]) {
    const corner = getDeviceDescriptor('iphone-15-pro').bodyRadiusFactor! * PHONE.width;
    // Drawn upright round the phone, then the whole piece is turned about the
    // phone's centre, the way a tilted mockup is built: every layer turns
    // about its own centre, so the centres are what have to swing round.
    const upright: ArtboardElement[] = [
      // A hard shadow: the phone's own size, pushed down and to the right.
      rectangle('shadow', PHONE.x + 24, PHONE.y + 30, PHONE.width, PHONE.height, { borderRadius: corner }),
      // A case that hugs three sides and runs on far past the bottom.
      rectangle('case', PHONE.x - 20, PHONE.y - 20, PHONE.width + 40, PHONE.height + 420, { borderRadius: corner + 20 }),
      rectangle('edge', PHONE.x - 5, PHONE.y - 5, PHONE.width + 10, PHONE.height + 10, { borderRadius: corner + 5 }),
      heldPhone(),
      // A card that only overlaps the phone.
      rectangle('card', PHONE.x + 300, PHONE.y + 500, 400, 260),
    ];
    const pivot = centreOf(heldPhone());
    const angle = (turn * Math.PI) / 180;
    const elements: ArtboardElement[] = upright.map((el) => {
      const from = centreOf(el);
      const dx = from.x - pivot.x;
      const dy = from.y - pivot.y;
      const cx = pivot.x + dx * Math.cos(angle) - dy * Math.sin(angle);
      const cy = pivot.y + dx * Math.sin(angle) + dy * Math.cos(angle);
      return { ...el, rotation: turn, position: { x: cx - el.size.width / 2, y: cy - el.size.height / 2 } } as ArtboardElement;
    });
    // The edge again, turned another way than the phone: not drawn round it.
    elements.push(rectangle('askew', PHONE.x - 5, PHONE.y - 5, PHONE.width + 10, PHONE.height + 10, { rotation: turn + 20 }));
    const device = byId(elements, 'phone') as DeviceFrameElementProps;
    const swapped = swapDeviceInElements(elements, 'phone', 'ipad-pro-13')!;
    const ipad = byId(swapped, 'phone') as DeviceFrameElementProps;
    assert.equal(ipad.deviceType, 'ipad-pro-13');
    assert.ok(ipad.size.width > PHONE.width && ipad.size.height < PHONE.height, 'an iPad is wider and shorter');
    const middle = centreOf(ipad);

    const edge = byId(swapped, 'edge') as ShapeElementProps;
    assert.ok(Math.abs(edge.size.width - (ipad.size.width + 10)) < 0.01 && Math.abs(edge.size.height - (ipad.size.height + 10)) < 0.01, `turn ${turn}: the edge is 5 wider all round`);
    assert.ok(Math.abs(centreOf(edge).x - middle.x) < 0.01 && Math.abs(centreOf(edge).y - middle.y) < 0.01, `turn ${turn}: the edge shares the frame's centre`);
    const ipadCorner = getDeviceDescriptor('ipad-pro-13').bodyRadiusFactor! * ipad.size.width;
    assert.ok(Math.abs((edge.borderRadius as number) - (ipadCorner + 5)) < 0.1, `turn ${turn}: corner ${edge.borderRadius}, the iPad's is ${ipadCorner}`);

    // The shadow is the frame's size and as far from its centre as it was.
    const shadow = byId(swapped, 'shadow') as ShapeElementProps;
    assert.ok(Math.abs(shadow.size.width - ipad.size.width) < 0.01 && Math.abs(shadow.size.height - ipad.size.height) < 0.01);
    const before = centreOf(byId(elements, 'shadow'));
    const was = centreOf(device);
    assert.ok(Math.abs(centreOf(shadow).x - middle.x - (before.x - was.x)) < 0.01 && Math.abs(centreOf(shadow).y - middle.y - (before.y - was.y)) < 0.01, `turn ${turn}: the shadow keeps its offset`);

    // The case keeps 20 on three sides and its long run past the bottom.
    const cover = byId(swapped, 'case') as ShapeElementProps;
    assert.ok(Math.abs(cover.size.width - (ipad.size.width + 40)) < 0.01 && Math.abs(cover.size.height - (ipad.size.height + 420)) < 0.01);

    // What was not drawn round the frame is the same object as before.
    assert.equal(byId(swapped, 'card'), byId(elements, 'card'));
    assert.equal(byId(swapped, 'askew'), byId(elements, 'askew'));

    // Another phone keeps the box, so nothing is redrawn. A MacBook is not a
    // slab: the rectangles stay as the person drew them.
    for (const target of ['android-punch-hole', 'macbook'] as DeviceType[]) {
      const other = swapDeviceInElements(elements, 'phone', target)!;
      for (const id of ['shadow', 'case', 'edge']) assert.equal(byId(other, id), byId(elements, id), `${target}: ${id}`);
    }
  }
});

test('converting to a tablet format leaves the hand out and draws the rim round the tablet', () => {
  const source: ArtboardState = {
    id: 'board-1',
    name: 'Hero',
    position: { x: 0, y: 0 },
    size: { width: 1206, height: 2622 },
    backgroundColor: '#ffffff',
    zoom: 1,
    elements: [
      picture('hand', 60, 500, 1500, 2100, 'held'),
      rectangle('edge', PHONE.x - 5, PHONE.y - 5, PHONE.width + 10, PHONE.height + 10, { groupId: 'held', borderRadius: 78 }),
      heldPhone(),
      picture('badge', 640, 250, 130, 130, 'held'),
    ],
  };
  const original = structuredClone(source);
  const preset = DEVICE_FORMAT_PRESETS.find((entry) => entry.id === 'ipad-pro-13')!;
  const result = convertArtboardsToFormat([source], preset);
  const elements = result.artboards[0].elements;
  assert.deepEqual(elements.map((el) => el.id), ['edge', 'phone', 'badge']);
  assert.equal(result.swapped, 1);
  const ipad = byId(elements, 'phone') as DeviceFrameElementProps;
  const edge = byId(elements, 'edge');
  assert.equal(ipad.deviceType, 'ipad-pro-13');
  const scale = ipad.scale || 1;
  // 5 round the phone in the design is 5 round the iPad, at the artboard's new scale.
  assert.ok(Math.abs(ipad.position.x - edge.position.x - 5 * scale) < 0.01, 'the edge is 5 out on the left');
  assert.ok(Math.abs(ipad.position.y - edge.position.y - 5 * scale) < 0.01, 'and 5 out on top');
  assert.ok(Math.abs(edge.size.width - ipad.size.width - 10) < 0.01 && Math.abs(edge.size.height - ipad.size.height - 10) < 0.01);
  assert.deepEqual(source, original);

  // An Android phone format swaps the frame for another phone: the hand stays.
  const android = convertArtboardsToFormat([source], DEVICE_FORMAT_PRESETS.find((entry) => entry.id === 'android')!);
  assert.deepEqual(android.artboards[0].elements.map((el) => el.id), ['hand', 'edge', 'phone', 'badge']);
});
