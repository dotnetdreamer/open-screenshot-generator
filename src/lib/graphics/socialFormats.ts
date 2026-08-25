/**
 * The surfaces the graphics flow designs for.
 *
 * This is the ONLY registration site for a marketing format. The format tabs,
 * the deck, the created project's canvas and the "every format" export all read
 * this list, so adding, say, a Pinterest pin is one entry here and nothing else.
 *
 * Every entry's dimensions must also exist in `sizePresets.ts`, because that is
 * what names the size in the toolbar once the project is open; `presetId` is the
 * link and `assertSocialFormatPresets()` keeps the two honest.
 */

import type { Size } from '@/types/artboard';
import { ALL_CANVAS_SIZE_PRESETS } from '@/lib/sizePresets';

export type SocialFormatId =
  | 'og'
  | 'post'
  | 'story'
  | 'feature-graphic'
  | 'x-banner'
  | 'linkedin-banner';

/**
 * The shape band a format falls into.
 *
 * Layouts branch on this rather than on the format id, which is the whole
 * reason one recipe can serve six surfaces: a 1200x630 link preview and a
 * 1024x500 feature graphic want the same composition, and a 4:1 LinkedIn cover
 * wants a genuinely different one, not the wide layout squashed.
 */
export type FormatBand = 'ultrawide' | 'wide' | 'square' | 'tall';

export interface SocialFormat {
  id: SocialFormatId;
  /** Tab label. */
  label: string;
  /** Chip label on a result card, where the full name does not fit. */
  short: string;
  width: number;
  height: number;
  /** One line under the deck: what this size is actually for. */
  blurb: string;
  /** Matching `CanvasSizePreset.id` in sizePresets.ts. */
  presetId: string;
  /**
   * Fractions of the canvas that platform chrome sits over, so a layout can
   * keep copy out of them. X hangs the avatar over the lower left of a header;
   * LinkedIn crops the lower left behind the profile photo on narrow viewports.
   */
  avoid?: { left?: number; bottom?: number };
}

export const SOCIAL_FORMATS: SocialFormat[] = [
  {
    id: 'og',
    label: 'Link Preview',
    short: 'OG',
    width: 1200,
    height: 630,
    blurb: 'The card that shows when your link is pasted anywhere: Slack, iMessage, X, LinkedIn, Facebook.',
    presetId: 'social-og',
  },
  {
    id: 'post',
    label: 'Social Post',
    short: 'Post',
    width: 1080,
    height: 1080,
    blurb: 'Square feed post. The one size every network accepts without cropping.',
    presetId: 'ig-square',
  },
  {
    id: 'story',
    label: 'Story',
    short: 'Story',
    width: 1080,
    height: 1920,
    blurb: 'Full screen vertical for Stories, Reels, TikTok and Shorts.',
    presetId: 'social-story',
  },
  {
    id: 'feature-graphic',
    label: 'Play Feature Graphic',
    short: 'Feature',
    width: 1024,
    height: 500,
    blurb: 'Required on every Google Play listing. Must be exactly 1024 by 500, with no transparency.',
    presetId: 'play-feature-graphic',
  },
  {
    id: 'x-banner',
    label: 'X Header',
    short: 'X',
    width: 1500,
    height: 500,
    blurb: 'Profile header on X. The avatar covers the lower left, so the copy sits high and right.',
    presetId: 'x-banner',
    avoid: { left: 0.16, bottom: 0.34 },
  },
  {
    id: 'linkedin-banner',
    label: 'LinkedIn Banner',
    short: 'LinkedIn',
    width: 1584,
    height: 396,
    blurb: 'Personal profile cover on LinkedIn. Very shallow, so this one is a band of type, not a scene.',
    presetId: 'linkedin-banner',
    avoid: { left: 0.14, bottom: 0.3 },
  },
];

export const DEFAULT_SOCIAL_FORMAT: SocialFormatId = 'og';

const BY_ID = new Map<SocialFormatId, SocialFormat>(
  SOCIAL_FORMATS.map((format) => [format.id, format])
);

export function getSocialFormat(id: SocialFormatId): SocialFormat {
  const format = BY_ID.get(id);
  if (!format) throw new Error(`Unknown social format: ${id}`);
  return format;
}

export function formatSize(format: SocialFormat): Size {
  return { width: format.width, height: format.height };
}

/**
 * Which band a canvas reads as.
 *
 * The cuts are placed between the sizes actually in the list rather than on
 * round numbers: 2.048 (feature graphic) has to land in `wide` with 1.905 (OG),
 * and 3.0 (X) has to land in `ultrawide` with 4.0 (LinkedIn), because a 500px
 * tall band and a 630px tall card want different type sizes for the same width.
 */
export function bandOf(size: Size): FormatBand {
  const aspect = size.height > 0 ? size.width / size.height : 1;
  if (aspect >= 2.6) return 'ultrawide';
  if (aspect >= 1.4) return 'wide';
  if (aspect >= 0.85) return 'square';
  return 'tall';
}

export function bandOfFormat(format: SocialFormat): FormatBand {
  return bandOf(formatSize(format));
}

/**
 * Every way this list and the canvas-size catalog can disagree.
 *
 * The two are edited by different hands for different reasons, and a drift
 * between them is invisible in the UI: the graphics deck would keep composing
 * at 1500x500 while the toolbar named the open project something else and the
 * PNG filename tag went with the toolbar. Returns an empty array when they
 * agree; the graphics screen logs anything it finds in development.
 */
export function assertSocialFormatPresets(): string[] {
  const problems: string[] = [];
  for (const format of SOCIAL_FORMATS) {
    const preset = ALL_CANVAS_SIZE_PRESETS.find((p) => p.id === format.presetId);
    if (!preset) {
      problems.push(`${format.id}: no canvas size preset with id "${format.presetId}"`);
      continue;
    }
    if (preset.width !== format.width || preset.height !== format.height) {
      problems.push(
        `${format.id}: ${format.width}x${format.height} but preset "${preset.id}" is ${preset.width}x${preset.height}`
      );
    }
  }
  return problems;
}
