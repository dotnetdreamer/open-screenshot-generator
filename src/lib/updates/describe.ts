// Pure helpers for the update UI: when to check, and what to say.
//
// No React and no Tauri here, so tests/unit/appUpdates.test.ts can run all of
// it in node. The strings are user-facing copy and follow the ui-text skill.

import type { UpdateInfo, UpdateSnapshot } from './types';

/** How often the app asks the update server on its own. */
export const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
/** A check that could not reach the server is tried again after this long. */
export const RETRY_INTERVAL_MS = 60 * 60 * 1000;
/** The first automatic check waits this long after the editor opens, so startup stays quick. */
export const FIRST_CHECK_DELAY_MS = 20 * 1000;

/** Whether an automatic check is due: the server never answered, or its last answer is too old. */
export function isCheckDue(checkedAt: number | null, now: number, interval = CHECK_INTERVAL_MS): boolean {
  return checkedAt === null || now - checkedAt >= interval;
}

/** How long until the next automatic check, given the state now. */
export function nextCheckDelay(snapshot: UpdateSnapshot | null, now: number): number {
  if (!snapshot) return CHECK_INTERVAL_MS;
  const { phase, checkedAt } = snapshot;
  if (phase.phase === 'failed' && phase.step === 'check') return RETRY_INTERVAL_MS;
  if (checkedAt === null) return CHECK_INTERVAL_MS;
  // Never sooner than a minute, so a clock that jumps back cannot spin it.
  return Math.max(checkedAt + CHECK_INTERVAL_MS - now, 60 * 1000);
}

/** Download progress from 0 to 100, or null when the size is unknown. */
export function downloadPercent(received: number, total: number | null): number | null {
  if (!total || total <= 0) return null;
  return Math.min(100, Math.max(0, Math.floor((received / total) * 100)));
}

/** What the sidebar offers: an update to restart into, one to download by hand, or one going in now. */
export type UpdatePrompt =
  | { kind: 'ready'; update: UpdateInfo }
  | { kind: 'available'; update: UpdateInfo }
  | { kind: 'installing'; update: UpdateInfo };

export function promptFor(snapshot: UpdateSnapshot | null): UpdatePrompt | null {
  if (!snapshot || snapshot.mode === 'off') return null;
  const { phase } = snapshot;
  switch (phase.phase) {
    case 'ready':
      return { kind: 'ready', update: phase.update };
    case 'available':
      return { kind: 'available', update: phase.update };
    case 'installing':
      return { kind: 'installing', update: phase.update };
    default:
      return null;
  }
}

/** The Settings section shows for a build that updates itself, and for a store build to say who does. */
export function showsUpdateSettings(snapshot: UpdateSnapshot | null): boolean {
  if (!snapshot) return false;
  if (snapshot.mode !== 'off') return true;
  return snapshot.reason === 'appStore' || snapshot.reason === 'microsoftStore';
}

/** One line under the version in Settings: where updates stand. */
export function statusLine(snapshot: UpdateSnapshot): string {
  if (snapshot.mode === 'off') {
    if (snapshot.reason === 'appStore') return 'The Mac App Store keeps the app up to date';
    if (snapshot.reason === 'microsoftStore') return 'The Microsoft Store keeps the app up to date';
    return 'This copy of the app does not check for updates';
  }
  const { phase } = snapshot;
  switch (phase.phase) {
    case 'idle':
      return 'Not checked yet';
    case 'checking':
      return 'Checking for updates';
    case 'upToDate':
      return 'You have the latest version';
    case 'available':
      return `Version ${phase.update.version} is out. Download it to replace this copy`;
    case 'downloading': {
      const percent = downloadPercent(phase.received, phase.total);
      return percent === null
        ? `Downloading version ${phase.update.version}`
        : `Downloading version ${phase.update.version}, ${percent}%`;
    }
    case 'ready':
      return `Version ${phase.update.version} is ready. Restart to update`;
    case 'installing':
      return `Installing version ${phase.update.version}`;
    case 'failed':
      return phase.step === 'check'
        ? 'Could not reach the update server. Try again later'
        : 'The update did not finish downloading. It starts again at the next check';
  }
}

/** The hint under the automatic check switch, which depends on what this copy can do. */
export function autoCheckHint(snapshot: UpdateSnapshot): string {
  return snapshot.mode === 'install'
    ? 'Downloads new versions in the background. You choose when to restart'
    : 'Tells you when a new version is out. This copy cannot install it by itself';
}

export interface UpdateToast {
  title: string;
  description?: string;
}

/**
 * What a check the user asked for found, as a toast. Null when the update
 * prompt opens instead, which says it better.
 */
export function manualCheckToast(snapshot: UpdateSnapshot | null): UpdateToast | null {
  if (!snapshot || (snapshot.phase.phase === 'failed' && snapshot.phase.step === 'check')) {
    return { title: 'Could not check for updates', description: 'Check your internet connection and try again.' };
  }
  const { phase } = snapshot;
  switch (phase.phase) {
    case 'upToDate':
      return { title: 'You have the latest version', description: `Version ${snapshot.currentVersion}` };
    case 'downloading':
      return {
        title: `Downloading version ${phase.update.version}`,
        description: 'A restart button appears in the sidebar when it is ready.',
      };
    case 'failed':
      return {
        title: 'The update did not download',
        description: 'Check your internet connection and try again.',
      };
    default:
      return null;
  }
}

/** Where every release can be downloaded by hand, when the server named no page. */
export const RELEASES_PAGE = 'https://github.com/dotnetdreamer/open-screenshot-generator/releases/latest';

export function downloadPageFor(update: UpdateInfo): string {
  return update.downloadPage?.startsWith('https://') ? update.downloadPage : RELEASES_PAGE;
}

/** The release date as the reader's calendar shows it, or null. */
export function releaseDate(update: UpdateInfo, locale?: string): string | null {
  if (!update.date) return null;
  const date = new Date(update.date);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(locale, { year: 'numeric', month: 'long', day: 'numeric' });
}
