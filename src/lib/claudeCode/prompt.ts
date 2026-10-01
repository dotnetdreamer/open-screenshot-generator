// What the app writes to Claude Code's stdin: user turns and the interrupt
// request, one JSON object per line, plus the text that goes around the
// user's own words.

import { clipText } from '@/lib/clipText';
import { folderLabels } from './folders';
import type { AgentEditorContext, AgentFolder, AgentImage } from './types';

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

/**
 * A slash after the whitespace Rust skips before it looks: char::is_whitespace,
 * which counts U+0085 where JavaScript's \s does not, and U+FEFF. A narrower
 * set here would send a line Rust refuses.
 */
const LEADING_SLASH = /^[\s\u0085\uFEFF]*\//;

/**
 * The whole text of a turn: context, then anything the app adds, then the
 * user's words.
 *
 * Never one that starts with "/": Claude Code runs such a message as a slash
 * command (`/config` rewrites the user's own ~/.claude/settings.json), so Rust
 * refuses the line. A turn that is nothing but the user's "/..." goes to the
 * model as words instead.
 */
export function composeTurnText(parts: {
  context: AgentEditorContext | null;
  preface?: string;
  text: string;
}): string {
  const text = [parts.context ? editorContextBlock(parts.context) : null, parts.preface?.trim() || null, parts.text.trim()]
    .filter((part): part is string => !!part)
    .join('\n\n');
  return LEADING_SLASH.test(text) ? `The user wrote: ${text}` : text;
}

/** A screenshot the app stored before the first turn, so the agent can place it by reference. */
export interface BriefScreenshot {
  ref: string;
  width: number;
  height: number;
  fileName: string;
}

/**
 * What the first message says when the user wrote nothing. The chat shows it
 * as theirs, so it names what they gave: screenshots, their code folder, or
 * both.
 */
export function defaultStartText(given: { screenshots: number; folders: number }): string {
  if (given.folders > 0) {
    return given.screenshots > 0
      ? 'Design store screenshots for my app from these screenshots and its code folder'
      : 'Design store screenshots for my app from its code folder';
  }
  return 'Design store screenshots for my app from these screenshots';
}

/**
 * What the first turn of a new design says on top of the user's instruction:
 * which project was just made for it, where the user's screenshots are, and
 * whether their app's code came with it. The pictures themselves travel as
 * image blocks in the same message; the folders' paths are in the system
 * prompt, which Rust writes for a process started with them.
 */
export function buildFirstRunBrief(args: {
  projectName: string;
  /** The name is a stand-in because the instruction did not name the app. */
  placeholderName?: boolean;
  artboard: { id: string; width: number; height: number } | null;
  screenshots: BriefScreenshot[];
  /** The code folders the process was started with, as Rust granted them. */
  folders?: AgentFolder[];
}): string {
  const folders = args.folders ?? [];
  const several = folders.length > 1;
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
  } else if (folders.length) {
    lines.push('');
    lines.push(
      `No screenshots were uploaded, but the user's app ${several ? 'folders are' : 'folder is'} attached. Look there for real screenshots first (fastlane/screenshots/<language>, fastlane/metadata/android/<language>/images/phoneScreenshots, a screenshots or store folder, images the README shows) and put the plain screens in the device frames with import_project_image, never finished store images that already have a frame or caption. If there are none, keep the device frames the templates come with, and say so in your reply.`
    );
  } else {
    lines.push('');
    lines.push('No screenshots were uploaded. Keep the device frames the templates come with, and say so in your reply.');
  }
  if (folders.length) {
    // Whole characters only: this line reaches Rust as JSON.
    const names = folderLabels(folders).map((name) => clipText(name, 80)).join(', ');
    lines.push('');
    lines.push(
      several
        ? `The user also attached their app folders (${names}). Your instructions list them; read them before you build.`
        : `The user also attached their app folder (${names}). Your instructions list it; read it before you build.`
    );
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
