// The text outline: when there is one, how thick it renders, and the box
// change that keeps it from being clipped without moving the text.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ringCopies,
  textOutlinePx,
  textOutlineReach,
  textOutlineShadow,
  textOutlineStyle,
} from '@/lib/textOutline';
import { scaleElementsToCanvas } from '@/lib/deviceRegistry';
import { describeArtboardsChange } from '@/lib/historyLabels';
import type { ArtboardState, TextElementProps } from '@/types/artboard';

const INK = '#14100c';

/** Every `x y 0 colour` entry of a text-shadow value, as numbers. */
function offsets(shadow: string): Array<{ x: number; y: number; color: string }> {
  return shadow.split(/,\s*(?![^(]*\))/).map((entry) => {
    const [x, y, blur, ...rest] = entry.trim().split(/\s+/);
    assert.equal(blur, '0', `hard edge expected in "${entry}"`);
    return { x: parseFloat(x), y: parseFloat(y), color: rest.join(' ') };
  });
}

function textElement(overrides: Partial<TextElementProps> = {}): TextElementProps {
  return {
    id: 'el_title',
    type: 'text',
    position: { x: 100, y: 200 },
    size: { width: 1000, height: 300 },
    rotation: 0,
    scale: 1,
    content: 'KANCHE',
    fontSize: 48,
    color: '#fff6dd',
    fontFamily: 'Lilita One',
    ...overrides,
  };
}

test('no colour or no width is no outline, and the box is left alone', () => {
  const cases: Array<Partial<TextElementProps>> = [
    {},
    { outlineColor: INK },
    { outlineWidth: 3 },
    { outlineColor: '', outlineWidth: 3 },
    { outlineColor: '   ', outlineWidth: 3 },
    { outlineColor: INK, outlineWidth: 0 },
    { outlineColor: INK, outlineWidth: -2 },
    { outlineColor: INK, outlineWidth: Number.NaN },
    { outlineColor: INK, outlineWidth: Number.POSITIVE_INFINITY },
  ];
  for (const fields of cases) {
    assert.equal(textOutlinePx(fields), 0, JSON.stringify(fields));
    assert.equal(textOutlineReach(fields), 0, JSON.stringify(fields));
    assert.deepEqual(textOutlineStyle(fields, 2), {}, JSON.stringify(fields));
  }
  assert.equal(textOutlineShadow(INK, 0), 'none');
});

test('the width is in fontSize units, so it renders at width / 0.3', () => {
  assert.equal(textOutlinePx({ outlineColor: INK, outlineWidth: 3 }), 10);
  assert.ok(Math.abs(textOutlinePx({ outlineColor: INK, outlineWidth: 1.2 }) - 4) < 1e-9);
  // One pixel past the rounded-up width, for the antialiased edge.
  assert.equal(textOutlineReach({ outlineColor: INK, outlineWidth: 3 }), 11);
  assert.equal(textOutlineReach({ outlineColor: INK, outlineWidth: 1.2 }), 5);
});

test('the box grows by the reach and the content box stays put', () => {
  const style = textOutlineStyle({ outlineColor: INK, outlineWidth: 3 }, 2);
  assert.equal(style.margin, '-11px');
  assert.equal(style.width, 'calc(100% + 22px)');
  assert.equal(style.height, 'calc(100% + 22px)');
  assert.equal(style.padding, '13px');
  // (100% + 22) - 2 * 13 = 100% - 4, the 2px padding the plain box has.
  const grow = 22;
  const padding = parseFloat(String(style.padding));
  assert.equal(grow - 2 * padding, -2 * 2);
  assert.equal(typeof style.textShadow, 'string');
});

test('the ring sits on the outline edge in every direction, in the outline colour', () => {
  const px = 10;
  const shadows = offsets(textOutlineShadow(INK, px));
  for (const { x, y, color } of shadows) {
    assert.equal(color, INK);
    assert.ok(Math.hypot(x, y) <= px + 0.01, `${x},${y} reaches past ${px}px`);
  }
  const outer = shadows.filter(({ x, y }) => Math.abs(Math.hypot(x, y) - px) < 0.02);
  assert.equal(outer.length, ringCopies(px));
  // The four axes are always among them, so no side is left thin.
  for (const [ax, ay] of [[px, 0], [0, px], [-px, 0], [0, -px]]) {
    assert.ok(outer.some(({ x, y }) => x === ax && y === ay), `missing ${ax},${ay}`);
  }
  // Neighbours are never more than a few pixels apart on the circle.
  const angles = outer.map(({ x, y }) => Math.atan2(y, x)).sort((a, b) => a - b);
  const widest = Math.max(...angles.map((a, i) => (angles[(i + 1) % angles.length] - a + 2 * Math.PI) % (2 * Math.PI)));
  assert.ok(widest * px <= 3.01, `a ${(widest * px).toFixed(2)}px step between copies`);
});

test('an inner ring fills in behind small marks once the outline is thick enough', () => {
  const thin = offsets(textOutlineShadow(INK, 3));
  assert.equal(thin.length, ringCopies(3));
  const thick = offsets(textOutlineShadow(INK, 20));
  const inner = thick.filter(({ x, y }) => Math.abs(Math.hypot(x, y) - 10) < 0.02);
  assert.ok(inner.length >= 8, 'an inner ring at half the radius');
  assert.equal(thick.length, ringCopies(20) + inner.length);
});

test('the copy count grows with the radius in steps of 8 and stays bounded', () => {
  let previous = 0;
  for (const radius of [0.5, 1, 3, 6.7, 10, 13.3, 20, 33, 100, 1000]) {
    const copies = ringCopies(radius);
    assert.equal(copies % 8, 0, `${copies} at ${radius}px`);
    assert.ok(copies >= 8 && copies <= 64, `${copies} at ${radius}px`);
    assert.ok(copies >= previous, `fewer copies at ${radius}px than below it`);
    previous = copies;
  }
  assert.equal(ringCopies(0), 0);
});

test('the colour is used as given, trimmed', () => {
  const style = textOutlineStyle({ outlineColor: '  rgb(20, 16, 12) ', outlineWidth: 1.5 }, 2);
  for (const { color } of offsets(String(style.textShadow))) assert.equal(color, 'rgb(20, 16, 12)');
});

test('resizing the canvas scales the outline with the type', () => {
  const [scaled] = scaleElementsToCanvas(
    [textElement({ outlineColor: INK, outlineWidth: 4 })],
    { width: 1290, height: 2796 },
    { width: 645, height: 1398 }
  ) as TextElementProps[];
  assert.equal(scaled.fontSize, 24);
  assert.equal(scaled.outlineWidth, 2);
  assert.equal(scaled.outlineColor, INK);

  const [plain] = scaleElementsToCanvas(
    [textElement()],
    { width: 1290, height: 2796 },
    { width: 645, height: 1398 }
  ) as TextElementProps[];
  assert.ok(!('outlineWidth' in plain), 'text without an outline does not gain one');
});

test('an outline edit is named in the history', () => {
  const board = (element: TextElementProps): ArtboardState => ({
    id: 'ab_1',
    name: 'Hero',
    position: { x: 0, y: 0 },
    size: { width: 1290, height: 2796 },
    elements: [element],
    backgroundColor: '#2d6a4f',
    zoom: 1,
  });
  const before = [board(textElement())];
  const after = [board(textElement({ outlineColor: INK, outlineWidth: 4 }))];
  assert.equal(describeArtboardsChange(before, after)?.label, 'Outline');
});
