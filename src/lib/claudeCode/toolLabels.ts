// How a tool call reads in the Agent panel. The model sees tool names; a person
// watching the canvas wants to know what just happened to it.

import { clipText } from '@/lib/clipText';
import { folderNameOf, folderRelativePath } from './folders';
import type { AgentFolder } from './types';

type ToolStatus = 'running' | 'done' | 'error';

interface ToolLabel {
  /** While it runs, ending in "...". */
  running: string;
  /** Once it is done. */
  done: string;
  /** When it failed, for the tools where "done" would say it worked. */
  error?: string;
}

const LABELS: Record<string, ToolLabel> = {
  Skill: { running: 'Reading the design guide...', done: 'Read the design guide' },
  // Claude Code's own file tools, which it has only while a code folder is
  // attached to the chat.
  Read: { running: 'Reading a file...', done: 'Read a file', error: 'Could not read a file' },
  Grep: { running: 'Searching your files...', done: 'Searched your files', error: 'Could not search your files' },
  import_project_image: { running: 'Importing an image...', done: 'Imported an image' },
  list_artboards: { running: 'Looking at the artboards...', done: 'Looked at the artboards' },
  get_artboard: { running: 'Reading an artboard...', done: 'Read an artboard' },
  create_artboard: { running: 'Adding an artboard...', done: 'Added an artboard' },
  set_active_artboard: { running: 'Switching artboard...', done: 'Switched artboard' },
  update_artboard: { running: 'Changing an artboard...', done: 'Changed an artboard' },
  delete_artboard: { running: 'Deleting an artboard...', done: 'Deleted an artboard' },
  duplicate_artboard: { running: 'Duplicating an artboard...', done: 'Duplicated an artboard' },
  set_background: { running: 'Changing the background...', done: 'Changed the background' },
  add_element: { running: 'Adding an element...', done: 'Added an element' },
  add_elements: { running: 'Adding elements...', done: 'Added elements' },
  update_element: { running: 'Editing an element...', done: 'Edited an element' },
  delete_element: { running: 'Deleting an element...', done: 'Deleted an element' },
  reorder_element: { running: 'Reordering layers...', done: 'Reordered layers' },
  measure_element: { running: 'Measuring an element...', done: 'Measured an element' },
  group_elements: { running: 'Grouping elements...', done: 'Grouped elements' },
  transform_elements: { running: 'Moving elements...', done: 'Moved elements' },
  align_elements: { running: 'Aligning elements...', done: 'Aligned elements' },
  distribute_elements: { running: 'Spacing elements...', done: 'Spaced elements' },
  list_library: { running: 'Browsing the library...', done: 'Browsed the library' },
  list_fonts: { running: 'Checking fonts...', done: 'Checked fonts' },
  upload_asset: { running: 'Storing an image...', done: 'Stored an image' },
  list_assets: { running: 'Listing images...', done: 'Listed images' },
  delete_asset: { running: 'Deleting an image...', done: 'Deleted an image' },
  list_templates: { running: 'Browsing templates...', done: 'Browsed templates' },
  get_template: { running: 'Opening a template...', done: 'Looked at a template' },
  apply_template: { running: 'Applying a template...', done: 'Applied a template' },
  create_project_from_template: { running: 'Creating a project...', done: 'Created a project' },
  list_projects: { running: 'Listing projects...', done: 'Listed projects' },
  open_project: { running: 'Opening a project...', done: 'Opened a project' },
  rename_project: { running: 'Renaming the project...', done: 'Renamed the project' },
  export_png: { running: 'Looking at the result...', done: 'Looked at the result' },
  export_all: { running: 'Exporting every artboard...', done: 'Exported every artboard' },
  list_preview_scenes: { running: 'Browsing preview scenes...', done: 'Browsed preview scenes' },
  add_preview_scene: { running: 'Adding a preview scene...', done: 'Added a preview scene' },
  set_animation: { running: 'Setting an animation...', done: 'Set an animation' },
  set_preview_duration: { running: 'Setting the video length...', done: 'Set the video length' },
  get_preview_timeline: { running: 'Reading the timeline...', done: 'Read the timeline' },
  upload_recording: { running: 'Storing a recording...', done: 'Stored a recording' },
  list_recordings: { running: 'Listing recordings...', done: 'Listed recordings' },
  list_locales: { running: 'Checking languages...', done: 'Checked languages' },
  set_locale: { running: 'Switching language...', done: 'Switched language' },
  set_localized_text: { running: 'Writing a translation...', done: 'Wrote a translation' },
  list_supported_locales: { running: 'Looking up languages...', done: 'Looked up languages' },
  add_locales: { running: 'Adding languages...', done: 'Added languages' },
  remove_locales: { running: 'Removing languages...', done: 'Removed languages' },
  set_base_locale: { running: 'Setting the base language...', done: 'Set the base language' },
  list_translations: { running: 'Reading translations...', done: 'Read translations' },
  set_localized_texts: { running: 'Writing translations...', done: 'Wrote translations' },
  translate_locales: { running: 'Translating...', done: 'Translated' },
  export_translations_csv: { running: 'Exporting translations...', done: 'Exported translations' },
  import_translations_csv: { running: 'Importing translations...', done: 'Imported translations' },
  set_locale_override: { running: 'Changing one language...', done: 'Changed one language' },
  reset_locale_overrides: { running: 'Resetting a language...', done: 'Reset a language' },
};

function fallback(name: string): ToolLabel {
  const words = name.replace(/[_-]+/g, ' ').trim();
  const phrase = words.charAt(0).toUpperCase() + words.slice(1);
  return { running: `${phrase}...`, done: phrase };
}

/**
 * How Claude Code answers a read its permission settings refuse: a Read of a
 * denied file, or a Grep pointed at one. Reads outside the folders are refused
 * in other words ("don't ask mode") and stay errors.
 */
const DENIED_BY_SETTINGS = /denied by your permission settings|permission to read .+ has been denied/i;

/**
 * A failed call that did what it should: the settings Rust starts Claude Code
 * with keep secrets (.env, signing keys), lock files, dependency and build
 * folders and Claude Code's own folder out of reach, and the agent sometimes
 * tries one anyway. Its row says "Skipped a blocked file", which is true of
 * all of them, and gets a neutral icon rather than the error one.
 */
export function toolSkipped(name: string, status: ToolStatus, result?: string): boolean {
  return status === 'error' && (name === 'Read' || name === 'Grep') && !!result && DENIED_BY_SETTINGS.test(result);
}

/** The row's words. Pass the result too: a failed file read reads differently from one that worked. */
export function toolLabel(name: string, status: ToolStatus, result?: string): string {
  const label = LABELS[name] ?? fallback(name);
  if (status === 'running') return label.running;
  if (status === 'error') {
    if (toolSkipped(name, status, result)) return 'Skipped a blocked file';
    return label.error ?? label.done;
  }
  return label.done;
}

/** The alt text of a picture on a tool row. */
export function toolImageAlt(name: string, input: Record<string, unknown>): string {
  if (name === 'Read' || name === 'import_project_image') {
    const path = typeof input.file_path === 'string' ? input.file_path : typeof input.path === 'string' ? input.path : '';
    if (path.trim()) return `${clipText(folderNameOf(path), 60)} from your folder`;
  }
  return 'The artboard as the agent saw it';
}

function clip(text: string, max: number): string {
  return clipText(text.replace(/\s+/g, ' ').trim(), max);
}

/** The end of `text` in `max` characters, since the end of a path is the telling part. */
function clipLeft(text: string, max: number): string {
  if (text.length <= max) return text;
  let start = text.length - (max - 3);
  // Never the second half of an emoji: Rust refuses a lone surrogate.
  const first = text.charCodeAt(start);
  if (first >= 0xdc00 && first <= 0xdfff) start += 1;
  return `...${text.slice(start)}`;
}

/** A file the agent opened, from its code folder on when it is in one. */
function pathDetail(path: string, folders: readonly AgentFolder[]): string {
  const shown = folderRelativePath(path, folders) ?? path.replace(/\\/g, '/');
  return clipLeft(shown.replace(/\s+/g, ' ').trim(), 48);
}

/**
 * One short line about what a call was given, when there is something a
 * person would recognise: the words written, a template, a name, a file.
 * `folders` are the chat's code folders, which a file path is shown relative to.
 */
export function toolDetail(
  name: string,
  input: Record<string, unknown>,
  folders: readonly AgentFolder[] = []
): string | null {
  const str = (key: string) => (typeof input[key] === 'string' ? (input[key] as string) : null);
  if (name === 'Skill') return null;
  if (name === 'Read') return str('file_path')?.trim() ? pathDetail(str('file_path')!, folders) : null;
  if (name === 'import_project_image') return str('path')?.trim() ? pathDetail(str('path')!, folders) : null;
  if (name === 'Grep') return str('pattern') ? `"${clip(str('pattern')!, 40)}"` : null;
  if (typeof input.content === 'string' && input.content.trim()) return `"${clip(input.content, 60)}"`;
  if (name === 'apply_template' || name === 'get_template' || name === 'create_project_from_template') {
    return str('templateId') ? clip(str('templateId')!.replace(/^template_/, ''), 48) : null;
  }
  if (name === 'add_elements' && Array.isArray(input.elements)) {
    return `${input.elements.length} element${input.elements.length === 1 ? '' : 's'}`;
  }
  if (name === 'set_localized_texts' && Array.isArray(input.writes)) {
    return `${input.writes.length} text${input.writes.length === 1 ? '' : 's'}`;
  }
  if ((name === 'add_locales' || name === 'remove_locales' || name === 'translate_locales') && Array.isArray(input.locales)) {
    return clip(input.locales.join(', '), 48);
  }
  if (name === 'set_locale' && str('locale')) return str('locale');
  if (name === 'export_png' && typeof input.scale === 'number') return `${Math.round(input.scale * 100)}%`;
  if (name === 'set_background') {
    if (str('backgroundColor')) return str('backgroundColor');
    if (input.gradient) return 'gradient';
  }
  if (str('name')) return clip(str('name')!, 48);
  if (str('query')) return `"${clip(str('query')!, 40)}"`;
  if (str('libraryId')) return clip(str('libraryId')!, 48);
  return null;
}
