// Where each project's site is kept: a Dexie database of its own, beside the
// project database rather than inside it, the way Growth keeps its numbers.
// A project export, a cloud save or a version snapshot never carries a site,
// and a change to this schema never puts a migration in front of somebody's
// designs. The rule for project fields (AGENTS.md rule 1) would drop a site
// stored on the project at the next keystroke anyway.
//
// The conversation with the AI is kept with the site, so leaving the view, or
// the app, and coming back finds it where it was.

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
   * On a first write that failed: the notes the site was made with, so Try
   * again under the message writes the pages with them. Gone once pressed.
   */
  retry?: { notes: string };
  /**
   * A paragraph the AI suggested for the privacy policy. It goes in only when
   * the developer presses the button under it, so no sentence of the policy
   * is the AI's without the developer choosing it.
   */
  suggestion?: { privacyExtra: string; used?: boolean };
}

interface SiteRow {
  projectId: string;
  draft: SiteDraft;
  chat: SiteChatItem[];
  updatedAt: number;
}

class WebsiteDatabase extends Dexie {
  sites!: Table<SiteRow, string>;

  constructor() {
    super('OpenScreenshotGeneratorWebsite');
    this.version(1).stores({ sites: 'projectId, updatedAt' });
  }
}

let instance: WebsiteDatabase | null = null;

function db(): WebsiteDatabase {
  if (!instance) instance = new WebsiteDatabase();
  return instance;
}

/** Messages kept with a site. */
const CHAT_LIMIT = 40;

export async function readSiteRow(projectId: string): Promise<{ draft: SiteDraft; chat: SiteChatItem[] } | null> {
  const row = await db().sites.get(projectId);
  return row ? { draft: row.draft, chat: row.chat ?? [] } : null;
}

export async function writeSiteRow(draft: SiteDraft, chat: SiteChatItem[]): Promise<void> {
  // Only the newest answer can be undone, so only it keeps the draft before it.
  const kept = chat.slice(-CHAT_LIMIT).map((item, index, all) => (index === all.length - 1 || !item.before ? item : { ...item, before: undefined }));
  await db().sites.put({ projectId: draft.projectId, draft, chat: kept, updatedAt: Date.now() });
}

/**
 * Change a project's stored site and conversation. For AI work that ends
 * after another project was opened: the answer still lands in the site it
 * was asked about. Nothing happens for a project without a site.
 */
export async function changeSiteRow(
  projectId: string,
  change: (row: { draft: SiteDraft; chat: SiteChatItem[] }) => { draft: SiteDraft; chat: SiteChatItem[] }
): Promise<void> {
  const row = await readSiteRow(projectId);
  if (!row) return;
  const next = change(row);
  await writeSiteRow({ ...next.draft, updatedAt: Date.now() }, next.chat);
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

  useEffect(() => {
    let cancelled = false;
    setState({ projectId, loaded: false, draft: null, chat: [] });
    if (!projectId) {
      setState({ projectId, loaded: true, draft: null, chat: [] });
      return;
    }
    void readSiteRow(projectId)
      .then((row) => {
        if (!cancelled) setState({ projectId, loaded: true, draft: row?.draft ?? null, chat: row?.chat ?? [] });
      })
      .catch((error) => {
        console.error('The website could not be read', error);
        if (!cancelled) setState({ projectId, loaded: true, draft: null, chat: [] });
      });
    return () => {
      cancelled = true;
      // A change still waiting is written before another project's site is read.
      void flush();
    };
  }, [projectId, flush]);

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
