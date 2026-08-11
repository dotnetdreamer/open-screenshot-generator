// How tall a text box has to be to show its text.
//
// Text elements clip (TextElement renders with overflow: hidden), and the box
// does not follow the text on its own. That is fine for a template, whose
// boxes were authored to fit, but it means a line break someone types can
// vanish. Every place a user edits text content asks this what the box needs
// and grows it in the SAME update, so the fix is one history entry with the
// edit rather than a second one that lands after it.
//
// Measured, not estimated: wrapping depends on the loaded face, the tracking
// and the weight. A probe node carrying TextElement's exact render CSS is the
// only thing that agrees with what the canvas will do.

import type { TextElementProps } from '@/types/artboard';

/** Matches TextElement: text renders at fontSize / 0.3 and ignores scale. */
const DISPLAY_SCALE_FACTOR = 0.3;

/** The box's own padding: 2px each side. */
const PADDING = 4;

/** Guards against a runaway box if something feeds in absurd content. */
const MAX_HEIGHT = 20000;

function probeNode(): HTMLDivElement {
  const id = 'text-fit-probe';
  const existing = document.getElementById(id) as HTMLDivElement | null;
  if (existing) return existing;
  const node = document.createElement('div');
  node.id = id;
  node.setAttribute('aria-hidden', 'true');
  // Off-screen rather than display:none, which would not lay text out at all.
  node.style.cssText =
    'position:fixed;left:-99999px;top:0;visibility:hidden;pointer-events:none;contain:layout style;';
  document.body.appendChild(node);
  return node;
}

/**
 * The height `content` needs in this element's box, in element units (the same
 * units as `element.size.height`, i.e. before `scale`).
 * Returns 0 when it cannot be measured (no DOM, zero-width box).
 */
export function measureTextHeight(
  element: Pick<
    TextElementProps,
    'size' | 'scale' | 'fontSize' | 'fontFamily' | 'fontWeight' | 'fontStyle' | 'lineHeight' | 'letterSpacing'
  >,
  content: string
): number {
  if (typeof document === 'undefined') return 0;
  const scale = element.scale || 1;
  const innerWidth = element.size.width * scale - PADDING;
  if (!(innerWidth > 0)) return 0;

  const node = probeNode();
  node.style.width = `${innerWidth}px`;
  node.style.fontFamily = element.fontFamily || 'Arial';
  node.style.fontSize = `${element.fontSize / DISPLAY_SCALE_FACTOR}px`;
  node.style.lineHeight = String(element.lineHeight || 1.2);
  node.style.letterSpacing =
    typeof element.letterSpacing === 'number' && element.letterSpacing !== 0
      ? `${element.letterSpacing / DISPLAY_SCALE_FACTOR}px`
      : 'normal';
  node.style.fontWeight = String(element.fontWeight || 'normal');
  node.style.fontStyle = element.fontStyle || 'normal';
  node.style.whiteSpace = 'pre-wrap';
  node.style.wordBreak = 'break-word';
  // A trailing newline has no line box of its own unless something follows it,
  // and a user who just pressed Enter is expecting room for that line.
  node.textContent = content.endsWith('\n') ? `${content}​` : content;

  const height = node.offsetHeight;
  node.textContent = '';
  return (height + PADDING) / scale;
}

/**
 * The box `content` needs, or null when the current one is already big enough.
 *
 * Grows only. A box someone deliberately made roomy stays roomy, and text that
 * got shorter keeps its layout instead of jumping.
 *
 * The extra height is split above and below, because TextElement centres text
 * in its box: growing downwards alone would slide a headline down the artboard
 * every time a line was added to it.
 */
export function fitTextBox(
  element: TextElementProps,
  content: string
): { size: { width: number; height: number }; position: { x: number; y: number } } | null {
  const needed = measureTextHeight(element, content);
  // 1px of slack: sub-pixel rounding should not resize anything.
  if (!needed || needed <= element.size.height + 1) return null;

  const height = Math.min(MAX_HEIGHT, Math.ceil(needed));
  const grown = (height - element.size.height) * (element.scale || 1);
  return {
    size: { width: element.size.width, height },
    position: {
      x: element.position.x,
      y: Math.max(0, element.position.y - grown / 2),
    },
  };
}
