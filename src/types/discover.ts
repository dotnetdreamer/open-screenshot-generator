// Discover: the community feed where people share the screenshots they built.
//
// Everything here is transport-agnostic on purpose. The UI only ever talks to
// the DiscoverApi (src/lib/discover/api.ts), and today the only implementation
// is a mock one that seeds itself from the bundled template catalog and keeps
// the viewer's own activity in local storage. Swapping in a real backend means
// writing a second implementation of that one interface: no component below
// src/components/open-screenshot-generator/discover/ knows where a post came
// from.
//
// Dates travel as ISO strings, matching ProjectManifest, so a post survives
// JSON.stringify on the way into storage and back out of an HTTP response
// without a Date/string split brain.

/** The surface a post was designed for. Mirrors TEMPLATE_CATEGORIES ids. */
export type DiscoverSurface =
  | 'screenshots'
  | 'apple-watch'
  | 'mac'
  | 'app-preview'
  | 'play-feature-graphic';

/** A person in the feed. `id` is stable; `handle` is what the UI shows. */
export interface DiscoverAuthor {
  id: string;
  /** Without the leading @, which the UI adds. */
  handle: string;
  name: string;
  /** One line under the name on a post detail. */
  bio?: string;
  /** Absolute or root-relative image. Absent means the initials avatar. */
  avatarUrl?: string;
  /** Shown as a small check next to the name. Purely cosmetic. */
  verified?: boolean;
  followers: number;
  /** Set on the viewer's own author record so the UI can label their posts. */
  isViewer?: boolean;
}

/**
 * One image in a post.
 *
 * `src` is whatever an <img> can render: a public path (seeded posts), a
 * blob: URL minted from IndexedDB (posts the viewer published), or an https
 * URL once a backend serves them. `aspect` is a CSS aspect-ratio string and
 * `fit` says whether cropping it is acceptable, exactly like the template
 * gallery treats its own previews: a wide strip of phone screens must never be
 * cropped, a 1024x500 banner may fill its box.
 */
export interface DiscoverImage {
  id: string;
  src: string;
  aspect: string;
  fit: 'cover' | 'contain';
  /** Board name behind the image, shown under the carousel. */
  label?: string;
}

/** Counters shown on a card. Server-owned in a real backend. */
export interface DiscoverStats {
  likes: number;
  comments: number;
  views: number;
  /** How many people opened this post as a starting point for their own. */
  remixes: number;
}

export interface DiscoverPost {
  id: string;
  author: DiscoverAuthor;
  title: string;
  /** Body copy under the title. Plain text, no markdown. */
  caption: string;
  tags: string[];
  surface: DiscoverSurface;
  images: DiscoverImage[];
  /** Artboard count of the design behind the post, for the "N screens" badge. */
  screens: number;
  createdAt: string; // ISO
  stats: DiscoverStats;
  /**
   * Set when the post was built on a bundled template, so "Use as template"
   * can open the real thing. Matches Project.id (`template_<file>`).
   */
  templateProjectId?: string;
  /** The app the design is for, when the author named one. */
  appName?: string;
  /** True for posts this viewer published from their own project. */
  isMine?: boolean;
  /** Viewer-relative flags, merged in by the API from local state. */
  likedByViewer?: boolean;
  savedByViewer?: boolean;
}

export interface DiscoverComment {
  id: string;
  postId: string;
  author: DiscoverAuthor;
  body: string;
  createdAt: string; // ISO
  likes: number;
  /** Written by the viewer in this browser, so it can be deleted again. */
  isMine?: boolean;
}

/** Sort orders offered by the feed tabs. */
export type DiscoverSort = 'for-you' | 'trending' | 'newest' | 'top';

/** A saved/following/mine cut of the feed, orthogonal to the sort. */
export type DiscoverScope = 'all' | 'following' | 'saved' | 'mine';

export interface DiscoverFeedQuery {
  sort?: DiscoverSort;
  scope?: DiscoverScope;
  /** 'all' or a single surface id. */
  surface?: DiscoverSurface | 'all';
  /** Single tag filter, lower case. */
  tag?: string;
  /** Free text over title, caption, tags, author and app name. */
  search?: string;
  /** Opaque cursor from the previous page. Absent means start at the top. */
  cursor?: string | null;
  limit?: number;
}

export interface DiscoverFeedPage {
  posts: DiscoverPost[];
  /** Pass back as `cursor` for the next page. null means the end of the feed. */
  nextCursor: string | null;
  /** Total matches for the query, so the UI can show a result count. */
  total: number;
}

/** A tag plus how many posts carry it, for the filter chips. */
export interface DiscoverTagCount {
  tag: string;
  count: number;
}

/** What the share form hands the API. Images arrive as blobs, not URLs. */
export interface PublishPostInput {
  title: string;
  caption: string;
  tags: string[];
  surface: DiscoverSurface;
  appName?: string;
  screens: number;
  images: PublishImageInput[];
  /** Carried through so a shared post can still open its source template. */
  templateProjectId?: string;
}

export interface PublishImageInput {
  blob: Blob;
  aspect: string;
  fit: 'cover' | 'contain';
  label?: string;
}
