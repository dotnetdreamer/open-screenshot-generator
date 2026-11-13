// The cards on the Insights screen: what changed, what is wrong, what to do.
//
// Every rule is computed here, on this machine, from the stored numbers; no AI
// is involved, so the cards appear with no provider set up and say the same
// thing every time for the same data. A rule fires only on enough volume to
// mean something (a 40% jump from 10 impressions to 14 is noise), and the
// rate-based ones only once a significance test agrees.
//
// Ids are stable for as long as the condition they describe: trend cards are
// keyed by the week of the newest data, so dismissing one hides it for that
// week and a new week's trend is a new card.

import { addDays, daysBetween, formatDay, weekStart, type DayWindow } from './dates';
import { formatCount, formatMoney, formatRate, formatRating, plural } from './format';
import {
  confidenceBar,
  describeEvents,
  eventImpact,
  formatChange,
  isFeatureSpike,
  proportionConfidence,
  CONFIDENT,
  MIN_DAYS_AFTER,
} from './impact';
import {
  byTerritory,
  bySource,
  compareWindows,
  completeThrough,
  dailySeries,
  indexRecords,
  proceedsCurrency,
  relativeChange,
  totalsFor,
  type Totals,
} from './metrics';
import {
  REVIEW_TOPIC_LABELS,
  averageRating,
  recentReviews,
  reviewDay,
  reviewsIn,
  topicCounts,
  unansweredLow,
} from './reviewTopics';
import { languageCovers, listingLanguageFor, listingLanguageName, territoryName } from './territories';
import {
  SOURCE_LABELS,
  type DayRecord,
  type DayString,
  type Insight,
  type ListingIssue,
  type ListingSnapshot,
  type SourceType,
  type StoreReview,
  type TerritoryRating,
  type TimelineEvent,
} from './types';

export interface InsightInput {
  appId: string;
  records: DayRecord[];
  reviews: StoreReview[];
  ratings: TerritoryRating[];
  events: TimelineEvent[];
  listing: ListingSnapshot | null;
  listingIssues: ListingIssue[];
  /** Today, for the reviews, which arrive faster than the numbers. */
  today: DayString;
}

/** Below this many prior impressions, a percentage change in them is noise. */
const MIN_IMPRESSIONS = 500;
const MIN_DOWNLOADS = 50;
/** A language card needs this much traffic in the app overall... */
const LOCALIZE_MIN_BASE_VIEWS = 500;
const LOCALIZE_MIN_BASE_DOWNLOADS = 150;
/** ...and this much from the language itself. At most three such cards show. */
const LOCALIZE_MIN_VIEWS = 40;
const LOCALIZE_MIN_DOWNLOADS = 15;
const MILESTONES = [1_000, 5_000, 10_000, 25_000, 50_000, 100_000, 250_000, 500_000, 1_000_000, 5_000_000, 10_000_000];

export function buildInsights(input: InsightInput): Insight[] {
  const out: Insight[] = [];
  const byDate = indexRecords(input.records);
  const latest = completeThrough(input.records);
  if (latest) {
    const window: DayWindow = { from: addDays(latest, -13), to: latest };
    const week = weekStart(latest);
    const ctx: Ctx = { input, byDate, latest, window, week, out };
    discovery(ctx);
    featured(ctx);
    conversion(ctx);
    downloads(ctx);
    milestones(ctx);
    revenue(ctx);
    markets(ctx);
    screenshots(ctx);
  }
  reviewInsights(input, out);
  ratingInsights(input, out);
  listingInsights(input, out);
  return out.sort((a, b) => b.weight - a.weight || b.date.localeCompare(a.date));
}

interface Ctx {
  input: InsightInput;
  byDate: Map<DayString, DayRecord>;
  latest: DayString;
  window: DayWindow;
  week: DayString;
  out: Insight[];
}

function weightFor(change: number, base: number): number {
  return Math.min(90, Math.round(35 + Math.abs(change) * 60 + Math.log10(Math.max(10, base)) * 4));
}

/** The source whose change explains most of a movement in `field`. */
function biggestMover(ctx: Ctx, field: 'impressions' | 'downloads'): { source: SourceType; delta: number } | null {
  const rows = bySource(ctx.byDate, ctx.window);
  const prior = new Map(
    bySource(ctx.byDate, { from: addDays(ctx.window.from, -14), to: addDays(ctx.window.from, -1) }).map((row) => [row.key, row.totals])
  );
  let best: { source: SourceType; delta: number } | null = null;
  for (const row of rows) {
    const before = prior.get(row.key);
    const delta = row.totals[field] - (before ? before[field] : 0);
    if (!best || Math.abs(delta) > Math.abs(best.delta)) best = { source: row.key as SourceType, delta };
  }
  return best;
}

function discovery(ctx: Ctx): void {
  const { current, previous } = compareWindows(ctx.byDate, ctx.window);
  if (!current.hasEngagement || !previous.hasEngagement || previous.impressions < MIN_IMPRESSIONS) return;
  const change = relativeChange(current.impressions, previous.impressions);
  if (change === null || Math.abs(change) < 0.25) return;
  const mover = biggestMover(ctx, 'impressions');
  const because =
    mover && Math.abs(mover.delta) > Math.abs(current.impressions - previous.impressions) * 0.4
      ? ` Most of the change came from ${SOURCE_LABELS[mover.source]}, where your app was seen ${formatCount(Math.abs(mover.delta))} ${mover.delta > 0 ? 'more' : 'fewer'} times.`
      : '';
  ctx.out.push({
    id: `impressions:${ctx.week}`,
    appId: ctx.input.appId,
    kind: 'impressions',
    category: 'discovery',
    tone: change > 0 ? 'good' : 'warning',
    title: `Your app was seen ${formatChange(Math.abs(change)).replace('+', '')} ${change > 0 ? 'more' : 'less'} often in the last two weeks`,
    body: `Your app was seen ${formatCount(current.impressions)} times, compared with ${formatCount(previous.impressions)} times in the two weeks before.${because}`,
    date: ctx.latest,
    weight: weightFor(change, previous.impressions),
    metric: { label: 'Times seen', value: formatCount(current.impressions), delta: change },
    action: { kind: 'ask', question: `Why was my app seen ${change > 0 ? 'more' : 'less'} often in the last two weeks?` },
  });
}

/** A day of browse impressions far above the usual is what a feature placement looks like. */
function featured(ctx: Ctx): void {
  const window: DayWindow = { from: addDays(ctx.latest, -41), to: ctx.latest };
  const series = dailySeries(ctx.byDate, window, 'impressions', { source: 'browse' });
  const values = series.map((point) => point.value);
  if (values.filter((value) => value !== null).length < 21) return;
  const baseline = median(values.slice(0, 28).filter((value): value is number => value !== null));
  if (baseline === null) return;
  let spike: { date: DayString; value: number } | null = null;
  for (const point of series.slice(-10)) {
    if (point.value === null) continue;
    if (isFeatureSpike(point.value, baseline) && (!spike || point.value > spike.value)) {
      spike = { date: point.date, value: point.value };
    }
  }
  if (!spike) return;
  const known = ctx.input.events.some(
    (event) => event.kind === 'featured' && Math.abs(daysBetween(event.date, spike!.date)) <= 3
  );
  if (known) return;
  ctx.out.push({
    id: `featured:${weekStart(spike.date)}`,
    appId: ctx.input.appId,
    kind: 'featured',
    category: 'discovery',
    tone: 'good',
    title: 'The App Store may have featured your app',
    body: `On ${formatDay(spike.date)}, people browsing the App Store saw your app ${formatCount(spike.value)} times, ${Math.round(
      spike.value / Math.max(1, baseline)
    )} times the usual number. Browsing the App Store means the Today, Games and Apps tabs and the charts, where Apple's editors feature apps.`,
    date: spike.date,
    weight: 80,
    metric: { label: 'Times seen while browsing', value: formatCount(spike.value) },
    action: { kind: 'timeline' },
  });
}

function conversion(ctx: Ctx): void {
  const { current, previous } = compareWindows(ctx.byDate, ctx.window);
  if (current.conversion === null || previous.conversion === null) return;
  const confidence = proportionConfidence(
    previous.conversionBase.downloads,
    previous.conversionBase.uniqueImpressions,
    current.conversionBase.downloads,
    current.conversionBase.uniqueImpressions
  );
  const change = relativeChange(current.conversion, previous.conversion);
  if (change === null || confidence === null || confidence < CONFIDENT || Math.abs(change) < 0.1) return;
  const up = change > 0;
  ctx.out.push({
    id: `conversion:${ctx.week}`,
    appId: ctx.input.appId,
    kind: 'conversion',
    category: 'conversion',
    tone: up ? 'good' : 'problem',
    title: `Download rate ${up ? 'up' : 'down'} from ${formatRate(previous.conversion)} to ${formatRate(current.conversion)}`,
    body: up
      ? 'More of the people who see your app now download your app. If you recently changed your screenshots, icon or subtitle, the change probably worked.'
      : 'Fewer of the people who see your app now download your app. Check your first three screenshots, shown in search results, then your icon, subtitle and recent ratings.',
    date: ctx.latest,
    weight: up ? weightFor(change, current.conversionBase.uniqueImpressions) : Math.min(98, weightFor(change, current.conversionBase.uniqueImpressions) + 10),
    metric: { label: 'Download rate', value: formatRate(current.conversion), delta: change },
    action: up ? { kind: 'timeline' } : { kind: 'ask', question: 'My download rate went down. What changed, and what should I try first?' },
  });
}

function downloads(ctx: Ctx): void {
  const { current, previous } = compareWindows(ctx.byDate, ctx.window);
  if (previous.downloads < MIN_DOWNLOADS) return;
  const change = relativeChange(current.downloads, previous.downloads);
  if (change === null || Math.abs(change) < 0.2) return;
  const mover = current.hasDownloads ? biggestMover(ctx, 'downloads') : null;
  const because =
    mover && Math.abs(mover.delta) > Math.abs(current.downloads - previous.downloads) * 0.4
      ? ` Most of the change came from ${SOURCE_LABELS[mover.source]}.`
      : '';
  ctx.out.push({
    id: `downloads:${ctx.week}`,
    appId: ctx.input.appId,
    kind: 'downloads',
    category: 'downloads',
    tone: change > 0 ? 'good' : 'warning',
    title: `New downloads ${change > 0 ? 'up' : 'down'} ${formatChange(Math.abs(change)).replace('+', '')} in the last two weeks`,
    body: `You got ${formatCount(current.downloads)} new downloads, compared with ${formatCount(previous.downloads)} in the two weeks before.${because}`,
    date: ctx.latest,
    weight: weightFor(change, previous.downloads),
    metric: { label: 'New downloads', value: formatCount(current.downloads), delta: change },
    action: { kind: 'ask', question: `Why did my downloads go ${change > 0 ? 'up' : 'down'} in the last two weeks?` },
  });
}

function milestones(ctx: Ctx): void {
  const sorted = [...ctx.input.records].sort((a, b) => a.date.localeCompare(b.date));
  let running = 0;
  let before = 0;
  const cutoff = addDays(ctx.latest, -13);
  for (const record of sorted) {
    const totals = totalsFor(ctx.byDate, { from: record.date, to: record.date });
    if (record.date < cutoff) before += totals.downloads;
    running += totals.downloads;
  }
  const passed = MILESTONES.filter((mark) => before < mark && running >= mark).pop();
  if (passed) {
    ctx.out.push({
      id: `milestone:${passed}`,
      appId: ctx.input.appId,
      kind: 'milestone',
      category: 'milestones',
      tone: 'good',
      title: `Your app passed ${formatCount(passed)} new downloads`,
      body: `Your app now has ${formatCount(running)} new downloads, counting from the first day Growth has numbers for.`,
      date: ctx.latest,
      weight: 60,
    });
  }

  // The best day in the data, if it is a recent one.
  const window: DayWindow = { from: sorted[0]?.date ?? ctx.latest, to: ctx.latest };
  const series = dailySeries(ctx.byDate, window, 'downloads');
  let best: { date: DayString; value: number } | null = null;
  for (const point of series) {
    if (point.value !== null && (!best || point.value > best.value)) best = { date: point.date, value: point.value };
  }
  if (best && series.length >= 60 && best.value >= 20 && daysBetween(best.date, ctx.latest) <= 6) {
    ctx.out.push({
      id: `best-day:${best.date}`,
      appId: ctx.input.appId,
      kind: 'best-day',
      category: 'milestones',
      tone: 'good',
      title: `Best day yet: ${formatCount(best.value)} downloads on ${formatDay(best.date)}`,
      body: `Of the ${series.length} days Growth has numbers for, no other day had more downloads.`,
      date: best.date,
      weight: 58,
    });
  }
}

function revenue(ctx: Ctx): void {
  const { current, previous } = compareWindows(ctx.byDate, ctx.window);
  if (!current.hasSales || !previous.hasSales) return;
  const currency = proceedsCurrency(current, previous);
  const now = current.proceeds[currency] ?? 0;
  const then = previous.proceeds[currency] ?? 0;
  if (then < 50) return;
  const change = relativeChange(now, then);
  if (change === null || Math.abs(change) < 0.2) return;
  ctx.out.push({
    id: `proceeds:${ctx.week}`,
    appId: ctx.input.appId,
    kind: 'proceeds',
    category: 'revenue',
    tone: change > 0 ? 'good' : 'warning',
    title: `Earnings ${change > 0 ? 'up' : 'down'} ${formatChange(Math.abs(change)).replace('+', '')} in the last two weeks`,
    body: `You earned ${formatMoney(now, currency)} in the last two weeks, compared with ${formatMoney(then, currency)} in the two weeks before. Only earnings in ${currency} are counted.`,
    date: ctx.latest,
    weight: weightFor(change, then),
    metric: { label: 'Earnings', value: formatMoney(now, currency), delta: change },
  });
}

function markets(ctx: Ctx): void {
  const window28: DayWindow = { from: addDays(ctx.latest, -27), to: ctx.latest };
  const rows = byTerritory(ctx.byDate, window28);
  const all = totalsFor(ctx.byDate, window28);
  const listing = ctx.input.listing;
  const languages = listing?.locales.map((locale) => locale.locale) ?? [];

  // Growing markets: downloads doubled with real volume.
  const recent = byTerritory(ctx.byDate, ctx.window);
  for (const row of recent.slice(0, 15)) {
    if (row.change === null || row.change < 1 || row.totals.downloads < MIN_DOWNLOADS) continue;
    ctx.out.push({
      id: `market-growth:${row.key}:${ctx.week}`,
      appId: ctx.input.appId,
      kind: 'market-growth',
      category: 'markets',
      tone: 'good',
      title: `Downloads ${row.change >= 2 ? 'tripled' : 'doubled'} in ${territoryName(row.key)}`,
      body: `${territoryName(row.key)} had ${formatCount(row.totals.downloads)} new downloads in the last two weeks, ${Math.round(row.share * 100)}% of all your new downloads.`,
      date: ctx.latest,
      weight: Math.min(75, 45 + Math.round(row.share * 100)),
      metric: { label: territoryName(row.key), value: formatCount(row.totals.downloads), delta: row.change },
      action: { kind: 'markets', territory: row.key },
    });
  }

  // A new storefront: real downloads now, none in the eight weeks before.
  for (const row of recent.slice(0, 25)) {
    if (row.totals.downloads < 20) continue;
    const before = totalsFor(ctx.byDate, { from: addDays(ctx.window.from, -56), to: addDays(ctx.window.from, -1) }, { territory: row.key });
    if (before.days < 28 || before.downloads > 0) continue;
    ctx.out.push({
      id: `market-new:${row.key}`,
      appId: ctx.input.appId,
      kind: 'market-new',
      category: 'markets',
      tone: 'good',
      title: `People in ${territoryName(row.key)} started downloading your app`,
      body: `${territoryName(row.key)} had ${formatCount(row.totals.downloads)} new downloads in the last two weeks, after none in the eight weeks before.`,
      date: ctx.latest,
      weight: 50,
      action: { kind: 'markets', territory: row.key },
    });
  }

  if (!listing || languages.length === 0) return;

  // Shoppers reading a listing in another language. Page views say who is
  // looking at the product page; downloads stand in when there are none.
  // Both need volume: on an app with 16 downloads a month, one download from
  // Greece is "6% of downloads" and says nothing about Greek shoppers.
  const pageViews = all.hasEngagement;
  const base = pageViews ? all.pageViews : all.downloads;
  if (base < (pageViews ? LOCALIZE_MIN_BASE_VIEWS : LOCALIZE_MIN_BASE_DOWNLOADS)) return;
  const missing = new Map<string, { territories: string[]; share: number; count: number }>();
  for (const row of rows) {
    const count = pageViews ? row.totals.pageViews : row.totals.downloads;
    const language = listingLanguageFor(row.key);
    if (languages.some((locale) => languageCovers(locale, language))) continue;
    const entry = missing.get(language) ?? { territories: [], share: 0, count: 0 };
    entry.territories.push(row.key);
    entry.share += count / base;
    entry.count += count;
    missing.set(language, entry);
  }
  const worthIt = Array.from(missing.entries())
    .filter(([, entry]) => entry.share >= 0.04 && entry.count >= (pageViews ? LOCALIZE_MIN_VIEWS : LOCALIZE_MIN_DOWNLOADS))
    .sort((a, b) => b[1].share - a[1].share)
    .slice(0, 3);
  for (const [language, entry] of worthIt) {
    const where = entry.territories.slice(0, 3).map(territoryName).join(', ');
    ctx.out.push({
      id: `localize:${language}`,
      appId: ctx.input.appId,
      kind: 'localize',
      category: 'markets',
      tone: 'warning',
      title: `${Math.round(entry.share * 100)}% of your ${all.hasEngagement ? 'page visits' : 'downloads'} come from countries where ${listingLanguageName(language)} is the main language`,
      body: `Your store page has no ${listingLanguageName(language)} version, so most people in ${where} see your store page in another language. Translate and upload your screenshots in the editor, then add ${listingLanguageName(language)} on the Store page.`,
      date: ctx.latest,
      weight: Math.min(92, 55 + Math.round(entry.share * 150)),
      metric: { label: 'Share', value: `${Math.round(entry.share * 100)}%` },
      action: { kind: 'localize', locales: [language] },
    });
  }

  // A big market converting far below the rest.
  if (all.conversion !== null) {
    for (const row of rows.slice(0, 10)) {
      if (row.totals.conversion === null || row.totals.conversionBase.uniqueImpressions < 2000) continue;
      if (row.totals.conversion > all.conversion * 0.55) continue;
      const confidence = proportionConfidence(
        all.conversionBase.downloads - row.totals.conversionBase.downloads,
        all.conversionBase.uniqueImpressions - row.totals.conversionBase.uniqueImpressions,
        row.totals.conversionBase.downloads,
        row.totals.conversionBase.uniqueImpressions
      );
      if (confidence === null || confidence < CONFIDENT) continue;
      const language = listingLanguageFor(row.key);
      const localized = languages.some((locale) => languageCovers(locale, language));
      ctx.out.push({
        id: `market-conversion:${row.key}:${ctx.week}`,
        appId: ctx.input.appId,
        kind: 'market-conversion',
        category: 'conversion',
        tone: 'warning',
        title: `Download rate in ${territoryName(row.key)} is ${formatRate(row.totals.conversion)}, compared with ${formatRate(all.conversion)} overall`,
        body: localized
          ? `Your store page is already in ${listingLanguageName(language)}. Check your screenshots: what works in other countries may not be what people in ${territoryName(row.key)} want.`
          : `Most people in ${territoryName(row.key)} see your store page in another language. Try your store page and screenshots in ${listingLanguageName(language)} first.`,
        date: ctx.latest,
        weight: 62,
        metric: { label: 'Download rate', value: formatRate(row.totals.conversion) },
        action: localized ? { kind: 'markets', territory: row.key } : { kind: 'localize', locales: [language] },
      });
    }
  }
}

function screenshots(ctx: Ctx): void {
  const shots = ctx.input.events
    .filter((event) => event.kind === 'screenshots')
    .sort((a, b) => b.date.localeCompare(a.date));
  const latestShot = shots[0];
  if (latestShot) {
    const impact = eventImpact(ctx.byDate, latestShot, { latest: ctx.latest, events: ctx.input.events });
    const what = latestShot.projectName ? `the screenshots from "${latestShot.projectName}"` : 'your new screenshots';
    const measure = impact.measure === 'conversion' ? 'download rate' : 'downloads per day';
    let insight: Omit<Insight, 'id' | 'appId' | 'kind' | 'category' | 'date'> | null = null;
    if (impact.verdict === 'better' || impact.verdict === 'worse') {
      const better = impact.verdict === 'better';
      const size = formatChange(impact.change).replace(/^[+-]/, '');
      // Before and after, not a controlled test: say what moved, never that
      // the screenshots moved it, and name whatever else changed meanwhile.
      const others =
        impact.others.length > 0
          ? `Other events in the weeks before and after may also have changed the ${measure}: ${describeEvents(impact.others)}.`
          : `A sale or the time of year can also change the ${measure}.`;
      insight = {
        tone: better ? 'good' : 'problem',
        title: `The ${measure} is ${better ? 'up' : 'down'} ${size} since your new screenshots went live`,
        body: `${impact.measure === 'conversion' ? `The download rate was ${formatRate(impact.beforeRate)} before and ${formatRate(impact.afterRate)} after` : `Downloads were ${formatCount(impact.beforeRate)} a day before and ${formatCount(impact.afterRate)} a day after`} ${what} went live on ${formatDay(impact.liveDate ?? latestShot.date)}, measured over ${impact.daysAfter} days. ${confidenceSentence(impact.confidence, confidenceBar(impact.daysAfter))} ${others}${better ? '' : ' You can bring back your old design from the project history.'}`,
        weight: better ? 85 : 95,
        metric: { label: measure, value: impact.measure === 'conversion' ? formatRate(impact.afterRate) : formatCount(impact.afterRate), delta: impact.change ?? undefined },
        action: { kind: 'timeline', eventId: latestShot.id },
      };
    } else if (impact.verdict === 'not-live') {
      insight = {
        tone: 'neutral',
        title: `Your new screenshots go live with ${latestShot.version ? `version ${latestShot.version}` : 'the next release'}`,
        body: 'Your new screenshots show in the App Store once the new version comes out. Growth measures your new screenshots from the release day.',
        weight: 40,
        action: { kind: 'timeline', eventId: latestShot.id },
      };
    } else if (impact.verdict === 'too-early' && impact.liveDate) {
      insight = {
        tone: 'neutral',
        title: `Measuring your new screenshots: ${impact.daysAfter} of 14 days done`,
        body:
          impact.change !== null
            ? `So far the change in ${measure} is ${formatChange(impact.change)}, too early to be sure. The full result is ready in ${plural(impact.daysToWait, 'day')}.`
            : `Apple sends each day's numbers one or two days later. No numbers since ${formatDay(impact.liveDate)} have come in yet.`,
        weight: 45,
        action: { kind: 'timeline', eventId: latestShot.id },
      };
    } else if (impact.verdict === 'flat') {
      insight = {
        tone: 'neutral',
        title: `The ${measure} is about the same since your new screenshots went live`,
        body: `In ${impact.daysAfter} days the ${measure} changed by ${formatChange(impact.change)}, which could be luck. A bigger change, like a new first screenshot, is easier to measure. To test two sets of screenshots side by side, use product page optimization in App Store Connect.`,
        weight: 42,
        action: { kind: 'timeline', eventId: latestShot.id },
      };
    }
    if (insight) {
      ctx.out.push({
        id: `screenshots-impact:${latestShot.id}:${impact.verdict}`,
        appId: ctx.input.appId,
        kind: 'screenshots-impact',
        category: 'screenshots',
        date: impact.liveDate ?? latestShot.date,
        ...insight,
      });
    }
  }

  const sorted = [...ctx.input.records].sort((a, b) => a.date.localeCompare(b.date));
  const span = sorted.length > 1 ? daysBetween(sorted[0].date, ctx.latest) : 0;
  const lastShot = latestShot ? latestShot.date : null;
  if (span >= 60 && (!lastShot || daysBetween(lastShot, ctx.latest) > 90)) {
    ctx.out.push({
      id: `screenshots-stale:${ctx.week}`,
      appId: ctx.input.appId,
      kind: 'screenshots-stale',
      category: 'screenshots',
      tone: 'neutral',
      title: lastShot ? `Your screenshots have not changed in ${daysBetween(lastShot, ctx.latest)} days` : 'No new screenshots on the timeline yet',
      body: 'Upload new screenshots from the editor. Growth then compares your downloads before and after the new screenshots go live.',
      date: ctx.latest,
      weight: 30,
      action: { kind: 'publish' },
    });
  }
}

function reviewInsights(input: InsightInput, out: Insight[]): void {
  const reviews = input.reviews;
  if (reviews.length === 0) return;
  const week = weekStart(input.today);

  const waiting = unansweredLow(recentReviews(reviews, input.today, 30));
  if (waiting.length > 0) {
    const oldest = waiting[0];
    out.push({
      id: `unanswered:${week}`,
      appId: input.appId,
      kind: 'unanswered',
      category: 'reviews',
      tone: 'warning',
      title: `${plural(waiting.length, 'low rating')} waiting for a reply`,
      body: `Reviews with 1 or 2 stars from the last 30 days have no reply. The oldest review is from ${formatDay(reviewDay(oldest))}. Everyone sees your reply, and Apple tells the reviewer, who can then change the rating.`,
      date: input.today,
      weight: Math.min(88, 50 + waiting.length * 4),
      metric: { label: 'Waiting', value: String(waiting.length) },
      action: { kind: 'reviews', rating: 2, unanswered: true },
    });
  }

  // A burst: three or more low ratings in three days, well above the usual pace.
  const lastThree = recentReviews(reviews, input.today, 3).filter((review) => review.rating <= 2);
  const before = reviewsIn(reviews, { from: addDays(input.today, -33), to: addDays(input.today, -3) }).filter((review) => review.rating <= 2);
  const usual = (before.length / 30) * 3;
  if (lastThree.length >= 3 && lastThree.length >= usual * 3) {
    out.push({
      id: `low-burst:${input.today}`,
      appId: input.appId,
      kind: 'low-burst',
      category: 'reviews',
      tone: 'problem',
      title: `${lastThree.length} low ratings in three days`,
      body: `Low ratings are coming in ${usual > 0 ? `${Math.round(lastThree.length / usual)} times faster` : 'much faster'} than usual. Bursts of low ratings often come after a new version, or when part of your app stops working.`,
      date: input.today,
      weight: 94,
      action: { kind: 'reviews', rating: 2 },
    });
  }

  const recent = recentReviews(reviews, input.today, 14);
  for (const entry of topicCounts(recent.filter((review) => review.rating <= 2))) {
    if (entry.topic === 'praise' || entry.count < 3) continue;
    out.push({
      id: `topic:${entry.topic}:${week}`,
      appId: input.appId,
      kind: 'review-topic',
      category: 'reviews',
      tone: entry.topic === 'request' ? 'neutral' : 'warning',
      title: `${entry.count} low ratings in two weeks mention ${REVIEW_TOPIC_LABELS[entry.topic].toLowerCase()}`,
      body: 'Read the reviews side by side to see what went wrong. A reply saying a fix is coming also tells everyone else who reads the reviews.',
      date: input.today,
      weight: Math.min(85, 45 + entry.count * 5),
      action: { kind: 'reviews', topic: entry.topic },
    });
    if (out.filter((insight) => insight.kind === 'review-topic').length >= 2) break;
  }
}

function ratingInsights(input: InsightInput, out: Insight[]): void {
  const reviews = input.reviews;
  const recent = recentReviews(reviews, input.today, 14);
  const older = reviewsIn(reviews, { from: addDays(input.today, -56), to: addDays(input.today, -14) });
  const now = averageRating(recent);
  const then = averageRating(older);
  if (now !== null && then !== null && recent.length >= 8 && older.length >= 8 && then - now >= 0.5) {
    out.push({
      id: `rating-drop:${weekStart(input.today)}`,
      appId: input.appId,
      kind: 'rating-drop',
      category: 'ratings',
      tone: 'problem',
      title: `Recent reviews average ${formatRating(now)} stars, down from ${formatRating(then)}`,
      body: `The new average comes from ${plural(recent.length, 'review')} in the last two weeks. The six weeks before averaged ${formatRating(then)} stars. Ratings help decide your place in search results and how many people tap your app.`,
      date: input.today,
      weight: 90,
      action: { kind: 'reviews', rating: 2 },
    });
  }

  // A release that people liked less than the one before it.
  const release = input.events
    .filter((event) => event.kind === 'release' && daysBetween(event.date, input.today) <= 45 && daysBetween(event.date, input.today) >= 5)
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  if (release) {
    const after = reviewsIn(reviews, { from: release.date, to: input.today });
    const beforeRelease = reviewsIn(reviews, { from: addDays(release.date, -45), to: addDays(release.date, -1) });
    const a = averageRating(after);
    const b = averageRating(beforeRelease);
    if (a !== null && b !== null && after.length >= 5 && beforeRelease.length >= 5 && b - a >= 0.5) {
      out.push({
        id: `release-rating:${release.id}`,
        appId: input.appId,
        kind: 'release-rating',
        category: 'ratings',
        tone: 'problem',
        title: `Reviews since ${release.version ? `version ${release.version}` : release.title} average ${formatRating(a)} stars, down from ${formatRating(b)}`,
        body: 'Read the reviews written since the release to see what people do not like about the new version.',
        date: release.date,
        weight: 92,
        action: { kind: 'reviews', rating: 2 },
      });
    }
  }

  // The storefront with the most ratings sliding below 4.5.
  const top = [...input.ratings].sort((a, b) => b.count - a.count)[0];
  if (top && top.count >= 50 && top.average < 4.5) {
    const all = input.ratings.reduce((acc, rating) => acc + rating.count, 0);
    const weighted = all > 0 ? input.ratings.reduce((acc, rating) => acc + rating.average * rating.count, 0) / all : top.average;
    out.push({
      id: `rating-below:${top.territory}:${formatRating(top.average)}`,
      appId: input.appId,
      kind: 'rating-below',
      category: 'ratings',
      tone: top.average < 4 ? 'problem' : 'warning',
      title: `${formatRating(top.average)} stars in ${territoryName(top.territory)}, where you have the most ratings`,
      body: `Across all countries, your app has ${formatRating(weighted)} stars from ${formatCount(all)} ratings. People see your stars next to your app's name in search results, before opening your page.`,
      date: input.today,
      weight: top.average < 4 ? 80 : 55,
      action: { kind: 'reviews' },
    });
  }
}

function listingInsights(input: InsightInput, out: Insight[]): void {
  const issues = input.listingIssues;
  if (!input.listing || issues.length === 0) return;
  const problems = issues.filter((entry) => entry.severity === 'problem');
  const warnings = issues.filter((entry) => entry.severity === 'warning');
  if (problems.length + warnings.length > 0) {
    const fixable = issues.filter((entry) => entry.fix).length;
    const parts = [
      problems.length > 0 ? plural(problems.length, 'problem') : null,
      warnings.length > 0 ? plural(warnings.length, 'warning') : null,
    ].filter(Boolean);
    out.push({
      id: `listing:${input.listing.versionId}:${problems.length}:${warnings.length}`,
      appId: input.appId,
      kind: 'listing',
      category: 'listing',
      tone: problems.length > 0 ? 'problem' : 'warning',
      title: `Your store page for version ${input.listing.versionString} has ${parts.join(' and ')}`,
      body: `${(problems[0] ?? warnings[0]).title}.${
        fixable === 1 ? ' One issue has a fix ready to apply.' : fixable > 1 ? ` ${fixable} issues have a fix ready to apply.` : ''
      }`,
      date: input.today,
      weight: problems.length > 0 ? 76 : 52,
      action: { kind: 'listing' },
    });
  }
  for (const entry of issues.filter((candidate) => candidate.id.endsWith(':screenshots-borrowed')).slice(0, 2)) {
    out.push({
      id: `borrowed:${entry.locale}`,
      appId: input.appId,
      kind: 'borrowed-screenshots',
      category: 'screenshots',
      tone: 'warning',
      title: entry.title,
      body: entry.detail,
      date: input.today,
      weight: 64,
      action: { kind: 'localize', locales: [entry.locale] },
    });
  }
}

/**
 * A test never proves a difference outright, so the figure is capped at 99%:
 * "100% confidence" would claim more than the statistics can.
 */
export function confidenceSentence(confidence: number | null, bar: number | null = CONFIDENT): string {
  if (confidence === null) return '';
  const percent = Math.min(99, Math.round(confidence * 100));
  if (bar === null) return `Growth needs at least ${MIN_DAYS_AFTER} days of numbers to tell if the change is real.`;
  if (confidence >= bar) return `Growth is ${percent}% sure the change is real, not luck.`;
  // While the window fills it is read again every day, so the bar is higher.
  if (bar > CONFIDENT) return 'Not sure yet if the change is real. Wait a few more days.';
  return `Growth is only ${percent}% sure the change is real, not luck.`;
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** The headline numbers the overview tiles and the AI digest share. */
export function headline(byDate: Map<DayString, DayRecord>, window: DayWindow): { current: Totals; previous: Totals } {
  const { current, previous } = compareWindows(byDate, window);
  return { current, previous };
}
