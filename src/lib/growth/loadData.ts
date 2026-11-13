// Reading everything stored for one app, outside React, so the Growth view
// and the agent's store tools (agentTools.ts) read the same thing.

import { readDays, readEvents, readListing, readMeta, readRatings, readReviews } from './db';
import { IDLE_STATUS, metaKeys, type LiveListing } from './sync';
import type {
  DayRecord,
  GrowthApp,
  ListingSnapshot,
  StoreReview,
  SyncStatus,
  TerritoryRating,
  TimelineEvent,
} from './types';

export interface GrowthData {
  records: DayRecord[];
  reviews: StoreReview[];
  ratings: TerritoryRating[];
  events: TimelineEvent[];
  listing: ListingSnapshot | null;
  live: LiveListing | null;
  lastSync: number | null;
  status: SyncStatus;
  dismissed: string[];
  loaded: boolean;
}

export const EMPTY_GROWTH_DATA: GrowthData = {
  records: [],
  reviews: [],
  ratings: [],
  events: [],
  listing: null,
  live: null,
  lastSync: null,
  status: IDLE_STATUS,
  dismissed: [],
  loaded: false,
};

/** Everything stored for one app. Shared by the Growth view and the agent's store tools. */
export async function loadGrowthData(app: GrowthApp): Promise<GrowthData> {
  const [records, reviews, ratings, events, listing, live, lastSync, status, dismissed] = await Promise.all([
    readDays(app.id),
    readReviews(app.id),
    readRatings(app.id),
    readEvents(app.id),
    readListing(app.id),
    readMeta<LiveListing>(metaKeys.live(app.id)),
    readMeta<number>(metaKeys.lastSync(app.id)),
    readMeta<SyncStatus>(metaKeys.status(app.id)),
    readMeta<string[]>(metaKeys.insightsDismissed(app.id)),
  ]);
  return {
    records: records.sort((a, b) => a.date.localeCompare(b.date)),
    reviews,
    ratings,
    events,
    listing: listing ?? null,
    live: live ?? null,
    lastSync: lastSync ?? null,
    status: { ...IDLE_STATUS, ...(status ?? {}) },
    dismissed: dismissed ?? [],
    loaded: true,
  };
}
