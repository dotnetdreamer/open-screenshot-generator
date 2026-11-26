"use client";

// To-dos the user writes on Growth's Today screen, beside the ones Growth works
// out from the numbers (studio.ts `studioTodos`). They are kept in the growth
// database's meta table under one key, so they stay on this computer like the
// rest of Growth and never ride along with a project.
//
// Every change reads the list, changes it and writes it back under a Web Lock,
// so two editor windows adding a to-do at the same moment both keep theirs.

import { useEffect, useState } from 'react';
import { daysBetween, formatDay } from './dates';
import { readMeta, writeMeta } from './db';
import type { DayString } from './types';

export interface ManualTodo {
  id: string;
  title: string;
  /** The app it's about, or null for no app in particular. */
  appId: string | null;
  /** The day it's due, or null. */
  due: DayString | null;
  createdAt: number;
  /** When it was ticked off, in ms. */
  doneAt?: number;
}

export const MANUAL_TODOS_KEY = 'today:todos';
export const MAX_TODO_LENGTH = 140;
/** Ticked-off to-dos stay in the list, struck through, this long. */
const DONE_SHOWN_MS = 24 * 3_600_000;

const listeners = new Set<() => void>();

export function onManualTodos(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function readManualTodos(): Promise<ManualTodo[]> {
  return (await readMeta<ManualTodo[]>(MANUAL_TODOS_KEY)) ?? [];
}

async function locked<T>(task: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  return locks ? locks.request('osg-today-todos', task) : task();
}

/** Change the list from what is stored now, never from a copy read earlier. */
export async function changeManualTodos(change: (list: ManualTodo[]) => ManualTodo[], now = Date.now()): Promise<void> {
  await locked(async () => {
    // Ticked-off ones older than a week go for good, so the list never grows without end.
    const kept = (await readManualTodos()).filter((todo) => !todo.doneAt || now - todo.doneAt < 7 * 24 * 3_600_000);
    await writeMeta(MANUAL_TODOS_KEY, change(kept));
  });
  listeners.forEach((listener) => listener());
}

/**
 * Today on this computer's calendar. Store reports are dated in UTC (dates.ts),
 * but a due day is one the person picked on their own calendar, so "due
 * today" and "late" go by the local day: in UTC an evening in California is
 * already tomorrow.
 */
export function localDay(now: Date = new Date()): DayString {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function newManualTodo(input: { title: string; appId: string | null; due: DayString | null }, now = Date.now()): ManualTodo {
  return {
    id: `todo-${now.toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    title: input.title.trim().slice(0, MAX_TODO_LENGTH),
    appId: input.appId,
    due: input.due,
    createdAt: now,
  };
}

/** Open to-dos first, by due day (no day last), then the ones ticked off today. */
export function sortManualTodos(list: ManualTodo[], now = Date.now()): ManualTodo[] {
  const open = list.filter((todo) => !todo.doneAt);
  const done = list.filter((todo) => todo.doneAt && now - todo.doneAt < DONE_SHOWN_MS);
  open.sort((a, b) => (a.due ?? '9999').localeCompare(b.due ?? '9999') || a.createdAt - b.createdAt);
  done.sort((a, b) => (b.doneAt ?? 0) - (a.doneAt ?? 0));
  return [...open, ...done];
}

export interface DueWords {
  text: string;
  state: 'late' | 'today' | 'soon' | 'later';
}

/** "Due today", "Due tomorrow", "Due Nov 28", "2 days late". */
export function dueWords(due: DayString, today: DayString): DueWords {
  const days = daysBetween(today, due);
  if (days < 0) return { text: days === -1 ? '1 day late' : `${-days} days late`, state: 'late' };
  if (days === 0) return { text: 'Due today', state: 'today' };
  if (days === 1) return { text: 'Due tomorrow', state: 'soon' };
  return { text: `Due ${formatDay(due)}`, state: days <= 7 ? 'soon' : 'later' };
}

/** The counts the To do card leads with. */
export function manualCounts(list: ManualTodo[], today: DayString): { open: number; dueToday: number; late: number } {
  const open = list.filter((todo) => !todo.doneAt);
  return {
    open: open.length,
    dueToday: open.filter((todo) => todo.due === today).length,
    late: open.filter((todo) => todo.due && todo.due < today).length,
  };
}

/** The user's to-dos, read again whenever any window's Today changes them. */
export function useManualTodos(): { loaded: boolean; list: ManualTodo[] } {
  const [state, setState] = useState<{ loaded: boolean; list: ManualTodo[] }>({ loaded: false, list: [] });
  useEffect(() => {
    let cancelled = false;
    const read = () =>
      void readManualTodos().then(
        (list) => {
          if (!cancelled) setState({ loaded: true, list });
        },
        (error) => {
          console.error('Reading the to-dos failed', error);
          if (!cancelled) setState((current) => ({ ...current, loaded: true }));
        }
      );
    read();
    const off = onManualTodos(read);
    // Another editor window writes to the same database; look again when this one is shown.
    const onShow = () => {
      if (document.visibilityState === 'visible') read();
    };
    document.addEventListener('visibilitychange', onShow);
    return () => {
      cancelled = true;
      off();
      document.removeEventListener('visibilitychange', onShow);
    };
  }, []);
  return state;
}
