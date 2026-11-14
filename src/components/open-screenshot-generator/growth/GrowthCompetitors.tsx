"use client";

// Competitors: apps the user follows on the App Store, and in the desktop app
// on Google Play too, with their screenshots, rating, version and price in
// each country, the changes Growth found, and the user's own screenshots
// beside theirs (src/lib/growth/rivals.ts, rivalWatch.ts and playPage.ts).
//
// It reads Apple's public lookup, which needs no key, so unlike the rest of
// Growth this screen works in the web build and before a key is connected.
// Google Play pages need the desktop app, as they come with no CORS header.
// The user's own set comes from three places: the app Growth shows (looked
// up with the others; a Google Play app shows its Growth refresh until a
// check reads its page), the app named on this screen when Growth has none,
// and the project open in the editor, drawn live with StaticArtboard.

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ExternalLinkIcon,
  EyeIcon,
  Loader2Icon,
  PlusIcon,
  RefreshCwIcon,
  SearchIcon,
  SquareIcon,
  XIcon,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { openExternal } from '@/lib/desktop';
import { formatDay, normalizeDay } from '@/lib/growth/dates';
import { formatAgo, formatCount, formatRating } from '@/lib/growth/format';
import { byTerritory } from '@/lib/growth/metrics';
import { ratingSummary } from '@/lib/growth/ratings';
import { PlayPageUnreadable, canReadGooglePlay } from '@/lib/growth/playPage';
import {
  MAX_RIVAL_COUNTRIES,
  MAX_RIVALS,
  RIVAL_CHECK_EVERY_MS,
  artworkAt,
  describeSetChange,
  findRivals,
  isRivalAppId,
  isScreenshotChange,
  isWideShot,
  localTerritory,
  ownAppId,
  sameSet,
  startingCountries,
  type RivalCandidate,
  type RivalChange,
  type RivalEntry,
  type RivalStorefront,
} from '@/lib/growth/rivals';
import {
  checkRivals,
  followRival,
  isRivalListDue,
  markRivalChangesSeen,
  readSnapshots,
  changeRivalCountries,
  moveUnownedRivals,
  setRivalsOnScreen,
  setYourApp,
  stopRivalCheck,
  unfollowRival,
} from '@/lib/growth/rivalWatch';
import { isGoogleImage } from '@/lib/growth/storeImages';
import { storeOf, type GrowthStore } from '@/lib/growth/stores';
import { TERRITORY_CODES, territoryName } from '@/lib/growth/territories';
import { spillFor, type BoardSpill } from '@/lib/spanArtboards';
import { projectBoards, type ShotDevice } from '@/lib/growth/projectShots';
import { localeLabel } from '@/lib/i18n/locales';
import { cn } from '@/lib/utils';
import type { ArtboardState } from '@/types/artboard';
import { StaticArtboard, count3dDevices } from '../StaticArtboard';
import { flattenBoard3d, flattenElement3d } from '../start/quickstart/deckLayout';
import { EmptyState, Gated, Panel, SectionTitle, Stars, StoreImage, useGrowthView } from './GrowthShared';

type Device = ShotDevice;
type Layout = 'search' | 'all';
type Metric = 'rating' | 'price' | 'version' | 'screenshots';

type DeviceNames = Record<Device, string>;

const APPLE_DEVICES: DeviceNames = { iphone: 'iPhone', ipad: 'iPad' };
/** With a Google Play app in the comparison, the devices go by their plain names. */
const ANY_DEVICES: DeviceNames = { iphone: 'Phone', ipad: 'Tablet' };
const CHANGES_SHOWN = 6;
const HOURS_BETWEEN_CHECKS = Math.round(RIVAL_CHECK_EVERY_MS / 3_600_000);

type ContenderKind = 'you' | 'project' | 'rival';

/** One app in the comparison: the user's own or a followed one. */
interface Contender {
  id: string;
  kind: 'you' | 'rival';
  store: GrowthStore;
  name: string;
  developer: string;
  iconUrl: string | null;
}

/**
 * The user's own Google Play app before a check has read its page: the
 * screenshots and rating of Growth's own Google Play refresh.
 */
interface OwnFallback {
  shots: string[];
  rating: { average: number | null; count: number | null } | null;
}

function shotsOf(storefront: RivalStorefront | null | undefined, device: Device): string[] {
  if (!storefront) return [];
  return device === 'ipad' ? storefront.ipadScreenshots : storefront.screenshots;
}

/** "The App Store", "Google Play", "The App Store and Google Play". */
function storesText(stores: GrowthStore[]): string {
  const apple = stores.includes('appstore');
  const google = stores.includes('playstore');
  return apple && google ? 'The App Store and Google Play' : google ? 'Google Play' : 'The App Store';
}

/** "Ludo King, Ludo STAR and Yalla Ludo". */
function namesText(names: string[]): string {
  return names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** "United States, Germany and 6 more countries". */
function countriesText(codes: string[], checked: string[]): string {
  if (codes.length > 1 && checked.length > 1 && checked.every((code) => codes.includes(code))) return 'In every country checked';
  const names = codes.map(territoryName);
  if (names.length <= 3) return `In ${namesText(names)}`;
  const more = names.length - 2;
  return `In ${names.slice(0, 2).join(', ')} and ${more} more ${more === 1 ? 'country' : 'countries'}`;
}

function changeTitle(change: RivalChange, name: string): string {
  switch (change.kind) {
    case 'screenshots':
      return storeOf(change.appId) === 'playstore' ? `${name} changed its Google Play screenshots` : `${name} changed its iPhone screenshots`;
    case 'ipad-screenshots':
      return `${name} changed its iPad screenshots`;
    case 'version':
      return `${name} released version ${change.after[0] ?? ''}`;
    case 'update':
      return `${name} released an update`;
    case 'name':
      return `${change.before[0] ?? name} changed its name to ${change.after[0] ?? ''}`;
    case 'icon':
      return `${name} changed its icon`;
    case 'price':
      return `${name} changed its price from ${change.before[0] || 'nothing'} to ${change.after[0] || 'nothing'}`;
  }
}

/** "3 new screenshots, 1 taken out". */
function setChangeText(change: RivalChange): string {
  const { added, removed, reordered } = describeSetChange(change.before, change.after);
  if (reordered) return 'Same screenshots in a new order';
  const parts: string[] = [];
  if (added > 0) parts.push(`${added} new ${added === 1 ? 'screenshot' : 'screenshots'}`);
  if (removed > 0) parts.push(`${removed} taken out`);
  return parts.join(', ') || 'Screenshots changed';
}

function releaseDay(storefront: RivalStorefront): string | null {
  const day = normalizeDay(storefront.releasedAt);
  return day ? formatDay(day) : null;
}

export function GrowthCompetitors() {
  const view = useGrowthView();
  const owner = view.rivalOwner;
  const { list, snapshots, changes, seen, checking, loaded, unowned } = view.rivals;
  const rivals = useMemo(() => list?.rivals ?? [], [list]);
  const play = view.store === 'playstore';
  const ownId = list ? ownAppId(list) : isRivalAppId(owner) ? owner : null;
  // Google Play apps can be followed where their pages can be read: the desktop app.
  const playToo = canReadGooglePlay();
  const listStores = useMemo(
    () => Array.from(new Set([...rivals.map((rival) => rival.id), ...(ownId ? [ownId] : [])].map(storeOf))),
    [rivals, ownId]
  );

  // A new list starts with the app's busiest countries, then the shopper's own, then the usual big ones.
  const busiest = useMemo(
    () =>
      byTerritory(view.byDate, view.window)
        .sort((a, b) => b.totals.downloads - a.totals.downloads)
        .slice(0, 5)
        .map((row) => row.key),
    [view.byDate, view.window]
  );
  const starting = useMemo(() => startingCountries([...busiest, localTerritory()]), [busiest]);
  const countries = list?.countries.length ? list.countries : starting;

  const focus = view.tabOptions.rivalChange ? changes.find((change) => change.id === view.tabOptions.rivalChange) : undefined;
  const [country, setCountry] = useState<string>(() => countries[0] ?? 'US');
  const [device, setDevice] = useState<Device>('iphone');
  const [layout, setLayout] = useState<Layout>('search');
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const sideBySide = useRef<HTMLDivElement>(null);

  // The country on show stays one of the list's.
  useEffect(() => {
    if (!countries.includes(country)) setCountry(countries[0] ?? 'US');
  }, [countries, country]);

  // Opened on a change (the alert's Compare): its country and device.
  const focused = useRef<string | null>(null);
  useEffect(() => {
    if (!focus || focused.current === focus.id) return;
    focused.current = focus.id;
    const first = focus.territories.find((code) => countries.includes(code));
    if (first) setCountry(first);
    if (isScreenshotChange(focus)) setDevice(focus.kind === 'ipad-screenshots' ? 'ipad' : 'iphone');
    window.setTimeout(() => document.querySelector(`[data-rival-change="${CSS.escape(focus.id)}"]`)?.scrollIntoView({ block: 'center' }), 50);
  }, [focus, countries]);

  // Changes that were new when they reached the screen keep their label for
  // the visit; the counts on the activity bar and the menu drop at once.
  // ChangesPanel lists every one of them, past CHANGES_SHOWN too, so none is
  // marked seen without being in the list.
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!view.active || !loaded) return;
    const unseen = changes.filter((change) => !seen.has(change.id)).map((change) => change.id);
    if (unseen.length === 0) return;
    setFresh((current) => new Set([...current, ...unseen]));
    void markRivalChangesSeen(unseen);
  }, [view.active, loaded, changes, seen]);

  useEffect(() => {
    if (!view.active) return;
    setRivalsOnScreen(owner);
    return () => setRivalsOnScreen(null);
  }, [view.active, owner]);

  // A list due a check is checked on opening; the background pass would get to it later.
  useEffect(() => {
    if (!view.active || !list || checking || !isRivalListDue(list)) return;
    void checkRivals(owner, { first: country }).catch((error) => console.error('The competitors check failed', error));
    // On opening, and when a list comes due while the screen shows.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.active, list, owner]);

  // The open project, read when the screen opens rather than on every edit.
  const [project, setProject] = useState(() => view.openProject?.() ?? null);
  useEffect(() => {
    if (view.active) setProject(view.openProject?.() ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view.active]);
  // The project row shows when the project has screenshots at all; a device it has none for says so.
  const projectSet = useMemo(() => {
    if (!project) return null;
    const { any, boards, spill } = projectBoards(project.artboards, device);
    return any ? { name: project.name, language: project.language, boards, spill } : null;
  }, [project, device]);

  const check = () => {
    setMessage(null);
    // Countries a store left out, and Google Play pages Growth could not
    // read, show in the lines the list keeps (troubleLines), with the same
    // count whoever ran the check. A check with no answer at all adds a hint.
    void checkRivals(owner, { first: country, wait: true }).catch((error) => {
      if ((error as Error)?.name === 'AbortError') return;
      console.error('The competitors check failed', error);
      if (error instanceof PlayPageUnreadable) return;
      setMessage({ tone: 'error', text: `${storesText(listStores)} could not be reached. Check your connection and try again` });
    });
  };

  const follow = async (candidate: RivalCandidate) => {
    setMessage(null);
    // A list checked lately looks only the new app up, in every country: a
    // Google Play app is one page per app and country, so checking the whole
    // list again would ask Google for every page. A new or due list gets a
    // whole check, with the new app in it.
    const lately = !!list && list.rivals.length > 0 && !isRivalListDue(list);
    const followed = await followRival(owner, candidate, countries);
    const options = { first: country, wait: true, ...(lately ? { only: [candidate.id] } : {}) };
    // A check already running read the list before the follow, so when it
    // leaves countries of the new app unchecked another one runs after it.
    const covered = async () => {
      const snapshot = (await readSnapshots([candidate.id])).get(candidate.id);
      return !!snapshot && followed.countries.every((code) => snapshot.countries[code] !== undefined);
    };
    void (async () => {
      await checkRivals(owner, options);
      if (!(await covered())) await checkRivals(owner, options);
    })().catch((error) => console.error('Looking up the new competitor failed', error));
  };

  const contenders: Contender[] = useMemo(() => {
    const out: Contender[] = [];
    const ownStorefront = ownId ? snapshots.get(ownId)?.countries[country] : null;
    const named = list?.yourApp;
    if (ownId) {
      const growthApp = owner === ownId;
      out.push({
        id: ownId,
        kind: 'you',
        store: storeOf(ownId),
        name: ownStorefront?.name || named?.name || (growthApp ? view.app.name : 'Your app'),
        developer: ownStorefront?.developer || named?.developer || '',
        iconUrl: ownStorefront?.iconUrl ?? named?.iconUrl ?? (growthApp ? (play ? view.data.live?.iconUrl : null) ?? view.app.iconUrl ?? null : null),
      });
    }
    for (const rival of rivals) {
      const storefront = snapshots.get(rival.id)?.countries[country];
      out.push({
        id: rival.id,
        kind: 'rival',
        store: storeOf(rival.id),
        name: storefront?.name || rival.name,
        developer: storefront?.developer || rival.developer,
        iconUrl: storefront?.iconUrl ?? rival.iconUrl,
      });
    }
    return out;
  }, [ownId, snapshots, country, owner, list, view.app, view.data.live, play, rivals]);

  const hasPlay = contenders.some((entry) => entry.store === 'playstore');
  const deviceNames = hasPlay ? ANY_DEVICES : APPLE_DEVICES;
  const nameOf = (appId: string) => contenders.find((entry) => entry.id === appId)?.name ?? rivals.find((rival) => rival.id === appId)?.name ?? 'An app';
  const iconOf = (appId: string) => contenders.find((entry) => entry.id === appId)?.iconUrl ?? null;
  const checkReason = rivals.length === 0 ? 'Follow an app first' : null;
  // What went wrong in the last check, per store, until a check gets every answer. The background pass retries within the hour.
  const checkedStores = listStores.filter((store) => store === 'appstore' || playToo);
  const lastFailed = !!list?.failedAt && (!list.checkedAt || list.failedAt > list.checkedAt);
  const troubleLines = checkedStores.flatMap((store) => {
    const trouble = list?.trouble?.[store];
    if (!trouble) return [];
    if (trouble.unreadable) return ['Growth could not read some Google Play pages in the last check. Google may have changed how its pages are built'];
    if (lastFailed) return [];
    const where = trouble.countries === 1 ? '1 country' : `${trouble.countries} countries`;
    return [`${storesText([store])} did not answer in ${where} in the last check. Growth tries again in an hour`];
  });
  // A page Growth could not read is an answer, so that store is not one that did not answer.
  const silent = checkedStores.filter((store) => !list?.trouble?.[store]?.unreadable);
  if (lastFailed && silent.length > 0) troubleLines.unshift(`${storesText(silent)} did not answer the last check. Growth tries again in an hour`);

  const compareWith = (change: RivalChange) => {
    const first = change.territories.find((code) => countries.includes(code));
    if (first) setCountry(first);
    setDevice(change.kind === 'ipad-screenshots' ? 'ipad' : 'iphone');
    window.setTimeout(() => sideBySide.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 30);
  };

  if (!loaded) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2Icon className="h-4 w-4 animate-spin" />
        Loading your competitors
      </p>
    );
  }

  const controls = (
    <>
      <Select value={country} onValueChange={setCountry}>
        <SelectTrigger className="h-8 w-[170px] text-xs" aria-label="Country">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {countries.map((code) => (
            <SelectItem key={code} value={code} className="text-xs">
              {territoryName(code)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Toggle
        label="Device"
        value={device}
        options={[
          ['iphone', deviceNames.iphone],
          ['ipad', deviceNames.ipad],
        ]}
        onChange={setDevice}
      />
      {checking ? (
        <Button variant="outline" size="sm" className="h-8" onClick={() => stopRivalCheck(owner)} title="Stop checking and keep what came back">
          <SquareIcon className="mr-1.5 h-3.5 w-3.5" />
          Stop
        </Button>
      ) : (
        <Gated reason={checkReason}>
          <Button variant="outline" size="sm" className="h-8" onClick={check} title="Check every app you follow in every country now">
            <RefreshCwIcon className="mr-1.5 h-3.5 w-3.5" />
            Check now
          </Button>
        </Gated>
      )}
    </>
  );

  const changesPanel = (
    <ChangesPanel changes={changes} fresh={fresh} focusId={focus?.id} countries={countries} nameOf={nameOf} iconOf={iconOf} onCompare={compareWith} />
  );

  const findHint = playToo
    ? 'Type the name of an App Store app, or paste the link of an app on the App Store or Google Play'
    : 'Type the name of the app or paste its App Store link';
  const finder = (
    <AppFinder
      territory={country}
      label="Find an app to follow"
      actionLabel="Follow"
      takenReason={(candidate) =>
        rivals.some((rival) => rival.id === candidate.id)
          ? 'Following'
          : candidate.id === ownId
            ? 'Your app'
            : null
      }
      blocked={rivals.length >= MAX_RIVALS ? `You can follow ${MAX_RIVALS} apps. Stop following one first` : null}
      onPick={follow}
    />
  );

  return (
    <div className="space-y-4" data-testid="growth-competitors">
      <SectionTitle
        title="Competitors"
        hint={`Apps you follow on the App Store${playToo ? ' and Google Play' : ''}. Growth checks the apps twice a day and tells you when one of them changes its screenshots`}
        actions={controls}
      />

      {checking ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
          <Loader2Icon className="h-3.5 w-3.5 animate-spin" />
          <span>
            Checking {checking.done} of {checking.total} countries
          </span>
          <div className="h-1 w-40 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-[hsl(var(--growth-series))] transition-[width]"
              style={{ width: `${checking.total > 0 ? Math.max(5, Math.round((checking.done / checking.total) * 100)) : 5}%` }}
            />
          </div>
        </div>
      ) : (
        list?.checkedAt && (
          <p className="text-xs text-muted-foreground" data-testid="growth-competitors-checked">
            Checked {formatAgo(list.checkedAt)}. Growth checks again every {HOURS_BETWEEN_CHECKS} hours while the editor is open
          </p>
        )
      )}
      {!checking &&
        troubleLines.map((line) => (
          <p key={line} className="text-xs text-destructive" data-testid="growth-competitors-trouble">
            {line}
          </p>
        ))}
      {message && <p className={cn('text-xs', message.tone === 'error' ? 'text-destructive' : 'text-[hsl(var(--growth-good))]')}>{message.text}</p>}
      {unowned && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/50 px-3 py-2 text-xs" data-testid="growth-unowned-rivals">
          <span className="min-w-0 flex-1">You followed {namesText(unowned.rivals.map((rival) => rival.name))} before you added your key.</span>
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => void moveUnownedRivals(owner)}>
            Follow {unowned.rivals.length === 1 ? unowned.rivals[0].name : `the ${unowned.rivals.length} apps`} for {view.app.name}
          </Button>
        </div>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-4">
          {rivals.length === 0 ? (
            <>
              <EmptyState icon={EyeIcon} title="No competitors yet">
                {playToo ? `Follow up to ${MAX_RIVALS} apps from the App Store or Google Play.` : `Follow up to ${MAX_RIVALS} App Store apps.`} Growth then shows their
                screenshots, rating, version and price in each country, and tells you when one of them changes its screenshots.
              </EmptyState>
              <Panel>
                <SectionTitle title="Follow an app" hint={findHint} />
                {finder}
              </Panel>
            </>
          ) : (
            <>
              {changes.length > 0 && changesPanel}
              <div ref={sideBySide} className="scroll-mt-4">
                <SideBySide
                  contenders={contenders}
                  country={country}
                  device={device}
                  deviceNames={deviceNames}
                  layout={layout}
                  onLayout={setLayout}
                  snapshots={snapshots}
                  ownFallback={play && ownId === owner ? { shots: view.data.live?.screenshotUrls ?? [], rating: ratingSummary(view.data.ratings) } : null}
                  project={projectSet}
                  onUnfollow={(appId) => void unfollowRival(owner, appId)}
                />
              </div>
              <CountryTable
                contenders={contenders}
                countries={countries}
                snapshots={snapshots}
                device={device}
                deviceNames={deviceNames}
                selected={country}
                onSelect={(code) => {
                  setCountry(code);
                  sideBySide.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }}
              />
              {changes.length === 0 && changesPanel}
            </>
          )}
        </div>

        <div className="space-y-4">
          {rivals.length > 0 && (
            <Panel>
              <SectionTitle title="Follow an app" hint={`${findHint}. Up to ${MAX_RIVALS} apps`} />
              {finder}
            </Panel>
          )}
          {!owner && (
            <YourAppPanel
              yourApp={list?.yourApp ?? null}
              storefront={list?.yourApp ? snapshots.get(list.yourApp.id)?.countries[country] ?? null : null}
              territory={country}
              takenReason={(candidate) => (rivals.some((rival) => rival.id === candidate.id) ? 'You follow this app' : null)}
              onPick={async (candidate) => {
                await setYourApp(owner, candidate, countries);
                if (rivals.length > 0) void checkRivals(owner, { first: country, wait: true }).catch((error) => console.error('Looking up your app failed', error));
              }}
              onClear={() => void setYourApp(owner, null, countries)}
            />
          )}
          <CountriesPanel countries={countries} hasPlay={hasPlay} onChange={(change) => void changeRivalCountries(owner, change, countries)} />
        </div>
      </div>
    </div>
  );
}

// --- pieces ---------------------------------------------------------------------------

function Toggle<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: Array<[T, string]>; onChange: (value: T) => void }) {
  return (
    <div className="inline-flex h-8 items-center rounded-md border p-0.5" role="group" aria-label={label}>
      {options.map(([option, text]) => (
        <button
          key={option}
          type="button"
          aria-pressed={value === option}
          onClick={() => onChange(option)}
          className={cn(
            'h-full rounded px-2.5 text-xs transition-colors',
            value === option ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground hover:text-foreground'
          )}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

/** A store screenshot, small. Google Play's come through the app (StoreImage); Apple's at the size shown. */
function Shot({ url, alt, className }: { url: string; alt: string; className?: string }) {
  const [broken, setBroken] = useState(false);
  if (broken) {
    return (
      <span className={cn('flex aspect-[9/19.5] items-center justify-center rounded-md border border-dashed bg-muted px-1 text-center text-[10px] text-muted-foreground', className)}>
        Picture no longer on the App Store
      </span>
    );
  }
  if (isGoogleImage(url)) return <StoreImage src={artworkAt(url, 600)} alt={alt} className={className} loading="lazy" />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={artworkAt(url, 600)} alt={alt} className={className} loading="lazy" onError={() => setBroken(true)} />;
}

function AppIcon({ url, className }: { url: string | null; className?: string }) {
  if (!url) return <span aria-hidden className={cn('inline-block shrink-0 rounded-xl bg-muted', className)} />;
  if (isGoogleImage(url)) return <StoreImage src={artworkAt(url, 128)} alt="" className={cn('shrink-0 rounded-xl border', className)} />;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={artworkAt(url, 128)} alt="" className={cn('shrink-0 rounded-xl border', className)} loading="lazy" />;
}

/** One board at the width of its cell, for the search results' columns. */
function FitBoard({ board, spill }: { board: ArtboardState; spill: BoardSpill }) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const node = box.current;
    if (!node) return;
    const measure = () => setWidth(node.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={box} className="w-full overflow-hidden rounded-md border" style={{ aspectRatio: `${board.size.width} / ${board.size.height}` }} title={board.name}>
      {width > 0 && <StaticArtboard artboard={board} scale={width / Math.max(1, board.size.width)} spill={spill} />}
    </div>
  );
}

/**
 * 3D frames the project row draws in 3D, as many as the store preview does
 * (StoreListingPreview): each takes a WebGL context, and the canvas behind
 * Growth holds some already. The frames past these are drawn flat.
 */
const LIVE_3D_BUDGET = 6;

/** What the boards past LIVE_3D_BUDGET show of a neighbour's 3D frame, drawn flat as well. */
function flatSpill(spill: BoardSpill): BoardSpill {
  const flat = (copies: BoardSpill['behind']) => copies.map((copy) => ({ ...copy, element: flattenElement3d(copy.element), source: flattenElement3d(copy.source) }));
  return { behind: flat(spill.behind), front: flat(spill.front) };
}

/** The first `limit` boards of the project row, each with what it shows of its neighbours, and whether its 3D frames are drawn flat. */
function projectShots(boards: ArtboardState[], spill: Map<string, BoardSpill>, limit?: number): { board: ArtboardState; spill: BoardSpill; flat: boolean }[] {
  let budget = LIVE_3D_BUDGET;
  return boards.slice(0, limit ?? boards.length).map((board) => {
    const boardSpill = spillFor(spill, board.id);
    const cost = count3dDevices(board, boardSpill);
    if (cost <= budget) {
      budget -= cost;
      return { board, spill: boardSpill, flat: false };
    }
    return { board: flattenBoard3d(board), spill: flatSpill(boardSpill), flat: true };
  });
}

/** The open project's screenshots, drawn as they export: at a height in a row, or each at the width of a column. */
function ProjectShots({
  boards,
  spill,
  height,
  limit,
  fit,
}: {
  boards: ArtboardState[];
  /** Worked out over every artboard of the project (computeSpill). */
  spill: Map<string, BoardSpill>;
  height: number;
  limit?: number;
  fit?: boolean;
}) {
  const shown = useMemo(() => projectShots(boards, spill, limit), [boards, spill, limit]);
  return (
    <>
      {shown.map(({ board, spill }) =>
        fit ? (
          <FitBoard key={board.id} board={board} spill={spill} />
        ) : (
          <div key={board.id} className="shrink-0 overflow-hidden rounded-md border" title={board.name}>
            <StaticArtboard artboard={board} scale={height / Math.max(1, board.size.height)} spill={spill} />
          </div>
        )
      )}
    </>
  );
}

function AppFinder({
  territory,
  label,
  actionLabel,
  takenReason,
  blocked,
  onPick,
}: {
  territory: string;
  label: string;
  actionLabel: string;
  /** Why a result cannot be picked ("Following"), shown in place of the button. */
  takenReason: (candidate: RivalCandidate) => string | null;
  /** Why no result can be picked now. */
  blocked?: string | null;
  onPick: (candidate: RivalCandidate) => Promise<void>;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<RivalCandidate[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [picking, setPicking] = useState<string | null>(null);

  useEffect(() => {
    const value = query.trim();
    if (value.length < 2) {
      setResults((current) => (current.length === 0 ? current : []));
      setNotice(null);
      setSearching(false);
      return;
    }
    // A search the next keystroke replaces is stopped before it reaches
    // Apple: searches wait their turn with the checks (lookupTurn).
    const stop = new AbortController();
    const timer = window.setTimeout(() => {
      setSearching(true);
      findRivals(value, { territory, signal: stop.signal })
        .then((found) => {
          if (stop.signal.aborted) return;
          setResults(found.candidates);
          setNotice(found.notice);
        })
        .catch((error) => {
          if (stop.signal.aborted) return;
          console.error('Searching the App Store failed', error);
          setResults([]);
          setNotice('The App Store could not be reached. Check your connection and try again');
        })
        .finally(() => {
          if (!stop.signal.aborted) setSearching(false);
        });
    }, 400);
    return () => {
      stop.abort();
      window.clearTimeout(timer);
    };
  }, [query, territory]);

  return (
    <div className="space-y-2">
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={canReadGooglePlay() ? 'App name or store link' : 'App name or App Store link'}
          aria-label={label}
          className="h-9 pl-8 text-sm"
        />
        {searching && <Loader2Icon className="absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-muted-foreground" />}
      </div>
      {notice && <p className="text-xs text-muted-foreground">{notice}</p>}
      {results.length > 0 && (
        <ul className="max-h-80 space-y-1 overflow-y-auto" aria-label="Apps found">
          {results.map((candidate) => {
            const taken = takenReason(candidate);
            return (
              <li key={candidate.id} className="flex items-center gap-2 rounded-md p-1.5 hover:bg-muted/60">
                <AppIcon url={candidate.iconUrl} className="h-9 w-9" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{candidate.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {[candidate.developer, candidate.ratingCount ? `${formatRating(candidate.rating)} stars, ${formatCount(candidate.ratingCount)} ratings` : 'No ratings yet'].filter(Boolean).join(' · ')}
                  </p>
                </div>
                {taken ? (
                  <span className="shrink-0 text-xs text-muted-foreground">{taken}</span>
                ) : (
                  <Gated reason={blocked}>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 shrink-0 text-xs"
                      disabled={picking !== null}
                      aria-label={`${actionLabel} ${candidate.name}`}
                      onClick={() => {
                        setPicking(candidate.id);
                        void onPick(candidate)
                          .then(() => setQuery(''))
                          .catch((error) => setNotice(error instanceof Error ? error.message : 'That app could not be added'))
                          .finally(() => setPicking(null));
                      }}
                    >
                      {picking === candidate.id ? <Loader2Icon className="mr-1 h-3 w-3 animate-spin" /> : <PlusIcon className="mr-1 h-3 w-3" />}
                      {actionLabel}
                    </Button>
                  </Gated>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function ChangesPanel({
  changes,
  fresh,
  focusId,
  countries,
  nameOf,
  iconOf,
  onCompare,
}: {
  changes: RivalChange[];
  fresh: Set<string>;
  focusId?: string;
  countries: string[];
  nameOf: (appId: string) => string;
  iconOf: (appId: string) => string | null;
  onCompare: (change: RivalChange) => void;
}) {
  const [all, setAll] = useState(false);
  // The newest few, and every change that is new on this visit or was opened from the alert.
  const short = changes.filter((change, index) => index < CHANGES_SHOWN || fresh.has(change.id) || change.id === focusId);
  const shown = all ? changes : short;
  return (
    <Panel data-testid="growth-competitor-changes">
      <SectionTitle title="What changed" hint="What Growth found in the apps you follow, newest first" />
      {changes.length === 0 ? (
        <p className="text-xs text-muted-foreground">No changes yet. Growth compares each check with the one before it.</p>
      ) : (
        <ul className="space-y-2">
          {shown.map((change) => (
            <ChangeCard
              key={change.id}
              change={change}
              name={nameOf(change.appId)}
              iconUrl={iconOf(change.appId)}
              isNew={fresh.has(change.id)}
              open={change.id === focusId || (fresh.has(change.id) && isScreenshotChange(change))}
              countries={countries}
              onCompare={() => onCompare(change)}
            />
          ))}
        </ul>
      )}
      {short.length < changes.length && (
        <Button variant="ghost" size="sm" className="mt-2 h-7 text-xs" onClick={() => setAll((value) => !value)}>
          {all ? 'Show fewer changes' : `Show all ${changes.length} changes`}
        </Button>
      )}
    </Panel>
  );
}

function ChangeCard({
  change,
  name,
  iconUrl,
  isNew,
  open: startOpen,
  countries,
  onCompare,
}: {
  change: RivalChange;
  name: string;
  iconUrl: string | null;
  isNew: boolean;
  open: boolean;
  countries: string[];
  onCompare: () => void;
}) {
  const [open, setOpen] = useState(startOpen);
  // A card on screen before its change counts as new (the screen marks changes
  // new once it is in front) opens then.
  useEffect(() => {
    if (startOpen) setOpen(true);
  }, [startOpen]);
  const screenshots = isScreenshotChange(change);
  const found = new Date(change.foundAt);
  return (
    <li className="rounded-md border p-3" data-rival-change={change.id}>
      <div className="flex items-start gap-2">
        <AppIcon url={iconUrl} className="h-8 w-8" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">
            {changeTitle(change, name)}
            {isNew && (
              <span className="ml-2 rounded-full bg-[hsl(var(--growth-highlight))]/20 px-1.5 py-0.5 align-middle text-[11px] font-normal" data-testid="growth-change-new">
                New
              </span>
            )}
          </p>
          <p className="text-xs text-muted-foreground">
            {[screenshots ? setChangeText(change) : null, countriesText(change.territories, countries), `Found ${formatDay(found.toISOString().slice(0, 10))}`]
              .filter(Boolean)
              .join(' · ')}
          </p>
        </div>
      </div>
      {screenshots && (
        <div className="mt-2 flex flex-wrap gap-2">
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
            {open ? 'Hide before and after' : 'Show before and after'}
          </Button>
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={onCompare}>
            Compare with yours
          </Button>
        </div>
      )}
      {screenshots && open && (
        <div className="mt-3 space-y-2">
          {(
            [
              ['Before', change.before],
              ['Now', change.after],
            ] as const
          ).map(([label, urls]) => (
            <div key={label}>
              <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
              {urls.length === 0 ? (
                <p className="text-xs text-muted-foreground">No screenshots</p>
              ) : (
                <div className="flex gap-1.5 overflow-x-auto pb-1">
                  {urls.map((url, index) => (
                    <Shot key={`${index}:${url}`} url={url} alt={`${name}, ${label.toLowerCase()}, screenshot ${index + 1}`} className="h-40 w-auto shrink-0 rounded-md border object-contain" />
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {change.kind === 'icon' && (
        <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
          <AppIcon url={change.before[0] ?? null} className="h-10 w-10" />
          <span>to</span>
          <AppIcon url={change.after[0] ?? null} className="h-10 w-10" />
        </div>
      )}
      {(change.kind === 'version' || change.kind === 'update') && change.notes && (
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer text-muted-foreground">
            {change.kind === 'version' ? `What is new in version ${change.after[0]}` : 'What is new in the update'}
          </summary>
          <p className="mt-1 whitespace-pre-line break-words">{change.notes}</p>
        </details>
      )}
    </li>
  );
}

function SideBySide({
  contenders,
  country,
  device,
  deviceNames,
  layout,
  onLayout,
  snapshots,
  ownFallback,
  project,
  onUnfollow,
}: {
  contenders: Contender[];
  country: string;
  device: Device;
  deviceNames: DeviceNames;
  layout: Layout;
  onLayout: (layout: Layout) => void;
  snapshots: Map<string, { countries: Record<string, RivalStorefront | null> }>;
  ownFallback: OwnFallback | null;
  project: ProjectSet | null;
  onUnfollow: (appId: string) => void;
}) {
  const countryName = territoryName(country);
  const rows: React.ReactNode[] = [];
  const height = layout === 'search' ? 176 : 208;
  const hasPlay = contenders.some((entry) => entry.store === 'playstore');

  for (const entry of contenders) {
    const googlePlay = entry.store === 'playstore';
    const storefront = snapshots.get(entry.id)?.countries[country];
    const fallback = entry.kind === 'you' && !storefront ? ownFallback : null;
    let shots = fallback ? fallback.shots : shotsOf(storefront, device);
    let note: string | null = null;
    if (googlePlay && device === 'ipad') {
      shots = [];
      note = `Google Play shows the screenshots of every device together, under ${deviceNames.iphone}`;
    } else if (fallback) {
      if (shots.length === 0) note = 'Refresh Growth to read your screenshots from Google Play';
    } else if (storefront === undefined) note = `Not checked in ${countryName} yet`;
    else if (storefront === null) note = googlePlay ? 'Not on Google Play' : `Not on the App Store in ${countryName}`;
    else if (shots.length === 0) note = `No ${deviceNames[device]} screenshots in ${countryName}`;
    const rating = fallback ? fallback.rating?.average ?? null : storefront?.rating ?? null;
    const ratingCount = fallback ? fallback.rating?.count ?? null : storefront?.ratingCount ?? null;
    const day = storefront ? releaseDay(storefront) : null;
    // Some Google Play pages have no version number, only the day of the last update.
    const facts = storefront
      ? [storefront.version ? `Version ${storefront.version}${day ? `, ${day}` : ''}` : day ? `Updated ${day}` : '', storefront.priceLabel].filter(Boolean)
      : fallback
        ? ['On Google Play']
        : [];
    // Kept from an earlier check: the last answer for this country came without the app.
    if (!note && storefront?.missingAt && storefront.missingAt > storefront.seenAt) {
      facts.push(`Not found in the last check. This is how the app looked ${formatAgo(storefront.seenAt)}`);
    }
    // Store search shows the first three screenshots, or only the first when it is a wide one.
    const wide = !!shots[0] && isWideShot(shots[0]);
    const visible = layout === 'search' ? shots.slice(0, wide ? 1 : 3) : shots;
    rows.push(
      <AppRow
        key={entry.id}
        kind={entry.kind}
        layout={layout}
        columns={wide ? 1 : 3}
        name={entry.name}
        developer={entry.developer}
        iconUrl={entry.iconUrl}
        rating={rating}
        ratingCount={ratingCount}
        facts={facts}
        note={note}
        actions={
          entry.kind === 'rival' ? (
            <>
              {storefront?.storeUrl && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                  onClick={() => void openExternal(storefront.storeUrl!)}
                  title={googlePlay ? 'Open the Google Play page' : 'Open the App Store page'}
                  aria-label={`${googlePlay ? 'Open the Google Play page of' : 'Open the App Store page of'} ${entry.name}`}
                >
                  <ExternalLinkIcon className="h-3.5 w-3.5" />
                </Button>
              )}
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => onUnfollow(entry.id)} title={`Stop following ${entry.name}`} aria-label={`Stop following ${entry.name}`}>
                <XIcon className="h-3.5 w-3.5" />
              </Button>
            </>
          ) : null
        }
      >
        {visible.map((url, index) => (
          <Shot
            key={`${index}:${url}`}
            url={url}
            alt={`${entry.name}, screenshot ${index + 1}`}
            className={cn('rounded-md border object-contain', layout === 'search' ? 'h-auto w-full' : 'h-52 w-auto shrink-0')}
          />
        ))}
      </AppRow>
    );
    // The open project goes right under the user's app, or first when there is none.
    if (entry.kind === 'you' && project) rows.push(projectRow(project, layout, device, deviceNames, height));
  }
  if (project && !contenders.some((entry) => entry.kind === 'you')) rows.unshift(projectRow(project, layout, device, deviceNames, height));

  return (
    <Panel data-testid="growth-competitor-compare">
      <SectionTitle
        title={`Screenshots in ${countryName}`}
        hint={
          layout === 'search'
            ? `How the apps look in ${hasPlay ? 'store' : 'App Store'} search results: the first three screenshots`
            : `Every screenshot, in the order ${hasPlay ? 'each store shows' : 'the App Store shows'} them`
        }
        actions={
          <Toggle
            label="Show"
            value={layout}
            options={[
              ['search', 'Search results'],
              ['all', 'All screenshots'],
            ]}
            onChange={onLayout}
          />
        }
      />
      <div className={cn(layout === 'search' ? 'grid gap-3 sm:grid-cols-2 2xl:grid-cols-3' : 'space-y-3')}>{rows}</div>
    </Panel>
  );
}

/** The open project's screenshots for the device shown, in the language on screen (null for the base language). */
interface ProjectSet {
  name: string;
  language: string | null;
  /** What each artboard shows of its neighbours, worked out over every artboard of the project. */
  spill: Map<string, BoardSpill>;
  boards: ArtboardState[];
}

function projectRow(project: ProjectSet, layout: Layout, device: Device, deviceNames: DeviceNames, height: number): React.ReactNode {
  const firstWide = project.boards[0] && project.boards[0].size.width > project.boards[0].size.height;
  const limit = layout === 'search' ? (firstWide ? 1 : 3) : undefined;
  const facts = [
    ...(project.language ? [`In ${localeLabel(project.language)}`] : []),
    ...(projectShots(project.boards, project.spill, limit).some((shot) => shot.flat) ? ['Some 3D frames are drawn flat here'] : []),
  ];
  return (
    <AppRow
      key="open-project"
      kind="project"
      layout={layout}
      columns={firstWide ? 1 : 3}
      name="Open project"
      developer={project.name}
      iconUrl={null}
      rating={null}
      ratingCount={null}
      facts={facts}
      note={project.boards.length === 0 ? `The open project has no ${deviceNames[device]} screenshots` : null}
      testId="growth-competitor-project"
    >
      <ProjectShots boards={project.boards} spill={project.spill} height={height} limit={limit} fit={layout === 'search'} />
    </AppRow>
  );
}

const ROW_BADGE: Record<ContenderKind, string | null> = { you: 'You', project: 'Not on the store yet', rival: null };

function AppRow({
  kind,
  layout,
  columns,
  name,
  developer,
  iconUrl,
  rating,
  ratingCount,
  facts,
  note,
  actions,
  testId,
  children,
}: {
  kind: ContenderKind;
  layout: Layout;
  /** Search results: screenshots side by side in this many equal columns. */
  columns: number;
  name: string;
  developer: string;
  iconUrl: string | null;
  rating: number | null;
  ratingCount: number | null;
  facts: string[];
  note: string | null;
  actions?: React.ReactNode;
  testId?: string;
  children: React.ReactNode;
}) {
  const stars = ratingCount ? (
    <span className="inline-flex items-center gap-1">
      <Stars rating={Math.round((rating ?? 0) * 10) / 10} />
      <span className="tabular-nums">{formatCount(ratingCount)}</span>
    </span>
  ) : (
    <span>No ratings yet</span>
  );
  const badge = ROW_BADGE[kind];
  return (
    <div
      className={cn('min-w-0 rounded-lg border p-3', kind !== 'rival' && 'border-[hsl(var(--growth-series))]/60 bg-[hsl(var(--growth-series))]/5')}
      data-testid={testId ?? 'growth-competitor-row'}
      data-app-name={name}
    >
      <div className="flex items-start gap-2.5">
        {kind !== 'project' && <AppIcon url={iconUrl} className={layout === 'search' ? 'h-11 w-11' : 'h-9 w-9'} />}
        <div className="min-w-0 flex-1">
          <p className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
            <span className="truncate">{name}</span>
            {badge && <span className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">{badge}</span>}
          </p>
          {developer && <p className="truncate text-xs text-muted-foreground">{developer}</p>}
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
            {kind !== 'project' && stars}
            {facts.map((fact) => (
              <span key={fact}>{fact}</span>
            ))}
          </p>
        </div>
        {actions && <div className="flex shrink-0 items-center">{actions}</div>}
      </div>
      {note ? (
        <p className="mt-2 text-xs text-muted-foreground">{note}</p>
      ) : layout === 'search' ? (
        <div className="mt-2 grid items-start gap-1.5" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
          {children}
        </div>
      ) : (
        <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1">{children}</div>
      )}
    </div>
  );
}

function CountryTable({
  contenders,
  countries,
  snapshots,
  device,
  deviceNames,
  selected,
  onSelect,
}: {
  contenders: Contender[];
  countries: string[];
  snapshots: Map<string, { countries: Record<string, RivalStorefront | null> }>;
  device: Device;
  deviceNames: DeviceNames;
  selected: string;
  onSelect: (country: string) => void;
}) {
  const [metric, setMetric] = useState<Metric>('rating');
  const cell = (entry: Contender, country: string): React.ReactNode => {
    const googlePlay = entry.store === 'playstore';
    const storefront = snapshots.get(entry.id)?.countries[country];
    if (storefront === undefined) return <span className="text-muted-foreground">Not checked</span>;
    // Google Play answers in every country, so an app it does not have is not there at all.
    if (storefront === null) return <span className="text-muted-foreground">{googlePlay ? 'Not found' : 'Not sold'}</span>;
    switch (metric) {
      case 'rating':
        return storefront.ratingCount ? (
          <span className="tabular-nums">
            {formatRating(storefront.rating)} <span className="text-muted-foreground">({formatCount(storefront.ratingCount)})</span>
          </span>
        ) : (
          <span className="text-muted-foreground">No ratings</span>
        );
      case 'price':
        return storefront.priceLabel || <span className="text-muted-foreground">Not shown</span>;
      case 'version':
        return (
          <span>
            {storefront.version || 'Updated'}
            {releaseDay(storefront) && <span className="block text-[11px] text-muted-foreground">{releaseDay(storefront)}</span>}
          </span>
        );
      case 'screenshots': {
        if (googlePlay && device === 'ipad') return <span className="text-muted-foreground">Under {deviceNames.iphone}</span>;
        const shots = shotsOf(storefront, device);
        const home = countries.map((code) => snapshots.get(entry.id)?.countries[code]).find((other) => other && shotsOf(other, device).length > 0);
        const own = !!home && home.territory !== country && shots.length > 0 && !sameSet(shotsOf(home, device), shots);
        return (
          <span className="tabular-nums">
            {shots.length}
            {own && (
              <span className="ml-1.5 rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground" title={`Different screenshots from the ones in ${territoryName(home.territory)}`}>
                Own set
              </span>
            )}
          </span>
        );
      }
    }
  };
  return (
    <Panel data-testid="growth-competitor-countries">
      <SectionTitle
        title="In each country"
        hint="Pick a country to see its screenshots above"
        actions={
          <Toggle
            label="Show in the table"
            value={metric}
            options={[
              ['rating', 'Rating'],
              ['price', 'Price'],
              ['version', 'Version'],
              ['screenshots', `${deviceNames[device]} screenshots`],
            ]}
            onChange={setMetric}
          />
        }
      />
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          {/* bg-muted overrides the global teal table header (globals.css), which is for document tables. */}
          <thead className="border-b bg-muted/40 text-muted-foreground">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">
                Country
              </th>
              {contenders.map((entry) => (
                <th key={entry.id} scope="col" className="max-w-[140px] px-2 py-2 font-medium">
                  <span className="flex items-center gap-1.5">
                    <AppIcon url={entry.iconUrl} className="h-5 w-5 rounded-md" />
                    <span className="truncate" title={entry.name}>
                      {entry.kind === 'you' ? `${entry.name} (you)` : entry.name}
                    </span>
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {countries.map((country) => (
              <tr key={country} className={cn('border-b last:border-0', country === selected && 'bg-[hsl(var(--growth-series))]/10')}>
                <th scope="row" className="px-3 py-1.5 font-normal">
                  <button type="button" className="text-left hover:underline" aria-pressed={country === selected} onClick={() => onSelect(country)}>
                    {territoryName(country)}
                  </button>
                </th>
                {contenders.map((entry) => (
                  <td key={entry.id} className="px-2 py-1.5">
                    {cell(entry, country)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

function YourAppPanel({
  yourApp,
  storefront,
  territory,
  takenReason,
  onPick,
  onClear,
}: {
  yourApp: RivalEntry | null;
  storefront: RivalStorefront | null;
  territory: string;
  takenReason: (candidate: RivalCandidate) => string | null;
  onPick: (candidate: RivalCandidate) => Promise<void>;
  onClear: () => void;
}) {
  return (
    <Panel data-testid="growth-your-app">
      <SectionTitle
        title="Your app"
        hint={yourApp ? undefined : `Name your app on the App Store${canReadGooglePlay() ? ' or Google Play' : ''} to see your screenshots next to theirs`}
      />
      {yourApp ? (
        <div className="flex items-center gap-2">
          <AppIcon url={storefront?.iconUrl ?? yourApp.iconUrl} className="h-9 w-9" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{storefront?.name || yourApp.name}</p>
            <p className="truncate text-xs text-muted-foreground">{storefront?.developer || yourApp.developer}</p>
          </div>
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={onClear}>
            Change
          </Button>
        </div>
      ) : (
        <AppFinder territory={territory} label="Find your app" actionLabel="This is my app" takenReason={takenReason} onPick={onPick} />
      )}
    </Panel>
  );
}

function CountriesPanel({
  countries,
  hasPlay,
  onChange,
}: {
  countries: string[];
  hasPlay: boolean;
  onChange: (change: (countries: string[]) => string[]) => void;
}) {
  const options = useMemo(
    () =>
      TERRITORY_CODES.filter((code) => !countries.includes(code))
        .map((code) => ({ code, name: territoryName(code) }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [countries]
  );
  const full = countries.length >= MAX_RIVAL_COUNTRIES;
  return (
    <Panel data-testid="growth-competitor-country-list">
      <SectionTitle
        title="Countries to check"
        hint={
          hasPlay
            ? `Up to ${MAX_RIVAL_COUNTRIES} countries. Each country is one look at the App Store, and one look at Google Play for each Google Play app`
            : `Up to ${MAX_RIVAL_COUNTRIES} countries. Each country is one look at the App Store`
        }
      />
      <ul className="mb-3 flex flex-wrap gap-1.5">
        {countries.map((code) => (
          <li key={code} className="inline-flex items-center gap-1 rounded-full border py-0.5 pl-2.5 pr-1 text-xs">
            {territoryName(code)}
            <button
              type="button"
              className="rounded-full p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-40"
              onClick={() => onChange((current) => current.filter((other) => other !== code))}
              disabled={countries.length <= 1}
              aria-label={`Stop checking ${territoryName(code)}`}
              title={countries.length <= 1 ? 'Growth needs one country to check' : `Stop checking ${territoryName(code)}`}
            >
              <XIcon className="h-3 w-3" />
            </button>
          </li>
        ))}
      </ul>
      <Gated reason={full ? `You can check ${MAX_RIVAL_COUNTRIES} countries. Remove one first` : null}>
        <Select value="" onValueChange={(code) => onChange((current) => (current.includes(code) ? current : [...current, code]))}>
          <SelectTrigger className="h-8 text-xs" aria-label="Add a country">
            <SelectValue placeholder="Add a country" />
          </SelectTrigger>
          <SelectContent>
            {options.map((option) => (
              <SelectItem key={option.code} value={option.code} className="text-xs">
                {option.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Gated>
    </Panel>
  );
}
