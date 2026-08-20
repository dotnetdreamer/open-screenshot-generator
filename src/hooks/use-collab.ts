"use client";

// The editor's end of a live session.
//
// Everything about peers, CRDTs and ICE is in src/lib/collab; this holds one
// session in a ref, keeps React told about who is in the room, and hands the
// layout four stable callbacks it can call from anywhere without re-creating
// half its render tree:
//
//   start(slug, key)  join or open a room
//   stop()            leave it
//   publish(boards)   a local commit landed
//   setSelection / setCursor   what this person is doing, for everybody's canvas
//
// The callbacks are stable and the session is a ref on purpose: `publish` is
// called from inside `handleArtboardsUpdate`, which is itself a dependency of
// most of the editor, so a callback that changed identity per render would
// re-create every handler in the file on every keystroke.

import { useCallback, useEffect, useRef, useState } from 'react';
import { CollabSession, isCollabConfigured } from '@/lib/collab/session';
import { peerColor, type CollabPeer, type CollabStatus, type CollabUser } from '@/lib/collab/types';
import type { ArtboardState } from '@/types/artboard';

export interface UseCollabOptions {
  /** Who this device is. Null when signed out, which is when nothing starts. */
  viewer: { id: string; name: string; avatarUrl?: string } | null;
  /** The community token, swapped for a signalling ticket. */
  token: string | null;
  /** The canvas right now, read only when a room turns out to be empty. */
  getBoards: () => ArtboardState[];
  getProjectName: () => string;
  /** The room's document changed. Called with the whole board list. */
  onRemote: (boards: ArtboardState[], projectName: string | null) => void;
}

export interface CollabHandle {
  /** This build has a signalling server, so live editing exists at all. */
  isConfigured: boolean;
  status: CollabStatus;
  /** Everybody but you. */
  peers: CollabPeer[];
  /** The room this device is in, if any. */
  room: { slug: string; key: string } | null;
  /** How this person appears to the others. */
  me: CollabUser | null;
  start: (slug: string, key: string) => Promise<void>;
  stop: () => void;
  publish: (boards: ArtboardState[], projectName?: string) => void;
  setSelection: (artboardId: string | null, elementId: string | null) => void;
  setCursor: (cursor: { artboardId: string; x: number; y: number } | null) => void;
  /** Set when the last attempt failed, ready to put in front of somebody. */
  error: string | null;
}

export function useCollab({
  viewer,
  token,
  getBoards,
  getProjectName,
  onRemote,
}: UseCollabOptions): CollabHandle {
  const sessionRef = useRef<CollabSession | null>(null);
  const [status, setStatus] = useState<CollabStatus>('off');
  const [peers, setPeers] = useState<CollabPeer[]>([]);
  const [room, setRoom] = useState<{ slug: string; key: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Everything the session calls back into is read through refs, so a session
  // started ten renders ago still talks to the current editor.
  const callbacks = useRef({ getBoards, getProjectName, onRemote });
  callbacks.current = { getBoards, getProjectName, onRemote };

  const me: CollabUser | null = viewer
    ? {
        id: viewer.id,
        name: viewer.name || 'Someone',
        color: peerColor(viewer.id),
        avatarUrl: viewer.avatarUrl,
      }
    : null;
  const meRef = useRef(me);
  meRef.current = me;
  const tokenRef = useRef(token);
  tokenRef.current = token;

  const stop = useCallback(() => {
    sessionRef.current?.destroy();
    sessionRef.current = null;
    setRoom(null);
    setPeers([]);
    setStatus('off');
  }, []);

  const start = useCallback(
    async (slug: string, key: string) => {
      const user = meRef.current;
      if (!user) throw new Error('Sign in to start a live session.');
      // Already in this exact room: joining again would tear down a working
      // mesh and lose everybody's presence for a few seconds.
      if (sessionRef.current && sessionRef.current.slug === slug) return;
      sessionRef.current?.destroy();
      sessionRef.current = null;
      setError(null);
      setStatus('connecting');
      try {
        const session = await CollabSession.open({
          slug,
          key,
          user,
          token: tokenRef.current,
          getInitialBoards: () => callbacks.current.getBoards(),
          getProjectName: () => callbacks.current.getProjectName(),
          onRemote: (boards, name) => callbacks.current.onRemote(boards, name),
          onPeers: setPeers,
          onStatus: setStatus,
        });
        sessionRef.current = session;
        setRoom({ slug, key });
      } catch (failure) {
        setStatus('error');
        setError(failure instanceof Error ? failure.message : 'That session could not be started.');
        throw failure;
      }
    },
    []
  );

  const publish = useCallback((boards: ArtboardState[], projectName?: string) => {
    sessionRef.current?.publish(boards, projectName);
  }, []);

  const setSelection = useCallback((artboardId: string | null, elementId: string | null) => {
    sessionRef.current?.setSelection({ artboardId, elementId });
  }, []);

  const setCursor = useCallback((cursor: { artboardId: string; x: number; y: number } | null) => {
    sessionRef.current?.setCursor(cursor);
  }, []);

  // A tab that goes away without leaving the room leaves a ghost in everybody
  // else's presence list until awareness times it out.
  useEffect(() => () => {
    sessionRef.current?.destroy();
    sessionRef.current = null;
  }, []);

  return {
    isConfigured: isCollabConfigured(),
    status,
    peers,
    room,
    me,
    start,
    stop,
    publish,
    setSelection,
    setCursor,
    error,
  };
}
