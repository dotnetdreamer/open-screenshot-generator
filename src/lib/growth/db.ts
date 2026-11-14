// Where the growth numbers live: a Dexie database of their own, beside the
// project database rather than inside it.
//
// Apart on purpose. Nothing here belongs to a project, so a project export,
// a cloud save or a version snapshot must never carry it; and a schema change
// here should never put a migration in front of somebody's designs. Clearing
// it loses nothing App Store Connect cannot send again.
//
// Writes announce themselves through `onGrowthChange`, so an open Growth
// window re-reads after a sync without polling. The announcement stays inside
// this window: a second editor window reads the database when it opens Growth.

import Dexie, { type Table } from 'dexie';
import type { DayRecord, ListingSnapshot, RatingDay, ReviewMark, StoreReview, TerritoryRating, TimelineEvent } from './types';

export interface MetaRow {
  key: string;
  value: unknown;
}

class GrowthDatabase extends Dexie {
  days!: Table<DayRecord, string>;
  reviews!: Table<StoreReview, string>;
  ratings!: Table<TerritoryRating, string>;
  events!: Table<TimelineEvent, string>;
  listings!: Table<ListingSnapshot, string>;
  meta!: Table<MetaRow, string>;
  ratingDays!: Table<RatingDay, string>;
  reviewMarks!: Table<ReviewMark, string>;

  constructor() {
    super('OpenScreenshotGeneratorGrowth');
    this.version(1).stores({
      days: 'key, appId, [appId+date]',
      reviews: 'id, appId, [appId+createdDate]',
      ratings: 'key, appId',
      events: 'id, appId, [appId+date]',
      listings: 'appId',
      meta: 'key',
    });
    // The ratings history (ratingHistory.ts) and what the user did with each
    // review (reviewInbox.ts).
    this.version(2).stores({
      ratingDays: 'key, appId, [appId+date]',
      reviewMarks: 'id, appId',
    });
  }
}

let instance: GrowthDatabase | null = null;

function db(): GrowthDatabase {
  if (!instance) instance = new GrowthDatabase();
  return instance;
}

const listeners = new Set<(appId: string | null) => void>();

export function onGrowthChange(listener: (appId: string | null) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function announceGrowthChange(appId: string | null): void {
  for (const listener of listeners) listener(appId);
}

export async function readDays(appId: string): Promise<DayRecord[]> {
  return db().days.where('[appId+date]').between([appId, Dexie.minKey], [appId, Dexie.maxKey]).toArray();
}

export async function readDay(appId: string, date: string): Promise<DayRecord | undefined> {
  return db().days.get(`${appId}|${date}`);
}

export async function writeDays(records: DayRecord[]): Promise<void> {
  if (records.length === 0) return;
  await db().days.bulkPut(records);
}

export async function readReviews(appId: string): Promise<StoreReview[]> {
  const rows = await db().reviews.where('appId').equals(appId).toArray();
  return rows.sort((a, b) => b.createdDate.localeCompare(a.createdDate));
}

export async function writeReviews(reviews: StoreReview[]): Promise<void> {
  if (reviews.length === 0) return;
  await db().reviews.bulkPut(reviews);
}

export async function writeReview(review: StoreReview): Promise<void> {
  await db().reviews.put(review);
  announceGrowthChange(review.appId);
}

export async function readRatings(appId: string): Promise<TerritoryRating[]> {
  return db().ratings.where('appId').equals(appId).toArray();
}

export async function writeRatings(ratings: TerritoryRating[]): Promise<void> {
  if (ratings.length === 0) return;
  await db().ratings.bulkPut(ratings);
}

/** Every day of ratings stored for an app, oldest first. */
export async function readRatingDays(appId: string): Promise<RatingDay[]> {
  return db().ratingDays.where('[appId+date]').between([appId, Dexie.minKey], [appId, Dexie.maxKey]).toArray();
}

export async function readRatingDay(appId: string, date: string): Promise<RatingDay | undefined> {
  return db().ratingDays.get(`${appId}|${date}`);
}

export async function writeRatingDays(rows: RatingDay[]): Promise<void> {
  if (rows.length === 0) return;
  await db().ratingDays.bulkPut(rows);
}

/**
 * Read a day of ratings, change it and write it back as one transaction, so
 * two reads of the same day (a sweep, and a competitors check in another
 * window) cannot write over each other.
 */
export async function updateRatingDays(appId: string, dates: string[], change: (date: string, row: RatingDay | undefined) => RatingDay | null): Promise<void> {
  if (dates.length === 0) return;
  const database = db();
  await database.transaction('rw', database.ratingDays, async () => {
    for (const date of dates) {
      const next = change(date, await database.ratingDays.get(`${appId}|${date}`));
      if (next) await database.ratingDays.put(next);
    }
  });
}

/** Forget the ratings history of apps, for competitors no list follows any more. */
export async function deleteRatingDays(appIds: string[]): Promise<void> {
  if (appIds.length === 0) return;
  await db().ratingDays.where('appId').anyOf(appIds).delete();
}

export async function readReviewMarks(appIds: string[]): Promise<ReviewMark[]> {
  if (appIds.length === 0) return [];
  return db().reviewMarks.where('appId').anyOf(appIds).toArray();
}

/** Change the marks of some reviews in one go: `change` gets the stored mark, or none, and answers the new one, or null to delete it. */
export async function updateReviewMarks(
  reviews: Array<{ id: string; appId: string }>,
  change: (mark: ReviewMark | undefined, review: { id: string; appId: string }) => ReviewMark | null
): Promise<void> {
  if (reviews.length === 0) return;
  const database = db();
  await database.transaction('rw', database.reviewMarks, async () => {
    for (const review of reviews) {
      const next = change(await database.reviewMarks.get(review.id), review);
      if (next) await database.reviewMarks.put(next);
      else await database.reviewMarks.delete(review.id);
    }
  });
  for (const appId of new Set(reviews.map((review) => review.appId))) announceGrowthChange(appId);
}

/** Take a tag off every review that has it, for deleting the tag. */
export async function dropTagEverywhere(tagId: string): Promise<void> {
  const database = db();
  const touched = new Set<string>();
  await database.transaction('rw', database.reviewMarks, async () => {
    const marks = await database.reviewMarks.filter((mark) => mark.tags.includes(tagId)).toArray();
    for (const mark of marks) {
      touched.add(mark.appId);
      const tags = mark.tags.filter((id) => id !== tagId);
      if (tags.length === 0 && !mark.doneAt) await database.reviewMarks.delete(mark.id);
      else await database.reviewMarks.put({ ...mark, tags, updatedAt: Date.now() });
    }
  });
  for (const appId of touched) announceGrowthChange(appId);
}

export async function readEvents(appId: string): Promise<TimelineEvent[]> {
  const rows = await db().events.where('appId').equals(appId).toArray();
  return rows.sort((a, b) => a.date.localeCompare(b.date));
}

export async function writeEvent(event: TimelineEvent): Promise<void> {
  await db().events.put(event);
  announceGrowthChange(event.appId);
}

export async function writeEvents(events: TimelineEvent[]): Promise<void> {
  if (events.length === 0) return;
  await db().events.bulkPut(events);
}

export async function deleteEvent(event: TimelineEvent): Promise<void> {
  await db().events.delete(event.id);
  announceGrowthChange(event.appId);
}

export async function readListing(appId: string): Promise<ListingSnapshot | undefined> {
  return db().listings.get(appId);
}

export async function writeListing(listing: ListingSnapshot): Promise<void> {
  await db().listings.put(listing);
}

export async function readMeta<T>(key: string): Promise<T | undefined> {
  const row = await db().meta.get(key);
  return row?.value as T | undefined;
}

export async function writeMeta(key: string, value: unknown): Promise<void> {
  await db().meta.put({ key, value });
}

export async function deleteMeta(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  await db().meta.bulkDelete(keys);
}

/** Every meta row whose key starts with `prefix`, such as each app's last sync time. */
export async function readMetaWithPrefix<T>(prefix: string): Promise<Array<{ key: string; value: T }>> {
  const rows = await db().meta.where('key').startsWith(prefix).toArray();
  return rows.map((row) => ({ key: row.key, value: row.value as T }));
}

/**
 * Forget what a sync can fetch again, for "Remove this app's data". Timeline
 * entries the editor or the user wrote are kept: no sync can bring back the
 * record of when a screenshot set was uploaded, or a campaign someone typed in.
 * The ratings history and the review marks stay for the same reason: the
 * stores keep no history of ratings, and tags are the user's own work.
 */
export async function clearApp(appId: string): Promise<void> {
  const database = db();
  await database.transaction('rw', [database.days, database.reviews, database.ratings, database.events, database.listings, database.meta], async () => {
    await database.days.where('appId').equals(appId).delete();
    await database.reviews.where('appId').equals(appId).delete();
    await database.ratings.where('appId').equals(appId).delete();
    await database.events.where('appId').equals(appId).filter((event) => event.origin === 'auto').delete();
    await database.listings.delete(appId);
    // This app's own keys, matched as a whole id (app 123 must not take app
    // 1234 with it), and the record of which Sales and Trends days were
    // fetched: that list is per vendor, and left behind it would make the next
    // sync skip every day whose rows were just deleted.
    // Competitors (`rivals:` keys) stay: the apps followed are the user's
    // choice, and what those apps showed before cannot be fetched again.
    const own = new RegExp(`:${appId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(:|$)`);
    const keys = (await database.meta.toCollection().primaryKeys())
      .map(String)
      .filter((key) => !key.startsWith('rivals:') && (own.test(key) || key.startsWith('sales:days:')));
    await database.meta.bulkDelete(keys);
  });
  announceGrowthChange(appId);
}
