// The Ask AI conversation of the Store compliance view. It lives here rather than
// in the screen, so a visit to another section or to the editor leaves the
// conversation, and an answer still on its way, as they were. Stop aborts the
// prompt's signal, which ends the CLI process (agentPrompt.ts), not only the
// wait. The last check of each project is kept in the database, so the
// Overview can show it after a reload. Turns that came from the user's code
// are marked (`fromCode`), and only Claude Code gets them back (historyFor).

import { useSyncExternalStore } from 'react';
import { readGuide } from './sync';
import { askAboutRules, checkApp, type AskTurn, type CheckInput, type CheckResult } from './ai';
import { folderBlockFromError, noteFolderAccess, type CodeFolder } from './codeFolder';
import { readMetaValue, writeMetaValue } from './store';
import type { RulesLibrary, ShipStore } from './types';

/**
 * `fromCode` on a question: it went with the code folder. On an answer: it
 * came from the user's code, read for it or carried in the conversation
 * (askAboutRules). Either way the turn goes back to Claude Code only.
 */
export type ChatEntry =
  | { id: string; kind: 'question'; text: string; rejected: boolean; fromCode: boolean }
  | { id: string; kind: 'answer'; text: string; ai: string | null; fromCode: boolean }
  | { id: string; kind: 'check'; result: CheckResult; projectName: string }
  | { id: string; kind: 'error'; text: string };

export interface RulesChat {
  entries: ChatEntry[];
  /** What is being worked on, null when nothing is. */
  running: 'question' | 'rejection' | 'check' | null;
  /** The prompt on its way reads the app's code, which takes minutes rather than seconds. */
  readsCode: boolean;
}

let chat: RulesChat = { entries: [], running: null, readsCode: false };
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

const EMPTY: RulesChat = { entries: [], running: null, readsCode: false };

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

/**
 * What a prompt that read the code folder says about macOS: it got in, or
 * macOS kept Claude Code out or is asking first, so the folder says so.
 */
function noteCodeOutcome(code: CodeFolder | null | undefined, error?: unknown): void {
  if (!code) return;
  if (error === undefined) {
    void noteFolderAccess(code.path, 'open');
    return;
  }
  const block = folderBlockFromError(errorText(error));
  if (block) void noteFolderAccess(code.path, block);
}

/**
 * The conversation as turns, each marked when it came from the user's code.
 * A question whose answer did is marked with it, so another AI never gets
 * one half of that exchange. Exported for the tests.
 */
export function turnsOf(entries: ChatEntry[]): AskTurn[] {
  const turns: AskTurn[] = [];
  for (const entry of entries) {
    if (entry.kind === 'question') turns.push({ role: 'user', text: entry.text, fromCode: entry.fromCode });
    if (entry.kind !== 'answer') continue;
    const asked = turns[turns.length - 1];
    if (entry.fromCode && asked?.role === 'user') asked.fromCode = true;
    turns.push({ role: 'assistant', text: entry.text, fromCode: entry.fromCode });
  }
  return turns;
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
  context: { library: RulesLibrary; stores: ShipStore[]; today: string; ai: string | null; rejected?: boolean; code?: CodeFolder | null }
): Promise<void> {
  const question = text.trim();
  if (!question || chat.running) return;
  const earlier = turnsOf(chat.entries);
  add({ id: nextId(), kind: 'question', text: question, rejected: !!context.rejected, fromCode: !!context.code });
  controller = new AbortController();
  const { signal } = controller;
  set({ ...chat, running: context.rejected ? 'rejection' : 'question', readsCode: !!context.code });
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
      code: context.code,
      signal,
    });
    if (!signal.aborted) add({ id: nextId(), kind: 'answer', text: answer.text, ai: context.ai, fromCode: answer.fromCode });
    noteCodeOutcome(context.code);
  } catch (error) {
    if (!isAbort(error) && !signal.aborted) add({ id: nextId(), kind: 'error', text: errorText(error) });
    if (!isAbort(error)) noteCodeOutcome(context.code, error);
  } finally {
    // After a Stop the next prompt may already be running; it is not this one's to clear.
    if (!controller || controller.signal === signal) {
      controller = null;
      set({ ...chat, running: null, readsCode: false });
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
  set({ ...chat, running: 'check', readsCode: !!input.code });
  try {
    const result = await checkApp(context.library, input, { ai: context.ai, signal });
    noteCodeOutcome(input.code);
    if (signal.aborted) return;
    add({ id: nextId(), kind: 'check', result, projectName: context.projectName });
    if (context.projectId) await writeMetaValue(lastCheckKey(context.projectId), { result, projectName: context.projectName });
  } catch (error) {
    if (!isAbort(error) && !signal.aborted) add({ id: nextId(), kind: 'error', text: errorText(error) });
    if (!isAbort(error)) noteCodeOutcome(input.code, error);
  } finally {
    // After a Stop the next prompt may already be running; it is not this one's to clear.
    if (!controller || controller.signal === signal) {
      controller = null;
      set({ ...chat, running: null, readsCode: false });
    }
  }
}

export function stopRulesChat(): void {
  controller?.abort();
  controller = null;
  set({ ...chat, running: null, readsCode: false });
}

export function newRulesChat(): void {
  stopRulesChat();
  set({ entries: [], running: null, readsCode: false });
}

function lastCheckKey(projectId: string): string {
  return `check:${projectId}`;
}

export async function readLastCheck(projectId: string): Promise<{ result: CheckResult; projectName: string } | null> {
  return readMetaValue(lastCheckKey(projectId));
}
