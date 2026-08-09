import type { ArtboardElement, ArtboardState } from '@/types/artboard';

// Photoshop-style history states. The editor only ever hands the undo stack a
// full project snapshot (see handleArtboardsUpdate), so the name of a state is
// recovered by diffing the new snapshot against the previous one rather than
// threading a label through the ~30 call sites. Callers that know better can
// still pass an explicit label.

/** Icon key for a history row. HistoryPanel maps these to lucide icons. */
export type HistoryIcon =
  | 'open'
  | 'add'
  | 'delete'
  | 'move'
  | 'resize'
  | 'rotate'
  | 'text'
  | 'color'
  | 'order'
  | 'artboard'
  | 'image'
  | 'device'
  | 'edit'
  | 'copy'
  | 'translate';

export interface HistoryChange {
  /** Command name, e.g. "Move" or "Add Text". */
  label: string;
  icon: HistoryIcon;
  /** Layer or artboard the change landed on, shown muted next to the label. */
  detail?: string;
  /**
   * Identifies a run of continuous tweaks: an opacity slider fires one update
   * per pixel dragged. Consecutive pushes that share a key inside the merge
   * window collapse into one row, the way one brush stroke is one Photoshop
   * state. null never merges.
   */
  mergeKey: string | null;
}

export interface HistoryEntry extends HistoryChange {
  id: string;
  timestamp: number;
  /** Full project snapshot this state restores. */
  artboards: ArtboardState[];
}

/** Consecutive same-key pushes closer than this collapse into one state. */
export const HISTORY_MERGE_WINDOW_MS = 900;

/**
 * How many states to keep. Every state is a deep copy of the whole project,
 * screenshots included, so this is a memory ceiling as much as a UI one
 * (Photoshop defaults to 50).
 */
export const HISTORY_LIMIT = 100;

/**
 * Name for a layer, preferring the user's own. Shared with the layers list so
 * a layer reads the same in both panels.
 */
export function getElementDisplayName(element: ArtboardElement, maxLength = 20): string {
  if (element.name && element.name.trim()) return element.name;

  const truncate = (value: string) =>
    value.length > maxLength ? `${value.substring(0, maxLength)}...` : value;

  switch (element.type) {
    case 'text':
      return element.content ? truncate(element.content) : 'Text';
    case 'image':
      return element.imageAlt ? truncate(element.imageAlt) : 'Image';
    case 'shape':
      return `${capitalize(element.shapeType)} Shape`;
    case 'device':
      return `${capitalize(element.deviceType)} Device`;
    case 'video-device':
      return `${capitalize(element.deviceType)} Recording`;
    case 'video':
      return 'Recording';
    case 'gesture':
      return `${capitalize(element.gestureType)} Hint`;
    default:
      return capitalize((element as ArtboardElement).type);
  }
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function isEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  // An absent key and an explicit undefined mean the same thing here, so a
  // spread that drops a property is not reported as a change.
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

function changedKeys(
  before: Record<string, any> | undefined,
  after: Record<string, any> | undefined,
  ignore?: Set<string>
): string[] {
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);
  const changed: string[] = [];
  for (const key of keys) {
    if (ignore?.has(key)) continue;
    if (!isEqual(before?.[key], after?.[key])) changed.push(key);
  }
  return changed;
}

// First rule whose keys intersect the changed set wins, so the order is the
// precedence order: a corner-handle resize also nudges position, and should
// read as "Resize", not "Move".
const ELEMENT_RULES: Array<{ keys: string[]; label: string; icon: HistoryIcon }> = [
  { keys: ['content'], label: 'Edit Text', icon: 'text' },
  { keys: ['deviceType'], label: 'Change Device', icon: 'device' },
  { keys: ['shapeType'], label: 'Change Shape', icon: 'edit' },
  { keys: ['gestureType'], label: 'Change Gesture', icon: 'edit' },
  { keys: ['screenshotSrc', 'naturalScreenshotWidth', 'naturalScreenshotHeight'], label: 'Replace Screenshot', icon: 'image' },
  { keys: ['imageSrc'], label: 'Replace Image', icon: 'image' },
  { keys: ['mediaId', 'videoSrc', 'posterSrc'], label: 'Replace Recording', icon: 'image' },
  { keys: ['customFrameSrc'], label: 'Replace Mockup', icon: 'image' },
  { keys: ['name'], label: 'Rename Layer', icon: 'edit' },
  { keys: ['size', 'scale'], label: 'Resize', icon: 'resize' },
  { keys: ['rotation'], label: 'Rotate', icon: 'rotate' },
  { keys: ['position'], label: 'Move', icon: 'move' },
  {
    keys: ['fontSize', 'fontFamily', 'fontWeight', 'fontStyle', 'textDecoration', 'textAlign', 'lineHeight', 'letterSpacing'],
    label: 'Text Style',
    icon: 'text',
  },
  { keys: ['color', 'fillColor', 'strokeColor', 'fillGradient'], label: 'Color', icon: 'color' },
  { keys: ['frameColor', 'frameColor3d', 'notchColor', 'frameOpacity', 'frameStyle'], label: 'Device Color', icon: 'color' },
  { keys: ['styleType', 'pose3d', 'matrix3d', 'skewX', 'skewY', 'perspectiveX', 'perspectiveY'], label: 'Transform', icon: 'rotate' },
  { keys: ['opacity', 'fillOpacity'], label: 'Opacity', icon: 'color' },
  { keys: ['shadow'], label: 'Shadow', icon: 'color' },
  { keys: ['blur'], label: 'Blur', icon: 'color' },
  { keys: ['strokeWidth'], label: 'Stroke', icon: 'edit' },
  {
    keys: ['borderRadius', 'borderRadiusType', 'borderRadiusTopLeft', 'borderRadiusTopRight', 'borderRadiusBottomRight', 'borderRadiusBottomLeft', 'innerRadius'],
    label: 'Corner Radius',
    icon: 'edit',
  },
  { keys: ['objectFit', 'screenshotObjectFit', 'screenshotRect'], label: 'Screen Fit', icon: 'resize' },
  { keys: ['trimStart', 'trimEnd'], label: 'Trim Recording', icon: 'edit' },
  { keys: ['triggerTime', 'gestureDuration', 'gestureRepeat'], label: 'Gesture Timing', icon: 'edit' },
  { keys: ['animation'], label: 'Animation', icon: 'edit' },
  { keys: ['groupId'], label: 'Group', icon: 'edit' },
];

const ARTBOARD_RULES: Array<{ keys: string[]; label: string; icon: HistoryIcon }> = [
  { keys: ['backgroundColor', 'backgroundType', 'backgroundGradient'], label: 'Artboard Background', icon: 'color' },
  { keys: ['size'], label: 'Canvas Size', icon: 'resize' },
  { keys: ['name'], label: 'Rename Artboard', icon: 'edit' },
  { keys: ['language'], label: 'Translate', icon: 'translate' },
  { keys: ['zoom'], label: 'Artboard Zoom', icon: 'resize' },
  { keys: ['exportScale'], label: 'Export Scale', icon: 'edit' },
];

// Derived every update from the artboard order, so it never signals an edit.
const ARTBOARD_IGNORED = new Set(['position', 'elements']);

function matchRule(
  rules: Array<{ keys: string[]; label: string; icon: HistoryIcon }>,
  changed: string[]
): { label: string; icon: HistoryIcon } {
  const set = new Set(changed);
  for (const rule of rules) {
    if (rule.keys.some((key) => set.has(key))) return { label: rule.label, icon: rule.icon };
  }
  return { label: 'Edit', icon: 'edit' };
}

function describeBoardChange(before: ArtboardState, after: ArtboardState): HistoryChange | null {
  const beforeElements = before.elements ?? [];
  const afterElements = after.elements ?? [];
  const beforeIds = beforeElements.map((el) => el.id);
  const afterIds = afterElements.map((el) => el.id);

  const added = afterElements.filter((el) => !beforeIds.includes(el.id));
  if (added.length === 1) {
    return { label: 'Add Layer', icon: 'add', detail: getElementDisplayName(added[0]), mergeKey: null };
  }
  if (added.length > 1) {
    return { label: `Add ${added.length} Layers`, icon: 'add', detail: after.name, mergeKey: null };
  }

  const removed = beforeElements.filter((el) => !afterIds.includes(el.id));
  if (removed.length === 1) {
    return { label: 'Delete Layer', icon: 'delete', detail: getElementDisplayName(removed[0]), mergeKey: null };
  }
  if (removed.length > 1) {
    return { label: `Delete ${removed.length} Layers`, icon: 'delete', detail: after.name, mergeKey: null };
  }

  if (beforeIds.join('|') !== afterIds.join('|')) {
    return { label: 'Reorder Layers', icon: 'order', detail: after.name, mergeKey: null };
  }

  const beforeById = new Map(beforeElements.map((el) => [el.id, el]));
  const touched: Array<{ element: ArtboardElement; keys: string[] }> = [];
  for (const element of afterElements) {
    const keys = changedKeys(beforeById.get(element.id), element);
    if (keys.length > 0) touched.push({ element, keys });
  }

  if (touched.length > 0) {
    const allKeys = touched.flatMap((entry) => entry.keys);
    const { label, icon } = matchRule(ELEMENT_RULES, allKeys);
    const ids = touched.map((entry) => entry.element.id).sort().join(',');
    return {
      label,
      icon,
      detail:
        touched.length === 1
          ? getElementDisplayName(touched[0].element)
          : `${touched.length} layers`,
      mergeKey: `${label}:${ids}`,
    };
  }

  const boardKeys = changedKeys(before, after, ARTBOARD_IGNORED);
  if (boardKeys.length > 0) {
    const { label, icon } = matchRule(ARTBOARD_RULES, boardKeys);
    return { label, icon, detail: after.name, mergeKey: `${label}:${after.id}` };
  }

  return null;
}

/**
 * Name the change between two project snapshots, Photoshop-history style.
 * Returns null when nothing meaningful moved, so the caller can skip the push.
 */
export function describeArtboardsChange(
  previous: ArtboardState[],
  next: ArtboardState[]
): HistoryChange | null {
  const previousIds = previous.map((board) => board.id);
  const nextIds = next.map((board) => board.id);

  const added = nextIds.filter((id) => !previousIds.includes(id));
  if (added.length > 0) {
    const board = next.find((item) => item.id === added[0]);
    return {
      label: added.length === 1 ? 'Add Artboard' : `Add ${added.length} Artboards`,
      icon: 'artboard',
      detail: added.length === 1 ? board?.name : undefined,
      mergeKey: null,
    };
  }

  const removed = previousIds.filter((id) => !nextIds.includes(id));
  if (removed.length > 0) {
    const board = previous.find((item) => item.id === removed[0]);
    return {
      label: removed.length === 1 ? 'Delete Artboard' : `Delete ${removed.length} Artboards`,
      icon: 'delete',
      detail: removed.length === 1 ? board?.name : undefined,
      mergeKey: null,
    };
  }

  if (previousIds.join('|') !== nextIds.join('|')) {
    return { label: 'Reorder Artboards', icon: 'order', mergeKey: null };
  }

  const previousById = new Map(previous.map((board) => [board.id, board]));
  const changes: HistoryChange[] = [];
  for (const board of next) {
    const before = previousById.get(board.id);
    if (!before) continue;
    const change = describeBoardChange(before, board);
    if (change) changes.push(change);
  }

  if (changes.length === 0) return null;
  if (changes.length === 1) return changes[0];

  const labels = new Set(changes.map((change) => change.label));
  if (labels.size === 1) {
    // Same edit applied to several artboards (a project-wide colour, a
    // translate run): keep the verb, drop the per-board detail.
    return {
      label: changes[0].label,
      icon: changes[0].icon,
      detail: `${changes.length} artboards`,
      mergeKey: null,
    };
  }
  return { label: 'Multiple Changes', icon: 'edit', detail: `${changes.length} artboards`, mergeKey: null };
}

/** Build a history state for an explicitly named command. */
export function namedChange(label: string, icon: HistoryIcon = 'edit', detail?: string): HistoryChange {
  return { label, icon, detail, mergeKey: null };
}
