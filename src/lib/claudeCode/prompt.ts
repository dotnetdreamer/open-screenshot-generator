// What the app writes to Claude Code's stdin: user turns and the interrupt
// request, one JSON object per line, plus the text that goes around the
// user's own words.

import { clipText } from '@/lib/clipText';
import type { AgentEditorContext, AgentImage } from './types';

type ContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } };

/**
 * One user turn as a stream-json line.
 *
 * `session_id` is blank on purpose: the CLI files the turn under whatever
 * conversation it is running, and a stale id makes it drop the message with no
 * error anywhere (claude-openai-endpoint/src/claude.js found this out first).
 */
export function encodeUserMessage(text: string, images: AgentImage[] = []): string {
  const content: ContentBlock[] = [
    { type: 'text', text },
    ...images.map((image) => ({
      type: 'image' as const,
      source: { type: 'base64' as const, media_type: image.mediaType, data: image.data },
    })),
  ];
  return JSON.stringify({
    type: 'user',
    message: { role: 'user', content },
    parent_tool_use_id: null,
    session_id: '',
  });
}

/**
 * Ask Claude Code to abandon the turn it is on. The process answers with a
 * control_response, ends the turn with a `result` whose terminal_reason is
 * "aborted_streaming", and stays up for the next message.
 */
export function encodeInterrupt(requestId: string): string {
  return JSON.stringify({ type: 'control_request', request_id: requestId, request: { subtype: 'interrupt' } });
}

const MAX_CONTEXT_ARTBOARDS = 30;
const MAX_CONTEXT_SELECTION = 10;
const MAX_SELECTION_TEXT = 160;

/**
 * The block every message starts with: what is open and what is selected, so
 * "make this bigger" can find its "this". JSON, because the agent reads ids out
 * of it and passes them straight to the tools.
 */
export function editorContextBlock(context: AgentEditorContext): string {
  const payload = {
    project: context.projectId ? { id: context.projectId, name: context.projectName ?? '' } : null,
    artboards: context.artboards.slice(0, MAX_CONTEXT_ARTBOARDS).map((board) => ({
      id: board.id,
      name: board.name,
      width: board.width,
      height: board.height,
      ...(board.id === context.activeArtboardId ? { active: true } : {}),
    })),
    ...(context.artboards.length > MAX_CONTEXT_ARTBOARDS
      ? { moreArtboards: context.artboards.length - MAX_CONTEXT_ARTBOARDS }
      : {}),
    selection: context.selection.slice(0, MAX_CONTEXT_SELECTION).map((element) => ({
      id: element.id,
      type: element.type,
      ...(element.name ? { name: element.name } : {}),
      // Whole characters only: this line reaches Rust as JSON, which refuses
      // half an emoji.
      ...(element.text ? { text: clipText(element.text, MAX_SELECTION_TEXT) } : {}),
    })),
    language: context.activeLocale,
  };
  return `<editor-context>\n${JSON.stringify(payload)}\n</editor-context>`;
}

/** The whole text of a turn: context, then anything the app adds, then the user's words. */
export function composeTurnText(parts: {
  context: AgentEditorContext | null;
  preface?: string;
  text: string;
}): string {
  return [parts.context ? editorContextBlock(parts.context) : null, parts.preface?.trim() || null, parts.text.trim()]
    .filter((part): part is string => !!part)
    .join('\n\n');
}

/** A screenshot the app stored before the first turn, so the agent can place it by reference. */
export interface BriefScreenshot {
  ref: string;
  width: number;
  height: number;
  fileName: string;
}

/**
 * What the first turn of a new design says on top of the user's instruction:
 * which project was just made for it, and where the user's screenshots are.
 * The pictures themselves travel as image blocks in the same message.
 */
export function buildFirstRunBrief(args: {
  projectName: string;
  /** The name is a stand-in because the instruction did not name the app. */
  placeholderName?: boolean;
  artboard: { id: string; width: number; height: number } | null;
  screenshots: BriefScreenshot[];
}): string {
  const lines: string[] = [];
  const board = args.artboard ? ` with one blank artboard (id ${args.artboard.id}, ${args.artboard.width}x${args.artboard.height})` : '';
  lines.push(
    `This chat was started from the new project dialog. A new, empty project named "${args.projectName}" is open${board}. Build the design in this project. Use apply_template if a template fits, so the result stays in this project.`
  );
  if (args.placeholderName) {
    lines.push(
      'That name is a placeholder. Once you know what the app is called, rename the project after it (for example "Droply screenshots"): pass projectName to apply_template when you use one, or call rename_project.'
    );
  }
  if (args.screenshots.length) {
    lines.push('');
    lines.push(
      `The user uploaded ${args.screenshots.length} screenshot${args.screenshots.length === 1 ? '' : 's'}, attached below as images in this order. They are already stored in the app: put them into device frames with these references and never paste image data into a tool call.`
    );
    args.screenshots.forEach((shot, index) => {
      lines.push(`${index}. ${shot.ref} (${shot.width}x${shot.height}, ${shot.fileName})`);
    });
  } else {
    lines.push('');
    lines.push('No screenshots were uploaded. Keep the device frames the templates come with, and say so in your reply.');
  }
  return lines.join('\n');
}

/** Screenshots attached to a later message from the Agent panel. */
export function buildAttachmentNote(screenshots: BriefScreenshot[]): string {
  if (!screenshots.length) return '';
  const lines = [
    `The user attached ${screenshots.length} image${screenshots.length === 1 ? '' : 's'} to this message, shown below in this order and already stored in the app. Use these references in tool calls:`,
  ];
  screenshots.forEach((shot, index) => {
    lines.push(`${index}. ${shot.ref} (${shot.width}x${shot.height}, ${shot.fileName})`);
  });
  return lines.join('\n');
}
