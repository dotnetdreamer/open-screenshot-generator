// A made-up app with half a year of plausible numbers, for the tests: the
// unit tests run the metrics and insight rules on it, and the Growth specs
// write it into the growth database of a connected test account
// (tests/e2e/specs/growth.spec.ts), so every screen is filled the same way on
// every run. The app itself only ever shows what App Store Connect sent.
//
// The story it tells is the one the feature exists for: a new screenshot set
// uploaded to version 2.4 goes live with that release and lifts conversion by
// about a fifth; the App Store features the app for two days near the end;
// Japan reads the listing in English; a handful of recent one star reviews
// complain about crashes and nobody has answered them yet.
//
// Everything is drawn from a seeded generator and laid out relative to
// yesterday, so the numbers are identical on every machine and the dates always
// look current.

import { addDays, today } from '@/lib/growth/dates';
import { emptyFeedDay, feedDayFor, mergeFeed, type FeedBatch } from '@/lib/growth/records';
import type {
  DayRecord,
  GrowthApp,
  ListingSnapshot,
  SourceType,
  StoreReview,
  TerritoryRating,
  TimelineEvent,
} from '@/lib/growth/types';

export const SAMPLE_APP_ID = 'sample-app';

export const SAMPLE_APP: GrowthApp = {
  id: SAMPLE_APP_ID,
  name: 'Juniper: Habit Tracker',
  bundleId: 'com.example.juniper',
};

/** Days of history. */
const SPAN = 180;

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Market {
  code: string;
  share: number;
  currency: string;
  /** Local currency units per US dollar, roughly, for in-app purchase proceeds. */
  rate: number;
  /** How well the listing converts there, against the average. */
  convert: number;
}

const MARKETS: Market[] = [
  { code: 'US', share: 0.34, currency: 'USD', rate: 1, convert: 1.1 },
  { code: 'GB', share: 0.08, currency: 'GBP', rate: 0.79, convert: 1.05 },
  { code: 'DE', share: 0.08, currency: 'EUR', rate: 0.92, convert: 1.0 },
  { code: 'JP', share: 0.07, currency: 'JPY', rate: 150, convert: 0.42 },
  { code: 'FR', share: 0.05, currency: 'EUR', rate: 0.92, convert: 0.95 },
  { code: 'BR', share: 0.06, currency: 'BRL', rate: 5.1, convert: 1.05 },
  { code: 'CA', share: 0.05, currency: 'CAD', rate: 1.36, convert: 1.1 },
  { code: 'AU', share: 0.04, currency: 'AUD', rate: 1.52, convert: 1.1 },
  { code: 'IN', share: 0.05, currency: 'INR', rate: 83, convert: 0.8 },
  { code: 'MX', share: 0.04, currency: 'MXN', rate: 17, convert: 1.0 },
  { code: 'ES', share: 0.03, currency: 'EUR', rate: 0.92, convert: 1.0 },
  { code: 'IT', share: 0.03, currency: 'EUR', rate: 0.92, convert: 0.95 },
  { code: 'KR', share: 0.02, currency: 'KRW', rate: 1330, convert: 0.6 },
  { code: 'NL', share: 0.03, currency: 'EUR', rate: 0.92, convert: 1.05 },
  { code: 'SE', share: 0.03, currency: 'SEK', rate: 10.5, convert: 1.0 },
];

const SOURCES: Array<{ source: SourceType; share: number; convert: number }> = [
  { source: 'search', share: 0.62, convert: 1.15 },
  { source: 'browse', share: 0.21, convert: 0.55 },
  { source: 'app-referrer', share: 0.08, convert: 1.3 },
  { source: 'web-referrer', share: 0.06, convert: 1.4 },
  { source: 'unavailable', share: 0.03, convert: 0.8 },
];

/** Day offsets from the newest sales day, which is yesterday. */
export const SAMPLE_OFFSETS = {
  release23: 75,
  campaign: 50,
  shotsUploaded: 24,
  release24: 20,
  featured: 6,
};

function lastDay(): string {
  return addDays(today(), -1);
}

/** Every stored day of the sample app. Engagement and analytics downloads stop two days back, as Apple's do. */
export function sampleRecords(): DayRecord[] {
  const random = mulberry32(0x5eed);
  const end = lastDay();
  const engagement: FeedBatch = new Map();
  const downloads: FeedBatch = new Map();
  const sales: FeedBatch = new Map();

  for (let back = SPAN - 1; back >= 0; back -= 1) {
    const date = addDays(end, -back);
    const index = SPAN - 1 - back;
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    const weekend = weekday === 0 || weekday === 6 ? 1.12 : 1;
    const trend = 1 + (index / SPAN) * 0.35;
    const campaign = back <= SAMPLE_OFFSETS.campaign && back > SAMPLE_OFFSETS.campaign - 7 ? 1.18 : 1;
    const noise = 0.92 + random() * 0.16;
    const impressions = Math.round(8200 * trend * weekend * campaign * noise);
    const featured = back === SAMPLE_OFFSETS.featured || back === SAMPLE_OFFSETS.featured - 1 ? 6.5 : 1;
    // The new set went live with 2.4.
    const lift = back < SAMPLE_OFFSETS.release24 ? 1.19 : 1;
    const conversion = 0.031 * lift * (0.96 + random() * 0.08);

    const engagementDay = feedDayFor(engagement, date);
    const downloadDay = feedDayFor(downloads, date);
    const salesDay = feedDayFor(sales, date);

    for (const market of MARKETS) {
      for (const source of SOURCES) {
        const sourceBoost = source.source === 'browse' ? featured : 1;
        const imp = Math.round(impressions * market.share * source.share * sourceBoost * (0.9 + random() * 0.2));
        if (imp <= 0) continue;
        const uniqueImp = Math.round(imp * 0.81);
        const views = Math.round(imp * (source.source === 'search' ? 0.1 : 0.16));
        const uniqueViews = Math.round(views * 0.86);
        const rate = conversion * market.convert * source.convert;
        const total = Math.round(uniqueImp * rate);
        const first = Math.round(total * 0.86);
        const re = total - first;
        const onPage = Math.round(total * 0.52);

        const add = (day: ReturnType<typeof emptyFeedDay>, counts: Record<string, number>) => {
          const territory = (day.territories[market.code] ??= {});
          const bySource = (day.sources[source.source] ??= {});
          const device = (day.devices.iPhone ??= {});
          for (const [field, value] of Object.entries(counts)) {
            for (const target of [territory, bySource, device] as Array<Record<string, number>>) {
              target[field] = (target[field] ?? 0) + value;
            }
          }
        };
        add(engagementDay, { impressions: imp, uniqueImpressions: uniqueImp, pageViews: views, uniquePageViews: uniqueViews });
        add(downloadDay, { firstDownloads: first, redownloads: re, pageDownloads: onPage });

        const territory = (salesDay.territories[market.code] ??= {});
        territory.units = (territory.units ?? 0) + Math.round(first * (0.98 + random() * 0.04));
        territory.reunits = (territory.reunits ?? 0) + re;
        territory.updates = (territory.updates ?? 0) + Math.round(first * 3.2 * (0.8 + random() * 0.4));
        const purchases = Math.round(first * 0.045 * (0.7 + random() * 0.6));
        territory.iapUnits = (territory.iapUnits ?? 0) + purchases;
        const proceeds = (territory.proceeds ??= {});
        proceeds[market.currency] =
          Math.round(((proceeds[market.currency] ?? 0) + purchases * 3.49 * market.rate) * 100) / 100;
      }
    }
  }

  const now = Date.now();
  const records = new Map<string, DayRecord>();
  const put = (feed: 'engagement' | 'downloads' | 'sales', batch: FeedBatch, skipNewest: number) => {
    for (const [date, day] of batch) {
      if (date > addDays(end, -skipNewest)) continue;
      records.set(date, mergeFeed(records.get(date), SAMPLE_APP_ID, date, feed, day, now));
    }
  };
  put('sales', sales, 0);
  put('engagement', engagement, 1);
  put('downloads', downloads, 1);
  return Array.from(records.values()).sort((a, b) => a.date.localeCompare(b.date));
}

export function sampleEvents(): TimelineEvent[] {
  const end = lastDay();
  const at = (back: number) => addDays(end, -back);
  const created = Date.now();
  return [
    {
      id: 'sample-release-23',
      appId: SAMPLE_APP_ID,
      date: at(SAMPLE_OFFSETS.release23),
      kind: 'release',
      title: 'Version 2.3 released',
      version: '2.3',
      origin: 'auto',
      createdAt: created,
    },
    {
      id: 'sample-campaign',
      appId: SAMPLE_APP_ID,
      date: at(SAMPLE_OFFSETS.campaign),
      kind: 'campaign',
      title: 'Spring promo on Instagram',
      detail: 'One week of story ads in the US and Brazil',
      origin: 'manual',
      createdAt: created,
    },
    {
      id: 'sample-screenshots',
      appId: SAMPLE_APP_ID,
      date: at(SAMPLE_OFFSETS.shotsUploaded),
      kind: 'screenshots',
      title: 'New screenshots uploaded',
      detail: '18 screenshots in 3 languages, from "Juniper store set"',
      version: '2.4',
      origin: 'publish',
      projectName: 'Juniper store set',
      locales: ['en-US', 'fr-FR', 'es-MX'],
      screenshotCount: 18,
      createdAt: created,
    },
    {
      id: 'sample-release-24',
      appId: SAMPLE_APP_ID,
      date: at(SAMPLE_OFFSETS.release24),
      kind: 'release',
      title: 'Version 2.4 released',
      version: '2.4',
      origin: 'auto',
      createdAt: created,
    },
  ];
}

const REVIEW_TEXTS: Array<{ rating: number; title: string; body: string; territory: string }> = [
  { rating: 5, title: 'Finally a habit app I stick with', body: 'The streak view is simple and the reminders are gentle. Three months in and still going.', territory: 'US' },
  { rating: 5, title: 'Love the widgets', body: 'Being able to tick off a habit from the home screen is the best feature. Great design.', territory: 'GB' },
  { rating: 4, title: 'Great, one wish', body: 'Would be nice to have a weekly goal instead of daily for some habits. Otherwise perfect.', territory: 'CA' },
  { rating: 5, title: 'Super App', body: 'Einfach, schön und ohne Werbung. Genau so muss eine Gewohnheiten App sein.', territory: 'DE' },
  { rating: 2, title: 'Abo zu teuer', body: 'Die App ist gut, aber das Abo ist für das, was es bietet, zu teuer.', territory: 'DE' },
  { rating: 5, title: 'Parfait', body: "Je l'utilise tous les jours, l'interface est claire et les rappels sont utiles.", territory: 'FR' },
  { rating: 4, title: 'Muito bom', body: 'Ótimo app para criar hábitos. Falta apenas sincronizar com o Apple Watch.', territory: 'BR' },
  { rating: 5, title: 'Me encanta', body: 'La mejor app de hábitos que he probado. Sencilla y bonita.', territory: 'MX' },
  { rating: 3, title: 'Good but sync is flaky', body: 'Sometimes my iPad does not show what I checked off on my phone. Please fix the sync.', territory: 'AU' },
  { rating: 5, title: 'Helped me quit smoking', body: 'Day 94 without a cigarette. The streak counter kept me going on the hard days.', territory: 'US' },
  { rating: 1, title: 'Lost my streaks', body: 'After restoring my phone all my history was gone. Lost data is unacceptable.', territory: 'US' },
  { rating: 5, title: '使いやすい', body: 'シンプルで使いやすいです。英語の部分が多いので日本語対応してほしい。', territory: 'JP' },
  { rating: 4, title: 'Nice and clean', body: 'Clean design, good reminders. The dark mode looks great.', territory: 'IN' },
  { rating: 5, title: 'Best habit tracker', body: 'Tried five others. This one is the only one that does not nag me with ads.', territory: 'US' },
  { rating: 2, title: 'Too pricey', body: 'The subscription price went up and I do not see what I get for it.', territory: 'GB' },
  { rating: 5, title: 'Perfetta', body: 'App perfetta per le abitudini quotidiane, la consiglio.', territory: 'IT' },
  { rating: 4, title: 'Fijne app', body: 'Werkt goed, alleen mis ik een export naar CSV.', territory: 'NL' },
  { rating: 5, title: 'Helt perfekt', body: 'Enkel och snygg. Påminnelserna är perfekta.', territory: 'SE' },
  { rating: 3, title: 'Okay', body: 'It is fine. Missing a way to pause a habit while on holiday.', territory: 'US' },
  { rating: 5, title: 'Daily driver', body: 'Opens fast, never gets in the way. Exactly what I wanted.', territory: 'US' },
];

const RECENT_CRASHES: Array<{ rating: number; title: string; body: string; territory: string }> = [
  { rating: 1, title: 'Crashes on launch', body: 'Since the last update the app crashes every time I open it. iPhone 15, latest iOS.', territory: 'US' },
  { rating: 1, title: 'Keeps crashing', body: 'Crashes when I open the stats tab. Please fix, I have a 200 day streak in here.', territory: 'GB' },
  { rating: 2, title: 'Stürzt ab', body: 'Seit dem Update stürzt die App beim Öffnen der Statistik ab.', territory: 'DE' },
  { rating: 1, title: 'Crash after update', body: 'The app crashes when I try to add a new habit. Was perfect before 2.4.1.', territory: 'CA' },
];

export function sampleReviews(): StoreReview[] {
  const random = mulberry32(0xbeef);
  const end = lastDay();
  const out: StoreReview[] = [];
  let id = 0;
  for (let round = 0; round < 4; round += 1) {
    for (const text of REVIEW_TEXTS) {
      const back = Math.floor(random() * 150) + 8;
      id += 1;
      const answered = random() < (text.rating <= 2 ? 0.5 : 0.25);
      out.push({
        id: `sample-review-${id}`,
        appId: SAMPLE_APP_ID,
        rating: text.rating,
        title: text.title,
        body: text.body,
        nickname: `user${(id * 7919) % 9973}`,
        createdDate: `${addDays(end, -back)}T${String(8 + (id % 12)).padStart(2, '0')}:14:00Z`,
        territory: text.territory,
        response: answered
          ? {
              id: `sample-response-${id}`,
              body:
                text.rating <= 2
                  ? 'Thank you for telling us. We have looked into this and a fix is on its way. Write to support@example.com and we will help you right away.'
                  : 'Thank you for the kind words. Stories like yours are why we build Juniper.',
              lastModified: `${addDays(end, -back + 1)}T10:00:00Z`,
              state: 'PUBLISHED',
            }
          : undefined,
      });
    }
  }
  RECENT_CRASHES.forEach((text, index) => {
    id += 1;
    out.push({
      id: `sample-review-${id}`,
      appId: SAMPLE_APP_ID,
      rating: text.rating,
      title: text.title,
      body: text.body,
      nickname: `user${(id * 7919) % 9973}`,
      createdDate: `${addDays(end, -(index * 2 + 1))}T${String(9 + index).padStart(2, '0')}:40:00Z`,
      territory: text.territory,
    });
  });
  return out.sort((a, b) => b.createdDate.localeCompare(a.createdDate));
}

export function sampleRatings(): TerritoryRating[] {
  const rows: Array<[string, number, number]> = [
    ['US', 4.6, 2310],
    ['GB', 4.5, 640],
    ['DE', 4.3, 410],
    ['FR', 4.4, 280],
    ['JP', 4.1, 190],
    ['CA', 4.6, 350],
    ['AU', 4.7, 220],
    ['BR', 4.4, 150],
    ['ES', 4.5, 120],
    ['IT', 4.4, 90],
    ['MX', 4.5, 110],
    ['IN', 4.2, 140],
    ['NL', 4.6, 60],
    ['SE', 4.5, 40],
    ['KR', 4.0, 50],
  ];
  const checkedAt = Date.now();
  return rows.map(([territory, average, count]) => ({
    key: `${SAMPLE_APP_ID}|${territory}`,
    appId: SAMPLE_APP_ID,
    territory,
    average,
    count,
    checkedAt,
  }));
}

export function sampleListing(): ListingSnapshot {
  return {
    appId: SAMPLE_APP_ID,
    versionId: 'sample-version-25',
    versionString: '2.5',
    state: 'PREPARE_FOR_SUBMISSION',
    platform: 'IOS',
    editable: true,
    appInfoEditable: true,
    primaryLocale: 'en-US',
    fetchedAt: Date.now(),
    locales: [
      {
        locale: 'en-US',
        name: 'Juniper: Habit Tracker',
        subtitle: 'Build habits, keep streaks',
        keywords: 'habit tracker, habits,routine,streak,goals,daily planner,todo,reminder,habit, self care,mood',
        promotionalText: 'New in 2.5: weekly goals and a calmer home screen widget.',
        description:
          'Juniper helps you build the habits you keep meaning to start, one small check at a time.\n\nTrack anything: water, reading, workouts, meditation, a daily walk. Juniper keeps your streaks, nudges you at the right moment, and shows how far you have come.\n\n- Streaks and calendars that make progress visible\n- Gentle reminders you set per habit\n- Home screen and Lock Screen widgets\n- iCloud sync between iPhone and iPad\n- No ads, ever\n\nJuniper Plus unlocks unlimited habits, detailed stats and themes.',
        whatsNew: 'Bug fixes and performance improvements.',
        screenshotCounts: { APP_IPHONE_67: 6, APP_IPAD_PRO_3GEN_129: 4 },
      },
      {
        locale: 'de-DE',
        name: 'Juniper: Gewohnheiten',
        subtitle: 'Gewohnheiten aufbauen',
        keywords: 'gewohnheit,routine,ziele,tracker,planer',
        promotionalText: '',
        description: 'Juniper hilft dir, gute Gewohnheiten aufzubauen. Streaks, Erinnerungen und Widgets.',
        whatsNew: 'Fehlerbehebungen.',
        screenshotCounts: {},
      },
      {
        locale: 'fr-FR',
        name: 'Juniper: Habit Tracker',
        subtitle: 'Build habits, keep streaks',
        keywords: 'habitudes,routine,objectifs,suivi,rappel',
        promotionalText: 'Nouveau : objectifs hebdomadaires.',
        description:
          "Juniper vous aide à prendre de bonnes habitudes, un petit pas à la fois. Suivez vos séries, recevez des rappels discrets et voyez vos progrès jour après jour. Widgets pour l'écran d'accueil, synchronisation iCloud et aucune publicité. Juniper Plus débloque les habitudes illimitées, les statistiques détaillées et les thèmes.",
        whatsNew: 'Objectifs hebdomadaires et nouveau widget.',
        screenshotCounts: { APP_IPHONE_67: 6 },
      },
      {
        locale: 'es-MX',
        name: 'Juniper: Hábitos diarios',
        subtitle: 'Rachas y recordatorios',
        keywords: 'habitos,rutina,metas,seguimiento,planificador,recordatorio',
        promotionalText: '',
        description:
          'Juniper te ayuda a crear los hábitos que siempre quisiste empezar. Lleva tus rachas, recibe recordatorios amables y mira tu progreso. Widgets, sincronización con iCloud y sin anuncios. Juniper Plus desbloquea hábitos ilimitados, estadísticas y temas.',
        whatsNew: 'Metas semanales y un widget nuevo.',
        screenshotCounts: { APP_IPHONE_67: 2 },
      },
    ],
  };
}
