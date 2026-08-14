// The one door between the Discover UI and wherever the feed actually lives.
//
// Every component imports `discoverApi` and nothing else. Today that is
// MockDiscoverApi: the feed is seeded from the bundled template catalog, the
// viewer's likes/saves/follows/comments come from localStorage, and posts the
// viewer publishes come from IndexedDB. None of that leaks past this file.
//
// Wiring a backend later means writing a second class against DiscoverApi and
// changing the last line of this file. Each method below names the request it
// is standing in for, so the endpoints and this interface stay in step:
//
//   listFeed        GET    /v1/discover/feed?sort&scope&surface&tag&q&cursor
//   getPost         GET    /v1/discover/posts/:id
//   listTags        GET    /v1/discover/tags
//   listComments    GET    /v1/discover/posts/:id/comments
//   addComment      POST   /v1/discover/posts/:id/comments
//   deleteComment   DELETE /v1/discover/comments/:id
//   setLike         PUT    /v1/discover/posts/:id/like
//   setSaved        PUT    /v1/discover/posts/:id/save
//   setCommentLike  PUT    /v1/discover/comments/:id/like
//   setFollow       PUT    /v1/discover/authors/:id/follow
//   publishPost     POST   /v1/discover/posts            (multipart, images)
//   deletePost      DELETE /v1/discover/posts/:id
//   recordRemix     POST   /v1/discover/posts/:id/remix
//
// The viewer is whoever is connected in the account dialog (Drive or GitHub),
// falling back to a local identity they can rename in the share form. A real
// backend would replace that with its own session.

import type { Project } from '@/types/artboard';
import type {
  DiscoverAuthor,
  DiscoverComment,
  DiscoverFeedPage,
  DiscoverFeedQuery,
  DiscoverPost,
  DiscoverTagCount,
  PublishPostInput,
} from '@/types/discover';
import { getSession } from '@/lib/account/store';
import { buildSeedComments, buildSeedPosts } from './mockData';
import {
  addLocalComment,
  getLocalState,
  removeLocalComment,
  setAuthorFollowed,
  setCommentLiked,
  setPostLiked,
  setPostSaved,
} from './localState';
import { deleteLocalPost, listLocalPosts, saveLocalPost } from './localPosts';

export interface DiscoverApi {
  /**
   * Hand the feed the templates the app already loaded. Mock only: a backend
   * implementation ignores it, which is why it returns void and never throws.
   */
  seed(templates: Project[]): void;
  /** Who the viewer posts and comments as. */
  getViewer(): DiscoverAuthor;
  listFeed(query: DiscoverFeedQuery): Promise<DiscoverFeedPage>;
  getPost(postId: string): Promise<DiscoverPost | null>;
  listTags(): Promise<DiscoverTagCount[]>;
  listComments(postId: string): Promise<DiscoverComment[]>;
  addComment(postId: string, body: string): Promise<DiscoverComment>;
  deleteComment(postId: string, commentId: string): Promise<void>;
  setLike(postId: string, liked: boolean): Promise<void>;
  setSaved(postId: string, saved: boolean): Promise<void>;
  setCommentLike(commentId: string, liked: boolean): Promise<void>;
  setFollow(authorId: string, following: boolean): Promise<void>;
  publishPost(input: PublishPostInput): Promise<DiscoverPost>;
  deletePost(postId: string): Promise<void>;
  recordRemix(postId: string): Promise<void>;
}

const PAGE_SIZE = 12;

/** Stand-in for network time, so loading states are real and get exercised. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function matchesSearch(post: DiscoverPost, query: string): boolean {
  const haystack = [
    post.title,
    post.caption,
    post.appName ?? '',
    post.author.name,
    post.author.handle,
    post.tags.join(' '),
  ]
    .join(' ')
    .toLowerCase();
  // Space-insensitive second pass, so "appstore" still finds "App Store".
  return (
    haystack.includes(query) ||
    haystack.replace(/\s+/g, '').includes(query.replace(/\s+/g, ''))
  );
}

class MockDiscoverApi implements DiscoverApi {
  /** Posts built from the template catalog. Rebuilt only when it changes. */
  private seeded: DiscoverPost[] = [];
  private seedKey = '';
  /** Posts the viewer published, read back from IndexedDB once per session. */
  private localPosts: DiscoverPost[] | null = null;
  /** Remix counts this session, so "Use as template" visibly does something. */
  private remixBumps = new Map<string, number>();
  /** One clock for the whole feed: see buildSeedPosts. */
  private readonly clock = Date.now();

  seed(templates: Project[]): void {
    if (templates.length === 0) return;
    const key = `${templates.length}:${templates[0]?.id ?? ''}:${templates[templates.length - 1]?.id ?? ''}`;
    if (key === this.seedKey) return;
    this.seedKey = key;
    this.seeded = buildSeedPosts(templates, this.clock);
  }

  getViewer(): DiscoverAuthor {
    const local = getLocalState().viewer;
    const account = getSession()?.account;
    const name = local?.name || account?.name || 'You';
    const handle =
      local?.handle ||
      // A GitHub login or a Google display name makes a better handle than a
      // placeholder, and it is what the rest of the app already shows.
      (account?.name ? account.name.toLowerCase().replace(/[^a-z0-9]+/g, '') : '') ||
      'you';
    return {
      id: 'author_viewer',
      handle,
      name,
      bio: 'Your designs',
      avatarUrl: account?.avatarUrl,
      followers: 0,
      isViewer: true,
    };
  }

  private async allPosts(): Promise<DiscoverPost[]> {
    if (this.localPosts === null) {
      try {
        this.localPosts = await listLocalPosts();
      } catch {
        // A blocked or upgrading IndexedDB must not take the feed down with it.
        this.localPosts = [];
      }
    }
    return [...this.localPosts, ...this.seeded];
  }

  /**
   * Attach the viewer's relationship to a post: the flags the buttons render
   * from, plus this session's remix bumps.
   *
   * Counts stay at their raw "server" value on purpose. The viewer's own like
   * and comments are added at render time from the local store
   * (viewerStats in format.ts), so a toggle updates the number instantly
   * without a refetch, and cannot be counted twice when one does happen.
   */
  private decorate(post: DiscoverPost): DiscoverPost {
    const state = getLocalState();
    return {
      ...post,
      likedByViewer: state.likedPostIds.includes(post.id),
      savedByViewer: state.savedPostIds.includes(post.id),
      stats: {
        ...post.stats,
        remixes: post.stats.remixes + (this.remixBumps.get(post.id) ?? 0),
      },
    };
  }

  /**
   * "For you" is a light personalization pass, not a recommender: posts by
   * people the viewer follows come first, then posts sharing a tag with
   * something they liked, then the trending order. It exists so the tab means
   * something the moment somebody follows one account.
   */
  private forYouScore(post: DiscoverPost, affinityTags: Set<string>, followed: Set<string>): number {
    let score = this.trendingScore(post);
    if (followed.has(post.author.id)) score *= 3;
    if (post.tags.some((tag) => affinityTags.has(tag))) score *= 1.6;
    if (post.isMine) score *= 1.2;
    return score;
  }

  /** Engagement decayed by age, so a week-old hit does not pin the top forever. */
  private trendingScore(post: DiscoverPost): number {
    const ageHours = Math.max(1, (this.clock - Date.parse(post.createdAt)) / 3_600_000);
    const engagement = post.stats.likes + post.stats.comments * 3 + post.stats.remixes * 2;
    return engagement / Math.pow(ageHours + 12, 0.6);
  }

  async listFeed(query: DiscoverFeedQuery): Promise<DiscoverFeedPage> {
    await delay(180);
    const state = getLocalState();
    const posts = (await this.allPosts()).map((post) => this.decorate(post));

    const scope = query.scope ?? 'all';
    const followed = new Set(state.followedAuthorIds);
    const search = query.search?.trim().toLowerCase() ?? '';

    let filtered = posts.filter((post) => {
      if (scope === 'saved' && !post.savedByViewer) return false;
      if (scope === 'following' && !followed.has(post.author.id)) return false;
      if (scope === 'mine' && !post.isMine) return false;
      if (query.surface && query.surface !== 'all' && post.surface !== query.surface) return false;
      if (query.tag && !post.tags.includes(query.tag)) return false;
      if (search && !matchesSearch(post, search)) return false;
      return true;
    });

    const affinityTags = new Set(
      posts.filter((post) => post.likedByViewer).flatMap((post) => post.tags)
    );

    const sort = query.sort ?? 'for-you';
    filtered = [...filtered].sort((a, b) => {
      // The viewer's own posts always lead their own tab, whatever the sort.
      if (scope === 'mine' || sort === 'newest') {
        return Date.parse(b.createdAt) - Date.parse(a.createdAt);
      }
      if (sort === 'top') return b.stats.likes - a.stats.likes;
      if (sort === 'trending') return this.trendingScore(b) - this.trendingScore(a);
      return (
        this.forYouScore(b, affinityTags, followed) - this.forYouScore(a, affinityTags, followed)
      );
    });

    const limit = query.limit ?? PAGE_SIZE;
    const start = query.cursor ? Number.parseInt(query.cursor, 10) || 0 : 0;
    const page = filtered.slice(start, start + limit);
    const next = start + limit;

    return {
      posts: page,
      nextCursor: next < filtered.length ? String(next) : null,
      total: filtered.length,
    };
  }

  async getPost(postId: string): Promise<DiscoverPost | null> {
    const posts = await this.allPosts();
    const post = posts.find((entry) => entry.id === postId);
    return post ? this.decorate(post) : null;
  }

  async listTags(): Promise<DiscoverTagCount[]> {
    const counts = new Map<string, number>();
    for (const post of await this.allPosts()) {
      for (const tag of post.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
  }

  async listComments(postId: string): Promise<DiscoverComment[]> {
    await delay(140);
    const post = (await this.allPosts()).find((entry) => entry.id === postId);
    // A post the viewer published has no seeded thread, only whatever they and
    // (later) other people wrote on it.
    const seeded = post && !post.isMine ? buildSeedComments(post, this.clock) : [];
    const mine = getLocalState().comments[postId] ?? [];
    return [...seeded, ...mine].sort(
      (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)
    );
  }

  async addComment(postId: string, body: string): Promise<DiscoverComment> {
    await delay(160);
    const comment: DiscoverComment = {
      id: `comment_local_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      postId,
      author: this.getViewer(),
      body: body.trim(),
      createdAt: new Date().toISOString(),
      likes: 0,
      isMine: true,
    };
    addLocalComment(comment);
    return comment;
  }

  async deleteComment(postId: string, commentId: string): Promise<void> {
    removeLocalComment(postId, commentId);
  }

  async setLike(postId: string, liked: boolean): Promise<void> {
    setPostLiked(postId, liked);
  }

  async setSaved(postId: string, saved: boolean): Promise<void> {
    setPostSaved(postId, saved);
  }

  async setCommentLike(commentId: string, liked: boolean): Promise<void> {
    setCommentLiked(commentId, liked);
  }

  async setFollow(authorId: string, following: boolean): Promise<void> {
    setAuthorFollowed(authorId, following);
  }

  async publishPost(input: PublishPostInput): Promise<DiscoverPost> {
    // Long enough to look like an upload, short enough not to feel broken.
    await delay(700);
    const id = `post_local_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const post: DiscoverPost = {
      id,
      author: this.getViewer(),
      title: input.title.trim(),
      caption: input.caption.trim(),
      tags: input.tags,
      surface: input.surface,
      screens: input.screens,
      createdAt: new Date().toISOString(),
      stats: { likes: 0, comments: 0, views: 0, remixes: 0 },
      templateProjectId: input.templateProjectId,
      appName: input.appName,
      isMine: true,
      images: input.images.map((image, index) => ({
        id: `${id}_img_${index}`,
        src: '',
        aspect: image.aspect,
        fit: image.fit,
        label: image.label,
      })),
    };

    await saveLocalPost(
      post,
      input.images.map((image) => image.blob)
    );
    // Read back through the store so the returned post carries blob: URLs that
    // are minted and cached exactly once, like every other post in the feed.
    this.localPosts = await listLocalPosts();
    return this.localPosts.find((entry) => entry.id === id) ?? post;
  }

  async deletePost(postId: string): Promise<void> {
    await deleteLocalPost(postId);
    this.localPosts = await listLocalPosts();
  }

  async recordRemix(postId: string): Promise<void> {
    this.remixBumps.set(postId, (this.remixBumps.get(postId) ?? 0) + 1);
  }
}

/** Swap this line for the HTTP implementation when the backend is ready. */
export const discoverApi: DiscoverApi = new MockDiscoverApi();
