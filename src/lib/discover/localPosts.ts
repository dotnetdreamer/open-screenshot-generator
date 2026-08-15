// Posts the viewer published from their own project.
//
// The images are real PNG captures of their artboards, so they are blobs and
// they belong in IndexedDB next to the other binaries this app stores (screen
// recordings, imported fonts), not in localStorage. The row keeps the post
// document and its blobs side by side; object URLs are minted on read and
// cached per image id, the same arrangement mediaStore.ts uses, so a feed that
// re-renders does not leak a URL per render.
//
// When a backend exists this becomes the outbox: publish uploads the blobs,
// the server hands back real URLs, and the row is either dropped or kept as a
// local draft. Nothing else in the feature has to change.

import { db } from '@/database';
import type { DiscoverPost } from '@/types/discover';

export interface DiscoverPostRow {
  id: string;
  /** Indexed, so the outbox reads back newest first. */
  createdAt: Date;
  /**
   * The post as published, with every image `src` blanked: a blob: URL from a
   * previous session is dead on the next one, so it must never be persisted.
   */
  post: DiscoverPost;
  /** One blob per entry in post.images, in the same order. */
  images: Blob[];
}

const urlCache = new Map<string, string>();

function mintUrl(imageId: string, blob: Blob): string {
  const cached = urlCache.get(imageId);
  if (cached) return cached;
  const url = URL.createObjectURL(blob);
  urlCache.set(imageId, url);
  return url;
}

function releaseUrls(post: DiscoverPost): void {
  for (const image of post.images) {
    const url = urlCache.get(image.id);
    if (!url) continue;
    URL.revokeObjectURL(url);
    urlCache.delete(image.id);
  }
}

/** Rehydrate a stored row into a post whose images an <img> can render. */
function toPost(row: DiscoverPostRow): DiscoverPost {
  return {
    ...row.post,
    isMine: true,
    images: row.post.images.map((image, index) => ({
      ...image,
      src: row.images[index] ? mintUrl(image.id, row.images[index]) : '',
    })),
  };
}

export async function saveLocalPost(post: DiscoverPost, images: Blob[]): Promise<void> {
  await db.discoverPosts.put({
    id: post.id,
    createdAt: new Date(post.createdAt),
    post: { ...post, images: post.images.map((image) => ({ ...image, src: '' })) },
    images,
  });
}

/** Newest first, matching how the feed shows a viewer their own posts. */
export async function listLocalPosts(): Promise<DiscoverPost[]> {
  const rows = await db.discoverPosts.orderBy('createdAt').reverse().toArray();
  return rows.map(toPost);
}

export async function getLocalPost(id: string): Promise<DiscoverPost | null> {
  const row = await db.discoverPosts.get(id);
  return row ? toPost(row) : null;
}

export async function deleteLocalPost(id: string): Promise<void> {
  const row = await db.discoverPosts.get(id);
  if (row) releaseUrls(row.post);
  await db.discoverPosts.delete(id);
}
