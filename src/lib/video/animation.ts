// Time -> transform evaluation for App Preview video animations. Pure math so
// the export compositor is deterministic (same t always yields the same frame)
// and any future live previewer renders identically.

import type { ElementAnimation, ElementAnimationPreset } from '@/types/artboard';

export interface AnimationState {
  visible: boolean;
  opacity: number; // 0..1
  dx: number; // px offset in artboard space
  dy: number;
  scale: number; // multiplier around the element center
}

export const ENTER_DURATION_DEFAULT = 0.6;
export const EXIT_DURATION_DEFAULT = 0.6;

const IDLE: AnimationState = { visible: true, opacity: 1, dx: 0, dy: 0, scale: 1 };

function easeOutCubic(p: number): number {
  return 1 - Math.pow(1 - p, 3);
}

function easeInCubic(p: number): number {
  return p * p * p;
}

// Overshoot ease for 'pop' (small bounce past 1 then settle).
function easeOutBack(p: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(p - 1, 3) + c1 * Math.pow(p - 1, 2);
}

// `progress` runs 0 -> 1 over the animation; at 1 the element is fully in
// place. `slideDistance` is in artboard px so slides read the same at every
// export resolution.
function presetState(
  preset: ElementAnimationPreset,
  progress: number,
  slideDistance: number
): AnimationState {
  const eased = preset === 'pop' ? easeOutBack(progress) : easeOutCubic(progress);
  const remaining = 1 - eased;
  switch (preset) {
    case 'fade':
      return { visible: true, opacity: eased, dx: 0, dy: 0, scale: 1 };
    case 'slide-up':
      return { visible: true, opacity: Math.min(1, progress * 2), dx: 0, dy: remaining * slideDistance, scale: 1 };
    case 'slide-down':
      return { visible: true, opacity: Math.min(1, progress * 2), dx: 0, dy: -remaining * slideDistance, scale: 1 };
    case 'slide-left':
      return { visible: true, opacity: Math.min(1, progress * 2), dx: remaining * slideDistance, dy: 0, scale: 1 };
    case 'slide-right':
      return { visible: true, opacity: Math.min(1, progress * 2), dx: -remaining * slideDistance, dy: 0, scale: 1 };
    case 'scale-up':
      return { visible: true, opacity: Math.min(1, progress * 2), dx: 0, dy: 0, scale: 0.7 + 0.3 * eased };
    case 'pop':
      return { visible: true, opacity: Math.min(1, progress * 3), dx: 0, dy: 0, scale: eased };
  }
}

/** State of an element's enter/exit animation at time `t` (seconds). */
export function animationStateAt(
  anim: ElementAnimation | undefined,
  t: number,
  slideDistance: number
): AnimationState {
  if (!anim) return IDLE;

  // Exit wins once it has started: after exitStart the element leaves and
  // stays gone, whatever the enter timing said.
  if (anim.exit && anim.exitStart !== undefined && t >= anim.exitStart) {
    const duration = anim.exitDuration ?? EXIT_DURATION_DEFAULT;
    const progress = duration <= 0 ? 1 : Math.min(1, (t - anim.exitStart) / duration);
    if (progress >= 1) return { visible: false, opacity: 0, dx: 0, dy: 0, scale: 1 };
    // Play the preset backwards: state at (1 - easeIn(progress)).
    const state = presetState(anim.exit, 1 - easeInCubic(progress), slideDistance);
    return { ...state, opacity: state.opacity * (1 - easeInCubic(progress)) };
  }

  if (anim.enter) {
    const delay = anim.enterDelay ?? 0;
    if (t < delay) return { visible: false, opacity: 0, dx: 0, dy: 0, scale: 1 };
    const duration = anim.enterDuration ?? ENTER_DURATION_DEFAULT;
    const progress = duration <= 0 ? 1 : Math.min(1, (t - delay) / duration);
    if (progress >= 1) return IDLE;
    return presetState(anim.enter, progress, slideDistance);
  }

  return IDLE;
}

/**
 * The second the artboard's animations settle (all enters done, plus the last
 * exit). Used to auto-suggest an export duration for boards without video.
 */
export function animationEndTime(anim: ElementAnimation | undefined): number {
  if (!anim) return 0;
  let end = 0;
  if (anim.enter) end = (anim.enterDelay ?? 0) + (anim.enterDuration ?? ENTER_DURATION_DEFAULT);
  if (anim.exit && anim.exitStart !== undefined) {
    end = Math.max(end, anim.exitStart + (anim.exitDuration ?? EXIT_DURATION_DEFAULT));
  }
  return end;
}
