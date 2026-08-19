"use client";

// The editor's end of the cloud auto saver.
//
// All the timing, the backoff and the failure handling live in
// src/lib/cloud/autoSave.ts, which knows nothing about React. This binds one
// instance of it to the open project and hands the layout four things: the
// status the chip renders, a "a commit landed" call cheap enough to sit in the
// editor's own save path, a "somebody saved by hand" call so the two paths do
// not duplicate each other's uploads, and a retry for the chip.
//
// The user's switch is read here rather than in the saver so that turning auto
// save off in Settings takes effect on the open project immediately, without a
// reload and without the saver having to know that preferences exist.

import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import {
  CloudAutoSaver,
  IDLE_AUTO_SAVE_STATUS,
  type CloudAutoSaveStatus,
} from '@/lib/cloud/autoSave';
import { useEditorPreference } from '@/lib/editorPreferences';

export interface UseCloudAutoSaveOptions {
  /** The open project, or null when the start dialog is up. */
  projectId: string | null;
  /** The community account a save would be attributed to. */
  accountId: string | null;
  /** This build has a backend and the box has cloud projects switched on. */
  available: boolean;
  signedIn: boolean;
  /**
   * Bumped whenever a project is opened, imported or created.
   *
   * Opening the cloud copy of the project that is already open keeps the same
   * id, so the id alone cannot tell the saver to start again. See
   * `CloudAutoSaveConfig.openToken`.
   */
  openToken: number;
  /**
   * Commit the editor's own debounced Dexie write.
   *
   * The push reads the stored row, so this is what keeps it from carrying the
   * document as it was 600ms ago.
   */
  flushLocal: () => Promise<unknown> | void;
}

export interface CloudAutoSaveHandle {
  status: CloudAutoSaveStatus;
  /** Safe to call on every commit, including per pixel of a drag. */
  noteChange: (projectId: string | null) => void;
  /** A manual save (or a resolved conflict) already pushed this project. */
  noteSaved: () => void;
  /** Push now, clearing a pause or a backoff. What the chip does when clicked. */
  saveNow: () => void;
  /** The user's own switch, for the copy that explains why nothing is syncing. */
  enabled: boolean;
}

export function useCloudAutoSave({
  projectId,
  accountId,
  available,
  signedIn,
  openToken,
  flushLocal,
}: UseCloudAutoSaveOptions): CloudAutoSaveHandle {
  const [enabled] = useEditorPreference('cloudAutoSave');

  // The flush changes identity whenever the layout re-creates it; the saver is
  // built once and calls through this ref so it always runs the current one.
  const flushRef = useRef(flushLocal);
  flushRef.current = flushLocal;

  const saverRef = useRef<CloudAutoSaver | null>(null);
  if (!saverRef.current) {
    saverRef.current = new CloudAutoSaver({ flushLocal: () => flushRef.current() });
  }
  const saver = saverRef.current;

  const status = useSyncExternalStore(
    saver.subscribe,
    saver.getStatus,
    () => IDLE_AUTO_SAVE_STATUS
  );

  // Attach and detach are symmetrical and re-runnable, which they have to be:
  // React's development strict mode mounts every effect twice, and a saver that
  // could only be disposed once would be dead for the rest of the session.
  useEffect(() => {
    saver.attach();
    return () => saver.detach();
  }, [saver]);

  useEffect(() => {
    saver.configure({ projectId, accountId, available, signedIn, enabled, openToken });
  }, [saver, projectId, accountId, available, signedIn, enabled, openToken]);

  const noteChange = useCallback((id: string | null) => saver.noteChange(id), [saver]);
  const noteSaved = useCallback(() => saver.noteSaved(), [saver]);
  const saveNow = useCallback(() => saver.saveNow(), [saver]);

  return { status, noteChange, noteSaved, saveNow, enabled };
}
