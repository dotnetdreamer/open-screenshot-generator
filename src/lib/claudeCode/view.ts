// What the Agent panel renders, in one serialisable object.
//
// The editor builds it from the live store and hands it to the docked panel at
// full fidelity. A detached panel window gets the same shape put through
// slimAgentView first (rule 30 in AGENTS.md): only the latest items, no tool
// arguments, no pictures, so a long chat never outgrows the dock bus.

import type { ClaudeAgentSnapshot } from './store';
import { clipText } from '@/lib/clipText';
import type {
  AgentDetectionState,
  AgentItem,
  AgentLastTurn,
  AgentRateLimit,
  AgentStatus,
  ClaudeModelChoice,
} from './types';

export interface AgentPanelView {
  /** This build can run Claude Code (the desktop app). */
  available: boolean;
  detection: AgentDetectionState;
  status: AgentStatus;
  model: ClaudeModelChoice;
  /** The model Claude Code reported, once a turn has started. */
  resolvedModel: string | null;
  items: AgentItem[];
  /** Earlier items this view leaves out. */
  omitted: number;
  toolsConnected: boolean | null;
  billedToApiKey: boolean;
  rateLimit: AgentRateLimit | null;
  lastTurn: AgentLastTurn | null;
  turnStartedAt: number | null;
  /** Whether there is a conversation to carry on, even with no process running. */
  resumable: boolean;
  /** What the next message is about, for the chip above the input: "Headline". */
  contextLabel: string | null;
}

/** A picture the user attached in the panel, already stored as an asset. */
export interface AgentAttachment {
  ref: string;
  width: number;
  height: number;
  fileName: string;
}

export function toAgentPanelView(agent: ClaudeAgentSnapshot, contextLabel: string | null): AgentPanelView {
  const { session } = agent;
  return {
    available: agent.available,
    detection: agent.detection,
    status: session.status,
    model: agent.model,
    resolvedModel: session.model,
    items: session.items,
    omitted: 0,
    toolsConnected: session.toolsConnected,
    billedToApiKey: session.billedToApiKey,
    rateLimit: session.rateLimit,
    lastTurn: session.lastTurn,
    turnStartedAt: session.turnStartedAt,
    resumable: !!session.sessionId,
    contextLabel,
  };
}

const WIRE_ITEMS = 60;
/**
 * A detached window has no way to read past the cut, so a reply keeps most of
 * itself. The budget below bounds the total and drops older items instead.
 */
const WIRE_TEXT = 4000;
const WIRE_RESULT = 200;
/**
 * Bytes the agent's part of a snapshot may take. The whole snapshot is
 * republished on every store update while the agent works, and
 * DOCK_MAX_MESSAGE_BYTES (64KB) is the guide for all of it.
 */
const WIRE_BUDGET = 32 * 1024;

function clip(text: string | undefined, max: number): string | undefined {
  if (text === undefined) return undefined;
  return clipText(text, max);
}

function slimItem(item: AgentItem): AgentItem {
  if (item.kind === 'tool') {
    const { image: _image, ...rest } = item;
    return { ...rest, input: {}, result: clip(rest.result, WIRE_RESULT) };
  }
  if (item.kind === 'text' || item.kind === 'user') return { ...item, text: clip(item.text, WIRE_TEXT) ?? '' };
  return item;
}

/**
 * The view for a detached window: small enough for the bus, whatever the chat
 * holds. The newest items go first, until either the item count or the byte
 * budget runs out; the newest one always goes, whatever its size.
 */
export function slimAgentView(view: AgentPanelView): AgentPanelView {
  const kept: AgentItem[] = [];
  let bytes = 0;
  for (let i = view.items.length - 1; i >= 0 && kept.length < WIRE_ITEMS; i--) {
    const item = slimItem(view.items[i]);
    const size = JSON.stringify(item).length;
    if (kept.length > 0 && bytes + size > WIRE_BUDGET) break;
    bytes += size;
    kept.unshift(item);
  }
  return {
    ...view,
    omitted: view.omitted + (view.items.length - kept.length),
    items: kept,
  };
}
