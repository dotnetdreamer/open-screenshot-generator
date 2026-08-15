// The one door between the Discover UI and the community backend.
//
// Every component imports `discoverApi` and nothing else. Behind it is
// PocketBase on the VPS (infra/vps), reached over plain fetch: the routes are
// custom hooks rather than PocketBase's record API, so there is no SDK to pull
// in and no collection rules to reason about from here. Each method below names
// the request it makes:
//
//   listFeed        GET    /api/openscreengen/discover/feed?sort&scope&surface&tag&q&cursor
//   getPost         GET    /api/openscreengen/discover/posts/:id
//   listTags        GET    /api/openscreengen/discover/tags
//   listComments    GET    /api/openscreengen/discover/posts/:id/comments
//   addComment      POST   /api/openscreengen/discover/posts/:id/comments
//   deleteComment   DELETE /api/openscreengen/discover/comments/:id
//   setLike         PUT    /api/openscreengen/discover/posts/:id/like
//   setSaved        PUT    /api/openscreengen/discover/posts/:id/save
//   setCommentLike  PUT    /api/openscreengen/discover/comments/:id/like
//   setFollow       PUT    /api/openscreengen/discover/authors/:id/follow
//   publishPost     POST   /api/openscreengen/discover/posts            (multipart)
//   deletePost      DELETE /api/openscreengen/discover/posts/:id
//   recordRemix     POST   /api/openscreengen/discover/posts/:id/remix
//
// The four reads work signed out and are what a guest sees. The rest need the
// community token from session.ts, and the server refuses them without one —
// the UI hiding those buttons is courtesy, not the permission.
//
// With NEXT_PUBLIC_DISCOVER_URL unset the whole feature is off: every read
// answers empty and every write throws DiscoverDisabledError, so a fork of this
// repo with no backend still builds, runs and exports exactly as before.

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
import {
  DISCOVER_URL,
  authHeaders,
  discoverUrl,
  getDiscoverSession,
  isDiscoverConfigured,
  clearDiscoverSession,
} from './session';

export interface DiscoverApi {
  /**
   * Kept for the call sites that hand the feed the app's template catalog.
   *
   * The feed used to be built from it. It is served now, so this does nothing
   * and returns void — the signature stays so the two panels that call it need
   * no edit, and so the next backend can ignore it just as cheaply.
   */
  seed(templates: Project[]): void;
  /** Who the viewer posts and comments as, or null when signed out. */
  getViewer(): DiscoverAuthor | null;
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

/** This build has no community backend. Thrown only from the write paths. */
export class DiscoverDisabledError extends Error {
  constructor() {
    super('The community feed is not available in this build.');
    this.name = 'DiscoverDisabledError';
  }
}

/** The server refused, with a message worth putting in front of somebody. */
export class DiscoverRequestError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'DiscoverRequestError';
    this.status = status;
  }
}

/** A write attempted while signed out. The UI turns this into a sign-in prompt. */
export class DiscoverSignInRequiredError extends Error {
  constructor(message = 'Sign in to do that.') {
    super(message);
    this.name = 'DiscoverSignInRequiredError';
  }
}

const EMPTY_PAGE: DiscoverFeedPage = { posts: [], nextCursor: null, total: 0 };

/**
 * One request, with the two failures that mean something teased apart.
 *
 * A 401 drops the stored token as it goes past. A community session outlives the
 * storage sign-in it came from, so the ordinary way one dies is quietly, in a
 * tab left open — and a client that keeps sending a dead token turns every
 * button into the same silent failure. Dropping it here means the next render
 * sees a guest and offers the sign-in.
 */
async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  if (!isDiscoverConfigured()) throw new DiscoverDisabledError();

  let response: Response;
  try {
    response = await fetch(`${DISCOVER_URL}${path}`, {
      ...init,
      headers: { ...authHeaders(), ...((init.headers as Record<string, string>) ?? {}) },
    });
  } catch {
    throw new DiscoverRequestError('The community feed could not be reached.', 0);
  }

  if (response.status === 401) {
    clearDiscoverSession();
    throw new DiscoverSignInRequiredError();
  }

  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new DiscoverRequestError(
      typeof payload.error === 'string' ? payload.error : 'That did not work.',
      response.status
    );
  }
  return payload as T;
}

/** A write, refused early when there is nobody to attribute it to. */
function requireSession(): void {
  if (!isDiscoverConfigured()) throw new DiscoverDisabledError();
  if (!getDiscoverSession()) throw new DiscoverSignInRequiredError();
}

/**
 * Absolute image URLs, applied on the way in.
 *
 * The server hands back paths so the same record works against any box. The UI
 * puts `image.src` straight into an `<img>`, so the join happens once, here,
 * rather than in five components that would each have to remember.
 */
function absolutize(post: DiscoverPost): DiscoverPost {
  return {
    ...post,
    author: {
      ...post.author,
      avatarUrl: post.author.avatarUrl ? discoverUrl(post.author.avatarUrl) : undefined,
    },
    images: post.images.map((image) => ({ ...image, src: discoverUrl(image.src) })),
  };
}

function absolutizeComment(comment: DiscoverComment): DiscoverComment {
  return {
    ...comment,
    author: {
      ...comment.author,
      avatarUrl: comment.author.avatarUrl ? discoverUrl(comment.author.avatarUrl) : undefined,
    },
  };
}

class PocketBaseDiscoverApi implements DiscoverApi {
  seed(): void {
    // The feed is served. Nothing to do, and deliberately not an error: the two
    // panels that call this should not have to know that changed.
  }

  getViewer(): DiscoverAuthor | null {
    return getDiscoverSession()?.viewer ?? null;
  }

  async listFeed(query: DiscoverFeedQuery): Promise<DiscoverFeedPage> {
    if (!isDiscoverConfigured()) return EMPTY_PAGE;

    /*
     * The three viewer-scoped tabs are answered locally when there is nobody to
     * answer them about.
     *
     * The server refuses them with a 401 either way, and the client turns that
     * into the same empty page — but making the request first has two costs
     * worth avoiding. It puts a red 401 in the console of every signed-out
     * visitor who clicks Following, which is not an error and reads like one to
     * whoever opens devtools next; and `request` drops the stored token on any
     * 401, which is right for a token the server rejected and pointless work for
     * a tab that was never going to be allowed.
     */
    if (
      (query.scope === 'following' || query.scope === 'saved' || query.scope === 'mine') &&
      !getDiscoverSession()
    ) {
      return EMPTY_PAGE;
    }

    const params = new URLSearchParams();
    if (query.sort) params.set('sort', query.sort);
    if (query.scope) params.set('scope', query.scope);
    if (query.surface && query.surface !== 'all') params.set('surface', query.surface);
    if (query.tag) params.set('tag', query.tag);
    if (query.search) params.set('q', query.search);
    if (query.cursor) params.set('cursor', query.cursor);
    if (query.limit) params.set('limit', String(query.limit));

    try {
      const page = await request<{
        posts: DiscoverPost[];
        nextCursor: string | null;
        total: number;
      }>(`/api/openscreengen/discover/feed?${params.toString()}`);
      return {
        posts: (page.posts ?? []).map(absolutize),
        nextCursor: page.nextCursor ?? null,
        total: page.total ?? 0,
      };
    } catch (error) {
      // The three scopes that need a session answer 401 when it has lapsed.
      // An empty tab is the honest render of "you are not signed in", and the
      // sign-in prompt beside it is what the UI shows instead of an error.
      if (error instanceof DiscoverSignInRequiredError) return EMPTY_PAGE;
      throw error;
    }
  }

  async getPost(postId: string): Promise<DiscoverPost | null> {
    if (!isDiscoverConfigured()) return null;
    try {
      const payload = await request<{ post: DiscoverPost }>(
        `/api/openscreengen/discover/posts/${encodeURIComponent(postId)}`
      );
      return payload.post ? absolutize(payload.post) : null;
    } catch (error) {
      // A ?post= link to something deleted is a normal thing to arrive with.
      if (error instanceof DiscoverRequestError && error.status === 404) return null;
      throw error;
    }
  }

  async listTags(): Promise<DiscoverTagCount[]> {
    if (!isDiscoverConfigured()) return [];
    const payload = await request<{ tags: DiscoverTagCount[] }>('/api/openscreengen/discover/tags');
    return payload.tags ?? [];
  }

  async listComments(postId: string): Promise<DiscoverComment[]> {
    if (!isDiscoverConfigured()) return [];
    const payload = await request<{ comments: DiscoverComment[] }>(
      `/api/openscreengen/discover/posts/${encodeURIComponent(postId)}/comments`
    );
    return (payload.comments ?? []).map(absolutizeComment);
  }

  async addComment(postId: string, body: string): Promise<DiscoverComment> {
    requireSession();
    const payload = await request<{ comment: DiscoverComment }>(
      `/api/openscreengen/discover/posts/${encodeURIComponent(postId)}/comments`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body }),
      }
    );
    return absolutizeComment(payload.comment);
  }

  async deleteComment(_postId: string, commentId: string): Promise<void> {
    requireSession();
    await request(`/api/openscreengen/discover/comments/${encodeURIComponent(commentId)}`, {
      method: 'DELETE',
    });
  }

  async setLike(postId: string, liked: boolean): Promise<void> {
    requireSession();
    await request(`/api/openscreengen/discover/posts/${encodeURIComponent(postId)}/like`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ on: liked }),
    });
  }

  async setSaved(postId: string, saved: boolean): Promise<void> {
    requireSession();
    await request(`/api/openscreengen/discover/posts/${encodeURIComponent(postId)}/save`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ on: saved }),
    });
  }

  async setCommentLike(commentId: string, liked: boolean): Promise<void> {
    requireSession();
    await request(`/api/openscreengen/discover/comments/${encodeURIComponent(commentId)}/like`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ on: liked }),
    });
  }

  async setFollow(authorId: string, following: boolean): Promise<void> {
    requireSession();
    await request(`/api/openscreengen/discover/authors/${encodeURIComponent(authorId)}/follow`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ on: following }),
    });
  }

  /**
   * Publish, as multipart.
   *
   * The screens are blobs straight off the canvas capture, so this is a real
   * file upload rather than base64 in a JSON body: PocketBase stores them as
   * files, generates the thumbnails the grid loads, and serves them from
   * /api/files without any of it passing through a string twice.
   *
   * `image_meta` travels beside them as one JSON field, one entry per file in
   * the same order. The server refuses the post if those two lengths disagree,
   * because a mismatch would render somebody's screen at the wrong aspect ratio
   * in a public feed with nothing to point at.
   */
  async publishPost(input: PublishPostInput): Promise<DiscoverPost> {
    requireSession();

    const form = new FormData();
    form.set('title', input.title.trim());
    form.set('caption', input.caption.trim());
    form.set('tags', input.tags.join(','));
    form.set('surface', input.surface);
    form.set('screens', String(input.screens));
    if (input.appName) form.set('app_name', input.appName);
    if (input.templateProjectId) form.set('template_project_id', input.templateProjectId);
    form.set(
      'image_meta',
      JSON.stringify(
        input.images.map((image) => ({
          aspect: image.aspect,
          fit: image.fit,
          label: image.label,
        }))
      )
    );
    input.images.forEach((image, index) => {
      // A filename is required by the multipart encoding and is never shown:
      // PocketBase renames every upload to its own hashed form on save.
      form.append('images', image.blob, `screen-${index + 1}.png`);
    });

    const payload = await request<{ post: DiscoverPost }>('/api/openscreengen/discover/posts', {
      method: 'POST',
      // No Content-Type: the browser sets it, with the multipart boundary that
      // it alone knows. Setting it by hand produces a body the server cannot
      // parse, and the error names neither the header nor the boundary.
      body: form,
    });
    return absolutize(payload.post);
  }

  async deletePost(postId: string): Promise<void> {
    requireSession();
    await request(`/api/openscreengen/discover/posts/${encodeURIComponent(postId)}`, { method: 'DELETE' });
  }

  /**
   * Somebody opened this design as a starting point.
   *
   * The one write a guest may make, so it does not call requireSession, and it
   * swallows its own failures: "Use as template" has to open the project
   * whatever the backend says about a counter.
   */
  async recordRemix(postId: string): Promise<void> {
    if (!isDiscoverConfigured()) return;
    try {
      await request(`/api/openscreengen/discover/posts/${encodeURIComponent(postId)}/remix`, {
        method: 'POST',
      });
    } catch {
      // A remix count is not worth a failed open.
    }
  }
}

export const discoverApi: DiscoverApi = new PocketBaseDiscoverApi();
