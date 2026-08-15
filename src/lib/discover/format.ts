// Small presentation helpers shared by every Discover component.

import type { DiscoverImage, DiscoverPost, DiscoverStats } from '@/types/discover';
import type { DiscoverLocalState } from './localState';

/**
 * The counts a card actually shows: the server's numbers, adjusted by whatever
 * the viewer has just tapped and the server has not answered about yet.
 *
 * A **delta**, not a sum, and that distinction is the whole of it. `post.stats.
 * likes` already includes this viewer's like if they have one, because the feed
 * knows who is asking. So the only correction is when the overlay disagrees with
 * the post: they just liked something the server still lists as unliked (+1), or
 * just un-liked something it lists as liked (-1). Adding a flat +1 for "liked",
 * the way this worked against the mock, would double-count every like the
 * moment the feed refreshed.
 */
export function viewerStats(post: DiscoverPost, state: DiscoverLocalState): DiscoverStats {
  const intent = state.liked[post.id];
  const server = !!post.likedByViewer;
  const delta = intent === undefined || intent === server ? 0 : intent ? 1 : -1;
  return {
    ...post.stats,
    likes: Math.max(0, post.stats.likes + delta),
  };
}

/**
 * The smallest count worth printing next to an icon.
 *
 * One, which is to say: print every real number and print nothing at all for a
 * zero.
 *
 * A card whose action row reads "0 0 0" tells the person who just shared their
 * work that three separate things about it are zero, and it says it on every
 * card in a young feed including the ones they are scrolling past for
 * inspiration. A bare heart says nothing, which is the truth: nobody has voted
 * yet. This is the entire reason the helper below exists, and it is worth being
 * clear that it hides a zero rather than inventing anything to put in its place.
 *
 * Deliberately not 3. Hiding a 1 and a 2 would suppress real people — the first
 * like a post ever gets is the one most worth showing, to the author above all —
 * and it would make the heart look broken to whoever had just tapped it. Raising
 * this is a one-line change if a busier feed ever wants it.
 */
export const MIN_VISIBLE_COUNT = 1;

/**
 * `compactCount` for a number sitting beside an icon, blank when there is
 * nothing to report. Callers render the surrounding element only when this
 * comes back non-empty.
 */
export function countLabel(value: number): string {
  if (!Number.isFinite(value) || value < MIN_VISIBLE_COUNT) return '';
  return compactCount(value);
}

/** 1240 -> "1.2k", 18300 -> "18k". Counts in the feed get wide fast. */
export function compactCount(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '0';
  if (value < 1000) return String(Math.round(value));
  if (value < 10_000) {
    const thousands = value / 1000;
    // 1.0k reads worse than 1k, so drop a zero decimal.
    const text = thousands.toFixed(1);
    return `${text.endsWith('.0') ? text.slice(0, -2) : text}k`;
  }
  if (value < 1_000_000) return `${Math.round(value / 1000)}k`;
  const millions = value / 1_000_000;
  const text = millions.toFixed(1);
  return `${text.endsWith('.0') ? text.slice(0, -2) : text}m`;
}

/**
 * "3h", "2d", "Mar 4". Short by design: it sits in a byline next to a handle,
 * where "about 3 hours ago" would push the name into an ellipsis.
 */
export function shortTimeAgo(iso: string, now: number = Date.now()): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d`;
  const weeks = Math.round(days / 7);
  if (days < 60) return `${weeks}w`;
  return new Date(then).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Long form for the post detail, where there is room for the real date. */
export function fullDate(iso: string): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  return new Date(then).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/** "Aisha Rahman" -> "AR". Feeds the avatar fallback. */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

// Avatar gradients. Every author without a picture still gets a stable, unique
// looking chip, and nothing is fetched from a third party: the whole app has to
// keep working offline and inside the Tauri webview.
const AVATAR_GRADIENTS = [
  'linear-gradient(135deg, #5F9EA0, #2F6F80)',
  'linear-gradient(135deg, #7C6CE4, #4B37B8)',
  'linear-gradient(135deg, #E4826C, #C24B3F)',
  'linear-gradient(135deg, #4CA88B, #1F6E58)',
  'linear-gradient(135deg, #D4AF37, #A8791A)',
  'linear-gradient(135deg, #6C8FE4, #2F55B8)',
  'linear-gradient(135deg, #C46CE4, #7C2FB8)',
  'linear-gradient(135deg, #E46C9E, #B82F63)',
  'linear-gradient(135deg, #4C9AA8, #1F5E6E)',
  'linear-gradient(135deg, #8FA84C, #5E6E1F)',
];

/** A stable background for an author's initials avatar. */
export function avatarGradient(seed: string): string {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return AVATAR_GRADIENTS[Math.abs(hash) % AVATAR_GRADIENTS.length];
}

/**
 * How a post's cover is framed in the feed grid.
 *
 * One box, 3:1, for every card regardless of what the image is. Letting a cover
 * keep its own ratio does not make its card taller — the grid stretches a row
 * to its tallest card anyway — it makes that card's title, caption and tags
 * start lower than its neighbours' while the action row stays pinned to the
 * bottom, so a row reads as three designs that failed to line up. A Play
 * feature graphic (1024x500, so 2.05) sitting beside the composed 3:1 strips is
 * the case that shows it.
 *
 * `contain` is the default because these are finished pieces of artwork: a
 * feature graphic cropped to 3:1 loses a sixth off the top and the bottom,
 * which on a store graphic is the title and the last line of copy. A muted band
 * at the sides costs less than that. Only a cover already about this shape is
 * allowed to fill the box.
 */
export function coverBox(image: DiscoverImage | undefined): { aspect: string; fit: 'cover' | 'contain' } {
  const box = { aspect: '3 / 1', fit: 'contain' } as const;
  if (!image) return box;
  const [width, height] = image.aspect.split('/').map((part) => Number.parseFloat(part.trim()));
  const ratio = width && height ? width / height : 3;
  if (image.fit === 'cover' && ratio >= 2.6) return { aspect: '3 / 1', fit: 'cover' };
  return box;
}

/** Human label for a surface id, used on the filter row and post details. */
export const SURFACE_LABELS: Record<string, string> = {
  screenshots: 'App Screenshots',
  'apple-watch': 'Apple Watch',
  mac: 'Mac',
  'app-preview': 'App Preview Video',
  'play-feature-graphic': 'Feature Graphic',
};

export function surfaceLabel(surface: string): string {
  return SURFACE_LABELS[surface] ?? 'Design';
}

/**
 * Split a comma or space separated tag entry into clean tags.
 * Lower cased, de-hashed, de-duplicated, capped so one post cannot flood the
 * filter chips.
 */
export function parseTags(input: string, max = 6): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of input.split(/[,\s]+/)) {
    const tag = raw.trim().replace(/^#+/, '').toLowerCase();
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    out.push(tag.slice(0, 24));
    if (out.length >= max) break;
  }
  return out;
}
