import type { DeviceStyleType } from '@/types/artboard';

// The CSS transform a flat device frame takes for each perspective style.
// DeviceFrameElement draws with it, and the reach of an element continuing
// across artboard edges (src/lib/spanArtboards.ts) measures with it, so the two
// agree on where a tilted frame's corners land, which can be a quarter of its
// width outside its box.
const PERSPECTIVE_PRESETS: Partial<Record<DeviceStyleType, string>> = {
  // Mirror the right perspective for consistency
  'perspective-left':
    'matrix3d(1.04397, 0.095046, 0, -3.13e-05, -0.236454, 0.928959, 0, -3.99e-05, 0, 0, 1, 0, 26.0176, 24.4342, 0, 1)',
  'perspective-right':
    'matrix3d(1.04397, -0.095046, 0, 3.13e-05, 0.236454, 0.928959, 0, -3.99e-05, 0, 0, 1, 0, -26.0176, 24.4342, 0, 1)',
  'perspective-slight-right':
    'matrix3d(1.02397, -0.065046, 0, 2.13e-05, 0.136454, 0.968959, 0, -1.99e-05, 0, 0, 1, 0, -16.0176, 14.4342, 0, 1)',
  // Mirror the slight-right perspective for consistency
  'perspective-slight-left':
    'matrix3d(1.02397, 0.065046, 0, -2.13e-05, -0.136454, 0.968959, 0, -1.99e-05, 0, 0, 1, 0, 16.0176, 14.4342, 0, 1)',
  'perspective-front': 'matrix3d(1, 0, 0, 0, 0, 0.98, 0, 0.0001, 0, 0, 1, 0, 0, 8, 0, 1)',
};

/** The frame's transform for a style, or 'none'. `custom` takes the element's own matrix. */
export function devicePerspectiveTransform(
  styleType: DeviceStyleType = 'normal',
  customMatrix?: string
): string {
  if (styleType === 'custom') return customMatrix || 'none';
  return PERSPECTIVE_PRESETS[styleType] ?? 'none';
}

/**
 * True for the styles drawn in three.js, which stay inside their box. Each one
 * costs a WebGL context wherever it renders, which is what the deck and
 * preview budgets count with this.
 */
export function isDevice3dStyle(styleType: DeviceStyleType | undefined): boolean {
  return styleType === '3d-left' || styleType === '3d-right' || styleType === '3d-studio';
}
