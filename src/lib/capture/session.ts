/**
 * Capture's state for this window: the device and app picked, the switches,
 * and the screenshots taken this sitting.
 *
 * Outside React because two places read it: the Capture view, and the
 * Properties panel's button, which takes a screenshot from the picked device
 * without opening the view. The picks and switches are kept in localStorage
 * so the next sitting starts on the same device; the screenshots themselves
 * live in the media table, and only their references are listed here.
 */

import { useSyncExternalStore } from 'react';
import type { CaptureDevice, CapturePlatform, CapturedShot } from './types';

export type Appearance = 'as-set' | 'light' | 'dark';

export interface CaptureSession {
  device: CaptureDevice | null;
  /** The app picked for each platform. */
  appIds: Partial<Record<CapturePlatform, string>>;
  /** Draw the status bar at 9:41 with full signal and battery. */
  tidy: boolean;
  appearance: Appearance;
  /** Choose the next frame in the row after each screenshot. */
  advance: boolean;
  /** Newest first. */
  shots: CapturedShot[];
}

const STORAGE_KEY = 'osg-capture-prefs';
const MAX_SHOTS = 30;

interface Stored {
  device?: CaptureDevice | null;
  appIds?: Partial<Record<CapturePlatform, string>>;
  tidy?: boolean;
  appearance?: Appearance;
  advance?: boolean;
}

function readStored(): Stored {
  try {
    const raw = typeof localStorage === 'undefined' ? null : localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Stored) : {};
  } catch {
    return {};
  }
}

function writeStored(session: CaptureSession): void {
  try {
    const stored: Stored = {
      device: session.device,
      appIds: session.appIds,
      tidy: session.tidy,
      appearance: session.appearance,
      advance: session.advance,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
  } catch {
    // Private mode or storage full: the picks last this sitting only.
  }
}

let state: CaptureSession | null = null;
const listeners = new Set<() => void>();

function current(): CaptureSession {
  if (!state) {
    const stored = readStored();
    state = {
      // A device read back from storage is only a guess at what is running;
      // the view lists devices again before it uses one.
      device: stored.device ? { ...stored.device, state: 'off' } : null,
      appIds: stored.appIds ?? {},
      tidy: stored.tidy ?? true,
      appearance: stored.appearance ?? 'as-set',
      advance: stored.advance ?? true,
      shots: [],
    };
  }
  return state;
}

export function getCaptureSession(): CaptureSession {
  return current();
}

export function updateCaptureSession(patch: Partial<CaptureSession>): void {
  state = { ...current(), ...patch };
  writeStored(state);
  listeners.forEach((listener) => listener());
}

export function addCapturedShot(shot: CapturedShot): void {
  const shots = [shot, ...current().shots.filter((existing) => existing.ref !== shot.ref)].slice(0, MAX_SHOTS);
  updateCaptureSession({ shots });
}

export function subscribeCaptureSession(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const SERVER_SNAPSHOT: CaptureSession = {
  device: null,
  appIds: {},
  tidy: true,
  appearance: 'as-set',
  advance: true,
  shots: [],
};

export function useCaptureSession(): CaptureSession {
  return useSyncExternalStore(subscribeCaptureSession, current, () => SERVER_SNAPSHOT);
}

/** The picked device, when it is running now. */
export function runningDevice(session: CaptureSession): CaptureDevice | null {
  return session.device && session.device.state === 'running' ? session.device : null;
}
