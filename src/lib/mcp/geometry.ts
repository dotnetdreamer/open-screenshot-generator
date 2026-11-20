// The x, y, width and height a design tool was given, put over a position and
// a size. add_element and update_element take each of the four on its own: a
// value left out keeps what the element has (update_element) or would have had
// (add_element), so a y alone moves an element down without moving it across,
// and a height alone keeps the width.

import type { Point, Size } from '@/types/artboard';

const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** `base` with the x and y a call named put over it. Anything but a number keeps the base value. */
export function positionWith(base: Point, named?: Partial<Point>): Point {
  const x = named?.x;
  const y = named?.y;
  return { x: isFiniteNumber(x) ? x : base.x, y: isFiniteNumber(y) ? y : base.y };
}

/** `base` with the width and height a call named put over it. A size of 0 or less keeps the base value. */
export function sizeWith(base: Size, named?: Partial<Size>): Size {
  const width = named?.width;
  const height = named?.height;
  return {
    width: isFiniteNumber(width) && width > 0 ? width : base.width,
    height: isFiniteNumber(height) && height > 0 ? height : base.height,
  };
}
