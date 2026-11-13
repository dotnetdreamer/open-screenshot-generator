// Google Play's monthly report files, as Play Console keeps them in a Cloud
// Storage bucket for every developer account ("Download reports" in Play
// Console, under its "Copy Cloud Storage URI").
//
// One file per app, month and breakdown, named after all three, and rewritten
// as the month's days come in:
//
//   stats/installs/installs_<package>_<YYYYMM>_country.csv
//   stats/store_performance/store_performance_<package>_<YYYYMM>_country.csv
//   stats/store_performance/store_performance_<package>_<YYYYMM>_traffic_source.csv
//   stats/ratings/ratings_<package>_<YYYYMM>_overview.csv
//   stats/ratings/ratings_<package>_<YYYYMM>_country.csv
//   reviews/reviews_<package>_<YYYYMM>.csv
//
// The files are UTF-16 with a byte order mark, comma separated, with a header
// row. Columns are found by name (columnIndex ignores case and spacing), and a
// column Google renames or drops leaves its numbers out rather than wrong.
// A review's text can run over several lines inside its quotes, so the files
// are read with parseCsv, which keeps those together, and not line by line.

import { columnIndex, isGzip, gunzip, numberCell } from './delimited';
import { dayRange, monthStart, normalizeDay } from './dates';
import { bucket, emptyFeedDay, feedDayFor, type FeedBatch } from './records';
import { playLanguageTag, splitReviewText } from './play';
import { territoryCode, UNKNOWN_TERRITORY } from './territories';
import type { SourceType, StoreReview, TerritoryRating } from './types';

export type PlayReportKind = 'installs' | 'visits-country' | 'visits-source' | 'ratings-overview' | 'ratings-country' | 'reviews';

/** Where each kind of file is, as a prefix of its name, so one listing finds every month. */
export function reportPrefix(kind: PlayReportKind, packageName: string): string {
  switch (kind) {
    case 'installs':
      return `stats/installs/installs_${packageName}_`;
    case 'visits-country':
    case 'visits-source':
      return `stats/store_performance/store_performance_${packageName}_`;
    case 'ratings-overview':
    case 'ratings-country':
      return `stats/ratings/ratings_${packageName}_`;
    case 'reviews':
      return `reviews/reviews_${packageName}_`;
  }
}

/** The kind and month of a file, from its name, or null for a file Growth does not read. */
export function reportFile(name: string, packageName: string): { kind: PlayReportKind; month: string } | null {
  const escaped = packageName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns: Array<[PlayReportKind, RegExp]> = [
    ['installs', new RegExp(`^stats/installs/installs_${escaped}_(\\d{6})_country\\.csv$`)],
    ['visits-country', new RegExp(`^stats/store_performance/store_performance_${escaped}_(\\d{6})_country\\.csv$`)],
    ['visits-source', new RegExp(`^stats/store_performance/store_performance_${escaped}_(\\d{6})_traffic_source\\.csv$`)],
    ['ratings-overview', new RegExp(`^stats/ratings/ratings_${escaped}_(\\d{6})_overview\\.csv$`)],
    ['ratings-country', new RegExp(`^stats/ratings/ratings_${escaped}_(\\d{6})_country\\.csv$`)],
    ['reviews', new RegExp(`^reviews/reviews_${escaped}_(\\d{6})\\.csv$`)],
  ];
  for (const [kind, pattern] of patterns) {
    const match = pattern.exec(name);
    if (match) return { kind, month: match[1] };
  }
  return null;
}

/**
 * A report file as text. Play writes UTF-16 with a byte order mark; a file
 * without one is read as UTF-8, and a gzip file is unpacked first.
 */
export async function playReportText(bytes: Uint8Array): Promise<string> {
  const plain = isGzip(bytes) ? await gunzip(bytes) : bytes;
  let text: string;
  if (plain[0] === 0xff && plain[1] === 0xfe) text = new TextDecoder('utf-16le').decode(plain.subarray(2));
  else if (plain[0] === 0xfe && plain[1] === 0xff) text = new TextDecoder('utf-16be').decode(plain.subarray(2));
  else if (plain.length > 3 && plain[1] === 0 && plain[3] === 0) text = new TextDecoder('utf-16le').decode(plain);
  else text = new TextDecoder('utf-8').decode(plain);
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** Comma separated text with a header row, quotes honoured across line breaks. */
export function parseCsv(text: string): { header: string[]; rows: string[][] } {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const endRow = () => {
    row.push(field);
    field = '';
    if (row.some((value) => value.trim() !== '')) rows.push(row);
    row = [];
  };
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      endRow();
    } else {
      field += char;
    }
  }
  if (field !== '' || row.length > 0) endRow();
  const [header = [], ...body] = rows;
  return { header: header.map((name) => name.trim()), rows: body };
}

/**
 * The column of the first of `names` the header has. Unlike columnIndex, the
 * order of `names` decides, not the order of the columns: an installs file has
 * "Daily Device Upgrades" (zero in every real file) before "Update events".
 */
function firstColumn(header: string[], ...names: string[]): number {
  for (const name of names) {
    const index = columnIndex(header, name);
    if (index >= 0) return index;
  }
  return -1;
}

function cell(row: string[], index: number): string {
  return index >= 0 ? (row[index] ?? '').trim() : '';
}

/** Installs by country: new users and updates per day. */
export function parseInstallsReport(text: string): FeedBatch {
  const { header, rows } = parseCsv(text);
  const date = columnIndex(header, 'Date');
  const country = firstColumn(header, 'Country', 'Country/Region', 'Country / Region');
  // New users first: "User installs" in Play Console's words. Older files
  // only have device installs, which count a person once per device.
  const users = firstColumn(header, 'Daily User Installs', 'User Installs', 'New users');
  const devices = firstColumn(header, 'Daily Device Installs', 'Device Installs', 'Install events');
  const updates = firstColumn(header, 'Update events', 'Daily Device Upgrades', 'Device Upgrades');
  const batch: FeedBatch = new Map();
  if (date < 0 || (users < 0 && devices < 0)) return batch;
  for (const row of rows) {
    const day = normalizeDay(cell(row, date));
    if (!day) continue;
    const counts = bucket(feedDayFor(batch, day).territories, territoryOf(cell(row, country)));
    counts.firstDownloads = (counts.firstDownloads ?? 0) + numberCell(cell(row, users >= 0 ? users : devices));
    if (updates >= 0) counts.updates = (counts.updates ?? 0) + numberCell(cell(row, updates));
  }
  return batch;
}

/** A country cell as a two letter code. Small apps get one "Other" row a day for the countries Google groups together. */
function territoryOf(value: string): string {
  return value && !/^other$/i.test(value) ? territoryCode(value) : UNKNOWN_TERRITORY;
}

function storePerformanceColumns(header: string[]) {
  return {
    date: columnIndex(header, 'Date'),
    visitors: columnIndex(header, 'Store listing visitors', 'Store Listing Visitors'),
    acquisitions: columnIndex(header, 'Store listing acquisitions', 'Store Listing Acquisitions'),
  };
}

/** Store listing visitors and acquisitions by country. */
export function parseStorePerformanceByCountry(text: string): FeedBatch {
  const { header, rows } = parseCsv(text);
  const columns = storePerformanceColumns(header);
  const country = columnIndex(header, 'Country/Region', 'Country / Region', 'Country', 'Country Region');
  const batch: FeedBatch = new Map();
  if (columns.date < 0 || columns.visitors < 0) return batch;
  for (const row of rows) {
    const day = normalizeDay(cell(row, columns.date));
    if (!day) continue;
    const counts = bucket(feedDayFor(batch, day).territories, territoryOf(cell(row, country)));
    addVisits(counts, row, columns);
  }
  return batch;
}

/**
 * The traffic sources Google Play names, folded into Growth's: "Google Play
 * search", "Google Play explore", "Third-party referrals" or "Ads and
 * referrals", and "Other" for the small ones.
 */
export function playSourceType(value: string): SourceType {
  const text = value.toLowerCase();
  if (/search/.test(text)) return 'search';
  if (/explore|browse/.test(text)) return 'browse';
  if (/third|referr|external|utm|campaign|link|web/.test(text)) return 'web-referrer';
  return 'unavailable';
}

/** Store listing visitors and acquisitions by traffic source. */
export function parseStorePerformanceBySource(text: string): FeedBatch {
  const { header, rows } = parseCsv(text);
  const columns = storePerformanceColumns(header);
  const source = columnIndex(header, 'Traffic source', 'Traffic Source');
  const batch: FeedBatch = new Map();
  if (columns.date < 0 || columns.visitors < 0 || source < 0) return batch;
  for (const row of rows) {
    const day = normalizeDay(cell(row, columns.date));
    if (!day) continue;
    const counts = bucket(feedDayFor(batch, day).sources, playSourceType(cell(row, source)));
    addVisits(counts, row, columns);
  }
  return batch;
}

function addVisits(
  counts: { pageViews?: number; uniquePageViews?: number; pageDownloads?: number },
  row: string[],
  columns: { visitors: number; acquisitions: number }
): void {
  const visitors = numberCell(cell(row, columns.visitors));
  // Play counts visitors once a day, so they are both the visits and the people.
  counts.pageViews = (counts.pageViews ?? 0) + visitors;
  counts.uniquePageViews = (counts.uniquePageViews ?? 0) + visitors;
  counts.pageDownloads = (counts.pageDownloads ?? 0) + numberCell(cell(row, columns.acquisitions));
}

/**
 * A month's numbers with every day from the 1st to the newest day in the file.
 * Google writes no row for a day with nothing to report, which for a small
 * app is a real zero; the days after the newest one are not in yet.
 */
export function fillMonthDays(batch: FeedBatch): FeedBatch {
  const days = Array.from(batch.keys()).sort();
  const newest = days[days.length - 1];
  if (!newest) return batch;
  for (const day of dayRange(monthStart(newest), newest)) if (!batch.has(day)) batch.set(day, emptyFeedDay());
  return batch;
}

/** A rating cell: "4.31", or "NA" on a day without ratings. */
function ratingCell(value: string): number | null {
  const parsed = Number(value.replace(',', '.'));
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 5 ? parsed : null;
}

/**
 * The newest "Total Average Rating" in a ratings file, per country, or for
 * the whole app (`ZZ`) from the overview file. Play does not say how many
 * ratings there are, so the count is 0: unknown.
 */
export function parseRatingsReport(text: string, appId: string, checkedAt: number): TerritoryRating[] {
  const { header, rows } = parseCsv(text);
  const date = columnIndex(header, 'Date');
  const total = columnIndex(header, 'Total Average Rating');
  const country = columnIndex(header, 'Country', 'Country/Region', 'Country / Region');
  if (date < 0 || total < 0) return [];
  const newest = new Map<string, { day: string; average: number }>();
  for (const row of rows) {
    const day = normalizeDay(cell(row, date));
    const average = ratingCell(cell(row, total));
    if (!day || average === null) continue;
    const territory = country >= 0 ? territoryOf(cell(row, country)) : UNKNOWN_TERRITORY;
    const seen = newest.get(territory);
    if (!seen || day > seen.day) newest.set(territory, { day, average });
  }
  return Array.from(newest, ([territory, entry]) => ({
    key: `${appId}|${territory}`,
    appId,
    territory,
    average: entry.average,
    count: 0,
    checkedAt,
  }));
}

/** The review id inside a review's link, which is the id the Reviews API uses. */
function reviewIdOf(link: string): string | null {
  const match = /[?&]reviewid=([^&]+)/i.exec(link);
  return match ? decodeURIComponent(match[1]) : null;
}

function timeCell(millis: string, text: string): string {
  const value = Number(millis);
  if (Number.isFinite(value) && value > 0) return new Date(value).toISOString();
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : '';
}

/** A month's reviews: every rating with written text, and the reply to it. Ratings without text are left out. */
export function parseReviewsReport(text: string, appId: string): StoreReview[] {
  const { header, rows } = parseCsv(text);
  const columns = {
    language: columnIndex(header, 'Reviewer Language'),
    version: columnIndex(header, 'App Version Name'),
    submitted: columnIndex(header, 'Review Submit Date and Time'),
    submittedMillis: columnIndex(header, 'Review Submit Millis Since Epoch'),
    updated: columnIndex(header, 'Review Last Update Date and Time'),
    updatedMillis: columnIndex(header, 'Review Last Update Millis Since Epoch'),
    rating: columnIndex(header, 'Star Rating'),
    title: columnIndex(header, 'Review Title'),
    body: columnIndex(header, 'Review Text'),
    replied: columnIndex(header, 'Developer Reply Date and Time'),
    repliedMillis: columnIndex(header, 'Developer Reply Millis Since Epoch'),
    reply: columnIndex(header, 'Developer Reply Text'),
    link: columnIndex(header, 'Review Link'),
  };
  if (columns.rating < 0 || columns.body < 0) return [];
  const out: StoreReview[] = [];
  for (const row of rows) {
    const rating = numberCell(cell(row, columns.rating));
    const rawTitle = cell(row, columns.title);
    const rawBody = cell(row, columns.body);
    if (!rawBody && !rawTitle) continue;
    const id = reviewIdOf(cell(row, columns.link));
    if (!id || rating < 1) continue;
    const split = rawTitle ? { title: rawTitle, body: rawBody } : splitReviewText(rawBody);
    const reply = cell(row, columns.reply);
    out.push({
      id,
      appId,
      rating,
      title: split.title,
      body: split.body,
      nickname: '',
      createdDate:
        timeCell(cell(row, columns.updatedMillis), cell(row, columns.updated)) ||
        timeCell(cell(row, columns.submittedMillis), cell(row, columns.submitted)),
      territory: UNKNOWN_TERRITORY,
      language: playLanguageTag(cell(row, columns.language)),
      appVersion: cell(row, columns.version) || undefined,
      response: reply
        ? { id, body: reply, lastModified: timeCell(cell(row, columns.repliedMillis), cell(row, columns.replied)), state: 'PUBLISHED' }
        : undefined,
    });
  }
  return out;
}
