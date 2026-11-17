// Fetching app health for one app and keeping it (health.ts says what the
// numbers are). Each store's sync runs it as its own feed, `health`, after
// the others, and it fails on its own like them.
//
// App Store: the App Crashes and App Sessions Standard reports of the App
// Analytics requests the analytics feed keeps (sync.ts makes the ongoing one;
// this feed never makes a request), file by file like the analytics import:
// each file is read once (health:done:<appId>), oldest first so a later
// correction lands last, and answers for its days by instanceDays. Then
// Xcode's hang rate for the newest versions.
//
// Google Play: Android vitals for the days Google has, from a week before the
// newest day kept (Google fills recent days in late) or HEALTH_DAYS back on
// the first read, each measure twice: for every build together, and per
// build. Then the release names from Play Console's tracks.

import type { PlayCredentials } from '@/lib/publish/types';
import { AscForbiddenError, downloadSegment, fetchPerfMetrics, listInstances, listReportRequests, listReports, listSegments } from './asc';
import { addDays, dayRange, formatDay } from './dates';
import { readMeta, writeMeta } from './db';
import { reportText } from './delimited';
import { plural } from './format';
import {
  addHealthRows,
  emptyHealth,
  healthKey,
  healthReportKind,
  mergeHealth,
  parseCrashesReport,
  parseSessionsReport,
  readHangMetrics,
  readVitalsRows,
  releaseNamesOf,
  type AppHealth,
  type HealthReportKind,
  type HealthRows,
} from './health';
import { PlayApiDisabledError, PlayForbiddenError, fetchPlayTracks, queryVitals, vitalsLastDay, type VitalsSet } from './play';
import { instanceDays } from './reportDays';
import type { AppStoreCredentials } from '@/lib/publish/types';
import type { DayString, FeedStatus, SyncProgress } from './types';

/** Files read in one refresh at most; the rest wait for the next one. */
const MAX_HEALTH_FILES = 120;
/** Google Play days read the first time. */
const HEALTH_DAYS = 180;
/** Google fills in recent days late, so every read starts this far before the newest day kept. */
const VITALS_OVERLAP_DAYS = 7;

const doneKey = (appId: string) => `health:done:${appId}`;
const reportsKey = (requestId: string) => `health:reports:${requestId}`;

const NO_CRASH_FILES =
  "Apple has sent no crash numbers yet. Apple counts crashes only from people who share analytics with developers, and only once at least five of them have one";

interface AppleHealthOptions {
  credentials: AppStoreCredentials;
  app: { id: string };
  signal?: AbortSignal;
}

export async function syncAppleHealth(options: AppleHealthOptions, setProgress: (value: SyncProgress | null) => void): Promise<FeedStatus> {
  const appId = options.app.id;
  let requests;
  try {
    requests = (await listReportRequests(options.credentials, appId, options.signal)).filter((request) => !request.stoppedDueToInactivity);
  } catch (error) {
    if (error instanceof AscForbiddenError) {
      return { state: 'forbidden', message: 'Apple keeps crash numbers in App Analytics, which your key cannot load. Use a key with the Admin, Sales or Finance role' };
    }
    throw error;
  }
  if (requests.length === 0) {
    return { state: 'pending', message: 'Crash numbers come with App Analytics, which Growth has asked Apple to turn on. The first ones usually come within two days' };
  }

  // Which reports to read, from each request. Their ids never change, so they are kept.
  const targets: Array<{ reportId: string; kind: HealthReportKind; snapshot: boolean }> = [];
  for (const request of requests) {
    let refs = await readMeta<Partial<Record<HealthReportKind, string>>>(reportsKey(request.id));
    if (!refs || !refs.crashes || !refs.sessions) {
      refs = {};
      for (const report of await listReports(options.credentials, request.id, options.signal)) {
        const kind = healthReportKind(report.name);
        if (kind && !refs[kind]) refs[kind] = report.id;
      }
      await writeMeta(reportsKey(request.id), refs);
    }
    for (const kind of ['sessions', 'crashes'] as HealthReportKind[]) {
      const reportId = refs[kind];
      if (reportId) targets.push({ reportId, kind, snapshot: request.accessType === 'ONE_TIME_SNAPSHOT' });
    }
  }

  const done: Record<string, string> = { ...((await readMeta<Record<string, string>>(doneKey(appId))) ?? {}) };
  const queue: Array<{ instanceId: string; processingDate: string; kind: HealthReportKind; snapshot: boolean }> = [];
  for (const target of targets) {
    for (const instance of await listInstances(options.credentials, target.reportId, options.signal)) {
      if (!done[instance.id]) queue.push({ instanceId: instance.id, processingDate: instance.processingDate, kind: target.kind, snapshot: target.snapshot });
    }
  }
  // Oldest first, so a later file's corrections land last; on one processing date the snapshot goes first.
  queue.sort((a, b) => a.processingDate.localeCompare(b.processingDate) || Number(b.snapshot) - Number(a.snapshot));
  const batch = queue.slice(0, MAX_HEALTH_FILES);

  let health: AppHealth = (await readMeta<AppHealth>(healthKey(appId))) ?? emptyHealth(appId, 'appstore');
  const save = async () => {
    await writeMeta(healthKey(appId), { ...health, readAt: Date.now() });
    await writeMeta(doneKey(appId), done);
  };
  setProgress({ label: 'App health', done: 0, total: batch.length });
  for (const [index, item] of batch.entries()) {
    const rows: HealthRows = new Map();
    for (const segment of await listSegments(options.credentials, item.instanceId, options.signal)) {
      const text = await reportText(await downloadSegment(segment.url, options.signal));
      addHealthRows(rows, item.kind === 'crashes' ? parseCrashesReport(text, { appId }) : parseSessionsReport(text, { appId }));
    }
    health = mergeHealth(health, item.kind, rows, instanceDays(item.processingDate, item.snapshot, rows.keys()));
    done[item.instanceId] = item.processingDate;
    setProgress({ label: 'App health', done: index + 1, total: batch.length });
    if ((index + 1) % 10 === 0) await save();
  }

  // Xcode's hang rate, for the newest versions. A key that may not read it costs the hangs only.
  let hangsRefused = false;
  try {
    const hangs = readHangMetrics(await fetchPerfMetrics(options.credentials, appId, 'HANG', options.signal));
    health = { ...health, hangs: hangs ?? undefined };
  } catch (error) {
    if (error instanceof AscForbiddenError) hangsRefused = true;
    else if (!(error instanceof Error && error.name === 'AbortError')) console.error('Reading the hang rate failed', error);
    if (options.signal?.aborted) throw error;
  }
  await save();

  const remaining = queue.length - batch.length;
  if (remaining > 0) return { state: 'ok', message: `Loaded ${plural(batch.length, 'file')} from Apple. Files left for the next refresh: ${remaining}` };
  const crashDays = health.crashDays ?? [];
  const hangNote = hangsRefused ? ". Your key cannot read the hang rate: use one with the Admin, App Manager or Developer role" : '';
  if (crashDays.length === 0) return { state: 'empty', message: `${NO_CRASH_FILES}${hangNote}` };
  return { state: 'ok', message: `Crash numbers up to ${formatDay(crashDays[crashDays.length - 1], { withYear: true })}${hangNote}` };
}

interface PlayHealthOptions {
  credentials: PlayCredentials;
  app: { id: string };
  historyDays: number;
  signal?: AbortSignal;
}

/** A vitals timeline day: Google's daily numbers are only in America/Los_Angeles days. */
function vitalsDate(day: DayString) {
  return { year: Number(day.slice(0, 4)), month: Number(day.slice(5, 7)), day: Number(day.slice(8, 10)), timeZone: { id: 'America/Los_Angeles' } };
}

const VITALS: Array<{ set: VitalsSet; kind: 'crash' | 'anr'; metrics: string[] }> = [
  { set: 'crashRateMetricSet', kind: 'crash', metrics: ['userPerceivedCrashRate', 'distinctUsers'] },
  { set: 'anrRateMetricSet', kind: 'anr', metrics: ['userPerceivedAnrRate', 'distinctUsers'] },
];

export async function syncPlayHealth(options: PlayHealthOptions, setProgress: (value: SyncProgress | null) => void): Promise<FeedStatus> {
  const appId = options.app.id;
  let health: AppHealth = (await readMeta<AppHealth>(healthKey(appId))) ?? emptyHealth(appId, 'playstore');
  try {
    const last = await vitalsLastDay(options.credentials, 'crashRateMetricSet', options.signal);
    if (!last) return { state: 'empty', message: 'Google Play has no crash numbers for this app yet. Google needs enough people using it each day' };
    const first = addDays(last, -(Math.min(options.historyDays, HEALTH_DAYS) - 1));
    const kept = health.through ? addDays(health.through, -VITALS_OVERLAP_DAYS) : first;
    const from = kept > first ? kept : first;
    const days = dayRange(from, last);
    const timelineSpec = { aggregationPeriod: 'DAILY', startTime: vitalsDate(from), endTime: vitalsDate(addDays(last, 1)) };
    setProgress({ label: 'App health', done: 0, total: VITALS.length * 2 });
    let asked = 0;
    for (const { set, kind, metrics } of VITALS) {
      const rows: HealthRows = new Map();
      for (const dimensions of [[], ['versionCode']]) {
        const body = await queryVitals(options.credentials, set, { timelineSpec, dimensions, metrics }, options.signal);
        addHealthRows(rows, readVitalsRows(body, kind));
        asked += 1;
        setProgress({ label: 'App health', done: asked, total: VITALS.length * 2 });
      }
      health = mergeHealth(health, kind, rows, days);
    }
    try {
      health = { ...health, releaseNames: { ...health.releaseNames, ...releaseNamesOf(await fetchPlayTracks(options.credentials, options.signal)) } };
    } catch (error) {
      // Without them a build shows by its version from the reviews, or its number.
      if (options.signal?.aborted) throw error;
      console.error('Reading the Google Play releases failed', error);
    }
    health = { ...health, through: last };
    await writeMeta(healthKey(appId), { ...health, readAt: Date.now() });
    const any = Object.values(health.days).some((versions) => Object.values(versions).some((point) => point.users || point.anrUsers));
    if (!any) return { state: 'empty', message: 'Google Play has no crash numbers for this app yet. Google needs enough people using it each day' };
    return { state: 'ok', message: `Crash numbers up to ${formatDay(last, { withYear: true })}` };
  } catch (error) {
    if (error instanceof PlayApiDisabledError) {
      return { state: 'needs-setup', message: error.message, ...(error.url ? { link: { label: 'Turn on the API', url: error.url } } : {}) };
    }
    if (error instanceof PlayForbiddenError) {
      return {
        state: 'forbidden',
        message: 'Your service account cannot read crash numbers. In Play Console, under Users and permissions, give it the View app information permission',
      };
    }
    throw error;
  }
}
