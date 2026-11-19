// Object URLs for the library's small copies, one per picture and version, so
// every list and palette tile showing a picture shares one decoded image (the
// reason Capture keeps small copies too: src/lib/capture/thumbnails.ts).

import { useEffect, useState } from 'react';
import type { LibraryImageRow } from '@/lib/cutout/library';

const MAX = 300;
const urls = new Map<string, string>();

function keyOf(row: LibraryImageRow): string {
  return `${row.id}|${row.mediaId ?? row.sourceMediaId ?? ''}|${row.thumb?.byteLength ?? 0}`;
}

/** The small copy of a library picture as a URL an <img> can show. */
export function thumbUrlOf(row: LibraryImageRow): string | null {
  if (!row.thumb) return null;
  const key = keyOf(row);
  const hit = urls.get(key);
  if (hit) return hit;
  const url = URL.createObjectURL(new Blob([row.thumb], { type: 'image/png' }));
  urls.set(key, url);
  while (urls.size > MAX) {
    const [oldest, oldUrl] = urls.entries().next().value as [string, string];
    urls.delete(oldest);
    URL.revokeObjectURL(oldUrl);
  }
  return url;
}

export function useThumbUrl(row: LibraryImageRow): string | null {
  const [url, setUrl] = useState<string | null>(null);
  const key = keyOf(row);
  useEffect(() => {
    setUrl(thumbUrlOf(row));
    // The key is what changes when the picture does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return url;
}
