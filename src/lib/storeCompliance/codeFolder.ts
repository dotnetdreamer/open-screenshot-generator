// The folder of the user's app code that Ask AI in the Store compliance view
// lets Claude Code read, one per project. Only the folder's name and path are
// kept and sent: Claude Code opens the files it needs itself, with Read and
// Grep and no way to change a file, and Rust keeps secrets such as .env files
// and keys from it (abs_claude_prompt with folders, in claude_code.rs).
//
// The folder is picked in Rust's own dialog, which puts it on Rust's list of
// folders one-shot prompts may read, so a path the page makes up gets
// nowhere. Here it is kept per project in the view's own database. Taking it
// off takes it off Rust's list too, unless another project still uses it.
//
// macOS can keep Claude Code out of a folder (the user said no to the app for
// Documents, say) or stop to ask the user first. What it last said is kept
// per folder, so the screen can say so, even after a restart, and is looked
// at again after a pick, when the window comes back to the front and on
// Check again (abs_claude_folder_access). A prompt that reads the folder
// tells the same (folderBlockFromError).

import { useEffect, useSyncExternalStore } from 'react';
import { forgetPromptFolder, lookAtPromptFolder, pickPromptFolder, type PromptFolderPick } from '@/lib/ai/agentPrompt';
import { sanitizeFolder } from '@/lib/claudeCode/folders';
import { readMetaValue, readMetaValues, writeMetaValue } from './store';

export interface CodeFolder {
  name: string;
  path: string;
}

const KEY_PREFIX = 'code-folder:';

/** What macOS last said about Claude Code opening a folder: nothing while it lets it. */
export type FolderBlock = 'refused' | 'asking';

/**
 * How Rust's two answers about a folder start: FOLDER_REFUSED_START and
 * FOLDER_ASKING_START in claude_code.rs, whose test pins the same text.
 */
export const FOLDER_REFUSED_START = "macOS won't let Open Screenshot Generator open the folder ";
export const FOLDER_ASKING_START = 'macOS is asking if Open Screenshot Generator can open the folder ';

const BLOCK_PREFIX = 'code-access:';
const blocks = new Map<string, FolderBlock>();
/** Folders macOS was asked about in this session, so an older saved answer never overwrites a newer one. */
const noted = new Set<string>();
const looking = new Map<string, Promise<void>>();
/** Folders whose saved answer was looked at again in this session. */
const rechecked = new Set<string>();
let blocksRead: Promise<void> | null = null;

/** The folder of each project looked up so far. A project with no id ('') is kept in memory only. */
const known = new Map<string, CodeFolder | null>();
const loading = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();
let version = 0;

function projectKey(projectId: string | null): string {
  return projectId ?? '';
}

function announce(): void {
  version += 1;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function readBlocks(): Promise<void> {
  blocksRead ??= readMetaValues<unknown>(BLOCK_PREFIX)
    .then((rows) => {
      for (const row of rows) {
        const path = row.key.slice(BLOCK_PREFIX.length);
        if (!noted.has(path) && (row.value === 'refused' || row.value === 'asking')) blocks.set(path, row.value);
      }
    })
    .catch((error) => console.warn('What macOS said about the code folders could not be read', error))
    .then(announce);
  return blocksRead;
}

/** What macOS last said about Claude Code opening `path`, null while it lets it or before anyone looked. */
export function folderBlockOf(path: string): FolderBlock | null {
  return blocks.get(path) ?? null;
}

/** Whether macOS is being asked about `path` right now. */
export function lookingAt(path: string): boolean {
  return looking.has(path);
}

/** What a prompt that read the folder failed with, when it was macOS keeping Claude Code out or asking first. */
export function folderBlockFromError(message: string): FolderBlock | null {
  if (message.startsWith(FOLDER_REFUSED_START)) return 'refused';
  if (message.startsWith(FOLDER_ASKING_START)) return 'asking';
  return null;
}

/** Keep what macOS said about `path`, after a look or a prompt that read it. */
export async function noteFolderAccess(path: string, access: 'open' | FolderBlock): Promise<void> {
  noted.add(path);
  const before = blocks.get(path) ?? 'open';
  if (access === 'open') blocks.delete(path);
  else blocks.set(path, access);
  if (before === access) return;
  announce();
  await writeMetaValue(BLOCK_PREFIX + path, access === 'open' ? null : access).catch((error) =>
    console.warn('What macOS said about the code folder could not be saved', error)
  );
}

/** Ask what macOS says about `path` now. One look at a time per folder; a look that fails changes nothing. */
export function lookAtFolder(path: string): Promise<void> {
  const pending = looking.get(path);
  if (pending) return pending;
  const work = lookAtPromptFolder(path)
    .then((access) => noteFolderAccess(path, access))
    .catch((error) => console.warn('macOS could not be asked about the code folder', error))
    .finally(() => {
      looking.delete(path);
      announce();
    });
  looking.set(path, work);
  announce();
  return work;
}

/** Look again, once a session, at a folder macOS blocked before: the user may have allowed it since. */
export function recheckBlockedFolder(path: string): void {
  if (!blocks.has(path) || rechecked.has(path)) return;
  rechecked.add(path);
  void lookAtFolder(path);
}

function load(project: string): Promise<void> {
  const pending = loading.get(project);
  if (pending) return pending;
  const work = (project ? readMetaValue<unknown>(KEY_PREFIX + project) : Promise.resolve(null))
    .then((value) => {
      // A pick made while this read was on its way wins.
      if (!known.has(project)) known.set(project, sanitizeFolder(value));
    })
    .catch((error) => {
      console.warn('The code folder of this project could not be read', error);
      if (!known.has(project)) known.set(project, null);
    })
    .then(announce);
  loading.set(project, work);
  return work;
}

/** The project's folder, null when it has none, undefined while it is being looked up. */
export function codeFolderOf(projectId: string | null): CodeFolder | null | undefined {
  return known.get(projectKey(projectId));
}

export function useCodeFolder(projectId: string | null): CodeFolder | null | undefined {
  const project = projectKey(projectId);
  useEffect(() => {
    if (!known.has(project)) void load(project);
    void readBlocks();
  }, [project]);
  useSyncExternalStore(
    subscribe,
    () => version,
    () => 0
  );
  return known.get(project);
}

async function save(project: string, folder: CodeFolder | null): Promise<void> {
  const before = known.get(project) ?? null;
  known.set(project, folder);
  announce();
  // Not kept after a reload if this fails, which only means picking it again.
  if (project) await writeMetaValue(KEY_PREFIX + project, folder).catch((error) => console.warn('The code folder could not be saved', error));
  if (before && before.path !== folder?.path) await forgetIfUnused(before.path);
}

/** Take a path off Rust's list once no project uses it any more. */
async function forgetIfUnused(path: string): Promise<void> {
  const saved = await readMetaValues<unknown>(KEY_PREFIX).catch(() => []);
  const inUse = [...saved.map((row) => sanitizeFolder(row.value)), ...known.values()].some((folder) => folder?.path === path);
  if (!inUse) await forgetPromptFolder(path).catch((error) => console.warn('The folder could not be taken off the list', error));
}

/** Open the dialog and keep the folder picked for the project. Says why when Rust refuses the folder. */
export async function chooseCodeFolder(projectId: string | null): Promise<PromptFolderPick> {
  const project = projectKey(projectId);
  const result = await pickPromptFolder();
  if (result.kind === 'picked') {
    const folder = sanitizeFolder(result.folder);
    if (!folder) return { kind: 'refused', message: 'That folder could not be added' };
    await save(project, folder);
    // Right after the pick, while the user is there to answer macOS if it asks.
    void lookAtFolder(folder.path);
  }
  return result;
}

export async function removeCodeFolder(projectId: string | null): Promise<void> {
  await save(projectKey(projectId), null);
}

/** For the unit tests. */
export function resetCodeFolders(): void {
  known.clear();
  loading.clear();
  blocks.clear();
  noted.clear();
  looking.clear();
  rechecked.clear();
  blocksRead = null;
  announce();
}
