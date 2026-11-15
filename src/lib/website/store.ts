// Where each project's site is kept: a Dexie database of its own, beside the
// project database rather than inside it, the way Growth keeps its numbers.
// A project export, a cloud save or a version snapshot never carries a site,
// and a change to this schema never puts a migration in front of somebody's
// designs. The rule for project fields (AGENTS.md rule 1) would drop a site
// stored on the project at the next keystroke anyway.
//
// The conversation with the AI is kept with the site, so leaving the view, or
// the app, and coming back finds it where it was.
//
// Work that ends after it started (an AI answer, a translation, a publish)
// changes its project's site through `changeSite`, which is one change made
// in one place. While the Website view holds that project's site (on screen,
// or still being read), the change goes into the view's copy, which saves it
// with everything else. Otherwise it is read and written back inside one
// transaction, so two results landing at once never overwrite each other.

import Dexie, { type Table } from 'dexie';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { SiteChatTurn } from './ai';
import type { SiteDraft } from './types';

export interface SiteChatItem extends SiteChatTurn {
  id: string;
  at: number;
  /** The fields the AI changed, in plain words. */
  changed?: string[];
  /** Fields it sent that the site turned down. */
  refused?: string[];
  /** The draft before this answer changed it, for Undo. Only the newest answer keeps one. */
  before?: SiteDraft;
  /**
   * siteFingerprint of the site right after this answer. Undo is offered only
   * while the site still has it, so an undo never throws away an edit made
   * by hand after the answer.
   */
  after?: string;
  /** The answer could not be had: what went wrong. */
  failed?: boolean;
  /**
   * A paragraph the AI suggested for the privacy policy. It goes in only when
   * the developer presses the button under it, so no sentence of the policy
   * is the AI's without the developer choosing it.
   */
  suggestion?: { privacyExtra: string; used?: boolean };
}

/** A project's site and its conversation, as a change sees them. */
export interface SiteRowData {
  draft: SiteDraft;
  chat: SiteChatItem[];
}

export type SiteChange = (row: SiteRowData) => SiteRowData;

export interface StoredSite extends SiteRowData {
  projectId: string;
  updatedAt: number;
}

/** What the store needs from the database: reads and writes inside one transaction. The unit tests pass one of their own. */
export interface SiteStorage {
  transaction<T>(work: (tx: { get(projectId: string): Promise<StoredSite | undefined>; put(row: StoredSite): Promise<unknown> }) => Promise<T>): Promise<T>;
}

class WebsiteDatabase extends Dexie {
  sites!: Table<StoredSite, string>;

  constructor() {
    super('OpenScreenshotGeneratorWebsite');
    this.version(1).stores({ sites: 'projectId, updatedAt' });
  }
}

let instance: WebsiteDatabase | null = null;

function indexedDbSiteStorage(): SiteStorage {
  return {
    transaction(work) {
      instance ??= new WebsiteDatabase();
      const database = instance;
      return database.transaction('rw', database.sites, () =>
        work({
          get: (projectId) => database.sites.get(projectId),
          put: (row) => database.sites.put(row),
        })
      );
    },
  };
}

let storage: SiteStorage | null = null;

function sites(): SiteStorage {
  storage ??= indexedDbSiteStorage();
  return storage;
}

/** Keep sites somewhere else, for the unit tests; null goes back to IndexedDB. */
export function setSiteStorage(next: SiteStorage | null): void {
  storage = next;
}

/** Messages kept with a site. */
const CHAT_LIMIT = 40;

function storedSite(draft: SiteDraft, chat: SiteChatItem[]): StoredSite {
  // Only the newest answer can be undone, so only it keeps the draft before it.
  const kept = chat.slice(-CHAT_LIMIT).map((item, index, all) => (index === all.length - 1 || !item.before ? item : { ...item, before: undefined }));
  return { projectId: draft.projectId, draft, chat: kept, updatedAt: Date.now() };
}

export async function readSiteRow(projectId: string): Promise<SiteRowData | null> {
  const row = await sites().transaction((tx) => tx.get(projectId));
  return row ? { draft: row.draft, chat: row.chat ?? [] } : null;
}

export async function writeSiteRow(draft: SiteDraft, chat: SiteChatItem[]): Promise<void> {
  await sites().transaction((tx) => tx.put(storedSite(draft, chat)));
}

/** The Website view's hold on a project's site, while it has one: a change goes into its copy. */
const holders = new Map<string, (change: SiteChange) => void>();

/**
 * Change a project's site and conversation, wherever the site is: in the
 * Website view when it holds that project, or else in the database, read and
 * written in one transaction. For work that started earlier, so its result
 * lands in the site it was for, whichever project is open by then. Nothing
 * happens for a project without a site.
 */
export async function changeSite(projectId: string, change: SiteChange): Promise<void> {
  const holder = holders.get(projectId);
  if (holder) {
    holder(change);
    return;
  }
  await sites().transaction(async (tx) => {
    const row = await tx.get(projectId);
    if (!row) return;
    const next = change({ draft: row.draft, chat: row.chat ?? [] });
    await tx.put(storedSite({ ...next.draft, updatedAt: Date.now() }, next.chat));
  });
}

/** The saves waiting in each mounted Website view, for the window's close hook. */
const waiting = new Set<() => Promise<void>>();

/**
 * Write every site change still waiting to be saved. The editor's close hook
 * and the update handshake call it (beforeWindowCloseRef in the layout): a
 * window that closes, or an update that ends the app, skips pagehide.
 */
export async function flushWebsiteSaves(): Promise<void> {
  await Promise.all([...waiting].map((flush) => flush()));
}

export interface SiteState {
  /** False until the stored site of this project has been read. */
  loaded: boolean;
  draft: SiteDraft | null;
  chat: SiteChatItem[];
  /** Change the site. Saved a moment later, and at once when the view goes. */
  update: (change: (draft: SiteDraft) => SiteDraft) => void;
  /** Start a site for the project, saved at once. */
  create: (draft: SiteDraft) => void;
  setChat: (change: (chat: SiteChatItem[]) => SiteChatItem[]) => void;
}

/** The site of one project, read from the database and written back as it changes. */
export function useSiteDraft(projectId: string | null): SiteState {
  const [state, setState] = useState<{ projectId: string | null; loaded: boolean; draft: SiteDraft | null; chat: SiteChatItem[] }>({
    projectId,
    loaded: false,
    draft: null,
    chat: [],
  });
  const latest = useRef(state);
  latest.current = state;
  const timer = useRef<number | null>(null);

  const dirty = useRef(false);
  const flush = useCallback(async () => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    const { draft, chat } = latest.current;
    if (!draft || !dirty.current) return;
    dirty.current = false;
    await writeSiteRow(draft, chat).catch((error) => console.error('The website could not be saved', error));
  }, []);

  useEffect(() => {
    waiting.add(flush);
    return () => {
      waiting.delete(flush);
    };
  }, [flush]);

  const schedule = useCallback(() => {
    dirty.current = true;
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void flush(), 400);
  }, [flush]);

  /** A change from changeSite, into this copy of the site. */
  const take = useCallback(
    (change: SiteChange) => {
      setState((current) => {
        if (!current.draft) return current;
        const next = change({ draft: current.draft, chat: current.chat });
        const taken = { ...current, draft: { ...next.draft, updatedAt: Date.now() }, chat: next.chat };
        latest.current = taken;
        return taken;
      });
      schedule();
    },
    [schedule]
  );

  useEffect(() => {
    let cancelled = false;
    setState({ projectId, loaded: false, draft: null, chat: [] });
    if (!projectId) {
      setState({ projectId, loaded: true, draft: null, chat: [] });
      return;
    }
    // From now on this view holds the project's site. Changes that come while
    // it is still being read wait, and go in once it is.
    const early: SiteChange[] = [];
    let ready = false;
    const holder = (change: SiteChange) => {
      if (ready) take(change);
      else early.push(change);
    };
    holders.set(projectId, holder);
    void readSiteRow(projectId)
      .then((row) => {
        if (cancelled) return;
        const loaded = { projectId, loaded: true, draft: row?.draft ?? null, chat: row?.chat ?? [] };
        latest.current = loaded;
        setState(loaded);
        ready = true;
        for (const change of early.splice(0)) take(change);
      })
      .catch((error) => {
        console.error('The website could not be read', error);
        if (!cancelled) setState({ projectId, loaded: true, draft: null, chat: [] });
      });
    return () => {
      cancelled = true;
      if (holders.get(projectId) === holder) holders.delete(projectId);
      // A change still waiting is written before another project's site is
      // read, and changes that came before this one was read go to the
      // database, after it.
      void flush();
      for (const change of early.splice(0)) void changeSite(projectId, change).catch((error) => console.error('The website could not be saved', error));
    };
  }, [projectId, flush, take]);

  const update = useCallback(
    (change: (draft: SiteDraft) => SiteDraft) => {
      setState((current) => {
        if (!current.draft) return current;
        const next = { ...current, draft: { ...change(current.draft), updatedAt: Date.now() } };
        latest.current = next;
        return next;
      });
      schedule();
    },
    [schedule]
  );

  const create = useCallback(
    (draft: SiteDraft) => {
      const next = { ...latest.current, loaded: true, draft };
      latest.current = next;
      setState(next);
      dirty.current = true;
      void flush();
    },
    [flush]
  );

  const setChat = useCallback(
    (change: (chat: SiteChatItem[]) => SiteChatItem[]) => {
      setState((current) => {
        const next = { ...current, chat: change(current.chat) };
        latest.current = next;
        return next;
      });
      schedule();
    },
    [schedule]
  );

  // The window closing or reloading takes a waiting save with it otherwise.
  useEffect(() => {
    const onHide = () => void flush();
    window.addEventListener('pagehide', onHide);
    return () => window.removeEventListener('pagehide', onHide);
  }, [flush]);

  const current = state.projectId === projectId ? state : { projectId, loaded: false, draft: null, chat: [] };
  return { loaded: current.loaded, draft: current.draft, chat: current.chat, update, create, setChat };
}
