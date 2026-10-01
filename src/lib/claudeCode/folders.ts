// Code folders on a Claude Code chat: the rules the store follows, kept apart
// from it so node can test them.
//
// A chat holds up to three folders the user picked in Rust's own dialog. The
// process is started with them (claude_code.rs grants reads there and nowhere
// else), so the folder set is fixed per process, like the model: a change
// restarts the process on the next message, resuming the conversation.

import { clipText } from '@/lib/clipText';
import type { AgentFolder } from './types';

/** Folders one chat can hold. */
export const MAX_FOLDERS = 3;

export const FOLDER_CAP_NOTICE = 'You can add up to 3 folders. Remove one to add another';

/** What Rust says while its dialog is up, and what the store says without asking it. */
export const FOLDER_PICKER_OPEN = 'A folder picker is already open';

/** The first line of a turn whose process can read other folders than on the turn before. */
export const FOLDERS_CHANGED_NOTE =
  "The user's app folders changed. Your instructions list the folders you can read now.";
export const FOLDERS_REMOVED_NOTE = 'The user removed their app folders, so you can no longer read them.';

/** Rust caps a path at this many characters, so the page never cuts one shorter. */
export const MAX_FOLDER_PATH = 1024;
const MAX_FOLDER_NAME = 255;

/** One folder from storage or from another window, or null when it is not one. */
export function sanitizeFolder(value: unknown): AgentFolder | null {
  if (typeof value !== 'object' || value === null) return null;
  const { name, path } = value as { name?: unknown; path?: unknown };
  if (typeof path !== 'string' || !path.trim() || path.length > MAX_FOLDER_PATH) return null;
  const fallback = folderNameOf(path);
  const shown = typeof name === 'string' && name.trim() ? name.trim() : fallback;
  return { name: clipText(shown, MAX_FOLDER_NAME), path };
}

/** A chat's folders as stored: well formed, one per path, at most MAX_FOLDERS. */
export function sanitizeFolders(value: unknown): AgentFolder[] {
  if (!Array.isArray(value)) return [];
  const folders: AgentFolder[] = [];
  for (const entry of value) {
    const folder = sanitizeFolder(entry);
    if (!folder || folders.some((kept) => kept.path === folder.path)) continue;
    folders.push(folder);
    if (folders.length === MAX_FOLDERS) break;
  }
  return folders;
}

/** Paths from Rust (list(), missingFolders), or null when the field is not there. */
export function sanitizePaths(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return [...new Set(value.filter((path): path is string => typeof path === 'string' && !!path))].sort();
}

/**
 * The paths a process is started with: sorted, so the same set always gives
 * the same arguments (and Rust the same system prompt, which keeps Claude's
 * prompt cache warm across a restart).
 */
export function folderPaths(folders: readonly AgentFolder[]): string[] {
  return [...new Set(folders.map((folder) => folder.path))].sort();
}

/** Two folder sets are the same set. A null one (not known) never is. */
export function sameFolderSet(a: readonly string[] | null, b: readonly string[]): boolean {
  if (a === null || a.length !== b.length) return false;
  const wanted = new Set(b);
  return a.every((path) => wanted.has(path));
}

/**
 * The line a turn opens with when its process can read other folders than the
 * conversation's last turn could: the process was just restarted for a folder
 * change, or Rust started it without a folder that has gone.
 *
 * `before` is what the conversation's last turn ran with, null when that is
 * not known; then any folder at all is worth the line. A conversation's first
 * turn has nothing to compare with and gets none, since the instructions
 * already list the folders.
 */
export function folderChangeNote(
  before: readonly string[] | null,
  now: readonly string[],
  continuing: boolean
): string | null {
  if (!continuing) return null;
  if (before === null) return now.length ? FOLDERS_CHANGED_NOTE : null;
  if (sameFolderSet(before, now)) return null;
  return now.length ? FOLDERS_CHANGED_NOTE : FOLDERS_REMOVED_NOTE;
}

/**
 * The chat has a folder the agent was not started with, so a message with no
 * words of its own still has something to say ("Use the folder I added").
 * `ran` is what the conversation's last turn ran with, null for a chat that
 * has not run one.
 */
export function hasUnreadFolder(folders: readonly AgentFolder[], ran: readonly string[] | null): boolean {
  if (!folders.length) return false;
  if (ran === null) return true;
  return folders.some((folder) => !ran.includes(folder.path));
}

/**
 * A saved chat's folder set from its last turn, for a chat put back on screen.
 * Null for a chat that has not run a turn (no conversation id yet). A chat
 * saved before the set was kept is taken to have run with its folders.
 */
export function savedRanFolders(
  sessionId: string | null | undefined,
  saved: unknown,
  folders: readonly AgentFolder[]
): string[] | null {
  if (!sessionId) return null;
  return sanitizePaths(saved) ?? folderPaths(folders);
}

/**
 * Whether a saved chat's agent ever had a code folder to read. A chat saved
 * before the flag was kept counts as having read the folders it holds.
 */
export function savedReadFolders(saved: unknown, folders: readonly AgentFolder[]): boolean {
  return typeof saved === 'boolean' ? saved : folders.length > 0;
}

/** The transcript's word on a folder Rust would not start the process with. */
export function missingFolderNotice(folder: AgentFolder): string {
  return `The agent can no longer read the ${clipText(folder.name, 80)} folder. Add it again if you still want it used`;
}

/** What a pick of a folder that is already on the list says, by the label its chip shows. */
export function alreadyAddedNotice(label: string): string {
  return `${clipText(label, 80)} is already added`;
}

/** Of `paths`, the ones no folder list in `inUse` holds. Those come off Rust's list. */
export function unreferencedPaths(
  paths: readonly string[],
  inUse: Iterable<readonly AgentFolder[] | undefined>
): string[] {
  const used = new Set<string>();
  for (const folders of inUse) for (const folder of folders ?? []) used.add(folder.path);
  return [...new Set(paths)].filter((path) => !used.has(path));
}

/** Forward slashes and no trailing one, so either separator compares. */
function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '');
}

/** The last part of a path, either separator. */
export function folderNameOf(path: string): string {
  const parts = normalizePath(path).split('/').filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

/**
 * A path inside one of the folders, from that folder on ("ios/App/Info.plist"),
 * or null when it is in none of them. Letter case is ignored, as Windows and
 * macOS ignore it; on Linux a false match only changes what a row shows.
 */
export function folderRelativePath(path: string, folders: readonly AgentFolder[]): string | null {
  const target = normalizePath(path);
  for (const folder of folders) {
    const root = normalizePath(folder.path);
    if (!root || target.length <= root.length + 1 || target.charAt(root.length) !== '/') continue;
    if (target.slice(0, root.length).toLowerCase() === root.toLowerCase()) return target.slice(root.length + 1);
  }
  return null;
}

/**
 * What each folder is called on screen and in the brief: its name, or
 * "parent/name" when two of them share a name (ios/app and android/app).
 */
export function folderLabels(folders: readonly AgentFolder[]): string[] {
  return folders.map((folder) => {
    const clash = folders.some((other) => other !== folder && other.name.toLowerCase() === folder.name.toLowerCase());
    if (!clash) return folder.name;
    const parts = normalizePath(folder.path).split('/').filter(Boolean);
    const parent = parts.length > 1 ? parts[parts.length - 2] : '';
    return parent ? `${parent}/${folder.name}` : folder.name;
  });
}
