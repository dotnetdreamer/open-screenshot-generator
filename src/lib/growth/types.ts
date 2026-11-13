// Growth: what an app is doing on the App Store, beside the screenshots that
// sell it.
//
// Everything here is read with the user's own App Store Connect API key, the
// same one the publish dialog uploads with, and kept on this machine in its own
// IndexedDB database (./db.ts). There is no server in between and nothing is
// sent anywhere but Apple, the iTunes lookup service and, when the user asks a
// question, the AI provider they configured.
//
// Four feeds fill it, each with a different source and a different delay:
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
  browse: 'App Store browse',
  'app-referrer': 'Other apps',
  'web-referrer': 'Websites',
  'app-clip': 'App Clips',
  notification: 'Notifications',
  institutional: 'Institutional',
  unavailable: 'Other',
};

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

export type FeedId = 'engagement' | 'downloads' | 'sales';

/** Which fields belong to which feed. A feed that reports a day replaces exactly these. */
export const FEED_FIELDS: Record<FeedId, Array<keyof Counts>> = {
  engagement: ['impressions', 'uniqueImpressions', 'pageViews', 'uniquePageViews'],
  downloads: ['firstDownloads', 'redownloads', 'pageDownloads'],
  sales: ['units', 'reunits', 'updates', 'iapUnits', 'proceeds'],
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

/** One written review, as App Store Connect lists it. */
export interface StoreReview {
  id: string;
  appId: string;
  rating: number;
  title: string;
  body: string;
  nickname: string;
  /** ISO timestamp. */
  createdDate: string;
  /** ISO 3166-1 alpha-2, converted from Apple's three letter code. */
  territory: string;
  response?: ReviewResponse;
}

export interface ReviewResponse {
  id: string;
  body: string;
  lastModified: string;
  /** PUBLISHED or PENDING_PUBLISH. Apple checks every reply before it is shown. */
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
  listing: 'Listing change',
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

/** Apple's character limits, from App Store Connect's own form. */
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

/** One language of the listing, joined from the app info and the version record. */
export interface ListingLocale {
  /** Apple's locale code: en-US, de-DE, ja. */
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
  discovery: 'Discovery',
  conversion: 'Conversion',
  downloads: 'Downloads',
  revenue: 'Revenue',
  ratings: 'Ratings',
  reviews: 'Reviews',
  markets: 'Markets',
  listing: 'Listing',
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
  id: string;
  name: string;
  bundleId: string;
  iconUrl?: string;
  /** The sample app, which exists on every machine and in the web build. */
  sample?: boolean;
}
