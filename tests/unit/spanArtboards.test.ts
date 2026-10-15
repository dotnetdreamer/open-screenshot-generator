// Elements that continue across artboard edges: which artboards draw a copy,
// where the copy sits, how it stacks, and how a pointer over the canvas maps to
// artboard pixels with the gaps between artboards taken out.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NO_SPILL,
  artboardStripOffsets,
  computeSpill,
  paintLayers,
  paintRect,
  reachedArtboardIds,
  spanArtboardsByElement,
  spillFor,
  spansArtboards,
  stripPointFromClient,
} from '@/lib/spanArtboards';
import { POP_PEAK_SCALE, animationStateAt, slideDistanceFor } from '@/lib/video/animation';
import type {
  ArtboardElement,
  ArtboardState,
  DeviceFrameElementProps,
  ElementAnimationPreset,
  ImageElementProps,
  ShapeElementProps,
} from '@/types/artboard';

function board(id: string, elements: ArtboardElement[] = [], width = 1290, height = 2796): ArtboardState {
  return {
    id,
    name: id,
    position: { x: 0, y: 0 },
    size: { width, height },
    elements,
    backgroundColor: '#ffffff',
    zoom: 1,
  };
}

function phone(id: string, x: number, extra: Partial<DeviceFrameElementProps> = {}): DeviceFrameElementProps {
  return {
    id,
    type: 'device',
    deviceType: 'iphone-15-pro',
    position: { x, y: 800 },
    size: { width: 600, height: 1200 },
    rotation: 0,
    scale: 1,
    ...extra,
  };
}

test('an element without the flag never leaves its artboard, which keeps old projects as they were', () => {
  // A template phone hanging 300px off the right edge: before this feature it
  // was cut off, and it still has to be.
  const boards = [board('a', [phone('p', 990)]), board('b')];
  assert.equal(computeSpill(boards).size, 0);
  assert.equal(spillFor(computeSpill(boards), 'b'), NO_SPILL);
});

test('a flagged element over the right edge is drawn by the next artboard, shifted into its pixels', () => {
  const source = phone('p', 990, { spanArtboards: true });
  const boards = [board('a', [source]), board('b'), board('c')];
  const spill = computeSpill(boards);
  const onB = spillFor(spill, 'b');
  assert.equal(onB.front.length, 1);
  assert.equal(onB.behind.length, 0);
  const copy = onB.front[0];
  assert.equal(copy.element.position.x, 990 - 1290);
  assert.equal(copy.element.position.y, 800);
  assert.equal(copy.shiftX, -1290);
  assert.equal(copy.source, source);
  assert.equal(copy.sourceBoardId, 'a');
  // Nothing reaches the third artboard, and the source is untouched.
  assert.equal(spillFor(spill, 'c'), NO_SPILL);
  assert.equal(source.position.x, 990);
});

test('the left edge reaches the previous artboard', () => {
  const boards = [board('a'), board('b', [phone('p', -200, { spanArtboards: true })])];
  const copy = spillFor(computeSpill(boards), 'a').front[0];
  assert.equal(copy.element.position.x, -200 + 1290);
});

test('offsets add up the widths, so artboards of different sizes still line up', () => {
  assert.deepEqual(artboardStripOffsets([board('a', [], 1000), board('b', [], 600), board('c', [], 800)]), [0, 1000, 1600]);
  // 900..1500 on a 1000 wide artboard covers all of a 600 wide neighbour and
  // the start of the third.
  const element = phone('p', 900, { spanArtboards: true, size: { width: 800, height: 400 } });
  const spill = computeSpill([board('a', [element], 1000), board('b', [], 600), board('c', [], 800)]);
  assert.equal(spillFor(spill, 'b').front[0].element.position.x, -100);
  assert.equal(spillFor(spill, 'c').front[0].element.position.x, -700);
});

test('spanBehind puts the copy under the other artboard\'s own elements', () => {
  const boards = [board('a', [phone('p', 990, { spanArtboards: true, spanBehind: true })]), board('b')];
  const onB = spillFor(computeSpill(boards), 'b');
  assert.equal(onB.behind.length, 1);
  assert.equal(onB.front.length, 0);
});

test('an element inside its own artboard reaches nothing', () => {
  const boards = [board('a', [phone('p', 300, { spanArtboards: true })]), board('b')];
  assert.equal(computeSpill(boards).size, 0);
});

test('a shadow that crosses the edge counts, even when the box does not', () => {
  const near = phone('p', 680, {
    spanArtboards: true,
    shadow: { x: 40, y: 0, blur: 30, color: 'rgba(0,0,0,0.3)' },
  });
  // Box ends at 1280, ten short of the edge; the shadow reaches 1350.
  assert.equal(spillFor(computeSpill([board('a', [near]), board('b')]), 'b').front.length, 1);
});

test('rotation is measured by the box the element really covers', () => {
  // Upright it ends at 1250. Turned 90 degrees, the 1200 tall phone is 1200
  // wide about the same centre and reaches 1550.
  const upright = phone('p', 650, { spanArtboards: true });
  assert.equal(computeSpill([board('a', [upright]), board('b')]).size, 0);
  const turned = phone('p', 650, { spanArtboards: true, rotation: 90 });
  assert.equal(spillFor(computeSpill([board('a', [turned]), board('b')]), 'b').front.length, 1);
});

test('a shorter neighbour is not reached by something below its bottom edge', () => {
  const low = phone('p', 990, { spanArtboards: true, position: { x: 990, y: 2000 } });
  const spill = computeSpill([board('a', [low]), board('b', [], 1290, 1500)]);
  assert.equal(spill.size, 0);
});

test('a sound layer never spans and one artboard has nothing to span to', () => {
  const sound = {
    id: 's',
    type: 'audio',
    position: { x: 2000, y: 0 },
    size: { width: 10, height: 10 },
    rotation: 0,
    scale: 1,
    spanArtboards: true,
  } as ArtboardElement;
  assert.equal(spansArtboards(sound), false);
  assert.equal(computeSpill([board('a', [sound]), board('b')]).size, 0);
  assert.equal(computeSpill([board('a', [phone('p', 990, { spanArtboards: true })])]).size, 0);
});

test('an untouched element gets the same copy back, so its artboard need not redraw it', () => {
  const source = phone('p', 990, { spanArtboards: true });
  const first = computeSpill([board('a', [source]), board('b')]);
  const second = computeSpill([board('a', [source]), board('b')]);
  assert.equal(spillFor(first, 'b').front[0].element, spillFor(second, 'b').front[0].element);
});

test('a drag in progress reaches the artboard it is over before it is committed', () => {
  const source = phone('p', 300, { spanArtboards: true });
  const boards = [board('a', [source]), board('b'), board('c')];
  const live = new Map([['p', { position: { x: 1000, y: 800 }, size: source.size, rotation: 0, scale: 1 }]]);
  const copy = spillFor(computeSpill(boards, live), 'b').front[0];
  assert.equal(copy.element.position.x, 1000 - 1290);
  // The copy under the pointer stays mounted after the element leaves it, or
  // the drag would end in mid air.
  const back = new Map([['p', { position: { x: 100, y: 800 }, size: source.size, rotation: 0, scale: 1, originBoardId: 'c' }]]);
  const held = computeSpill(boards, back);
  assert.equal(spillFor(held, 'b'), NO_SPILL);
  assert.equal(spillFor(held, 'c').front.length, 1);
});

test('the artboards an element reaches, for telling when a drag crosses an edge', () => {
  const source = phone('p', 300, { spanArtboards: true });
  const boards = [board('a', [source]), board('b'), board('c')];
  assert.deepEqual(reachedArtboardIds(boards, 'p'), []);
  const box = { position: { x: 1000, y: 800 }, size: source.size, rotation: 0, scale: 1 };
  assert.deepEqual(reachedArtboardIds(boards, 'p', box), ['b']);
  // Wide enough to cover b entirely and start on c.
  assert.deepEqual(reachedArtboardIds(boards, 'p', { ...box, size: { width: 1700, height: 1200 } }), ['b', 'c']);
  assert.deepEqual(reachedArtboardIds(boards, 'p', { ...box, position: { x: 100, y: 800 }, originBoardId: 'c' }), ['c']);
  // Not flagged, or not there at all: nothing.
  assert.deepEqual(reachedArtboardIds([board('a', [phone('q', 1000)]), board('b')], 'q'), []);
  assert.deepEqual(reachedArtboardIds(boards, 'missing'), []);
});

test('paint order is behind copies, then the artboard\'s own stack, then front copies', () => {
  const own = [phone('mine1', 100), phone('mine2', 200)];
  const boards = [
    board('a', [phone('back', 990, { spanArtboards: true, spanBehind: true }), phone('front', 1000, { spanArtboards: true })]),
    board('b', own),
  ];
  const layers = paintLayers(own, spillFor(computeSpill(boards), 'b'));
  assert.deepEqual(
    layers.map((layer) => `${layer.kind}:${layer.kind === 'span' ? layer.copy.source.id : layer.element.id}`),
    ['span:back', 'own:mine1', 'own:mine2', 'span:front']
  );
  // Nothing spilled: the artboard's own list, as it was.
  assert.deepEqual(paintLayers(own).map((layer) => layer.element), own);
});

// Two artboards 1000 and 500 wide drawn at 0.3, with a 15px gap between them.
const rects = [
  { left: 100, top: 50, width: 300 },
  { left: 415, top: 50, width: 150 },
];
const widths = [1000, 500];

test('over an artboard the pointer maps linearly, in either artboard\'s pixels', () => {
  assert.deepEqual(stripPointFromClient({ x: 250, y: 80 }, rects, widths, 0), { x: 500, y: 100 });
  // The same point, seen from the second artboard: 1000 to its left.
  assert.deepEqual(stripPointFromClient({ x: 250, y: 80 }, rects, widths, 1), { x: -500, y: 100 });
  // 30 screen px into the second artboard is 100 of its pixels.
  assert.deepEqual(stripPointFromClient({ x: 445, y: 50 }, rects, widths, 0), { x: 1100, y: 0 });
});

test('over the gap the pointer sits on the edge, so the artwork never drifts from it', () => {
  assert.equal(stripPointFromClient({ x: 405, y: 80 }, rects, widths, 0)?.x, 1000);
  assert.equal(stripPointFromClient({ x: 414, y: 80 }, rects, widths, 0)?.x, 1000);
  assert.equal(stripPointFromClient({ x: 415, y: 80 }, rects, widths, 0)?.x, 1000);
});

test('past either end it carries on in a straight line', () => {
  assert.equal(stripPointFromClient({ x: 70, y: 80 }, rects, widths, 0)?.x, -100);
  assert.equal(stripPointFromClient({ x: 595, y: 80 }, rects, widths, 0)?.x, 1600);
});

test('a mapping it cannot make comes back null rather than a wrong number', () => {
  assert.equal(stripPointFromClient({ x: 0, y: 0 }, [], [], 0), null);
  assert.equal(stripPointFromClient({ x: 0, y: 0 }, rects, [1000], 0), null);
  assert.equal(stripPointFromClient({ x: 0, y: 0 }, [{ left: 0, top: 0, width: 0 }], [1000], 0), null);
});

// --- reach: everything an element can paint ---------------------------------

function rect(id: string, x: number, width: number, extra: Partial<ShapeElementProps> = {}): ShapeElementProps {
  return {
    id,
    type: 'shape',
    shapeType: 'rectangle',
    position: { x, y: 100 },
    size: { width, height: 140 },
    rotation: 0,
    scale: 1,
    fillColor: '#ff0000',
    strokeColor: '#000000',
    strokeWidth: 0,
    spanArtboards: true,
    ...extra,
  };
}

function image(id: string, x: number, extra: Partial<ImageElementProps> = {}): ImageElementProps {
  return {
    id,
    type: 'image',
    position: { x, y: 50 },
    size: { width: 100, height: 200 },
    rotation: 0,
    scale: 1,
    imageSrc: '/x.png',
    spanArtboards: true,
    ...extra,
  };
}

test('a skewed image reaches as far as its slanted artwork does', () => {
  // The reported case: a 100 wide box ending at 300 on a 350 wide artboard,
  // skewX 45 slants its corners out to 100 and 400.
  const skewed = image('i', 200, { skewX: 45 });
  const reach = paintRect(skewed, 0);
  assert.ok(Math.abs(reach.left - 100) < 1e-6 && Math.abs(reach.right - 400) < 1e-6, JSON.stringify(reach));
  const spill = computeSpill([board('a', [skewed], 350, 500), board('b', [], 350, 500)]);
  assert.equal(spillFor(spill, 'b').front.length, 1);
});

test('a tilted image is measured through its perspective', () => {
  // rotateX brings the bottom edge toward the viewer, which widens it past the
  // box: 10 short of the edge is not short enough.
  // The near edge sits 100px closer at a 1000px viewing distance: its half
  // width of 200 shows as 200 / 0.9.
  const tilted = image('i', 880, { size: { width: 400, height: 400 }, perspectiveX: 30 });
  const reach = paintRect(tilted, 0).right;
  assert.ok(Math.abs(reach - (1080 + 200 / 0.9)) < 0.5, String(reach));
  assert.equal(spillFor(computeSpill([board('a', [tilted]), board('b')]), 'b').front.length, 1);
  // Untilted, the same box stays home.
  assert.equal(computeSpill([board('a', [image('i', 880, { size: { width: 400, height: 400 } })]), board('b')]).size, 0);
});

test('a device in a perspective style reaches where its tilted frame does', () => {
  // perspective-right pushes the frame's lower right corner about 135px past
  // a 600 wide box. The box ends 90 short of the edge.
  const tilted = phone('p', 600, { styleType: 'perspective-right', spanArtboards: true });
  // Corner (300, 600) from the centre: x 429.04 over w 0.98545, plus the 17px
  // the frame's own drop-shadow reaches.
  const reach = paintRect(tilted, 0).right;
  assert.ok(Math.abs(reach - (900 + 429.04 / 0.98545 + 17)) < 1, String(reach));
  assert.equal(spillFor(computeSpill([board('a', [tilted]), board('b')]), 'b').front.length, 1);
  // A 3D style draws inside its box, so only the box and the frame shadow count.
  const threeD = phone('p', 600, { styleType: '3d-right', spanArtboards: true });
  assert.equal(computeSpill([board('a', [threeD]), board('b')]).size, 0);
});

test('a transform that cannot be read counts as reaching everywhere', () => {
  const odd = image('i', 100, { matrix3d: 'rotate(10deg) scale(4)' });
  assert.equal(paintRect(odd, 0).right, Infinity);
  const spill = computeSpill([board('a', [odd]), board('b'), board('c')]);
  assert.equal(spillFor(spill, 'b').front.length, 1);
  assert.equal(spillFor(spill, 'c').front.length, 1);
});

test('a soft shadow reaches its whole tail, not one blur length', () => {
  // The reported case: a 100 wide square ending at 350 on a 400 wide artboard
  // with a 40px blur still shades pixels past 400.
  const glow = rect('r', 250, 100, { shadow: { x: 0, y: 0, blur: 40, color: '#000000' } });
  assert.ok(paintRect(glow, 0).right >= 350 + 3 * 40, JSON.stringify(paintRect(glow, 0)));
  assert.equal(spillFor(computeSpill([board('a', [glow], 400, 500), board('b', [], 400, 500)]), 'b').front.length, 1);
});

test('a shadow and a blur add up, since the blur spreads the shadow too', () => {
  const both = rect('r', 0, 100, { shadow: { x: 10, y: 0, blur: 10, color: '#000000' }, blur: 10 });
  const alone = rect('r', 0, 100, { shadow: { x: 10, y: 0, blur: 10, color: '#000000' } });
  assert.equal(paintRect(both, 0).right - paintRect(alone, 0).right, 30);
});

test('a slide that carries the element over the edge reaches the next artboard', () => {
  // The reported case: a box ending at 390 on a 400 x 500 artboard slides in
  // from 25px to the right (5% of the height).
  const sliding = rect('r', 290, 100, { animation: { enter: 'slide-left', enterDuration: 1 } });
  const boards = [board('a', [sliding], 400, 500), board('b', [], 400, 500)];
  assert.equal(spillFor(computeSpill(boards), 'b').front.length, 1);
  // A fade moves nothing, so the same box stays home.
  const fading = rect('r', 290, 100, { animation: { enter: 'fade', enterDuration: 1 } });
  assert.equal(computeSpill([board('a', [fading], 400, 500), board('b', [], 400, 500)]).size, 0);
});

test('a pop grows the element past its box on the way in', () => {
  const popping = rect('r', 980, 300, { animation: { enter: 'pop' } });
  assert.equal(spillFor(computeSpill([board('a', [popping]), board('b')]), 'b').front.length, 1);
  assert.equal(computeSpill([board('a', [rect('r', 980, 300)]), board('b')]).size, 0);
});

test('the reach constants really bound what the animation code does', () => {
  const slide = 100;
  const presets: ElementAnimationPreset[] = ['fade', 'slide-up', 'slide-down', 'slide-left', 'slide-right', 'scale-up', 'pop'];
  for (const preset of presets) {
    for (let step = 0; step <= 1000; step++) {
      const t = step / 1000;
      const state = animationStateAt({ enter: preset, enterDuration: 1 }, t, slide);
      assert.ok(Math.abs(state.dx) <= slide && Math.abs(state.dy) <= slide, `${preset} at ${t}`);
      assert.ok(state.scale <= POP_PEAK_SCALE, `${preset} scale ${state.scale} at ${t}`);
      const leaving = animationStateAt({ exit: preset, exitStart: 0, exitDuration: 1 }, t, slide);
      assert.ok(Math.abs(leaving.dx) <= slide && leaving.scale <= POP_PEAK_SCALE, `${preset} exit at ${t}`);
    }
  }
  assert.equal(slideDistanceFor(500), 25);
});

test('a copy carries its source artboard size, which sets its slide distance', () => {
  const boards = [board('a', [phone('p', 990, { spanArtboards: true })], 1290, 2796), board('b', [], 1290, 1400)];
  const copy = spillFor(computeSpill(boards), 'b').front[0];
  assert.deepEqual(copy.sourceSize, { width: 1290, height: 2796 });
});

test('every artboard an element shows on, its own first', () => {
  const wide = phone('p', 900, { spanArtboards: true, size: { width: 2000, height: 400 } });
  const spill = computeSpill([board('a', [wide]), board('b'), board('c')]);
  assert.deepEqual(spanArtboardsByElement(spill).get('p'), ['a', 'b', 'c']);
  assert.equal(spanArtboardsByElement(computeSpill([board('a', [phone('q', 10)]), board('b')])).size, 0);
});

test('a board whose only moving part continues in from a neighbour still has a timeline', async () => {
  const { artboardTimeline } = await import('@/lib/video/timeline');
  const fading = rect('r', 330, 140, { animation: { enter: 'fade', enterDelay: 2, enterDuration: 1 } });
  const boards = [board('a', [fading], 400, 500), board('b', [], 400, 500)];
  const spill = computeSpill(boards);
  // On its own, the second board is a still.
  assert.equal(artboardTimeline(boards[1]).hasMotion, false);
  const shown = artboardTimeline(boards[1], spillFor(spill, 'b'));
  assert.equal(shown.hasMotion, true);
  assert.equal(shown.contentEndSeconds, 3);
  // A copy that does not move adds nothing.
  const still = [board('a', [rect('r', 330, 140)], 400, 500), board('b', [], 400, 500)];
  assert.equal(artboardTimeline(still[1], spillFor(computeSpill(still), 'b')).hasMotion, false);
});
