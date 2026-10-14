// What the Agent panel renders, in one serialisable object.
//
// The editor builds it from the live store and hands it to the docked panel at
// full fidelity. A detached panel window gets the same shape put through
// slimAgentView first (rule 30 in AGENTS.md): only the latest items, no tool
// arguments, no pictures, so a long chat never outgrows the dock bus.

import type { ClaudeAgentSnapshot } from './store';
import { clipText } from '@/lib/clipText';
import type { CodexDetection, CodexEffortChoice, CodexModelChoice } from '@/lib/codex/types';
import { chatListItems, type AgentChatListItem } from './chats';
import { MAX_FOLDER_PATH, folderLabels } from './folders';
import type {
  AgentContextUsage,
  AgentDetectionState,
  AgentItem,
  AgentKind,
  AgentLastTurn,
  AgentRateLimit,
  AgentStatus,
  ClaudeEffortChoice,
  ClaudeModelChoice,
} from './types';

export interface AgentPanelView {
  /** This build can run the agent (the desktop app). */
  available: boolean;
  /** Which CLI the chat talks to. */
  agent: AgentKind;
  /** Nothing has been sent in the chat yet, so it can still switch to the other CLI. */
  agentSwitchable: boolean;
  /** Claude Code's detection. */
  detection: AgentDetectionState;
  /** Codex's, for a Codex chat's setup card and account line. */
  codexDetection: AgentDetectionState<CodexDetection>;
  status: AgentStatus;
  model: ClaudeModelChoice;
  /** The effort picked for the next Claude Code process. Claude Code never reports it back. */
  effort: ClaudeEffortChoice;
  /** The model the next Codex turn asks for. */
  codexModel: CodexModelChoice;
  codexEffort: CodexEffortChoice;
  /** What the Codex model menu offers: its default, then the models its detection listed. */
  codexModels: AgentPanelModel[];
  /** The model the CLI reported, once a turn has started. */
  resolvedModel: string | null;
  items: AgentItem[];
  /** Earlier items this view leaves out. */
  omitted: number;
  toolsConnected: boolean | null;
  billedToApiKey: boolean;
  rateLimit: AgentRateLimit | null;
  lastTurn: AgentLastTurn | null;
  turnStartedAt: number | null;
  /** How full the context window is, for the ring beside Send. Null until there is a reading. */
  context: AgentContextUsage | null;
  /** Whether there is a conversation to carry on, even with no process running. */
  resumable: boolean;
  /** What the next message is about, for the chip above the input: "Headline". */
  contextLabel: string | null;
  /** Past chats, newest first, the one on screen marked. */
  chats: AgentChatListItem[];
  /** The project open in the editor, which Past chats lists first. */
  projectId: string | null;
  /** The chat's code folders, in the order they were added. At most 3. */
  folders: AgentPanelFolder[];
  /** The folder dialog is open: the add button shows it is busy and ignores clicks, in every window. */
  folderPicking: boolean;
  /** Why the last folder was not added (a refusal, the cap), for the composer's error line. */
  folderNotice: string | null;
  /** The running agent can read code folders. */
  foldersLive: boolean;
  /** A folder was added that the agent was not started with, so Send works with an empty box. */
  foldersPending: boolean;
  /**
   * Links in replies show as text, not as links: the agent can read a code
   * folder now, or this chat's agent once could. The conversation keeps what
   * it read, so this lasts as long as the chat does.
   */
  linksAsText: boolean;
}

/** One entry of the Codex model menu. */
export interface AgentPanelModel {
  /** 'default', or what turn/start takes. */
  value: string;
  label: string;
  /** The effort levels it takes. Empty when nobody knows, which offers them all. */
  efforts: string[];
}

/** The Codex model menu: Codex's own default first, then each model its login has. */
export function codexModelChoices(detection: CodexDetection | null): AgentPanelModel[] {
  const models = detection?.models ?? [];
  const fallback = models.find((model) => model.isDefault);
  return [
    { value: 'default', label: "Codex's default model", efforts: fallback?.efforts ?? [] },
    ...models.map((model) => ({ value: model.id, label: model.displayName || model.id, efforts: model.efforts })),
  ];
}

/** A code folder as the panel shows it. */
export interface AgentPanelFolder {
  name: string;
  /** What the remove intent sends back. Never cut, so it still matches. */
  path: string;
  /** What the chip says: the name, or "parent/name" when two folders share a name. */
  label: string;
}

/** A picture the user attached in the panel, already stored as an asset. */
export interface AgentAttachment {
  ref: string;
  width: number;
  height: number;
  fileName: string;
}

export function toAgentPanelView(
  agent: ClaudeAgentSnapshot,
  contextLabel: string | null,
  project: { projectId: string | null; nameOf?: (projectId: string) => string | null } = { projectId: null }
): AgentPanelView {
  const { session } = agent;
  const labels = folderLabels(agent.chat.folders);
  return {
    available: agent.available,
    agent: agent.chat.agent,
    agentSwitchable:
      session.items.length === 0 && !session.sessionId && session.status !== 'working' && session.status !== 'starting',
    detection: agent.detection,
    codexDetection: agent.codexDetection,
    status: session.status,
    model: agent.model,
    effort: agent.effort,
    codexModel: agent.codexModel,
    codexEffort: agent.codexEffort,
    codexModels: codexModelChoices(agent.codexDetection.result),
    resolvedModel: session.model,
    items: session.items,
    omitted: 0,
    toolsConnected: session.toolsConnected,
    billedToApiKey: session.billedToApiKey,
    rateLimit: session.rateLimit,
    lastTurn: session.lastTurn,
    turnStartedAt: session.turnStartedAt,
    context: session.context,
    resumable: !!session.sessionId,
    contextLabel,
    chats: chatListItems(agent.chats, agent.chat.id, project.nameOf),
    projectId: project.projectId,
    folders: agent.chat.folders.map((folder, index) => ({ name: folder.name, path: folder.path, label: labels[index] })),
    folderPicking: agent.folderPicking,
    folderNotice: agent.folderNotice,
    foldersLive: agent.foldersLive,
    foldersPending: agent.foldersPending,
    linksAsText: agent.foldersLive || agent.chat.readFolders,
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
/** Past chats a detached window lists. About 150 bytes each, on top of the budget above. */
const WIRE_CHATS = 30;

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
    chats: view.chats.slice(0, WIRE_CHATS).map((chat) => ({
      ...chat,
      title: clipText(chat.title, 60),
      projectName: chat.projectName === null ? null : clipText(chat.projectName, 40),
    })),
    // Three at most. A path is cut only at the length Rust refuses anyway,
    // because the remove intent has to send it back whole.
    folders: view.folders.map((folder) => ({
      name: clipText(folder.name, 80),
      path: clipText(folder.path, MAX_FOLDER_PATH),
      label: clipText(folder.label, 80),
    })),
    folderNotice: view.folderNotice === null ? null : clipText(view.folderNotice, 200),
    // codexModels carries what the menu needs of the list.
    codexDetection: view.codexDetection.result
      ? { ...view.codexDetection, result: { ...view.codexDetection.result, models: [] } }
      : view.codexDetection,
    codexModels: view.codexModels
      .slice(0, 21)
      .map((model) => ({ value: model.value, label: clipText(model.label, 60), efforts: model.efforts.slice(0, 8) })),
  };
}
