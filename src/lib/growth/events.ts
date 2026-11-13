// Timeline entries the editor writes itself, beside the releases that sync
// finds on its own.
//
// The one that matters most is the screenshot upload: the publish dialog calls
// recordScreenshotUpload after every successful run, with the version the
// screenshots went to on the App Store, and with whether Google Play sent them
// for review. That entry is what lets the overview say "your new screenshots
// lifted conversion by 14%" once they are live, a question no store dashboard
// can answer because none of them know when the design changed.

import { today } from './dates';
import { writeEvent } from './db';
import type { TimelineEvent, TimelineEventKind } from './types';

function newId(prefix: string): string {
  const random = Math.random().toString(36).slice(2, 8);
  return `${prefix}:${Date.now().toString(36)}${random}`;
}

export interface ScreenshotUploadRecord {
  appId: string;
  /** The version uploaded to. Its release is when the screenshots go live. */
  versionString?: string;
  /**
   * Google Play only. False when Play took the screenshots without sending
   * them for review: they wait for the user to send them from Play Console.
   */
  sentForReview?: boolean;
  /** Store locales the run covered. */
  locales: string[];
  screenshotCount: number;
  previewCount?: number;
  projectId?: string;
  projectName?: string;
}

export async function recordScreenshotUpload(record: ScreenshotUploadRecord): Promise<TimelineEvent> {
  const parts: string[] = [];
  if (record.screenshotCount > 0) parts.push(`${record.screenshotCount} screenshot${record.screenshotCount === 1 ? '' : 's'}`);
  if (record.previewCount) parts.push(`${record.previewCount} App Preview${record.previewCount === 1 ? '' : 's'}`);
  const languages = record.locales.length;
  const detail = [
    parts.join(' and '),
    languages > 0 ? `in ${languages} language${languages === 1 ? '' : 's'}` : '',
    record.projectName ? `from "${record.projectName}"` : '',
  ]
    .filter(Boolean)
    .join(' ');
  const event: TimelineEvent = {
    id: newId('shots'),
    appId: record.appId,
    date: today(),
    kind: 'screenshots',
    title: record.previewCount && !record.screenshotCount ? 'New App Previews uploaded' : 'New screenshots uploaded',
    detail: detail || undefined,
    version: record.versionString || undefined,
    origin: 'publish',
    projectId: record.projectId,
    projectName: record.projectName,
    locales: record.locales,
    screenshotCount: record.screenshotCount,
    waitsForReview: record.sentForReview === false ? true : undefined,
    createdAt: Date.now(),
  };
  await writeEvent(event);
  return event;
}

/** The user says a change Google Play held for review went live on `date`. */
export async function markEventLive(event: TimelineEvent, date: string = today()): Promise<TimelineEvent> {
  const live: TimelineEvent = { ...event, liveDate: date };
  await writeEvent(live);
  return live;
}

export async function recordListingChange(input: {
  appId: string;
  fields: string[];
  locales: string[];
  /** Absent when only promotional text changed, which is live at once. */
  versionString?: string;
  /** Google Play only: false when Play held the change for the user to send for review. */
  sentForReview?: boolean;
}): Promise<TimelineEvent> {
  const event: TimelineEvent = {
    id: newId('listing'),
    appId: input.appId,
    date: today(),
    kind: 'listing',
    title: 'Store page updated',
    detail: `${input.fields.join(', ')} in ${input.locales.length} language${input.locales.length === 1 ? '' : 's'}`,
    version: input.versionString,
    origin: 'listing',
    locales: input.locales,
    waitsForReview: input.sentForReview === false ? true : undefined,
    createdAt: Date.now(),
  };
  await writeEvent(event);
  return event;
}

export async function addManualEvent(input: {
  appId: string;
  date: string;
  kind: TimelineEventKind;
  title: string;
  detail?: string;
  version?: string;
}): Promise<TimelineEvent> {
  const event: TimelineEvent = {
    id: newId('manual'),
    appId: input.appId,
    date: input.date,
    kind: input.kind,
    title: input.title.trim(),
    detail: input.detail?.trim() || undefined,
    version: input.version?.trim() || undefined,
    origin: 'manual',
    createdAt: Date.now(),
  };
  await writeEvent(event);
  return event;
}
