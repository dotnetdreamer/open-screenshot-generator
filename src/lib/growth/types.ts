// Growth: what an app is doing on the App Store or Google Play, beside the
// screenshots that sell it.
//
// Everything here is read with the user's own keys, the same ones the publish
// dialog uploads with (an App Store Connect API key, a Google Play service
// account key), and kept on this machine in its own IndexedDB database
// (./db.ts). There is no server in between and nothing is sent anywhere but
// Apple, Google, the iTunes lookup service and, when the user asks a question,
// the AI they chose. A Google Play app's id is `play:` and its package name
// (stores.ts).
//
// Four App Store feeds fill it, each with a different source and a different delay:
//
//   engagement  Analytics Reports, "App Store Discovery and Engagement":
//               impressions and product page views, a day or two late
//   downloads   Analytics Reports, "App Store Downloads": first-time downloads
//               and redownloads by source and page type, as late
//   sales       Sales and Trends, the daily SUMMARY report: units, updates,
//               in-app purchases and proceeds; needs the vendor number
//   reviews     customerReviews, written reviews and the replies to them
//
// plus ratings per storefront from the public lookup service, and the listing
// itself (name, subtitle, keywords, description) from the version records.
//
// A Google Play app has two feeds of numbers, both from the monthly report
// files Play Console keeps in a Cloud Storage bucket (playReports.ts):
//
//   installs    installs by country: new users and updates, a few days late
//   visits      store listing visitors and acquisitions, by country and by
//               traffic source, from the store performance report
//
// plus reviews and the listing from the Play Developer API (play.ts).

/** A calendar day in UTC, `YYYY-MM-DD`. Every date in this feature is one. */
export type DayString = string;

/**
 * Where a person found the app, from the analytics reports' Source Type. The
 * raw values are long English phrases, so they are folded into these ids.
 */
export type SourceType =
  | 'search'
  | 'browse'
  | 'app-referrer'
  | 'web-referrer'
  | 'app-clip'
  | 'notification'
  | 'institutional'
  | 'unavailable';

export const SOURCE_TYPES: SourceType[] = [
  'search',
  'browse',
  'app-referrer',
  'web-referrer',
  'app-clip',
  'notification',
  'institutional',
  'unavailable',
];

export const SOURCE_LABELS: Record<SourceType, string> = {
  search: 'App Store search',
  browse: 'App Store browsing',
  'app-referrer': 'Other apps',
  'web-referrer': 'Websites',
  'app-clip': 'App Clips',
  notification: 'Notifications',
  institutional: 'Schools and businesses',
  unavailable: 'Other',
};

/** Google Play's traffic sources, by the names Play Console uses (playSourceType folds them in). */
const PLAY_SOURCE_LABELS: Partial<Record<SourceType, string>> = {
  search: 'Google Play search',
  browse: 'Google Play explore',
  'web-referrer': 'Ads and links from other apps and websites',
  unavailable: 'Other',
};

/** Where people found the app, in the words of the app's store. `store` is 'appstore' or 'playstore'. */
export function sourceLabel(source: SourceType | string, store: 'appstore' | 'playstore' = 'appstore'): string {
  const key = source as SourceType;
  return (store === 'playstore' ? PLAY_SOURCE_LABELS[key] : undefined) ?? SOURCE_LABELS[key] ?? source;
}

/**
 * Counts for one slice of one day. Every field is optional because each feed
 * fills only its own: a day can have downloads from Sales and Trends long
 * before the analytics reports reach it.
 */
export interface Counts {
  // App Store Discovery and Engagement
  impressions?: number;
  uniqueImpressions?: number;
  pageViews?: number;
  uniquePageViews?: number;
  // App Store Downloads (analytics)
  firstDownloads?: number;
  redownloads?: number;
  /** First-time downloads and redownloads that started on the product page. */
  pageDownloads?: number;
  // Sales and Trends
  /** First-time downloads or purchases of the app itself. */
  units?: number;
  /** Redownloads, as Sales and Trends counts them. */
  reunits?: number;
  updates?: number;
  iapUnits?: number;
  /** Developer proceeds per currency of proceeds. Refunds are negative. */
  proceeds?: Record<string, number>;
}

export type FeedId = 'engagement' | 'downloads' | 'sales' | 'installs' | 'visits';

/**
 * Which fields belong to which feed. A feed that reports a day replaces
 * exactly these. `installs` and `visits` are Google Play's: an App Store app
 * never has them, and a Google Play app has nothing else.
 */
export const FEED_FIELDS: Record<FeedId, Array<keyof Counts>> = {
  engagement: ['impressions', 'uniqueImpressions', 'pageViews', 'uniquePageViews'],
  downloads: ['firstDownloads', 'redownloads', 'pageDownloads'],
  sales: ['units', 'reunits', 'updates', 'iapUnits', 'proceeds'],
  installs: ['firstDownloads', 'updates'],
  visits: ['pageViews', 'uniquePageViews', 'pageDownloads'],
};

/**
 * One app's day, stored as one row. Breakdowns are maps rather than rows of
 * their own, so a year of a busy app is 365 rows instead of several hundred
 * thousand, and every chart is a loop over those.
 */
export interface DayRecord {
  /** `${appId}|${date}` */
  key: string;
  appId: string;
  date: DayString;
  /** By App Store territory, ISO 3166-1 alpha-2. `ZZ` when the report had none. */
  territories: Record<string, Counts>;
  /** By source. Only the analytics feeds know the source, so sales never land here. */
  sources: Partial<Record<SourceType, Counts>>;
  /** By device family (iPhone, iPad, Mac...), from the analytics feeds. */
  devices?: Record<string, Counts>;
  /** When each feed last wrote this day, in ms. Absent means that feed has not reported it. */
  feeds: Partial<Record<FeedId, number>>;
}

/** One written review, as App Store Connect or Google Play lists it. */
export interface StoreReview {
  id: string;
  appId: string;
  rating: number;
  title: string;
  body: string;
  nickname: string;
  /** ISO timestamp. On Google Play, when the review was written or last changed. */
  createdDate: string;
  /**
   * ISO 3166-1 alpha-2, converted from Apple's three letter code. Google Play
   * does not say where a reviewer is, so its reviews are `ZZ`.
   */
  territory: string;
  /** Google Play only: the language the reviewer uses, such as `en-US` or `de`. */
  language?: string;
  /** Google Play only: the app version the reviewer had. */
  appVersion?: string;
  response?: ReviewResponse;
}

export interface ReviewResponse {
  id: string;
  body: string;
  lastModified: string;
  /** PUBLISHED or PENDING_PUBLISH. Apple checks every reply before it is shown; Google Play shows a reply at once. */
  state: string;
}

/** The star rating in one storefront, from the public lookup service. */
export interface TerritoryRating {
  /** `${appId}|${territory}` */
  key: string;
  appId: string;
  territory: string;
  average: number;
  count: number;
  /** Ratings of the current version only, where the storefront reports them. */
  currentAverage?: number;
  currentCount?: number;
  checkedAt: number;
}

/**
 * Something that happened to the app, drawn on every chart so a change in the
 * numbers can be read against it. New screenshots published from the editor
 * are recorded on their own, which is what lets the timeline say whether a
 * design did better than the one before it.
 */
export type TimelineEventKind =
  | 'release'
  | 'screenshots'
  | 'listing'
  | 'price'
  | 'campaign'
  | 'featured'
  | 'in-app-event'
  | 'note';

export const EVENT_KIND_LABELS: Record<TimelineEventKind, string> = {
  release: 'New version',
  screenshots: 'New screenshots',
  listing: 'Store page change',
  price: 'Price change',
  campaign: 'Ad campaign',
  featured: 'Featured',
  'in-app-event': 'In-app event',
  note: 'Note',
};

export interface TimelineEvent {
  id: string;
  appId: string;
  date: DayString;
  kind: TimelineEventKind;
  title: string;
  detail?: string;
  /** auto: read from App Store Connect. publish: the editor uploaded screenshots. manual: typed in. */
  origin: 'auto' | 'publish' | 'manual' | 'listing';
  /**
   * The app version this is about: the one released, or the one screenshots
   * were uploaded to. A screenshots event is measured from that version's
   * release, since the store shows nothing new before then.
   */
  version?: string;
  /** The project the screenshots were made in, so the timeline can open it again. */
  projectId?: string;
  projectName?: string;
  /** Store locales the upload covered. */
  locales?: string[];
  screenshotCount?: number;
  /**
   * Google Play only: the day the user said the change went live. Set when a
   * change waited for them to send it for review in Play Console.
   */
  liveDate?: DayString;
  /**
   * Google Play only: Play took the change without sending it for review, so
   * it is not on the store until the user sends it from Play Console.
   */
  waitsForReview?: boolean;
  createdAt: number;
}

export type ListingField =
  | 'name'
  | 'subtitle'
  | 'keywords'
  | 'promotionalText'
  | 'description'
  | 'whatsNew';

export const LISTING_FIELDS: ListingField[] = [
  'name',
  'subtitle',
  'keywords',
  'promotionalText',
  'description',
  'whatsNew',
];

/** Apple's character limits, from App Store Connect's own form. Google Play's are in listingFields.ts. */
export const LISTING_LIMITS: Record<ListingField, number> = {
  name: 30,
  subtitle: 30,
  keywords: 100,
  promotionalText: 170,
  description: 4000,
  whatsNew: 4000,
};

export const LISTING_FIELD_LABELS: Record<ListingField, string> = {
  name: 'Name',
  subtitle: 'Subtitle',
  keywords: 'Keywords',
  promotionalText: 'Promotional text',
  description: 'Description',
  whatsNew: "What's new",
};

/**
 * One language of the listing, joined from the app info and the version record.
 * A Google Play listing fills three fields: its title is `name`, its short
 * description `subtitle`, and its full description `description`.
 */
export interface ListingLocale {
  /** The store's locale code: en-US, de-DE, ja on the App Store; en-US, de-DE, ja-JP on Google Play. */
  locale: string;
  versionLocalizationId?: string;
  appInfoLocalizationId?: string;
  name: string;
  subtitle: string;
  keywords: string;
  promotionalText: string;
  description: string;
  whatsNew: string;
  /** Screenshots per display type, when they were counted. */
  screenshotCounts?: Record<string, number>;
}

export interface ListingSnapshot {
  appId: string;
  /** Empty for Google Play, where the store page has no version. */
  versionId: string;
  versionString: string;
  state: string;
  platform: string;
  /** The version's own fields (keywords, description, what's new) can be written. */
  editable: boolean;
  /** Name and subtitle live on the app info, which has an editable state of its own. */
  appInfoEditable: boolean;
  primaryLocale: string;
  locales: ListingLocale[];
  fetchedAt: number;
}

/** A proposed edit, shown as before and after until the user applies it. */
export interface ListingChange {
  locale: string;
  field: ListingField;
  before: string;
  after: string;
  reason?: string;
}

export type IssueSeverity = 'problem' | 'warning' | 'tip';

export interface ListingIssue {
  /** Stable, so the list can be keyed and a fixed issue disappears. */
  id: string;
  locale: string;
  field?: ListingField;
  severity: IssueSeverity;
  title: string;
  detail: string;
  /** A ready fix, when there is a single right answer (a duplicate keyword removed, say). */
  fix?: ListingChange;
}

export type InsightCategory =
  | 'discovery'
  | 'conversion'
  | 'downloads'
  | 'revenue'
  | 'ratings'
  | 'reviews'
  | 'markets'
  | 'listing'
  | 'screenshots'
  | 'milestones';

export const INSIGHT_CATEGORY_LABELS: Record<InsightCategory, string> = {
  discovery: 'Times seen',
  conversion: 'Download rate',
  downloads: 'Downloads',
  revenue: 'Earnings',
  ratings: 'Ratings',
  reviews: 'Reviews',
  markets: 'Countries',
  listing: 'Store page',
  screenshots: 'Screenshots',
  milestones: 'Milestones',
};

export type InsightTone = 'good' | 'neutral' | 'warning' | 'problem';

export type InsightAction =
  | { kind: 'reviews'; rating?: number; unanswered?: boolean; topic?: string }
  | { kind: 'listing'; locale?: string }
  | { kind: 'markets'; territory?: string }
  | { kind: 'timeline'; eventId?: string }
  | { kind: 'localize'; locales: string[] }
  | { kind: 'publish' }
  | { kind: 'ask'; question: string };

export interface Insight {
  /** Stable across runs (kind plus whatever it is about), so a dismissal sticks. */
  id: string;
  appId: string;
  kind: string;
  category: InsightCategory;
  tone: InsightTone;
  title: string;
  body: string;
  /** The day the insight is about, for sorting. */
  date: DayString;
  /** How much it matters, 0 to 100, for the order on the overview. */
  weight: number;
  metric?: { label: string; value: string; delta?: number };
  action?: InsightAction;
}

export type FeedState =
  | 'idle'
  | 'syncing'
  | 'ok'
  /** Connected and working, with nothing to report yet (no reviews, no data for the period). */
  | 'empty'
  /** Something the user has to provide first: a vendor number, the analytics switch. */
  | 'needs-setup'
  /** Apple's analytics reports were requested and are being made, which takes a day or two. */
  | 'pending'
  /** The key's role cannot read this feed. */
  | 'forbidden'
  | 'error';

export interface FeedStatus {
  state: FeedState;
  message?: string;
  updatedAt?: number;
  /**
   * Sales and Trends only: the first of the days read without a gap up to the
   * newest one. An app with no rows has no downloads from then on, and
   * nothing is known about the days before it.
   */
  since?: DayString;
}

export type GrowthFeed = 'reviews' | 'sales' | 'analytics' | 'ratings' | 'listing';

export type SyncStatus = Record<GrowthFeed, FeedStatus>;

export interface SyncProgress {
  label: string;
  done: number;
  total: number;
}

/** An app the account can see, as the picker lists it. */
export interface GrowthApp {
  /** App Store Connect's id, or `play:` and the package name for Google Play (stores.ts). */
  id: string;
  name: string;
  /** The bundle id, or the package name on Google Play. */
  bundleId: string;
  iconUrl?: string;
}
