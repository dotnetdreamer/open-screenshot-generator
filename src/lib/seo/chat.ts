// Ask AI's conversation in the SEO view, one per site, kept outside the
// screen so switching sections or sites doesn't lose it. Kept for the
// sitting only, like Store compliance's.

import { useSyncExternalStore } from 'react';
import { askAboutSite, type ChatTurn } from './ai';
import { googleInput, siteData } from './state';
import { getKnowledgeState } from './sync';

export interface ChatItem extends ChatTurn {
  id: string;
  at: number;
  failed?: boolean;
}

interface ChatState {
  bySite: Record<string, ChatItem[]>;
  pendingFor: string | null;
}

let state: ChatState = { bySite: {}, pendingFor: null };
const listeners = new Set<() => void>();
let controller: AbortController | null = null;
let serial = 0;

function set(next: Partial<ChatState>): void {
  state = { ...state, ...next };
  for (const listener of listeners) listener();
}

function push(siteId: string, item: Omit<ChatItem, 'id' | 'at'>): void {
  const items = [...(state.bySite[siteId] ?? []), { ...item, id: `m${++serial}`, at: Date.now() }];
  set({ bySite: { ...state.bySite, [siteId]: items } });
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

export function useSeoChat(): ChatState {
  return useSyncExternalStore(subscribe, () => state, () => state);
}

export async function askSeoQuestion(siteId: string, siteName: string, question: string): Promise<void> {
  const text = question.trim();
  if (!text || state.pendingFor) return;
  const history = (state.bySite[siteId] ?? []).filter((item) => !item.failed).map(({ role, text: said }) => ({ role, text: said }));
  push(siteId, { role: 'user', text });
  const mine = new AbortController();
  controller = mine;
  set({ pendingFor: siteId });
  try {
    const answer = await askAboutSite({
      question: text,
      history,
      run: siteData(siteId).runs[0] ?? null,
      siteName,
      google: googleInput(siteId),
      knowledge: getKnowledgeState(),
      signal: mine.signal,
    });
    if (!mine.signal.aborted) push(siteId, { role: 'ai', text: answer });
  } catch (error) {
    if (!mine.signal.aborted) push(siteId, { role: 'ai', text: error instanceof Error ? error.message : 'The AI did not answer. Try again', failed: true });
  } finally {
    if (controller === mine) {
      controller = null;
      set({ pendingFor: null });
    }
  }
}

export function stopSeoChat(): void {
  controller?.abort();
  controller = null;
  set({ pendingFor: null });
}

export function clearSeoChat(siteId: string): void {
  if (state.pendingFor === siteId) stopSeoChat();
  const bySite = { ...state.bySite };
  delete bySite[siteId];
  set({ bySite });
}
