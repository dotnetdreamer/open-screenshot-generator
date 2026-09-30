// What the editor tells the agent with every message, and the short label the
// Agent panel shows for the same thing ("About Track every drop").

import type { ArtboardElement, ArtboardState } from '@/types/artboard';
import { clipText } from '@/lib/clipText';
import type { AgentEditorContext } from './types';

interface EditorState {
  projectId: string | null;
  projectName: string | null;
  artboards: ArtboardState[];
  activeArtboardId: string | null;
  selectedElementIds: string[];
  activeLocale: string | null;
}

function selectedElements(state: EditorState): ArtboardElement[] {
  const board = state.artboards.find((artboard) => artboard.id === state.activeArtboardId);
  if (!board || !state.selectedElementIds.length) return [];
  const byId = new Map(board.elements.map((element) => [element.id, element]));
  return state.selectedElementIds
    .map((id) => byId.get(id))
    .filter((element): element is ArtboardElement => !!element);
}

function elementName(element: ArtboardElement): string | undefined {
  const name = (element as { name?: unknown }).name;
  return typeof name === 'string' && name.trim() ? name.trim() : undefined;
}

function elementText(element: ArtboardElement): string | undefined {
  if (element.type !== 'text') return undefined;
  const content = (element as { content?: unknown }).content;
  return typeof content === 'string' && content.trim() ? content.trim() : undefined;
}

export function buildAgentContext(state: EditorState): AgentEditorContext {
  return {
    projectId: state.projectId,
    projectName: state.projectName,
    artboards: state.artboards.map((artboard) => ({
      id: artboard.id,
      name: artboard.name,
      width: artboard.size?.width ?? 0,
      height: artboard.size?.height ?? 0,
    })),
    activeArtboardId: state.activeArtboardId,
    selection: selectedElements(state).map((element) => ({
      id: element.id,
      type: element.type,
      name: elementName(element),
      text: elementText(element),
    })),
    activeLocale: state.activeLocale,
  };
}

function clip(text: string, max: number): string {
  return clipText(text.replace(/\s+/g, ' '), max);
}

/** The selection in a few words, or the artboard when nothing is selected. */
export function agentContextLabel(state: EditorState): string | null {
  const selection = selectedElements(state);
  if (selection.length > 1) return `${selection.length} layers`;
  if (selection.length === 1) {
    const element = selection[0];
    const text = elementText(element);
    if (text) return `"${clip(text, 32)}"`;
    return elementName(element) ?? `the ${element.type}`;
  }
  const board = state.artboards.find((artboard) => artboard.id === state.activeArtboardId);
  return board?.name ? clip(board.name, 32) : null;
}
