"use client";

// The reviews of one app or of all of them, with the user's marks, tags and
// templates, read again whenever a refresh or an edit writes.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { onGrowthChange, readReviewMarks, readReviews } from './db';
import { readTags, readTemplates } from './reviewInbox';
import type { ReplyTemplate, ReviewMark, ReviewTag, StoreReview } from './types';

export interface ReviewInboxData {
  loaded: boolean;
  /** Newest first. */
  reviews: StoreReview[];
  marks: Map<string, ReviewMark>;
  tags: ReviewTag[];
  templates: ReplyTemplate[];
  reload: () => void;
}

const EMPTY: Omit<ReviewInboxData, 'reload'> = { loaded: false, reviews: [], marks: new Map(), tags: [], templates: [] };

export function useReviewInbox(appIds: string[]): ReviewInboxData {
  const key = appIds.join('\n');
  const [data, setData] = useState<Omit<ReviewInboxData, 'reload'> & { key: string }>({ ...EMPTY, key: '' });
  const [epoch, setEpoch] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const ids = key ? key.split('\n') : [];
    let scheduled = false;
    const read = () =>
      void Promise.all([Promise.all(ids.map((id) => readReviews(id))), readReviewMarks(ids), readTags(), readTemplates()]).then(
        ([lists, marks, tags, templates]) => {
          if (cancelled) return;
          const reviews = lists.flat().sort((a, b) => b.createdDate.localeCompare(a.createdDate));
          setData({ key, loaded: true, reviews, marks: new Map(marks.map((mark) => [mark.id, mark])), tags, templates });
        },
        (error) => {
          console.error('Reading the reviews failed', error);
          if (!cancelled) setData((current) => ({ ...current, key, loaded: true }));
        }
      );
    read();
    const unsubscribe = onGrowthChange((changed) => {
      if (changed !== null && !ids.includes(changed)) return;
      // A refresh writes in bursts; one read per short pause is plenty.
      if (scheduled) return;
      scheduled = true;
      window.setTimeout(() => {
        scheduled = false;
        if (!cancelled) read();
      }, 120);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [key, epoch]);

  const reload = useCallback(() => setEpoch((value) => value + 1), []);
  return useMemo(() => {
    const current = data.key === key ? data : { ...EMPTY, key };
    return { loaded: current.loaded, reviews: current.reviews, marks: current.marks, tags: current.tags, templates: current.templates, reload };
  }, [data, key, reload]);
}
