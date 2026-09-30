// How a tool call reads in the Agent panel. The model sees tool names; a person
// watching the canvas wants to know what just happened to it.

import { clipText } from '@/lib/clipText';

interface ToolLabel {
  /** While it runs, ending in "...". */
  running: string;
  /** Once it is done. */
  done: string;
}

const LABELS: Record<string, ToolLabel> = {
  Skill: { running: 'Reading the design guide...', done: 'Read the design guide' },
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

export function toolLabel(name: string, status: 'running' | 'done' | 'error'): string {
  const label = LABELS[name] ?? fallback(name);
  if (status === 'running') return label.running;
  return label.done;
}

function clip(text: string, max: number): string {
  return clipText(text.replace(/\s+/g, ' ').trim(), max);
}

/**
 * One short line about what a call was given, when there is something a
 * person would recognise: the words written, a template, a name.
 */
export function toolDetail(name: string, input: Record<string, unknown>): string | null {
  const str = (key: string) => (typeof input[key] === 'string' ? (input[key] as string) : null);
  if (name === 'Skill') return null;
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
