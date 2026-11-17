// The Ask AI conversation of the Store compliance view. It lives here rather than
// in the screen, so a visit to another section or to the editor leaves the
// conversation, and an answer still on its way, as they were. Stop aborts the
// prompt's signal, which ends the CLI process (agentPrompt.ts), not only the
// wait. The last check of each project is kept in the database, so the
// Overview can show it after a reload.

import { useSyncExternalStore } from 'react';
import { readGuide } from './sync';
import { askAboutRules, checkApp, type AskTurn, type CheckInput, type CheckResult } from './ai';
import { readMetaValue, writeMetaValue } from './store';
import type { RulesLibrary, ShipStore } from './types';

export type ChatEntry =
  | { id: string; kind: 'question'; text: string; rejected: boolean }
  | { id: string; kind: 'answer'; text: string; ai: string | null }
  | { id: string; kind: 'check'; result: CheckResult; projectName: string }
  | { id: string; kind: 'error'; text: string };

export interface RulesChat {
  entries: ChatEntry[];
  /** What is being worked on, null when nothing is. */
  running: 'question' | 'rejection' | 'check' | null;
}

let chat: RulesChat = { entries: [], running: null };
const listeners = new Set<() => void>();
let controller: AbortController | null = null;
let counter = 0;

function set(next: RulesChat): void {
  chat = next;
  listeners.forEach((listener) => listener());
}

function add(entry: ChatEntry): void {
  set({ ...chat, entries: [...chat.entries, entry] });
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const EMPTY: RulesChat = { entries: [], running: null };

export function useRulesChat(): RulesChat {
  return useSyncExternalStore(subscribe, () => chat, () => EMPTY);
}

function nextId(): string {
  counter += 1;
  return `rules-chat-${counter}`;
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

function errorText(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'The AI did not answer. Try again.';
}

function history(): AskTurn[] {
  return chat.entries.flatMap((entry): AskTurn[] => {
    if (entry.kind === 'question') return [{ role: 'user', text: entry.text }];
    if (entry.kind === 'answer') return [{ role: 'assistant', text: entry.text }];
    return [];
  });
}

/** A guide the rejection answers lean on, when GitHub or the copy here has it. */
async function appealGuide(): Promise<string | null> {
  try {
    return (await readGuide('docs/MISTAKE-PATTERNS.md')).file.text;
  } catch {
    return null;
  }
}

export async function askRulesQuestion(
  text: string,
  context: { library: RulesLibrary; stores: ShipStore[]; today: string; ai: string | null; rejected?: boolean }
): Promise<void> {
  const question = text.trim();
  if (!question || chat.running) return;
  const earlier = history();
  add({ id: nextId(), kind: 'question', text: question, rejected: !!context.rejected });
  controller = new AbortController();
  const { signal } = controller;
  set({ ...chat, running: context.rejected ? 'rejection' : 'question' });
  try {
    const guide = context.rejected ? await appealGuide() : null;
    const answer = await askAboutRules({
      library: context.library,
      question,
      history: earlier,
      stores: context.stores,
      today: context.today,
      rejected: context.rejected,
      appealGuide: guide,
      signal,
    });
    if (!signal.aborted) add({ id: nextId(), kind: 'answer', text: answer.text, ai: context.ai });
  } catch (error) {
    if (!isAbort(error) && !signal.aborted) add({ id: nextId(), kind: 'error', text: errorText(error) });
  } finally {
    // After a Stop the next prompt may already be running; it is not this one's to clear.
    if (!controller || controller.signal === signal) {
      controller = null;
      set({ ...chat, running: null });
    }
  }
}

export async function runRulesCheck(
  input: CheckInput,
  context: { library: RulesLibrary; ai: string | null; projectId: string | null; projectName: string }
): Promise<void> {
  if (chat.running) return;
  controller = new AbortController();
  const { signal } = controller;
  set({ ...chat, running: 'check' });
  try {
    const result = await checkApp(context.library, input, { ai: context.ai, signal });
    if (signal.aborted) return;
    add({ id: nextId(), kind: 'check', result, projectName: context.projectName });
    if (context.projectId) await writeMetaValue(lastCheckKey(context.projectId), { result, projectName: context.projectName });
  } catch (error) {
    if (!isAbort(error) && !signal.aborted) add({ id: nextId(), kind: 'error', text: errorText(error) });
  } finally {
    // After a Stop the next prompt may already be running; it is not this one's to clear.
    if (!controller || controller.signal === signal) {
      controller = null;
      set({ ...chat, running: null });
    }
  }
}

export function stopRulesChat(): void {
  controller?.abort();
  controller = null;
  set({ ...chat, running: null });
}

export function newRulesChat(): void {
  stopRulesChat();
  set({ entries: [], running: null });
}

function lastCheckKey(projectId: string): string {
  return `check:${projectId}`;
}

export async function readLastCheck(projectId: string): Promise<{ result: CheckResult; projectName: string } | null> {
  return readMetaValue(lastCheckKey(projectId));
}
