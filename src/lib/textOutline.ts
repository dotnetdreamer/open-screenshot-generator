// The outline a text element can carry: a band of colour around every glyph,
// drawn outside the letter so the fill keeps its full weight, the way mobile
// game titles are lettered.
//
// It is a ring of hard text-shadows rather than -webkit-text-stroke with
// paint-order. Two things rule the stroke out:
//   - Chromium joins a thick text stroke with mitres, and stroke-linejoin does
//     not apply to HTML text, so every sharp corner of a W, A, M or V grows a
//     spike.
//   - WebKit loses it in the PNG export. html-to-image writes every computed
//     property onto its clone, `stroke-color: transparent` included, and once
//     stroke-color is set WebKit strokes HTML text with stroke-color and
//     stroke-width instead of the -webkit-text-stroke pair. A macOS export
//     would come out with no outline and nothing reporting it.
// Copies of the glyphs pushed out in a circle give round corners, and
// text-shadow survives the capture in every engine.
//
// Both render sites get it through TextElement, and the element's own drop
// shadow (elementStyle.ts) is cast from the outlined silhouette, so outline
// plus a hard drop is the usual game title.

import type React from 'react';
import type { TextElementProps } from '@/types/artboard';

/** Matches TextElement: type renders at fontSize / 0.3, and the outline with it. */
const DISPLAY_SCALE_FACTOR = 0.3;

/**
 * The longest step between two neighbouring copies on a ring, in px. A sparse
 * ring shows as steps along every curve: 16 copies at 14px did, 32 looked like
 * a stroke.
 */
const MAX_STEP_PX = 3;
const MIN_COPIES = 8;
const MAX_COPIES = 64;

/** The inner ring only matters once there is room for a gap behind a dot. */
const INNER_RING_FROM_PX = 4;

type OutlineFields = Pick<TextElementProps, 'outlineColor' | 'outlineWidth'>;

const round2 = (n: number) => Math.round(n * 100) / 100;

/** How thick the outline renders, in artboard px. 0 when there is none. */
export function textOutlinePx(element: OutlineFields): number {
  const { outlineColor, outlineWidth } = element;
  if (typeof outlineColor !== 'string' || !outlineColor.trim()) return 0;
  if (typeof outlineWidth !== 'number' || !Number.isFinite(outlineWidth) || outlineWidth <= 0) return 0;
  return outlineWidth / DISPLAY_SCALE_FACTOR;
}

/**
 * How far past the glyphs an outlined element paints, in artboard px: the
 * outline rounded up, plus one pixel for its antialiased edge. 0 without one.
 * The text box grows by this much (textOutlineStyle), and so does the video
 * export's sprite capture.
 */
export function textOutlineReach(element: OutlineFields): number {
  const px = textOutlinePx(element);
  return px > 0 ? Math.ceil(px) + 1 : 0;
}

/**
 * How many copies a ring of this radius needs, as a multiple of 8 so the four
 * axes and the four diagonals are always among them.
 */
export function ringCopies(radius: number): number {
  if (!(radius > 0)) return 0;
  const wanted = Math.ceil((2 * Math.PI * radius) / MAX_STEP_PX / 8) * 8;
  return Math.min(MAX_COPIES, Math.max(MIN_COPIES, wanted));
}

function ring(radius: number, copies: number, color: string): string[] {
  const shadows: string[] = [];
  for (let i = 0; i < copies; i++) {
    const angle = (2 * Math.PI * i) / copies;
    // `|| 0` turns -0 into 0, which reads better in the inspector.
    const x = round2(radius * Math.cos(angle)) || 0;
    const y = round2(radius * Math.sin(angle)) || 0;
    shadows.push(`${x}px ${y}px 0 ${color}`);
  }
  return shadows;
}

/**
 * The text-shadow value for an outline `px` thick.
 *
 * Two rings. The outer one is the outline's edge. The inner one, at half the
 * radius, fills in behind marks narrower than the outline is thick: the outer
 * ring alone copies a full stop or the dot of an i around a circle, which
 * leaves a gap between the dot and its outline.
 *
 * A see-through colour comes out darker where the copies overlap, so the
 * outline is meant to be opaque.
 */
export function textOutlineShadow(color: string, px: number): string {
  if (!(px > 0)) return 'none';
  const copies = ringCopies(px);
  const shadows = ring(px, copies, color);
  if (px >= INNER_RING_FROM_PX) {
    shadows.push(...ring(px / 2, Math.max(MIN_COPIES, Math.ceil(copies / 4 / 8) * 8), color));
  }
  return shadows.join(', ');
}

/**
 * What TextElement adds to its body for an outline. Text without one gets {},
 * so its box keeps the plain geometry.
 *
 * The body clips its overflow, and the glyphs come to within `padding` of its
 * edge, so an outline would be cut off wherever the text meets the box. The
 * body grows outward by the outline's reach on every side and its padding grows
 * by the same amount: the clip edge moves out, and the content box, which
 * decides where the text wraps and where it centres, stays exactly where it
 * was.
 */
export function textOutlineStyle(element: OutlineFields, padding: number): React.CSSProperties {
  const px = textOutlinePx(element);
  if (!px) return {};
  const reach = textOutlineReach(element);
  return {
    textShadow: textOutlineShadow((element.outlineColor as string).trim(), px),
    margin: `-${reach}px`,
    width: `calc(100% + ${reach * 2}px)`,
    height: `calc(100% + ${reach * 2}px)`,
    padding: `${padding + reach}px`,
  };
}
