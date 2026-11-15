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
// or still being read), the change goes into the view's copy (`SiteCopy`),
// which saves it with everything else. Otherwise it is read and written back
// inside one transaction, so two results landing at once never overwrite each
// other.

import Dexie, { type Table } from 'dexie';
import { useEffect, useMemo, useSyncExternalStore } from 'react';
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

export interface SiteSnapshot {
  projectId: string | null;
  /** False until the stored site of this project has been read. */
  loaded: boolean;
  draft: SiteDraft | null;
  chat: SiteChatItem[];
}

/**
 * One project's site as the Website view holds it: read once, changed in
 * place, and written back a moment after each change, or at once by `flush`.
 *
 * Every change lands in the copy the moment it is made, and `flush` writes
 * the copy as it is then. A change React had only queued would not be in the
 * copy yet, so a save straight after it (the window closing) would write the
 * site without it and count it as saved. React reads the copy through
 * useSyncExternalStore instead.
 */
export class SiteCopy {
  private state: SiteSnapshot;
  private dirty = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly listeners = new Set<() => void>();
  /** Changes from changeSite that came before the stored site was read. */
  private early: SiteChange[] = [];
  private holding = false;
  private ready = false;

  constructor(
    readonly projectId: string | null,
    private readonly delayMs = 400
  ) {
    this.state = { projectId, loaded: !projectId, draft: null, chat: [] };
    this.ready = !projectId;
  }

  snapshot = (): SiteSnapshot => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private set(next: SiteSnapshot): void {
    this.state = next;
    this.listeners.forEach((listener) => listener());
  }

  /** Hold the project's site: changeSite comes here from now on. Reads the stored site the first time. */
  hold(): void {
    const projectId = this.projectId;
    if (!projectId || this.holding) return;
    this.holding = true;
    holders.set(projectId, this.take);
    if (this.ready) return;
    void readSiteRow(projectId)
      .then((row) => {
        if (!this.holding || this.ready) return;
        this.ready = true;
        this.set({ projectId, loaded: true, draft: row?.draft ?? null, chat: row?.chat ?? [] });
        for (const change of this.early.splice(0)) this.take(change);
      })
      .catch((error) => {
        console.error('The website could not be read', error);
        if (!this.holding || this.ready) return;
        this.ready = true;
        this.set({ ...this.state, loaded: true });
      });
  }

  /** Let go of the site: what waits is written, and changeSite goes to the database again. */
  release(): Promise<void> {
    const projectId = this.projectId;
    if (!projectId) return Promise.resolve();
    this.holding = false;
    if (holders.get(projectId) === this.take) holders.delete(projectId);
    // Started before the changes below, so they read what it writes.
    const saved = this.flush();
    for (const change of this.early.splice(0)) void changeSite(projectId, change).catch((error) => console.error('The website could not be saved', error));
    return saved;
  }

  /** A change from changeSite. */
  take = (change: SiteChange): void => {
    if (!this.ready) {
      this.early.push(change);
      return;
    }
    const { draft, chat } = this.state;
    if (!draft) return;
    const next = change({ draft, chat });
    this.set({ ...this.state, draft: { ...next.draft, updatedAt: Date.now() }, chat: next.chat });
    this.schedule();
  };

  update = (change: (draft: SiteDraft) => SiteDraft): void => {
    const { draft } = this.state;
    if (!draft) return;
    this.set({ ...this.state, draft: { ...change(draft), updatedAt: Date.now() } });
    this.schedule();
  };

  setChat = (change: (chat: SiteChatItem[]) => SiteChatItem[]): void => {
    this.set({ ...this.state, chat: change(this.state.chat) });
    this.schedule();
  };

  /** Start a site for the project, saved at once. */
  create = (draft: SiteDraft): void => {
    this.ready = true;
    this.set({ ...this.state, loaded: true, draft });
    this.dirty = true;
    void this.flush();
  };

  private schedule(): void {
    this.dirty = true;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), this.delayMs);
  }

  /** Write the site as it is now, when it changed since it was last written. */
  flush = async (): Promise<void> => {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const { draft, chat } = this.state;
    if (!draft || !this.dirty) return;
    this.dirty = false;
    await writeSiteRow(draft, chat).catch((error) => console.error('The website could not be saved', error));
  };
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
  const copy = useMemo(() => new SiteCopy(projectId), [projectId]);
  const state = useSyncExternalStore(copy.subscribe, copy.snapshot, copy.snapshot);

  useEffect(() => {
    copy.hold();
    waiting.add(copy.flush);
    // The window closing or reloading takes a waiting save with it otherwise.
    const onHide = () => void copy.flush();
    window.addEventListener('pagehide', onHide);
    return () => {
      window.removeEventListener('pagehide', onHide);
      waiting.delete(copy.flush);
      // A change still waiting is written before another project's site is read.
      void copy.release();
    };
  }, [copy]);

  return { loaded: state.loaded, draft: state.draft, chat: state.chat, update: copy.update, create: copy.create, setChat: copy.setChat };
}
