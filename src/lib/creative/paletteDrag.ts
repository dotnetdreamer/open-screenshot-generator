/**
 * A design from the palette's Header tab on its way to the canvas.
 *
 * It names what to build, never the artboard itself: the board is built from
 * the project when it lands, the same way the add dialog builds one, so a drop
 * carries a few bytes however large the project's screenshots are.
 */

import type { CreativeAssetKind } from '@/types/artboard';
import { isCreativeAssetKind } from './specs';

/** The dataTransfer type a mouse drag from the Header tab carries. */
export const CREATIVE_LOOK_DRAG_TYPE = 'application/artboard-creative-look';

export interface CreativeLookChoice {
  kind: CreativeAssetKind;
  /** An id from CREATIVE_LOOKS[kind]. */
  lookId: string;
  /** The app name the tile was drawn with, so the board matches the tile. */
  appName: string;
}

export function encodeCreativeLookChoice(choice: CreativeLookChoice): string {
  return JSON.stringify({ kind: choice.kind, lookId: choice.lookId, appName: choice.appName });
}

/** Null for anything that is not a choice, such as a drag from another page. */
export function decodeCreativeLookChoice(raw: string): CreativeLookChoice | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!value || typeof value !== 'object') return null;
  const { kind, lookId, appName } = value as Record<string, unknown>;
  if (!isCreativeAssetKind(kind) || typeof lookId !== 'string' || !lookId) return null;
  return { kind, lookId, appName: typeof appName === 'string' ? appName : '' };
}
