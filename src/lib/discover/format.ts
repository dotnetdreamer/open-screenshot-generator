// Small presentation helpers shared by every Discover component.

import type { DiscoverImage, DiscoverPost, DiscoverStats } from '@/types/discover';
import type { DiscoverLocalState } from './localState';

/**
 * The counts a card actually shows: the server numbers plus whatever the viewer
 * has done in this browser.
 *
 * The API deliberately does not fold these in (see MockDiscoverApi.decorate),
 * so a like updates the number the instant it is tapped, with no refetch and no
 * chance of counting the same like twice.
 */
export function viewerStats(post: DiscoverPost, state: DiscoverLocalState): DiscoverStats {
  const liked = state.likedPostIds.includes(post.id);
  const ownComments = (state.comments[post.id] ?? []).length;
  return {
    ...post.stats,
    likes: post.stats.likes + (liked ? 1 : 0),
    comments: post.stats.comments + ownComments,
  };
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
 * How a post's cover should be framed in the feed grid.
 *
 * A single portrait board (what a one screen post carries) would otherwise
 * render as a card two and a half times taller than it is wide and shove the
 * rest of the grid off screen, so anything close to portrait is letterboxed
 * into the same 3:1 strip the multi screen covers already use.
 */
export function coverBox(image: DiscoverImage | undefined): { aspect: string; fit: 'cover' | 'contain' } {
  if (!image) return { aspect: '3 / 1', fit: 'contain' };
  const [width, height] = image.aspect.split('/').map((part) => Number.parseFloat(part.trim()));
  const ratio = width && height ? width / height : 3;
  if (ratio < 1.2) return { aspect: '3 / 1', fit: 'contain' };
  return { aspect: image.aspect, fit: image.fit };
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
