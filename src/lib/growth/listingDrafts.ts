// Listing edits waiting to be applied, kept outside the Listing screen.
//
// The Growth window mounts a fresh screen for every section it moves to, so
// edits held in the Listing screen's own state were lost the moment the user
// looked at the Reviews. They live here instead, one list per app, and in the
// growth database too (`listing:drafts:<appId>`), so they also outlast closing
// the window and restarting the app until they are applied or discarded.
// "Remove this app's data" clears that row with the rest of the app's keys,
// and discardListingDrafts clears the copy in memory.
//
// The AI proofreading results ride along for the session only: they are
// worth keeping across a section change (each run is a call to the AI), but
// they describe the listing as it was when they were made.

import { useEffect, useSyncExternalStore } from 'react';
import { readMeta, writeMeta } from './db';
import type { ListingChange, ListingIssue, ListingSnapshot } from './types';

export const listingDraftsKey = (appId: string) => `listing:drafts:${appId}`;

export interface ListingDrafts {
  changes: ListingChange[];
  aiIssues: ListingIssue[];
}

const EMPTY: ListingDrafts = { changes: [], aiIssues: [] };
const drafts = new Map<string, ListingDrafts>();
const loaded = new Set<string>();
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getListingDrafts(appId: string): ListingDrafts {
  return drafts.get(appId) ?? EMPTY;
}

type Update<T> = T | ((current: T) => T);

export function setListingChanges(appId: string, update: Update<ListingChange[]>): void {
  const current = getListingDrafts(appId);
  const changes = typeof update === 'function' ? update(current.changes) : update;
  drafts.set(appId, { ...current, changes });
  // An edit made before the stored copy arrived is newer than that copy.
  loaded.add(appId);
  emit();
  void writeMeta(listingDraftsKey(appId), changes).catch((error) => console.error('Keeping the listing edits failed', error));
}

export function setListingAiIssues(appId: string, update: Update<ListingIssue[]>): void {
  const current = getListingDrafts(appId);
  const aiIssues = typeof update === 'function' ? update(current.aiIssues) : update;
  drafts.set(appId, { ...current, aiIssues });
  emit();
}

/** Forget an app's drafts in memory, after its stored data was removed. */
export function discardListingDrafts(appId: string): void {
  drafts.delete(appId);
  loaded.delete(appId);
  emit();
}

async function loadStored(appId: string): Promise<void> {
  if (loaded.has(appId)) return;
  loaded.add(appId);
  const stored = await readMeta<ListingChange[]>(listingDraftsKey(appId));
  if (!stored?.length || getListingDrafts(appId).changes.length > 0) return;
  drafts.set(appId, { ...getListingDrafts(appId), changes: stored });
  emit();
}

/** An app's drafts, re-rendering on every change, with the stored ones read in on first use. */
export function useListingDrafts(appId: string): ListingDrafts {
  const value = useSyncExternalStore(
    subscribe,
    () => getListingDrafts(appId),
    () => EMPTY
  );
  useEffect(() => {
    void loadStored(appId).catch((error) => console.error('Reading the kept listing edits failed', error));
  }, [appId]);
  return value;
}

/**
 * The drafts once some of them went through. The fields stay editable while
 * Apple answers, so a change only leaves the list when its text is still the
 * text that was sent: an edit made in the meantime is newer, and stays to be
 * applied next time. What Apple refused stays too.
 */
export function withoutApplied(current: ListingChange[], applied: ListingChange[]): ListingChange[] {
  const sent = new Map(applied.map((change) => [`${change.locale}:${change.field}`, change.after]));
  return current.filter((change) => sent.get(`${change.locale}:${change.field}`) !== change.after);
}

/**
 * Drafts set against the listing as it is now. The listing can change under a
 * kept draft (a sync, an edit on Apple's website, another version): each
 * change's "before" becomes the current text, one whose language is gone or
 * whose text the listing already has is dropped.
 */
export function rebaseChanges(changes: ListingChange[], listing: ListingSnapshot): ListingChange[] {
  const out: ListingChange[] = [];
  for (const change of changes) {
    const entry = listing.locales.find((locale) => locale.locale === change.locale);
    if (!entry) continue;
    const before = entry[change.field];
    if (before === change.after) continue;
    out.push(before === change.before ? change : { ...change, before });
  }
  return out;
}
