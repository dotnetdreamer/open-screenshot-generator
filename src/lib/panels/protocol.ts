// What an editor window and a detached panel window say to each other.
//
// The editor owns every piece of state the dock shows; a panel window is a
// remote view of it. So the traffic is one way in each direction: the editor
// publishes a DockSnapshot, the panel window sends back a DockIntent naming an
// edit, and the editor replays that intent against the very same handlers the
// docked panels call. Nothing in the layout's state model changes, and
// handleArtboardsUpdate stays the only door.
//
// Two rules govern what may go on the wire:
//
//  1. It is JSON. Tauri serializes an event payload through the IPC bridge, so
//     a Date arrives as a string and a Blob does not arrive at all. Dates are
//     revived on the receiving side (see reviveVersions below).
//  2. It is small. A history entry carries a deep copy of the whole project and
//     an element can carry a data: URL, so both are stripped here. Media is
//     already referenced rather than inlined (asset:<id> and mediaId, see
//     lib/mediaStore), and IndexedDB is shared by every window on the origin, so
//     a window that needs the bytes reads them itself. Never put a blob: URL on
//     the wire: an object URL belongs to the document that created it, dies with
//     it, and resolves to nothing anywhere else.

import type {
  ArtboardElement,
  ArtboardState,
  ElementLocaleOverride,
} from '@/types/artboard';
import type { HistoryEntry } from '@/lib/historyLabels';
import type { ProjectVersionMeta } from '@/lib/versions/store';
import type { LocaleOverrideState } from '@/components/open-screenshot-generator/LayersPanel';
import type { DetachableKey } from '@/lib/i18n/project';
import type { DetachablePanel } from './url';

/** The dock's top section. 'history' is the undo states, 'versions' the saved ones. */
export type RightDockTab = 'properties' | 'history' | 'versions';

/** The keys a language can hold its own copy of. Mirrors PropertiesPanel. */
export type LocalizableField = 'content' | 'fontFamily' | 'screenshotSrc' | 'imageSrc' | 'mediaId';

/**
 * Everything the four panels render, flattened.
 *
 * One object rather than a message per panel: the panels are read from the same
 * edit, so splitting them would only mean four deliveries where one will do,
 * and a panel window that opened mid-edit could show two halves of two states.
 */
export interface DockData {
  /** Null while no project is open, which is what greys the Versions controls. */
  activeProjectId: string | null;
  projectName: string;

  // --- Properties ---------------------------------------------------------
  selectedElement: ArtboardElement | null;
  /**
   * The board-level form, or null while an element is selected and the form is
   * showing that instead. Already resolved by the editor, so both windows agree
   * on which of the two the panel is looking at.
   *
   * On the wire it travels WITHOUT its elements: the form reads the name and
   * the background off it, and the elements are already in layerElements.
   */
  activeArtboardDetails: ArtboardState | null;
  activeLocale: string | null;
  baseLocale: string;
  localeOverride?: ElementLocaleOverride;
  baseElement?: ArtboardElement;
  localeDetached?: string[];

  // --- Layers -------------------------------------------------------------
  layerElements: ArtboardElement[];
  selectedElementId: string | null;
  activeArtboardName?: string;
  layerLocaleStates?: Record<string, LocaleOverrideState>;

  // --- History ------------------------------------------------------------
  /** Entries with their project snapshots stripped. See slimHistory. */
  history: HistoryEntry[];
  historyIndex: number;

  // --- Versions -----------------------------------------------------------
  versions: ProjectVersionMeta[];
  isVersionBusy: boolean;

  /**
   * An export is holding the canvas.
   *
   * An export swaps a converted or re-projected board list onto the canvas for
   * a few seconds (exportCanvasArtboards in the layout), and every derived value
   * in here follows it. That list is a render, not the project, so nothing may
   * publish while it is up: a detached properties form would show the user a
   * board they never made and offer to edit it.
   */
  isExporting: boolean;

  /**
   * The editor asking for a tab to be shown.
   *
   * Something in the editor occasionally has to point at a panel ("your saved
   * version is in Versions"), and that panel may be in another window by then.
   * The token is what makes it an event rather than a state: it is bumped on
   * every ask, so asking twice for the same tab still arrives twice, and a
   * snapshot that merely repeats the last ask changes nothing.
   */
  tabRequest?: { tab: RightDockTab; token: number };
}

/**
 * A DockData on the wire.
 *
 * The editor renders its own dock straight from the DockData, at full fidelity;
 * only the copy that crosses to another window is put through toWireSnapshot.
 * Keeping them one type is what stops the two views drifting apart.
 */
export interface DockSnapshot extends DockData {
  /** Bumped on every publish. A client ignores anything older than it has. */
  rev: number;
}

/** One edit, named. Replayed in the editor window against the docked handlers. */
export type DockIntent =
  | { name: 'updateSelectedElement'; updates: Partial<ArtboardElement> }
  | { name: 'updateElementById'; elementId: string; updates: Partial<ArtboardElement> }
  | { name: 'translateElement'; elementId: string }
  | { name: 'updateArtboardDetails'; updates: Partial<ArtboardState>; scope?: 'board' | 'all' }
  | { name: 'resetLocaleField'; field: LocalizableField }
  | { name: 'toggleLocaleDetach'; keys: DetachableKey[]; detach: boolean }
  | { name: 'resetLocaleOverrides'; scope: 'element' | 'artboard' | 'project' }
  | { name: 'jumpToHistory'; index: number }
  | { name: 'saveNamedVersion'; label: string }
  | { name: 'restoreVersion'; versionId: string }
  | { name: 'openVersionCopy'; versionId: string }
  | { name: 'deleteVersion'; versionId: string }
  | { name: 'selectElement'; elementId: string }
  | { name: 'moveElementLayer'; elementId: string; direction: 'up' | 'down' }
  | { name: 'deleteElement'; elementId: string }
  | { name: 'renameElement'; elementId: string; newName: string }
  | { name: 'selectTab'; tab: RightDockTab };

/**
 * Every message on the bus.
 *
 * `from` is the sending window's id, and it is what makes one shared channel
 * safe: a Tauri emit is delivered to the emitting window too, so without it a
 * publisher would answer its own snapshots.
 */
export type PanelMessage =
  /** A panel window announcing itself, and asking for a first snapshot. */
  | { kind: 'hello'; from: string; panels: DetachablePanel[]; hostId: string | null }
  /** A panel window closing. */
  | { kind: 'bye'; from: string }
  /** An editor window that has just joined. Reloaded editors say this too, which
   *  is how a panel window that outlived the reload finds its way back. */
  | { kind: 'host-up'; from: string }
  /** An editor window going away. Its panels have nothing left to show. */
  | { kind: 'host-down'; from: string }
  /** `to` null means every panel window; a bus id means just that one. */
  | { kind: 'snapshot'; from: string; to: string | null; snapshot: DockSnapshot }
  | { kind: 'intent'; from: string; to: string; intent: DockIntent }
  /** A panel window on its way back into the dock. It closes itself. */
  | { kind: 'reattach'; from: string; hostId: string | null; panels: DetachablePanel[] }
  /**
   * The editor asking a panel window to come back.
   *
   * The editor can usually just close the window itself, by label on the
   * desktop and through the handle it kept on the web. What it cannot do is
   * close a popup it opened BEFORE its own reload, because that handle went
   * with the old document. So it asks as well, and the window that hears its
   * own group closes itself.
   */
  | { kind: 'go-home'; from: string; panels: DetachablePanel[] };

/**
 * A history entry without the project snapshot it restores.
 *
 * `artboards` is a deep copy of every board, and the stack holds up to fifty of
 * them, so shipping the list as it stands would put tens of megabytes on the
 * wire per edit. The panel renders label, detail, icon and timestamp and jumps
 * by index, so the snapshot is dead weight there.
 */
export function slimHistory(entries: HistoryEntry[]): HistoryEntry[] {
  return entries.map((entry) => ({ ...entry, artboards: [] }));
}

/** Fields that can hold a data: URL rather than a short path or an asset ref. */
const HEAVY_ELEMENT_KEYS = [
  'imageSrc',
  'screenshotSrc',
  'customFrameSrc',
  'videoSrc',
  'posterSrc',
] as const;

/** Longer than this and a source is carrying its own bytes, not pointing at them. */
const INLINE_SRC_LIMIT = 512;

/**
 * What an elided source is replaced with.
 *
 * Replaced, not deleted. None of the four panels ever renders these bytes: the
 * properties form reads them for truthiness only, to decide whether a button
 * reads "Upload Screenshot" or "Change Screenshot" and whether the screenshot
 * sliders are worth showing. Deleting the key would flip both of those the
 * wrong way, so a short stand-in goes in its place.
 */
export const ELIDED_SRC = 'osg:elided';

/** Elide anything on an element that is carrying bytes rather than a reference. */
function elideHeavySources(element: ArtboardElement): ArtboardElement {
  let copy: Record<string, unknown> | null = null;
  const fields = element as unknown as Record<string, unknown>;
  for (const key of HEAVY_ELEMENT_KEYS) {
    const value = fields[key];
    if (typeof value === 'string' && value.length > INLINE_SRC_LIMIT) {
      copy = copy ?? { ...fields };
      copy[key] = ELIDED_SRC;
    }
  }
  return (copy ?? element) as ArtboardElement;
}

/**
 * The layers list, slimmed.
 *
 * It renders a name, a type icon and a locale dot, so nothing that can hold a
 * data: URL is worth sending. Uploaded media is already a reference (asset: or
 * mediaId) and short paths are left alone; only genuinely inline bytes go.
 */
export function slimElementsForLayers(elements: ArtboardElement[]): ArtboardElement[] {
  return elements.map(elideHeavySources);
}

/**
 * The selected element, slimmed the same way.
 *
 * It has to travel in more detail than a layer row, because the properties form
 * reads most of its fields, but it must not carry a screenshot: a project from
 * before the issue #19 media work can hold megabytes of base64 in
 * `screenshotSrc`, and the form would put every byte of it on the wire on every
 * publish. Nothing in the form draws it.
 */
export function slimSelectedElement<T extends ArtboardElement | null | undefined>(element: T): T {
  if (!element) return element;
  return elideHeavySources(element) as T;
}

/**
 * The active board without its elements or its override map.
 *
 * The properties form reads name, backgroundColor, backgroundType,
 * backgroundGradient and the background picture from it. `elements` would
 * repeat the whole layers projection and `localized` grows with every language.
 *
 * A background picture is normally an `asset:<id>`, which is a few dozen bytes
 * and travels as itself. A project old enough to still hold one inline gets the
 * same treatment as a screenshot: the form reads the field for truthiness only,
 * so a stand-in keeps the buttons right without putting a megabyte on the wire.
 */
export function slimArtboard(board: ArtboardState | null | undefined): ArtboardState | null {
  if (!board) return null;
  const { localized: _localized, ...rest } = board;
  const backgroundImage =
    typeof rest.backgroundImage === 'string' && rest.backgroundImage.length > INLINE_SRC_LIMIT
      ? ELIDED_SRC
      : rest.backgroundImage;
  return { ...rest, backgroundImage, elements: [] };
}

/**
 * Put the Date back on a version row.
 *
 * createdAt is a real Date in Dexie and a string once it has been through JSON,
 * and the panel calls getTime() on it.
 */
export function reviveVersions(versions: ProjectVersionMeta[]): ProjectVersionMeta[] {
  return versions.map((version) => ({ ...version, createdAt: new Date(version.createdAt) }));
}

/**
 * How big a snapshot has to get before something has gone wrong.
 *
 * A quarter of the ~256KB ceiling lib/collab draws for the same class of
 * reason. A snapshot anywhere near this is a projection that stopped projecting,
 * not a transport that needs a bigger pipe, so this warns and never throws:
 * dropping the snapshot would leave the panel window frozen on stale state,
 * which is worse than one slow publish.
 */
export const DOCK_MAX_MESSAGE_BYTES = 64 * 1024;

/** Everything the editor knows about the dock, cut down to what will travel. */
export function toWireSnapshot(data: DockData, rev: number): DockSnapshot {
  const snapshot: DockSnapshot = {
    ...data,
    rev,
    selectedElement: slimSelectedElement(data.selectedElement),
    baseElement: slimSelectedElement(data.baseElement),
    activeArtboardDetails: slimArtboard(data.activeArtboardDetails),
    layerElements: slimElementsForLayers(data.layerElements),
    history: slimHistory(data.history),
  };

  if (process.env.NODE_ENV !== 'production') {
    const bytes = JSON.stringify(snapshot).length;
    if (bytes > DOCK_MAX_MESSAGE_BYTES) {
      console.warn(
        `Dock snapshot is ${Math.round(bytes / 1024)}KB, over the ${
          DOCK_MAX_MESSAGE_BYTES / 1024
        }KB guide. Something is travelling that should have been projected away.`,
        {
          layerElements: snapshot.layerElements.length,
          history: snapshot.history.length,
          versions: snapshot.versions.length,
        }
      );
    }
  }

  return snapshot;
}

/** The other side of the wire: JSON back into the shape the panels expect. */
export function fromWireSnapshot(snapshot: DockSnapshot): DockSnapshot {
  return { ...snapshot, versions: reviveVersions(snapshot.versions) };
}
