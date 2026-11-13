// Reading everything stored for one app, outside React, so the Growth window
// and the agent's store tools (agentTools.ts) read the same thing.
//
// The sample app is built in memory instead of read, once per page: its
// numbers are generated, and writing half a year of them into somebody's
// IndexedDB to look at a demo would be rude. What a person does to the sample
// (a reply, a timeline note, a dismissed card) is stored like any other
// app's, under the sample's id, so the demo behaves like the real thing.

import { readDays, readEvents, readListing, readMeta, readRatings, readReviews } from './db';
import { sampleEvents, sampleListing, sampleRatings, sampleRecords, sampleReviews } from './sample';
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

let sampleCache: Pick<GrowthData, 'records' | 'reviews' | 'ratings' | 'events' | 'listing'> | null = null;

function sampleData() {
  if (!sampleCache) {
    sampleCache = {
      records: sampleRecords(),
      reviews: sampleReviews(),
      ratings: sampleRatings(),
      events: sampleEvents(),
      listing: sampleListing(),
    };
  }
  return sampleCache;
}

function mergeById<T extends { id: string }>(base: T[], overrides: T[]): T[] {
  const byId = new Map(base.map((item) => [item.id, item]));
  for (const item of overrides) byId.set(item.id, item);
  return Array.from(byId.values());
}

/** Everything stored for one app. Shared by the Growth window and the agent's store tools. */
export async function loadGrowthData(app: GrowthApp): Promise<GrowthData> {
  const [records, reviews, ratings, events, listing, live, lastSync, status, dismissed] = await Promise.all([
    app.sample ? Promise.resolve([] as DayRecord[]) : readDays(app.id),
    readReviews(app.id),
    app.sample ? Promise.resolve([] as TerritoryRating[]) : readRatings(app.id),
    readEvents(app.id),
    app.sample ? Promise.resolve(undefined) : readListing(app.id),
    readMeta<LiveListing>(metaKeys.live(app.id)),
    readMeta<number>(metaKeys.lastSync(app.id)),
    readMeta<SyncStatus>(metaKeys.status(app.id)),
    readMeta<string[]>(metaKeys.insightsDismissed(app.id)),
  ]);
  if (app.sample) {
    const sample = sampleData();
    const storedListing = await readListing(app.id);
    return {
      records: sample.records,
      reviews: mergeById(sample.reviews, reviews).sort((a, b) => b.createdDate.localeCompare(a.createdDate)),
      ratings: sample.ratings,
      events: mergeById(sample.events, events).sort((a, b) => a.date.localeCompare(b.date)),
      listing: storedListing ?? sample.listing,
      live: null,
      lastSync: null,
      status: IDLE_STATUS,
      dismissed: dismissed ?? [],
      loaded: true,
    };
  }
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
