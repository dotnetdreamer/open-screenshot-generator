"use client";

// The editor's end of the account auto syncer.
//
// All the timing, the backoff and the refusals live in
// src/lib/account/autoSync.ts, which knows nothing about React. This binds one
// instance of it to the open project and hands the layout five things: the
// status the chip renders, a "a commit landed" call cheap enough to sit in the
// editor's own save path, a "somebody saved by hand" call so the two paths do
// not duplicate each other's uploads, a "this project is no longer linked" call
// for when somebody stops syncing one, and a retry for the chip.
//
// The user's switch is read here rather than in the syncer so that turning it
// off in Settings takes effect on the open project immediately, without a
// reload and without the syncer having to know that preferences exist.

import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import {
  AccountAutoSyncer,
  IDLE_ACCOUNT_SYNC_STATUS,
  type AccountSyncStatus,
} from '@/lib/account/autoSync';
import type { CloudProviderId } from '@/lib/account/types';
import { useEditorPreference } from '@/lib/editorPreferences';

export interface UseAccountAutoSyncOptions {
  /** The open project, or null when the start dialog is up. */
  projectId: string | null;
  /** Which storage is connected, and as whom. */
  provider: CloudProviderId | null;
  accountId: string | null;
  connected: boolean;
  /** True while a live editing session is running. See AccountSyncConfig. */
  collabActive: boolean;
  /**
   * Bumped whenever a project is opened, imported or created. Opening the
   * account's copy of the project already open keeps the same id, so the id
   * alone cannot tell the syncer to start again.
   */
  openToken: number;
  /** Commit the editor's own debounced Dexie write before a push reads it. */
  flushLocal: () => Promise<unknown> | void;
}

export interface AccountAutoSyncHandle {
  status: AccountSyncStatus;
  /** Safe to call on every commit, including per pixel of a drag. */
  noteChange: (projectId: string | null) => void;
  /** A manual save already pushed this project, and linked it. */
  noteSaved: () => void;
  /** The copy is gone, or somebody stopped syncing this project. */
  noteUnlinked: () => void;
  /** Push now, clearing a stop or a backoff. What the chip does when clicked. */
  syncNow: () => void;
  /** The user's own switch, for copy that explains why nothing is syncing. */
  enabled: boolean;
}

export function useAccountAutoSync({
  projectId,
  provider,
  accountId,
  connected,
  collabActive,
  openToken,
  flushLocal,
}: UseAccountAutoSyncOptions): AccountAutoSyncHandle {
  const [enabled] = useEditorPreference('accountAutoSync');

  // The flush changes identity whenever the layout re-creates it; the syncer is
  // built once and calls through this ref so it always runs the current one.
  const flushRef = useRef(flushLocal);
  flushRef.current = flushLocal;

  const syncerRef = useRef<AccountAutoSyncer | null>(null);
  if (!syncerRef.current) {
    syncerRef.current = new AccountAutoSyncer({ flushLocal: () => flushRef.current() });
  }
  const syncer = syncerRef.current;

  const status = useSyncExternalStore(
    syncer.subscribe,
    syncer.getStatus,
    () => IDLE_ACCOUNT_SYNC_STATUS
  );

  // Attach and detach are symmetrical and re-runnable, which they have to be:
  // React's development strict mode mounts every effect twice, and a syncer
  // that could only be disposed once would be dead for the rest of the session.
  useEffect(() => {
    syncer.attach();
    return () => syncer.detach();
  }, [syncer]);

  useEffect(() => {
    syncer.configure({ projectId, provider, accountId, connected, enabled, collabActive, openToken });
  }, [syncer, projectId, provider, accountId, connected, enabled, collabActive, openToken]);

  const noteChange = useCallback((id: string | null) => syncer.noteChange(id), [syncer]);
  const noteSaved = useCallback(() => syncer.noteSaved(), [syncer]);
  const noteUnlinked = useCallback(() => syncer.noteUnlinked(), [syncer]);
  const syncNow = useCallback(() => syncer.syncNow(), [syncer]);

  return { status, noteChange, noteSaved, noteUnlinked, syncNow, enabled };
}
