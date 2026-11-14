// Competitors' storage and checks: the lists of followed apps, what each app
// showed in each country, the changes found, and which of those the user has
// seen. It all lives in the growth database's meta table (db.ts) under
// `rivals:` keys, and works the same in the web build and the desktop app.
//
// A check looks every app of a list up in every country of the list
// (rivals.ts), one country at a time, and writes each country as it comes, so
// the screen fills in while the check runs. In a country, the App Store apps
// take one lookup and each Google Play app its own page (playPage.ts, desktop
// app only). The two stores are counted apart, so a store that refuses or a
// Google Play page Growth cannot read stops that store's part of the check,
// not the other's.
//
// One check runs at a time in the whole browser: a lock covers every window
// of the app, so two editor windows never ask Apple twice for one list. A
// check the user asks for waits for one running in another window; the
// background pass skips instead.
//
// Whatever check finds new screenshots, the background pass or the Check now
// button, says so through onRivalChangesFound, which is what the editor's
// alert listens to (useRivalWatch.ts).

import { deleteMeta, readMeta, readMetaWithPrefix, writeMeta } from './db';
import { PlayPageUnreadable, canReadGooglePlay, fetchPlayStorefront } from './playPage';
import {
  DEFAULT_RIVAL_COUNTRIES,
  MAX_RIVAL_COUNTRIES,
  MAX_RIVALS,
  RIVAL_CHECK_EVERY_MS,
  diffStorefront,
  entryOf,
  groupChanges,
  isRivalAppId,
  isScreenshotChange,
  lookupStorefronts,
  ownAppId,
  type CountryChange,
  type RivalCandidate,
  type RivalChange,
  type RivalList,
  type RivalSnapshot,
  type RivalStorefront,
  type StoreTrouble,
} from './rivals';
import { packageOf, storeOf, type GrowthStore } from './stores';
import { TERRITORY_CODES } from './territories';

export const rivalKeys = {
  list: (owner: string) => `rivals:list:${owner}`,
  app: (appId: string) => `rivals:app:${appId}`,
  changes: (appId: string) => `rivals:changes:${appId}`,
  seen: 'rivals:seen',
};

const LIST_PREFIX = 'rivals:list:';
const MAX_CHANGES_KEPT = 100;
const MAX_SEEN_KEPT = 500;
/**
 * After a check that got no answer at all, the background pass waits this
 * long before trying again. A store that left gaps in a check has its apps
 * looked at again after the same wait (rivalRetryIds).
 */
const RETRY_AFTER_FAILURE_MS = 3_600_000;
/** Changes found longer ago than this no longer count as news. */
export const RIVAL_NEWS_DAYS = 30;
const DAY_MS = 86_400_000;

// --- telling the screens -----------------------------------------------------------

export type RivalsEvent = 'data' | 'progress';

const listeners = new Set<(event: RivalsEvent) => void>();

export function onRivalsChange(listener: (event: RivalsEvent) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function announce(event: RivalsEvent): void {
  listeners.forEach((listener) => listener(event));
}

const foundListeners = new Set<(changes: RivalChange[]) => void>();

/** Called with the screenshot changes each check finds, whoever started the check. */
export function onRivalChangesFound(listener: (changes: RivalChange[]) => void): () => void {
  foundListeners.add(listener);
  return () => foundListeners.delete(listener);
}

/** The check running in this window, for its progress bar. */
export interface RivalCheckState {
  owner: string;
  done: number;
  total: number;
}

let checking: RivalCheckState | null = null;

export function rivalCheckState(): RivalCheckState | null {
  return checking;
}

function setChecking(state: RivalCheckState | null): void {
  checking = state;
  announce('progress');
}

// The list whose Competitors screen is on screen, if any: changes found for
// it are on that screen already, so the editor's alert leaves them out.
let onScreen: string | null = null;

export function setRivalsOnScreen(owner: string | null): void {
  onScreen = owner;
}

export function rivalsOnScreen(): string | null {
  return onScreen;
}

// --- lists -------------------------------------------------------------------------

function webLocks(): LockManager | null {
  return typeof navigator !== 'undefined' && navigator.locks ? navigator.locks : null;
}

let listWrites: Promise<unknown> = Promise.resolve();

/**
 * A list is read, changed and written back by the screen (follow, the
 * countries) and by a check (its time), maybe in two windows at once. Without
 * a turn each, a check could write back the list it read before a follow and
 * lose the new app.
 */
function withListLock<T>(task: () => Promise<T>): Promise<T> {
  const locks = webLocks();
  if (locks) return locks.request('osg-growth-rival-lists', () => task());
  const next = listWrites.then(task, task);
  listWrites = next.catch(() => undefined);
  return next;
}

function cleanList(value: RivalList | undefined, owner: string): RivalList | null {
  if (!value || typeof value !== 'object' || !Array.isArray(value.rivals)) return null;
  return { ...value, owner, countries: Array.isArray(value.countries) ? value.countries : [] };
}

export async function readRivalList(owner: string): Promise<RivalList | null> {
  return cleanList(await readMeta<RivalList>(rivalKeys.list(owner)), owner);
}

/** Every list, the ones with no Growth app too. */
export async function allRivalLists(): Promise<RivalList[]> {
  const rows = await readMetaWithPrefix<RivalList>(LIST_PREFIX);
  return rows
    .map((row) => cleanList(row.value, row.key.slice(LIST_PREFIX.length)))
    .filter((list): list is RivalList => !!list);
}

/** Change one list in its turn. `create` makes the list when there is none yet. */
async function changeList(owner: string, change: (list: RivalList) => RivalList, create?: () => RivalList): Promise<RivalList | null> {
  const result = await withListLock(async () => {
    const current = (await readRivalList(owner)) ?? (create ? create() : null);
    if (!current) return null;
    const next = change(current);
    await writeMeta(rivalKeys.list(owner), next);
    return next;
  });
  announce('data');
  return result;
}

function validCountries(countries: string[]): string[] {
  return Array.from(new Set(countries.map((code) => code.toUpperCase()).filter((code) => TERRITORY_CODES.includes(code)))).slice(
    0,
    MAX_RIVAL_COUNTRIES
  );
}

/**
 * Follow an app. A list that does not exist yet starts with `countries`.
 * Refused past MAX_RIVALS, and for the user's own app, which is in the
 * comparison already.
 */
export async function followRival(owner: string, candidate: RivalCandidate, countries: string[]): Promise<RivalList> {
  const outcome: { refusal?: string } = {};
  const list = await changeList(
    owner,
    (current) => {
      if (current.rivals.some((rival) => rival.id === candidate.id)) return current;
      if (ownAppId(current) === candidate.id) {
        outcome.refusal = 'That is your own app. Your app is already in the comparison';
        return current;
      }
      if (current.rivals.length >= MAX_RIVALS) {
        outcome.refusal = `You can follow ${MAX_RIVALS} apps. Stop following one first`;
        return current;
      }
      return { ...current, rivals: [...current.rivals, entryOf(candidate)] };
    },
    () => ({ owner, rivals: [], countries: validCountries(countries.length ? countries : DEFAULT_RIVAL_COUNTRIES) })
  );
  if (outcome.refusal) throw new Error(outcome.refusal);
  await seedSnapshot(candidate);
  return list!;
}

/**
 * What the search found for a newly followed app, kept as its answer for the
 * country searched, so that country shows the app before a check reaches it.
 * A country already answered keeps its own answer.
 */
async function seedSnapshot(candidate: RivalCandidate): Promise<void> {
  const territory = candidate.storefront.territory;
  const snapshot = (await readMeta<RivalSnapshot>(rivalKeys.app(candidate.id))) ?? { id: candidate.id, countries: {}, checkedAt: 0 };
  if (snapshot.countries[territory]) return;
  await writeMeta(rivalKeys.app(candidate.id), { ...snapshot, countries: { ...snapshot.countries, [territory]: candidate.storefront } });
  announce('data');
}

/** Stop following an app. What it showed is forgotten unless another list follows it too. */
export async function unfollowRival(owner: string, appId: string): Promise<void> {
  await changeList(owner, (current) => ({ ...current, rivals: current.rivals.filter((rival) => rival.id !== appId) }));
  await forgetUnfollowed([appId]);
}

/**
 * Change the countries a list checks. The change is applied to the stored
 * list in its turn, not to the copy on screen, which lags a write behind: two
 * quick removals would otherwise put the first one back. A list not made yet
 * starts from `startWith`.
 */
export async function changeRivalCountries(owner: string, change: (countries: string[]) => string[], startWith: string[]): Promise<void> {
  await changeList(
    owner,
    (current) => {
      const next = validCountries(change(current.countries.length ? current.countries : startWith));
      // A list keeps one country at least: a check needs somewhere to look.
      return next.length > 0 ? { ...current, countries: next } : current;
    },
    () => ({ owner, rivals: [], countries: validCountries(startWith) })
  );
}

/** Name the user's own app, on the App Store or Google Play, for a list with no Growth app. Null forgets it. */
export async function setYourApp(owner: string, candidate: RivalCandidate | null, countries: string[]): Promise<void> {
  const named: { before?: string } = {};
  await changeList(
    owner,
    (current) => {
      named.before = current.yourApp?.id;
      const next = { ...current, rivals: candidate ? current.rivals.filter((rival) => rival.id !== candidate.id) : current.rivals };
      if (candidate) next.yourApp = entryOf(candidate);
      else delete next.yourApp;
      return next;
    },
    () => ({ owner, rivals: [], countries: validCountries(countries.length ? countries : DEFAULT_RIVAL_COUNTRIES) })
  );
  if (candidate) await seedSnapshot(candidate);
  if (named.before && named.before !== candidate?.id) await forgetUnfollowed([named.before]);
}

/**
 * A Growth app with no list of its own takes over the list made before it was
 * connected, when that list named the same app as the user's: someone who
 * followed competitors in the desktop app before adding a key keeps them.
 */
export async function adoptRivalList(owner: string): Promise<void> {
  if (!isRivalAppId(owner)) return;
  const adopted = await withListLock(async () => {
    if (await readRivalList(owner)) return false;
    const unowned = await readRivalList('');
    if (!unowned || unowned.yourApp?.id !== owner) return false;
    const adoptedList: RivalList = { ...unowned, owner };
    delete adoptedList.yourApp;
    await writeMeta(rivalKeys.list(owner), adoptedList);
    await deleteMeta([rivalKeys.list('')]);
    return true;
  });
  if (adopted) announce('data');
}

/**
 * Move the apps followed with no Growth app (`''`) to this app's list, for a
 * list adoptRivalList could not match to an app because it named none. The
 * app's own list keeps its countries and its apps first; past MAX_RIVALS the
 * rest stay behind.
 */
export async function moveUnownedRivals(owner: string): Promise<void> {
  if (!owner) return;
  await withListLock(async () => {
    const unowned = await readRivalList('');
    if (!unowned || unowned.rivals.length === 0) return;
    const current = (await readRivalList(owner)) ?? { owner, rivals: [], countries: unowned.countries };
    const own = ownAppId(current);
    const taken = new Set(current.rivals.map((rival) => rival.id));
    const room = Math.max(0, MAX_RIVALS - current.rivals.length);
    const moving = unowned.rivals.filter((rival) => !taken.has(rival.id) && rival.id !== own).slice(0, room);
    const movingIds = new Set(moving.map((rival) => rival.id));
    const left = unowned.rivals.filter((rival) => !movingIds.has(rival.id) && !taken.has(rival.id) && rival.id !== own);
    await writeMeta(rivalKeys.list(owner), { ...current, rivals: [...current.rivals, ...moving], checkedAt: undefined });
    if (left.length > 0) await writeMeta(rivalKeys.list(''), { ...unowned, rivals: left });
    else await deleteMeta([rivalKeys.list('')]);
  });
  announce('data');
}

/** Drop what was kept about apps no list mentions any more. */
async function forgetUnfollowed(appIds: string[]): Promise<void> {
  const lists = await allRivalLists();
  const mentioned = new Set(lists.flatMap((list) => [...list.rivals.map((rival) => rival.id), ownAppId(list)]));
  const gone = appIds.filter((id) => !mentioned.has(id));
  await deleteMeta(gone.flatMap((id) => [rivalKeys.app(id), rivalKeys.changes(id)]));
  if (gone.length) announce('data');
}

// --- what the apps showed ---------------------------------------------------------

export async function readSnapshots(ids: string[]): Promise<Map<string, RivalSnapshot>> {
  const rows = await Promise.all(ids.map((id) => readMeta<RivalSnapshot>(rivalKeys.app(id))));
  const snapshots = new Map<string, RivalSnapshot>();
  rows.forEach((row, index) => {
    if (row && typeof row === 'object' && row.countries) snapshots.set(ids[index], row);
  });
  return snapshots;
}

/** The changes of these apps, newest first. */
export async function readRivalChanges(ids: string[]): Promise<RivalChange[]> {
  const rows = await Promise.all(ids.map((id) => readMeta<RivalChange[]>(rivalKeys.changes(id))));
  return rows
    .flatMap((row) => (Array.isArray(row) ? row : []))
    .sort((a, b) => b.foundAt - a.foundAt);
}

export async function readSeenRivalChanges(): Promise<Set<string>> {
  return new Set((await readMeta<string[]>(rivalKeys.seen)) ?? []);
}

/** The user has these changes in front of them. */
export async function markRivalChangesSeen(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const stored = (await readMeta<string[]>(rivalKeys.seen)) ?? [];
  const seen = new Set(stored);
  const before = seen.size;
  ids.forEach((id) => seen.add(id));
  if (seen.size === before) return;
  await writeMeta(rivalKeys.seen, Array.from(seen).slice(-MAX_SEEN_KEPT));
  announce('data');
}

export interface RivalNews {
  owner: string;
  change: RivalChange;
  /** The app's name, as the list has it. */
  name: string;
}

/** New screenshots of followed apps that the user has not seen, newest first. */
export async function unseenRivalNews(now = Date.now()): Promise<RivalNews[]> {
  const [lists, seen] = await Promise.all([allRivalLists(), readSeenRivalChanges()]);
  const news: RivalNews[] = [];
  for (const list of lists) {
    for (const change of await readRivalChanges(list.rivals.map((rival) => rival.id))) {
      if (!isScreenshotChange(change) || seen.has(change.id) || now - change.foundAt > RIVAL_NEWS_DAYS * DAY_MS) continue;
      news.push({ owner: list.owner, change, name: list.rivals.find((rival) => rival.id === change.appId)?.name ?? '' });
    }
  }
  return news.sort((a, b) => b.change.foundAt - a.change.foundAt);
}

// --- checks --------------------------------------------------------------------------

export interface RivalCheckResult {
  changes: RivalChange[];
  /** Countries that answered, for one app at least. */
  countries: number;
  /**
   * Countries short of an answer from a store, for one app at least: those
   * where the store failed, and those left unasked after it stopped. The
   * same count the list keeps for each store (RivalList.trouble).
   */
  failed: number;
  /** The stores short of an answer somewhere. */
  failedStores: GrowthStore[];
  /** A Google Play page came back without the details where Growth reads them. */
  unreadable: boolean;
  /** Another window was checking, and this call did not wait for it. */
  skipped?: boolean;
}

export interface RivalCheckOptions {
  signal?: AbortSignal;
  /** Look this country up first: the one on screen. */
  first?: string;
  /** Wait for a check running in another window rather than skip. The background pass does not wait. */
  wait?: boolean;
  /**
   * Check these apps only, such as an app just followed or the apps of a
   * store that left gaps. Unless these are all the list's apps, the list's
   * time of check stays as it was, so the next full check comes when it
   * would have.
   */
  only?: string[];
}

const NOTHING: RivalCheckResult = { changes: [], countries: 0, failed: 0, failedStores: [], unreadable: false };

const running = new Map<string, { work: Promise<RivalCheckResult>; stop: AbortController; only?: string[] }>();

/** Whether a check of this list runs in this window. */
export function isCheckingRivals(owner: string): boolean {
  return running.has(owner);
}

/** Stop the check of this list running in this window, whoever started it. What came back so far is kept. */
export function stopRivalCheck(owner: string): void {
  running.get(owner)?.stop.abort();
}

function isAbort(error: unknown, signal?: AbortSignal): boolean {
  return (error as Error)?.name === 'AbortError' || !!signal?.aborted;
}

/**
 * Look a list's apps up in its countries. A second call in this window joins
 * the check running when that check covers it, and runs after it otherwise;
 * Stop (stopRivalCheck, or the caller's signal) keeps what came back.
 */
export function checkRivals(owner: string, options: RivalCheckOptions = {}): Promise<RivalCheckResult> {
  const existing = running.get(owner);
  if (existing) {
    const narrow = existing.only;
    if (!narrow || options.only?.every((id) => narrow.includes(id))) return existing.work;
    return existing.work.catch(() => undefined).then(() => checkRivals(owner, options));
  }
  const stop = new AbortController();
  const onAbort = () => stop.abort();
  options.signal?.addEventListener('abort', onAbort, { once: true });
  const locks = webLocks();
  const task = () => runCheck(owner, stop.signal, options.first, options.only);
  const work = (
    locks
      ? locks.request('osg-growth-rival-check', { ifAvailable: !options.wait }, (lock) =>
          lock ? task() : Promise.resolve<RivalCheckResult>({ ...NOTHING, skipped: true })
        )
      : task()
  ).finally(() => {
    options.signal?.removeEventListener('abort', onAbort);
    running.delete(owner);
  });
  running.set(owner, { work, stop, only: options.only });
  return work;
}

/** One store's part of a check. */
interface StoreRun {
  ids: string[];
  /** Requests that got nothing, one after another. */
  inARow: number;
  /** Three in a row is a refusal (or pages Growth cannot read): the store is left alone for the rest of the check. */
  stopped: boolean;
  answered: number;
  /** Countries where the store answered for every app it was asked about. */
  complete: number;
  unreadable: boolean;
}

function storeRun(ids: string[]): StoreRun {
  return { ids, inARow: 0, stopped: ids.length === 0, answered: 0, complete: 0, unreadable: false };
}

/** Every app a list compares: the ones followed, and the user's own. */
function listedIds(list: RivalList): string[] {
  const own = ownAppId(list);
  return Array.from(new Set([...list.rivals.map((rival) => rival.id), ...(own ? [own] : [])]));
}

/** The stores this build can ask: Google Play pages need the desktop app's HTTP client (playPage.ts). */
function canAsk(store: GrowthStore): boolean {
  return store === 'appstore' || canReadGooglePlay();
}

async function runCheck(owner: string, signal: AbortSignal, first?: string, only?: string[]): Promise<RivalCheckResult> {
  const list = await readRivalList(owner);
  if (!list || list.rivals.length === 0) return NOTHING;
  const own = ownAppId(list);
  const listed = listedIds(list);
  const wanted = only ? listed.filter((id) => only.includes(id)) : listed;
  const apple = storeRun(wanted.filter((id) => storeOf(id) === 'appstore'));
  // The web build leaves Google Play apps unchecked.
  const play = storeRun(canAsk('playstore') ? wanted.filter((id) => storeOf(id) === 'playstore') : []);
  const ids = [...apple.ids, ...play.ids];
  if (ids.length === 0) return NOTHING;
  const listCountries = list.countries.length > 0 ? list.countries : DEFAULT_RIVAL_COUNTRIES;
  const countries = first && listCountries.includes(first) ? [first, ...listCountries.filter((code) => code !== first)] : listCountries;

  const snapshots = await readSnapshots(ids);
  for (const id of ids) if (!snapshots.has(id)) snapshots.set(id, { id, countries: {}, checkedAt: 0 });
  const found = new Map<string, CountryChange[]>();
  const startedAt = Date.now();
  let answered = 0;
  /** Countries where every store asked answered for every app. */
  let complete = 0;
  let lastError: unknown = null;
  let changes: RivalChange[] = [];

  const failure = (run: StoreRun, error: unknown, what: string) => {
    console.error(what, error);
    if (error instanceof PlayPageUnreadable) run.unreadable = true;
    run.inARow += 1;
    lastError = error;
    if (run.inARow >= 3) run.stopped = true;
  };

  setChecking({ owner, done: 0, total: countries.length });
  try {
    for (const [index, territory] of countries.entries()) {
      if (apple.stopped && play.stopped) break;
      // Null: the store answered, without the app there.
      const answers = new Map<string, RivalStorefront | null>();
      let appleAnswered = false;
      if (!apple.stopped) {
        try {
          const sold = await lookupStorefronts(apple.ids, territory, { signal });
          for (const id of apple.ids) answers.set(id, sold.get(id) ?? null);
          apple.inARow = 0;
          apple.answered += 1;
          apple.complete += 1;
          appleAnswered = true;
        } catch (error) {
          if (isAbort(error, signal)) throw error;
          failure(apple, error, `Looking up the competitors in ${territory} failed`);
        }
      }
      let playGaps = 0;
      for (const id of play.ids) {
        if (play.stopped) {
          playGaps += 1;
          continue;
        }
        try {
          answers.set(id, await fetchPlayStorefront(packageOf(id)!, territory, { signal }));
          play.inARow = 0;
          play.answered += 1;
        } catch (error) {
          if (isAbort(error, signal)) throw error;
          failure(play, error, `Reading the Google Play page of ${packageOf(id)} in ${territory} failed`);
          playGaps += 1;
        }
      }
      if (play.ids.length > 0 && playGaps === 0) play.complete += 1;
      if (answers.size > 0) answered += 1;
      if ((apple.ids.length === 0 || appleAnswered) && playGaps === 0) complete += 1;
      const now = Date.now();
      for (const [id, next] of answers) {
        const snapshot = snapshots.get(id)!;
        const previous = snapshot.countries[territory];
        if (!next) {
          // Not there, as far as this answer goes. A country that had the
          // app keeps what it showed: seenAt says when that was.
          if (previous === undefined) snapshot.countries[territory] = null;
          else if (previous) snapshot.countries[territory] = { ...previous, missingAt: now };
          continue;
        }
        const result = diffStorefront(previous, next);
        snapshot.countries[territory] = result.kept;
        if (id !== own && result.changes.length > 0) found.set(id, [...(found.get(id) ?? []), ...result.changes]);
      }
      if (answers.size > 0) {
        await Promise.all(Array.from(answers.keys()).map((id) => writeMeta(rivalKeys.app(id), { ...snapshots.get(id)!, checkedAt: now })));
        announce('data');
      }
      setChecking({ owner, done: index + 1, total: countries.length });
    }
  } finally {
    setChecking(null);
    // Changes found before a Stop are kept: the answers they came from are written already.
    changes = await recordChanges(found, startedAt);
  }

  const now = Date.now();
  await changeList(owner, (current) => {
    const next = { ...current };
    // A check of a few apps leaves the list's time alone: the others were not looked at.
    if (wanted.length === listed.length) {
      if (answered > 0) {
        next.checkedAt = now;
        delete next.failedAt;
      } else {
        next.failedAt = now;
      }
    }
    // A store with a country short of an answer is asked again within the
    // hour (rivalRetryIds), even when the other store answered everywhere.
    // Its gaps are forgotten only after a check that asked about every app of
    // the store, in every country, and got every answer.
    const trouble: Partial<Record<GrowthStore, StoreTrouble>> = { ...current.trouble };
    for (const [store, run] of [['appstore', apple], ['playstore', play]] as const) {
      if (run.ids.length === 0) continue;
      const gaps = countries.length - run.complete;
      if (gaps > 0) trouble[store] = { at: now, countries: gaps, unreadable: run.unreadable };
      else if (listedIds(current).every((id) => storeOf(id) !== store || run.ids.includes(id))) delete trouble[store];
    }
    if (Object.keys(trouble).length > 0) next.trouble = trouble;
    else delete next.trouble;
    return next;
  });
  // An app unfollowed while the check ran was written again above.
  await forgetUnfollowed(ids);
  if (answered === 0 && lastError) throw lastError;
  const short = (run: StoreRun) => run.ids.length > 0 && run.complete < countries.length;
  const failedStores: GrowthStore[] = [...(short(apple) ? (['appstore'] as const) : []), ...(short(play) ? (['playstore'] as const) : [])];
  // Countries never reached, when both stores stopped, are short of an answer too.
  return { changes, countries: answered, failed: countries.length - complete, failedStores, unreadable: play.unreadable };
}

async function recordChanges(found: Map<string, CountryChange[]>, foundAt: number): Promise<RivalChange[]> {
  const all: RivalChange[] = [];
  for (const [appId, list] of found) {
    const grouped = groupChanges(appId, list, foundAt);
    const kept = (await readMeta<RivalChange[]>(rivalKeys.changes(appId))) ?? [];
    await writeMeta(rivalKeys.changes(appId), [...grouped, ...kept].slice(0, MAX_CHANGES_KEPT));
    all.push(...grouped);
  }
  if (all.length > 0) {
    announce('data');
    const screenshots = all.filter(isScreenshotChange);
    if (screenshots.length > 0) foundListeners.forEach((listener) => listener(screenshots));
  }
  return all;
}

/** Whether a list is due a check: it follows an app, and its last answers are older than the check interval. */
export function isRivalListDue(list: RivalList, now = Date.now()): boolean {
  if (list.rivals.length === 0) return false;
  if (list.failedAt && now - list.failedAt < RETRY_AFTER_FAILURE_MS) return false;
  return !list.checkedAt || now - list.checkedAt >= RIVAL_CHECK_EVERY_MS;
}

/**
 * The apps to look at again because their store left gaps in the last check
 * of them, once RETRY_AFTER_FAILURE_MS has passed: that store's apps only,
 * so a store that answered everywhere is not asked twice. Empty when nothing
 * waits for a retry.
 */
export function rivalRetryIds(list: RivalList, now = Date.now()): string[] {
  const stores = (Object.keys(list.trouble ?? {}) as GrowthStore[]).filter((store) => {
    const trouble = list.trouble?.[store];
    return !!trouble && canAsk(store) && now - trouble.at >= RETRY_AFTER_FAILURE_MS;
  });
  return stores.length > 0 ? listedIds(list).filter((id) => stores.includes(storeOf(id))) : [];
}

/** One background pass: check every list that is due, and retry the stores that left gaps, one list after another. */
export async function runRivalPass(options: { signal?: AbortSignal } = {}): Promise<void> {
  const now = Date.now();
  const work = (await allRivalLists())
    .map((list) => ({ list, retry: isRivalListDue(list, now) ? null : rivalRetryIds(list, now) }))
    .filter(({ list, retry }) => list.rivals.length > 0 && (!retry || retry.length > 0));
  for (const { list, retry } of work) {
    if (options.signal?.aborted) return;
    try {
      await checkRivals(list.owner, { signal: options.signal, ...(retry ? { only: retry } : {}) });
    } catch (error) {
      if (isAbort(error, options.signal)) return;
      console.error('The competitors check failed', error);
    }
  }
}
