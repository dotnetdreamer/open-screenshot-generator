/**
 * The icon export onto a desktop's disk: a whole export into a folder the user
 * picks, or the icon straight into the app's own project, where Xcode and
 * Android look for it. Both write through Rust (src-tauri/src/icon_export.rs),
 * which checks every path; the fs plugin cannot make folders.
 *
 * Putting the icon in a project is two steps on purpose: the scan finds the
 * places first, the user says which to replace, and only then is anything
 * written. Where the files go is worked out here (projectWrites), purely, so
 * a test can read it.
 */

import { isTauri, pickExportDirectory, sanitizeFileName } from '@/lib/desktop';
import type { IconFile } from './exportIcons';
import { ANDROID_RES, IOS_SET, MAC_SET, type IconTarget } from './exportPlan';

/** What an icon set is for, from its Contents.json. */
export type IconSetPlatform = 'ios' | 'mac' | 'both' | 'watch' | 'tv' | 'mixed' | 'unknown';

export interface IconSetPlace {
  /** Inside the picked folder, with forward slashes. */
  path: string;
  platform: IconSetPlatform;
}

export interface AndroidResPlace {
  path: string;
  /** The `mipmap-anydpi*` folders already holding a launcher icon's XML. */
  anydpi: string[];
}

/** A folder the scan couldn't look in, and why. */
export interface NotLookedIn {
  path: string;
  reason: 'deep' | 'unreadable' | 'link';
}

export interface IconProjectScan {
  /** The folder the user picked. */
  root: string;
  iconSets: IconSetPlace[];
  androidRes: AndroidResPlace[];
  /** The scan stopped at its limit before it had looked everywhere. */
  truncated: boolean;
  /** Folders the scan couldn't look in, the first few by name. */
  notLookedIn?: NotLookedIn[];
  /** How many there were in all. */
  notLookedInCount?: number;
}

/** Whether the scan saw the whole folder. Only then can it say which place is the app's. */
export function scanIsComplete(scan: IconProjectScan): boolean {
  return !scan.truncated && (scan.notLookedInCount ?? scan.notLookedIn?.length ?? 0) === 0;
}

/** One place the icon can go. */
export type ProjectPick =
  | { kind: 'icon-set'; path: string; platform: IconSetPlatform }
  | { kind: 'android'; path: string; anydpi: string[] };

/** A place the scan found that this window doesn't make icons for, and why. */
export interface LeftAlonePlace {
  path: string;
  reason: string;
}

const MADE_HERE: readonly IconSetPlatform[] = ['ios', 'mac', 'both', 'unknown'];

/** Every place the icon can go, icon sets first. */
export function picksOf(scan: IconProjectScan): ProjectPick[] {
  return [
    ...scan.iconSets
      .filter((set) => MADE_HERE.includes(set.platform))
      .map((set) => ({ kind: 'icon-set' as const, path: set.path, platform: set.platform })),
    ...scan.androidRes.map((res) => ({ kind: 'android' as const, path: res.path, anydpi: Array.isArray(res.anydpi) ? res.anydpi : [] })),
  ];
}

/** The icon sets found that are for something else, shown so nothing is a surprise. */
export function leftAlone(scan: IconProjectScan): LeftAlonePlace[] {
  return scan.iconSets
    .filter((set) => !MADE_HERE.includes(set.platform))
    .map((set) => ({
      path: set.path,
      reason:
        set.platform === 'watch'
          ? "Apple Watch icon, won't be changed"
          : set.platform === 'tv'
            ? "Apple TV icon, won't be changed"
            : "Also has Apple Watch or Apple TV icons, won't be changed",
    }));
}

/** The iPhone and Mac icons a set may hold. A set this can't read could be anyone's, so it counts as both. */
function systemsOf(platform: IconSetPlatform): Array<'ios' | 'mac'> {
  switch (platform) {
    case 'ios':
      return ['ios'];
    case 'mac':
      return ['mac'];
    case 'watch':
    case 'tv':
      return [];
    default:
      return ['ios', 'mac'];
  }
}

/** The asset catalog a set is in: alternate icons sit beside the app's own, another app's are elsewhere. */
function catalogOf(path: string): string {
  const segments = path.split('/');
  const at = segments.findIndex((segment) => segment.toLowerCase().endsWith('.xcassets'));
  return (at >= 0 ? segments.slice(0, at + 1) : segments.slice(0, -1)).join('/');
}

/**
 * The places ticked the first time, only where there is no doubt which app
 * they belong to:
 * - an icon set named AppIcon, when no other set named AppIcon covers the
 *   same system anywhere in the folder, and no set in another asset catalog
 *   does either (an iPhone and Mac set counts for both, and so does one the
 *   scan couldn't read or an old one with Watch icons in it). Alternate
 *   icons, named otherwise, beside it in its own catalog don't count.
 * - the main Android res folder, when there is one.
 * Nothing is ticked unless the scan saw the whole folder: a folder it
 * couldn't look in, or a scan that stopped at its limit, may hold another app.
 */
export function defaultPicks(scan: IconProjectScan): ProjectPick[] {
  if (!scanIsComplete(scan)) return [];
  const places = picksOf(scan);
  const nameOf = (path: string) => (path.split('/').pop() ?? '').toLowerCase();
  const appIcon = (path: string) => nameOf(path) === 'appicon.appiconset';
  const sets = places.filter((place) => {
    if (place.kind !== 'icon-set' || place.platform === 'unknown' || !appIcon(place.path)) return false;
    const systems = systemsOf(place.platform);
    const rivals = scan.iconSets.filter(
      (other) => other.path !== place.path && (appIcon(other.path) || catalogOf(other.path) !== catalogOf(place.path))
    );
    return systems.length > 0 && rivals.every((other) => !systemsOf(other.platform).some((system) => systems.includes(system)));
  });
  const mainRes = places.filter((place) => place.kind === 'android' && /(^|\/)src\/main\/res$/.test(place.path));
  return [...sets, ...(mainRes.length === 1 ? mainRes : [])];
}

/**
 * The AppIcon sets left unticked because another set covers the same
 * devices, so the confirm list can say why. Empty after a scan that didn't
 * see everything, which says so itself.
 */
export function rivalAppIcons(scan: IconProjectScan): ProjectPick[] {
  if (!scanIsComplete(scan)) return [];
  const ticked = new Set(defaultPicks(scan).map((place) => place.path));
  return picksOf(scan).filter(
    (place) =>
      place.kind === 'icon-set' &&
      place.platform !== 'unknown' &&
      (place.path.split('/').pop() ?? '').toLowerCase() === 'appicon.appiconset' &&
      !ticked.has(place.path)
  );
}

/** The devices the unticked rival icons are for, as the confirm list names them. */
export function rivalDevices(rivals: readonly ProjectPick[]): string {
  const platforms = new Set(rivals.map((place) => (place.kind === 'icon-set' ? place.platform : 'android')));
  if (platforms.size === 1 && platforms.has('ios')) return 'iPhone and iPad';
  if (platforms.size === 1 && platforms.has('mac')) return 'Mac';
  return 'Apple devices';
}

/** How a place reads in the confirm list. */
export function pickLabel(pick: ProjectPick): string {
  if (pick.kind === 'android') return 'Android';
  switch (pick.platform) {
    case 'mac':
      return 'Mac';
    case 'both':
      return 'iPhone, iPad and Mac';
    case 'unknown':
      return 'Apple app icon';
    default:
      return 'iPhone and iPad';
  }
}

/** The export targets the ticked places need drawn. */
export function targetsForPicks(picks: readonly ProjectPick[]): IconTarget[] {
  const targets = new Set<IconTarget>();
  for (const pick of picks) {
    if (pick.kind === 'android') targets.add('android');
    else if (pick.platform === 'mac') targets.add('mac');
    else if (pick.platform === 'both') {
      targets.add('ios');
      targets.add('mac');
    } else targets.add('ios');
  }
  return (['ios', 'android', 'play', 'mac', 'layers'] as const).filter((target) => targets.has(target));
}

function under(files: readonly IconFile[], folder: string): IconFile[] {
  const prefix = `${folder}/`;
  return files.filter((file) => file.path.startsWith(prefix)).map((file) => ({ path: file.path.slice(prefix.length), bytes: file.bytes }));
}

/** One Contents.json for a set that is both an iOS and a Mac icon. */
function mergedContents(ios: IconFile | undefined, mac: IconFile | undefined): IconFile | null {
  if (!ios || !mac) return ios ?? mac ?? null;
  const decoder = new TextDecoder();
  const read = (file: IconFile) => JSON.parse(decoder.decode(file.bytes)) as { images: unknown[] };
  const merged = { images: [...read(ios).images, ...read(mac).images], info: { author: 'xcode', version: 1 } };
  return { path: 'Contents.json', bytes: new TextEncoder().encode(`${JSON.stringify(merged, null, 2)}\n`) };
}

const EXPORT_ANYDPI = 'mipmap-anydpi-v26';

/**
 * Where each drawn file goes in the project, for the places ticked; the icon
 * sets whose old pictures the new ones replace; and the res folders where a
 * new file replaces other files of its resource (an old ic_launcher.webp).
 * The layered icon's XML goes into every anydpi folder the project already
 * keeps one in, so no Android version is left on the old icon.
 */
export function projectWrites(
  picks: readonly ProjectPick[],
  files: readonly IconFile[]
): { writes: IconFile[]; clear: string[]; replaceResources: string[] } {
  const writes: IconFile[] = [];
  const clear: string[] = [];
  const replaceResources: string[] = [];
  const ios = under(files, IOS_SET);
  const mac = under(files, MAC_SET);
  for (const pick of picks) {
    if (pick.kind === 'android') {
      const anydpi = pick.anydpi.length > 0 ? pick.anydpi : [EXPORT_ANYDPI];
      for (const file of under(files, ANDROID_RES)) {
        const [folder, ...rest] = file.path.split('/');
        for (const into of folder === EXPORT_ANYDPI ? anydpi : [folder]) {
          writes.push({ path: [pick.path, into, ...rest].join('/'), bytes: file.bytes });
        }
      }
      replaceResources.push(pick.path);
      continue;
    }
    const pictures =
      pick.platform === 'mac'
        ? mac.filter((file) => file.path !== 'Contents.json')
        : pick.platform === 'both'
          ? [...ios, ...mac].filter((file) => file.path !== 'Contents.json')
          : ios.filter((file) => file.path !== 'Contents.json');
    const contents =
      pick.platform === 'mac'
        ? mac.find((file) => file.path === 'Contents.json')
        : pick.platform === 'both'
          ? mergedContents(ios.find((file) => file.path === 'Contents.json'), mac.find((file) => file.path === 'Contents.json')) ?? undefined
          : ios.find((file) => file.path === 'Contents.json');
    if (pictures.length === 0 || !contents) continue;
    clear.push(pick.path);
    for (const file of [...pictures, contents]) writes.push({ path: `${pick.path}/${file.path}`, bytes: file.bytes });
  }
  return { writes, clear, replaceResources };
}

/** What a write did: every file written, and old files that couldn't be removed. */
export interface IconWriteResult {
  written: string[];
  leftOver: string[];
}

function base64Of(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let at = 0; at < bytes.length; at += chunk) binary += String.fromCharCode(...bytes.subarray(at, at + chunk));
  return btoa(binary);
}

async function writeThroughRust(
  directory: string,
  files: readonly IconFile[],
  clearIconSets: readonly string[] = [],
  replaceResources: readonly string[] = []
): Promise<IconWriteResult> {
  const { invoke } = await import('@tauri-apps/api/core');
  const result = await invoke<{ written: string[]; leftOver: string[] }>('abs_write_export_files', {
    directory,
    files: files.map((file) => ({ path: file.path, dataBase64: base64Of(file.bytes) })),
    clearIconSets: clearIconSets.length > 0 ? [...clearIconSets] : null,
    replaceResources: replaceResources.length > 0 ? [...replaceResources] : null,
  });
  return { written: result?.written ?? [], leftOver: result?.leftOver ?? [] };
}

/** Where a desktop save went, and any old copy it couldn't remove there. */
export interface IconSaveResult {
  path: string;
  leftOver: string[];
}

/**
 * Desktop: the whole export in a new folder inside one the user picks. The
 * folder is picked first and the files made after, so a cancel wastes
 * nothing. Null when they cancel.
 */
export async function saveIconFolder(folder: string, makeFiles: () => Promise<readonly IconFile[]>): Promise<IconSaveResult | null> {
  if (!isTauri()) return null;
  const directory = await pickExportDirectory('Choose where to save the icons');
  if (!directory) return null;
  const files = await makeFiles();
  const result = await writeThroughRust(
    directory,
    files.map((file) => ({ path: `${folder}/${file.path}`, bytes: file.bytes }))
  );
  return { path: `${directory.replace(/[\\/]+$/, '')}/${folder}`, leftOver: result.leftOver };
}

/**
 * Desktop: the zip where the user says, written by Rust like every other
 * icon save: whole or not at all, and in turn with any other save into that
 * folder. The place is picked first and the zip made after. Null when they
 * cancel.
 */
export async function saveIconZip(fileName: string, makeZip: () => Promise<Blob>): Promise<IconSaveResult | null> {
  if (!isTauri()) return null;
  const name = sanitizeFileName(fileName);
  const { save } = await import('@tauri-apps/plugin-dialog');
  const path = await save({ defaultPath: name, filters: [{ name: 'ZIP file', extensions: ['zip'] }], title: `Save ${name.replace(/\.zip$/i, '')}` });
  if (!path) return null;
  const bytes = new Uint8Array(await (await makeZip()).arrayBuffer());
  const { invoke } = await import('@tauri-apps/api/core');
  const result = await invoke<{ written: string[]; leftOver: string[] }>('abs_write_export_zip', { path, dataBase64: base64Of(bytes) });
  return { path, leftOver: result?.leftOver ?? [] };
}

/** Desktop: the folder the user picks as their app's, and the icon places in it. Null when they cancel. */
export async function scanIconProject(onLooking?: () => void): Promise<IconProjectScan | null> {
  if (!isTauri()) return null;
  const directory = await pickExportDirectory("Choose your app's folder");
  if (!directory) return null;
  onLooking?.();
  const { invoke } = await import('@tauri-apps/api/core');
  const found = await invoke<{
    iconSets: IconSetPlace[];
    androidRes: AndroidResPlace[];
    truncated: boolean;
    notLookedIn?: NotLookedIn[];
    notLookedInCount?: number;
  }>('abs_scan_icon_targets', { directory });
  return {
    root: directory,
    iconSets: found.iconSets ?? [],
    androidRes: found.androidRes ?? [],
    truncated: !!found.truncated,
    notLookedIn: found.notLookedIn ?? [],
    notLookedInCount: found.notLookedInCount ?? found.notLookedIn?.length ?? 0,
  };
}

/** Desktop: the icon into the places ticked. Returns the paths written and any old file left behind. */
export async function writeIconProject(scan: IconProjectScan, picks: readonly ProjectPick[], files: readonly IconFile[]): Promise<IconWriteResult> {
  const { writes, clear, replaceResources } = projectWrites(picks, files);
  if (writes.length === 0) return { written: [], leftOver: [] };
  return writeThroughRust(scan.root, writes, clear, replaceResources);
}
