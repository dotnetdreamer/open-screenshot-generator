// Past Claude Code chats: what one saved chat holds, and the list the Agent
// panel shows of them.
//
// A chat belongs to a project, the one its latest message was about, so
// opening a project brings back its own chat and Past chats can take the user
// back to any earlier one. The conversation itself lives in Claude Code's own
// file, which --resume reads; a row keeps what the panel needs to show the chat
// and the id to resume it. The rows are the `agentChats` table (database.ts),
// read and written by the store (store.ts) and nothing else.

import { clipText } from '@/lib/clipText';
import type { AgentItem } from './types';

export interface AgentChatRecord {
  /** Made with the chat's first message. Claude Code's own id comes later. */
  id: string;
  /** Claude Code's conversation id, what --resume takes. Null until a turn has started. */
  sessionId: string | null;
  projectId: string | null;
  /** The project's name when the chat last saw it. The list prefers the current one. */
  projectName: string | null;
  /** The chat's first message, cut short, for the list. */
  title: string;
  /** The model Claude Code reported. */
  model: string | null;
  createdAt: number;
  /** When the latest message or reply arrived, which orders the list. */
  updatedAt: number;
  /** The transcript as the store keeps it across a reload: no pictures, no tool arguments. */
  items: AgentItem[];
}

export type AgentChatSummary = Omit<AgentChatRecord, 'items'>;

/** One row of Past chats, as the panel draws it. */
export interface AgentChatListItem {
  id: string;
  title: string;
  projectId: string | null;
  projectName: string | null;
  updatedAt: number;
  /** The chat on screen now. */
  current: boolean;
}

/** Chats kept. Older ones are deleted as new ones are saved. */
export const KEEP_CHATS = 50;
const TITLE_CHARS = 80;

/** The first thing the user wrote, or null when nothing has been said yet. */
export function chatTitle(items: AgentItem[]): string | null {
  const first = items.find((item) => item.kind === 'user');
  if (!first || first.kind !== 'user') return null;
  const text = first.text.replace(/\s+/g, ' ').trim();
  if (text) return clipText(text, TITLE_CHARS);
  return first.attachments > 0 ? 'Screenshots' : null;
}

/** When the chat last moved: its newest item, so opening an old chat does not bring it to the top. */
export function chatUpdatedAt(items: AgentItem[], fallback: number): number {
  let latest = 0;
  for (const item of items) {
    const at = item.kind === 'tool' ? (item.endedAt ?? item.at) : item.at;
    if (at > latest) latest = at;
  }
  return latest || fallback;
}

export function toChatSummary(record: AgentChatRecord): AgentChatSummary {
  const { items: _items, ...summary } = record;
  return summary;
}

/** Newest first, the one being saved replacing its older copy. */
export function upsertChatSummary(list: AgentChatSummary[], summary: AgentChatSummary): AgentChatSummary[] {
  return [summary, ...list.filter((entry) => entry.id !== summary.id)]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, KEEP_CHATS);
}

/**
 * The rows for Past chats. A project renamed since the chat last saw it shows
 * under its current name, which `nameOf` knows and the saved row does not.
 */
export function chatListItems(
  chats: AgentChatSummary[],
  currentId: string | null,
  nameOf: (projectId: string) => string | null = () => null
): AgentChatListItem[] {
  return chats.map((chat) => ({
    id: chat.id,
    title: chat.title,
    projectId: chat.projectId,
    projectName: (chat.projectId ? nameOf(chat.projectId) : null) ?? chat.projectName,
    updatedAt: chat.updatedAt,
    current: chat.id === currentId,
  }));
}
