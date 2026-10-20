// Where the 3D Studio handles' drags land: the handles sit in their element's
// own box, which the canvas zooms and the element may spin flat, so a move on
// screen has to be measured back into that box before it means anything.

/** Screen pixels per artboard pixel under a handle's overlay, measured, so every zoom is right. */
export function screenScaleOf(overlay: HTMLElement | null): number {
  const wrapper = overlay?.parentElement;
  const board = wrapper?.offsetParent as HTMLElement | null;
  if (board && board.offsetWidth > 0) return board.getBoundingClientRect().width / board.offsetWidth;
  return 0.3;
}

/** A move on screen in the element's own box, unturned by its flat rotation, in artboard pixels. */
export function toElementSpace(dx: number, dy: number, screenScale: number, rotationDegrees: number): { x: number; y: number } {
  const k = screenScale || 1;
  const a = (-rotationDegrees * Math.PI) / 180;
  const x = dx / k;
  const y = dy / k;
  return { x: x * Math.cos(a) - y * Math.sin(a), y: x * Math.sin(a) + y * Math.cos(a) };
}
