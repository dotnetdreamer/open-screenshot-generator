"use client";
import React, { useState, useEffect, useLayoutEffect, useCallback, useMemo, useRef, useDeferredValue } from 'react';
import { captureNodeToPng } from '@/lib/exportRaster';
import { updateStudioLive } from '@/lib/device3dStudioLive';
import { preloadGoogleFonts } from '@/services/fontService';
import { loadCustomFontFamilies, loadCustomFonts, useCustomFonts } from '@/services/customFonts';
import { isTauri, sanitizeFileName, saveBlobToDisk, saveBlobToPath, saveDataUrlToDisk, saveDataUrlToPath, pickExportDirectory, openExternal, fetchWebviewCrashInfo } from '@/lib/desktop';
import { analyzeArtboardForVideo, exportArtboardVideo, projectHasVideoContent, type ArtboardVideoInfo } from '@/lib/video/videoExport';
import { getPlayback, stopPlayback } from '@/lib/video/playback';
import { AUDIO_ACCEPT, saveAudio } from '@/lib/mediaStore';
import { soundLayerName } from '@/lib/video/audio';
import { migrateVideoDevices } from '@/lib/video/migrateVideoDevices';
import { externalizeInlineMedia } from '@/lib/externalizeInlineMedia';
import {
  SidebarProvider,
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarGroup,
} from "@/components/ui/sidebar";
import { ElementPalette } from './ElementPalette';
import { Toolbar } from './Toolbar';
import { CanvasArea, applyCanvasStructuralChange, type CanvasStructuralChange } from './CanvasArea';
import { PreviewTimelineBar } from './PreviewTimelineBar';
import { CanvasContextMenu } from './CanvasContextMenu';
import { PreviewDialog, type PreviewLocaleOption, type PreviewMode } from './PreviewDialog';
import { TranslateDialog, getLanguageName } from './TranslateDialog';
import { LanguageManagerDialog } from './LanguageManagerDialog';
import { LocaleViewNotice } from './LocaleViewNotice';
import { TranslationTableDialog } from './TranslationTableDialog';
import { translateText, detectLanguage, isTranslationEnabled, AUTO_DETECT } from '@/services/translation';
import { Logo } from './Logo';
import { GithubMark, REPO_URL } from './GithubLink';
import type { ArtboardState, ElementLocaleOverride, ElementSelectModifiers, ElementType, Point, ProjectLocalization, ShapeType, DeviceType, ArtboardElement, TextElementProps, ShapeElementProps, DeviceFrameElementProps, ImageElementProps, VideoElementProps, VideoDeviceElementProps, GestureElementProps, GestureType, Project, Size } from '@/types/artboard';
// The locale overlay. `artboards` always means the whole base document; one
// language is a projection of it, derived per render and never stored.
import { getLocaleDef, localeLabel, localeName } from '@/lib/i18n/locales';
// Whole-artboard App Preview scenes, dropped from the palette's Previews tab.
import { PREVIEW_SCENE_DURATION, PREVIEW_SCENE_SIZE, buildPreviewScenePreset } from '@/lib/previewScenes';
// The App Preview MCP tools' pure half (animation patches, timeline read-back).
import { buildAnimationPatch, clampPreviewDuration, summarizePreviewTimeline } from '@/lib/mcp/previewTools';
import {
  dropElementOverrides,
  ensureUniqueElementIds,
  getBaseLocale,
  getProjectLocales,
  hasLocales,
  localeCompletion,
  normalizeLocalization,
  overrideStateFor,
  remapOverrideIds,
  setLocalization,
  untranslatedCount,
} from '@/lib/i18n/localization';
import {
  attachProperty,
  clearLocaleFontSizeCache,
  detachProperty,
  projectArtboards,
  resolveElementForLocale,
  unprojectArtboards,
  type DetachableKey,
} from '@/lib/i18n/project';
import { availableEngines, translateIntoLocale } from '@/lib/i18n/translate';
import { applyCsvImport, buildTranslationRows, planCsvImport, toCsv } from '@/lib/i18n/translationCsv';
import { applyLocalizedText } from '@/lib/mcp/localizedText';
// The language tools' pure half. Everything they do is a function of the base
// document, so the layout only resolves ids, commits, and (for the ones that
// call an engine or the canvas) drives the progress UI.
import {
  addProjectLocales,
  applyLocaleOverride,
  applyLocaleTexts,
  buildTranslationView,
  localeConfigEntries,
  removeProjectLocales,
  resetLocaleOverrides,
  setProjectBaseLocale,
} from '@/lib/mcp/localeTools';
import type { LocaleOverrideState } from './LayersPanel';
import { ExportDialog, type ExportSelection, type VideoExportRequest, type VideoExportProgress } from './ExportDialog';
import { installHeadlessBridge, type HeadlessHost } from '@/lib/headless/bridge';
import { canOpenAsProject, canvasStillHolds, sameDocument, type RenderedCanvas } from '@/lib/projectCanvas';
import { createProjectSaveQueue } from '@/lib/projectSaveQueue';
import { useProjectTabs } from '@/lib/tabs/useProjectTabs';
import { summarizeProject } from '@/lib/tabs/summary';
import { nextActiveAfterClose, otherTabIds, tabIdsRightOf, type TabView } from '@/lib/tabs/tabModel';
import type { ParkedProject } from '@/lib/tabs/parking';
import {
  createUndoStore,
  indexedDbUndoStorage,
  resumeUndo,
  type SaveOptions,
  type StoredUndo,
  type UndoSnapshot,
} from '@/lib/tabs/historyStore';
import {
  baseLocaleOf,
  pickElements,
  pickWithFacesIn,
  placeArtboard,
  placeElements,
  removeElements,
  stillHolds,
  textFacesOf,
  type ElementTransfer,
} from '@/lib/tabs/transfer';
import { whenFacesLoaded } from '@/lib/tabs/transferFonts';
import type { ElementCarry } from '@/lib/tabs/elementCarry';
import { startCarrySession } from '@/lib/tabs/carrySession';
import {
  heldProjectIds,
  holdProjectLock,
  isProjectLockHeld,
  mayWriteProject,
  OpenStoppedError,
  projectOpenElsewhere,
  ProjectOpenElsewhereError,
  releaseProjectLock,
  startHandOver,
} from '@/lib/tabs/projectLocks';
import {
  closeThisWindow,
  focusThisWindow,
  joinTabWindowBus,
  openTabWindow,
  tabWindowKey,
  type TabWindowMessage,
  type TabWindowPlacement,
} from '@/lib/tabs/tabWindows';
import { EDITOR_WINDOW_ID, liveEditorWindowIds } from '@/lib/tabs/presence';
import {
  pickDropWindow,
  pointerScreenPoint,
  thisWindowScreenRect,
  trackWindowFocus,
  windowFocusedAt,
  type DropCandidate,
  type ScreenPoint,
  type ScreenRect,
} from '@/lib/tabs/tabDrag';
import type { WindowBus } from '@/lib/panels/bus';
import type { OtherTabWindow } from './tabs/ProjectTabBar';
import { ProjectTabBar } from './tabs/ProjectTabBar';
import type { TabArtboardsSource } from './tabs/TabHoverCard';
import { AppPreviewExportDialog } from './AppPreviewExportDialog';
import { ExportProgressDialog, type PngExportProgress } from './ExportProgressDialog';
import { TranslateProgressDialog, type TranslateProgress } from './TranslateProgressDialog';
import { ALL_CANVAS_SIZE_PRESETS, DEFAULT_CANVAS_SIZE, canvasSizeSlug } from '@/lib/sizePresets';
import {
  creativeBoards,
  creativeFileStem,
  creativeFileStems,
  creativeSpecForPreset,
  creativeSummary,
  isCreativeBoard,
  screenshotBoards,
} from '@/lib/creative/specs';
import {
  boardFacesMissing,
  boardFacesPending,
  buildCreativeBoard,
  CREATIVE_LOOKS,
  lookFacesPending,
  readProjectLook,
  rebuildCreativeBoard,
  suggestedAppName,
} from '@/lib/creative/layouts';
import type { CreativeLookChoice } from '@/lib/creative/paletteDrag';
import { CreativeAssetsDialog } from './creative/CreativeAssetsDialog';
import { CreativeBoardActionsContext } from './creative/CreativeBoardBadge';
import { onFontsSettled } from '@/lib/fontsSettled';
import { StoreArtSourceContext, type StoreArtSource } from './creative/StoreArtPaletteTab';
import { artboardBackground, normalizeBackgroundImage } from '@/lib/artboardBackground';
import {
  startDesktopMcpBridge,
  getMcpStatus,
  listenMcpStatus,
  type McpDesignApi,
  type McpArtboardSummary,
  type McpElementMeasurement,
  type McpExportResult,
  type McpLocaleState,
  type McpLocaleSummary,
  type McpTemplateSummary,
  type McpTranslateRun,
  type McpTranslateRunResult,
} from '@/lib/mcp/desktopMcpServer';
import { McpServerStatus } from './McpServerStatus';
import { agentUsableTemplates } from '@/lib/ai/templateCatalog';
import { loadProjectTemplates } from '@/services/projectService';
import { TEMPLATE_CATEGORIES } from '@/lib/templateCategories';
import { convertArtboardsToFormat, detectArtboardsFormat, swapDeviceInElements, scaleElementsToCanvas, DEVICE_FORMAT_PRESETS, type DeviceFormat, type DeviceFormatPreset } from '@/lib/deviceRegistry';
import { PublishDialog } from './publish/PublishDialog';
import { GrowthDialog } from './growth/GrowthDialog';
import { getGrowthSettings, setGrowthSettings } from '@/lib/growth/settings';
import { useGrowthMonitor } from '@/lib/growth/useGrowthMonitor';
import type { GrowthTab } from './growth/GrowthShared';
import { localeForAppleLocale } from '@/lib/publish/storeTargets';
import { ProjectNameField } from './ProjectNameField';
import {
  decodeDataUrl,
  previewRenderSizeFor,
  type PublishImage,
  type PublishVideo,
} from '@/lib/publish';
import { track, trackTemplateSelected, trackDeviceFormatSelected, trackExportPng, trackExportVideo, trackExportJson } from '@/lib/analytics';

import { AgentPromoBanner } from './start/AgentPromoBanner';
import { BlankCanvasCard } from './start/BlankCanvasCard';
import { QuickStartPromoCard } from './start/quickstart/QuickStartPromoCard';
import { QuickStartScreen } from './start/quickstart/QuickStartScreen';
import { GraphicsPromoCard } from './start/graphics/GraphicsPromoCard';
import { GraphicsStartScreen } from './start/graphics/GraphicsStartScreen';
import { DialogDropLayer } from './start/quickstart/DialogDropLayer';
import { saveImageAsset, saveImageBlobAsset } from '@/lib/mcp/assetStore';
import type { UploadedScreenshot } from '@/lib/ai/imageUtils';
import { claudeAgent, readAgentPanelEnabled, useClaudeAgent } from '@/lib/claudeCode/store';
import { buildAttachmentNote, buildFirstRunBrief, defaultStartText } from '@/lib/claudeCode/prompt';
import { assetToImage, screenshotToImage } from '@/lib/claudeCode/images';
import { importProjectImage } from '@/lib/claudeCode/projectImages';
import type { AgentFolder, AgentKind } from '@/lib/claudeCode/types';
import { agentContextLabel as describeAgentContext, buildAgentContext } from '@/lib/claudeCode/context';
import { PLACEHOLDER_PROJECT_NAME, pickCanvasSize, projectNameFromInstruction } from '@/lib/claudeCode/startProject';
import { toAgentPanelView, type AgentAttachment } from '@/lib/claudeCode/view';
import { ClaudeCodeLogo } from './agent/ClaudeCodeLogo';
import { CodexLogo } from './agent/CodexLogo';
import { AgentStartScreen } from './start/AgentStartScreen';
import { TipsDialog, shouldShowTipsOnStartup } from './TipsDialog';
import { SettingsDialog } from './SettingsDialog';
import { DiscoverDialog } from './discover/DiscoverDialog';
import { isDiscoverConfigured, useDiscoverSession } from '@/lib/discover/session';
import { CommunityStartPanel } from './discover/CommunityStartPanel';
import type { DiscoverPost } from '@/types/discover';
import { CloudSaveConflictDialog } from './cloud/CloudSaveConflictDialog';
import { CloudAutoSaveChip } from './cloud/CloudAutoSaveChip';
import { useCloudAutoSave } from '@/hooks/use-cloud-auto-save';
import { useAccountAutoSync } from '@/hooks/use-account-auto-sync';
import { CollabBar } from './collab/CollabBar';
import { CollabDialog } from './collab/CollabDialog';
import { useCollab } from '@/hooks/use-collab';
import {
  buildInviteUrl,
  clearInviteFromUrl,
  invitedWithoutKey,
  joinedProjectFor,
  newRoomKey,
  readInviteFromUrl,
  rememberJoined,
  type CollabInvite,
} from '@/lib/collab/links';
import {
  buildShareUrl,
  clearSharedSlugFromUrl,
  getCloudLink,
  loadProjectFromCloud,
  openSharedProject,
  readSharedSlugFromUrl,
  saveProjectToCloud,
  setCloudProjectShared,
  setCloudLinkCollabKey,
  listCloudLinks,
  CloudConflictError,
  CloudSignInRequiredError,
  type CloudProject,
  type CloudProjectLink,
} from '@/lib/cloud';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ChevronDownIcon, ChevronLeftIcon, CompassIcon, CopyIcon, ExternalLinkIcon, HandIcon, InfoIcon, Loader2Icon, MonitorIcon, MoreHorizontalIcon, MousePointerIcon, PanelRightCloseIcon, PanelRightOpenIcon, PictureInPicture2Icon, RedoIcon, SearchIcon, SettingsIcon, SlidersHorizontalIcon, UndoIcon, UserIcon, ZoomInIcon, ZoomOutIcon } from 'lucide-react';
import { AccountDialog } from './account/AccountDialog';
import { AccountSyncChip } from './account/AccountSyncChip';
import { SaveToAccountDialog } from './account/SaveToAccountDialog';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  AccountAuthError,
  bundleFromJson,
  bundleToJson,
  collectFontFamilies,
  findAccountProject,
  importBundle,
  loadProjectFromAccount,
  newCloudProjectId,
  saveProjectToAccount,
  setAccountLinkAutoSync,
  serializeProject,
  splitProgress,
  useAccount,
  type CloudProjectSummary,
} from '@/lib/account';
// Detachable dock. The panel stack itself is a component now, because it also
// renders in a window of its own on another monitor (see lib/panels).
import {
  RightDockPanels,
  LAYERS_SECTION_MIN,
  RIGHT_DOCK_LAYERS_HEIGHT_KEY,
  type DockHandlers,
} from './panels/RightDockPanels';
import { MonitorMenuItems } from './panels/MonitorMenuItems';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useDockHost } from '@/lib/panels/useDockHost';
import {
  canPlaceWindows,
  listMonitors,
  monitorOfWindow,
  moveWindowToMonitor,
  requestWebScreenAccess,
  type MonitorInfo,
} from '@/lib/panels/monitors';
import { DETACHABLE_PANELS, PANEL_GROUP_ALL } from '@/lib/panels/url';
import type { DockData, RightDockTab } from '@/lib/panels/protocol';
import {
  deleteVersion,
  deleteVersionsForProject,
  listVersions,
  readVersion,
  saveVersion,
  type ProjectVersionMeta,
} from '@/lib/versions/store';
import {
  describeArtboardsChange,
  getElementDisplayName,
  namedChange,
  HISTORY_LIMIT,
  HISTORY_MAX_BYTES,
  HISTORY_MERGE_WINDOW_MS,
  type HistoryChange,
  type HistoryEntry,
} from '@/lib/historyLabels';
import {
  alignElements,
  distributeElements,
  dropLayer,
  expandGroups,
  groupCommandState,
  hasCanvasBox,
  makeGroupId,
  moveElements,
  nextGroupName,
  unionBounds,
  type AlignEdge,
  type DistributeAxis,
} from '@/lib/elementGeometry';
import { computeSpill, spillFor, type SpanChange } from '@/lib/spanArtboards';
import { LoadStatusBar, type ProjectLoadStep } from './LoadStatusBar';
import { LocalFontNotice } from './LocalFontNotice';
import { ProjectLoadOverlay } from './ProjectLoadOverlay';
import packageJson from '../../../package.json';
import { useToast } from '@/hooks/use-toast';
import { listenUpdateFlush, reportEditsWritten } from '@/lib/updates/client';
import { manualCheckToast } from '@/lib/updates/describe';
import { useUpdateSchedule } from '@/lib/updates/store';
import { AboutUpdateStatus } from './updates/AboutUpdateStatus';
import { UpdateSidebarItem } from './updates/UpdateSidebarItem';
import { ToastAction } from '@/components/ui/toast';
import { useIsMobile } from '@/hooks/use-mobile';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import Image from 'next/image';
import { withBasePath } from '@/lib/basePath';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { SidebarInset } from '@/components/ui/sidebar';
import { db } from '@/database';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Trash2Icon } from 'lucide-react';
import { readElementClipboard, useElementClipboard, writeElementClipboard } from '@/lib/elementClipboard';
import { readPreference, writePreference } from '@/lib/editorPreferences';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { useRouter, useSearchParams } from 'next/navigation';
import { cn } from '@/lib/utils';

// Reduce the margin between artboards
const ARTBOARD_MARGIN = 15; // Reduced from 30
const DISPLAY_SCALE_FACTOR = 0.3;
// A finger held this still, this long, opens the canvas context menu (the
// gesture that stands in for a right-click on a touch screen).
const LONG_PRESS_MS = 550;
const LONG_PRESS_SLOP_PX = 10;

// Right dock (Properties + Layers) persistence. localStorage so the layout
// survives an app relaunch, not just a reload.
const RIGHT_DOCK_OPEN_KEY = 'abs-right-dock-open';
const RIGHT_DOCK_TAB_KEY = 'abs-right-dock-tab';
const RIGHT_DOCK_WIDTH_KEY = 'abs-right-dock-width';
// The dock widens from its left edge, never narrows below where it starts: the
// tab strip and the properties form are laid out for 320px. The page caps it
// again (lg:max-w) so a width saved on a big screen cannot crush the canvas on
// a small one.
const RIGHT_DOCK_WIDTH_MIN = 320; // px
const RIGHT_DOCK_WIDTH_MAX = 720; // px
// RightDockTab, LAYERS_SECTION_MIN and PROPERTIES_SECTION_MIN now live with the
// panel stack itself (panels/RightDockPanels), because a detached panel window
// renders that same stack and has to agree with the dock about all three.
// The dock is a bottom sheet on a phone and only 70% of a short screen tall, so
// the layers list starts shorter there than the desktop split. A starting
// height, not a cap: capping it is what made the divider look broken on touch,
// since dragging changed the number and nothing moved.
const MOBILE_LAYERS_SECTION_DEFAULT = 170; // px
// How long the "that applied to every language" notice stays quiet after showing.
// Long enough not to fire on every nudge of a drag, short enough that a user who
// keeps making shared edits keeps being told.
const SHARED_EDIT_NOTICE_INTERVAL_MS = 30_000;
/**
 * How an align reads in the History panel. Title Case, like every other label
 * in historyLabels.ts, and never a button title: the text-alignment buttons in
 * the Properties panel already answer to "Align Left".
 */
const ALIGN_HISTORY_LABELS: Record<AlignEdge, string> = {
  left: 'Align Left',
  'center-h': 'Align Center',
  right: 'Align Right',
  top: 'Align Top',
  'middle-v': 'Align Middle',
  bottom: 'Align Bottom',
};
/**
 * How far one arrow key moves the selection, in artboard pixels.
 *
 * A store screenshot is around 1200 pixels across, so a single pixel is a
 * hairline and Shift is what makes the key useful for real spacing.
 */
const NUDGE_STEP = 1;
const NUDGE_STEP_LARGE = 10;
/** Which way each arrow key moves the selection. */
const NUDGE_DIRECTIONS: Record<string, { x: number; y: number }> = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
};
// How much editing there has to be between two automatic versions. Ten minutes
// is the number that makes the list readable: a version per commit would be
// hundreds a day and a version per hour would miss the mistake you are looking
// for. Anything that matters more than the clock (an export, a conversion,
// somebody naming one) writes its own regardless.
const VERSION_INTERVAL_MS = 10 * 60 * 1000;

/**
 * Why handleArtboardsUpdate turned a commit down: an export holds the canvas,
 * the canvas does not hold the open project's document (a project is opening,
 * or another document went onto the canvas after the render that made the
 * commit), or the commit would leave the project with no artboards.
 */
type CommitRefusal = 'exporting' | 'opening' | 'empty';

/** What a design tool answers when its commit was turned down. */
const TOOL_COMMIT_REFUSALS: Record<CommitRefusal, string> = {
  exporting: 'An export is running, so nothing was changed. Send this again once the export finishes.',
  opening:
    'Another project was opened while this call ran, so nothing was changed. Check list_projects for the one open now before you send it again.',
  empty: 'That would leave the project with no artboards, so nothing was changed. A project keeps at least one.',
};

/** Why work the user waited for (a translation, images being read) was not saved. */
const UNSAVED_RESULT_REASONS: Record<CommitRefusal, string> = {
  exporting: 'An export was running. Try again once it finishes.',
  opening: 'Another project was opened in the meantime. Open the project again and try once more.',
  empty: 'A project keeps at least one artboard.',
};

/** Why a rename or a named version asked for while a project opens was turned down. */
const PROJECT_STILL_OPENING = 'A project is still opening. Try again once it is open.';

/** The desktop menu's tab commands, emitted to one window (settings.rs). */
const TAB_COMMAND_EVENT = 'abs-tab-command';

let historyEntrySeq = 0;

// One history state: the change's name plus the snapshot it restores. The
// snapshot is deep-copied here so later edits to the live artboards can never
// reach back into a recorded state. One stringify serves both the copy and the
// entry's byte size, which is what the HISTORY_MAX_BYTES cap trims against.
/** A parked tab's undo stack, as historyStore.ts keeps it. */
function undoSnapshotOf(project: ParkedProject): UndoSnapshot {
  return {
    history: project.history,
    historyIndex: project.historyIndex,
    selectedElementIds: project.selectedElementIds,
    unedited: project.openedSnapshot !== null,
  };
}

/**
 * How long an undo stack written for another window to take is kept after the
 * window that wrote it has gone. The window it was for opens in seconds.
 */
const HAND_OVER_KEEP_MS = 10 * 60 * 1000;

/**
 * How long opening a project waits for another window that is handing it over
 * to let go. That window writes the project and its undo stack first.
 */
const HAND_OVER_WAIT_MS = 6000;

/**
 * The undo stack a project opens with: the one it was left with, when there is
 * one (historyStore.ts), carried on to the document actually read; otherwise a
 * fresh one that starts at the state it opened in.
 */
function openStoredUndo(
  projectId: string,
  name: string,
  boards: ArtboardState[],
  stored: StoredUndo | null
): {
  history: HistoryEntry[];
  historyIndex: number;
  openedSnapshot: ParkedProject['openedSnapshot'];
  selectedElementIds: string[];
} {
  const openedSnapshot = { projectId, boards, name };
  const openEntry = (artboards: ArtboardState[]) => makeHistoryEntry(artboards, namedChange('Open', 'open', name));
  if (!stored) return { history: [openEntry(boards)], historyIndex: 0, openedSnapshot, selectedElementIds: [] };
  const resumed = resumeUndo(stored, boards, openEntry);
  return {
    history: resumed.history,
    historyIndex: resumed.historyIndex,
    // A sitting's first edit writes its "Before this session" version. This
    // one has, when it already edited the project; a new sitting has not.
    openedSnapshot: resumed.matched && stored.sameSitting && !stored.unedited ? null : openedSnapshot,
    selectedElementIds: resumed.matched ? stored.selectedElementIds : [],
  };
}

/** A tab of this window's being dragged out of the strip, toward another window maybe. */
interface TearDrag {
  projectId: string;
  name: string;
  /** Where this window is on the screen. */
  own: ScreenRect | null;
  /** Where the pointer was at the last frame. */
  point: ScreenPoint | null;
  /** The other windows, as they answered: where they are, and what to call them. */
  windows: Map<string, DropCandidate & { name: string }>;
  /** The window it would land in at `point`. */
  target: string | null;
  /** The newest pointer position, read on the next frame. */
  latest: { screenX: number; screenY: number } | null;
  frame: number | null;
}

/** Runs `work` once the browser is idle, or within a second if it never is. */
function afterIdle(work: () => void): void {
  if (typeof window === 'undefined') return;
  if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(work, { timeout: 1000 });
  else window.setTimeout(work, 50);
}

/** Resolves at the browser's next idle moment. */
const nextIdle = () => new Promise<void>((resolve) => afterIdle(resolve));

function makeHistoryEntry(artboards: ArtboardState[], change: HistoryChange): HistoryEntry {
  const json = JSON.stringify(artboards);
  return {
    ...change,
    id: `h${++historyEntrySeq}`,
    timestamp: Date.now(),
    artboards: JSON.parse(json),
    bytes: json.length,
  };
}

// The recent-projects list, metadata only. Loading full rows parked every
// saved project's artboards (screenshots included, pre-migration) in React
// state for the whole session (issue #19). The list renders id, name and
// timestamp; the one consumer that needs a project's artboards (duplicate)
// does a point read by id. projectData is stubbed empty rather than retyped
// so every existing Project-typed consumer keeps compiling.
//
// Read from two indexes alone, never from the rows: a key read hands back the
// indexed value and the primary key without deserializing the project. This
// runs whenever the open project changes, which with tabs is every tab switch,
// and reading rows would decode every saved project each time only to throw
// the artboards away. The two reads of one index walk it in the same order, and
// one transaction keeps a save from landing between them, so their results line
// up by position. A row with no timestamp is not in that index and so not in
// the list.
async function fetchRecentProjectMetas(): Promise<Project[]> {
  const [ids, timestamps, nameIds, names] = await db.transaction('r', db.projects, () =>
    Promise.all([
      db.projects.orderBy('timestamp').reverse().primaryKeys(),
      db.projects.orderBy('timestamp').reverse().keys(),
      db.projects.orderBy('name').primaryKeys(),
      db.projects.orderBy('name').keys(),
    ])
  );
  const nameOf = new Map<string, string>();
  nameIds.forEach((id, index) => nameOf.set(String(id), String(names[index] ?? '')));
  return ids.map((id, index) => ({
    id: String(id),
    name: nameOf.get(String(id)) ?? '',
    timestamp: timestamps[index] as unknown as Date,
    projectData: [],
  }));
}

// Update the function with reduced margin.
// Also the one place a board's slice of a spanned background picture is
// derived, because that slice is read off the board order exactly like the
// position is, and this runs on every commit (see normalizeBackgroundImage).
function calculateArtboardPositions(artboards: ArtboardState[]): ArtboardState[] {
  let currentX = ARTBOARD_MARGIN;
  return normalizeBackgroundImage(artboards).map((ab) => {
    const newPosition = { x: currentX, y: ARTBOARD_MARGIN };
    // Calculate next position with reduced margin
    currentX += (ab.size.width * DISPLAY_SCALE_FACTOR) + ARTBOARD_MARGIN;
    
    return { ...ab, position: newPosition };
  });
}

// Build a fully-formed element for the desktop MCP server's add_element tool.
// Mirrors the defaults in Artboard.addElement, but constructs the element
// directly (no imperative ref) so a single tool call can create and precisely
// place/style an element in one shot. Caller `props` (position, size, colours,
// content, ...) win over the defaults; discriminant fields are asserted last.
function buildMcpElement(
  type: ElementType,
  subType: string | undefined,
  props: Record<string, any>,
  board: ArtboardState
): ArtboardElement | null {
  const id = `el_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const base = { id, rotation: 0, scale: 1 };
  const centered = (w: number, h: number): Point => ({
    x: Math.max(0, board.size.width / 2 - w / 2),
    y: Math.max(0, board.size.height / 2 - h / 2),
  });
  const sizeOr = (w: number, h: number): Size => (props.size?.width && props.size?.height ? props.size : { width: w, height: h });

  if (type === 'text') {
    const size = sizeOr(400, 100);
    return {
      ...base, content: 'New Text', fontSize: 48, color: '#333333', fontFamily: 'Arial',
      ...props, size, position: props.position ?? centered(size.width, size.height), type: 'text',
    } as TextElementProps;
  }
  if (type === 'image') {
    const size = sizeOr(400, 300);
    return {
      ...base, objectFit: 'cover', opacity: 1, borderRadius: 0,
      ...props, size, position: props.position ?? centered(size.width, size.height), type: 'image',
    } as ImageElementProps;
  }
  if (type === 'shape') {
    if (!subType) return null;
    const size = sizeOr(300, 300);
    const shapeDefaults: Record<string, unknown> = { fillColor: '#5F9EA0', strokeColor: '#333333', strokeWidth: 0, fillOpacity: 1 };
    if (subType === 'rectangle') { shapeDefaults.borderRadius = 0; shapeDefaults.borderRadiusType = 'uniform'; }
    if (subType === 'star') shapeDefaults.customPoints = 5;
    if (subType === 'circle' || subType === 'diamond') shapeDefaults.innerRadius = 0;
    return {
      ...base, ...shapeDefaults,
      ...props, size, position: props.position ?? centered(size.width, size.height),
      type: 'shape', shapeType: subType as ShapeType,
    } as ShapeElementProps;
  }
  if (type === 'device') {
    if (!subType) return null;
    const size = sizeOr(600, 1200);
    const screenshotRect = subType === 'custom'
      ? { left: 5, top: 5, width: 90, height: 90 }
      : { left: 0, top: 0, width: 100, height: 100 };
    return {
      ...base, screenshotRect,
      ...props, size, position: props.position ?? centered(size.width, size.height),
      type: 'device', deviceType: subType as DeviceType,
    } as DeviceFrameElementProps;
  }
  // --- App Preview types ---------------------------------------------------
  // A recording mockup defaults to a flat iPhone: only flat frames composite a
  // live video (3D and perspective poses export as static sprites), so there is
  // no pose or screenshotRect here on purpose.
  if (type === 'video-device') {
    const size = sizeOr(600, 1200);
    return {
      ...base, objectFit: 'cover',
      ...props, size, position: props.position ?? centered(size.width, size.height),
      type: 'video-device', deviceType: (subType as DeviceType) || 'iphone-15-pro',
    } as VideoDeviceElementProps;
  }
  if (type === 'video') {
    const size = sizeOr(600, 1200);
    return {
      ...base, objectFit: 'cover', borderRadius: 0,
      ...props, size, position: props.position ?? centered(size.width, size.height),
      type: 'video',
    } as VideoElementProps;
  }
  if (type === 'gesture') {
    // The hint's box is the area the gesture is drawn in, so a swipe needs room
    // to travel; a tap ripple is square.
    const gestureType = (props.gestureType as GestureType) || (subType as GestureType) || 'tap';
    const vertical = gestureType === 'swipe-up' || gestureType === 'swipe-down';
    const horizontal = gestureType === 'swipe-left' || gestureType === 'swipe-right';
    const size = sizeOr(
      vertical ? 200 : horizontal ? 360 : 150,
      vertical ? 340 : horizontal ? 190 : 150
    );
    return {
      ...base, color: '#4F46E5', triggerTime: 0.5, gestureDuration: 1.2,
      ...props, size, position: props.position ?? centered(size.width, size.height),
      type: 'gesture', gestureType,
    } as GestureElementProps;
  }
  return null;
}

// Read ?projectId synchronously so the FIRST client render already knows whether
// a project is open. Returns null during static prerender (no window) and on a
// fresh visit. This is what stops the "Start a New Project" dialog from flashing
// on refresh when a template is already open: seeding both activeProjectId and
// the dialog's open flag from the URL means no effect briefly forces the selector
// open before a post-mount effect reads the URL. Safe against hydration mismatch
// because this subtree renders client-only (it sits behind the Suspense boundary
// that useSearchParams bails out of during `output: 'export'`).
function getInitialProjectIdFromUrl(): string | null {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get('projectId');
}

// The start dialog's first tab. It holds community posts rather than
// templates, so it is not a TEMPLATE_CATEGORIES entry and carries its own id.
const COMMUNITY_TAB_ID = 'community';

/**
 * Whether this build has a community backend behind it at all.
 *
 * A build-time constant, so a fork of this repo with no VPS gets an editor with
 * no Discover in it rather than one whose compass button opens a dialog that
 * can only say "unavailable". Every entry point below reads this: the rail
 * button, the start dialog's first tab, the toolbar's Share, and the action on
 * the export toast.
 */
const HAS_DISCOVER = isDiscoverConfigured();

// ?post=<id> opens Discover on that post. This is the link "Copy link" hands
// out, so a shared post has to survive a cold load, not just a click inside an
// already open feed.
function getInitialPostIdFromUrl(): string | null {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get('post');
}

// Drop ?post= once the feed is closed, so a reload does not reopen it and the
// projectId handling next to it keeps owning the rest of the query string.
function clearPostParamFromUrl(): void {
  if (typeof window === 'undefined') return;
  const params = new URLSearchParams(window.location.search);
  if (!params.has('post')) return;
  params.delete('post');
  const query = params.toString();
  window.history.replaceState({}, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
}

/**
 * Whether an event happened inside the Agent panel. That panel is a chat, not
 * the canvas: Delete on one of its buttons must not delete a layer.
 */
function isInAgentPanel(target: EventTarget | null): boolean {
  return target instanceof Element && !!target.closest('[data-agent-panel]');
}

/**
 * Whether the words selected on the page are in the Agent panel, so Cmd+C
 * copies them instead of the canvas selection. Asked for that one shortcut
 * only, and a press outside the panel clears such a selection: the canvas
 * prevents the default on pointerdown, so otherwise it would outlive the
 * click and keep Cmd+C copying chat text.
 */
function hasAgentPanelSelection(): boolean {
  if (typeof window === 'undefined') return false;
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed) return false;
  const anchor = selection.anchorNode;
  const element = anchor instanceof Element ? anchor : anchor?.parentElement;
  return !!element?.closest('[data-agent-panel]');
}

/**
 * The artboard under a point in client coordinates, for a palette tile let go
 * there with a finger. elementsFromPoint, not elementFromPoint: on a phone the
 * palette sheet is still mounted over the canvas (faded and click-through, but
 * there), so the board can be the second or third thing under the finger.
 */
function artboardIdAtPoint(point: Point): string | null {
  const node = document
    .elementsFromPoint(point.x, point.y)
    .map((el) => el.closest('[data-artboard-dom-id]'))
    .find((el): el is Element => !!el) ?? null;
  return node?.getAttribute('data-artboard-dom-id') ?? null;
}

/**
 * Whether a palette tile let go there with a finger lands on the canvas. A
 * finger lifted over the toolbar, the sidebar or a panel means never mind, so
 * nothing is added. Anything floating over the canvas still counts, because
 * elementsFromPoint also returns what is underneath it, and a phone's palette
 * sheet goes click-through while a drag is in flight.
 */
function isOverCanvas(point: Point): boolean {
  return document.elementsFromPoint(point.x, point.y).some((el) => el.closest('[data-canvas-area]') !== null);
}

/**
 * Scroll the canvas until a board that just landed has its start on screen.
 * It moves the canvas viewport only, never the page around it.
 */
function revealArtboard(id: string): void {
  // Two frames: the first commits the new board, the second lays it out.
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      const node = document.querySelector(`[data-artboard-dom-id="${CSS.escape(id)}"]`);
      const viewport = node?.closest('[data-radix-scroll-area-viewport]');
      if (!node || !(viewport instanceof HTMLElement)) return;
      const box = node.getBoundingClientRect();
      const view = viewport.getBoundingClientRect();
      const margin = 24;
      const left = box.left < view.left || box.left > view.right - margin ? box.left - view.left - margin : 0;
      const top = box.top < view.top || box.top > view.bottom - margin ? box.top - view.top - margin : 0;
      if (left !== 0 || top !== 0) viewport.scrollBy({ left, top, behavior: 'smooth' });
    })
  );
}

// A one-artboard "Blank Canvas" project at the given size. `size` follows the
// active template tab so a blank Feature Graphic is 1024×500, not a phone.
function createBlankProject(size: Size = { ...DEFAULT_CANVAS_SIZE }): Project {
  return {
    id: 'blank',
    name: 'Blank Canvas',
    description: 'Start with a blank artboard',
    timestamp: new Date(),
    projectData: [{
      id: 'artboard_blank_1',
      name: 'Blank Artboard',
      size: { ...size },
      elements: [],
      backgroundColor: '#FFFFFF',
      zoom: 1,
      position: { x: 50, y: 50 },
    } as ArtboardState],
  };
}

// Owns the search state so keystrokes re-render only the gallery, not the
// whole studio layout (canvas, palette, properties panel).
// `emptyState` renders in place of the search + grid when this category has no
// templates yet (e.g. Feature Graphic before any are authored).
function TemplateGallery({ projects, onSelect, isLoading, emptyState, previewAspect, previewFit, gridClassName }: { projects: Project[]; onSelect: (project: Project) => void; isLoading?: boolean; emptyState?: React.ReactNode; previewAspect: string; previewFit: 'cover' | 'contain'; gridClassName: string }) {
  const [searchQuery, setSearchQuery] = useState('');
  const deferredQuery = useDeferredValue(searchQuery);
  const normalizedQuery = deferredQuery.trim().toLowerCase();
  const filteredTemplates = normalizedQuery
    ? projects.filter((project) => {
        const haystack = `${project.name} ${project.description ?? ''}`.toLowerCase();
        // Space-insensitive pass so e.g. "playstore" still matches "Play Store".
        return haystack.includes(normalizedQuery)
          || haystack.replace(/\s+/g, '').includes(normalizedQuery.replace(/\s+/g, ''));
      })
    : projects;

  // Category with no templates authored yet: skip search + grid entirely.
  if (!isLoading && projects.length === 0 && emptyState) {
    return <div className="min-h-0 flex-1 overflow-y-auto">{emptyState}</div>;
  }

  const gridClass = cn('grid gap-5 p-4', gridClassName);

  return (
    <>
      <div className="relative px-1">
        <SearchIcon className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          placeholder="Search templates by name or description..."
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          className="pl-9"
          disabled={isLoading}
        />
      </div>
      {/* Native scroll: a Radix ScrollArea viewport's h-full can't resolve here
          because the dialog is max-h-capped, not fixed-height. */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading ? (
          <div className={gridClass}>
            {Array.from({ length: 6 }).map((_, index) => (
              <Card key={index} className="overflow-hidden">
                <CardHeader className="p-0">
                  <Skeleton className="w-full rounded-none rounded-t-lg" style={{ aspectRatio: previewAspect }} />
                </CardHeader>
                <CardContent className="p-4 space-y-2">
                  <Skeleton className="h-5 w-2/3" />
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-4 w-4/5" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
        <TooltipProvider delayDuration={250}>
          <div className={gridClass}>
            {filteredTemplates.length === 0 && (
              <p className="col-span-full py-8 text-center text-sm text-muted-foreground">
                {`No templates match "${deferredQuery.trim()}".`}
              </p>
            )}
            {filteredTemplates.map((project: Project) => {
              const screens = project.projectData?.length ?? 0;
              // Real strip previews (contain) must never be cropped; placeholder
              // previews (placehold.co) have no meaningful edges, so let them
              // fill the box instead of floating in it.
              const isPlaceholder = !project.previewImage || project.previewImage.includes('placehold.co');
              const fitClass = !isPlaceholder && previewFit === 'contain' ? 'object-contain' : 'object-cover';
              const card = (
                <Card
                  className="group flex flex-col overflow-hidden border transition-all cursor-pointer hover:-translate-y-0.5 hover:border-primary/50 hover:shadow-xl"
                  onClick={() => onSelect(project)}
                >
                  <CardHeader className="p-0">
                    <div className="relative w-full overflow-hidden rounded-t-lg bg-muted" style={{ aspectRatio: previewAspect }}>
                      {project.previewImage && (
                         <Image
                          src={withBasePath(project.previewImage)}
                          alt={project.name}
                          fill
                          sizes="(max-width: 640px) 90vw, (max-width: 1024px) 45vw, 700px"
                          className={cn('transition-transform duration-300 group-hover:scale-[1.03]', fitClass)}
                          data-ai-hint={project.description || "project design"}
                        />
                      )}
                      {screens > 1 && (
                        <span className="absolute right-2 top-2 z-10 rounded-full bg-background/85 px-2 py-0.5 text-[11px] font-medium tabular-nums text-foreground shadow-sm backdrop-blur">
                          {screens} screens
                        </span>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="p-4">
                    <CardTitle className="mb-1 text-base">{project.name}</CardTitle>
                    <CardDescription className="line-clamp-2 text-sm">{project.description}</CardDescription>
                  </CardContent>
                </Card>
              );

              if (!project.description) {
                return <div key={project.id}>{card}</div>;
              }

              return (
                <Tooltip key={project.id}>
                  <TooltipTrigger asChild>{card}</TooltipTrigger>
                  <TooltipContent side="bottom" align="center" className="z-[60] max-w-xs whitespace-normal text-sm">
                    {project.description}
                  </TooltipContent>
                </Tooltip>
              );
            })}
          </div>
        </TooltipProvider>
        )}
      </div>
    </>
  );
}

export function OpenScreenshotGeneratorLayout() {
  // Set when this window was opened for a tab moved out of another one
  // (src/lib/tabs/tabWindows.ts). Such a window keeps out of everything only
  // one window may run: the MCP bridge, the coding agents, detached panels.
  const [tabWindowKeyValue] = useState(() => tabWindowKey());
  const isSecondaryWindow = tabWindowKeyValue !== null;
  const [artboards, setArtboards] = useState<ArtboardState[]>([]);
  const [activeArtboardId, setActiveArtboardId] = useState<string | null>(null);
  const [canvasZoom, setCanvasZoom] = useState(1);
  // Read when a tab is left, to keep where its canvas was (see parkOutgoingRef).
  const activeArtboardIdRef = useRef<string | null>(null);
  activeArtboardIdRef.current = activeArtboardId;
  const canvasZoomRef = useRef(1);
  canvasZoomRef.current = canvasZoom;

  // --- locale overlay -------------------------------------------------------
  // `artboards` above ALWAYS means the whole base document, every language.
  // One language is `viewArtboards`, derived below and handed only to the
  // canvas and the preview. Storing a projection in `artboards` would persist
  // one language's text as everybody's text, so it never happens.
  const [activeLocale, setActiveLocale] = useState<string | null>(null);
  // Read instead of the state inside commitView: DraggableElement commits on a
  // document-level mouseup, so a drag started before a language switch would
  // otherwise fold its result into the wrong language.
  const activeLocaleRef = useRef<string | null>(null);
  const [isLanguageManagerOpen, setIsLanguageManagerOpen] = useState(false);
  const [isTranslationTableOpen, setIsTranslationTableOpen] = useState(false);
  const [translationTableLocale, setTranslationTableLocale] = useState<string | null>(null);
  const [translationTableFilter, setTranslationTableFilter] = useState<'all' | 'untranslated'>('all');
  // Live readout for machine translation, which is one network round trip per
  // distinct string and can run for a minute across several languages.
  const [translateProgress, setTranslateProgress] = useState<TranslateProgress | null>(null);
  const [isCancellingTranslate, setIsCancellingTranslate] = useState(false);
  const translateAbortRef = useRef<AbortController | null>(null);
  // A machine translation path exists at all. Set in an effect, never during
  // render: it reads localStorage and isTauri(), both of which are absent on
  // the server and on the first client render.
  const [translationAvailable, setTranslationAvailable] = useState(false);
  useEffect(() => {
    setTranslationAvailable(availableEngines().length > 0);
  }, []);
  // Set for exactly as long as an export or a store upload has a converted or
  // re-projected list on the canvas. It closes the mutation door, so an MCP
  // call or a stray drag landing mid-swap cannot write a temporary render into
  // the project.
  const isExportingRef = useRef(false);
  /**
   * The newest thing the room said while an export was holding the canvas.
   *
   * An export swaps a converted list onto the canvas for a few seconds, and
   * applying a peer's change on top of that would persist the converted list as
   * the project. So the change waits here and lands when the run finishes;
   * only the last one is kept, because a CRDT hands over whole states rather
   * than a queue of steps.
   */
  const pendingRemoteRef = useRef<{ boards: ArtboardState[]; name: string | null } | null>(null);
  const flushPendingRemote = () => {
    const pending = pendingRemoteRef.current;
    if (!pending) return;
    pendingRemoteRef.current = null;
    remoteArtboardsRef.current(pending.boards, pending.name);
  };
  // What the canvas paints while that swap is up. Non-null only during a run,
  // and already resolved for its language, so it must NOT be projected again.
  const [exportCanvasArtboards, setExportCanvasArtboards] = useState<ArtboardState[] | null>(null);
  // Said once per session, the first time a shared property is edited from a
  // translated language.
  const sharedEditNoticeShownRef = useRef<{ locale: string | null; at: number }>({ locale: null, at: 0 });
  /**
   * What an edit made while viewing a translated language means.
   *
   * Defaults to 'local' because that is what people mean: if you are looking at
   * German and you drag a box taller, it is because the German string overran
   * it. Making that reach every language is the behaviour that reads as broken.
   * Design changes belong in the base language, where they still reach
   * everything. 'shared' is here for the times you want a design change without
   * switching languages first.
   */
  const [localeEditScope, setLocaleEditScope] = useState<'local' | 'shared'>('local');
  const localeEditScopeRef = useRef<'local' | 'shared'>('local');
  useEffect(() => { localeEditScopeRef.current = localeEditScope; }, [localeEditScope]);
  // The base document, readable without waiting for a re-render. Frozen during
  // an export so the temporary canvas list can never be mistaken for the
  // project. commitView, the MCP tools and Duplicate project all read this.
  const artboardsRef = useRef<ArtboardState[]>(artboards);
  if (!isExportingRef.current) artboardsRef.current = artboards;
  // Undo stack and the History panel are the same list: every entry is a full
  // project snapshot plus the name of the change that produced it.
  const [history, setHistory] = useState<HistoryEntry[]>(() => [makeHistoryEntry([], namedChange('New Document', 'open'))]);
  const [historyIndex, setHistoryIndex] = useState(0);
  // Read by the live session, which arrives from a socket rather than from a
  // render and so cannot close over state.
  const historyIndexRef = useRef(0);
  historyIndexRef.current = historyIndex;
  // The stack itself, for the tab being left (see parkOutgoingRef).
  const historyRef = useRef(history);
  historyRef.current = history;
  // Seed from the URL: closed when refreshing straight into an open project
  // (?projectId present), open on a fresh visit. Prevents the selector flashing
  // open-then-closed on refresh. See getInitialProjectIdFromUrl.
  const [isTemplateSelectorOpen, setIsTemplateSelectorOpen] = useState(
    () => getInitialProjectIdFromUrl() === null
  );
  // A ?shared= link is arriving. Seeded from the URL for the same reason the
  // line above is: the import is a network round trip, and without this the
  // start dialog and the tips wizard both open in front of it and then close
  // themselves a second later.
  const [isOpeningSharedLink, setIsOpeningSharedLink] = useState(
    () => readSharedSlugFromUrl() !== null
  );
  // A live-session invite is arriving, for the same reason and with the same
  // effect: nothing else may claim the canvas while the room is being joined.
  const [isJoiningInvite, setIsJoiningInvite] = useState(() => readInviteFromUrl() !== null);
  /** The invite waiting on a sign-in, or on the join itself. */
  const [pendingInvite, setPendingInvite] = useState<CollabInvite | null>(null);
  const [isCollabOpen, setIsCollabOpen] = useState(false);
  const [isCollabWorking, setIsCollabWorking] = useState(false);
  /**
   * The room this project has an invite for, whether or not a session is up.
   *
   * Read from the project's cloud link, which is where the key is remembered.
   * A live session's own room outranks it (see `collabRoom` below), because a
   * guest is in a room their local copy knows nothing about.
   */
  const [collabInvite, setCollabInvite] = useState<CollabInvite | null>(null);
  /** Which project the open room belongs to, so switching project leaves it. */
  const collabProjectRef = useRef<string | null>(null);
  // Which screen of the start dialog is showing. The template gallery is the
  // dialog, as it always was; the agent is a screen you step into from the
  // banner above it. Reset on open so reopening never lands mid-agent-flow.
  const [dialogView, setDialogView] = useState<'templates' | 'agent' | 'quickstart' | 'graphics'>(
    'templates'
  );
  // Latches once the quick start has been opened, so it can stay mounted behind
  // the other views without being built for every session that never uses it.
  const [quickstartOpened, setQuickstartOpened] = useState(false);
  useEffect(() => {
    if (dialogView === 'quickstart') setQuickstartOpened(true);
  }, [dialogView]);
  // The same latch for the graphics screen, and for the same reason: it holds
  // the uploaded set, the app name and the colour, so stepping over to the
  // template gallery and back must not empty it.
  const [graphicsOpened, setGraphicsOpened] = useState(false);
  useEffect(() => {
    if (dialogView === 'graphics') setGraphicsOpened(true);
  }, [dialogView]);
  // Where the agent screen was opened from, so its Back button returns there
  // instead of always dumping the user on the template gallery. Arriving from
  // the quick start and going back to a grid of templates loses the upload from
  // view and reads as a dead end.
  const [agentReturnView, setAgentReturnView] = useState<'templates' | 'quickstart'>('templates');
  /**
   * Opens the start dialog on a given view, defaulting to the template gallery.
   *
   * Every open goes through here rather than flipping `isTemplateSelectorOpen`
   * on its own: the dialog keeps whichever view it was closed on, so reopening
   * it from the toolbar used to land mid-flow — on the quick start screen, say,
   * with Back the only way out — instead of at the start it was asked for.
   */
  const openStartDialog = useCallback((view: 'templates' | 'quickstart' | 'graphics' = 'templates') => {
    setDialogView(view);
    setAgentReturnView('templates');
    setIsTemplateSelectorOpen(true);
  }, []);
  // Files dropped anywhere in the start dialog, handed to one intake screen.
  //
  // `target` matters: both intake screens stay mounted once opened, and each
  // drains a batch it has not seen by token. Without a target, a drop meant for
  // the graphics screen would also land in the screenshot deck, and whichever
  // effect ran first would clear the batch out from under the other.
  const [pendingIntakeFiles, setPendingIntakeFiles] = useState<
    { files: File[]; token: number; target: 'quickstart' | 'graphics' } | null
  >(null);
  // Screenshots handed from the quick start to the AI agent, so switching to it
  // does not throw the upload away. The token re-seeds the agent's own state.
  const [agentHandoff, setAgentHandoff] = useState<{ shots: UploadedScreenshot[]; token: number } | null>(null);
  // A ref rather than the state itself, so the two window keydown effects can
  // stand down while the dialog is open without either of them gaining a
  // dependency and re-subscribing on every open and close.
  const isTemplateSelectorOpenRef = useRef(false);
  useEffect(() => {
    isTemplateSelectorOpenRef.current = isTemplateSelectorOpen;
  }, [isTemplateSelectorOpen]);

  // Startup tips. Opens in front of the start dialog (which is suppressed
  // while it is up, see the Dialog below) until the user unticks its box.
  // The default has to match what the static export rendered, so the stored
  // preference is read in a layout effect: it lands before first paint, and
  // the start dialog never flashes open behind the tips.
  const [isTipsOpen, setIsTipsOpen] = useState(false);
  useLayoutEffect(() => {
    // Not in front of an arriving ?shared= link: somebody who followed a link to
    // a design should land on the design, not on a wizard about this editor.
    if (readSharedSlugFromUrl()) return;
    if (shouldShowTipsOnStartup()) setIsTipsOpen(true);
  }, []);
  // Settings. Same footer slot the Tips button held, and the way back to the
  // tips wizard now that it is a section in here rather than its own button.
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  // Discover, the community feed. Reachable from the palette rail, from the
  // start dialog's first tab, from the toolbar, and by a ?post= link, which is
  // what Copy link on a post hands out.
  const [isDiscoverOpen, setIsDiscoverOpen] = useState(() => getInitialPostIdFromUrl() !== null);
  const [discoverPostId, setDiscoverPostId] = useState<string | null>(() =>
    getInitialPostIdFromUrl()
  );
  // Which screen the feed opens on. 'share' is how the toolbar button and the
  // "share these" action on the export toast skip straight to the share form.
  const [discoverIntent, setDiscoverIntent] = useState<'feed' | 'share'>('feed');
  // The start dialog opens on the community tab: a finished listing somebody
  // shipped is a better answer to "what should mine look like" than a grid of
  // empty templates, and the templates are one tab away.
  const [templateTab, setTemplateTab] = useState<string>(
    HAS_DISCOVER ? COMMUNITY_TAB_ID : (TEMPLATE_CATEGORIES[0]?.id ?? COMMUNITY_TAB_ID)
  );
  const [availableProjects, setAvailableProjects] = useState<Project[]>([]);
  const [isLoadingProjects, setIsLoadingProjects] = useState(true);
  // Load-progress feedback for the top status bar. 'templates' = fetching the
  // template gallery on startup (determinate: done/total); 'project' = opening a
  // template/saved project into the canvas (determinate whenever the loader
  // reports steps, see projectLoadStatus). 'idle' hides the bar.
  const [loadPhase, setLoadPhase] = useState<'idle' | 'templates' | 'project'>('templates');
  const [templateProgress, setTemplateProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 });
  /**
   * What the project open is doing right now, for the status bar and the canvas
   * card. Only the remote paths (your own storage, our cloud, a share link) fill
   * this in: they are the ones that take long enough for "it is doing nothing"
   * to be the natural reading, and their loaders already count the files they
   * are moving. A local IndexedDB open leaves it null and keeps the sweep.
   */
  const [projectLoadStatus, setProjectLoadStatus] = useState<ProjectLoadStep | null>(null);
  const { toast } = useToast();
  // Desktop updates (lib/updates). The main window asks the update server on a
  // schedule and answers Help > Check for updates; the other editor windows
  // only write their edits when an install asks them to (see below).
  useUpdateSchedule(!isSecondaryWindow, (result) => {
    const message = manualCheckToast(result);
    if (message) toast(message);
  });
  const artboardRefs = useRef<Record<string, any>>({});
  // Latest design-tool API for the desktop MCP server; assigned each render and
  // read per request by the bridge (see the block above the render return).
  const mcpApiRef = useRef<McpDesignApi | null>(null);
  /**
   * Which layers are selected on the active artboard, in the order they were
   * picked. Always board-scoped: CanvasArea hands it only to the board whose id
   * is active, so a selection cannot straddle two boards, which is just as well
   * because two boards share no coordinate space to align across.
   */
  const [selectedElementIds, setSelectedElementIds] = useState<string[]>([]);
  /**
   * The selection when it holds exactly one layer.
   *
   * Everything that edits or describes "the selected element" reads this, so a
   * form, a translate action or a device swap aimed at one layer can never fire
   * against several without saying which. Code asking whether ANYTHING is
   * selected has to test `selectedElementIds.length` instead: this is null both
   * for an empty selection and for a selection of five.
   */
  const selectedElementIdOnActiveArtboard = useMemo(
    () => (selectedElementIds.length === 1 ? selectedElementIds[0] : null),
    [selectedElementIds]
  );
  /** The layer a single-select write means. Keeps the existing call sites honest. */
  const setSelectedElementIdOnActiveArtboard = useCallback((elementId: string | null) => {
    setSelectedElementIds(elementId ? [elementId] : []);
  }, []);
  // Read by the keyboard listener and the canvas drag, neither of which may
  // re-subscribe every time the selection changes.
  const selectedElementIdsRef = useRef(selectedElementIds);
  selectedElementIdsRef.current = selectedElementIds;
  // Custom right-click menu over the canvas. pastePoint is the click location
  // in artboard coordinates so Paste can drop the element under the cursor.
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    elementId: string | null;
    artboardId: string | null;
    pastePoint: Point | null;
  } | null>(null);
  const canvasContainerRef = useRef<HTMLDivElement>(null);

  // The headless bridge the npm CLI drives (window.__osg). The host object is
  // rebuilt on every render because it closes over the handlers, so the effect
  // installs a delegate that always reads the latest one through this ref.
  // Nothing is installed unless the driver set window.__OSG_HEADLESS before
  // navigation, so an ordinary browser session never grows a global.
  const headlessHostRef = useRef<HeadlessHost | null>(null);
  useEffect(
    () =>
      installHeadlessBridge({
        getMcpApi: () => headlessHostRef.current?.getMcpApi() ?? null,
        exportImages: (selection) => headlessHostRef.current!.exportImages(selection),
        exportVideo: (request) => headlessHostRef.current!.exportVideo(request),
        capture: (ids, formatId, locale) => headlessHostRef.current!.capture(ids, formatId, locale),
        loadProject: (data, name, id) => headlessHostRef.current!.loadProject(data, name, id),
        getStatus: () => headlessHostRef.current!.getStatus(),
      }),
    []
  );

  // Start the desktop MCP bridge (desktop only): handle requests the Rust
  // transport forwards, and surface the connection URL when the user toggles
  // the server on from the Settings menu.
  useEffect(() => {
    // One window answers MCP requests: Rust gives the bridge's nonce to `main`
    // only, so a window a tab was moved into would only log a refusal.
    if (!isTauri() || isSecondaryWindow) return;
    let disposeBridge: () => void = () => {};
    let disposeStatus: () => void = () => {};
    let cancelled = false;
    (async () => {
      disposeBridge = await startDesktopMcpBridge(() => mcpApiRef.current);
      if (cancelled) return disposeBridge();
      disposeStatus = await listenMcpStatus((status) => {
        toast(
          status.running && status.url
            ? { title: 'MCP server on', description: `External AI tools can connect at ${status.url}` }
            : { title: 'MCP server off', description: 'External AI tools can no longer reach this app.' }
        );
      });
      if (cancelled) return disposeStatus();
      const status = await getMcpStatus();
      if (status.running && status.url) {
        console.info(`[MCP] Open Screenshot Generator design tools available at ${status.url}`);
      }
    })();
    return () => {
      cancelled = true;
      disposeBridge();
      disposeStatus();
    };
  }, [toast]);
  const [selectedElementDetails, setSelectedElementDetails] = useState<ArtboardElement | null>(null);
  const [activeTool, setActiveTool] = useState<'select' | 'pan'>('select');
  // Seed from the URL so the project-loading and selector effects see the real
  // active id on the first render instead of a transient null (which would force
  // the template dialog open for a frame on refresh). See getInitialProjectIdFromUrl.
  const [activeProjectId, setActiveProjectId] = useState<string | null>(getInitialProjectIdFromUrl);
  // Bumped by every path that puts a project on the canvas: a template, a recent
  // project, an import, the cloud, a shared link. The id cannot carry that on
  // its own, since restoring the cloud copy of the project that is already open
  // keeps the same id. Only the cloud auto saver reads it, to start again.
  const [projectOpenToken, setProjectOpenToken] = useState(0);
  const [currentProjectName, setCurrentProjectName] = useState<string>('Untitled Project');
  // Same reason as historyIndexRef: the live session reads these from callbacks
  // that were created before the current render.
  const projectNameRef = useRef(currentProjectName);
  projectNameRef.current = currentProjectName;
  const activeProjectIdRef = useRef<string | null>(null);
  activeProjectIdRef.current = activeProjectId;
  // The project whose document the canvas holds. The loader effect reads a
  // project out of Dexie only when activeProjectId names a different one, so
  // every path that puts a document on the canvas itself (loadProjectFromData,
  // the first edit of a canvas with no project) sets this before it sets the
  // id. Reading the row back after that would replace the canvas and the undo
  // stack with the row as it was when the read began, and drop every edit made
  // in between.
  const loadedProjectIdRef = useRef<string | null>(null);
  // Counts the documents that have gone onto the canvas: it moves on every
  // write of loadedProjectIdRef, the same project opened again included.
  const canvasSerialRef = useRef(0);
  // Commits write the open project's row through this queue once the edits go
  // quiet (src/lib/projectSaveQueue.ts). Made once, because a write it holds
  // has to outlive the render that scheduled it.
  const [projectSaves] = useState(() =>
    createProjectSaveQueue((save) =>
      db.projects
        .put({
          id: save.id,
          name: save.name,
          timestamp: new Date(),
          projectData: JSON.parse(JSON.stringify(save.artboards)),
        })
        .catch((error) => {
          console.error("Error saving project to Dexie:", error);
        })
    )
  );
  // Where a tab's undo stack waits while the tab is out of memory
  // (src/lib/tabs/historyStore.ts): written once as it sleeps, moves to another
  // window or closes, and read back when it opens. It counts for as long as this
  // window lives, so a reload still starts undo over (rule 28).
  const [undoStore] = useState(() =>
    createUndoStore(indexedDbUndoStorage(), {
      build: packageJson.version,
      sitting: EDITOR_WINDOW_ID,
      liveSittings: liveEditorWindowIds,
    })
  );
  const saveUndo = useCallback(
    (projectId: string, snapshot: UndoSnapshot, options?: SaveOptions): Promise<void> => {
      // Only while this window has the project. A save that comes due after
      // the project went to another window would write over that window's.
      if (!mayWriteProject(projectId)) return Promise.resolve();
      return undoStore.save(projectId, snapshot, options).catch((error) => {
        console.error('Could not keep the undo history of', projectId, error);
      });
    },
    [undoStore]
  );
  // Assigned in the tab block below, where the canvas state it reads exists.
  const readActiveTabViewRef = useRef<() => { projectId: string; view: TabView } | null>(() => null);
  // Tabs that fell asleep changed, for the question closing one asks
  // (tabHasChanges): what said so is on disk with the undo stack by then.
  const sleptWithChangesRef = useRef(new Set<string>());
  // The tab strip (src/lib/tabs). Every path that opens a project goes through
  // putProjectOnCanvas below, which is what parks the project being left in its
  // tab, and through activeProjectId, which is what gives a project its tab.
  const projectTabs = useProjectTabs({
    windowKey: tabWindowKeyValue,
    // Its project is saved already. What sleep would lose is its undo stack,
    // written at the next idle moment: a tab can fall asleep in the middle of a
    // switch, when the budget needs the room. A read of it waits for the write.
    onSleep: (project) => {
      if (!project.openedSnapshot) sleptWithChangesRef.current.add(project.projectId);
      void saveUndo(project.projectId, undoSnapshotOf(project), { after: nextIdle() });
    },
    readView: () => readActiveTabViewRef.current(),
  });
  const projectTabsParking = projectTabs.parking;
  const noteTabEdit = projectTabs.noteEdit;
  // Assigned further down, once every piece of state they read exists.
  const parkOutgoingRef = useRef<(projectId: string) => void>(() => {});
  const restoreParkedRef = useRef<(parked: ParkedProject) => void>(() => {});
  const applyTabViewRef = useRef<(projectId: string, boards: ArtboardState[]) => void>(() => {});
  // The id of a project opened from the template gallery, until its tab exists.
  const previewProjectIdRef = useRef<string | null>(null);
  // Locks the tab lock effect must leave alone, counted: taken by an open that
  // has not reached the canvas yet, or kept by a tab on its way to another
  // window until its undo stack is written (letTabGo).
  const pinnedLocksRef = useRef(new Map<string, number>());
  const pinLock = (projectId: string) =>
    pinnedLocksRef.current.set(projectId, (pinnedLocksRef.current.get(projectId) ?? 0) + 1);
  const hasTab = projectTabs.has;
  /** Let go of a project's lock once nothing here has it: no tab, not on the canvas, not pinned. */
  const letGoIfUnused = useCallback(
    (projectId: string) => {
      if (pinnedLocksRef.current.has(projectId) || loadedProjectIdRef.current === projectId || hasTab(projectId)) return;
      releaseProjectLock(projectId);
    },
    [hasTab]
  );
  /** Done with a pinned lock. Let go of it too when nothing here has the project. */
  const settleLock = (projectId: string) => {
    const left = (pinnedLocksRef.current.get(projectId) ?? 1) - 1;
    if (left > 0) {
      pinnedLocksRef.current.set(projectId, left);
      return;
    }
    pinnedLocksRef.current.delete(projectId);
    letGoIfUnused(projectId);
  };
  /**
   * Take a project's lock for an open, before anything of it is written or
   * shown, or refuse with ProjectOpenElsewhereError. Pinned until `settleLock`.
   */
  const claimProject = async (projectId: string, name: string, waitMs = 0) => {
    pinLock(projectId);
    if (await holdProjectLock(projectId, { waitMs })) return;
    settleLock(projectId);
    throw new ProjectOpenElsewhereError(projectId, name);
  };
  // Projects another window is handing to this one. Opening one of them waits
  // a moment for that window to let go, instead of calling it taken. A window
  // a tab was moved into starts out waiting for that tab.
  const awaitedHandOversRef = useRef(new Set<string>(isSecondaryWindow && activeProjectId ? [activeProjectId] : []));
  // The opens of a project still under way, by project: a tab's read of its
  // project, an open from a file, the account or the cloud. A tab leaving for
  // another window stops them and waits for them (letTabGo): left to finish,
  // one would write the project or put it back on this canvas after the other
  // window took it, and both would save it.
  const pendingOpensRef = useRef(
    new Map<string, Set<{ stop: () => void; settled: Promise<void>; tabRead: boolean }>>()
  );
  /**
   * Stop the opens of the project under way here. Resolves once they have
   * stopped. A tab that closes stops only its own read: an open somebody asked
   * for (from a file, the account, the cloud) goes on and opens a tab again.
   */
  const stopOpening = (projectId: string, why: 'moved' | 'closed' = 'moved'): Promise<unknown> => {
    const opens = [...(pendingOpensRef.current.get(projectId) ?? [])].filter(
      (open) => why === 'moved' || open.tabRead
    );
    for (const open of opens) open.stop();
    return Promise.all(opens.map((open) => open.settled));
  };
  /**
   * Note an open of `projectId` that awaits something before the project is on
   * the canvas, so stopOpening can stop it. It checks `stopped` after each
   * await, and calls `end` once it is done either way. A stop waits for the
   * end, except while `importing`: an import from the account or the cloud
   * writes nothing of the project until its row, which goes through `write`,
   * so a stop before that lets the tab go at once rather than after the
   * pictures and fonts are in, and `write` refuses the row from then on.
   */
  const beginOpen = (projectId: string, { tabRead = false, importing = false } = {}) => {
    let stopped = false;
    let writing = 0;
    let settle!: () => void;
    const open = {
      tabRead,
      stop: () => {
        stopped = true;
        if (importing && writing === 0) settle();
      },
      settled: new Promise<void>((resolve) => {
        settle = resolve;
      }),
    };
    const opens = pendingOpensRef.current.get(projectId) ?? new Set<typeof open>();
    opens.add(open);
    pendingOpensRef.current.set(projectId, opens);
    return {
      stopped: () => stopped,
      write: async (run: () => Promise<unknown>): Promise<unknown> => {
        if (stopped || !mayWriteProject(projectId)) throw new OpenStoppedError(projectId);
        writing += 1;
        try {
          return await run();
        } finally {
          writing -= 1;
          if (stopped && writing === 0) settle();
        }
      },
      end: () => {
        opens.delete(open);
        if (opens.size === 0 && pendingOpensRef.current.get(projectId) === opens) pendingOpensRef.current.delete(projectId);
        settle();
      },
    };
  };
  const putProjectOnCanvas = useCallback((projectId: string) => {
    // The project leaving the canvas waits in its tab, undo stack and all,
    // before anything of the incoming one is set. Whatever was parked for the
    // incoming id is being replaced by the document about to go on the canvas.
    const outgoing = loadedProjectIdRef.current;
    if (outgoing && outgoing !== projectId) parkOutgoingRef.current(outgoing);
    projectTabsParking.drop(projectId);
    // The project leaving the canvas took edits up to this moment, and a save
    // of them may still be waiting. It is written now, before the next
    // project's first edit schedules a save of its own.
    const written = projectSaves.flushOtherThan(projectId);
    loadedProjectIdRef.current = projectId;
    canvasSerialRef.current += 1;
    // One whose tab closed while this one was read kept its lock only for being
    // on the canvas. It lets go once those last edits are written.
    if (outgoing && outgoing !== projectId) void written.then(() => letGoIfUnused(outgoing));
  }, [projectSaves, projectTabsParking, letGoIfUnused]);
  // The document this render's artboards are, read once per render. Every
  // commit path and the design-tool api check it with canvasStillHolds before
  // they write: while a project opens, the canvas still holds the project
  // before it, or nothing after a reload, and a commit made from that would be
  // saved under the incoming project's id.
  const renderedCanvasProjectId = loadedProjectIdRef.current;
  const renderedCanvasSerial = canvasSerialRef.current;
  const renderedCanvas = useMemo<RenderedCanvas>(
    () => ({ activeProjectId, canvasProjectId: renderedCanvasProjectId, serial: renderedCanvasSerial }),
    [activeProjectId, renderedCanvasProjectId, renderedCanvasSerial]
  );
  const [recentProjects, setRecentProjects] = useState<Project[]>([]);
  const [recentProjectSearch, setRecentProjectSearch] = useState('');
  const [projectToDelete, setProjectToDelete] = useState<string | null>(null);
  // Set while a recent-projects row is being copied, so its button can show a
  // spinner: bundling a project reads every media blob out of Dexie.
  const [duplicatingProjectId, setDuplicatingProjectId] = useState<string | null>(null);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  // Which view the preview opens on. The toolbar's Preview menu points at one
  // directly, so the store mockup is reachable without a detour.
  const [previewMode, setPreviewMode] = useState<PreviewMode>('single');
  const openPreview = useCallback((mode: PreviewMode = 'single') => {
    setPreviewMode(mode);
    setIsPreviewOpen(true);
  }, []);
  const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);
  // Direct-to-store upload (App Store Connect / Google Play). Desktop only,
  // see src/lib/publish; the dialog explains itself on the web build.
  const [isPublishDialogOpen, setIsPublishDialogOpen] = useState(false);
  // Growth: the app's App Store numbers, reviews and listing (src/lib/growth).
  // Its tab is chosen by whoever opens it: the toolbar opens the overview, the
  // upload dialog's "see how they do" opens the timeline.
  const [growthOpen, setGrowthOpen] = useState<GrowthTab | null>(null);
  // While the desktop app runs, Growth keeps the apps synced there fresh and
  // says when something new turns up (src/lib/growth/monitor.ts). The main
  // window only: a tab window would sync the same apps a second time.
  const growthMonitor = useGrowthMonitor({
    enabled: isTauri() && !isSecondaryWindow,
    paused: growthOpen !== null,
    onFound: (findings) => {
      const [first] = findings;
      const count = findings.reduce((sum, finding) => sum + finding.fresh.length, 0);
      toast({
        title:
          findings.length === 1
            ? `${first.app.name}: ${count === 1 ? 'a new insight' : `${count} new insights`}`
            : `${count} new insights in Growth`,
        description: first.fresh[0].title,
        action: (
          <ToastAction
            altText="Open the insights in Growth"
            onClick={() => {
              setGrowthSettings({ appId: first.app.id });
              setGrowthOpen('insights');
            }}
          >
            Open
          </ToastAction>
        ),
      });
    },
  });
  // Languages the Growth window asked for, ticked when the language manager opens.
  const [languagePreselect, setLanguagePreselect] = useState<string[] | undefined>(undefined);
  // The App Store header and search dialog. Opened from the store preview, it
  // closes the preview (a Radix dialog cannot sit above that overlay) and puts
  // it back once the art is on the canvas.
  const [isCreativeDialogOpen, setIsCreativeDialogOpen] = useState(false);
  const creativeReturnsToStoreRef = useRef(false);
  // Seeds the export dialog's "Selected artboard only" box. The toolbar's
  // Download opens the dialog project-wide; an artboard's own Download opens
  // it already scoped to that board.
  const [exportScopedToArtboard, setExportScopedToArtboard] = useState(false);
  // Live PNG export readout. Non-null for exactly as long as a run is in
  // flight, which is also what keeps the progress dialog on screen. Cancel is
  // a ref, not state, because the capture loop reads it between files and
  // must see the latest value without a re-render.
  const [pngProgress, setPngProgress] = useState<PngExportProgress | null>(null);
  const [isCancellingPngExport, setIsCancellingPngExport] = useState(false);
  const pngExportCancelRef = useRef(false);
  // App Preview video export: per-board analysis (which boards carry video
  // content) is recomputed when the export dialog opens; progress/abort state
  // drives the dialog's render section.
  const [videoInfos, setVideoInfos] = useState<Record<string, ArtboardVideoInfo>>({});
  const [isVideoExporting, setIsVideoExporting] = useState(false);
  const [videoProgress, setVideoProgress] = useState<VideoExportProgress | null>(null);
  const videoExportAbortRef = useRef<AbortController | null>(null);
  const [isAboutOpen, setIsAboutOpen] = useState(false);
  // Cloud account (Bring-Your-Own-Storage). `accountHint` is set when the
  // dialog is opened from a gated action so it can explain why it appeared.
  const [isAccountOpen, setIsAccountOpen] = useState(false);
  const [accountHint, setAccountHint] = useState<string | undefined>(undefined);
  // Which of the account dialog's two project lists to land on. Set by whichever
  // entry point opened it: "Your cloud projects" wants the cloud list, and
  // "From your own storage" wants the other one.
  const [accountTab, setAccountTab] = useState<'cloud' | 'storage'>('cloud');
  const [isSavingToAccount, setIsSavingToAccount] = useState(false);
  // Set when a save would land on top of a copy already in the account: holds
  // that copy while the user picks replace or save-as-new.
  const [saveConflict, setSaveConflict] = useState<CloudProjectSummary | null>(null);
  /**
   * True when the dialog above is answering a SYNC conflict rather than an
   * ordinary second save. The two have the same three answers, so they share a
   * dialog; only the wording and the "stop syncing this one" way out differ.
   */
  const [conflictFromSync, setConflictFromSync] = useState(false);
  const { session: accountSession, isSignedIn: isAccountConnected } = useAccount();

  // Our own cloud (src/lib/cloud). Distinct from the account above, which is
  // storage the user owns: this is a copy on our PocketBase, and it is what
  // makes a shareable project link possible at all. Its list lives inside the
  // account dialog, on a tab beside the storage one, so there is no second
  // open-state to track here.
  const [isSavingToCloud, setIsSavingToCloud] = useState(false);
  // Set when a cloud save would land on top of a copy this device did not
  // write, which means another device saved in between.
  const [cloudConflict, setCloudConflict] = useState<CloudProject | null>(null);
  // What this device remembers about the open project's cloud copy: whether
  // there is one, and whether it has a live link. Refreshed after every save and
  // whenever the open project changes.
  const [cloudLink, setCloudLink] = useState<CloudProjectLink | null>(null);
  const { session: discoverSession, capabilities: discoverCaps } = useDiscoverSession();
  // The backend has to be built in AND switched on. `cloudProjects` is its own
  // settings row, so an operator can host the feed without hosting projects.
  const isCloudAvailable = HAS_DISCOVER && discoverCaps?.cloudProjects !== false;
  const isCloudSignedIn = !!discoverSession;
  // Desktop only: Help > About in the native menu bar opens the same dialog
  // as the sidebar's About option (settings.rs emits abs-open-about). In the
  // main window only, or every editor window would open one.
  useEffect(() => {
    if (!isTauri() || isSecondaryWindow) return;
    let disposed = false;
    let unlisten: () => void = () => {};
    (async () => {
      const { listen } = await import('@tauri-apps/api/event');
      unlisten = await listen('abs-open-about', () => setIsAboutOpen(true));
      if (disposed) unlisten();
    })();
    return () => {
      disposed = true;
      unlisten();
    };
  }, []);
  // Right dock: Properties on top, Layers below, split by a draggable
  // divider. Collapsed it becomes a slim vertical rail (Android Studio
  // style). Open state and the layers section height persist across
  // relaunches via localStorage, but this subtree IS server-rendered, so
  // the initializers must return the same defaults on both sides; the
  // persisted values load in the layout effect below, before first paint.
  // The dock is pure editor chrome outside every [data-artboard-dom-id]
  // subtree, so PNG, video and preview output can never include it.
  const [isRightDockOpen, setIsRightDockOpen] = useState<boolean>(true);
  const [layersSectionHeight, setLayersSectionHeight] = useState<number>(260);
  const [rightDockWidth, setRightDockWidth] = useState<number>(RIGHT_DOCK_WIDTH_MIN);
  const dockResizeRef = useRef<{ pointerId: number; startX: number; startWidth: number; lastWidth: number } | null>(null);
  // Which of the dock's top-section tabs is showing: the properties form, the
  // undo states, or the versions saved to disk.
  const [rightDockTab, setRightDockTab] = useState<RightDockTab>('properties');
  // The editor pointing at one of the dock's tabs, e.g. straight after saving a
  // named version. A token rather than a plain value, because it is an event:
  // asking for Versions twice has to arrive twice, and by then that tab may be
  // in a window on another monitor rather than in the dock.
  const [tabRequest, setTabRequest] = useState<{ tab: RightDockTab; token: number } | undefined>(
    undefined
  );
  const [isTranslateDialogOpen, setIsTranslateDialogOpen] = useState<boolean>(false);
  const [isTranslateSingleArtboard, setIsTranslateSingleArtboard] = useState<boolean>(false);
  // Set when the run is scoped to one text element (the properties panel
  // button); null means the dialog translates artboards as before.
  const [translateElementId, setTranslateElementId] = useState<string | null>(null);

  const handleTranslateArtboard = (artboardId: string) => {
    handleArtboardSelection(artboardId);
    // See translateScopeIntoActiveLocale: with languages in the project, the
    // in-place dialog would overwrite the source language for all of them.
    if (hasLocales(artboardsRef.current)) {
      void translateScopeIntoActiveLocale({ artboardIds: [artboardId] }, 'Translate Artboard');
      return;
    }
    setTranslateElementId(null);
    setIsTranslateSingleArtboard(true);
    setIsTranslateDialogOpen(true);
  };

  const handleExportArtboard = (artboardId: string) => {
    handleArtboardSelection(artboardId);
    setExportScopedToArtboard(true);
    setIsExportDialogOpen(true);
  };

  const handleTranslateTextElement = (elementId: string) => {
    if (hasLocales(artboardsRef.current)) {
      void translateScopeIntoActiveLocale({ elementIds: [elementId] }, 'Translate Element');
      return;
    }
    setTranslateElementId(elementId);
    setIsTranslateSingleArtboard(true);
    setIsTranslateDialogOpen(true);
  };
  useLayoutEffect(() => {
    try {
      if (window.localStorage.getItem(RIGHT_DOCK_OPEN_KEY) === '0') setIsRightDockOpen(false);
      // 'history' is also what the two-lists-in-one-tab version wrote, and it
      // still means the states list. Anything else falls back to Properties.
      const storedTab = window.localStorage.getItem(RIGHT_DOCK_TAB_KEY);
      if (storedTab === 'history' || storedTab === 'versions') setRightDockTab(storedTab);
      // Only while the Agent tab is on. A stored 'agent' with no Agent tab would
      // leave the strip on Properties with the state still saying Agent, and
      // Radix does not report a click on the tab it already shows.
      else if (storedTab === 'agent' && readAgentPanelEnabled()) setRightDockTab('agent');
      const stored = parseInt(window.localStorage.getItem(RIGHT_DOCK_LAYERS_HEIGHT_KEY) ?? '', 10);
      if (Number.isFinite(stored)) {
        setLayersSectionHeight(Math.max(LAYERS_SECTION_MIN, Math.min(700, stored)));
      }
      const storedWidth = parseInt(window.localStorage.getItem(RIGHT_DOCK_WIDTH_KEY) ?? '', 10);
      if (Number.isFinite(storedWidth)) {
        setRightDockWidth(Math.max(RIGHT_DOCK_WIDTH_MIN, Math.min(RIGHT_DOCK_WIDTH_MAX, storedWidth)));
      }
    } catch {}
  }, []);

  const saveRightDockWidth = (width: number) => {
    setRightDockWidth(width);
    try { window.localStorage.setItem(RIGHT_DOCK_WIDTH_KEY, String(width)); } catch {}
  };

  const setRightDockOpen = (open: boolean) => {
    setIsRightDockOpen(open);
    try { window.localStorage.setItem(RIGHT_DOCK_OPEN_KEY, open ? '1' : '0'); } catch {}
  };

  // Phones get the same dock as a bottom sheet, and it starts closed: opening
  // the editor onto a panel that covers most of the canvas would hide the work.
  // Kept in its own state, and deliberately not persisted, so a phone visit
  // never rewrites the docked-panel preference of the same person's desktop.
  const isMobileViewport = useIsMobile();
  const [isMobileDockOpen, setIsMobileDockOpen] = useState(false);
  const dockOpen = isMobileViewport ? isMobileDockOpen : isRightDockOpen;
  const setDockOpen = (open: boolean) => {
    if (isMobileViewport) setIsMobileDockOpen(open);
    else setRightDockOpen(open);
  };

  // Same split for the properties/layers divider: the sheet is much shorter
  // than a desktop dock, so it keeps its own height, dragged the same way but
  // never written back over the desktop preference.
  const [mobileLayersHeight, setMobileLayersHeight] = useState(MOBILE_LAYERS_SECTION_DEFAULT);
  const layersHeight = isMobileViewport ? mobileLayersHeight : layersSectionHeight;
  const setLayersHeight = (height: number) => {
    if (isMobileViewport) setMobileLayersHeight(height);
    else setLayersSectionHeight(height);
  };

  const selectRightDockTab = (tab: RightDockTab) => {
    setRightDockTab(tab);
    try { window.localStorage.setItem(RIGHT_DOCK_TAB_KEY, tab); } catch {}
  };

  // The Claude Code chat. It lives in a module store, because nothing that
  // shows it lives long enough to own it (src/lib/claudeCode/store.ts). The
  // layout reads it to feed the Agent tab, and to show that tab at all: only
  // in the desktop app, and only once the user has picked Claude Code.
  const claudeAgentState = useClaudeAgent();
  // Not in a window a tab was moved into: the agent's events are signed for
  // the main window only (rule 37), so its chat could never hear back there.
  const agentEnabled = claudeAgentState.available && claudeAgentState.panelEnabled && !isSecondaryWindow;
  // True while handleStartClaudeCode is storing screenshots and making the
  // project. Dismissing the dialog then would start a second, blank project
  // on a fresh visit (see the dialog's onOpenChange), or switch the user away
  // from the one the agent is about to be told is open.
  const claudeStartingRef = useRef(false);
  // A relaunch brings the tab back with no idea whether the chat's CLI is
  // still installed and signed in. Ask once; the store keeps the answer a
  // minute. Codex is asked only for a Codex chat, since asking starts it.
  const agentKind = claudeAgentState.chat.agent;
  useEffect(() => {
    if (!agentEnabled) return;
    void claudeAgent.detect();
    if (agentKind === 'codex') void claudeAgent.detectCodex();
  }, [agentEnabled, agentKind]);
  // The layers on the clipboard, copied in this window or another (elementClipboard.ts).
  const elementClipboard = useElementClipboard();
  const router = useRouter();
  const searchParams = useSearchParams();
  
  // Load available projects from data/projects folder
  useEffect(() => {
    const loadAvailableProjects = async () => {
      setIsLoadingProjects(true);
      setLoadPhase('templates');
      try {
        const projects = await loadProjectTemplates((done, total) => {
          setTemplateProgress({ done, total });
        });
        setAvailableProjects(projects);
      } catch (error) {
        console.error('Error loading available projects:', error);
        toast({
          title: "Loading Error",
          description: "Failed to load available projects.",
          variant: "destructive"
        });
      } finally {
        setIsLoadingProjects(false);
        // Only clear the bar if a project open didn't take over in the meantime.
        setLoadPhase((phase) => (phase === 'templates' ? 'idle' : phase));
      }
    };

    loadAvailableProjects();
  }, [toast]);
  
  useEffect(() => {
    const fetchRecentProjects = async () => {
      try {
        setRecentProjects(await fetchRecentProjectMetas());
      } catch (error) {
        console.error("Error fetching recent projects:", error);
        // Optionally show a toast or handle the error gracefully
      }
    };

    fetchRecentProjects();
  }, [activeProjectId]); // Add activeProjectId as a dependency

  // Closing the tab, reloading or hitting Back throws away the editor session,
  // and anything not pushed to the connected account only exists in this
  // browser's IndexedDB. `beforeunload` is the one hook that can interrupt
  // that, and browsers only honour it with their own built-in confirm: a
  // custom dialog cannot block an unload, and any message we set here is
  // ignored (Chrome/Firefox/Safari all show fixed wording).
  //
  // Web only, on purpose. The desktop shell owns its window lifecycle, and a
  // Tauri close would either ignore this or strand the user in a prompt the
  // native window did not ask for.
  //
  // Only armed once there is something on the canvas, so the template picker
  // on a fresh visit never blocks a close.
  useEffect(() => {
    if (isTauri() || artboards.length === 0) return;
    const confirmLeave = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Legacy browsers need a truthy returnValue to raise the prompt at all.
      event.returnValue = '';
      return '';
    };
    window.addEventListener('beforeunload', confirmLeave);
    return () => window.removeEventListener('beforeunload', confirmLeave);
  }, [artboards.length]);

  // The macOS shell records when the OS killed and reloaded the editor's web
  // content (memory ceiling, issue #19). Surfacing it turns a silent mystery
  // reload into something the user can report; autosave means at most the
  // last half-second of edits was at risk.
  useEffect(() => {
    if (!isTauri()) return;
    let cancelled = false;
    fetchWebviewCrashInfo().then((crashedAt) => {
      if (cancelled || !crashedAt) return;
      toast({
        title: "The editor was reloaded",
        description: "It ran out of memory and the app recovered it. Your last saved work is intact.",
        variant: "destructive",
      });
    });
    return () => {
      cancelled = true;
    };
    // On mount only; the command is one-shot on the Rust side.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // --- 1. On mount, check for projectId in URL and set as activeProjectId ---
  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const urlProjectId = params.get("projectId");
      if (urlProjectId && urlProjectId !== activeProjectId) {
        setActiveProjectId(urlProjectId);
        setIsTemplateSelectorOpen(false);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Only run on mount

  // --- 2. When activeProjectId changes, update the URL ---
  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      if (activeProjectId) {
        params.set("projectId", activeProjectId);
        window.history.replaceState({}, "", `${window.location.pathname}?${params.toString()}`);
      } else {
        params.delete("projectId");
        window.history.replaceState({}, "", `${window.location.pathname}${params.toString() ? "?" + params.toString() : ""}`);
      }
    }
  }, [activeProjectId]);

  // Load project when activeProjectId changes
 useEffect(() => {
    // This effect runs only once on mount
    // If no project is active on initial load, open the template selector
    if (activeProjectId === null) {
      openStartDialog();
    }
 }, [activeProjectId]); // Depend on activeProjectId to react to potential initial load via URL (future)

 // Effect to load project when activeProjectId changes
  useEffect(() => {
    if (!activeProjectId && artboards.length === 0) {
      openStartDialog();
    }
    // Only an id whose document is not on the canvas yet has a row to read,
    // see loadedProjectIdRef.
    if (!activeProjectId || activeProjectId === loadedProjectIdRef.current) return;
    const projectId = activeProjectId;
    // A tab parked in this window holds the project as it was left, undo
    // history included, so there is nothing to read.
    const parked = projectTabsParking.take(projectId);
    if (parked) {
      restoreParkedRef.current(parked);
      return;
    }
    // A read that lands after another project was chosen, or after another
    // path put this one on the canvas, is out of date and is dropped. So is
    // one whose tab left for another window meanwhile (stopOpening): checked
    // here, not left to this effect's cleanup, which can run after the read.
    let superseded = false;
    const open = beginOpen(projectId, { tabRead: true });
    const isStale = () => superseded || open.stopped() || loadedProjectIdRef.current === projectId;
    // Until this open settles, the lock it takes is its own.
    pinLock(projectId);

    const loadProject = async () => {
      setLoadPhase('project');
      try {
        // Commit any debounced edits of the outgoing project before the
        // switch, so nothing of it is lost or written after we move on.
        flushProjectSave();
        // One window writes a project (projectLocks.ts), so the lock comes
        // before the read. Held by another window: a second writer would save
        // over that one's edits, so it is asked about instead.
        const awaited = awaitedHandOversRef.current.delete(projectId);
        if (!(await holdProjectLock(projectId, { waitMs: awaited ? HAND_OVER_WAIT_MS : 0 }))) {
          if (isStale()) return;
          projectTabs.forget(projectId);
          setActiveProjectId(loadedProjectIdRef.current);
          setProjectElsewhere({ projectId, name: recentNamesRef.current.get(projectId) ?? '' });
          return;
        }
        if (isStale()) return;
        // The undo stack it was left with, read alongside the project.
        const [project, storedUndo] = await Promise.all([
          db.projects.get(projectId),
          undoStore.load(projectId).catch((error) => {
            console.error('Could not read the undo history of', projectId, error);
            return null;
          }),
        ]);
        if (isStale()) return;
        if (project && canOpenAsProject(project.projectData)) {
          // Projects saved before recordings became their own element type
          // still carry them on the screenshot device — convert on load.
          // externalizeInlineMedia moves inline base64 screenshots/images into
          // the Dexie media table (issue #19: inline media multiplied through
          // every undo snapshot and autosave until WKWebView killed the page).
          // Positions are derived, so re-lay the boards here too: an imported
          // or externally written project can carry stale/identical positions
          // that would stack every board on the same spot.
          // ensureUniqueElementIds repairs boards an older Duplicate Artboard
          // aliased; normalizeLocalization re-stamps the language config and
          // sweeps overrides whose element or language is gone. All return
          // their input by reference when there is nothing to fix.
          const externalized = await externalizeInlineMedia(migrateVideoDevices(project.projectData));
          if (isStale()) return;
          const projectData = calculateArtboardPositions(
            normalizeLocalization(ensureUniqueElementIds(externalized))
          );
          if (externalized !== project.projectData) {
            // Persist the slimmed row now, so the multi-MB base64 version is
            // gone even if the user closes without editing. Timestamp kept:
            // opening is not a modification.
            await db.projects.put({
              ...project,
              projectData: JSON.parse(JSON.stringify(projectData)),
            });
          }
          if (isStale()) return;
          // Layers sent to this tab while it was being read parked it with
          // the change (editTabInBackground). That copy is newer than the row
          // read here, so it is the one that opens.
          const parkedMeanwhile = projectTabsParking.take(projectId);
          if (parkedMeanwhile) {
            restoreParkedRef.current(parkedMeanwhile);
            return;
          }
          putProjectOnCanvas(projectId);
          setArtboards(projectData);
          setCurrentProjectName(project.name || 'Untitled Project');
          const opened = openStoredUndo(projectId, project.name || 'Untitled Project', projectData, storedUndo);
          // Held, not written: a project somebody opens and closes again
          // should leave nothing behind. The first edit is what turns this
          // into a version (see noteVersionCheckpoint).
          openedSnapshotRef.current = opened.openedSnapshot;
          setHistory(opened.history);
          setHistoryIndex(opened.historyIndex);
          // Auto-select the first artboard so a refreshed project opens ready to
          // edit (matches loadProjectFromData, the click-a-template path). Without
          // this, refreshing into ?projectId left nothing selected.
          setActiveArtboardId(projectData.length > 0 ? projectData[0].id : null);
          setSelectedElementIdOnActiveArtboard(null);
          // A sleeping tab comes back where it was left: its artboard, zoom,
          // scroll and language. A project with no tab has nothing to restore.
          applyTabViewRef.current(projectId, projectData);
          // And with what was selected, where those layers are still there.
          if (opened.selectedElementIds.length > 0) {
            const boardId = projectTabs.get(projectId)?.view?.activeArtboardId ?? projectData[0]?.id;
            const alive = new Set(projectData.find((board) => board.id === boardId)?.elements.map((element) => element.id));
            setSelectedElementIds(opened.selectedElementIds.filter((id) => alive.has(id)));
          }
          setIsTemplateSelectorOpen(false); // Close template selector if a project is loaded
        } else {
          // A row with no artboards has nothing to open, the same as a row
          // that is gone (see canOpenAsProject).
          const empty = !!project;
          console.warn(`Project with ID ${projectId} ${empty ? 'has no artboards' : 'not found'}.`);
          // Nor does its tab, which was given one the moment it was asked for.
          projectTabs.forget(projectId);
          // Back to the project the canvas still shows, or to none after a
          // reload, so the open project and the canvas agree again.
          setActiveProjectId(loadedProjectIdRef.current);
          toast(
            empty
              ? {
                  title: "That project has no artboards",
                  description: "There is nothing in it to open. Pick another project or start a new one.",
                  variant: "destructive",
                }
              : {
                  title: "That project could not be found",
                  description: "It may have been deleted. Pick another project or start a new one.",
                  variant: "destructive",
                }
          );
          openStartDialog(); // Re-open template selector
        }
      } catch (error) {
        console.error("Error loading project from Dexie:", error);
        if (isStale()) return;
        // Back to whatever the canvas still shows, as above.
        setActiveProjectId(loadedProjectIdRef.current);
        toast({
          title: "That project could not be opened",
          description: "Try opening it again, or pick another project.",
          variant: "destructive",
        });
        openStartDialog(); // Re-open template selector on error
      } finally {
        setLoadPhase('idle');
        // Not opened after all (gone, superseded, refused): a lock it took is
        // let go, unless a tab here still wants the project.
        settleLock(projectId);
        open.end();
      }
    };
    loadProject();
    return () => {
      superseded = true;
    };
 }, [activeProjectId, toast, openStartDialog, putProjectOnCanvas]);
  /**
   * Record a new history state. `change` names the command when the caller
   * knows it (Paste, Convert to iPhone 15); otherwise the name is recovered by
   * diffing against the previous snapshot, which is what gives canvas drags and
   * properties-panel edits their labels without every call site being touched.
   *
   * Continuous tweaks (a slider fires an update per pixel) collapse into the
   * state they started, so one gesture is one entry in the panel and one undo.
   *
   * `startsProject` marks the edit that creates a project. Nothing before it
   * belongs to that project, so its state becomes the bottom of the stack, the
   * way an opened project's history starts at the state it opened in. Undo
   * stops there instead of emptying a project that is already saved.
   */
  const pushToHistory = (newArtboardsState: ArtboardState[], change?: HistoryChange, startsProject = false) => {
    const trimmed = history.slice(0, historyIndex + 1);
    const previous = trimmed[trimmed.length - 1];
    const described = change ?? describeArtboardsChange(previous?.artboards ?? [], newArtboardsState);
    if (startsProject) {
      setHistory([makeHistoryEntry(newArtboardsState, described ?? namedChange('New Document', 'open'))]);
      setHistoryIndex(0);
      return;
    }
    // Nothing actually moved (a re-save, a no-op update): leave the stack alone
    // so the panel does not fill with states that restore the same thing.
    if (!described) return;

    const entry = makeHistoryEntry(newArtboardsState, described);
    const canMerge =
      !!previous &&
      !!described.mergeKey &&
      previous.mergeKey === described.mergeKey &&
      entry.timestamp - previous.timestamp < HISTORY_MERGE_WINDOW_MS;

    let next = canMerge
      ? [...trimmed.slice(0, -1), { ...entry, id: previous.id }]
      : [...trimmed, entry];
    // Snapshots carry whole projects, so the stack is capped from the oldest
    // end: by count, and by summed bytes for projects that still carry large
    // inline payloads (issue #19; media normally lives out-of-state now).
    if (next.length > HISTORY_LIMIT) next = next.slice(next.length - HISTORY_LIMIT);
    let totalBytes = 0;
    for (const kept of next) totalBytes += kept.bytes;
    let drop = 0;
    while (drop < next.length - 1 && totalBytes > HISTORY_MAX_BYTES) {
      totalBytes -= next[drop].bytes;
      drop++;
    }
    if (drop > 0) next = next.slice(drop);

    setHistory(next);
    setHistoryIndex(next.length - 1);
  };

  // Add the missing handleDeleteProject function
  const handleDeleteProject = async (projectId: string) => {
    try {
      await db.projects.delete(projectId);
      // The versions are copies of a project that no longer exists, and so is
      // the undo stack its tab kept.
      await deleteVersionsForProject(projectId);
      void undoStore.remove(projectId).catch(() => {});
      // And a tab would open nothing.
      projectTabs.forget(projectId);
      toast({ 
        title: "Project Deleted", 
        description: "The project has been removed from your recent projects."
      });
      // Update the recentProjects list
      setRecentProjects(await fetchRecentProjectMetas());
    } catch (error) {
      console.error("Error deleting project:", error);
      toast({ 
        title: "Delete Failed", 
        description: "There was an error deleting the project.",
        variant: "destructive"
      });
    } finally {
      setProjectToDelete(null);
    }
  };

  /**
   * Copy a project, media and imported fonts included, and open the copy.
   *
   * Enabled for the project that is currently open, unlike Delete next to it:
   * the open one is exactly the one people want a variant of. That is also why
   * the bundle is built from the canvas rather than the stored row when the
   * target is the project on the canvas: handleArtboardsUpdate's
   * db.projects.put is fire and forget, so the row can lag the editor by a
   * tick and a naive copy would quietly drop the last edit. While a project
   * opens, the canvas still holds the one before it, so the project being
   * opened is copied from its row.
   *
   * importBundle restores media under their original ids and skips ids already
   * present, so the copy shares those blobs by reference and writes no bytes.
   */
  const handleDuplicateProject = async (project: Project) => {
    if (duplicatingProjectId) return;
    setDuplicatingProjectId(project.id);
    try {
      flushProjectSave();
      // The recent-projects list holds metadata only (issue #19), so a copy of
      // a non-open project reads the full row here, on demand. A missing row
      // must fail loudly: the list entry is a stub, and duplicating it would
      // produce an empty copy that looks like the design was destroyed.
      let source: Project;
      if (project.id === loadedProjectIdRef.current) {
        source = {
          ...project,
          name: currentProjectName,
          projectData: JSON.parse(JSON.stringify(artboardsRef.current)),
        };
      } else {
        const stored = await db.projects.get(project.id);
        if (!stored) {
          toast({
            title: "Project not found",
            description: "That project is no longer in this browser. The list has been refreshed.",
            variant: "destructive",
          });
          setRecentProjects(await fetchRecentProjectMetas());
          return;
        }
        source = stored;
      }
      const bundle = await serializeProject(source);
      // Matching the SaveToAccountDialog convention, which names its copy the
      // same way.
      const copy = await importBundle(bundle, {
        projectId: `project_${Date.now()}`,
        name: `${source.name} copy`,
      });
      setRecentProjects(await fetchRecentProjectMetas());
      const opened = await loadProjectFromData(copy.projectData, copy.name, copy.id);
      if (!opened) {
        toast({
          title: "Could not open the copy",
          description: `"${copy.name}" was saved, pick it from Recent projects.`,
          variant: "destructive",
        });
        return;
      }
      toast({ title: "Project duplicated", description: `"${copy.name}" is open now.` });
    } catch (error) {
      console.error("Error duplicating project:", error);
      toast({
        title: "Duplicate failed",
        description: error instanceof Error ? error.message : "Something went wrong.",
        variant: "destructive",
      });
    } finally {
      setDuplicatingProjectId(null);
    }
  };

  // Writes the save still waiting in projectSaves (the debounced write, issue
  // #19), on unload and before a project switch or duplicate. Returns the
  // put's promise so close paths can wait for durability; readers that follow
  // up with db.projects.get need not await it, since IndexedDB runs
  // overlapping-scope transactions in creation order.
  const flushProjectSave = useCallback((): Promise<unknown> => projectSaves.flush(), [projectSaves]);

  /*
   * The same project, kept in the cloud on its own.
   *
   * Armed by the open project rather than by a button, so creating, opening or
   * importing one is all it takes. Everything about WHEN it pushes is in
   * src/lib/cloud/autoSave.ts; the two things the editor owes it are a flush of
   * the debounced local write (a push reads the stored row) and a word whenever
   * a commit lands, which is the line inside scheduleProjectSave below.
   *
   * It never forces. A conflict, a full account or an expired session stops it
   * and shows up on the chip in the corner of the canvas, which is where the
   * user answers it.
   */
  const cloudAutoSave = useCloudAutoSave({
    projectId: activeProjectId,
    accountId: discoverSession?.viewer?.id ?? null,
    available: isCloudAvailable,
    signedIn: isCloudSignedIn,
    openToken: projectOpenToken,
    flushLocal: flushProjectSave,
  });
  const noteCloudChange = cloudAutoSave.noteChange;

  /*
   * Editing together.
   *
   * The session is peer to peer (src/lib/collab), so nothing here is a request
   * to a server: `publish` hands the commit to a CRDT that every other browser
   * in the room already has half of, and `applyRemoteArtboards` below is the
   * other direction. Both are wired into the paths the editor already had, so
   * nothing about the canvas, the panels or the undo stack knows this exists.
   *
   * `onRemote` goes through a ref because the handler it needs is defined
   * further down, next to the history stack it writes to.
   */
  const remoteArtboardsRef = useRef<(boards: ArtboardState[], name: string | null) => void>(() => {});
  const collab = useCollab({
    viewer: discoverSession?.viewer ?? null,
    token: discoverSession?.token ?? null,
    getBoards: () => artboardsRef.current,
    getProjectName: () => projectNameRef.current,
    onRemote: (boards, name) => remoteArtboardsRef.current(boards, name),
  });
  const collabPublish = collab.publish;

  /*
   * The same project, kept up to date in the user's OWN storage.
   *
   * The sibling of the cloud auto saver above, and the differences are all in
   * src/lib/account/autoSync.ts. The two the editor has to supply are here: it
   * is off unless somebody turned it on, and it is HELD while a live session is
   * running, because in a room the edit rate is set by however many people are
   * typing and none of them is the person whose Drive quota pays for it.
   *
   * It only ever updates a copy somebody already saved or opened, so an editor
   * full of templates pushes nothing anywhere.
   */
  const accountSync = useAccountAutoSync({
    projectId: activeProjectId,
    provider: accountSession?.provider ?? null,
    accountId: accountSession?.account?.id ?? null,
    connected: isAccountConnected,
    collabActive: !!collab.room,
    openToken: projectOpenToken,
    flushLocal: flushProjectSave,
  });
  const noteAccountChange = accountSync.noteChange;

  const scheduleProjectSave = useCallback((id: string, name: string, artboardsToSave: ArtboardState[]) => {
    // A row is only ever written for the project whose document is on the
    // canvas. While another one opens, the boards handed in here are the
    // outgoing project's (or none), and saving them under the incoming id
    // would replace that project's artboards and name with them.
    if (id !== loadedProjectIdRef.current) {
      console.warn(`Not saving project ${id}: the canvas holds a different project.`);
      return;
    }
    projectSaves.schedule({ id, name, artboards: artboardsToSave });
    // Cheap by design: this runs once per commit, and a drag commits per pixel.
    // The single funnel every commit path goes through, which is why one line
    // here covers handleArtboardsUpdate, applyRemoteArtboards and the history
    // stack without any of them knowing either saver exists.
    noteCloudChange(id);
    noteAccountChange(id);
    // An edited template is somebody's project now, not a preview to replace.
    noteTabEdit(id);
  }, [projectSaves, noteCloudChange, noteAccountChange, noteTabEdit]);
  // Unload must not lose the last half-second of edits. `pagehide` covers the
  // web; a Tauri window close destroys the webview WITHOUT any unload events,
  // so the desktop shell needs the window's close-requested hook, where the
  // put can actually be awaited before the close proceeds.
  // Assigned in the tab block: the tab session, with the active tab's view,
  // and the agent chat.
  const beforeWindowCloseRef = useRef<() => Promise<unknown>>(() => Promise.resolve());
  // Installing an update ends the process without the close hook below ever
  // running, so Rust asks every editor window to write its edits first, and
  // calls the install off when one cannot (src-tauri/src/updater.rs).
  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let unlisten: () => void = () => {};
    (async () => {
      unlisten = await listenUpdateFlush(async (nonce) => {
        let ok = true;
        try {
          await Promise.all([flushProjectSave(), beforeWindowCloseRef.current()]);
        } catch (error) {
          ok = false;
          console.error('Could not write the edits before the update.', error);
        }
        await reportEditsWritten(nonce, ok).catch((error) =>
          console.error('Could not answer the update install.', error)
        );
      });
      if (disposed) unlisten();
    })();
    return () => {
      disposed = true;
      unlisten();
    };
  }, [flushProjectSave]);
  useEffect(() => {
    const flush = () => {
      void beforeWindowCloseRef.current();
      return flushProjectSave();
    };
    window.addEventListener('pagehide', flush);
    let disposed = false;
    let unlistenClose: (() => void) | undefined;
    if (isTauri()) {
      (async () => {
        try {
          const { getCurrentWindow } = await import('@tauri-apps/api/window');
          const unlisten = await getCurrentWindow().onCloseRequested(async () => {
            // Not prevented: the close proceeds after the writes settle.
            await Promise.all([flushProjectSave(), beforeWindowCloseRef.current()]);
          });
          if (disposed) unlisten();
          else unlistenClose = unlisten;
        } catch (error) {
          console.error('Could not hook the window close for the final save.', error);
        }
      })();
    }
    return () => {
      disposed = true;
      window.removeEventListener('pagehide', flush);
      unlistenClose?.();
      flush();
    };
  }, [flushProjectSave]);

  /*
   * Versions: what this project looked like, kept across reloads.
   *
   * The undo stack above is one sitting and lives in React state. This is the
   * other half of the question people actually ask, "put it back the way it was
   * this morning", and it is deliberately coarse: five things write a version
   * and a thinning pass keeps the list readable (src/lib/versions/store.ts).
   *
   *   1. the state a project was in when it was OPENED, written lazily on the
   *      first edit (somebody else's in a live session too), so browsing a
   *      project never writes anything
   *   2. a checkpoint every VERSION_INTERVAL_MS of editing
   *   3. before anything whole-project: a device conversion, a translation run,
   *      restoring another version
   *   4. on an export, because that is the state that got shipped
   *   5. whenever somebody names one
   */
  const [versions, setVersions] = useState<ProjectVersionMeta[]>([]);
  const [isVersionBusy, setIsVersionBusy] = useState(false);
  /** The document as it was when this project opened, until the first edit. */
  const openedSnapshotRef = useRef<{ projectId: string; boards: ArtboardState[]; name: string } | null>(null);
  const lastAutoVersionRef = useRef(0);

  const refreshVersions = useCallback(async (projectId: string | null) => {
    setVersions(await listVersions(projectId));
  }, []);

  useEffect(() => {
    void refreshVersions(activeProjectId);
    // A different project means a different list, and a different "opened"
    // snapshot: the one for the outgoing project is no longer worth writing.
    lastAutoVersionRef.current = Date.now();
  }, [activeProjectId, projectOpenToken, refreshVersions]);

  /**
   * Keep `boards` as a version of the project. True when a version was
   * written: nothing is kept while another project opens, and saveVersion
   * answers null when its write fails.
   */
  const writeVersion = useCallback(
    async (
      boards: ArtboardState[],
      label: string,
      kind: 'named' | 'auto' | 'safety',
      projectId?: string | null,
      projectName?: string
    ): Promise<boolean> => {
      const target = projectId ?? activeProjectIdRef.current;
      if (!target) return false;
      // Every caller hands in the canvas, so the version belongs to the
      // project the canvas holds. While another project opens, that is not
      // the open one, and the boards would be kept as a version of the wrong
      // project (see scheduleProjectSave).
      if (target !== loadedProjectIdRef.current) return false;
      const saved = await saveVersion(target, boards, projectName ?? projectNameRef.current, { kind, label });
      if (target === activeProjectIdRef.current) await refreshVersions(target);
      return saved !== null;
    },
    [refreshVersions]
  );

  /**
   * Called from the one commit door, so it runs on every edit.
   *
   * Everything here is a timestamp comparison until the rare moment it decides
   * to write, and the write itself is not awaited: a commit must never wait for
   * a gzip.
   */
  const noteVersionCheckpoint = useCallback(
    (boards: ArtboardState[]) => {
      const projectId = activeProjectIdRef.current;
      if (!projectId) return;
      const opened = openedSnapshotRef.current;
      if (opened && opened.projectId === projectId) {
        openedSnapshotRef.current = null;
        lastAutoVersionRef.current = Date.now();
        void writeVersion(opened.boards, 'Before this session', 'auto', projectId, opened.name);
        return;
      }
      if (Date.now() - lastAutoVersionRef.current < VERSION_INTERVAL_MS) return;
      lastAutoVersionRef.current = Date.now();
      void writeVersion(boards, 'While editing', 'auto', projectId);
    },
    [writeVersion]
  );

  // Why the last commit below was turned down, for the callers that say so:
  // a design tool answers it as an error, and work the user waited for
  // explains it in a toast.
  const commitRefusalRef = useRef<CommitRefusal | null>(null);
  // True when the commit landed. The refusals below log, record their reason
  // and return false, so a caller that reports success can report this instead.
  const handleArtboardsUpdate = useCallback((updatedArtboards: ArtboardState[], change?: HistoryChange): boolean => {
    // An export has a converted or re-projected list on the canvas. A commit
    // arriving now (an MCP tool, a drag settling on mouseup) would be measured
    // against that temporary render and persist it as the project.
    if (isExportingRef.current) {
      console.warn('Ignoring an artboard update while an export is swapping the canvas.');
      commitRefusalRef.current = 'exporting';
      return false;
    }
    // Made while a project was opening, or from a render whose document has
    // been replaced since: the boards are built from the wrong project, the
    // document being opened would replace them anyway, and saving them would
    // put them under the open project's id.
    if (!canvasStillHolds(renderedCanvas, canvasSerialRef.current)) {
      console.warn('Ignoring an artboard update made while a project was opening.');
      commitRefusalRef.current = 'opening';
      return false;
    }
    // A project keeps at least one artboard (see canOpenAsProject), so no state
    // without one reaches the canvas, the stored row or the undo stack.
    if (updatedArtboards.length === 0) {
      console.warn('Ignoring an artboard update that would leave the project with no artboards.');
      commitRefusalRef.current = 'empty';
      return false;
    }
    commitRefusalRef.current = null;
    const repositionedArtboards = calculateArtboardPositions(updatedArtboards);
    setArtboards(repositionedArtboards); // Update React state first
    noteVersionCheckpoint(repositionedArtboards);
    // Into the room, if there is one. A no-op otherwise, and cheap when there
    // is: the CRDT is handed the whole document but writes only what differs.
    collabPublish(repositionedArtboards, currentProjectName);

    const saveProject = async () => {
      let projectIdToSave = activeProjectId;
      let projectNameToSave = currentProjectName;
      if (!projectIdToSave) {
        // Generate a new ID only if there is no active project
        projectIdToSave = Date.now().toString();
        // Set a random project name for new projects
        projectNameToSave = generateRandomProjectName();
        setCurrentProjectName(projectNameToSave);
        // The canvas already holds this project, so the loader effect has
        // nothing to read back (see loadedProjectIdRef), and the start dialog
        // closes the way it does when any other project opens.
        putProjectOnCanvas(projectIdToSave);
        setIsTemplateSelectorOpen(false);
        // The state the project starts in is what its first version keeps,
        // as with an opened project (see noteVersionCheckpoint).
        openedSnapshotRef.current = {
          projectId: projectIdToSave,
          boards: repositionedArtboards,
          name: projectNameToSave,
        };
      }

      scheduleProjectSave(projectIdToSave, projectNameToSave, repositionedArtboards);

      if (activeProjectId !== projectIdToSave) {
        setActiveProjectId(projectIdToSave); // Set the new active project ID if it was just created
      }
    };
    if (activeArtboardId && !repositionedArtboards.find(ab => ab.id === activeArtboardId)) {
        setActiveArtboardId(null);
        setSelectedElementIdOnActiveArtboard(null);
    }
    if (activeArtboardId && selectedElementIds.length > 0) {
        const currentAb = repositionedArtboards.find(ab => ab.id === activeArtboardId);
        if (currentAb) {
            // Every id, not just the first: deleting three of a five-layer
            // selection has to leave the other two selected.
            const alive = new Set(currentAb.elements.map(el => el.id));
            const kept = selectedElementIds.filter(id => alive.has(id));
            if (kept.length !== selectedElementIds.length) setSelectedElementIds(kept);
        }
    }
    saveProject(); // Call the async save function
    // With no project open, this edit is the one that creates it.
    pushToHistory(repositionedArtboards, change, !activeProjectId);
    return true;
  }, [activeArtboardId, selectedElementIds, activeProjectId, currentProjectName, history, historyIndex, setActiveProjectId, collabPublish, scheduleProjectSave, noteVersionCheckpoint, renderedCanvas, putProjectOnCanvas]);
  /**
   * The newest handleArtboardsUpdate, for work that commits after an await.
   * The one a render closed over pushes onto that render's history and saves
   * under that render's name, so an edit made during the await would drop out
   * of undo and a rename would be saved back to the old name.
   */
  const handleArtboardsUpdateRef = useRef(handleArtboardsUpdate);
  handleArtboardsUpdateRef.current = handleArtboardsUpdate;

  /**
   * For work the user waited on (a translation, images being read) whose
   * commit was turned down: says the result was not saved, and why, in place
   * of the toast that would have reported it.
   */
  const toastUnsavedResult = useCallback(
    (title: string) => {
      toast({
        title,
        description: UNSAVED_RESULT_REASONS[commitRefusalRef.current ?? 'opening'],
        variant: 'destructive',
      });
    },
    [toast]
  );

  /**
   * Whether handleArtboardsUpdate would take a commit now. The handlers that
   * edit through an Artboard component ask this first, because the component
   * reports success itself and keeps its own copy of the elements, so a
   * refused commit would leave both saying the edit happened.
   */
  const canvasTakesCommits = useCallback(
    () => !isExportingRef.current && canvasStillHolds(renderedCanvas, canvasSerialRef.current),
    [renderedCanvas]
  );

  /**
   * A change from somebody else in the room.
   *
   * Deliberately NOT through `handleArtboardsUpdate`: that door republishes,
   * which would bounce every remote edit straight back at the person who made
   * it, and it pushes an undo entry, which would fill this person's history
   * with other people's keystrokes. So this writes the three things that must
   * move (canvas, the row in Dexie, the top of the undo stack), and the version
   * checkpoint every change makes, and nothing else.
   *
   * Replacing the top history entry rather than adding one is what keeps undo
   * meaning "undo MY last action" while still leaving the stack describing a
   * document that exists. The cost is stated in the docs: an undo taken while
   * somebody else is editing reverts their concurrent change to the same
   * properties too, because a snapshot restore is an edit like any other.
   */
  const applyRemoteArtboards = useCallback(
    (incoming: ArtboardState[], remoteName: string | null) => {
      if (!incoming.length) return;
      if (isExportingRef.current) {
        // The canvas is holding a converted list for the exporter. Keep the
        // newest room state and apply it the moment the run finishes.
        pendingRemoteRef.current = { boards: incoming, name: remoteName };
        return;
      }
      const next = calculateArtboardPositions(
        normalizeLocalization(ensureUniqueElementIds(incoming))
      );
      const projectId = activeProjectIdRef.current;
      // A change from the room is a change to the project like any edit made
      // here: the first keeps the state the project opened in as a version,
      // and makes its tab one with changes (tabHasChanges). Joining a room
      // this device was in before hands back the document the canvas already
      // shows, which changes nothing. Compared only until that first change.
      const unedited = !!projectId && openedSnapshotRef.current?.projectId === projectId;
      if (projectId && !(unedited && sameDocument(next, artboardsRef.current))) noteVersionCheckpoint(next);
      setArtboards(next);
      artboardsRef.current = next;
      setHistory((prev) => {
        const copy = [...prev];
        const at = Math.min(historyIndexRef.current, copy.length - 1);
        if (at >= 0) copy[at] = makeHistoryEntry(next, namedChange('Live edit', 'open'));
        return copy;
      });
      if (projectId) scheduleProjectSave(projectId, remoteName || projectNameRef.current, next);
      if (remoteName && remoteName !== projectNameRef.current) setCurrentProjectName(remoteName);
    },
    [scheduleProjectSave, noteVersionCheckpoint]
  );
  remoteArtboardsRef.current = applyRemoteArtboards;

  /** Keep this exact state under a name. Never thinned away afterwards. */
  const handleSaveNamedVersion = async (label: string) => {
    if (!activeProjectId || isVersionBusy) return;
    // A version keeps the canvas, and while a project opens the canvas still
    // shows the one before it, so writeVersion keeps nothing then.
    if (activeProjectIdRef.current !== loadedProjectIdRef.current) {
      toast({ title: 'The version was not saved', description: PROJECT_STILL_OPENING, variant: 'destructive' });
      return;
    }
    setIsVersionBusy(true);
    try {
      if (await writeVersion(artboardsRef.current, label, 'named')) {
        toast({ title: 'Version saved', description: `"${label}" is in the Versions list, under History.` });
      } else {
        toast({
          title: 'The version was not saved',
          description: 'It could not be stored on this device. Try again.',
          variant: 'destructive',
        });
      }
    } finally {
      setIsVersionBusy(false);
    }
  };

  /**
   * Put a saved state back on the canvas.
   *
   * Two things make this safe to press. The state being replaced is kept first,
   * so a restore is never a one-way door, and the restore itself goes through
   * `handleArtboardsUpdate`, which means it is an ordinary edit: it lands in
   * undo, it is written to Dexie, and it reaches everybody in a live session.
   */
  const handleRestoreVersion = async (version: ProjectVersionMeta) => {
    if (isVersionBusy) return;
    setIsVersionBusy(true);
    try {
      const restored = await readVersion(version.id);
      if (!restored) {
        toast({
          title: 'That version could not be read',
          description: 'It may have been cleared with the browser data.',
          variant: 'destructive',
        });
        return;
      }
      // A project keeps at least one artboard (see canOpenAsProject).
      if (!canOpenAsProject(restored.boards)) {
        toast({ title: 'That version has no artboards', description: 'Nothing was changed.', variant: 'destructive' });
        return;
      }
      await writeVersion(artboardsRef.current, 'Before restore', 'safety');
      // The commit is refused when another project opened during the reads
      // above, since this version belongs to the project that was open.
      if (!handleArtboardsUpdate(restored.boards, namedChange('Restore version', 'open', version.label))) {
        toast({ title: 'Restore failed', description: 'Nothing was changed.', variant: 'destructive' });
        return;
      }
      toast({
        title: 'Version restored',
        description: `"${version.label}" is on the canvas. Undo puts it back the way it was.`,
      });
    } catch (error) {
      console.error('Could not restore that version', error);
      toast({ title: 'Restore failed', description: 'Nothing was changed.', variant: 'destructive' });
    } finally {
      setIsVersionBusy(false);
    }
  };

  /**
   * Open a saved state as a project of its own.
   *
   * This is what makes one template two: the original is untouched, and the
   * copy is an ordinary project from here on. Media is not copied, because it
   * is referenced by id and both projects are in the same browser.
   */
  const handleOpenVersionCopy = async (version: ProjectVersionMeta) => {
    if (isVersionBusy) return;
    setIsVersionBusy(true);
    try {
      const restored = await readVersion(version.id);
      if (!restored) throw new Error('That version could not be read.');
      // Checked before the row below is written, so a version with no
      // artboards leaves no empty project behind in Recent projects.
      if (!canOpenAsProject(restored.boards)) {
        throw new Error('That version has no artboards, so there is nothing to open.');
      }
      flushProjectSave();
      const copyId = `project_${Date.now()}`;
      const name = `${restored.projectName} (${version.label})`;
      await db.projects.put({
        id: copyId,
        name,
        timestamp: new Date(),
        projectData: JSON.parse(JSON.stringify(restored.boards)),
      });
      setRecentProjects(await fetchRecentProjectMetas());
      const opened = await loadProjectFromData(restored.boards, name, copyId);
      if (!opened) throw new Error('The copy could not be opened.');
      toast({ title: 'Opened as a new project', description: `"${name}" is open. The original is untouched.` });
    } catch (error) {
      console.error('Could not open that version as a copy', error);
      toast({
        title: 'Could not open a copy',
        description: error instanceof Error ? error.message : 'Something went wrong.',
        variant: 'destructive',
      });
    } finally {
      setIsVersionBusy(false);
    }
  };

  const handleDeleteVersion = async (version: ProjectVersionMeta) => {
    await deleteVersion(version.id);
    await refreshVersions(activeProjectIdRef.current);
  };


  // Board background, name and the rest of the board-level form. It used to run
  // its own db.projects.put and skip repositioning; folding it into the door
  // above is what makes "handleArtboardsUpdate is the only door" true, which is
  // the invariant the locale overlay rests on.
  //
  // `scope: 'all'` writes every board instead of the active one, in ONE commit:
  // a background picture shared across the strip done board by board would be
  // one undo entry per board. Nothing else uses it, and it stays on this
  // handler rather than becoming a second door.
  const handleUpdateArtboardDetails = useCallback((
    updates: Partial<ArtboardState>,
    scope: 'board' | 'all' = 'board'
  ) => {
    if (scope !== 'all' && !activeArtboardId) return;
    handleArtboardsUpdate(
      artboardsRef.current.map((ab) =>
        scope === 'all' || ab.id === activeArtboardId ? { ...ab, ...updates } : ab
      )
    );
  }, [activeArtboardId, handleArtboardsUpdate]);

  // A language's text is shrunk to fit its box by measuring it in its own face
  // (resolveLocaleFontSize), and that measurement is kept by family. A face that
  // finishes loading after it was taken, such as an imported font a paste from
  // another window brought along, would leave the text sized for the fallback,
  // so every finished load forgets the measurements and projects again.
  const [fontLoads, setFontLoads] = useState(0);
  useEffect(() => {
    // onFontsSettled and not `loadingdone` alone, which WebKit, and so the
    // desktop app, never fires.
    return onFontsSettled(() => {
      clearLocaleFontSizeCache();
      setFontLoads((count) => count + 1);
    });
  }, []);

  // A font imported in another window after this one started is not on this
  // page, so a project with text in it that comes here (a tab moved in, a
  // project that window had open) would draw, and export, in a fallback face
  // until a reload. Each document that goes on the canvas is looked at once.
  const fontsCheckedSerialRef = useRef<number | null>(null);
  useEffect(() => {
    if (artboards.length === 0 || fontsCheckedSerialRef.current === canvasSerialRef.current) return;
    fontsCheckedSerialRef.current = canvasSerialRef.current;
    void loadCustomFontFamilies(collectFontFamilies(artboards)).catch((error) =>
      console.error('Could not load the imported fonts of this project', error)
    );
  }, [artboards]);

  // What the active language shows. Board count, board order and board ids are
  // identical to the base document; only the handful of keys in
  // LOCALIZABLE_KEYS can differ, plus elements hidden in this language.
  const viewArtboards = useMemo(
    // An export swap is ALREADY resolved for the language it is capturing.
    // Projecting it again would lay the language on screen over the language
    // being exported, which is how you get German text in the Japanese set.
    () => exportCanvasArtboards ?? projectArtboards(artboards, activeLocale),
    // fontLoads: a face that loaded since changes what a language's text fits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [exportCanvasArtboards, artboards, activeLocale, fontLoads]
  );

  /**
   * PROPERTY edits made on the canvas or in the properties panel. Text and
   * screenshot/image/media are always an override for the language on screen.
   * Everything else follows localeEditScope: 'local' pulls the property apart
   * for this language, 'shared' writes the base element and reaches every
   * language.
   *
   * Structural operations (add, delete, reorder, paste, anything board-level)
   * never come through here: they run on the base array, because a projection
   * cannot express "this element does not exist" as distinct from "this element
   * is hidden in this one language".
   */
  const commitView = useCallback((nextView: ArtboardState[], change?: HistoryChange) => {
    const locale = activeLocaleRef.current;
    const base = artboardsRef.current;
    const next = unprojectArtboards(base, locale, nextView, {
      autoDetach: !!locale && localeEditScopeRef.current === 'local',
    });
    if (next === base) return;
    if (!locale) {
      handleArtboardsUpdate(next, change);
      return;
    }
    // Anything the commit changed outside the override maps is shared, so say
    // so in the history label and, once per session, out loud.
    const touchesEveryLanguage = next.some((board, index) => {
      const previous = base[index];
      if (!previous || previous === board) return false;
      const { localized: _next, ...rest } = board;
      const { localized: _previous, ...before } = previous as ArtboardState;
      const keys = new Set([...Object.keys(rest), ...Object.keys(before)]);
      for (const key of keys) {
        if ((rest as Record<string, unknown>)[key] !== (before as Record<string, unknown>)[key]) return true;
      }
      return false;
    });
    if (!touchesEveryLanguage) {
      handleArtboardsUpdate(next, change);
      return;
    }
    const described = change ?? describeArtboardsChange(base, next);
    const landed = handleArtboardsUpdate(
      next,
      described ? { ...described, label: `${described.label} (all languages)` } : undefined
    );
    if (!landed) return;
    // Throttled, NOT once per session. A single lifetime showing is consumed by
    // the first shared edit a user ever makes, and every later one then changes
    // all their languages silently, which reads as the feature being broken.
    // Re-armed on a language switch too, since the scope question is live again
    // the moment the user is looking at a different language.
    const now = Date.now();
    const seen = sharedEditNoticeShownRef.current;
    if (seen.locale !== locale || now - seen.at > SHARED_EDIT_NOTICE_INTERVAL_MS) {
      sharedEditNoticeShownRef.current = { locale, at: now };
      toast({
        title: 'That change applied to every language',
        description: `Text and screenshots are ${localeName(locale)} only. For anything else, use the "This language only" toggle beside that property first.`,
      });
    }
  }, [handleArtboardsUpdate, toast]);

  // Switching language commits nothing: the view is a memo over `artboards`.
  const handleSelectLocale = useCallback((locale: string | null) => {
    // The ref first, so a commit already in flight lands in the language it
    // was started in rather than the one being switched to.
    activeLocaleRef.current = locale;
    setActiveLocale(locale);
    // The selection deliberately survives: element ids are identical in every
    // projection, and "select the headline, switch to German, type it" is the
    // flow the properties panel is built around.
  }, []);

  /**
   * Fall back to the base language whenever the one being viewed is not in the
   * project any more.
   *
   * `activeLocale` is component state while the project underneath it can be
   * replaced wholesale: opening another project, importing a JSON, duplicating,
   * or undoing past the commit that added the language. Every one of those
   * would otherwise leave the toolbar naming a language this project has never
   * heard of, and the locale notice offering to translate into it. The
   * projection itself is safe either way (an unknown locale has no overrides,
   * so it renders the base text), so this is about the chrome telling the truth.
   */
  useEffect(() => {
    const viewing = activeLocaleRef.current;
    if (!viewing) return;
    if (getProjectLocales(artboards).some((entry) => entry.code === viewing)) return;
    handleSelectLocale(null);
  }, [artboards, handleSelectLocale]);

  /**
   * Adding and deleting elements on the canvas. It arrives as a delta rather
   * than a new array because a projected array cannot say whether a missing
   * element was deleted or is merely hidden in the language on screen, and
   * unprojectArtboards refuses a commit whose element count moved.
   *
   * applyCanvasStructuralChange drops the removed ids' overrides in every
   * locale in the same commit, so a re-minted id can never inherit a stale
   * translation.
   */
  const handleCanvasStructuralChange = useCallback((change: CanvasStructuralChange) => {
    const base = artboardsRef.current;
    const next = base.map((board) =>
      board.id === change.artboardId ? applyCanvasStructuralChange(board, change) : board
    );
    if (next.every((board, index) => board === base[index])) return;
    handleArtboardsUpdate(
      next,
      namedChange(change.added.length > 0 ? 'Add Element' : 'Delete Element', change.added.length > 0 ? 'add' : 'delete')
    );
  }, [handleArtboardsUpdate]);

  /**
   * One machine translation run, shared by the switcher's "Update translations"
   * and by the translation table's buttons. It never commits: the caller
   * decides, because the table holds its result until Save.
   */
  const runLocaleTranslation = useCallback(async (
    locale: string,
    only: 'empty' | 'stale' | 'all',
    scope?: { artboardIds?: string[]; elementIds?: string[]; includeManual?: boolean }
  ): Promise<ArtboardState[] | null> => {
    const engines = availableEngines();
    if (engines.length === 0) {
      toast({
        title: 'Translation is not set up',
        description: 'Add an AI provider key, or type the strings into the translations table.',
      });
      return null;
    }
    const controller = new AbortController();
    translateAbortRef.current = controller;
    setIsCancellingTranslate(false);
    setTranslateProgress({
      localeLabel: localeLabel(locale),
      done: 0,
      total: 0,
      localeIndex: 1,
      localeCount: 1,
      phase: 'starting',
    });
    try {
      const result = await translateIntoLocale(artboardsRef.current, locale, {
        engine: engines[0],
        only,
        ...scope,
        signal: controller.signal,
        onProgress: (done, total) =>
          setTranslateProgress((prev) =>
            prev ? { ...prev, done, total, phase: 'translating' } : prev
          ),
      });
      toast(
        result.rateLimited
          ? {
              title: 'Translation stopped early',
              description: `Translated ${result.translated}, ${result.failed} left. Wait a minute and run it again.`,
              variant: 'destructive',
            }
          : {
              title: `Translated ${result.translated} ${result.translated === 1 ? 'string' : 'strings'}`,
              description:
                [
                  result.failed ? `${result.failed} did not come back` : '',
                  result.skipped ? `${result.skipped} you edited were left alone` : '',
                ]
                  .filter(Boolean)
                  .join('. ') || undefined,
            }
      );
      return result.artboards;
    } catch (error) {
      // Cancelling is a choice, not a failure, so it does not get an error toast.
      if (controller.signal.aborted) return null;
      toast({
        title: 'Translation failed',
        description: error instanceof Error ? error.message : 'Something went wrong.',
        variant: 'destructive',
      });
      return null;
    } finally {
      translateAbortRef.current = null;
      setTranslateProgress(null);
      setIsCancellingTranslate(false);
    }
  }, [toast]);

  /**
   * What the artboard toolbar's and the Properties panel's translate buttons do
   * ONCE THE PROJECT HAS LANGUAGES. Those buttons predate the overlay and
   * translate in place, which with languages present overwrites the source
   * language for every language at once and leaves a half-translated base if
   * the engine stops early. Scoped into the active language's overrides
   * instead, which is what the button now means, and the source survives.
   *
   * includeManual is on: unlike the bulk "Update translations", aiming this at
   * one board or one element is an explicit ask, and it is one undo away.
   */
  const translateScopeIntoActiveLocale = useCallback(async (
    scope: { artboardIds?: string[]; elementIds?: string[] },
    label: string
  ) => {
    const locale = activeLocaleRef.current;
    if (!locale) {
      toast({
        title: 'Pick a language first',
        description: 'Switch to the language you want this written in, then translate again.',
      });
      return;
    }
    const next = await runLocaleTranslation(locale, 'all', { ...scope, includeManual: true });
    if (next && next !== artboardsRef.current) {
      if (!handleArtboardsUpdate(next, namedChange(label, 'translate', localeLabel(locale)))) {
        toastUnsavedResult('The translation was not saved');
      }
    }
  }, [handleArtboardsUpdate, runLocaleTranslation, toast, toastUnsavedResult]);

  /** Asks the running translation to stop. The dialog stays up until it has. */
  const handleCancelTranslation = useCallback(() => {
    if (!translateAbortRef.current) return;
    setIsCancellingTranslate(true);
    translateAbortRef.current.abort();
  }, []);

  // The manager dialog's confirm. normalizeLocalization AFTER setLocalization is
  // what actually deletes an unticked language's overrides: setLocalization only
  // rewrites the config, the sweep drops the maps it no longer covers.
  const handleApplyLanguages = useCallback(async (
    next: ProjectLocalization,
    opts: { machineTranslate: boolean; addedLocales: string[] }
  ) => {
    // Passing undefined strips `localization` off every board, which puts a
    // project whose last language was just removed back to being byte-identical
    // to one that never had any.
    let boards = normalizeLocalization(
      setLocalization(artboardsRef.current, next.locales.length > 0 ? next : undefined)
    );
    if (opts.machineTranslate && opts.addedLocales.length > 0 && availableEngines().length > 0) {
      const controller = new AbortController();
      translateAbortRef.current = controller;
      setIsCancellingTranslate(false);
      try {
        // Sequential, not Promise.all: the engines share one rate-limit budget.
        for (const [index, code] of opts.addedLocales.entries()) {
          if (controller.signal.aborted) break;
          setTranslateProgress({
            localeLabel: localeLabel(code),
            done: 0,
            total: 0,
            localeIndex: index + 1,
            localeCount: opts.addedLocales.length,
            phase: 'starting',
          });
          try {
            const done = await translateIntoLocale(boards, code, {
              engine: availableEngines()[0],
              only: 'empty',
              signal: controller.signal,
              onProgress: (doneCount, total) =>
                setTranslateProgress((prev) =>
                  prev ? { ...prev, done: doneCount, total, phase: 'translating' } : prev
                ),
            });
            boards = done.artboards;
          } catch (error) {
            // One language failing must not cost the user the languages
            // themselves, so the loop keeps going and the config still commits.
            console.error('Could not machine translate into', code, error);
          }
        }
      } finally {
        translateAbortRef.current = null;
        setTranslateProgress(null);
        setIsCancellingTranslate(false);
      }
    }
    const landed = handleArtboardsUpdate(
      boards,
      namedChange('Add Languages', 'translate', `${next.locales.length} languages`)
    );
    if (!landed) {
      toastUnsavedResult('The languages were not saved');
      return;
    }
    // Viewing a language that was just removed would show a projection of a
    // locale the project no longer has.
    const viewing = activeLocaleRef.current;
    if (viewing && !next.locales.some((entry) => entry.code === viewing)) {
      handleSelectLocale(null);
    }
  }, [handleArtboardsUpdate, handleSelectLocale, toastUnsavedResult]);

  const handleOpenTranslations = useCallback((filter: 'all' | 'untranslated' = 'all') => {
    setTranslationTableLocale(activeLocaleRef.current);
    setTranslationTableFilter(filter);
    setIsTranslationTableOpen(true);
  }, []);

  // The switcher's "Update translations": refresh what a machine wrote and the
  // base language has since changed under, for the language on screen.
  const handleUpdateTranslations = useCallback(async () => {
    const locale = activeLocaleRef.current;
    if (!locale) {
      toast({
        title: 'Pick a language first',
        description: 'Switch to the language you want to refresh, then run this again.',
      });
      return;
    }
    const next = await runLocaleTranslation(locale, 'stale');
    if (next && next !== artboardsRef.current) {
      if (!handleArtboardsUpdate(next, namedChange('Update Translations', 'translate', localeLabel(locale)))) {
        toastUnsavedResult('The translation was not saved');
      }
    }
  }, [handleArtboardsUpdate, runLocaleTranslation, toast, toastUnsavedResult]);

  // One commit for a whole bulk-entry session, so undo restores all of it. The
  // table closes on Save, so a commit turned down has to say so here.
  const handleSaveTranslations = useCallback((next: ArtboardState[], editedCount: number) => {
    if (!handleArtboardsUpdate(next, namedChange('Edit Translations', 'translate', `${editedCount} strings`))) {
      toastUnsavedResult('The translations were not saved');
    }
  }, [handleArtboardsUpdate, toastUnsavedResult]);

  /** Drops one override key, handing that row back to the base language. */
  const handleResetLocaleField = useCallback((
    field: 'content' | 'fontFamily' | 'screenshotSrc' | 'imageSrc' | 'mediaId'
  ) => {
    const locale = activeLocaleRef.current;
    const elementId = selectedElementIdOnActiveArtboard;
    if (!locale || !elementId || !activeArtboardId) return;
    let changed = false;
    // Straight to the base array, NOT through commitView: a reset edits the
    // override map itself, and a projection cannot express "no value" as
    // distinct from "the same value the base has".
    const next = artboardsRef.current.map((board) => {
      if (board.id !== activeArtboardId) return board;
      const forLocale = board.localized?.[locale];
      const override = forLocale?.[elementId];
      if (!forLocale || !override || override[field] === undefined) return board;
      changed = true;
      const { [field]: _dropped, origin, sourceHash, ...rest } = override;
      const nextForLocale = { ...forLocale };
      // Nothing localizable left means the element is fully inherited again, so
      // the row goes rather than lingering as an empty marker.
      if (Object.keys(rest).length === 0) delete nextForLocale[elementId];
      else nextForLocale[elementId] = { ...rest, origin, sourceHash };
      const localized = { ...board.localized };
      if (Object.keys(nextForLocale).length > 0) localized[locale] = nextForLocale;
      else delete localized[locale];
      const nextBoard: ArtboardState = { ...board, localized };
      if (Object.keys(localized).length === 0) delete nextBoard.localized;
      return nextBoard;
    });
    if (!changed) return;
    handleArtboardsUpdate(next, namedChange('Reset Translation', 'translate', localeLabel(locale)));
  }, [activeArtboardId, selectedElementIdOnActiveArtboard, handleArtboardsUpdate]);

  /**
   * Pulls one property apart for the language on screen, or hands it back.
   *
   * Detaching seeds the override from the element AS IT CURRENTLY RENDERS, so
   * the picture does not move at the moment of detaching: the user gets their
   * own copy of the value they were already looking at, and edits from there.
   * Re-attaching drops the value with the flag, so the element snaps back to
   * the shared design rather than keeping a stale copy that does nothing.
   *
   * Goes straight to the base array, not through commitView, for the same
   * reason as handleResetLocaleField: this edits the override map itself, and a
   * projection cannot express "detached" at all.
   */
  const handleToggleLocaleDetach = useCallback((keys: DetachableKey[], detach: boolean) => {
    const locale = activeLocaleRef.current;
    const elementId = selectedElementIdOnActiveArtboard;
    if (!locale || !elementId || !activeArtboardId || keys.length === 0) return;
    let changed = false;
    const next = artboardsRef.current.map((board) => {
      if (board.id !== activeArtboardId) return board;
      const baseEl = board.elements.find((el) => el.id === elementId);
      if (!baseEl) return board;
      const forLocale = board.localized?.[locale];
      const current = forLocale?.[elementId];
      const entry = getProjectLocales(artboardsRef.current).find((e) => e.code === locale);
      // Folded in one pass. A geometry toggle covers position, size and scale,
      // and three separate commits in one click would each start from the same
      // artboardsRef snapshot (it only refreshes on render) so only the last
      // would survive. One pass is also one undo entry, which is what the user
      // means by one click.
      const nextOverride = keys.reduce<ElementLocaleOverride | undefined>(
        (acc, key) =>
          detach
            ? detachProperty(acc, resolveElementForLocale(baseEl, acc, entry), key)
            : attachProperty(acc, key),
        current
      );
      if (nextOverride === current) return board;
      changed = true;

      const nextForLocale = { ...(forLocale || {}) };
      if (nextOverride) nextForLocale[elementId] = nextOverride;
      else delete nextForLocale[elementId];
      const localized = { ...board.localized };
      if (Object.keys(nextForLocale).length > 0) localized[locale] = nextForLocale;
      else delete localized[locale];
      const nextBoard: ArtboardState = { ...board, localized };
      if (Object.keys(localized).length === 0) delete nextBoard.localized;
      return nextBoard;
    });
    if (!changed) return;
    handleArtboardsUpdate(
      next,
      namedChange(detach ? 'Detach For Language' : 'Share Across Languages', 'translate', localeLabel(locale))
    );
  }, [activeArtboardId, selectedElementIdOnActiveArtboard, handleArtboardsUpdate]);

  /**
   * "Reset to base", at whichever scope the user asked for. Dropping the whole
   * override row is the reset: with nothing of its own left, the element is
   * projected verbatim from the base design again.
   *
   * Straight to the base array rather than through commitView, for the same
   * reason as the other override edits: a projection cannot express "no value"
   * as distinct from "the same value the base happens to have".
   */
  const handleResetLocaleOverrides = useCallback((scope: 'element' | 'artboard' | 'project') => {
    const locale = activeLocaleRef.current;
    if (!locale) return;
    const elementId = selectedElementIdOnActiveArtboard;
    if (scope === 'element' && (!elementId || !activeArtboardId)) return;

    let changed = false;
    const next = artboardsRef.current.map((board) => {
      if (scope !== 'project' && board.id !== activeArtboardId) return board;
      const forLocale = board.localized?.[locale];
      if (!forLocale) return board;

      const nextForLocale = { ...forLocale };
      if (scope === 'element') {
        if (!elementId || nextForLocale[elementId] === undefined) return board;
        delete nextForLocale[elementId];
      }
      changed = true;

      const localized = { ...board.localized };
      if (scope !== 'element' || Object.keys(nextForLocale).length === 0) delete localized[locale];
      else localized[locale] = nextForLocale;
      const nextBoard: ArtboardState = { ...board, localized };
      if (Object.keys(localized).length === 0) delete nextBoard.localized;
      return nextBoard;
    });
    if (!changed) return;
    handleArtboardsUpdate(
      next,
      namedChange(
        scope === 'element' ? 'Reset Element To Base'
          : scope === 'artboard' ? 'Reset Artboard To Base'
          : 'Reset Language To Base',
        'translate',
        localeLabel(locale)
      )
    );
  }, [activeArtboardId, selectedElementIdOnActiveArtboard, handleArtboardsUpdate]);

  /** Which properties the selected element has pulled apart in this language. */
  const selectedLocaleDetached = useMemo(() => {
    const locale = activeLocale;
    if (!locale || !activeArtboardId || !selectedElementIdOnActiveArtboard) return undefined;
    const board = artboards.find((ab) => ab.id === activeArtboardId);
    return board?.localized?.[locale]?.[selectedElementIdOnActiveArtboard]?.detached;
  }, [activeLocale, activeArtboardId, selectedElementIdOnActiveArtboard, artboards]);

  useEffect(() => {
    if (activeArtboardId && selectedElementIdOnActiveArtboard) {
      const activeAb = viewArtboards.find(ab => ab.id === activeArtboardId);
      if (activeAb) {
        const element = activeAb.elements.find(el => el.id === selectedElementIdOnActiveArtboard);
        setSelectedElementDetails(element || null);
      } else {
        setSelectedElementDetails(null);
      }
    } else {
      setSelectedElementDetails(null);
    }
  }, [activeArtboardId, selectedElementIdOnActiveArtboard, viewArtboards]);

  const handleUpdateSelectedElement = (updates: Partial<ArtboardElement>) => {
    if (!activeArtboardId || !selectedElementIdOnActiveArtboard) return;

    const updatedArtboards = viewArtboards.map(ab => {
      if (ab.id === activeArtboardId) {
        // Device model changes go through the screen-aware swap so overlays
        // authored on the screen area (screen fills, pre-baked screenshots)
        // re-fit to the new device's screen rect and corner radius.
        const deviceTarget = (updates as Partial<DeviceFrameElementProps>).deviceType;
        if (deviceTarget) {
          const swappedElements = swapDeviceInElements(ab.elements, selectedElementIdOnActiveArtboard, deviceTarget);
          if (swappedElements) {
            return { ...ab, elements: swappedElements };
          }
        }
        return {
          ...ab,
          elements: ab.elements.map(el =>
            el.id === selectedElementIdOnActiveArtboard ? { ...el, ...updates } as ArtboardElement : el
          ),
        };
      }
      return ab;
    });
    // A property edit, so it goes through the view: content, font family and
    // an uploaded screenshot land in the active language's override map, and
    // every other key is written to the base element.
    commitView(updatedArtboards);
  };

  // Update an element by id regardless of the current selection. Used by the
  // properties panel to commit pending text edits after the element has
  // already been deselected (e.g. the user clicked the artboard background).
  const handleUpdateElementById = (elementId: string, updates: Partial<ArtboardElement>) => {
    let found = false;
    const updatedArtboards = viewArtboards.map(ab => {
      if (!ab.elements.some(el => el.id === elementId)) return ab;
      found = true;
      return {
        ...ab,
        elements: ab.elements.map(el =>
          el.id === elementId ? { ...el, ...updates } as ArtboardElement : el
        ),
      };
    });
    if (found) commitView(updatedArtboards);
  };

  // --- arranging several layers at once -------------------------------------
  //
  // Align, distribute and nudge are PROPERTY edits (they write `position`, and
  // position is one of the keys a language can hold its own copy of), so they
  // go through commitView like a drag does. Grouping does not: `groupId` names
  // the layer rather than draws it and is in NEVER_DETACHABLE, so it is written
  // against the base document and never asks the language question.

  /** Rewrite the elements of the active board, through the locale projection. */
  const commitActiveBoardElements = useCallback(
    (rewrite: (elements: ArtboardElement[]) => ArtboardElement[], change?: HistoryChange) => {
      if (!activeArtboardId) return;
      let touched = false;
      const next = viewArtboards.map((ab) => {
        if (ab.id !== activeArtboardId) return ab;
        const elements = rewrite(ab.elements);
        if (elements === ab.elements) return ab;
        touched = true;
        return { ...ab, elements };
      });
      if (touched) commitView(next, change);
    },
    [activeArtboardId, viewArtboards, commitView]
  );

  /** Line the selection up on one edge of the box it already spans. */
  const handleAlignSelection = useCallback(
    (edge: AlignEdge) => {
      if (selectedElementIds.length < 2) return;
      const members = new Set(selectedElementIds);
      commitActiveBoardElements(
        (elements) => alignElements(elements, members, edge),
        namedChange(ALIGN_HISTORY_LABELS[edge], 'move', `${selectedElementIds.length} layers`)
      );
    },
    [selectedElementIds, commitActiveBoardElements]
  );

  /** Even out the gaps between three or more selected layers. */
  const handleDistributeSelection = useCallback(
    (axis: DistributeAxis) => {
      if (selectedElementIds.length < 3) return;
      const members = new Set(selectedElementIds);
      commitActiveBoardElements(
        (elements) => distributeElements(elements, members, axis),
        namedChange(
          axis === 'horizontal' ? 'Distribute horizontally' : 'Distribute vertically',
          'move',
          `${selectedElementIds.length} layers`
        )
      );
    },
    [selectedElementIds, commitActiveBoardElements]
  );

  /**
   * Tag the selection so it travels as one arrangement.
   *
   * Straight to the base array rather than through commitView: `groupId` is
   * never per-language, and a commitView write would class it as an edit that
   * reached every language and say so in a toast on every grouping.
   */
  const handleGroupSelection = useCallback(() => {
    if (!activeArtboardId || selectedElementIds.length < 2) return;
    const board = artboardsRef.current.find((ab) => ab.id === activeArtboardId);
    if (!board) return;
    // Already exactly one group, so a second id would change nothing anyone
    // can see. The panel and the menu grey the command out for the same case.
    if (!groupCommandState(board.elements, selectedElementIds).canGroup) return;
    const wanted = new Set(selectedElementIds);
    const groupId = makeGroupId(Date.now());
    const groupName = nextGroupName(board.elements);
    handleArtboardsUpdate(
      artboardsRef.current.map((ab) =>
        ab.id === activeArtboardId
          ? {
              ...ab,
              elements: ab.elements.map((el) =>
                wanted.has(el.id) ? ({ ...el, groupId, groupName } as ArtboardElement) : el
              ),
            }
          : ab
      ),
      namedChange('Group', 'edit', `${selectedElementIds.length} layers`)
    );
  }, [activeArtboardId, selectedElementIds, handleArtboardsUpdate]);

  /** What the two group commands can do with what is selected right now. */
  const selectionGroupState = useMemo(() => {
    const board = artboards.find((ab) => ab.id === activeArtboardId);
    if (!board || selectedElementIds.length === 0) {
      return { canGroup: false, canUngroup: false, wholeGroupId: null };
    }
    return groupCommandState(board.elements, selectedElementIds);
  }, [artboards, activeArtboardId, selectedElementIds]);

  /**
   * Drop the group tag, so each member moves on its own again.
   *
   * Every member of a touched group is freed, including any that were not in
   * the selection: a group half dissolved is not a state a user can see or
   * reason about, and selecting one member already brings the rest anyway.
   */
  const handleUngroupSelection = useCallback(() => {
    if (!activeArtboardId || selectedElementIds.length === 0) return;
    const board = artboardsRef.current.find((ab) => ab.id === activeArtboardId);
    if (!board) return;
    const wanted = new Set(selectedElementIds);
    const groups = new Set(
      board.elements.filter((el) => wanted.has(el.id) && el.groupId).map((el) => el.groupId)
    );
    if (groups.size === 0) return;
    let freed = 0;
    handleArtboardsUpdate(
      artboardsRef.current.map((ab) =>
        ab.id === activeArtboardId
          ? {
              ...ab,
              elements: ab.elements.map((el) => {
                if (!el.groupId || !groups.has(el.groupId)) return el;
                freed += 1;
                const { groupId: _dropped, groupName: _unnamed, ...rest } = el;
                return rest as ArtboardElement;
              }),
            }
          : ab
      ),
      namedChange('Ungroup', 'edit', `${freed} layers`)
    );
  }, [activeArtboardId, selectedElementIds, handleArtboardsUpdate]);

  /**
   * Whether the selected layers carry on across artboard edges, and whether
   * the part on the next artboard sits in front of its layers or behind them
   * (BaseElement.spanArtboards and spanBehind).
   *
   * Written to the base document, like grouping: neither key can differ
   * between languages, so there is no language question to ask. Off is stored
   * as false rather than dropped, so the element records that somebody turned
   * it off.
   */
  const handleUpdateSpan = useCallback((change: SpanChange) => {
    if (!activeArtboardId || selectedElementIds.length === 0) return;
    const wanted = new Set(selectedElementIds);
    const changed: ArtboardElement[] = [];
    const next = artboardsRef.current.map((ab) => {
      if (ab.id !== activeArtboardId) return ab;
      const elements = ab.elements.map((el) => {
        if (!wanted.has(el.id) || !hasCanvasBox(el)) return el;
        const updated = { ...el } as ArtboardElement;
        if (change.spanArtboards !== undefined) updated.spanArtboards = change.spanArtboards;
        if (change.spanBehind !== undefined) {
          if (change.spanBehind) updated.spanBehind = true;
          else delete updated.spanBehind;
        }
        if (updated.spanArtboards === el.spanArtboards && updated.spanBehind === el.spanBehind) return el;
        changed.push(el);
        return updated;
      });
      return changed.length > 0 ? { ...ab, elements } : ab;
    });
    if (changed.length === 0) return;
    const label =
      change.spanArtboards === true
        ? 'Continue Across Artboards'
        : change.spanArtboards === false
          ? 'Stop at Artboard Edge'
          : change.spanBehind
            ? 'Continue Behind'
            : 'Continue in Front';
    handleArtboardsUpdate(
      next,
      namedChange(label, 'edit', changed.length === 1 ? getElementDisplayName(changed[0]) : `${changed.length} layers`)
    );
  }, [activeArtboardId, selectedElementIds, handleArtboardsUpdate]);

  /**
   * Whether everything selected continues across artboard edges, for the
   * right-click menu's check mark. Null when nothing selected has a box.
   */
  const selectionSpansArtboards = useMemo(() => {
    const board = artboards.find((ab) => ab.id === activeArtboardId);
    const chosen = board?.elements.filter((el) => selectedElementIds.includes(el.id) && hasCanvasBox(el)) ?? [];
    if (chosen.length === 0) return null;
    return chosen.every((el) => el.spanArtboards === true);
  }, [artboards, activeArtboardId, selectedElementIds]);

  /**
   * Free one group, named by the Layers panel rather than by the selection.
   *
   * The panel can point at a group nobody has selected, so this takes the id
   * instead of reading the selection; what it does to the members is what
   * Ungroup does.
   */
  const handleUngroupById = useCallback(
    (groupId: string) => {
      if (!activeArtboardId) return;
      let freed = 0;
      handleArtboardsUpdate(
        artboardsRef.current.map((ab) =>
          ab.id === activeArtboardId
            ? {
                ...ab,
                elements: ab.elements.map((el) => {
                  if (el.groupId !== groupId) return el;
                  freed += 1;
                  const { groupId: _dropped, groupName: _unnamed, ...rest } = el;
                  return rest as ArtboardElement;
                }),
              }
            : ab
        ),
        namedChange('Ungroup', 'edit', `${freed} layers`)
      );
    },
    [activeArtboardId, handleArtboardsUpdate]
  );

  /**
   * A layer dropped somewhere else in the Layers list.
   *
   * One write for both halves of the gesture: the drop line says where the
   * layer lands in the z-order AND which group it lands in, so moving it and
   * retagging it in two commits would put a state on the undo stack that the
   * list never drew.
   */
  const handleDropLayer = useCallback(
    (
      elementId: string,
      anchorId: string,
      side: 'above' | 'below',
      groupId: string | null
    ) => {
      if (!activeArtboardId) return;
      const board = artboardsRef.current.find((ab) => ab.id === activeArtboardId);
      const before = board?.elements.find((el) => el.id === elementId);
      if (!board || !before) return;
      const elements = dropLayer(board.elements, elementId, anchorId, side, groupId);
      if (elements === board.elements) return;
      const label =
        groupId && before.groupId !== groupId
          ? 'Group'
          : !groupId && before.groupId
            ? 'Ungroup'
            : 'Reorder Layer';
      handleArtboardsUpdate(
        artboardsRef.current.map((ab) => (ab.id === activeArtboardId ? { ...ab, elements } : ab)),
        namedChange(label, 'edit', getElementDisplayName(before))
      );
    },
    [activeArtboardId, handleArtboardsUpdate]
  );

  /** Rename a group, which writes the name onto every member of it. */
  const handleRenameGroup = useCallback(
    (groupId: string, name: string) => {
      if (!activeArtboardId) return;
      const groupName = name.trim();
      if (!groupName) return;
      handleArtboardsUpdate(
        artboardsRef.current.map((ab) =>
          ab.id === activeArtboardId
            ? {
                ...ab,
                elements: ab.elements.map((el) =>
                  el.groupId === groupId ? ({ ...el, groupName } as ArtboardElement) : el
                ),
              }
            : ab
        ),
        namedChange('Rename group', 'edit', groupName)
      );
    },
    [activeArtboardId, handleArtboardsUpdate]
  );

  /**
   * Put the selection's bounding box at an exact spot on the board.
   *
   * The whole arrangement travels: every member keeps its place relative to the
   * others, which is the only reading of "set X" that means anything once more
   * than one layer is selected.
   */
  const handleMoveSelectionTo = useCallback(
    (x: number | null, y: number | null) => {
      if (selectedElementIds.length === 0) return;
      const board = viewArtboards.find((ab) => ab.id === activeArtboardId);
      if (!board) return;
      const members = new Set(selectedElementIds);
      const span = unionBounds(board.elements.filter((el) => members.has(el.id)));
      if (!span) return;
      const dx = typeof x === 'number' ? x - span.x : 0;
      const dy = typeof y === 'number' ? y - span.y : 0;
      commitActiveBoardElements((elements) => moveElements(elements, members, dx, dy));
    },
    [selectedElementIds, activeArtboardId, viewArtboards, commitActiveBoardElements]
  );

  /**
   * Shift the selection by a whole number of artboard pixels.
   *
   * Deliberately unclamped, the same as a drag: a layer half off the board
   * stays half off, and the board's overflow does the clipping.
   *
   * A held arrow key autorepeats, so the presses are added up and applied once
   * a frame. Undo needs no help here, since consecutive moves of the same
   * layers share a mergeKey and collapse on their own, but every commit costs a
   * whole-project copy for the history entry whether it merges or not. Building
   * the view inside the flush, from refs, is what lets the keyboard listener
   * stay subscribed across edits.
   */
  const nudgeRef = useRef({ dx: 0, dy: 0, frame: 0 });
  const flushNudgeRef = useRef<() => void>(() => {});
  flushNudgeRef.current = () => {
    const { dx, dy } = nudgeRef.current;
    nudgeRef.current = { dx: 0, dy: 0, frame: 0 };
    const ids = selectedElementIdsRef.current;
    if (!activeArtboardId || ids.length === 0 || (dx === 0 && dy === 0)) return;
    const view = projectArtboards(artboardsRef.current, activeLocaleRef.current);
    const board = view.find((ab) => ab.id === activeArtboardId);
    if (!board) return;
    // The ids as they stand, NOT expanded through their groups: selecting a
    // layer already brings the rest of its group, and alt-click exists
    // precisely to opt out of that. Expanding again here would move a layer
    // that is not selected and shows no outline, and would make the arrow keys
    // disagree with dragging, aligning and the X field.
    const members = new Set(ids);
    commitView(
      view.map((ab) =>
        ab.id === activeArtboardId
          ? { ...ab, elements: moveElements(ab.elements, members, dx, dy) }
          : ab
      )
    );
  };
  const queueNudge = useCallback((dx: number, dy: number) => {
    nudgeRef.current.dx += dx;
    nudgeRef.current.dy += dy;
    if (nudgeRef.current.frame) return;
    nudgeRef.current.frame = requestAnimationFrame(() => flushNudgeRef.current());
  }, []);
  // A frame still pending when the editor goes away has nothing left to write.
  useEffect(() => () => cancelAnimationFrame(nudgeRef.current.frame), []);

  // Restack one element next to another (the timeline bar's vertical drag).
  // Array order IS z-order, so this is a splice, and it moves the layer in the
  // Layers panel by exactly the same amount.
  const handleReorderElementNextTo = (elementId: string, targetElementId: string, after: boolean) => {
    let changed = false;
    const updatedArtboards = viewArtboards.map((ab) => {
      const from = ab.elements.findIndex((el) => el.id === elementId);
      const to = ab.elements.findIndex((el) => el.id === targetElementId);
      if (from < 0 || to < 0 || from === to) return ab;
      changed = true;
      const elements = [...ab.elements];
      const [moved] = elements.splice(from, 1);
      const targetIndex = elements.findIndex((el) => el.id === targetElementId);
      elements.splice(after ? targetIndex + 1 : targetIndex, 0, moved);
      return { ...ab, elements };
    });
    if (changed) commitView(updatedArtboards);
  };

  // Explicit App Preview length for one board; null goes back to "as long as
  // the content needs".
  const handleSetPreviewDuration = (artboardId: string, seconds: number | null) => {
    const updatedArtboards = viewArtboards.map((ab) =>
      ab.id === artboardId
        ? { ...ab, previewDurationSeconds: seconds === null ? undefined : seconds }
        : ab
    );
    commitView(updatedArtboards);
  };

  // The mockup platform and canvas size drive the toolbar's format label and
  // checkmarks. Mixed projects have no active format.
  const activeDeviceFormat = useMemo(() => {
    const format = detectArtboardsFormat(artboards);
    if (format === 'ios') {
      const largePreset = DEVICE_FORMAT_PRESETS.find((preset) => preset.id === 'ios-large');
      if (
        largePreset &&
        screenshotBoards(artboards).every((artboard) =>
          artboard.size.width === largePreset.artboard.width &&
          artboard.size.height === largePreset.artboard.height
        )
      ) {
        return largePreset.id;
      }
    }
    return format === 'mixed' ? null : format;
  }, [artboards]);

  // Convert the whole project to a device format: resize every artboard to
  // the format's store-correct canvas (content uniformly scaled and
  // re-centered) and swap mockups to the format's device. One
  // handleArtboardsUpdate call = one history entry, so undo restores the
  // previous format exactly.
  const handleSelectDeviceFormat = (preset: DeviceFormatPreset) => {
    const { artboards: converted, resized, swapped, skipped } = convertArtboardsToFormat(artboards, preset);
    if (resized === 0 && swapped === 0) {
      toast({
        title: "Nothing to convert",
        description: `Artboards are already ${preset.artboard.width}×${preset.artboard.height} with ${preset.label} mockups${skipped > 0 ? ` (${skipped} generic tablet/desktop/custom mockup(s) left as-is)` : ''}.`,
      });
      return;
    }
    // Every board resized and every mockup swapped in one commit: undo covers
    // it, but only until the tab is closed.
    void writeVersion(artboardsRef.current, `Before ${preset.label}`, 'safety');
    if (!handleArtboardsUpdate(converted, namedChange(`Convert to ${preset.label}`, 'device'))) return;
    trackDeviceFormatSelected({ format: preset.id, formatLabel: preset.label });
    const parts = [
      resized > 0 ? `${resized} artboard(s) resized to ${preset.artboard.width}×${preset.artboard.height}` : '',
      swapped > 0 ? `${swapped} mockup(s) swapped` : '',
      skipped > 0 ? `${skipped} left as-is (no equivalent)` : '',
    ].filter(Boolean);
    toast({
      title: `Converted to ${preset.label}`,
      description: `${parts.join(', ')}. Undo reverts everything.`,
    });
  };

  // Add handler for renaming element from layers panel. A layer name is not
  // localizable, so this runs on the base array rather than through the view.
  const handleRenameElementFromLayerPanel = (elementId: string, newName: string) => {
    if (activeArtboardId) {
      const updatedArtboards = artboards.map(ab => {
        if (ab.id === activeArtboardId) {
          return {
            ...ab,
            elements: ab.elements.map(el =>
              el.id === elementId ? { ...el, name: newName } as ArtboardElement : el
            ),
          };
        }
        return ab;
      });
      if (!handleArtboardsUpdate(updatedArtboards)) return;
      toast({ title: "Element Renamed", description: `Element renamed to "${newName}".` });
    }
  };

  // Handler for renaming the current project. True when the project has the
  // new name.
  const handleRenameProject = async (newName: string): Promise<boolean> => {
    const trimmedName = newName.trim();
    if (!activeProjectId || !trimmedName) return false;
    if (trimmedName === currentProjectName) return true;
    // While a project opens, the name field still shows the project on the
    // canvas, but activeProjectId already names the one being read. A rename
    // now would be written to that row, and the name the read brings back
    // would replace it at the next save. Edits are turned down in that window
    // (handleArtboardsUpdate), and so is this.
    if (!canvasStillHolds(renderedCanvas, canvasSerialRef.current)) {
      toast({ title: 'The project was not renamed', description: PROJECT_STILL_OPENING, variant: 'destructive' });
      return false;
    }
    setCurrentProjectName(trimmedName);

    // Update the project in the database. Flush any debounced save first:
    // a pending row still carries the old name and would win the race.
    try {
      flushProjectSave();
      const project = await db.projects.get(activeProjectId);
      if (project) {
        await db.projects.put({
          ...project,
          name: trimmedName,
        });
        // A rename writes the row without going through handleArtboardsUpdate,
        // so both savers have to be told about it here or they would keep the
        // old name until the next edit to the design itself.
        noteCloudChange(activeProjectId);
        noteAccountChange(activeProjectId);
        toast({ title: 'Project renamed', description: `It is called "${trimmedName}" now.` });
        return true;
      }
    } catch (error) {
      console.error("Error renaming project:", error);
      toast({ title: 'The new name was not saved', description: 'Try again.', variant: 'destructive' });
    }
    return false;
  };

  const handleAddElementToArtboard = useCallback((artboardId: string, type: ElementType, subType?: ShapeType | DeviceType, dropPosition?: Point, styleProps?: Record<string, any>) => {
    // The component adds and announces the element itself (see canvasTakesCommits).
    if (!canvasTakesCommits()) return;
    const artboardComponent = artboardRefs.current[artboardId];
    if (artboardComponent && typeof artboardComponent.addElement === 'function') {
      const newElementId = artboardComponent.addElement(type, subType, dropPosition, styleProps);
      if (newElementId) {
        setSelectedElementIdOnActiveArtboard(newElementId);
        setActiveArtboardId(artboardId);
      }
    } else {
      toast({ title: "Error", description: "Could not add element. Artboard not found or not active.", variant: "destructive" });
    }
  }, [toast, canvasTakesCommits]);

  // Sound layers are added with their file, so both doors (the timeline's
  // "+ Sound" and the palette tile) open the file picker first and add the
  // layer once a file is chosen. Cancelling the picker adds nothing.
  const soundFileInputRef = useRef<HTMLInputElement>(null);
  const pendingSoundRef = useRef<{ artboardId: string; atSeconds: number; libraryId?: string } | null>(null);
  const handleAddSound = useCallback((artboardId: string, atSeconds: number, libraryId?: string) => {
    pendingSoundRef.current = { artboardId, atSeconds, libraryId };
    soundFileInputRef.current?.click();
  }, []);
  const handleSoundFileChosen = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    const target = pendingSoundRef.current;
    pendingSoundRef.current = null;
    if (!file || !target) return;
    try {
      const { id, duration } = await saveAudio(file, file.name);
      handleAddElementToArtboard(target.artboardId, 'audio', undefined, undefined, {
        mediaId: id,
        durationSeconds: duration,
        startTime: target.atSeconds,
        name: soundLayerName(file.name),
        ...(target.libraryId ? { libraryId: target.libraryId } : {}),
      });
    } catch (error) {
      toast({
        title: 'Could not load sound',
        description: error instanceof Error ? error.message : 'The file could not be read.',
        variant: 'destructive',
      });
    }
  };

  // Stable identity so the memoized ElementPalette does not re-render on every
  // layout state change. The palette can hold hundreds of tiles, and rebuilding
  // them per slider tick is what made scale drags stutter.
  const handlePaletteAddElement = useCallback((type: ElementType, subType?: ShapeType | DeviceType, styleProps?: Record<string, any>) => {
    if (activeArtboardId && type === 'audio') {
      // At the playhead when this board is previewing, from the start otherwise.
      const playback = getPlayback();
      const at = playback.artboardId === activeArtboardId ? playback.time : 0;
      handleAddSound(activeArtboardId, at, typeof styleProps?.libraryId === 'string' ? styleProps.libraryId : undefined);
      return;
    }
    if (activeArtboardId) {
      handleAddElementToArtboard(activeArtboardId, type, subType, undefined, styleProps);
    } else {
      toast({ title: "No Artboard Active", description: "Please select or create an artboard first.", variant: "destructive" });
    }
  }, [activeArtboardId, handleAddElementToArtboard, handleAddSound, toast]);

  /**
   * A palette tile dragged with a finger and released over the canvas. The
   * mouse path goes through the canvas's own drop handler; a finger drag has no
   * drop event to listen for, so the board under the release point is looked up
   * here. Released clear of every board, it still lands (centred on the active
   * one) rather than silently doing nothing.
   */
  /**
   * Screenshots dragged from the desktop straight onto the canvas.
   *
   * The in-editor door to the same idea as the start dialog: the files land in
   * the empty device frames this project already has, in reading order, and
   * anything left over becomes an image element where it was dropped.
   *
   * Deliberately NOT a useCallback: it is only ever called from an inline arrow
   * on CanvasArea, so a stable identity buys nothing, and a dependency array
   * here froze a stale `currentProjectName` into the closure. Dropping a file
   * right after renaming a project then wrote the OLD name back into the Dexie
   * row and broadcast it to every peer in a live session.
   *
   * Three things here are load-bearing. Every file is stored once through
   * saveImageBlobAsset and referenced as `asset:<id>`, never inlined as base64,
   * or every undo snapshot and autosave carries the megabytes (issue #19). The
   * whole next artboards array is built first and committed with ONE
   * handleArtboardsUpdate call, because committing per file would turn a folder
   * of twenty into twenty deep copies and twenty undo entries. And a predefined
   * device gets the full-screen screenshotRect while only `custom` gets the 5%
   * inset, matching DeviceFrameElement and the properties panel; insetting a
   * predefined frame reveals its black screen as a fake bezel.
   */
  const handleCanvasImageDrop = async (files: File[], point: Point) => {
    if (files.length === 0 || artboards.length === 0) return;
    {
      const stored = await Promise.all(
        files.map(async (file) => {
          try {
            const asset = await saveImageBlobAsset(file, { name: file.name });
            return asset.ref;
          } catch {
            return null;
          }
        })
      );
      const refs = stored.filter((ref: string | null): ref is string => !!ref);
      if (refs.length === 0) {
        toast({ title: "Those images could not be read", variant: "destructive" });
        return;
      }

      // Which frames may be written to, in reading order, empty ones first.
      //
      // "Empty" alone is not a usable rule here: every one of the 419 device
      // frames in the bundled catalog ships with placeholder art, so a project
      // started from a template has no empty frame at all and this gesture
      // would silently do nothing. A shipped placeholder is a public path
      // ("/data/projects/..."); anything the USER put there is an `asset:<id>`
      // reference, a data URL or a blob URL. So placeholders are fair game and
      // the user's own screenshots are never overwritten.
      const isPlaceholder = (src: string | undefined): boolean =>
        !src || src.startsWith('/');

      const targets: string[] = [];
      const placeholders: string[] = [];
      for (const board of artboards) {
        for (const element of board.elements) {
          if (element.type !== 'device') continue;
          const device = element as DeviceFrameElementProps;
          if (!device.screenshotSrc) targets.push(device.id);
          else if (isPlaceholder(device.screenshotSrc)) placeholders.push(device.id);
        }
      }
      const fillOrder = [...targets, ...placeholders].slice(0, refs.length);
      const assignment = new Map(fillOrder.map((id, index) => [id, refs[index]]));
      const filled = assignment.size;

      const next = artboards.map((board) => {
        let changed = false;
        const elements = board.elements.map((element) => {
          if (element.type !== 'device') return element;
          const device = element as DeviceFrameElementProps;
          const ref = assignment.get(device.id);
          if (!ref) return element;
          changed = true;
          return {
            ...device,
            screenshotSrc: ref,
            screenshotObjectFit: device.screenshotObjectFit ?? 'cover',
            // A predefined device gets the full screen area; only 'custom'
            // takes the 5% inset. Insetting a predefined frame reveals its
            // black screen as a fake bezel and hides the notch.
            screenshotRect:
              device.screenshotRect ??
              (device.deviceType === 'custom'
                ? { left: 5, top: 5, width: 90, height: 90 }
                : { left: 0, top: 0, width: 100, height: 100 }),
          } as ArtboardElement;
        });
        return changed ? { ...board, elements } : board;
      });

      // Anything with no frame to go in becomes a plain image element on the
      // board under the pointer, which is what dropping a picture on a canvas
      // usually means.
      //
      // Built into the SAME array rather than through handleAddElementToArtboard,
      // and this is the part that has to stay that way. That helper commits
      // through handleCanvasStructuralChange, which rebuilds the whole document
      // from `artboardsRef.current`, and that ref is only refreshed in the
      // render body. Nothing re-renders inside this synchronous block, so each
      // such call would rebuild from the PRE-DROP boards: the frame fills above
      // would be silently reverted and every leftover but the last discarded.
      // One array, one commit, one undo entry.
      const leftover = refs.slice(filled);
      let placedImages = 0;
      if (leftover.length > 0) {
        const targetId =
          document
            .elementsFromPoint(point.x, point.y)
            .map((el) => el.closest('[data-artboard-dom-id]'))
            .find((el): el is Element => !!el)
            ?.getAttribute('data-artboard-dom-id') ??
          activeArtboardId ??
          next[0]?.id ??
          null;
        const boardIndex = next.findIndex((board) => board.id === targetId);
        if (boardIndex >= 0) {
          const board = next[boardIndex];
          const stamp = Date.now();
          const added: ArtboardElement[] = leftover.map((ref, index) => ({
            id: `el_${stamp}_${index}_${Math.random().toString(36).slice(2, 7)}`,
            type: 'image',
            name: 'Image',
            // Staggered, so a batch does not stack into one pile.
            position: {
              x: Math.max(0, board.size.width / 2 - 200 + index * 40),
              y: Math.max(0, board.size.height / 2 - 150 + index * 40),
            },
            size: { width: 400, height: 300 },
            rotation: 0,
            scale: 1,
            imageSrc: ref,
            objectFit: 'contain',
            opacity: 1,
            borderRadius: 0,
            // Added by hand, so it carries on across an edge the way an
            // element added from the palette does.
            spanArtboards: true,
          } as ArtboardElement));
          next[boardIndex] = { ...board, elements: [...board.elements, ...added] };
          placedImages = added.length;
        }
      }

      if (filled > 0 || placedImages > 0) {
        const total = filled + placedImages;
        const landed = handleArtboardsUpdate(
          next,
          namedChange(
            total === 1 ? 'Drop in a screenshot' : `Drop in ${total} screenshots`,
            'add'
          )
        );
        if (!landed) {
          toastUnsavedResult(filled > 0 ? 'The screenshots were not placed' : 'The images were not added');
          return;
        }
      }

      toast({
        title: filled > 0 ? "Screenshots placed" : "Images added",
        description:
          filled > 0
            ? `${filled} into device frames${placedImages > 0 ? `, ${placedImages} added as images` : ''}`
            : `${placedImages} added to the canvas`,
      });
    }
  };

  const handlePaletteDropElement = useCallback((
    type: ElementType,
    subType: ShapeType | DeviceType | undefined,
    styleProps: Record<string, any> | undefined,
    point: Point
  ) => {
    if (!isOverCanvas(point)) return;
    // elementsFromPoint, not elementFromPoint: on a phone the palette sheet is
    // still mounted over the canvas (faded and click-through, but present), so
    // the board can be the second or third thing under the finger.
    const node = document
      .elementsFromPoint(point.x, point.y)
      .map((el) => el.closest('[data-artboard-dom-id]'))
      .find((el): el is Element => !!el) ?? null;
    const droppedOn = node?.getAttribute('data-artboard-dom-id') ?? null;
    const artboardId = droppedOn ?? activeArtboardId;
    if (!artboardId) {
      toast({ title: "No Artboard Active", description: "Please select or create an artboard first.", variant: "destructive" });
      return;
    }
    handleAddElementToArtboard(artboardId, type, subType, droppedOn ? point : undefined, styleProps);
  }, [activeArtboardId, handleAddElementToArtboard, toast]);

  // Get the current size from the first artboard or any active artboard
  // The canvas size is the screenshots' size. Header and search art has a
  // fixed size of its own, so with one of those selected the toolbar still
  // names the screenshots' size, which is what the Canvas Size dialog changes.
  const getCurrentArtboardSize = () => {
    if (activeArtboardId) {
      const activeAb = artboards.find(ab => ab.id === activeArtboardId);
      if (activeAb && !isCreativeBoard(activeAb)) {
        return activeAb.size;
      }
    }
    const shots = screenshotBoards(artboards);
    return shots.length > 0 ? shots[0].size : artboards.length > 0 ? artboards[0].size : { ...DEFAULT_CANVAS_SIZE };
  };

  /** Anything about a new board that is not the default blank one. */
  interface NewArtboardOptions {
    /** Patch over the blank board: name, elements, background, size, length. */
    preset?: Partial<ArtboardState>;
    /** Undo-stack label. Defaults to "Add Artboard". */
    historyLabel?: string;
    /** Toast. Defaults to the "added after X" one. */
    notice?: { title: string; description: string };
  }

  // The ONE artboard creation path. The hover toolbar's "+" calls it with
  // nothing and gets a blank board the size of the one it was clicked on; the
  // palette's Previews tab calls it with a whole scene and gets that instead.
  // Same insert, same single history entry, same Dexie write, same selection.
  // (The top toolbar's "+" is gone, so this is reached only from a board that
  // already exists, and deleting the last artboard is refused.)
  const handleAddNewArtboardAfter = (currentArtboardId: string | null, options: NewArtboardOptions = {}) => {
    const currentArtboard = artboards.find(ab => ab.id === currentArtboardId);
    const newSize = currentArtboard ? currentArtboard.size : { ...DEFAULT_CANVAS_SIZE };

    const newArtboard: ArtboardState = {
      id: `artboard_${Date.now()}`,
      name: `Artboard ${artboards.length + 1}`,
      position: { x: 0, y: 0 },
      size: newSize,
      elements: [],
      backgroundColor: '#FFFFFF', // Use explicit hex color instead of CSS variable
      backgroundType: 'solid',
      zoom: 1,
      ...options.preset,
    };

    const currentIndex = artboards.findIndex(ab => ab.id === currentArtboardId);
    let newArtboardsArray = [...artboards];
    if (currentIndex !== -1) {
      newArtboardsArray.splice(currentIndex + 1, 0, newArtboard);
    } else {
      newArtboardsArray.push(newArtboard);
    }

    // A board minted here carries no `localization`, and getLocalization()
    // answers from the first board that has one; normalize re-stamps it so a
    // new board joins the project's languages instead of silently opting out.
    // Returns the input by reference for a project with no languages at all.
    // Null when the commit was turned down, so nothing is selected or announced.
    const landed = handleArtboardsUpdate(
      normalizeLocalization(newArtboardsArray),
      namedChange(options.historyLabel ?? 'Add Artboard', 'artboard', newArtboard.name)
    );
    if (!landed) return null;
    setActiveArtboardId(newArtboard.id);
    setSelectedElementIdOnActiveArtboard(null);
    toast(options.notice ?? {
      title: "Artboard Added",
      description: `New artboard added after "${artboards[currentIndex]?.name || 'selected'}".`,
    });
    return newArtboard;
  };

  // Art fitted while its face was still on its way is fitted in the fallback,
  // which wraps somewhere else once the real face draws. Each such artboard is
  // kept here with its layers as they went in, and fitted again when the face
  // arrives, as long as nobody has changed it by then.
  const fallbackFitsRef = useRef(new Map<string, { layers: string; since: number }>());
  const noteFallbackFits = (boards: ArtboardState[]) => {
    const waiting = fallbackFitsRef.current;
    for (const board of boards) {
      if (boardFacesMissing(board)) waiting.set(board.id, { layers: JSON.stringify(board.elements), since: Date.now() });
    }
    // A face seen for the first time counts as on its way until the page has
    // answered for it, which takes a moment even when it was there all along.
    // Art fitted in such a face is not waiting for anything, and must not sit
    // here to be laid out again by some other face arriving much later.
    window.setTimeout(() => {
      for (const board of boards) {
        if (waiting.has(board.id) && !boardFacesMissing(board)) waiting.delete(board.id);
      }
    }, 1000);
  };

  /**
   * App Store header and search art, as finished artboards from the dialog or
   * the palette's Header tab.
   *
   * They go to the front of the canvas, which is where the header sits on the
   * store, unless `afterArtboardId` names the artboard a design was dropped on.
   * One history entry and one save either way. normalizeLocalization stamps the
   * project's languages onto them, and the translations the designs carried
   * over are already in their `localized` maps.
   */
  const handleAddCreativeBoards = (boards: ArtboardState[], afterArtboardId?: string | null) => {
    if (boards.length === 0) return;
    const anchorIndex = afterArtboardId ? artboards.findIndex((ab) => ab.id === afterArtboardId) : -1;
    const next =
      anchorIndex >= 0
        ? [...artboards.slice(0, anchorIndex + 1), ...boards, ...artboards.slice(anchorIndex + 1)]
        : [...boards, ...artboards];
    const landed = handleArtboardsUpdate(
      normalizeLocalization(next),
      namedChange('Add App Store header and search', 'artboard', boards.map((board) => board.name).join(', '))
    );
    if (!landed) return;
    noteFallbackFits(boards);
    setIsCreativeDialogOpen(false);
    setActiveArtboardId(boards[0].id);
    setSelectedElementIdOnActiveArtboard(null);
    revealArtboard(boards[0].id);
    const backToStore = creativeReturnsToStoreRef.current;
    creativeReturnsToStoreRef.current = false;
    if (backToStore) openPreview('store');
    const where = anchorIndex >= 0 ? `after "${artboards[anchorIndex].name}"` : 'at the start of the canvas';
    toast({
      title: boards.length === 1 ? `${boards[0].name} added` : 'Header and search art added',
      description: `${boards.length === 1 ? 'A new artboard' : `${boards.length} new artboards`} ${where}, at App Store Connect's exact size. The green outline is the part every device shows. The blue one is what an iPhone shows.`,
      action: backToStore ? undefined : (
        <ToastAction altText="See it in the store listing" onClick={() => openPreview('store')}>
          Preview
        </ToastAction>
      ),
    });
  };

  const openCreativeDialog = (fromStorePreview = false) => {
    creativeReturnsToStoreRef.current = fromStorePreview;
    if (fromStorePreview) setIsPreviewOpen(false);
    setIsCreativeDialogOpen(true);
  };

  /**
   * A Previews tile lands as a whole ARTBOARD, not a layer: a finished App
   * Preview board with its animation script already timed (see
   * lib/previewScenes.ts). It is only a preset handed to the creation path
   * above, so there is one insert, one history entry and one save, exactly as
   * if you had pressed "+".
   *
   * The board takes the size of the one it landed next to whenever that board
   * is the same shape (every portrait phone canvas is), so the canvas keeps a
   * single board size. The MP4 is Apple's 886x1920 either way: that is what the
   * export dialog's default size mode renders.
   */
  const handleAddPreviewScene = (sceneId: string, afterArtboardId?: string | null) => {
    const anchorId = afterArtboardId ?? activeArtboardId;
    const anchor = artboards.find(ab => ab.id === anchorId) ?? null;
    const preset = buildPreviewScenePreset(sceneId, anchor?.size);
    if (!preset) {
      toast({ title: "Unknown preview scene", description: "That scene is no longer in the library.", variant: "destructive" });
      return;
    }
    const size = preset.size ?? PREVIEW_SCENE_SIZE;
    handleAddNewArtboardAfter(anchorId, {
      preset,
      historyLabel: 'Add Preview Scene',
      notice: {
        title: `${preset.name} added`,
        description: `A ${size.width}x${size.height} preview board, ${PREVIEW_SCENE_DURATION}s long. Drop your screen recording into the phone, then edit the text.`,
      },
    });
  };

  // handleAddNewArtboardAfter closes over `artboards` and is re-created every
  // render, so the palette reaches this through a ref. The palette is memoized
  // precisely because rebuilding its hundreds of tiles per keystroke is what
  // made canvas drags stutter.
  const addPreviewSceneRef = useRef(handleAddPreviewScene);
  addPreviewSceneRef.current = handleAddPreviewScene;

  /**
   * The palette's own entry point: a click (no point) or a finger drag released
   * over the canvas. A mouse drag goes through CanvasArea instead, which has a
   * real drop event to read the target board off.
   */
  const handlePaletteAddPreviewScene = useCallback((sceneId: string, point?: Point) => {
    if (point && !isOverCanvas(point)) return;
    addPreviewSceneRef.current(sceneId, point ? artboardIdAtPoint(point) : null);
  }, []);

  /**
   * One design from the palette's Header tab, built from the project the way
   * the add dialog builds it. With no anchor it goes to the start of the
   * canvas, where the header sits on the store; a drop names the artboard it
   * should follow.
   */
  const handleAddCreativeLook = (choice: CreativeLookChoice, afterArtboardId?: string | null, fontsReady = false) => {
    if (!CREATIVE_LOOKS[choice.kind].some((entry) => entry.id === choice.lookId)) return;
    const look = readProjectLook(artboards, choice.appName);
    // The type is fitted by measuring it in the project's face. A face still
    // on its way would have it fitted in the fallback, so wait for the face
    // and come back through the ref, for the project as it is by then.
    const pending = fontsReady ? null : lookFacesPending(look);
    if (pending) {
      void pending.then(() => addCreativeLookRef.current(choice, afterArtboardId, true));
      return;
    }
    const seed = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}${choice.kind[0]}`;
    handleAddCreativeBoards([buildCreativeBoard(choice.kind, choice.lookId, look, seed)], afterArtboardId);
  };

  // Through a ref for the same reason as addPreviewSceneRef.
  const addCreativeLookRef = useRef(handleAddCreativeLook);
  addCreativeLookRef.current = handleAddCreativeLook;

  /**
   * Lay one App Store header or search artboard out again as the design it was
   * made with (rebuildCreativeBoard). It is for art made before the designs
   * were sized for an iPhone: the words, screens, type and ground stay, and
   * only where they sit and how big they are is new. One history entry, so
   * Undo brings the old layout back.
   */
  const handleRebuildCreativeBoard = (boardId: string, fontsReady = false) => {
    const board = artboards.find((ab) => ab.id === boardId);
    if (!board) return;
    // Fitted by measuring, like a new design, so the faces have to be on the
    // page first. Back through the ref, for the project as it is by then.
    const pending = fontsReady ? null : boardFacesPending(board);
    if (pending) {
      void pending.then(() => rebuildCreativeBoardRef.current(boardId, true));
      return;
    }
    const seed = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}${board.creativeAsset?.[0] ?? ''}`;
    const rebuilt = rebuildCreativeBoard(board, artboards, { seed, appName: suggestedAppName(currentProjectName) });
    if (!rebuilt) return;
    const landed = handleArtboardsUpdate(
      artboards.map((ab) => (ab.id === boardId ? rebuilt : ab)),
      namedChange('Rebuild App Store art', 'artboard', board.name)
    );
    if (!landed) return;
    noteFallbackFits([rebuilt]);
    // A layer the new layout has no place for may have been the selected one.
    setSelectedElementIdOnActiveArtboard(null);
    toast({
      title: `${board.name} rebuilt`,
      description: 'Your words and screens are set out again to fill an iPhone. Undo brings the old layout back.',
    });
  };
  const rebuildCreativeBoardRef = useRef(handleRebuildCreativeBoard);
  rebuildCreativeBoardRef.current = handleRebuildCreativeBoard;
  // What the check chip under a header or search artboard can do to it.
  const creativeBoardActions = useMemo(
    () => ({ rebuild: (boardId: string) => rebuildCreativeBoardRef.current(boardId) }),
    []
  );

  // A face that was too slow has arrived. Art that went in without it is laid
  // out again, the way Rebuild design does it, now that its type can be
  // measured in the real face. Art someone has changed since is left alone:
  // its chip says if it needs a look, and Rebuild design is there for it.
  useEffect(() => {
    const waiting = fallbackFitsRef.current;
    if (waiting.size === 0) return;
    let next = artboardsRef.current;
    const settled: string[] = [];
    const refitted: string[] = [];
    for (const [boardId, { layers, since }] of waiting) {
      const board = next.find((ab) => ab.id === boardId);
      if (!board) {
        // In a project that another tab has on the canvas now. It keeps for
        // ten minutes, and is looked at again when its project comes back.
        if (Date.now() - since > 10 * 60_000) settled.push(boardId);
        continue;
      }
      if (JSON.stringify(board.elements) !== layers) {
        settled.push(boardId);
        continue;
      }
      if (boardFacesMissing(board)) continue;
      settled.push(boardId);
      const refit = rebuildCreativeBoard(board, next, {
        seed: boardId,
        appName: suggestedAppName(projectNameRef.current),
      });
      if (!refit || JSON.stringify(refit.elements) === layers) continue;
      next = next.map((ab) => (ab.id === boardId ? refit : ab));
      refitted.push(board.name);
    }
    const landed =
      refitted.length === 0 ||
      handleArtboardsUpdate(next, namedChange('Fit App Store art to its font', 'artboard', refitted.join(', ')));
    // A refused commit (an export is running, say) leaves them for the next face.
    if (landed) for (const boardId of settled) waiting.delete(boardId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fontLoads, activeProjectId]);

  const handlePaletteAddCreativeLook = useCallback((choice: CreativeLookChoice, point?: Point) => {
    if (point && !isOverCanvas(point)) return;
    addCreativeLookRef.current(choice, point ? artboardIdAtPoint(point) : null);
  }, []);

  // What the Header tab draws its designs from, given to that tab alone.
  const storeArtSource = useMemo<StoreArtSource>(
    () => ({ artboards, projectId: activeProjectId, projectName: currentProjectName }),
    [artboards, activeProjectId, currentProjectName]
  );
  
  const handleDuplicateArtboard = (artboardId: string) => {
    const artboardToDuplicate = artboards.find(ab => ab.id === artboardId);
    if (!artboardToDuplicate) return;

    const stamp = Date.now();
    const cloned: ArtboardState = JSON.parse(JSON.stringify(artboardToDuplicate));
    cloned.id = `artboard_${stamp}`;
    cloned.name = `${artboardToDuplicate.name} Copy`;
    // Fresh element ids, index appended the way add_elements does so two minted
    // in the same millisecond cannot collide. Keeping the source's ids made
    // handleUpdateElementById patch both boards at once, and every findElement
    // in the file resolves first-match; with overrides keyed by element id it
    // would also point one language's translation at two elements.
    const idMap: Record<string, string> = {};
    cloned.elements = cloned.elements.map((el, index) => {
      const id = `el_${stamp}_${index}_${Math.random().toString(36).slice(2, 7)}`;
      idMap[el.id] = id;
      return { ...el, id } as ArtboardElement;
    });
    // The copy keeps its translations, now filed under the new ids.
    const duplicatedArtboard = remapOverrideIds(cloned, idMap);

    const currentIndex = artboards.findIndex(ab => ab.id === artboardId);
    let newArtboardsArray = [...artboards];
    if (currentIndex !== -1) {
      newArtboardsArray.splice(currentIndex + 1, 0, duplicatedArtboard);
    } else {
      newArtboardsArray.push(duplicatedArtboard);
    }

    if (!handleArtboardsUpdate(newArtboardsArray, namedChange('Duplicate Artboard', 'copy', artboardToDuplicate.name))) return;
    setActiveArtboardId(duplicatedArtboard.id);
    toast({ title: "Artboard Duplicated", description: `Artboard "${artboardToDuplicate.name}" duplicated.` });
  };
  
  const handleDeleteArtboard = (artboardId: string) => {
    if (artboards.length <= 1) {
      toast({ title: "Cannot Delete", description: "You must have at least one artboard.", variant: "destructive" });
      return;
    }
    const artboardToDelete = artboards.find(ab => ab.id === artboardId);
    if (!artboardToDelete) return;

    const newArtboardsArray = artboards.filter(ab => ab.id !== artboardId);
    if (!handleArtboardsUpdate(newArtboardsArray, namedChange('Delete Artboard', 'delete', artboardToDelete.name))) return;

    if (activeArtboardId === artboardId) {
      setActiveArtboardId(newArtboardsArray.length > 0 ? newArtboardsArray[0].id : null);
      setSelectedElementIdOnActiveArtboard(null);
    }
    toast({ title: "Artboard Deleted", description: `Artboard "${artboardToDelete.name}" deleted.` });
  };
  
  const handleMoveArtboard = (artboardId: string, direction: 'left' | 'right') => {
    const currentIndex = artboards.findIndex(ab => ab.id === artboardId);
    if (currentIndex === -1) return;
  
    let newArtboardsArray = [...artboards];
    const targetArtboard = newArtboardsArray[currentIndex];
  
    if (direction === 'left' && currentIndex > 0) {
      newArtboardsArray.splice(currentIndex, 1);
      newArtboardsArray.splice(currentIndex - 1, 0, targetArtboard);
    } else if (direction === 'right' && currentIndex < newArtboardsArray.length - 1) {
      newArtboardsArray.splice(currentIndex, 1);
      newArtboardsArray.splice(currentIndex + 1, 0, targetArtboard);
    } else {
      return; 
    }
  
    if (!handleArtboardsUpdate(newArtboardsArray, namedChange('Move Artboard', 'order', targetArtboard.name))) return;
    toast({ title: "Artboard Moved", description: `Artboard "${targetArtboard.name}" moved ${direction}.` });
  };


  // Fill a fresh template copy, in place, with an MCP caller's text and
  // screenshots, addressed by the template's hand-authored element ids (the ones
  // get_template lists). Unknown or wrong-typed ids come back as warnings rather
  // than errors, so one bad id cannot lose a whole design. The
  // create_project_from_template and apply_template tools both fill through
  // here, so the two cannot drift apart.
  const fillTemplateSlots = (
    boards: ArtboardState[],
    fills: {
      texts?: Array<{ elementId: string; content: string }>;
      screenshots?: Array<{ elementId: string; src: string }>;
    }
  ): string[] => {
    const warnings: string[] = [];
    const findElement = (elementId: string): ArtboardElement | null => {
      for (const ab of boards) {
        const el = ab.elements.find((e) => e.id === elementId);
        if (el) return el;
      }
      return null;
    };

    for (const { elementId, content } of fills.texts ?? []) {
      const el = findElement(elementId);
      if (!el) { warnings.push(`No element "${elementId}" in this template; text skipped.`); continue; }
      if (el.type !== 'text') { warnings.push(`"${elementId}" is a ${el.type} element, not text; skipped.`); continue; }
      el.content = content;
    }
    const filled = new Set<string>();
    for (const { elementId, src } of fills.screenshots ?? []) {
      const el = findElement(elementId);
      if (!el) { warnings.push(`No element "${elementId}" in this template; screenshot skipped.`); continue; }
      if (el.type !== 'device') { warnings.push(`"${elementId}" is a ${el.type} element, not a device frame; skipped.`); continue; }
      el.screenshotSrc = src;
      // Match the device element's own upload handler; screenshotRect is left
      // alone so the template author's crop survives.
      el.screenshotObjectFit = el.screenshotObjectFit ?? 'cover';
      filled.add(el.id);
    }

    // A frame left unfilled keeps the template's sample art, which ships as a
    // path on this site. Naming those frames saves the caller an export to
    // find out that a store screenshot still shows somebody else's app.
    const samples: string[] = [];
    for (const ab of boards) {
      for (const el of ab.elements) {
        if (el.type === 'device' && !filled.has(el.id) && el.screenshotSrc?.startsWith('/')) {
          samples.push(`${el.id} on "${ab.name}"`);
        }
      }
    }
    if (samples.length > 0) {
      warnings.push(
        `${samples.length === 1 ? '1 device frame still shows' : `${samples.length} device frames still show`} the template's sample screenshot: ${samples.join(', ')}.`
      );
    }
    return warnings;
  };

  // Copy a template into a new saved project and open it. Shared by the gallery
  // (handleSelectTemplate) and the MCP create_project_from_template tool, so an
  // AI client's project is indistinguishable from a clicked one: same DB row,
  // same Recent-projects entry, same editor state.
  //
  // `texts`/`screenshots` fill the copy BEFORE it is saved, through
  // fillTemplateSlots above.
  const createProjectFromTemplateData = async (
    template: Project,
    options?: {
      nameOverride?: string;
      texts?: Array<{ elementId: string; content: string }>;
      screenshots?: Array<{ elementId: string; src: string }>;
      /** Opened from the gallery to look at: its tab is a preview until edited. */
      preview?: boolean;
    }
  ): Promise<{ projectId: string; name: string; artboards: ArtboardState[]; warnings: string[] } | null> => {
    if (!template.projectData || !Array.isArray(template.projectData) || template.projectData.length === 0) {
      return null;
    }
    const projectName = options?.nameOverride?.trim() || `${template.name} Copy`;
    const newProjectId = `project_${Date.now()}`;

    // Normalize artboard positions so templates with arbitrary stored positions
    // still lay out side by side on first load (same layout applied on add/duplicate).
    const updatedArtboards = calculateArtboardPositions(
      JSON.parse(JSON.stringify(template.projectData)) as ArtboardState[]
    );
    const warnings = fillTemplateSlots(updatedArtboards, {
      texts: options?.texts,
      screenshots: options?.screenshots,
    });

    // Screenshots handed in as data URLs (the AI build path) and any inline
    // media a template carries move into the Dexie media table before the row
    // is written, so the project starts life reference-only (issue #19).
    const externalizedArtboards = await externalizeInlineMedia(updatedArtboards);

    await db.projects.put({
      id: newProjectId,
      name: projectName,
      description: template.description,
      timestamp: new Date(),
      projectData: JSON.parse(JSON.stringify(externalizedArtboards)),
    });

    if (options?.preview) previewProjectIdRef.current = newProjectId;
    const success = await loadProjectFromData(externalizedArtboards, projectName, newProjectId);
    if (!success) return null;
    return { projectId: newProjectId, name: projectName, artboards: externalizedArtboards, warnings };
  };

  // `nameOverride` lets the AI agent name the project itself; the gallery and
  // "Start Blank" paths keep the historic "<template> Copy" naming.
  const handleSelectTemplate = async (template: Project, options?: { nameOverride?: string }) => {
    try {
      if (!template.projectData || !Array.isArray(template.projectData) || template.projectData.length === 0) {
        toast({
          title: "Invalid Template",
          description: "The selected template does not contain valid project data.",
          variant: "destructive"
        });
        return;
      }

      trackTemplateSelected({
        templateId: template.id,
        templateName: template.name,
        category: template.category ?? templateTab,
      });

      // A template picked out of the gallery is a preview until it is edited,
      // so browsing them reuses one tab. A name handed in means somebody (the
      // agent, a Discover post) made this project on purpose.
      const created = await createProjectFromTemplateData(template, {
        nameOverride: options?.nameOverride,
        preview: !options?.nameOverride,
      });

      if (created) {
        toast({ title: "Project Created", description: `Project "${created.name}" created.` });
        return;
      }

      toast({
        title: "Creation Failed",
        description: "Failed to create project from template.",
        variant: "destructive"
      });
    } catch (error) {
      console.error("Error creating project from template:", error);
      toast({
        title: "Creation Failed", 
        description: "Failed to create project from template.", 
        variant: "destructive" 
      });
    }
  };

  // Template deep links: /?template=<slug> starts a new project from that
  // catalog template (slug = the filename under public/data/projects without
  // .json, e.g. ?template=kassa-money). The marketing site's template gallery
  // links here. Runs once per mount after the catalog has loaded; an explicit
  // ?projectId= always wins. The param is stripped up front either way, so a
  // reload keeps the created copy instead of minting another one.
  const templateParamHandled = useRef(false);
  useEffect(() => {
    if (templateParamHandled.current || availableProjects.length === 0) return;
    if (typeof window === 'undefined') return;
    templateParamHandled.current = true;
    const params = new URLSearchParams(window.location.search);
    const slug = params.get('template');
    if (!slug) return;
    params.delete('template');
    const query = params.toString();
    window.history.replaceState({}, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
    if (params.get('projectId')) return;
    // Accept the filename slug, the filename-derived id, or the id written
    // inside the file (same double lookup handleUseDiscoverPost needs).
    const template =
      availableProjects.find((project) => project.id === `template_${slug}`) ??
      availableProjects.find((project) => project.id === slug) ??
      availableProjects.find((project) => project.sourceId === slug);
    if (template) void handleSelectTemplate(template);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableProjects]);

  // "Use as template" on a Discover post. Every post carries the id of the
  // project behind it, so this is the same path as picking that template out of
  // the start dialog, named after the post so the new project is recognisable
  // in the recent list.
  const handleUseDiscoverPost = async (post: DiscoverPost) => {
    // Two ids, because a template has two: the one this app derives from the
    // filename and the one written inside the file. The showcase seeder
    // recorded the second, so posts already in the feed (and every link to
    // them somebody has copied) carry ids that the first lookup cannot match.
    // Both are checked, and the filename one wins where they collide.
    const template =
      availableProjects.find((project) => project.id === post.templateProjectId) ??
      availableProjects.find((project) => project.sourceId === post.templateProjectId);
    if (!template) {
      toast({
        title: "That design is not available",
        description: "The project behind this post could not be found in this build.",
        variant: "destructive",
      });
      return;
    }
    setIsDiscoverOpen(false);
    setIsTemplateSelectorOpen(false);
    await handleSelectTemplate(template, { nameOverride: post.appName || template.name });
  };

  /** Open the feed, either on the grid or straight on the share form. */
  const openDiscover = (intent: 'feed' | 'share' = 'feed') => {
    setDiscoverIntent(intent);
    setIsDiscoverOpen(true);
  };

  // Add this utility function to get proper dimensions for export
  const getArtboardExportDimensions = (artboard: ArtboardState) => {
    // Return the original dimensions regardless of zoom level
    return {
      width: artboard.size.width,
      height: artboard.size.height
    };
  };

  // Export project as JSON
  const handleExportProjectAsJSON = async () => {
    if (!activeProjectId) {
      toast({
        title: "No Active Project",
        description: "Please save your project first before exporting.",
        variant: "destructive",
      });
      return;
    }

    try {
      // Fetch the current project from IndexedDB. The debounced save may still
      // hold the last edits; flush so the export never omits them.
      flushProjectSave();
      const project = await db.projects.get(activeProjectId);
      
      if (!project) {
        toast({
          title: "Project Not Found",
          description: "Could not find the active project in the database.",
          variant: "destructive",
        });
        return;
      }

      // Bundle the row together with the binaries it references: media blobs,
      // and any imported font its text uses. Exporting the row alone (what this
      // used to do) left video elements dead and headlines in a fallback face
      // on any other machine, since both live in separate Dexie tables.
      const bundle = await serializeProject(project);
      const jsonString = await bundleToJson(bundle);
      const blob = new Blob([jsonString], { type: 'application/json' });
      // Desktop-safe save: native dialog in Tauri, anchor download on the web
      const savedPath = await saveBlobToDisk(blob, `artboard-project-${project.id}.json`);
      if (savedPath === null) return; // user cancelled the save dialog

      trackExportJson();

      toast({
        title: "Project Exported",
        description: savedPath ? `Saved to ${savedPath}` : "Project has been exported as JSON file from database.",
        variant: "default",
      });
    } catch (error) {
      console.error("Error exporting project:", error);
      toast({
        title: "Export Failed",
        description: "There was an error exporting the project from database.",
        variant: "destructive",
      });
    }
  };

  // --- cloud account (Bring-Your-Own-Storage) -------------------------------

  const openAccountDialog = (hint?: string, tab: 'cloud' | 'storage' = 'cloud') => {
    setAccountHint(hint);
    setAccountTab(tab);
    setIsAccountOpen(true);
  };

  /** "Google Drive" / "GitHub gists", for copy that names where a save lands. */
  const accountStorageLabel = accountSession
    ? accountSession.provider === 'google' ? 'Google Drive' : 'GitHub gists'
    : 'storage';

  const handleAccountSaveError = (error: unknown) => {
    // An expired sign-in already cleared the session, so send the user back
    // through the dialog rather than showing a dead end.
    if (error instanceof AccountAuthError) {
      setSaveConflict(null);
      openAccountDialog(error.message);
    } else {
      toast({
        title: "Could not save",
        description: error instanceof Error ? error.message : "Something went wrong.",
        variant: "destructive",
      });
    }
  };

  /**
   * The upload itself. Without `copyName` this overwrites whatever is up there
   * (providers match on project id); with one it saves a second, independent
   * file and leaves both the cloud original and the local project alone.
   */
  const runAccountSave = async (copyName?: string) => {
    if (!activeProjectId) return;
    setIsSavingToAccount(true);
    try {
      // saveProjectToAccount reads the stored row; commit pending edits first.
      flushProjectSave();
      const saved = await saveProjectToAccount(activeProjectId, {
        saveAsCopy: copyName ? { id: newCloudProjectId(), name: copyName } : undefined,
      });
      setSaveConflict(null);
      setConflictFromSync(false);
      // Same row, same document: without this the syncer would push a duplicate
      // of what was just uploaded a minute later. A copy is a separate file and
      // leaves the open project's link where it was, so it says nothing here.
      if (!copyName) accountSync.noteSaved();
      toast({
        title: copyName ? "Saved as a new project" : "Saved to your account",
        description: copyName
          ? `"${saved.name}" is a separate file in your ${accountStorageLabel} now. Your open project is unchanged.`
          : `"${saved.name}" is in your ${accountStorageLabel}.`,
      });
    } catch (error) {
      handleAccountSaveError(error);
    } finally {
      setIsSavingToAccount(false);
    }
  };

  /**
   * The third answer to a sync conflict: leave both copies exactly as they are.
   *
   * Per project rather than the Settings switch, because "these two have
   * drifted and I will sort it out later" is not the same as "stop syncing
   * everything". Saving this project by hand later turns it back on, which is
   * the same act that turned it on in the first place.
   */
  const handleStopSyncingProject = async () => {
    if (!activeProjectId) return;
    await setAccountLinkAutoSync(activeProjectId, false);
    accountSync.noteUnlinked();
    setSaveConflict(null);
    setConflictFromSync(false);
    toast({
      title: "Syncing stopped for this project",
      description: `Both copies are left as they are. Saving to your ${accountStorageLabel} by hand starts it again.`,
    });
  };

  /**
   * Toolbar "Save to account". Signed out this is how the user finds out they
   * need to connect, so it opens the dialog instead of doing nothing.
   */
  const handleSaveToAccount = async () => {
    if (!isAccountConnected) {
      openAccountDialog('Sign in to save this project to your own storage.');
      return;
    }
    if (!activeProjectId) {
      toast({
        title: "Nothing to save yet",
        description: "Create or open a project first.",
        variant: "destructive",
      });
      return;
    }

    // Ask before overwriting, but only when there is something to overwrite:
    // a first save has no choice to offer and should stay one click.
    setIsSavingToAccount(true);
    let existing: CloudProjectSummary | null = null;
    try {
      existing = await findAccountProject(activeProjectId);
    } catch (error) {
      handleAccountSaveError(error);
      setIsSavingToAccount(false);
      return;
    }
    setIsSavingToAccount(false);

    if (existing) {
      setConflictFromSync(false);
      setSaveConflict(existing);
      return;
    }
    await runAccountSave();
  };

  /**
   * Pull a project out of the connected account and open it in the editor.
   *
   * Every step is reported: this downloads the document, then each recording and
   * imported font one at a time, then writes them all into IndexedDB. On a big
   * project that is a long wait in which the canvas would otherwise sit there
   * showing the project the user is leaving.
   */
  const handleOpenFromAccount = async (remoteId: string, name: string) => {
    setLoadPhase('project');
    setProjectLoadStatus({ name, step: 'Reading your project', ratio: 0 });
    const claimed: string[] = [];
    const from = `your ${accountStorageLabel}`;
    // An open from the claim on, so a tab of the project that leaves for
    // another window while the media go in stops it before the row does.
    const opening: { open?: ReturnType<typeof beginOpen> } = {};
    try {
      const project = await loadProjectFromAccount(
        remoteId,
        (step, ratio) => setProjectLoadStatus({ name, step, ratio }),
        // Restoring over the local copy writes it, so it is claimed first.
        async (projectId, projectName) => {
          await claimProject(projectId, projectName);
          claimed.push(projectId);
          opening.open = beginOpen(projectId, { importing: true });
        },
        (write) => (opening.open ? opening.open.write(write) : write())
      );
      if (opening.open?.stopped()) {
        toastOpenedElsewhere(project.name, true, from);
        return;
      }
      // Building the boards is the tail of the same wait: positions are
      // recalculated and inline media is externalized before anything renders.
      setProjectLoadStatus({ name: project.name, step: 'Preparing artboards', ratio: 0.97 });
      const success = await loadProjectFromData(project.projectData, project.name, project.id);
      if (success) {
        setIsTemplateSelectorOpen(false);
        toast({ title: "Project opened", description: `"${project.name}" loaded from your account.` });
      } else {
        toast({ title: "Could not open", description: `"${name}" failed to load.`, variant: "destructive" });
      }
    } catch (error) {
      if (error instanceof OpenStoppedError) {
        toastOpenedElsewhere(name, false, from);
      } else if (error instanceof ProjectOpenElsewhereError) {
        askAboutProjectElsewhere(error);
      } else if (error instanceof AccountAuthError) {
        openAccountDialog(error.message);
      } else {
        toast({
          title: "Could not open",
          description: error instanceof Error ? error.message : "Something went wrong.",
          variant: "destructive",
        });
      }
    } finally {
      opening.open?.end();
      claimed.forEach(settleLock);
      setLoadPhase('idle');
      setProjectLoadStatus(null);
    }
  };

  /**
   * An open from the account or the cloud whose project's tab left for another
   * window before it was done. Either the copy went in first, and that window
   * opens it, or nothing was written and the copy can be opened there.
   */
  const toastOpenedElsewhere = (name: string, written: boolean, from: string) =>
    toast(
      written
        ? { title: `${name} opened in another window`, description: 'Its tab moved there while it opened.' }
        : {
            title: `${name} did not open here`,
            description: `Its tab moved to another window first. Open it from ${from} there.`,
          }
    );

  // --- our own cloud ---------------------------------------------------------

  /**
   * Refresh what this device knows about the open project's cloud copy.
   *
   * Reads the local link table only: it is one IndexedDB point read, it runs on
   * every project switch, and the toolbar labels are the only thing that depends
   * on it. The server is asked at save time, where being wrong actually costs
   * something.
   */
  const refreshCloudLink = useCallback(async () => {
    if (!activeProjectId || !isCloudAvailable) {
      setCloudLink(null);
      return;
    }
    const link = await getCloudLink(activeProjectId, discoverSession?.viewer?.id ?? null);
    setCloudLink(link);
    // The invite link is the share slug plus the room key, and the key only
    // ever exists on this device. A project with one but not the other has no
    // invite yet: the dialog offers to make one.
    setCollabInvite(
      link?.shareSlug && link?.collabKey ? { slug: link.shareSlug, key: link.collabKey } : null
    );
  }, [activeProjectId, discoverSession, isCloudAvailable]);

  useEffect(() => {
    void refreshCloudLink();
  }, [refreshCloudLink]);

  // An auto save writes the same link row a manual one does, so the toolbar has
  // to catch up: "To the cloud" becomes "Update the cloud copy" the moment the
  // first automatic push lands, without anybody clicking anything.
  useEffect(() => {
    if (!cloudAutoSave.status.savedAt) return;
    void refreshCloudLink();
  }, [cloudAutoSave.status.savedAt, refreshCloudLink]);

  /**
   * Signed out, the way in is the same account dialog Discover uses, and it is
   * now also where the cloud list lives: connecting storage there is what mints
   * the community session the cloud routes need, so one door covers both.
   */
  const requireCloudSignIn = (hint: string) => {
    openAccountDialog(hint, 'cloud');
  };

  const handleCloudError = (error: unknown, title: string) => {
    if (error instanceof CloudSignInRequiredError) {
      requireCloudSignIn('Your session expired. Sign in again to reach your cloud projects.');
      return;
    }
    toast({
      title,
      description: error instanceof Error ? error.message : 'Something went wrong.',
      variant: 'destructive',
    });
  };

  /**
   * The upload. `force` is only ever true on the second attempt, after the
   * conflict dialog has been answered.
   */
  const runCloudSave = async (force = false): Promise<boolean> => {
    if (!activeProjectId) return false;
    setIsSavingToCloud(true);
    try {
      // saveProjectToCloud reads the stored row; commit pending edits first.
      flushProjectSave();
      const { project, failedAssets } = await saveProjectToCloud(activeProjectId, { force });
      setCloudConflict(null);
      // This push covers everything the automatic one was waiting to send, and
      // an overwrite here is also the answer to whatever it was paused on.
      cloudAutoSave.noteSaved();
      await refreshCloudLink();
      toast({
        title: failedAssets.length ? 'Saved, with files still to upload' : 'Saved to the cloud',
        description: failedAssets.length
          ? `"${project.name}" is saved, but ${failedAssets.length} file${failedAssets.length === 1 ? '' : 's'} did not upload. Save again to finish.`
          : `"${project.name}" is in your cloud. Open it from any device you sign in on.`,
      });
      return true;
    } catch (error) {
      if (error instanceof CloudConflictError) {
        setCloudConflict(error.remote);
        return false;
      }
      handleCloudError(error, 'Could not save to the cloud');
      return false;
    } finally {
      setIsSavingToCloud(false);
    }
  };

  /** Toolbar "Save to cloud". Signed out, this is how somebody finds out. */
  const handleSaveToCloud = async () => {
    if (!isCloudSignedIn) {
      requireCloudSignIn('Sign in to save your projects to the cloud.');
      return;
    }
    if (!activeProjectId) {
      toast({
        title: 'Nothing to save yet',
        description: 'Create or open a project first.',
        variant: 'destructive',
      });
      return;
    }
    await runCloudSave();
  };

  /**
   * "Get a link to share": save if needed, turn the link on, copy it.
   *
   * One action rather than three, because "share this project with somebody" is
   * one intention. An unsaved project is saved first: a link to nothing would be
   * the most confusing possible outcome of clicking this.
   */
  const handleCopyProjectLink = async () => {
    if (!isCloudSignedIn) {
      requireCloudSignIn('Sign in to get a shareable link for this project.');
      return;
    }
    if (!activeProjectId) {
      toast({
        title: 'Nothing to share yet',
        description: 'Create or open a project first.',
        variant: 'destructive',
      });
      return;
    }

    // Already shared: copy what exists rather than minting a new slug, which
    // would break a link somebody has already been sent.
    const existing = await getCloudLink(activeProjectId, discoverSession?.viewer?.id ?? null);
    if (existing?.visibility === 'link' && existing.shareSlug) {
      await copyShareUrl(buildShareUrl(existing.shareSlug));
      return;
    }

    setIsSavingToCloud(true);
    try {
      // saveProjectToCloud reads the stored row; commit pending edits first.
      flushProjectSave();
      const saved = await saveProjectToCloud(activeProjectId, { force: !!existing });
      cloudAutoSave.noteSaved();
      const result = await setCloudProjectShared(saved.project.id, activeProjectId, true);
      await refreshCloudLink();
      await copyShareUrl(result.url);
    } catch (error) {
      if (error instanceof CloudConflictError) {
        setCloudConflict(error.remote);
      } else {
        handleCloudError(error, 'Could not create a link');
      }
    } finally {
      setIsSavingToCloud(false);
    }
  };

  // --- editing together ------------------------------------------------------

  /**
   * The room this device is in, or the one this project has an invite for.
   *
   * The live session wins: a guest is in a room their own copy of the project
   * has never heard of, and the link they should see is the one they are
   * actually in.
   */
  const collabRoom: CollabInvite | null = collab.room ?? collabInvite;
  const collabInviteUrl = collabRoom ? buildInviteUrl(collabRoom.slug, collabRoom.key) : null;

  /** The invite link, copied with the words that describe what it grants. */
  const copyCollabUrl = async (url: string) => {
    if (!url) return;
    let copied = false;
    try {
      await navigator.clipboard.writeText(url);
      copied = true;
    } catch {
      copied = false;
    }
    toast({
      title: copied ? 'Invite link copied' : 'Your invite link',
      description: copied
        ? 'Anyone with this link can edit this project with you, once they sign in.'
        : url,
    });
  };

  /**
   * Start editing together, or hand the link out again.
   *
   * Four steps, each skipped when it is already done: the project has to be in
   * the cloud (that is where somebody following the link gets their first copy
   * from), the cloud copy has to be link-shared (that is what makes it readable
   * to them), the project needs a room key (minted here, kept only on this
   * device), and this browser has to join the room.
   *
   * `rotate` is the reset: a new slug AND a new key, which is what makes every
   * link handed out so far open nothing at all.
   */
  const startCollabSession = async (options: { rotate?: boolean } = {}) => {
    if (!isCloudAvailable) return;
    if (!isCloudSignedIn) {
      requireCloudSignIn('Sign in to edit this project with other people.');
      return;
    }
    if (!activeProjectId) {
      toast({
        title: 'Nothing to share yet',
        description: 'Create or open a project first.',
        variant: 'destructive',
      });
      return;
    }

    setIsCollabWorking(true);
    try {
      // The push reads the stored row, exactly as every other cloud path does.
      flushProjectSave();
      const accountId = discoverSession?.viewer?.id ?? null;
      let link = await getCloudLink(activeProjectId, accountId);
      if (!link) {
        await saveProjectToCloud(activeProjectId);
        cloudAutoSave.noteSaved();
        link = await getCloudLink(activeProjectId, accountId);
      }
      if (!link) throw new Error('This project could not be saved to the cloud.');

      let slug = link.shareSlug;
      if (options.rotate || link.visibility !== 'link' || !slug) {
        const shared = await setCloudProjectShared(link.recordId, activeProjectId, true);
        slug = shared.shareSlug;
      }
      let key = options.rotate ? '' : link.collabKey ?? '';
      if (!key) {
        key = newRoomKey();
        await setCloudLinkCollabKey(activeProjectId, key);
      }

      collabProjectRef.current = activeProjectId;
      if (options.rotate) collab.stop();
      await collab.start(slug, key);
      setCollabInvite({ slug, key });
      await refreshCloudLink();
      setIsCollabOpen(true);
      await copyCollabUrl(buildInviteUrl(slug, key));
    } catch (error) {
      if (error instanceof CloudConflictError) setCloudConflict(error.remote);
      else handleCloudError(error, 'Could not start the session');
    } finally {
      setIsCollabWorking(false);
    }
  };

  /**
   * Open somebody's invite.
   *
   * The link carries where the first copy is and the key to the room. What it
   * does not carry is which local project that turns into, so this looks for
   * one already here (a room joined before, or the owner's own project) before
   * importing a fresh copy. Skipping that check is what would leave somebody
   * with five copies of a project they joined five times.
   */
  const joinCollabInvite = async (invite: CollabInvite) => {
    setIsCollabWorking(true);
    setLoadPhase('project');
    try {
      const accountId = discoverSession?.viewer?.id ?? null;
      let projectId = joinedProjectFor(invite.slug);
      if (!projectId) {
        const links = await listCloudLinks(accountId);
        projectId = links.find((row) => row.shareSlug === invite.slug)?.projectId ?? null;
      }

      let opened = false;
      if (projectId) {
        const stored = await db.projects.get(projectId);
        if (stored?.projectData) {
          opened = await loadProjectFromData(stored.projectData, stored.name, stored.id);
        }
      }
      if (!opened) {
        const project = await openSharedProject(invite.slug);
        opened = await loadProjectFromData(project.projectData, project.name, project.id);
        projectId = project.id;
        if (opened) rememberJoined(invite.slug, project.id);
      }
      if (!opened || !projectId) throw new Error('That project could not be opened.');

      setIsTemplateSelectorOpen(false);
      collabProjectRef.current = projectId;
      await collab.start(invite.slug, invite.key);
      toast({
        title: 'You are editing together',
        description:
          'Everyone holding this link works on the same project. Their pointers and selections show up as they go.',
      });
    } catch (error) {
      if (error instanceof ProjectOpenElsewhereError) {
        // Joining from there is one click away, and a copy made here would be
        // a second project for the same session.
        askAboutProjectElsewhere(error);
        return;
      }
      toast({
        title: 'Could not join that session',
        description: error instanceof Error ? error.message : 'That link is not valid any more.',
        variant: 'destructive',
      });
    } finally {
      setPendingInvite(null);
      setIsJoiningInvite(false);
      setIsCollabWorking(false);
      setLoadPhase('idle');
    }
  };

  /**
   * An invite on the URL, handled once.
   *
   * The link comes off the address bar immediately, fragment and all: the
   * fragment is the room key, and a key left in the URL ends up in the next
   * screenshot and in the history of a shared machine.
   */
  const collabInviteHandled = useRef(false);
  useEffect(() => {
    if (collabInviteHandled.current) return;
    const invite = readInviteFromUrl();
    if (!invite) {
      // A link that arrived without its fragment cannot open a session, and
      // failing silently is how both people end up believing they are in one.
      if (invitedWithoutKey()) {
        collabInviteHandled.current = true;
        clearInviteFromUrl();
        toast({
          title: 'That invite link is incomplete',
          description:
            'The part after the # is what opens the session, and it did not survive the copy. Ask for the link again and paste the whole thing.',
          variant: 'destructive',
        });
      }
      return;
    }
    collabInviteHandled.current = true;
    clearInviteFromUrl();
    if (!HAS_DISCOVER) {
      setIsJoiningInvite(false);
      toast({
        title: 'Live editing is not available here',
        description: 'This build has no session server configured.',
        variant: 'destructive',
      });
      return;
    }
    setIsTipsOpen(false);
    setPendingInvite(invite);
    // Once, on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Held until somebody is signed in, because a session with no name on it is
  // exactly what this feature is not.
  useEffect(() => {
    if (!pendingInvite || isCollabWorking) return;
    if (!isCloudSignedIn) {
      requireCloudSignIn('Sign in to join this live editing session.');
      return;
    }
    void joinCollabInvite(pendingInvite);
    // joinCollabInvite is re-created on every render; the guard above is what
    // stops a second run rather than the dependency list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingInvite, isCloudSignedIn]);

  // What this person has selected, so everybody else's canvas can draw a ring
  // around it in their colour.
  useEffect(() => {
    if (collab.status === 'off') return;
    // The first id as well as the whole set: a peer on a build from before
    // multi-select reads only `elementId`, and should still see one ring rather
    // than none the moment somebody picks two layers.
    collab.setSelection(activeArtboardId, selectedElementIds[0] ?? null, selectedElementIds);
  }, [collab.status, collab.setSelection, activeArtboardId, selectedElementIds]);

  // Opening another project leaves the room. Staying in would publish the new
  // project's boards into the old project's session.
  useEffect(() => {
    if (!collab.room) return;
    if (activeProjectId && activeProjectId !== collabProjectRef.current) collab.stop();
  }, [activeProjectId, collab.room, collab.stop]);

  /**
   * Clipboard, with a fallback that is not "nothing happened".
   *
   * `navigator.clipboard` needs a secure context and a user gesture, and both
   * WebViews have refused it before. The toast shows the URL either way, so the
   * link is always selectable even when the write failed.
   */
  const copyShareUrl = async (url: string) => {
    if (!url) return;
    let copied = false;
    try {
      await navigator.clipboard.writeText(url);
      copied = true;
    } catch {
      copied = false;
    }
    toast({
      title: copied ? 'Link copied' : 'Your share link',
      description: copied
        ? 'Anyone with this link can open a copy of this project. Turn it off from Your cloud projects.'
        : url,
    });
  };

  /** Pull one of the account's own cloud projects into the editor. */
  const handleOpenCloudProject = async (project: CloudProject, asCopy: boolean) => {
    const claimed: string[] = [];
    // As with the account (handleOpenFromAccount): an open from the claim on.
    const opening: { open?: ReturnType<typeof beginOpen> } = {};
    try {
      setLoadPhase('project');
      setProjectLoadStatus({ name: project.name, step: 'Reading your project', ratio: 0 });
      const opened = await loadProjectFromCloud(project.id, {
        asCopy,
        onProgress: (step, ratio) => setProjectLoadStatus({ name: project.name, step, ratio }),
        // Restoring over the local copy writes it, so it is claimed first.
        beforeWrite: async (projectId, projectName) => {
          await claimProject(projectId, projectName);
          claimed.push(projectId);
          opening.open = beginOpen(projectId, { importing: true });
        },
        guardRowWrite: (write) => (opening.open ? opening.open.write(write) : write()),
      });
      if (opening.open?.stopped()) {
        toastOpenedElsewhere(opened.name, true, 'your cloud projects');
        return;
      }
      setProjectLoadStatus({ name: opened.name, step: 'Preparing artboards', ratio: 0.97 });
      const success = await loadProjectFromData(opened.projectData, opened.name, opened.id);
      if (success) {
        setIsTemplateSelectorOpen(false);
        await refreshCloudLink();
        toast({ title: 'Project opened', description: `"${opened.name}" loaded from your cloud.` });
      } else {
        toast({
          title: 'Could not open',
          description: `"${project.name}" failed to load.`,
          variant: 'destructive',
        });
      }
    } catch (error) {
      if (error instanceof OpenStoppedError) toastOpenedElsewhere(project.name, false, 'your cloud projects');
      else if (error instanceof ProjectOpenElsewhereError) askAboutProjectElsewhere(error);
      else handleCloudError(error, 'Could not open that project');
    } finally {
      opening.open?.end();
      claimed.forEach(settleLock);
      setLoadPhase('idle');
      setProjectLoadStatus(null);
    }
  };

  /*
   * A ?shared= link, opened cold.
   *
   * Runs once, before anything else has claimed the canvas, and always imports
   * under a fresh local id: the person following the link did not save this
   * project and must not end up overwriting one of their own that happens to
   * share an id.
   *
   * The slug comes off the URL immediately, before the import rather than after
   * it, and that ordering is the point. `loadProjectFromData` writes
   * `?projectId=` onto whatever query string it finds, so clearing afterwards
   * leaves a window in which the address bar reads `?shared=…&projectId=…` — a
   * URL that, copied into another tab, would both restore the local copy AND
   * import a second one. Clearing first also means a reload mid-import resumes
   * as an ordinary session instead of importing again. Nothing is lost on a
   * failure either: the slug was cleared in that case too.
   */
  const sharedSlugHandled = useRef(false);
  useEffect(() => {
    if (sharedSlugHandled.current) return;
    const slug = readSharedSlugFromUrl();
    if (!slug) return;
    sharedSlugHandled.current = true;
    clearSharedSlugFromUrl();
    if (!HAS_DISCOVER) {
      setIsOpeningSharedLink(false);
      return;
    }

    (async () => {
      setLoadPhase('project');
      setProjectLoadStatus({ step: 'Reading the shared project', ratio: 0 });
      setIsTipsOpen(false);
      try {
        const opened = await openSharedProject(slug, (step, ratio) =>
          setProjectLoadStatus({ step, ratio })
        );
        setProjectLoadStatus({ name: opened.name, step: 'Preparing artboards', ratio: 0.97 });
        const success = await loadProjectFromData(opened.projectData, opened.name, opened.id);
        if (success) {
          setIsTemplateSelectorOpen(false);
          toast({
            title: 'Shared project opened',
            description: `"${opened.name}" is yours to edit now. It is a copy, so nothing you do here reaches whoever sent it.`,
          });
        }
      } catch (error) {
        toast({
          title: 'Could not open that link',
          description: error instanceof Error ? error.message : 'That link is not valid any more.',
          variant: 'destructive',
        });
      } finally {
        // Released last, so the start dialog only appears if the import failed
        // and there is genuinely nothing open.
        setIsOpeningSharedLink(false);
        setLoadPhase('idle');
        setProjectLoadStatus(null);
      }
    })();
    // Once, on mount. loadProjectFromData is stable enough for this and adding
    // it would re-run the import every render it changed identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Capture a list of artboards to PNG downloads by grabbing each board's
  // live DOM node (matched by artboard id). The list must be what the canvas
  // is currently rendering — for generated formats, handleConfirmExport
  // swaps the converted list in first and restores afterwards.
  // Rasterize ONE artboard from the live canvas DOM. Shared by the file export
  // and the store upload so both produce identical PNGs, and so the
  // filter/background/unscale recipe only exists once. Returns null when the
  // board is not currently mounted (nothing off-DOM can be captured).
  const captureArtboardDataUrl = async (artboard: ArtboardState): Promise<string | null> => {
    const artboardElement = document.querySelector(
      `[data-artboard-dom-id="${artboard.id}"]`
    ) as HTMLElement | null;

    if (!artboardElement) {
      console.warn(`Could not find DOM element for artboard: ${artboard.name}`);
      toast({
        title: "Export Warning",
        description: `Could not find artboard '${artboard.name}' to export.`,
        variant: "destructive",
      });
      return null;
    }

    // toPng does not wait for webfonts. Exporting straight after switching to
    // a language in another script used to rasterize the fallback face with
    // no error at all, which is invisible until the store rejects it.
    if (typeof document !== 'undefined' && document.fonts?.ready) {
      try {
        await document.fonts.ready;
      } catch {
        // A browser that cannot report font loading just captures what it has.
      }
    }

    // Use html-to-image to capture the artboard at exact specified dimensions.
    // The unscale goes through the `style` option, which html-to-image applies
    // to its CLONE: the live node used to be blown up to scale(1) in place for
    // the whole async capture, briefly overlapping neighboring boards on
    // screen, which is the background-bleed half of the issue #19 glitch.
    const { backgroundColor, backgroundImage } = artboardBackground(artboard);
    return await captureNodeToPng(artboardElement, {
      width: artboard.size.width,
      height: artboard.size.height,
      backgroundColor,
      pixelRatio: 1, // Set to 1 to avoid doubling resolution
      // cacheBust appends a query string to every fetched resource, which
      // breaks blob: object URLs (a busted blob URL is an unregistered one,
      // net::ERR_FILE_NOT_FOUND) — and uploaded images resolve to blob URLs
      // since the issue #19 media work. Same rationale as videoExport.ts.
      cacheBust: false,
      // Editor chrome (selection outlines, resize handles, upload buttons)
      // must never be baked into the exported image
      filter: (node) => {
        const el = node as HTMLElement;
        return !(el?.hasAttribute?.('data-export-exclude') || el?.hasAttribute?.('data-interaction-handle'));
      },
      style: {
        transform: 'scale(1)',
        transformOrigin: 'top left',
        width: `${artboard.size.width}px`,
        height: `${artboard.size.height}px`,
        backgroundImage,
      }
    });
  };

  const captureArtboards = async (
    list: ArtboardState[],
    exportDir?: string | null,
    // Canvas position (1-based) per artboard id, plus how many boards the
    // project has. A scoped export passes only a subset of the canvas, so
    // without this the fourth artboard would still be filed as "01_".
    // `stemById` names the header and search art, worked out over the whole
    // canvas so two designs of one kind never share a file.
    order?: { indexById: Record<string, number>; total: number; stemById?: Record<string, string> },
    // Progress plumbing. `report` is fed one update per phase change so the
    // dialog can name what it is on; `formatLabel` tags a generated App Store
    // pass. Returns the files actually written so the caller can summarise.
    progress?: {
      report: (update: Omit<PngExportProgress, 'fileCount'>) => void;
      formatLabel?: string;
      // Names the language on screen while a multi-language run is in flight.
      localeLabel?: string;
      // Absolute file number of the first file in this pass, so the counter
      // keeps climbing across the as-is pass and every generated format.
      startIndex: number;
    },
    // Where this language's files go. `subdir` is one folder segment on
    // desktop (screenshots/de-DE/...); `filenameToken` is the flat prefix the
    // web build gets instead, because a browser download has no folder to put
    // it in. Both are unset on a project with one language, so its filenames
    // are byte-identical to what they always were.
    locale?: { subdir?: string; filenameToken?: string }
  ) => {
    // Array order matches canvas order (calculateArtboardPositions lays boards
    // out left-to-right by index), so the loop index is the on-canvas position.
    const orderPadWidth = Math.max(2, String(order?.total ?? list.length).length);
    // `path` is set only where the file landed somewhere nameable (Tauri); a
    // web anchor download has no path to report.
    const saved: { filename: string; path?: string }[] = [];

    for (const [index, artboard] of list.entries()) {
      // Cancellation lands between files: a half-written PNG helps nobody, and
      // each capture is short enough that finishing it is barely a wait.
      if (pngExportCancelRef.current) break;
      progress?.report({
        fileIndex: progress.startIndex + index,
        boardName: artboard.name,
        formatLabel: progress.formatLabel,
        localeLabel: progress.localeLabel,
        phase: 'rendering',
      });
      try {
        const imageDataUrl = await captureArtboardDataUrl(artboard);
        if (!imageDataUrl) continue; // board is not mounted, already reported

        // Prefix with the canvas position (zero-padded so 10+ boards sort correctly)
        const canvasIndex = order?.indexById[artboard.id] ?? index + 1;
        const orderPrefix = String(canvasIndex).padStart(orderPadWidth, '0');
        // Suffix with the artboard's device format (iPhone/Android/tablet) so the
        // same board exported for different stores stays distinguishable on disk.
        // Detected per artboard, not project-wide, so mixed projects tag correctly.
        const artboardFormat = detectArtboardsFormat([artboard]);
        const deviceLabel = artboardFormat && artboardFormat !== 'mixed'
          ? DEVICE_FORMAT_PRESETS.find((p) => p.id === artboardFormat)?.label
          : undefined;
        const deviceSuffix = deviceLabel ? `_${deviceLabel.replace(/\s+/g, '_')}` : '';
        // Then the canvas size tier the board was exported at. The device
        // suffix above names the MOCKUP in the board, this names the canvas,
        // and the two genuinely differ (an iPhone mockup on a Play 1080x1920
        // board). Generated App Store formats resize the board first, so each
        // pass tags its own size here rather than the original one.
        const sizeSuffix = `_${canvasSizeSlug(artboard.size)}`;
        // Language first, so a sorted listing groups by language. Only on the
        // flat path: with a folder per language the token would repeat.
        const localePrefix = locale?.filenameToken ? `${locale.filenameToken}_` : '';
        // Header and search art is named for where it goes in App Store
        // Connect, and takes no screenshot number, so the screenshots still
        // run 01..N.
        const creativeStem = order?.stemById?.[artboard.id] ?? creativeFileStem(artboard);
        const filename = creativeStem
          ? `${localePrefix}${creativeStem}.png`
          : `${localePrefix}${orderPrefix}_${artboard.name.replace(/\s+/g, '_')}${deviceSuffix}${sizeSuffix}.png`;
        progress?.report({
          fileIndex: progress.startIndex + index,
          boardName: artboard.name,
          formatLabel: progress.formatLabel,
          localeLabel: progress.localeLabel,
          phase: 'saving',
        });
        // Desktop-safe save: batch exports write into the pre-picked folder,
        // single files get a native save dialog in Tauri or an anchor
        // download on the web
        const savedPath = exportDir
          ? await saveDataUrlToPath(imageDataUrl, exportDir, filename, locale?.subdir)
          : await saveDataUrlToDisk(imageDataUrl, filename);
        if (savedPath === null) continue; // user cancelled this board's save dialog

        // One toast per file drowns a 12-file App Store run, and the progress
        // dialog now narrates it live, so the caller summarises at the end
        // instead. A lone file still gets its own toast there.
        saved.push({ filename, path: savedPath || undefined });

      } catch (error) {
        console.error("Error exporting artboard:", artboard.name, error);
        toast({
          title: "Export Error",
          description: `Failed to export artboard "${artboard.name}". See console for details.`,
          variant: "destructive",
        });
      }
    }

    return saved;
  };

  // Two rAFs get past React's commit and the browser's next paint after a
  // temporary format swap; the extra delay lets images decode and the
  // three.js device scenes rebuild before capture.
  const waitForCanvasToSettle = async (ms: number) => {
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    );
    await new Promise((resolve) => setTimeout(resolve, ms));
  };

  // Export flow behind the ExportDialog: capture the canvas as-is and/or
  // generate App Store formats (iPhone medium/large, iPad 13/11-inch) the project
  // is missing, once per language the dialog asked for. Every pass renders
  // through exportCanvasArtboards, a temporary canvas list that never touches
  // history or Dexie, so this can never corrupt the user's work.
  const handleConfirmExport = async (
    { asIs, generateFormats, currentArtboardOnly, locales }: ExportSelection,
    { skipAppPreviewBoards = false }: { skipAppPreviewBoards?: boolean } = {}
  ) => {
    setIsExportDialogOpen(false);
    // Both exports rasterize the live canvas, so a timeline left running would
    // bake a mid-animation frame into the output.
    stopPlayback();

    const original = artboardsRef.current;

    // "Selected artboard only" narrows what gets captured, never what gets
    // rendered: the format conversions below still run over the whole canvas
    // so a converted board sits in the same layout it always did, and only
    // the selected id is grabbed from the DOM.
    const scopedId =
      currentArtboardOnly && activeArtboardId && original.some((ab) => ab.id === activeArtboardId)
        ? activeArtboardId
        : null;
    // The screenshot dialog leaves App Preview boards out: their output is a
    // video, and a PNG of one is a frozen timeline nobody asked for. The App
    // Preview dialog's stills still capture them, so this is opt-in. Header
    // and search art always exports as a still, animated or not.
    const skippedIds = new Set(
      skipAppPreviewBoards
        ? original.filter((ab) => projectHasVideoContent([ab]) && !isCreativeBoard(ab)).map((ab) => ab.id)
        : []
    );
    const scope = (list: ArtboardState[]) =>
      list.filter((ab) => !skippedIds.has(ab.id) && (!scopedId || ab.id === scopedId));
    // The extra App Store sizes are screenshot sizes. Header and search art has
    // one size and goes out with the as-is pass only.
    const scopeForFormat = (list: ArtboardState[]) => scope(list).filter((ab) => !isCreativeBoard(ab));

    const targets = scope(original);
    if (targets.length === 0) {
      toast({
        title: "Nothing to export",
        description: skippedIds.size > 0 && (!scopedId || skippedIds.has(scopedId))
          ? "App Preview artboards export as a video. Select one, then export again."
          : currentArtboardOnly
            ? "Select an artboard on the canvas first."
            : "Add an artboard first.",
        variant: "destructive",
      });
      return [];
    }

    // null means "leave the canvas on whatever language it is showing", which
    // is every project with no languages and every run started from the App
    // Preview dialog. The dialog hands back store codes with the base language
    // first, and projectArtboards returns the base array by reference for it.
    const localesToExport: (string | null)[] = locales && locales.length > 0 ? locales : [null];
    const multiLocale = localesToExport.length > 1;

    // Desktop batch exports pick one destination folder up front instead of
    // opening a native save dialog per file; cancelling the picker aborts
    // the whole export. Single-file exports keep the per-file save dialog.
    let exportDir: string | null | undefined;
    const formatTargetCount = targets.filter((ab) => !isCreativeBoard(ab)).length;
    const filesPerLocale = (asIs ? targets.length : 0) + generateFormats.length * formatTargetCount;
    const totalFiles = filesPerLocale * localesToExport.length;
    if (isTauri() && totalFiles > 1) {
      exportDir = await pickExportDirectory('Choose a folder for the exported artboards');
      if (exportDir === null) return [];
    }

    // A picked folder gets a subfolder per language (the screenshots/<locale>/
    // convention); a browser download has nowhere to put one, so it gets the
    // token in the name instead. Neither is set on a single-language run.
    const localeFilingFor = (locale: string | null) =>
      multiLocale && locale
        ? exportDir
          ? { subdir: locale }
          : { filenameToken: locale }
        : undefined;
    const localeLabelFor = (locale: string | null) =>
      multiLocale && locale ? localeName(locale) : undefined;

    trackExportPng({
      mode: generateFormats.length > 0 ? 'app_store' : 'as_is',
      formats: generateFormats,
      artboardCount: targets.length,
      fileCount: totalFiles,
      localeCount: localesToExport.length,
    });

    // The progress dialog is on screen for exactly as long as pngProgress is
    // set, so seed it before the first capture: the App Store passes spend
    // their first second converting the canvas, with nothing else to show.
    pngExportCancelRef.current = false;
    setIsCancellingPngExport(false);
    setPngProgress({
      fileIndex: 1,
      fileCount: totalFiles,
      boardName: targets[0].name,
      localeLabel: localeLabelFor(localesToExport[0]),
      phase: 'preparing',
    });
    const report = (update: Omit<PngExportProgress, 'fileCount'>) =>
      setPngProgress({ ...update, fileCount: totalFiles });

    // 3D device canvases re-render supersampled while an export is in flight
    // (see Device3DRenderer); dispatched per capture pass so devices swapped
    // in by a format conversion get the treatment too. The small wait lets
    // that buffer swap present.
    const captureWithExportEvents = async (
      list: ArtboardState[],
      startIndex: number,
      order: { indexById: Record<string, number>; total: number; stemById?: Record<string, string> },
      locale: string | null,
      formatLabel?: string
    ) => {
      window.dispatchEvent(new CustomEvent('artboard:export', { detail: { phase: 'begin' } }));
      await new Promise((resolve) => setTimeout(resolve, 100));
      try {
        return await captureArtboards(
          list,
          exportDir,
          order,
          { report, formatLabel, localeLabel: localeLabelFor(locale), startIndex },
          localeFilingFor(locale)
        );
      } finally {
        window.dispatchEvent(new CustomEvent('artboard:export', { detail: { phase: 'end' } }));
      }
    };

    const saved: { filename: string; path?: string }[] = [];
    // Counts files *attempted*, not saved, so a board that fails to capture
    // does not drag the "image 3 of 12" counter backwards for the rest.
    let nextFileIndex = 1;
    // The state that got exported is the state worth being able to come back
    // to, so it is kept before the canvas is swapped for the run.
    void writeVersion(artboardsRef.current, 'Exported', 'auto');
    // Closes the mutation door for the whole run. Nothing may write the project
    // while the canvas is showing a converted or re-projected list.
    isExportingRef.current = true;
    try {
      for (const locale of localesToExport) {
        if (pngExportCancelRef.current) break;
        const projected = projectArtboards(original, locale);
        // Rebuilt per language, or the German set would be numbered 13..18
        // instead of 01..06 and every fastlane-style convention expects 1..N.
        // Skipped App Preview boards are left out of the count too, so the
        // exported screenshots still run 1..N without gaps, and so is header
        // and search art, which is named for its placement instead.
        const numbered = projected.filter((ab) => !skippedIds.has(ab.id) && !isCreativeBoard(ab));
        const order = {
          indexById: Object.fromEntries(numbered.map((ab, i) => [ab.id, i + 1])),
          total: numbered.length,
          stemById: creativeFileStems(projected),
        };
        report({
          fileIndex: nextFileIndex,
          boardName: targets[0].name,
          localeLabel: localeLabelFor(locale),
          phase: 'preparing',
        });
        // Swapped even when the projection is the base array by reference: the
        // canvas may be sitting on another language, and the export must show
        // the one it is capturing.
        setExportCanvasArtboards(calculateArtboardPositions(projected));
        await waitForCanvasToSettle(400);

        const localeTargets = scope(projected);
        if (asIs) {
          const startIndex = nextFileIndex;
          nextFileIndex += targets.length;
          saved.push(...(await captureWithExportEvents(localeTargets, startIndex, order, locale)));
        }
        for (const formatId of generateFormats) {
          if (pngExportCancelRef.current) break;
          const preset = DEVICE_FORMAT_PRESETS.find((p) => p.id === formatId);
          if (!preset || formatTargetCount === 0) continue;
          const startIndex = nextFileIndex;
          nextFileIndex += formatTargetCount;
          report({
            fileIndex: startIndex,
            boardName: targets[0].name,
            formatLabel: preset.label,
            localeLabel: localeLabelFor(locale),
            phase: 'preparing',
          });
          const { artboards: converted } = convertArtboardsToFormat(projected, preset);
          const repositioned = calculateArtboardPositions(converted);
          setExportCanvasArtboards(repositioned);
          await waitForCanvasToSettle(400);
          saved.push(
            ...(await captureWithExportEvents(scopeForFormat(repositioned), startIndex, order, locale, preset.label))
          );
        }
      }
    } catch (error) {
      console.error("Error during multi-format export:", error);
      toast({
        title: "Export Error",
        description: "Something went wrong during export. See console for details.",
        variant: "destructive",
      });
    } finally {
      // Unconditional, unlike the old `if (generateFormats.length)`: a
      // cancelled language run would otherwise leave the canvas on a language
      // the user never selected.
      setExportCanvasArtboards(null);
      isExportingRef.current = false;
      flushPendingRemote();
      setPngProgress(null);
      setIsCancellingPngExport(false);
      const cancelled = pngExportCancelRef.current;
      pngExportCancelRef.current = false;

      // One summary instead of a toast per file. A single-file export names
      // where it went, which is the useful bit on desktop.
      if (saved.length === 1 && !cancelled) {
        toast({
          title: "Artboard Exported",
          description: saved[0].path
            ? `Saved to ${saved[0].path}`
            : `"${saved[0].filename}" has been downloaded.`,
        });
      } else if (saved.length > 0) {
        toast({
          title: cancelled ? "Export Stopped" : "Export Complete",
          description: exportDir
            ? `${saved.length} of ${totalFiles} images saved to ${exportDir}`
            : `${saved.length} of ${totalFiles} images downloaded`,
          variant: cancelled ? "destructive" : "default",
          // Finishing an export is the moment people want to show the work, so
          // the offer to post it rides on the toast that says it is done. Only
          // on a clean run: nobody wants to share a half-finished export.
          action: cancelled ? undefined : (
            <ToastAction altText="Share these to Discover" onClick={() => openDiscover('share')}>
              Share
            </ToastAction>
          ),
        });
      } else if (cancelled) {
        toast({ title: "Export Cancelled" });
      }
    }

    // The filename manifest, for callers that are not a person watching a
    // toast. The headless bridge hands this to the CLI so it can wait for
    // exactly these files to land instead of counting downloads, and so
    // `osg manifest` can name every file the run produced.
    return saved;
  };

  // --- direct-to-store upload ----------------------------------------------

  /**
   * Render the boards the publish dialog picked, as PNG bytes in memory.
   *
   * Same capture path as the file export, including the temporary canvas list:
   * the chosen language's projection, optionally converted to a store format,
   * is painted so it can be photographed at the store's exact pixel size, then
   * cleared in a finally. History and the saved project are never touched, so
   * an upload can never corrupt the user's work.
   *
   * The dialog calls this once per language, serially, so it has to be safe to
   * re-enter back to back. The unconditional finally is what makes it so.
   */
  const handlePublishCapture = async (
    artboardIds: string[],
    formatId: DeviceFormat | null,
    locale?: string | null
  ): Promise<PublishImage[]> => {
    const original = artboardsRef.current;
    const orderPadWidth = Math.max(2, String(original.length).length);
    const stamp = locale ?? null;

    const buildImages = async (list: ArtboardState[]): Promise<PublishImage[]> => {
      const images: PublishImage[] = [];
      for (const [index, artboard] of list.entries()) {
        if (!artboardIds.includes(artboard.id)) continue;
        const dataUrl = await captureArtboardDataUrl(artboard);
        if (!dataUrl) continue;
        const orderPrefix = String(index + 1).padStart(orderPadWidth, '0');
        // Stamped with what was actually painted, not with what the caller
        // asked for. Both stores show the file name and nothing else, so five
        // languages arriving unlabelled are indistinguishable in their console.
        images.push({
          artboardId: artboard.id,
          fileName: sanitizeFileName(`${orderPrefix}_${artboard.name.replace(/\s+/g, '_')}.png`),
          bytes: decodeDataUrl(dataUrl),
          width: artboard.size.width,
          height: artboard.size.height,
          locale: stamp ?? undefined,
        });
      }
      return images;
    };

    // 3D device canvases supersample while an export is in flight; pair
    // begin/end in a finally or they stay at 2x forever.
    const capturePass = async (list: ArtboardState[]) => {
      window.dispatchEvent(new CustomEvent('artboard:export', { detail: { phase: 'begin' } }));
      await new Promise((resolve) => setTimeout(resolve, 100));
      try {
        return await buildImages(list);
      } finally {
        window.dispatchEvent(new CustomEvent('artboard:export', { detail: { phase: 'end' } }));
      }
    };

    const preset = formatId ? DEVICE_FORMAT_PRESETS.find((p) => p.id === formatId) : undefined;
    // Returns `original` by reference for null and for the base language.
    const projected = projectArtboards(original, stamp);
    // Nothing to swap: no store format, and the canvas is already showing what
    // is being uploaded.
    if (!preset && projected === original && !activeLocaleRef.current) {
      return capturePass(original);
    }

    isExportingRef.current = true;
    try {
      const list = preset
        ? calculateArtboardPositions(convertArtboardsToFormat(projected, preset).artboards)
        : calculateArtboardPositions(projected);
      setExportCanvasArtboards(list);
      await waitForCanvasToSettle(400);
      return await capturePass(list);
    } finally {
      setExportCanvasArtboards(null);
      isExportingRef.current = false;
      flushPendingRemote();
    }
  };

  /**
   * Render the App Preview boards the publish dialog picked, as MP4 bytes in
   * memory.
   *
   * The video counterpart of handlePublishCapture, and it mounts the boards for
   * the same reason that one does: exportArtboardVideo takes its sprites from
   * the live DOM, so the board has to be on the canvas in the language being
   * uploaded, converted to the size the dialog picked. Nothing is written to
   * disk on the way past, which is the whole point: the bytes go straight to
   * App Store Connect.
   *
   * Encoding runs minutes per board on the main thread, so the caller passes a
   * per-frame progress callback and an abort signal rather than waiting on one
   * promise that goes quiet.
   *
   * Always the store-legal cut (rawRecordingOnly), never the poster rehearsal:
   * guideline 2.3.4 wants a capture of the app itself, and a still under
   * overlays is not one.
   *
   * One board failing returns a warning rather than taking the run down. A
   * recording can be hidden in one language and present in another, so a board
   * the dialog measured as uploadable can still have nothing to encode by the
   * time a particular language is on the canvas.
   */
  const handlePublishCaptureVideos = async (
    artboardIds: string[],
    options: {
      locale?: string | null;
      /** The size the dialog picked, applied exactly as the PNG path applies it. */
      formatId?: DeviceFormat | null;
      /** The version's platform, which decides the accepted preview sizes. */
      platform?: string | null;
      /** Keep the board's text and gesture hints over the footage. */
      keepOverlays: boolean;
      onProgress?: (progress: {
        boardName: string;
        boardIndex: number;
        boardCount: number;
        frame: number;
        totalFrames: number;
      }) => void;
      signal?: AbortSignal;
    }
  ): Promise<{ videos: PublishVideo[]; warnings: string[] }> => {
    const original = artboardsRef.current;
    const orderPadWidth = Math.max(2, String(original.length).length);
    const stamp = options.locale ?? null;
    // A recording left playing re-seeks its own source under the encoder.
    stopPlayback();

    const preset = options.formatId
      ? DEVICE_FORMAT_PRESETS.find((entry) => entry.id === options.formatId)
      : undefined;
    const projected = projectArtboards(original, stamp);
    const list = preset
      ? calculateArtboardPositions(convertArtboardsToFormat(projected, preset).artboards)
      : calculateArtboardPositions(projected);
    const chosen = list.filter((artboard) => artboardIds.includes(artboard.id));
    if (chosen.length === 0) return { videos: [], warnings: [] };

    isExportingRef.current = true;
    setExportCanvasArtboards(list);
    try {
      await waitForCanvasToSettle(400);

      const videos: PublishVideo[] = [];
      const warnings: string[] = [];
      for (const [index, board] of chosen.entries()) {
        // The board is almost always drawn at the project's screenshot size,
        // which is not a preview size; the encoder rescales to this one.
        const size = previewRenderSizeFor(board.size.width, board.size.height, options.platform);
        if (!size) continue;

        try {
          const info = await analyzeArtboardForVideo(board);
          const durationSeconds = board.previewDurationSeconds ?? info.suggestedDuration;
          const fps = 30;
          const totalFrames = Math.max(1, Math.round(durationSeconds * fps));
          options.onProgress?.({
            boardName: board.name,
            boardIndex: index + 1,
            boardCount: chosen.length,
            frame: 0,
            totalFrames,
          });

          const blob = await exportArtboardVideo(board, {
            fps,
            durationSeconds,
            width: size.width,
            height: size.height,
            rawRecordingOnly: true,
            keepOverlays: options.keepOverlays,
            forStoreUpload: true,
            signal: options.signal,
            onProgress: (frame, total) =>
              options.onProgress?.({
                boardName: board.name,
                boardIndex: index + 1,
                boardCount: chosen.length,
                frame,
                totalFrames: total,
              }),
          });

          const orderPrefix = String(list.indexOf(board) + 1).padStart(orderPadWidth, '0');
          videos.push({
            artboardId: board.id,
            fileName: sanitizeFileName(
              `${orderPrefix}_${board.name.replace(/\s+/g, '_')}_AppPreview.mp4`
            ),
            bytes: new Uint8Array(await blob.arrayBuffer()),
            width: size.width,
            height: size.height,
            durationSeconds,
            locale: stamp ?? undefined,
          });
        } catch (error) {
          // Cancelling is the user's decision and stops everything.
          if (error instanceof DOMException && error.name === 'AbortError') throw error;
          console.error('App Preview encode failed for artboard', board.name, error);
          warnings.push(
            `"${board.name}" could not be encoded${stamp ? ` in ${stamp}` : ''}: ${
              error instanceof Error ? error.message : 'unknown error'
            }`
          );
        }
      }
      return { videos, warnings };
    } finally {
      setExportCanvasArtboards(null);
      isExportingRef.current = false;
      flushPendingRemote();
    }
  };

  // Asks the running export to stop. It finishes the image already in flight
  // (see captureArtboards) rather than leaving a truncated PNG behind, so the
  // dialog stays up, disabled, until the loop actually unwinds.
  const handleCancelPngExport = () => {
    if (!pngProgress) return;
    pngExportCancelRef.current = true;
    setIsCancellingPngExport(true);
  };

  // Re-analyze which boards carry video content (recordings, gestures,
  // animations) each time the export dialog opens. Async because recording
  // durations live in the Dexie media table.
  useEffect(() => {
    if (!isExportDialogOpen) return;
    let cancelled = false;
    (async () => {
      const infos: Record<string, ArtboardVideoInfo> = {};
      // What each board shows of its neighbours' elements, which the styled
      // export draws and so has to count among what moves.
      const spill = computeSpill(viewArtboards);
      // The language on screen: a recording can itself be localized, so which
      // boards carry video is answered for the language being exported.
      for (const ab of viewArtboards) {
        try {
          infos[ab.id] = await analyzeArtboardForVideo(ab, spillFor(spill, ab.id));
        } catch (error) {
          console.warn('Video analysis failed for artboard', ab.name, error);
        }
      }
      if (!cancelled) setVideoInfos(infos);
    })();
    return () => {
      cancelled = true;
    };
  }, [isExportDialogOpen, viewArtboards]);

  // An App Preview project is one that carries recording mockups, recordings,
  // gesture hints or animations — it gets the video export dialog.
  // The screenshot export skips these boards, so its dialog counts without them.
  // What the store upload dialog may send to screenshot and preview slots.
  const publishArtboards = useMemo(() => screenshotBoards(artboards), [artboards]);
  const appPreviewBoardCount = useMemo(
    () => artboards.filter((ab) => projectHasVideoContent([ab]) && !isCreativeBoard(ab)).length,
    [artboards]
  );
  const isAppPreviewProject = appPreviewBoardCount > 0;

  const videoBoards = artboards.filter((ab) => {
    const info = videoInfos[ab.id];
    return !!info && (info.hasVideo || info.hasMotion || info.hasSpanMotion);
  });
  // A board with an explicit preview length (set on the timeline bar) states
  // its own duration; the rest fall back to what their content adds up to.
  const suggestedVideoDuration = videoBoards.reduce(
    (max, ab) => Math.max(max, ab.previewDurationSeconds ?? videoInfos[ab.id]?.suggestedDuration ?? 0),
    0
  ) || 15;

  // Render each video-bearing artboard to its own MP4 (sequentially — the
  // encoder and the sprite captures both want the main thread).
  //
  // Scoped to the language on screen, deliberately: a locale loop here is
  // fully linear in frames (duration x fps, each frame re-seeking every source),
  // shares nothing between languages, and Apple caps previews per language
  // anyway. Switch language and run it again to get the next one.
  const handleExportVideo = async (request: VideoExportRequest) => {
    stopPlayback(); // see handleConfirmExport
    const boards = viewArtboards.filter((ab) => {
      if (request.currentArtboardOnly && ab.id !== activeArtboardId) return false;
      const info = videoInfos[ab.id];
      if (!info) return false;
      // The styled cut also draws what neighbouring artboards continue onto
      // the board, so motion arriving that way is enough. Safe mode exports
      // raw footage, so it needs an actual recording of the board's own,
      // unless the dialog let the poster stand in for one (a rehearsal render).
      if (!request.rawRecordingOnly) return info.hasVideo || info.hasMotion || info.hasSpanMotion;
      return info.hasVideo || (!!request.allowPosterFallback && info.hasMotion);
    });
    if (boards.length === 0) {
      toast({
        title: 'Nothing to export',
        description: request.currentArtboardOnly
          ? 'The selected artboard has no recording, gesture or animation to render.'
          : request.rawRecordingOnly
            ? 'App Store safe mode needs a screen recording on an artboard.'
            : 'Add a screen recording, gesture or animation first.',
        variant: 'destructive',
      });
      return [];
    }

    let exportDir: string | null | undefined;
    if (isTauri() && boards.length > 1) {
      exportDir = await pickExportDirectory('Choose a folder for the exported videos');
      if (exportDir === null) return [];
    }

    trackExportVideo({
      fps: request.fps,
      durationSeconds: request.durationSeconds,
      sizeMode: request.sizeMode,
      rawRecordingOnly: request.rawRecordingOnly,
    });

    const abort = new AbortController();
    videoExportAbortRef.current = abort;
    setIsVideoExporting(true);
    const orderPadWidth = Math.max(2, String(artboards.length).length);
    // What the canvas draws of each board's neighbours; it is showing viewArtboards.
    const spill = computeSpill(viewArtboards);
    // Same manifest contract as handleConfirmExport: the headless bridge needs
    // the names, not a toast.
    const saved: { filename: string; path?: string }[] = [];
    try {
      for (const [index, board] of boards.entries()) {
        const size =
          request.sizeMode === 'appstore-portrait'
            ? { width: 886, height: 1920 }
            : request.sizeMode === 'appstore-landscape'
              ? { width: 1920, height: 886 }
              : board.size;
        const totalFrames = Math.max(1, Math.round(request.durationSeconds * request.fps));
        setVideoProgress({
          boardName: board.name,
          boardIndex: index + 1,
          boardCount: boards.length,
          frame: 0,
          totalFrames,
        });
        const blob = await exportArtboardVideo(board, {
          fps: request.fps,
          durationSeconds: request.durationSeconds,
          width: size.width,
          height: size.height,
          rawRecordingOnly: request.rawRecordingOnly,
          keepOverlays: request.keepOverlays,
          allowPosterFallback: request.allowPosterFallback,
          spill: spillFor(spill, board.id),
          signal: abort.signal,
          onProgress: (frame, total) =>
            setVideoProgress({
              boardName: board.name,
              boardIndex: index + 1,
              boardCount: boards.length,
              frame,
              totalFrames: total,
            }),
        });
        // Indexed in the same list the boards came from: board order is
        // identical in every language, so the numbering is too.
        const orderPrefix = String(viewArtboards.indexOf(board) + 1).padStart(orderPadWidth, '0');
        // Distinct suffix per mode so the three renders of one board can sit
        // in the same folder without overwriting each other.
        const usedPoster = request.allowPosterFallback && !videoInfos[board.id]?.hasVideo;
        const suffix = !request.rawRecordingOnly
          ? 'AppPreview'
          : `${request.keepOverlays ? 'StoreReady_Text' : 'StoreReady'}${usedPoster ? '_PosterProof' : ''}`;
        const filename = `${orderPrefix}_${board.name.replace(/\s+/g, '_')}_${suffix}.mp4`;
        const savedPath = exportDir
          ? await saveBlobToPath(blob, exportDir, filename)
          : await saveBlobToDisk(blob, filename);
        if (savedPath === null) continue; // user cancelled this file's save dialog
        saved.push(savedPath ? { filename, path: savedPath } : { filename });
        toast({
          title: 'Video Exported',
          description: savedPath ? `Saved to ${savedPath}` : `"${filename}" has been downloaded.`,
        });
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        toast({ title: 'Video export cancelled' });
      } else {
        console.error('Video export failed:', error);
        toast({
          title: 'Video Export Failed',
          description: error instanceof Error ? error.message : 'See console for details.',
          variant: 'destructive',
        });
      }
    } finally {
      setIsVideoExporting(false);
      setVideoProgress(null);
      videoExportAbortRef.current = null;
    }

    return saved;
  };

  const handleCancelVideoExport = () => {
    videoExportAbortRef.current?.abort();
  };

  /**
   * Move the project to a recorded state. Undo, redo and clicking a row in the
   * History panel are all this one path: the stack itself is left alone (states
   * ahead of the target stay listed but dimmed until the next edit drops them),
   * and the restored state is written back to the project row so a reload does
   * not resurrect the work that was just stepped away from.
   */
  const applyHistoryIndex = useCallback((targetIndex: number) => {
    if (targetIndex < 0 || targetIndex >= history.length || targetIndex === historyIndex) return;
    // The stack holds states of the document this render shows. While another
    // project opens, stepping through it would put the outgoing project back
    // on the canvas and save it under the incoming project's id.
    if (!canvasStillHolds(renderedCanvas, canvasSerialRef.current)) return;
    const state: ArtboardState[] = JSON.parse(JSON.stringify(history[targetIndex].artboards));
    setHistoryIndex(targetIndex);
    setArtboards(state);
    if (activeArtboardId && !state.find((ab) => ab.id === activeArtboardId)) {
      setActiveArtboardId(state.length > 0 ? state[0].id : null);
    }
    setSelectedElementIdOnActiveArtboard(null);

    if (activeProjectId) {
      // Through the same debounce as ordinary commits: rapid undo-undo-redo
      // used to write three full rows back to back.
      scheduleProjectSave(activeProjectId, currentProjectName, state);
    }
  }, [history, historyIndex, activeArtboardId, activeProjectId, currentProjectName, scheduleProjectSave, renderedCanvas]);

  // --- project tabs ----------------------------------------------------------
  //
  // Only the active tab's project is on the canvas. The others wait in the
  // parking lot with their document and undo stack (src/lib/tabs/parking.ts)
  // for an hour, or until its memory budget needs the room, and then sleep:
  // the project is in IndexedDB like any saved one, and the undo stack next to
  // it (historyStore.ts). Switching to a parked tab is a park and a restore of
  // React state, with no read and no copy; to a sleeping one, the same read
  // Recent projects does plus its undo stack.

  /** Where the canvas is scrolled to right now. */
  const readCanvasScroll = (): { left: number; top: number } | null => {
    const viewport = canvasContainerRef.current?.querySelector<HTMLElement>('[data-radix-scroll-area-viewport]');
    return viewport ? { left: viewport.scrollLeft, top: viewport.scrollTop } : null;
  };

  /** How the canvas looks now: what a tab keeps of itself while it is not in front. */
  const currentTabView = (): TabView => ({
    activeArtboardId: activeArtboardIdRef.current,
    zoom: canvasZoomRef.current,
    scroll: readCanvasScroll(),
    locale: activeLocaleRef.current,
  });
  readActiveTabViewRef.current = () => {
    const projectId = loadedProjectIdRef.current;
    if (!projectId || projectId !== activeProjectIdRef.current) return null;
    return { projectId, view: currentTabView() };
  };

  /** The canvas's undo stack, as historyStore.ts keeps it. */
  const canvasUndoSnapshot = (): UndoSnapshot => ({
    history: historyRef.current,
    historyIndex: historyIndexRef.current,
    selectedElementIds: selectedElementIdsRef.current,
    unedited: openedSnapshotRef.current !== null,
  });

  parkOutgoingRef.current = (projectId: string) => {
    // A closed tab keeps nothing, and neither does a project without a tab.
    if (!projectTabs.has(projectId)) return;
    const opened = openedSnapshotRef.current;
    const parked: ParkedProject = {
      projectId,
      name: projectNameRef.current,
      artboards: artboardsRef.current,
      history: historyRef.current,
      historyIndex: historyIndexRef.current,
      selectedElementIds: selectedElementIdsRef.current,
      openedSnapshot: opened && opened.projectId === projectId ? opened : null,
      parkedAt: Date.now(),
    };
    projectTabsParking.park(parked);
    projectTabs.recordLeave(projectId, { view: currentTabView(), summary: summarizeProject(artboardsRef.current) });
  };

  /** The scroll a returning tab left at, set once its canvas has laid out. */
  const pendingTabScrollRef = useRef<{ serial: number; left: number; top: number } | null>(null);
  /** The canvas serial a tab switch put up, for the fade in below. */
  const tabFadeSerialRef = useRef<number | null>(null);
  useLayoutEffect(() => {
    const container = canvasContainerRef.current;
    if (tabFadeSerialRef.current !== null && tabFadeSerialRef.current === canvasSerialRef.current) {
      tabFadeSerialRef.current = null;
      // A quick fade, so a switch reads as one project giving way to another
      // rather than a jump. Opacity only, which the compositor does on its own.
      if (container && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
        container.animate([{ opacity: 0.55 }, { opacity: 1 }], { duration: 160, easing: 'ease-out' });
      }
    }
    const pending = pendingTabScrollRef.current;
    if (!pending || pending.serial !== canvasSerialRef.current) return;
    const viewport = container?.querySelector<HTMLElement>('[data-radix-scroll-area-viewport]');
    if (!viewport) return;
    pendingTabScrollRef.current = null;
    viewport.scrollLeft = pending.left;
    viewport.scrollTop = pending.top;
  });

  applyTabViewRef.current = (projectId: string, boards: ArtboardState[]) => {
    const view: TabView | undefined = projectTabs.get(projectId)?.view;
    if (!view) return;
    tabFadeSerialRef.current = canvasSerialRef.current;
    if (view.activeArtboardId && boards.some((board) => board.id === view.activeArtboardId)) {
      setActiveArtboardId(view.activeArtboardId);
    }
    setCanvasZoom(view.zoom);
    // A language the project no longer has falls back to the base one on its
    // own, in the effect that watches for exactly that.
    if (view.locale !== activeLocaleRef.current) handleSelectLocale(view.locale);
    pendingTabScrollRef.current = view.scroll ? { serial: canvasSerialRef.current, ...view.scroll } : null;
  };

  restoreParkedRef.current = (parked: ParkedProject) => {
    const { projectId } = parked;
    putProjectOnCanvas(projectId);
    setCurrentProjectName(parked.name);
    setActiveProjectId(projectId);
    openedSnapshotRef.current = parked.openedSnapshot;
    setArtboards(parked.artboards);
    setHistory(parked.history);
    setHistoryIndex(parked.historyIndex);
    const view = projectTabs.get(projectId)?.view;
    const boardId =
      view?.activeArtboardId && parked.artboards.some((board) => board.id === view.activeArtboardId)
        ? view.activeArtboardId
        : parked.artboards[0]?.id ?? null;
    setActiveArtboardId(boardId);
    tabFadeSerialRef.current = canvasSerialRef.current;
    applyTabViewRef.current(projectId, parked.artboards);
    // Only the layers still on the artboard that comes back active.
    const alive = new Set(
      parked.artboards.find((board) => board.id === boardId)?.elements.map((element) => element.id) ?? []
    );
    setSelectedElementIds(parked.selectedElementIds.filter((id) => alive.has(id)));
    setIsTemplateSelectorOpen(false);
  };

  /** Bring a tab to the front. Parked: put back at once. Asleep: the loader reads it. */
  const activateTab = (projectId: string) => {
    if (isExportingRef.current) return;
    if (projectId === activeProjectIdRef.current) return;
    const parked = projectTabsParking.take(projectId);
    if (parked) {
      restoreParkedRef.current(parked);
      return;
    }
    setActiveProjectId(projectId);
  };

  /** Nothing on the canvas: the last tab closed. The start dialog opens from activeProjectId going null. */
  const clearCanvasForNoTabs = () => {
    void flushProjectSave();
    if (collab.room) collab.stop();
    loadedProjectIdRef.current = null;
    canvasSerialRef.current += 1;
    openedSnapshotRef.current = null;
    setArtboards([]);
    setHistory([makeHistoryEntry([], namedChange('New Document', 'open'))]);
    setHistoryIndex(0);
    setActiveArtboardId(null);
    setSelectedElementIds([]);
    setCurrentProjectName('Untitled Project');
    handleSelectLocale(null);
    setActiveProjectId(null);
  };

  // Leaving the project of a live session ends this person's part in it (the
  // effect next to the collab hook stops it), so that has to be asked first.
  const [pendingSessionLeave, setPendingSessionLeave] = useState<{ action: string; run: () => void } | null>(null);
  /** Going to `nextProjectId` would take this window out of its live session. */
  const leavesLiveSession = (nextProjectId: string | null) => {
    const roomProject = collabProjectRef.current;
    return !!collab.room && !!roomProject && roomProject === activeProjectIdRef.current && nextProjectId !== roomProject;
  };
  const confirmLeavingSession = (nextProjectId: string | null, action: string, run: () => void) => {
    if (leavesLiveSession(nextProjectId)) {
      setPendingSessionLeave({ action, run });
      return;
    }
    run();
  };

  const handleActivateTab = (projectId: string) => {
    if (projectId === activeProjectIdRef.current) return;
    confirmLeavingSession(projectId, 'Leave and switch', () => activateTab(projectId));
  };

  /**
   * A closing tab's undo stack, written so Reopen closed tab brings it back:
   * from the parking lot, or from the canvas. A sleeping tab's is on disk
   * already. Every way a tab closes comes through here, before the canvas
   * moves on, and the lock waits for the write.
   */
  const keepUndoOfClosingTab = (projectId: string): Promise<unknown> => {
    sleptWithChangesRef.current.delete(projectId);
    const parked = projectTabsParking.peek(projectId);
    const snapshot = parked
      ? undoSnapshotOf(parked)
      : projectId === loadedProjectIdRef.current
        ? canvasUndoSnapshot()
        : null;
    if (!snapshot) return Promise.resolve();
    pinLock(projectId);
    return saveUndo(projectId, snapshot).finally(() => settleLock(projectId));
  };

  const closeTabNow = (projectId: string) => {
    const kept = keepUndoOfClosingTab(projectId);
    // Still being read, it is not wanted on the canvas any more.
    if (projectId !== loadedProjectIdRef.current) void stopOpening(projectId, 'closed');
    if (projectId !== activeProjectIdRef.current) {
      projectTabs.close(projectId);
      return;
    }
    const next = nextActiveAfterClose(projectTabs.getTabs(), projectId, projectId);
    if (next) activateTab(next);
    else if (isSecondaryWindow) {
      // The last tab of a window a tab was moved into: the window goes with it.
      projectTabs.close(projectId);
      void Promise.all([flushProjectSave(), kept]).then(() => closeThisWindow());
      return;
    } else clearCanvasForNoTabs();
    projectTabs.close(projectId);
  };

  /**
   * The tab's project was changed in this sitting, which closing it asks about.
   * Whatever the change was called: a project keeps the state it opened in
   * (openedSnapshotRef) until its first commit of any kind, an edit, a restored
   * version, a template the agent applied, the move of a layer into it. Read
   * from the canvas, the parking lot, or as it was when the tab fell asleep.
   */
  const tabHasChanges = (projectId: string): boolean => {
    if (projectId === loadedProjectIdRef.current) return openedSnapshotRef.current?.projectId !== projectId;
    const parked = projectTabsParking.peek(projectId);
    if (parked) return !parked.openedSnapshot;
    return sleptWithChangesRef.current.has(projectId);
  };

  // Closing tabs with changes asks first (confirmTabClose in
  // editorPreferences.ts). Nothing is lost either way, since the project is
  // saved and Reopen closed tab brings it back with its undo history: the
  // question is there for a click on the wrong cross.
  const [pendingTabClose, setPendingTabClose] = useState<{
    projectIds: string[];
    changed: string[];
    run: () => void;
  } | null>(null);
  const [stopAskingOnClose, setStopAskingOnClose] = useState(false);
  /**
   * Run a close of `projectIds`, after asking when any of them has changes.
   * When the close also takes this window out of a live session, that is the
   * question asked instead (confirmLeavingSession): one is enough.
   */
  const confirmTabClose = (projectIds: string[], nextProjectId: string | null, run: () => void) => {
    const active = activeProjectIdRef.current;
    if (active && projectIds.includes(active) && leavesLiveSession(nextProjectId)) {
      confirmLeavingSession(nextProjectId, 'Leave and close', run);
      return;
    }
    const changed = readPreference('confirmTabClose') ? projectIds.filter(tabHasChanges) : [];
    if (changed.length === 0) {
      run();
      return;
    }
    setStopAskingOnClose(false);
    setPendingTabClose({ projectIds, changed, run });
  };

  const handleCloseTab = (projectId: string) => {
    if (isExportingRef.current) return;
    confirmTabClose([projectId], null, () => {
      if (projectTabs.has(projectId)) closeTabNow(projectId);
    });
  };

  /**
   * Close `doomed`, the tabs the question was about, and no others: a tab that
   * opened while it was being asked stays. `keepId` takes the canvas when the
   * active tab closes, or always with `focusKept` (Close other tabs).
   */
  const closeTabsNow = (doomed: string[], keepId: string, focusKept: boolean) => {
    const closing = doomed.filter((id) => id !== keepId && projectTabs.has(id));
    if (closing.length === 0) return;
    const kept = closing.map((id) => keepUndoOfClosingTab(id));
    const active = activeProjectIdRef.current;
    const activeCloses = !!active && closing.includes(active);
    if (projectTabs.has(keepId)) {
      if (focusKept || activeCloses) activateTab(keepId);
    } else if (activeCloses) {
      // The tab it was asked on left in the meantime, so the first tab that
      // stays takes over, as a close of the active tab would pick one.
      const stays = projectTabs.getTabs().find((tab) => !closing.includes(tab.projectId));
      if (stays) activateTab(stays.projectId);
      else if (!isSecondaryWindow) clearCanvasForNoTabs();
    }
    for (const id of closing) projectTabs.close(id);
    // The last tabs of a window a tab was moved into: the window goes with them.
    if (isSecondaryWindow && projectTabs.getTabs().length === 0) {
      void Promise.all([flushProjectSave(), ...kept]).then(() => closeThisWindow());
    }
  };

  const handleCloseOtherTabs = (keepId: string) => {
    const doomed = otherTabIds(projectTabs.getTabs(), keepId);
    confirmTabClose(doomed, keepId, () => closeTabsNow(doomed, keepId, true));
  };

  const handleCloseTabsToRight = (projectId: string) => {
    const doomed = tabIdsRightOf(projectTabs.getTabs(), projectId);
    confirmTabClose(doomed, projectId, () => closeTabsNow(doomed, projectId, false));
  };

  const handleNewTab = () => {
    projectTabs.requestNewTab();
    openStartDialog();
  };

  const handleReopenClosedTab = (projectId?: string) => {
    const entry = projectTabs.reopenClosed(projectId);
    if (!entry) return;
    confirmLeavingSession(entry.projectId, 'Leave and switch', () => activateTab(entry.projectId));
  };

  const handleDuplicateTab = (projectId: string) => {
    const tab = projectTabs.get(projectId);
    void handleDuplicateProject({
      id: projectId,
      name: projectId === activeProjectIdRef.current ? currentProjectName : tab?.name || 'Untitled Project',
      timestamp: new Date(),
      projectData: [],
    });
  };

  /** What a tab's hover card draws: the canvas, the parking lot, or the saved row. */
  const tabArtboards = (projectId: string): TabArtboardsSource => {
    if (projectId === loadedProjectIdRef.current) return artboardsRef.current;
    const parked = projectTabsParking.peek(projectId);
    if (parked) return parked.artboards;
    return db.projects
      .get(projectId)
      .then((row) => row?.projectData ?? null)
      .catch(() => null);
  };

  // Every way a project reaches the canvas ends with activeProjectId naming
  // it, which makes this the one place a project gets its tab: a template, a
  // recent project, an import, the cloud, an MCP tool and the agent alike.
  const recentNamesRef = useRef(new Map<string, string>());
  recentNamesRef.current = useMemo(
    () => new Map(recentProjects.map((project) => [project.id, project.name] as const)),
    [recentProjects]
  );
  beforeWindowCloseRef.current = () => {
    projectTabs.flushSession();
    // And the agent chat, whose own pagehide flush never runs when a desktop
    // window closes.
    return claudeAgent.flush();
  };

  // The session keeps the active tab's view, read as it is written
  // (useProjectTabs), so a zoom, a scroll or another artboard or language asks
  // for a write. Without it a reload would open on the view the tab had when it
  // was last left.
  const noteTabViewChange = projectTabs.noteViewChange;
  useEffect(() => {
    noteTabViewChange();
  }, [canvasZoom, activeArtboardId, activeLocale, noteTabViewChange]);
  const hasBoards = artboards.length > 0;
  useEffect(() => {
    const viewport = canvasContainerRef.current?.querySelector<HTMLElement>('[data-radix-scroll-area-viewport]');
    if (!viewport) return;
    viewport.addEventListener('scroll', noteTabViewChange, { passive: true });
    return () => viewport.removeEventListener('scroll', noteTabViewChange);
  }, [noteTabViewChange, renderedCanvasSerial, hasBoards]);

  // Stored undo stacks nobody will ask for again: written by a window that
  // has gone (a reload ends one, rule 28), unless written for another window
  // to take a moment ago. Looked at once, a while after startup.
  useEffect(() => {
    const timer = window.setTimeout(
      () =>
        afterIdle(() => {
          void (async () => {
            const live = await liveEditorWindowIds();
            const recent = Date.now() - HAND_OVER_KEEP_MS;
            await undoStore.prune(
              (row) =>
                row.sitting === EDITOR_WINDOW_ID ||
                live?.has(row.sitting) === true ||
                (row.handOver && row.savedAt > recent)
            );
          })().catch((error) => console.warn('Could not tidy the stored undo history', error));
        }),
      20_000
    );
    return () => window.clearTimeout(timer);
    // Startup only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const noteActiveTab = projectTabs.noteActive;
  const noteNoActiveTab = projectTabs.noteNoActive;
  useEffect(() => {
    if (!activeProjectId) {
      noteNoActiveTab();
      return;
    }
    const onCanvas = loadedProjectIdRef.current === activeProjectId;
    noteActiveTab(activeProjectId, {
      name: onCanvas ? projectNameRef.current : recentNamesRef.current.get(activeProjectId),
      preview: previewProjectIdRef.current === activeProjectId,
    });
    if (previewProjectIdRef.current === activeProjectId) previewProjectIdRef.current = null;
  }, [activeProjectId, noteActiveTab, noteNoActiveTab]);

  // The name follows the project once its document is on the canvas, and not
  // before: until then currentProjectName is still the previous project's.
  const renameTab = projectTabs.rename;
  useEffect(() => {
    if (!activeProjectId || loadedProjectIdRef.current !== activeProjectId) return;
    renameTab(activeProjectId, currentProjectName);
  }, [activeProjectId, currentProjectName, renderedCanvasSerial, renameTab]);

  const activeTabSummary = useMemo(
    () => (artboards.length > 0 ? summarizeProject(artboards) : undefined),
    [artboards]
  );

  // isTauri() is false on the first render (rule 14), and the tab shortcuts
  // differ between the two shells.
  const [isDesktopApp, setIsDesktopApp] = useState(false);
  useEffect(() => setIsDesktopApp(isTauri()), []);

  // The desktop menu's New Tab, Close Tab and Reopen Closed Tab. The menu owns
  // those accelerators (settings.rs), so the key never reaches the page.
  const tabCommandRef = useRef<(command: string) => void>(() => {});
  tabCommandRef.current = (command: string) => {
    if (command === 'new') handleNewTab();
    else if (command === 'reopen') handleReopenClosedTab();
    else if (command === 'close') {
      const active = activeProjectIdRef.current;
      if (active && projectTabs.has(active)) {
        handleCloseTab(active);
        return;
      }
      // No tab left to close: the shortcut closes the window, as it always did.
      void import('@tauri-apps/api/window').then(({ getCurrentWindow }) => getCurrentWindow().close());
    }
  };
  useEffect(() => {
    if (!isTauri()) return;
    let disposed = false;
    let unlisten: (() => void) | undefined;
    (async () => {
      try {
        const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow');
        const stop = await getCurrentWebviewWindow().listen<string>(TAB_COMMAND_EVENT, (event) =>
          tabCommandRef.current(event.payload)
        );
        if (disposed) stop();
        else unlisten = stop;
      } catch (error) {
        console.error('Could not listen for the tab menu', error);
      }
    })();
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  // --- layers and artboards moving between tabs ------------------------------
  //
  // handleArtboardsUpdate only ever writes the project on the canvas. A project
  // in another tab changes through editTabInBackground instead: in the parking
  // lot when it is parked, after a read when it is asleep. Either way its row
  // is written, the change goes on that project's own undo stack, and its tab
  // is refreshed, so switching to it shows the change with an undo for it.

  // Transfers under way, by project. A tab on its way to another window waits
  // for them (letTabGo), so the window it goes to reads what they wrote.
  const projectWorkRef = useRef(new Map<string, Set<Promise<void>>>());
  /** Settles once every transfer to or from the project that is under way now has. */
  const projectWorkDone = (projectId: string) => Promise.all([...(projectWorkRef.current.get(projectId) ?? [])]);

  /**
   * Run `work` holding this window's lock on each project, from its first read
   * to its last write, taken first where this window does not hold it yet.
   * Closing one of the tabs, or handing it to another window, lets go of the
   * lock only after that, so no other window opens the project in the middle
   * and later saves over what the work wrote. Returns the project another
   * window has, without running anything, or null once `work` has run.
   */
  const withProjectsHeld = async (projectIds: string[], work: () => Promise<void>): Promise<string | null> => {
    const ids = [...new Set(projectIds)];
    let finish!: () => void;
    const running = new Promise<void>((resolve) => {
      finish = () => resolve();
    });
    for (const id of ids) {
      pinLock(id);
      const under = projectWorkRef.current.get(id) ?? new Set<Promise<void>>();
      under.add(running);
      projectWorkRef.current.set(id, under);
    }
    try {
      for (const id of ids) if (!(await holdProjectLock(id))) return id;
      await work();
      return null;
    } finally {
      finish();
      for (const id of ids) {
        const under = projectWorkRef.current.get(id);
        under?.delete(running);
        if (under?.size === 0) projectWorkRef.current.delete(id);
        settleLock(id);
      }
    }
  };

  /**
   * Change a project that is not on the canvas. `change` gets its base document
   * and returns the new one with a result, or null to leave it alone. Null
   * overall when the project could not be read or has no artboards, or is not
   * this window's to change: its tab is gone, or another window has it.
   */
  const editTabInBackground = async <T,>(
    projectId: string,
    label: HistoryChange,
    change: (boards: ArtboardState[]) => { boards: ArtboardState[]; result: T } | null
  ): Promise<T | null> => {
    if (projectId === loadedProjectIdRef.current) return null;
    if (!projectTabs.has(projectId) || !mayWriteProject(projectId)) return null;
    let parked = projectTabsParking.peek(projectId);
    if (!parked) {
      // Asleep: read the way the loader reads, its undo stack included, then
      // park it, so the change lands on the stack that comes back with the tab.
      const [row, storedUndo] = await Promise.all([
        db.projects.get(projectId).catch(() => undefined),
        undoStore.load(projectId).catch(() => null),
      ]);
      if (!row || !canOpenAsProject(row.projectData)) return null;
      const boards = calculateArtboardPositions(
        normalizeLocalization(ensureUniqueElementIds(await externalizeInlineMedia(migrateVideoDevices(row.projectData))))
      );
      // Opened while the read was out: the canvas holds it now.
      if (projectId === loadedProjectIdRef.current) return null;
      // Closed, or gone to another window: nothing here to change any more.
      if (!projectTabs.has(projectId) || !mayWriteProject(projectId)) return null;
      const name = row.name || 'Untitled Project';
      const woken = openStoredUndo(projectId, name, boards, storedUndo);
      parked = projectTabsParking.peek(projectId) ?? {
        projectId,
        name,
        artboards: boards,
        history: woken.history,
        historyIndex: woken.historyIndex,
        selectedElementIds: woken.selectedElementIds,
        openedSnapshot: woken.openedSnapshot,
        parkedAt: Date.now(),
      };
      projectTabsParking.park(parked);
    }
    const outcome = change(parked.artboards);
    if (!outcome) return null;
    const boards = calculateArtboardPositions(outcome.boards);
    // A project's first edit is what keeps the state it was opened in as a
    // version, the promise noteVersionCheckpoint keeps for the canvas.
    const opened = parked.openedSnapshot;
    if (opened) void saveVersion(projectId, opened.boards, opened.name, { kind: 'auto', label: 'Before this session' });
    const entry = makeHistoryEntry(boards, label);
    projectTabsParking.update(projectId, (current) => {
      let history = [...current.history.slice(0, current.historyIndex + 1), entry];
      if (history.length > HISTORY_LIMIT) history = history.slice(history.length - HISTORY_LIMIT);
      return {
        ...current,
        artboards: boards,
        history,
        historyIndex: history.length - 1,
        openedSnapshot: null,
        parkedAt: Date.now(),
      };
    });
    try {
      await db.projects.update(projectId, { projectData: JSON.parse(JSON.stringify(boards)), timestamp: new Date() });
    } catch (error) {
      console.error('Could not save the project in the other tab', error);
      return null;
    }
    projectTabs.setSummary(projectId, summarizeProject(boards));
    noteTabEdit(projectId);
    return outcome.result;
  };

  /** Where a tab opens next time: its own view, with one thing changed. */
  const pointTabAt = (projectId: string, activeArtboardId: string) => {
    const view = projectTabs.get(projectId)?.view;
    projectTabs.recordLeave(projectId, {
      view: {
        activeArtboardId,
        zoom: view?.zoom ?? canvasZoomRef.current,
        scroll: view?.scroll ?? null,
        locale: view?.locale ?? null,
      },
    });
  };

  const openTabAction = (projectId: string, name: string) => (
    <ToastAction altText={`Open ${name}`} onClick={() => handleActivateTab(projectId)}>
      Open
    </ToastAction>
  );

  /**
   * Change a project wherever it is: the one on the canvas through its door,
   * any other in the background. Null when the change did not land.
   */
  const editProjectAnywhere = async <T,>(
    projectId: string,
    label: HistoryChange,
    change: (boards: ArtboardState[]) => { boards: ArtboardState[]; result: T } | null
  ): Promise<T | null> => {
    if (projectId !== loadedProjectIdRef.current) return editTabInBackground(projectId, label, change);
    const outcome = change(artboardsRef.current);
    if (!outcome) return null;
    return handleArtboardsUpdateRef.current(outcome.boards, label) ? outcome.result : null;
  };

  const projectNameOf = (projectId: string) =>
    (projectId === loadedProjectIdRef.current ? projectNameRef.current : projectTabs.get(projectId)?.name) ||
    'Untitled project';

  /**
   * Move or copy layers from one project to another, either of them on the
   * canvas or in another tab. They land on `to.artboardId` (or the artboard the
   * target was left on) at `to.at` (or the same place relative to it). The
   * target is written first, so a failure there leaves the source as it was;
   * only then do the layers leave the source.
   */
  const sendLayers = async ({
    mode,
    from,
    to,
  }: {
    mode: 'move' | 'copy';
    from: { projectId: string; artboardId: string; elementIds: string[]; transfer?: ElementTransfer };
    to: { projectId: string; artboardId?: string; at?: Point };
  }) => {
    if (from.projectId === to.projectId) return;
    // The layers as their project has them now, on the canvas or parked in
    // its tab. Undefined when that tab is asleep, where nothing changes them.
    const pickNow = (): ElementTransfer | null | undefined => {
      const doc =
        from.projectId === loadedProjectIdRef.current
          ? artboardsRef.current
          : projectTabsParking.peek(from.projectId)?.artboards;
      if (!doc) return undefined;
      const board = doc.find((entry) => entry.id === from.artboardId);
      return board ? pickElements(board, from.elementIds) : null;
    };
    const first = pickNow();
    const start = first === undefined ? (from.transfer ?? null) : first;
    if (!start) return;
    const sourceName = projectNameOf(from.projectId);
    const targetName = projectNameOf(to.projectId);
    const verb = mode === 'move' ? 'Moved' : 'Copied';
    // Their text is measured in the faces of the target's base language, as a
    // paste's is (transferFonts.ts), and before the locks: nothing is held
    // while a webfont loads. They can be edited meanwhile, and a language of
    // their project set to draw in another face, so they are picked again
    // after each wait, and waited for again when they need other faces.
    const facesOfLayers = (layers: ElementTransfer) => textFacesOf(layers.elements, layers.localized, layers.locales);
    const waited = new Set<string>();
    const picked = await pickWithFacesIn(start, pickNow, facesOfLayers, whenFacesLoaded, waited);
    // Deleted while the faces loaded: nothing is left to move.
    if (!picked) return;
    const refused = await withProjectsHeld([from.projectId, to.projectId], async () => {
      // Once more with the locks held, the last moment before anything is
      // written: a lock can take a moment to come. A face needed since then
      // is waited for here, with the locks held, which is the rare case;
      // one already given up on above is not.
      const now = pickNow();
      if (now === null) return;
      const transfer = now ? await pickWithFacesIn(now, pickNow, facesOfLayers, whenFacesLoaded, waited) : picked;
      if (!transfer) return;
      const movedIds = transfer.elements.map((element) => element.id);
      const count = transfer.elements.length;
      const what = count === 1 ? getElementDisplayName(transfer.elements[0]) : `${count} layers`;
      const landed = await editProjectAnywhere(
        to.projectId,
        namedChange(`${verb} from ${sourceName}`, 'add', what),
        (boards) => {
          const wanted =
            to.artboardId ??
            (to.projectId === loadedProjectIdRef.current
              ? activeArtboardIdRef.current
              : projectTabs.get(to.projectId)?.view?.activeArtboardId);
          const index = Math.max(0, boards.findIndex((board) => board.id === wanted));
          const locales = new Set(getProjectLocales(boards).map((entry) => entry.code));
          const placed = placeElements(boards[index], transfer, {
            locales,
            baseLocale: baseLocaleOf(boards),
            at: to.at,
            // A drop point is where the layers should be drawn, in the
            // language the canvas shows.
            viewLocale: to.projectId === loadedProjectIdRef.current ? activeLocaleRef.current : null,
          });
          return {
            boards: boards.map((board, i) => (i === index ? placed.board : board)),
            result: { boardId: placed.board.id, placedIds: placed.placedIds },
          };
        }
      );
      if (!landed) {
        toast({
          title: `${targetName} could not take the layers`,
          description: 'Nothing was moved. Open that tab, then try again.',
          variant: 'destructive',
        });
        return;
      }
      // Selected, on the artboard they landed on: now, or when that tab opens.
      // Asked again, because the canvas can have moved to another tab while a
      // write to a background one was out.
      if (to.projectId === loadedProjectIdRef.current) {
        setActiveArtboardId(landed.boardId);
        setSelectedElementIds(landed.placedIds);
      } else {
        projectTabsParking.update(to.projectId, (project) => ({ ...project, selectedElementIds: landed.placedIds }));
        pointTabAt(to.projectId, landed.boardId);
      }
      const action = to.projectId === loadedProjectIdRef.current ? undefined : openTabAction(to.projectId, targetName);
      if (mode === 'move') {
        // Only as they went. Edited while the target was written, they stay,
        // edit and all, rather than leave with a copy that lacks the edit.
        let edited = false;
        const left = await editProjectAnywhere(
          from.projectId,
          namedChange(`Moved to ${targetName}`, 'delete', what),
          (boards) => {
            const board = boards.find((entry) => entry.id === from.artboardId);
            if (board && !stillHolds(board, transfer)) {
              edited = true;
              return null;
            }
            return {
              boards: boards.map((entry) => (entry.id === from.artboardId ? removeElements(entry, movedIds) : entry)),
              result: true,
            };
          }
        );
        if (!left) {
          toast({
            title: `Copied to ${targetName}`,
            description: edited
              ? `The layers changed in ${sourceName} while they moved, so they are in both projects.`
              : `${sourceName} did not take the change, so the layers are in both projects.`,
            action,
          });
          return;
        }
        if (from.projectId === loadedProjectIdRef.current) {
          setSelectedElementIds((ids) => ids.filter((id) => !movedIds.includes(id)));
        }
      }
      toast({ title: `${verb} to ${targetName}`, description: what, action });
    });
    if (refused) {
      toast({
        title: `${projectNameOf(refused)} is open in another window`,
        description: 'Nothing was moved. Close it there, then try again.',
        variant: 'destructive',
      });
    }
  };

  const sendLayersToTab = (targetId: string, mode: 'move' | 'copy', artboardId: string, elementIds: string[]) => {
    const sourceId = loadedProjectIdRef.current;
    if (!sourceId || !projectTabs.has(targetId)) return Promise.resolve();
    return sendLayers({ mode, from: { projectId: sourceId, artboardId, elementIds }, to: { projectId: targetId } });
  };

  /**
   * Layers held over another tab until it opened (ProjectTabBar). They are
   * lifted off the canvas (carrySession.ts) and the tab opens under them; where
   * they are let go decides the rest. On an artboard they land at that spot,
   * on a tab they go to that tab, and back on their own tab, or anywhere else,
   * nothing moves.
   */
  const carryEndRef = useRef<(() => void) | null>(null);
  useEffect(() => () => carryEndRef.current?.(), []);
  const handleSpringLoad = (projectId: string, carry: ElementCarry) => {
    if (isExportingRef.current) return;
    // Already carrying: the next tab opens under the same layers.
    if (carryEndRef.current) {
      if (projectId !== activeProjectIdRef.current) activateTab(projectId);
      return;
    }
    // Leaving a live session asks first, and a drag cannot wait for an answer.
    if (collab.room) return;
    const sourceId = loadedProjectIdRef.current;
    const board = artboardsRef.current.find((entry) =>
      entry.elements.some((element) => element.id === carry.elementId)
    );
    if (!sourceId || !board) return;
    const selection = selectedElementIdsRef.current;
    const elementIds = selection.includes(carry.elementId) ? selection : [carry.elementId];
    const transfer = pickElements(board, elementIds);
    if (!transfer) return;
    const from = { projectId: sourceId, artboardId: board.id, elementIds, transfer };
    carryEndRef.current = startCarrySession({
      clientX: carry.clientX,
      clientY: carry.clientY,
      copy: carry.copy,
      artboardId: board.id,
      elementIds,
      elementId: carry.elementId,
      onEnd: (drop) => {
        carryEndRef.current = null;
        if (drop.kind === 'cancel') return;
        if (drop.kind === 'tab') {
          // Back on its own tab: home again, with nothing moved.
          if (drop.projectId === sourceId) {
            activateTab(sourceId);
            return;
          }
          void sendLayers({ mode: drop.copy ? 'copy' : 'move', from, to: { projectId: drop.projectId } });
          return;
        }
        const openId = loadedProjectIdRef.current;
        // Let go over the project it came from (the next tab was still
        // opening): nothing to do.
        if (!openId || openId === sourceId) return;
        void sendLayers({
          mode: drop.copy ? 'copy' : 'move',
          from,
          to: { projectId: openId, artboardId: drop.artboardId, at: drop.at },
        });
      },
    });
    activateTab(projectId);
  };

  /** The same for a whole artboard, which lands after the last one there. */
  const sendArtboardToTab = async (targetId: string, mode: 'move' | 'copy', artboardId: string) => {
    const sourceId = loadedProjectIdRef.current;
    if (!sourceId || targetId === sourceId || !projectTabs.has(targetId)) return;
    // The artboard as its project has it now, as for layers (pickNow in
    // sendLayers): the canvas may show another tab by the time a face is in.
    const boardNow = (): ArtboardState | null | undefined => {
      const doc =
        sourceId === loadedProjectIdRef.current ? artboardsRef.current : projectTabsParking.peek(sourceId)?.artboards;
      return doc ? (doc.find((board) => board.id === artboardId) ?? null) : undefined;
    };
    const start = boardNow();
    if (!start) return;
    if (mode === 'move' && artboardsRef.current.length < 2) {
      toast({
        title: 'A project keeps at least one artboard',
        description: 'Copy it instead, or add another artboard here first.',
      });
      return;
    }
    const sourceName = projectNameRef.current;
    const targetName = projectTabs.get(targetId)?.name || 'Untitled project';
    const verb = mode === 'move' ? 'Moved' : 'Copied';
    // As for layers (sendLayers): the faces its text is measured in come
    // first, and the artboard is read again after each wait.
    const facesOfBoard = (board: ArtboardState) =>
      textFacesOf(board.elements, board.localized, getProjectLocales([board]));
    const waited = new Set<string>();
    const picked = await pickWithFacesIn(start, boardNow, facesOfBoard, whenFacesLoaded, waited);
    if (!picked) return;
    const refused = await withProjectsHeld([sourceId, targetId], async () => {
      const now = boardNow();
      if (now === null) return;
      const source = now ? await pickWithFacesIn(now, boardNow, facesOfBoard, whenFacesLoaded, waited) : picked;
      if (!source) return;
      const landedId = await editTabInBackground(
        targetId,
        namedChange(`${verb} from ${sourceName}`, 'artboard', source.name),
        (boards) => {
          const placed = placeArtboard(boards, source, {});
          return { boards: placed.boards, result: placed.boardId };
        }
      );
      if (!landedId) {
        toast({
          title: `${targetName} could not be opened`,
          description: 'Nothing was moved. Open that tab, then try again.',
          variant: 'destructive',
        });
        return;
      }
      pointTabAt(targetId, landedId);
      if (mode === 'move') {
        // From the project it came from, captured before the write: the canvas
        // may show another tab by now, and that tab can have a board with the
        // same id (a duplicated project does). And only as it went, as for
        // layers: edited while the target was written, it stays.
        let edited = false;
        const left = await editProjectAnywhere(
          sourceId,
          namedChange(`Moved to ${targetName}`, 'artboard', source.name),
          (boards) => {
            const kept = boards.filter((board) => board.id !== artboardId);
            // Gone already, or the last board left: nothing to take away.
            if (kept.length === boards.length || kept.length === 0) return null;
            if (!sameDocument(boards.filter((board) => board.id === artboardId), [source])) {
              edited = true;
              return null;
            }
            return { boards: kept, result: true };
          }
        );
        if (!left) {
          toast({
            title: `Copied to ${targetName}`,
            description: edited
              ? `The artboard changed in ${sourceName} while it moved, so it is in both projects.`
              : `${sourceName} did not take the change, so the artboard is in both projects.`,
            action: openTabAction(targetId, targetName),
          });
          return;
        }
      }
      toast({ title: `${verb} to ${targetName}`, description: source.name, action: openTabAction(targetId, targetName) });
    });
    if (refused) {
      toast({
        title: `${projectNameOf(refused)} is open in another window`,
        description: 'Nothing was moved. Close it there, then try again.',
        variant: 'destructive',
      });
    }
  };

  /** The other tabs, for the canvas menu's Move to and Copy to. */
  const sendTargets = useMemo(
    () =>
      projectTabs.tabs
        .filter((tab) => tab.projectId !== activeProjectId)
        .map((tab) => ({ projectId: tab.projectId, name: tab.name, accent: tab.summary?.accent })),
    [projectTabs.tabs, activeProjectId]
  );

  // --- tabs across windows ---------------------------------------------------
  //
  // Each project in this window's tabs is locked to this window
  // (projectLocks.ts), so no other window opens it to write it as well. The tab
  // bus (tabWindows.ts) is how windows ask each other to show a project, hand
  // one over, or take one in.

  // A lock for every tab, let go of when the tab goes. The project being
  // opened takes its own before it is read (the loader, loadProjectFromData),
  // and a pinned lock belongs to an open or a hand-over still under way. One
  // that started on the canvas (the first edit of an empty one) takes it here.
  const forgetTab = projectTabs.forget;
  useEffect(() => {
    const wanted = new Set(projectTabs.tabs.map((tab) => tab.projectId));
    for (const id of heldProjectIds()) {
      if (wanted.has(id) || pinnedLocksRef.current.has(id) || id === loadedProjectIdRef.current) continue;
      releaseProjectLock(id);
    }
    for (const id of wanted) {
      const opening = id === activeProjectIdRef.current && id !== loadedProjectIdRef.current;
      if (isProjectLockHeld(id) || pinnedLocksRef.current.has(id) || opening) continue;
      void holdProjectLock(id).then((held) => {
        // Another window has it (a restored session that window had open too),
        // so a tab for it here would make a second writer.
        if (held || id === loadedProjectIdRef.current || id === activeProjectIdRef.current) return;
        if (pinnedLocksRef.current.has(id)) return;
        forgetTab(id);
      });
    }
  }, [projectTabs.tabs, forgetTab]);

  /** A project another window has open, asked about instead of opened. */
  const [projectElsewhere, setProjectElsewhere] = useState<{ projectId: string; name: string } | null>(null);
  /** An open another window's lock turned down. Asked about, never reported as a failure. */
  const askAboutProjectElsewhere = (error: ProjectOpenElsewhereError) =>
    setProjectElsewhere({ projectId: error.projectId, name: error.projectName });

  /**
   * A tab leaves this window. The canvas stops taking edits to it at once, and
   * the lock is let go of only once its project and its undo stack are both
   * written, so the window it goes to opens it as it was, undo included.
   * Resolves when the lock is gone.
   */
  const letTabGo = async (projectId: string) => {
    pinLock(projectId);
    // Opened again here before the lock goes (from Recent projects, a file,
    // the account), it would find the lock still held and open, and then two
    // windows would save it. Anything that asks for it from now on is turned
    // down, the way another window's lock turns it down.
    const handedOver = startHandOver(projectId);
    // Still being read, it never reaches this canvas now.
    const opening = stopOpening(projectId);
    let undo: UndoSnapshot | null = null;
    const onCanvas = projectId === loadedProjectIdRef.current;
    if (projectId === activeProjectIdRef.current || onCanvas) {
      const next = nextActiveAfterClose(projectTabs.getTabs(), projectId, projectId);
      if (onCanvas) {
        undo = canvasUndoSnapshot();
        // Nothing on the canvas is this project's any more: a commit landing
        // before the next one opens is turned down rather than saved here.
        loadedProjectIdRef.current = null;
        canvasSerialRef.current += 1;
      }
      // Still opening, the canvas holds the project before it, which stays put
      // when its tab is the next one, undo history and all.
      if (next) activateTab(next);
      else if (!isSecondaryWindow) clearCanvasForNoTabs();
    } else {
      const parked = projectTabsParking.peek(projectId);
      if (parked) undo = undoSnapshotOf(parked);
    }
    forgetTab(projectId);
    try {
      // A transfer to or from it finishes first, while this window still has
      // the project, so the window it goes to reads what the transfer wrote.
      // So does the open it stopped, which holds the lock until it has.
      await Promise.all([opening, projectWorkDone(projectId)]);
      await Promise.all([
        flushProjectSave(),
        // Asleep, its stack is on disk already and only needs marking as one
        // the other window may take.
        undo ? saveUndo(projectId, undo, { handOver: true }) : undoStore.handOver(projectId).catch(() => {}),
      ]);
    } finally {
      settleLock(projectId);
      handedOver();
    }
    // A window a tab was moved into closes once its last tab has gone.
    if (isSecondaryWindow && projectTabs.getTabs().length === 0) void closeThisWindow();
  };

  /**
   * Open a project another window is letting go of, as a tab of its own. The
   * open waits a moment for that window's lock to go (HAND_OVER_WAIT_MS).
   */
  const takeTabBack = (projectId: string) => {
    awaitedHandOversRef.current.add(projectId);
    projectTabs.requestNewTab();
    setActiveProjectId(projectId);
  };

  const moveTabToNewWindow = (projectId: string, placement: TabWindowPlacement) => {
    if (isExportingRef.current || projectTabs.getTabs().length < 2) return;
    const name = projectNameOf(projectId);
    const go = () => {
      // The window opens straight away (a browser only allows a popup inside
      // the gesture) and waits for this one to write the tab and let go.
      const leaving = letTabGo(projectId);
      void openTabWindow(projectId, name, placement).then(async (opened) => {
        if (opened) return;
        await leaving;
        takeTabBack(projectId);
        toast({
          title: 'That window could not be opened',
          description: isTauri()
            ? 'Something stopped the new window from opening. The project is back in its tab.'
            : 'Your browser blocked the pop-up. Allow pop-ups for this site, then try again.',
          variant: 'destructive',
        });
      });
    };
    if (projectId === activeProjectIdRef.current) confirmLeavingSession(null, 'Leave and move', go);
    else go();
  };

  const tabBusRef = useRef<WindowBus<TabWindowMessage> | null>(null);
  const [otherWindows, setOtherWindows] = useState<OtherTabWindow[]>([]);
  const handOverWaitersRef = useRef(new Map<string, () => void>());

  const moveTabToWindow = (projectId: string, windowId: string) => {
    const name = projectNameOf(projectId);
    const go = () => {
      void letTabGo(projectId).then(() =>
        tabBusRef.current?.post({ type: 'adopt', from: EDITOR_WINDOW_ID, to: windowId, projectId, name })
      );
    };
    if (projectId === activeProjectIdRef.current) confirmLeavingSession(null, 'Leave and move', go);
    else go();
  };

  /** Ask the window that has the project to let go of it, then open it here. */
  const takeProjectFromElsewhere = async (projectId: string) => {
    const requestId = Math.random().toString(36).slice(2, 10);
    // The other window answers once it has written the project and its undo
    // stack, which for a long history takes a moment.
    const handedOver = new Promise<boolean>((resolve) => {
      const timer = window.setTimeout(() => {
        handOverWaitersRef.current.delete(requestId);
        resolve(false);
      }, HAND_OVER_WAIT_MS);
      handOverWaitersRef.current.set(requestId, () => {
        window.clearTimeout(timer);
        resolve(true);
      });
    });
    tabBusRef.current?.post({ type: 'hand-over', from: EDITOR_WINDOW_ID, projectId, requestId });
    // No answer and still held: the other window could not be reached.
    if (!(await handedOver) && (await projectOpenElsewhere(projectId)) === true) {
      toast({
        title: 'The other window kept that project',
        description: 'Close its tab there, then open the project here.',
        variant: 'destructive',
      });
      return;
    }
    takeTabBack(projectId);
  };

  const tabBusHandlerRef = useRef<(message: TabWindowMessage) => void>(() => {});
  tabBusHandlerRef.current = (message: TabWindowMessage) => {
    switch (message.type) {
      case 'roll-call':
        tabBusRef.current?.post({
          type: 'here',
          from: EDITOR_WINDOW_ID,
          to: message.from,
          title: projectNameRef.current,
          tabs: projectTabs.getTabs().length,
          main: !isSecondaryWindow,
        });
        return;
      case 'here':
        if (message.to !== EDITOR_WINDOW_ID) return;
        setOtherWindows((current) => [
          ...current.filter((entry) => entry.id !== message.from),
          { id: message.from, title: message.title, tabs: message.tabs, main: message.main },
        ]);
        return;
      case 'show-project':
        if (!projectTabs.has(message.projectId)) return;
        handleActivateTab(message.projectId);
        void focusThisWindow();
        return;
      case 'hand-over': {
        const answer = () =>
          tabBusRef.current?.post({
            type: 'handed-over',
            from: EDITOR_WINDOW_ID,
            to: message.from,
            projectId: message.projectId,
            requestId: message.requestId,
          });
        if (projectTabs.has(message.projectId)) void letTabGo(message.projectId).then(answer);
        // Its tab closed while a transfer still holds it: the lock goes once
        // the transfer is done.
        else if (projectWorkRef.current.has(message.projectId)) void projectWorkDone(message.projectId).then(answer);
        return;
      }
      case 'handed-over':
        if (message.to !== EDITOR_WINDOW_ID) return;
        handOverWaitersRef.current.get(message.requestId)?.();
        handOverWaitersRef.current.delete(message.requestId);
        return;
      case 'adopt':
        if (message.to !== EDITOR_WINDOW_ID) return;
        takeTabBack(message.projectId);
        void focusThisWindow();
        return;
      case 'tab-drag': {
        const { from } = message;
        if (message.phase === 'start') {
          // Another window is dragging one of its tabs out: say where this one
          // is, for it to tell when the pointer is over it. Nothing moves this
          // window while another one drags.
          void thisWindowScreenRect().then((rect) =>
            tabBusRef.current?.post({
              type: 'tab-drag-window',
              from: EDITOR_WINDOW_ID,
              to: from,
              projectId: message.projectId,
              rect: document.visibilityState === 'visible' ? rect : null,
              focusedAt: windowFocusedAt(),
              title: projectNameRef.current,
              main: !isSecondaryWindow,
            })
          );
          return;
        }
        // Named as the window it would land in, or no longer.
        const here = message.phase === 'over' && message.target === EDITOR_WINDOW_ID;
        setIncomingTab((current) => (here ? { from, name: message.name } : current?.from === from ? null : current));
        return;
      }
      case 'tab-drag-window': {
        if (message.to !== EDITOR_WINDOW_ID) return;
        const drag = tearDragRef.current;
        if (!drag || drag.projectId !== message.projectId) return;
        drag.windows.set(message.from, {
          windowId: message.from,
          rect: message.rect,
          focusedAt: message.focusedAt,
          name: message.main ? 'the main window' : `the window with ${message.title || 'Untitled project'}`,
        });
        if (drag.point) retarget(drag, drag.point);
        return;
      }
    }
  };
  useEffect(() => {
    let disposed = false;
    let bus: WindowBus<TabWindowMessage> | null = null;
    trackWindowFocus();
    void joinTabWindowBus((message) => tabBusHandlerRef.current(message)).then((joined) => {
      if (disposed) {
        joined.close();
        return;
      }
      bus = joined;
      tabBusRef.current = joined;
    });
    return () => {
      disposed = true;
      bus?.close();
      tabBusRef.current = null;
    };
  }, []);

  /** Who else is open, for Move to window: answers arrive within a few ms. */
  const askForOtherWindows = () => {
    setOtherWindows([]);
    tabBusRef.current?.post({ type: 'roll-call', from: EDITOR_WINDOW_ID });
  };

  // A tab dragged out of the strip and let go over another editor window moves
  // there (tabDrag.ts). The other windows say where they are as the drag
  // starts; this one works out which the pointer is over, tells them, and
  // decides where the tab lands from where it is let go.

  /** The window a tab being dragged out of this one would move to. */
  const [tearTarget, setTearTarget] = useState<{ windowId: string; name: string } | null>(null);
  const tearDragRef = useRef<TearDrag | null>(null);
  /** A tab another window is dragging over this one, for the overlay that says it would land here. */
  const [incomingTab, setIncomingTab] = useState<{ from: string; name: string } | null>(null);

  /** The pointer is at `point`: name the window the tab would land in, when that changed. */
  const retarget = (drag: TearDrag, point: ScreenPoint) => {
    drag.point = point;
    const target = pickDropWindow(point, drag.own, drag.windows.values());
    if (target === drag.target) return;
    drag.target = target;
    tabBusRef.current?.post({
      type: 'tab-drag',
      from: EDITOR_WINDOW_ID,
      projectId: drag.projectId,
      name: drag.name,
      phase: 'over',
      target,
    });
    const answer = target ? drag.windows.get(target) : undefined;
    setTearTarget(answer ? { windowId: answer.windowId, name: answer.name } : null);
  };

  const handleTabTearMove = (projectId: string, event: { screenX: number; screenY: number }) => {
    let drag = tearDragRef.current;
    if (!drag || drag.projectId !== projectId) {
      const started: TearDrag = {
        projectId,
        name: projectNameOf(projectId),
        own: null,
        point: null,
        windows: new Map(),
        target: null,
        latest: null,
        frame: null,
      };
      drag = started;
      tearDragRef.current = started;
      tabBusRef.current?.post({
        type: 'tab-drag',
        from: EDITOR_WINDOW_ID,
        projectId,
        name: started.name,
        phase: 'start',
        target: null,
      });
      // Measured once: this window does not move while one of its tabs is dragged.
      void thisWindowScreenRect().then((rect) => {
        if (tearDragRef.current !== started) return;
        started.own = rect;
        if (started.point) retarget(started, started.point);
      });
    }
    drag.latest = event;
    // One position a frame is plenty, and on the desktop each one is a call into Tauri.
    if (drag.frame !== null) return;
    const live = drag;
    live.frame = requestAnimationFrame(() => {
      live.frame = null;
      const latest = live.latest;
      if (!latest || tearDragRef.current !== live) return;
      void pointerScreenPoint(latest).then((point) => {
        if (point && tearDragRef.current === live) retarget(live, point);
      });
    });
  };

  /**
   * The drag outside the strip is over: let go at `release`, or put back or
   * cancelled (null). Where the tab lands comes from the release itself, never
   * from the last frame, which can be a window the pointer has since left: over
   * another window it moves there, and anywhere else it opens the new window
   * `release.placement` describes, when there is one.
   */
  const handleTabTearEnd = (
    projectId: string,
    release: { screenX: number; screenY: number; placement: TabWindowPlacement | null } | null
  ) => {
    const drag = tearDragRef.current?.projectId === projectId ? tearDragRef.current : null;
    if (drag) {
      if (drag.frame !== null) cancelAnimationFrame(drag.frame);
      tearDragRef.current = null;
      setTearTarget(null);
      tabBusRef.current?.post({
        type: 'tab-drag',
        from: EDITOR_WINDOW_ID,
        projectId,
        name: drag.name,
        phase: 'end',
        target: null,
      });
    }
    if (!release) return;
    const land = (point: ScreenPoint | null) => {
      const target = drag && point ? pickDropWindow(point, drag.own, drag.windows.values()) : null;
      if (target) moveTabToWindow(projectId, target);
      else if (release.placement) moveTabToNewWindow(projectId, release.placement);
    };
    // A browser opens the new window only inside the release, so the web
    // decides now, from the release's own position. The desktop asks Tauri
    // where the pointer is, in the physical pixels the windows answered in.
    if (!isTauri()) land({ x: release.screenX, y: release.screenY });
    else void pointerScreenPoint(release).then(land);
  };

  // Taken down once this window is used again, in case the window dragging the
  // tab went away before it could say the drag was over.
  useEffect(() => {
    if (!incomingTab) return;
    const clear = () => setIncomingTab(null);
    window.addEventListener('focus', clear);
    window.addEventListener('pointerdown', clear, true);
    return () => {
      window.removeEventListener('focus', clear);
      window.removeEventListener('pointerdown', clear, true);
    };
  }, [incomingTab]);

  // The displays a tab can open on. Read now, and again whenever the tab menu
  // opens, because a display can be plugged in or out while the app runs.
  const [tabDisplays, setTabDisplays] = useState<MonitorInfo[]>([]);
  const refreshTabDisplays = useCallback(() => {
    void listMonitors().then(setTabDisplays);
  }, []);
  useEffect(() => refreshTabDisplays(), [refreshTabDisplays]);
  // A browser sees one display until it is asked to see them all, which takes
  // a prompt, which takes a click: hence a menu item rather than asking here.
  const [canAskForDisplays, setCanAskForDisplays] = useState(false);
  useEffect(() => {
    setCanAskForDisplays(!isTauri() && typeof (window as { getScreenDetails?: unknown }).getScreenDetails === 'function');
  }, []);

  // The taskbar names the project in front, in a window a tab was moved into.
  useEffect(() => {
    if (!isTauri() || !isSecondaryWindow || !currentProjectName) return;
    void import('@tauri-apps/api/window')
      .then(({ getCurrentWindow }) => getCurrentWindow().setTitle(`${currentProjectName} - Open Screenshot Generator`))
      .catch(() => {});
  }, [currentProjectName, isSecondaryWindow]);

  // In a window a tab was moved into there is no menu bar on Windows and Linux
  // (settings.rs gives it to `main`), so the menu's three shortcuts are read
  // here. macOS has one menu bar for the whole app, and it sends them itself.
  useEffect(() => {
    if (!isTauri() || !isSecondaryWindow) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey || event.metaKey || event.altKey) return;
      const key = event.key.toLowerCase();
      const command = key === 'w' && !event.shiftKey ? 'close' : key === 't' ? (event.shiftKey ? 'reopen' : 'new') : null;
      if (!command) return;
      event.preventDefault();
      tabCommandRef.current(command);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [isSecondaryWindow]);

  const handleUndo = useCallback(() => {
    applyHistoryIndex(historyIndex - 1);
  }, [applyHistoryIndex, historyIndex]);

  const handleRedo = useCallback(() => {
    applyHistoryIndex(historyIndex + 1);
  }, [applyHistoryIndex, historyIndex]);

  // Delete what is selected: the whole selection in one commit, so removing
  // five layers is one undo step rather than five. With nothing selected the
  // Delete key still means the artboard itself.
  const handleDeleteSelected = useCallback(() => {
    if (activeArtboardId && selectedElementIds.length > 0) {
      const activeArtboard = artboards.find(ab => ab.id === activeArtboardId);
      if (!activeArtboard) return;
      const doomed = new Set(selectedElementIds);
      const remaining = activeArtboard.elements.filter(el => !doomed.has(el.id));
      const removedCount = activeArtboard.elements.length - remaining.length;
      if (removedCount === 0) {
        toast({ title: "Nothing to delete", description: "Those layers are no longer on the artboard.", variant: "destructive" });
        return;
      }
      // Straight to the base array: removing a layer is structural, and a
      // projection cannot express "this element does not exist" apart from
      // "this element is hidden in this one language".
      //
      // dropElementOverrides in the same pass, the way every other delete path
      // does it: a translation left behind under a dead id is what a re-minted
      // id would later inherit.
      const landed = handleArtboardsUpdate(
        artboards.map(ab =>
          ab.id === activeArtboardId
            ? dropElementOverrides({ ...ab, elements: remaining }, [...doomed])
            : ab
        )
      );
      if (!landed) return;
      setSelectedElementIds([]);
      toast({
        title: removedCount === 1 ? "Element deleted" : `${removedCount} elements deleted`,
        description: removedCount === 1
          ? "Element was removed from the artboard."
          : "They were removed from the artboard.",
      });
    } else if (activeArtboardId) {
      handleDeleteArtboard(activeArtboardId);
    } else {
      toast({title: "Cannot Delete", description: "No artboard or element selected.", variant: "destructive"});
    }
  }, [activeArtboardId, selectedElementIds, artboards, toast, handleArtboardsUpdate]);

  // Add keyboard event handlers for delete, undo, and redo
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Preview mode has its own keyboard handling
      if (isPreviewOpen) return;
      // The start dialog owns the keyboard while it is up. Read through a ref so
      // neither of these effects gains a dependency and re-subscribes. Without
      // this the editor shortcuts fire underneath the dialog: Cmd+V is
      // preventDefault'ed before the browser can raise a `paste` event, so
      // pasting a screenshot into the intake could never work, and a bare `h`
      // or `v` silently retargets the canvas tool.
      if (isTemplateSelectorOpenRef.current) return;
      // Skip if we're typing in an input, textarea, etc.
      if (
        e.target instanceof HTMLInputElement || 
        e.target instanceof HTMLTextAreaElement ||
        (e.target instanceof HTMLElement && e.target.isContentEditable)
      ) {
        return;
      }
      // Undo and redo still reach the canvas from the Agent panel, since taking
      // back what the agent just did is the obvious thing to want there. Every
      // other shortcut acts on the canvas selection and stays out of the chat.
      const isUndoRedo = (e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'z' || e.key.toLowerCase() === 'y');
      if (isInAgentPanel(e.target) && !isUndoRedo) {
        // Backspace still loses its default, as it does for the canvas below:
        // WebKit can take it as "go back a page", which reloads the editor.
        if (e.key === 'Backspace') e.preventDefault();
        return;
      }

      // Copy: Ctrl+C or Cmd+C
      if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
        // Words selected in the chat: let the browser copy them.
        if (hasAgentPanelSelection()) return;
        e.preventDefault();
        if (activeArtboardId && selectedElementIds.length > 0) {
          handleCopyElement();
        }
      }

      // Paste: Ctrl+V or Cmd+V. preventDefault ONLY when there are layers on
      // the editor's clipboard. Calling it unconditionally also suppressed the
      // browser's own `paste` event, so nothing in the app could ever receive
      // an image off the system clipboard: that is what the quick start's
      // paste-a-screenshot intake listens for.
      if ((e.ctrlKey || e.metaKey) && e.key === 'v' && readElementClipboard()) {
        e.preventDefault();
        handlePasteElement();
      }

      // Delete key for element or artboard deletion
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault(); // Prevent browser navigation
        handleDeleteSelected();
      }

      // Undo: Ctrl+Z or Cmd+Z
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        if (historyIndex > 0) {
          handleUndo();
        }
      }

      // Redo: Ctrl+Shift+Z or Cmd+Shift+Z or Ctrl+Y or Cmd+Y
      if (((e.ctrlKey || e.metaKey) && e.key === 'z' && e.shiftKey) || 
          ((e.ctrlKey || e.metaKey) && e.key === 'y')) {
        e.preventDefault();
        if (historyIndex < history.length - 1) {
          handleRedo();
        }
      }

      // Escape drops the selection, so there is a way back to the board's own
      // form without hunting for bare canvas to click.
      if (e.key === 'Escape') {
        if (
          e.target instanceof HTMLElement &&
          e.target.closest('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]')
        ) {
          return;
        }
        // The right-click menu closes on Escape itself, and it is in front.
        if (contextMenu) return;
        if (selectedElementIdsRef.current.length > 0) setSelectedElementIds([]);
        return;
      }

      // Select every layer on the active artboard.
      if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) {
        if (activeArtboardId) {
          e.preventDefault();
          const board = artboardsRef.current.find((ab) => ab.id === activeArtboardId);
          // A sound is never on the canvas, so Select all leaves it out rather
          // than handing back a selection that cannot be aligned or moved.
          if (board) setSelectedElementIds(board.elements.filter(hasCanvasBox).map((el) => el.id));
        }
        return;
      }

      // Group: Ctrl+G or Cmd+G. Ungroup adds Shift.
      if ((e.ctrlKey || e.metaKey) && (e.key === 'g' || e.key === 'G')) {
        e.preventDefault();
        if (e.shiftKey) handleUngroupSelection();
        else handleGroupSelection();
        return;
      }

      // Tool shortcuts: H for hand/pan tool, V for selection tool
      if (e.key === 'h' || e.key === 'H') {
        e.preventDefault();
        setActiveTool('pan');
      }

      if (e.key === 'v' || e.key === 'V') {
        e.preventDefault();
        setActiveTool('select');
      }

      // Arrow keys nudge the selection. Shift takes the bigger step, which is
      // what makes the key usable on a board 1206 pixels across.
      const nudge = NUDGE_DIRECTIONS[e.key];
      if (nudge && selectedElementIdsRef.current.length > 0) {
        // A Radix select, menu or dialog has focus on a plain div, so the
        // input test above lets an arrow key through: without this, arrowing
        // down the font list would walk the artwork across the board. Sliders,
        // tabs and select triggers are plain elements too, and they use the
        // arrows themselves to step a value, switch tabs or open the list.
        if (
          e.target instanceof HTMLElement &&
          e.target.closest('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [role="switch"], [role="checkbox"], [role="radio"], [role="slider"], [role="tab"], [role="combobox"]')
        ) {
          return;
        }
        // handleArtboardsUpdate refuses to commit while an export holds the
        // canvas, and a keystroke is far easier to fire mid-export than a drag.
        if (isExportingRef.current) return;
        // Stop the canvas scrolling out from under the layer being moved.
        e.preventDefault();
        const step = e.shiftKey ? NUDGE_STEP_LARGE : NUDGE_STEP;
        queueNudge(nudge.x * step, nudge.y * step);
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleDeleteSelected, handleUndo, handleRedo, historyIndex, history.length, activeArtboardId, selectedElementIds, setActiveTool, isPreviewOpen, queueNudge, handleGroupSelection, handleUngroupSelection, contextMenu]);

  // The live tool, readable from a listener that must not re-subscribe on every
  // tool change (the Space-to-pan effect below).
  const activeToolRef = useRef(activeTool);
  useEffect(() => { activeToolRef.current = activeTool; }, [activeTool]);
  // What to put back when Space comes up. Null whenever Space is not the thing
  // holding the hand tool on, which is also what makes the restore idempotent.
  const toolBeforeSpacePanRef = useRef<'select' | 'pan' | null>(null);
  const spaceHeldRef = useRef(false);
  // A drag that began under Space, so the release can wait for the pointer.
  const spacePanPointerDownRef = useRef(false);

  /**
   * Hold Space to pan, release to go back to the tool you were on, the way
   * every design tool does it. It flips `activeTool` rather than duplicating
   * CanvasArea's pan handling, so the grab cursor, the touch-action guard and
   * the toolbar pill all follow for free.
   *
   * Space is taken globally (preventDefault), which does cost activating a
   * focused button with Space: the toolbar keeps focus after a click, so
   * leaving it alone would undo something instead of panning. Enter still
   * activates, and the controls Space is the *only* key for (fields, checkable
   * things, anything inside a focus-trapping overlay) are skipped below.
   */
  useEffect(() => {
    const restoreTool = () => {
      const previous = toolBeforeSpacePanRef.current;
      if (previous === null) return;
      // Released mid-drag: the gesture still owns the pointer, so hold the hand
      // until the button comes up rather than changing tools under the drag.
      if (spaceHeldRef.current || spacePanPointerDownRef.current) return;
      toolBeforeSpacePanRef.current = null;
      setActiveTool(previous);
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      // e.code, not e.key, so a non-Latin layout still reports Space here.
      if (e.code !== 'Space') return;
      // Preview mode has its own keyboard handling
      if (isPreviewOpen) return;
      const target = e.target;
      // Skip if we're typing in an input, textarea, etc.
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        (target instanceof HTMLElement && target.isContentEditable)
      ) {
        return;
      }
      if (isInAgentPanel(target)) return;
      // A dialog or menu traps focus and owns Space for the control inside it,
      // and a canvas behind a modal is not what anyone is trying to pan.
      if (
        target instanceof HTMLElement &&
        target.closest('[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [role="switch"], [role="checkbox"], [role="radio"]')
      ) {
        return;
      }
      // Space scrolls the canvas down and re-fires a focused button, and it has
      // to be blocked on the auto-repeats too: holding the key streams keydowns
      // and every one of them that gets through pages the canvas to the bottom.
      e.preventDefault();
      if (e.repeat) return;
      spaceHeldRef.current = true;
      if (toolBeforeSpacePanRef.current === null) {
        toolBeforeSpacePanRef.current = activeToolRef.current;
      }
      setActiveTool('pan');
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return;
      spaceHeldRef.current = false;
      restoreTool();
    };

    const handlePointerDown = () => {
      if (toolBeforeSpacePanRef.current === null) return;
      spacePanPointerDownRef.current = true;
    };

    const handlePointerUp = () => {
      spacePanPointerDownRef.current = false;
      restoreTool();
    };

    // Leaving the window swallows the keyup (Cmd+Tab, a devtools focus, the
    // OS taking the key), which would strand the canvas on the hand tool with
    // nothing held down.
    const handleWindowBlur = () => {
      spaceHeldRef.current = false;
      spacePanPointerDownRef.current = false;
      restoreTool();
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('pointerup', handlePointerUp, true);
    window.addEventListener('pointercancel', handlePointerUp, true);
    window.addEventListener('blur', handleWindowBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('pointerup', handlePointerUp, true);
      window.removeEventListener('pointercancel', handlePointerUp, true);
      window.removeEventListener('blur', handleWindowBlur);
    };
  }, [isPreviewOpen]);

  const handleArtboardSelection = (artboardId: string | null) => {
    setActiveArtboardId(artboardId);
    // Only when the board actually changes. Compared against the project id,
    // this never matched, so selecting the board an element was already on
    // cleared the selection.
    if (artboardId !== activeArtboardId) {
        setSelectedElementIdOnActiveArtboard(null);
    }
  }

  /**
   * The one place a canvas click turns into a selection.
   *
   * Group membership is resolved here rather than in Artboard so that the
   * canvas, the Layers panel and a detached panel all answer a click on a
   * grouped layer the same way. `modifiers.toggle` is shift-click, which adds
   * or removes; `modifiers.single` is alt-click, the way to reach one member of
   * a group without bringing the rest.
   */
  /**
   * Drop anything the active board does not hold.
   *
   * A selection belongs to one board, but nothing rewrites it when the active
   * board changes underneath it: duplicating a board activates the copy, whose
   * elements carry fresh ids, and the properties form would go on offering to
   * align and group layers that are no longer on screen.
   */
  useEffect(() => {
    setSelectedElementIds((ids) => {
      if (ids.length === 0) return ids;
      const board = artboardsRef.current.find((ab) => ab.id === activeArtboardId);
      const live = board ? ids.filter((id) => board.elements.some((el) => el.id === id)) : [];
      return live.length === ids.length ? ids : live;
    });
  }, [activeArtboardId]);

  const handleElementSelectionOnArtboard = useCallback((
    elementId: string | null,
    modifiers?: ElementSelectModifiers
  ) => {
    if (!elementId) {
      setSelectedElementIds([]);
      return;
    }
    const board = artboardsRef.current.find((ab) => ab.elements.some((el) => el.id === elementId));
    const wanted = board && !modifiers?.single
      ? [...expandGroups(board.elements, [elementId])]
      : [elementId];
    if (!modifiers?.toggle) {
      setSelectedElementIds(wanted);
      return;
    }
    setSelectedElementIds((current) => {
      const next = new Set(current);
      // A shift-click on a layer already in the selection takes it (and the
      // rest of its group) out again.
      const alreadyIn = wanted.every((id) => next.has(id));
      for (const id of wanted) {
        if (alreadyIn) next.delete(id);
        else next.add(id);
      }
      return [...next];
    });
  }, []);

  /** Replace the selection with exactly these layers, as a marquee does. */
  const handleSelectElementIds = useCallback((ids: string[]) => {
    setSelectedElementIds(ids);
  }, []);

  const handleSelectElementFromLayerPanel = (elementId: string, modifiers?: ElementSelectModifiers) => {
    handleElementSelectionOnArtboard(elementId, modifiers);
  };

  // Add handler for deleting element from layers panel
  const handleDeleteElementFromLayerPanel = (elementId: string) => {
    // The component deletes the element itself (see canvasTakesCommits).
    if (!canvasTakesCommits()) return;
    if (activeArtboardId) {
      const artboardComponent = artboardRefs.current[activeArtboardId];
      if (artboardComponent && artboardComponent.deleteElementByIdG) {
        artboardComponent.deleteElementByIdG(elementId);
        // Only the layer that went. Clearing outright would drop the rest of a
        // multi-selection because one of its members was deleted.
        setSelectedElementIds((ids) => ids.filter((id) => id !== elementId));
        toast({ title: "Element Deleted", description: "Element was removed from the artboard." });
      } else {
        toast({ title: "Cannot Delete Element", description: "Artboard component reference not found.", variant: "destructive" });
      }
    }
  };

  const handleMoveElementLayer = (elementId: string, direction: 'up' | 'down') => {
    if (!activeArtboardId) return;

    const updatedArtboards = artboards.map(ab => {
      if (ab.id === activeArtboardId) {
        const elements = [...ab.elements];
        const elementIndex = elements.findIndex(el => el.id === elementId);

        if (elementIndex === -1) return ab;

        if (direction === 'up') { // Move towards end of array (visually front)
          if (elementIndex < elements.length - 1) {
            const temp = elements[elementIndex];
            elements[elementIndex] = elements[elementIndex + 1];
            elements[elementIndex + 1] = temp;
          }
        } else { // 'down' (Move towards start of array (visually back))
          if (elementIndex > 0) {
            const temp = elements[elementIndex];
            elements[elementIndex] = elements[elementIndex - 1];
            elements[elementIndex - 1] = temp;
          }
        }
        return { ...ab, elements };
      }
      return ab;
    });
    handleArtboardsUpdate(updatedArtboards); // Use handleArtboardsUpdate to ensure history and positioning
  };

  // Applies a new canvas size to every artboard. With `scaleContent` (the
  // Canvas Size dialog's default) each artboard's elements are uniformly
  // scaled and re-centered — same treatment as the Devices format conversion —
  // so designs survive aspect-ratio changes instead of getting cropped.
  const handleUpdateArtboardSize = (width: number, height: number, scaleContent = true) => {
    if (width < 100 || height < 100 || width > 5000 || height > 5000) {
      toast({ 
        title: "Invalid Dimensions", 
        description: "Width and height must be between 100 and 5000 pixels.",
        variant: "destructive"
      });
      return;
    }
    
    // Header and search art keeps Apple's size: it is the same whatever size
    // the screenshots are.
    const keptCreative = artboards.filter(isCreativeBoard).length;
    if (keptCreative === artboards.length) {
      toast({
        title: "Header and search art keeps Apple's size",
        description: 'Select a screenshot artboard to change the canvas size.',
      });
      return;
    }

    // Update all artboards with the new size
    const updatedArtboards = artboards.map(artboard => isCreativeBoard(artboard) ? artboard : ({
      ...artboard,
      size: {
        width,
        height
      },
      elements: scaleContent
        ? scaleElementsToCanvas(artboard.elements, artboard.size, { width, height })
        : artboard.elements,
    }));

    // Through the one door: this used to push history and set state without
    // ever writing Dexie, so a canvas size change did not survive a reload.
    if (!handleArtboardsUpdate(updatedArtboards, namedChange(`Canvas Size ${width} x ${height}`, 'resize'))) return;

    toast({
      title: "Artboard Size Updated",
      description: (scaleContent
        ? `All artboards resized to ${width} × ${height} pixels with content scaled to fit.`
        : `All artboards resized to ${width} × ${height} pixels`) +
        (keptCreative > 0 ? ' Header and search art keeps its App Store size.' : '')
    });
  };

  // Language the project's text is in, if the artboards that carry text all
  // agree on one. Mixed or unknown falls back to detection.
  const currentProjectLanguage = useMemo(() => {
    const languages = new Set(
      artboards
        .filter((ab) => ab.elements.some((el) => el.type === 'text'))
        .map((ab) => ab.language)
    );
    if (languages.size !== 1) return undefined;
    return Array.from(languages)[0];
  }, [artboards]);

  const handleTranslateProject = async (
    targetLanguage: string,
    allArtboards: boolean,
    sourceLanguage: string = AUTO_DETECT,
    targetFont?: string
  ) => {
    let artboardsToUpdate = artboards;
    if (!allArtboards && activeArtboardId) {
      artboardsToUpdate = artboards.filter((ab) => ab.id === activeArtboardId);
    }
    const modifiedIds = new Set(artboardsToUpdate.map((ab) => ab.id));

    const samples = artboardsToUpdate
      .flatMap((ab) => ab.elements)
      .filter((el): el is TextElementProps => el.type === 'text')
      .map((el) => el.content?.trim())
      .filter((content): content is string => !!content);

    if (samples.length === 0) {
      toast({
        title: "No text found",
        description: "There are no text elements to translate in the selected artboards."
      });
      return;
    }

    // Resolve the source once for the whole run rather than per element.
    // Detecting from a single label like "Avg. rating" guesses wrong often, and
    // every artboard in a project is realistically in one language anyway.
    let effectiveSource = sourceLanguage || AUTO_DETECT;
    if (effectiveSource === AUTO_DETECT) {
      const sample = [...samples]
        .sort((a, b) => b.length - a.length)
        .slice(0, 10)
        .join('\n')
        .slice(0, 1000);
      const detected = await detectLanguage(sample);
      if (detected) {
        effectiveSource = detected.language;
      }
    }

    if (effectiveSource !== AUTO_DETECT && effectiveSource === targetLanguage) {
      toast({
        title: "Nothing to translate",
        description: `The text is already in ${getLanguageName(targetLanguage)}.`
      });
      return;
    }

    const newArtboards = [];
    let successCount = 0;
    let failCount = 0;
    let rateLimitHit = false;

    for (const ab of artboards) {
      if (!modifiedIds.has(ab.id)) {
        newArtboards.push(ab);
        continue;
      }

      const updatedElements = [];
      // Only stamp the artboard's language when every one of its text elements
      // made it across, otherwise a half-translated artboard would lie about
      // what language it is in and poison the next run's source.
      let fullyTranslated = true;
      for (const el of ab.elements) {
        if (rateLimitHit) {
          updatedElements.push(el);
          fullyTranslated = false;
          continue;
        }

        if (el.type === 'text') {
          try {
            const result = await translateText(el.content, targetLanguage, effectiveSource);
            updatedElements.push({ 
              ...el, 
              content: result.text,
              ...(targetFont ? { fontFamily: targetFont } : {})
            });
            successCount++;
            // With source 'auto' the server tells us what it saw; reuse it for
            // the remaining elements so one detection covers the whole run.
            if (effectiveSource === AUTO_DETECT && result.detectedLanguage) {
              effectiveSource = result.detectedLanguage;
            }
          } catch (e: any) {
            console.error("Failed to translate element", el.id, e);
            updatedElements.push(el);
            fullyTranslated = false;
            if (e.status === 429) {
              rateLimitHit = true;
            } else {
              failCount++;
            }
          }
        } else {
          updatedElements.push(el);
        }
      }
      newArtboards.push({
        ...ab,
        elements: updatedElements,
        language: fullyTranslated ? targetLanguage : undefined,
      });
    }

    if (rateLimitHit) {
      if (
        successCount > 0 &&
        !handleArtboardsUpdate(newArtboards, namedChange('Translate', 'translate', `${successCount} text layers`))
      ) {
        toastUnsavedResult('The translation was not saved');
        return;
      }
      toast({
        title: "Rate limit exceeded",
        description: `Successfully translated ${successCount} element(s) before hitting the rate limit. Please wait a minute before trying again.`,
        variant: "destructive"
      });
    } else if (successCount > 0) {
      if (!handleArtboardsUpdate(newArtboards, namedChange('Translate', 'translate', `${successCount} text layers`))) {
        toastUnsavedResult('The translation was not saved');
        return;
      }
      toast({
        title: "Translation complete",
        description: `Successfully translated ${successCount} text element(s).${failCount > 0 ? ` Failed to translate ${failCount} element(s).` : ''}`
      });
    } else if (failCount > 0) {
      toast({
        title: "Translation failed",
        description: "Failed to translate text elements. Please try again later.",
        variant: "destructive"
      });
    } else {
      toast({
        title: "No text found",
        description: "There are no text elements to translate in the selected artboards."
      });
    }
  };

  // Artboard whose text the element-scoped dialog is about to translate, so
  // the source picker can seed from that board rather than the whole project.
  const translateElementArtboard = translateElementId
    ? artboards.find((ab) => ab.elements.some((el) => el.id === translateElementId))
    : undefined;

  const handleTranslateElement = async (
    elementId: string,
    targetLanguage: string,
    sourceLanguage: string = AUTO_DETECT,
    targetFont?: string
  ) => {
    const owner = artboards.find((ab) => ab.elements.some((el) => el.id === elementId));
    const element = owner?.elements.find((el) => el.id === elementId);

    if (!owner || !element || element.type !== 'text' || !element.content?.trim()) {
      toast({
        title: "Nothing to translate",
        description: "This text element is empty or no longer on the canvas."
      });
      return;
    }

    let effectiveSource = sourceLanguage || AUTO_DETECT;
    if (effectiveSource === AUTO_DETECT) {
      const detected = await detectLanguage(element.content.slice(0, 1000));
      if (detected) {
        effectiveSource = detected.language;
      }
    }

    if (effectiveSource !== AUTO_DETECT && effectiveSource === targetLanguage) {
      toast({
        title: "Nothing to translate",
        description: `The text is already in ${getLanguageName(targetLanguage)}.`
      });
      return;
    }

    let translated: string;
    try {
      const result = await translateText(element.content, targetLanguage, effectiveSource);
      translated = result.text;
    } catch (e: any) {
      console.error("Failed to translate element", elementId, e);
      toast({
        title: e?.status === 429 ? "Rate limit exceeded" : "Translation failed",
        description: e?.status === 429
          ? "Please wait a minute before trying again."
          : "Failed to translate this text element. Please try again later.",
        variant: "destructive"
      });
      return;
    }

    // The artboard's language stamp describes all of its text. It only stays
    // true if this was the board's one and only text element; otherwise the
    // board is now mixed and must go back to being detected.
    const isOnlyTextElement = !owner.elements.some(
      (el) => el.type === 'text' && el.id !== elementId
    );

    const landed = handleArtboardsUpdate(
      artboards.map((ab) =>
        ab.id !== owner.id
          ? ab
          : {
              ...ab,
              elements: ab.elements.map((el) =>
                el.id === elementId
                  ? { ...el, content: translated, ...(targetFont ? { fontFamily: targetFont } : {}) }
                  : el
              ),
              language: isOnlyTextElement ? targetLanguage : undefined,
            }
      ),
      namedChange('Translate', 'translate', getElementDisplayName(element))
    );
    if (!landed) {
      toastUnsavedResult('The translation was not saved');
      return;
    }

    toast({
      title: "Translation complete",
      description: `Text translated to ${getLanguageName(targetLanguage)}.`
    });
  };

  // The dialog is shared, so route its result to whichever scope opened it.
  const handleTranslateRequest = async (
    targetLanguage: string,
    allArtboards: boolean,
    sourceLanguage: string = AUTO_DETECT,
    targetFont?: string
  ) => {
    if (translateElementId) {
      await handleTranslateElement(translateElementId, targetLanguage, sourceLanguage, targetFont);
      return;
    }
    await handleTranslateProject(targetLanguage, allArtboards, sourceLanguage, targetFont);
  };


  // Imported families the open project actually depends on. Those files live
  // in IndexedDB rather than in the document, so a project using one is worth
  // warning about (LocalFontNotice). Built-ins never appear here: they load
  // from Google on any machine.
  const importedFonts = useCustomFonts();
  const importedFontsInProject = useMemo(() => {
    if (importedFonts.length === 0) return [];
    const used = new Set(collectFontFamilies(artboards).map((family) => family.toLowerCase()));
    return importedFonts
      .filter((font) => used.has(font.family.toLowerCase()))
      .map((font) => font.family);
  }, [artboards, importedFonts]);

  // Preload Google Fonts on component mount, and re-register the fonts the
  // user imported (which live in Dexie, so they need putting back on the page
  // before any artboard that uses one renders or exports).
  useEffect(() => {
    preloadGoogleFonts();
    loadCustomFonts().catch((error) => console.error('Could not load imported fonts', error));
  }, []);
  
  // The layers list and the board-level properties form both show what the
  // active language shows, so they read the projection.
  const activeArtboard = viewArtboards.find(ab => ab.id === activeArtboardId);
  const activeArtboardElements = activeArtboard ? activeArtboard.elements : [];
  const activeArtboardName = activeArtboard ? activeArtboard.name : undefined;
  // A project can hold App Preview boards next to plain screenshot boards, so
  // the selected board picks the export dialog. With nothing selected, any
  // video content in the project makes it the video one.
  const exportsAppPreview = useMemo(
    // Header and search art exports as a still even when it is animated.
    () =>
      activeArtboard
        ? projectHasVideoContent([activeArtboard]) && !isCreativeBoard(activeArtboard)
        : isAppPreviewProject,
    [activeArtboard, isAppPreviewProject]
  );

  // --- locale-derived props for the panels and dialogs ----------------------

  /** The language the design is written in. Named in every reset control. */
  const baseLocaleCode = useMemo(() => getBaseLocale(artboards), [artboards]);

  /** The selected element as the BASE language has it, before projection. */
  const selectedBaseElement = useMemo<ArtboardElement | undefined>(() => {
    if (!selectedElementIdOnActiveArtboard) return undefined;
    for (const board of artboards) {
      const el = board.elements.find((candidate) => candidate.id === selectedElementIdOnActiveArtboard);
      if (el) return el;
    }
    return undefined;
  }, [artboards, selectedElementIdOnActiveArtboard]);

  /** Its overrides in the active language, when it has any. */
  const selectedLocaleOverride = useMemo<ElementLocaleOverride | undefined>(() => {
    if (!activeLocale || !selectedElementIdOnActiveArtboard || !activeArtboardId) return undefined;
    return artboards.find((board) => board.id === activeArtboardId)
      ?.localized?.[activeLocale]?.[selectedElementIdOnActiveArtboard];
  }, [artboards, activeLocale, activeArtboardId, selectedElementIdOnActiveArtboard]);

  // Layer dots come from the BASE board, not the projection: the projection has
  // already written the override onto the element, so overrideStateFor would
  // compare the translated string against itself and never report a fallback.
  const layerLocaleStates = useMemo<Record<string, LocaleOverrideState> | undefined>(() => {
    if (!activeLocale) return undefined;
    const board = artboards.find((ab) => ab.id === activeArtboardId);
    if (!board) return undefined;
    const overrides = board.localized?.[activeLocale] ?? {};
    const states: Record<string, LocaleOverrideState> = {};
    for (const el of board.elements) states[el.id] = overrideStateFor(el, overrides[el.id]);
    return states;
  }, [artboards, activeArtboardId, activeLocale]);

  // --- the agent --------------------------------------------------------------
  //
  // What Claude Code is told with every message: the open project and what is
  // selected in it. Read through a ref when a message goes out, so the store
  // never holds a stale closure and nothing is computed while nobody chats.
  const agentContextSourceRef = useRef<Parameters<typeof buildAgentContext>[0] | null>(null);
  agentContextSourceRef.current = {
    projectId: activeProjectId,
    projectName: currentProjectName,
    artboards,
    activeArtboardId,
    selectedElementIds,
    activeLocale,
  };
  useEffect(() => {
    claudeAgent.setContextProvider(() =>
      agentContextSourceRef.current ? buildAgentContext(agentContextSourceRef.current) : null
    );
    return () => claudeAgent.setContextProvider(null);
  }, []);
  const agentContextLabel = useMemo(
    () =>
      agentEnabled
        ? describeAgentContext({
            projectId: activeProjectId,
            projectName: currentProjectName,
            artboards,
            activeArtboardId,
            selectedElementIds,
            activeLocale,
          })
        : null,
    [agentEnabled, activeProjectId, currentProjectName, artboards, activeArtboardId, selectedElementIds, activeLocale]
  );
  // Past chats shows each project under the name it has now, which a chat
  // saved before a rename does not know.
  const projectNames = useMemo(() => {
    const names = new Map(recentProjects.map((project) => [project.id, project.name] as const));
    if (activeProjectId) names.set(activeProjectId, currentProjectName);
    return names;
  }, [recentProjects, activeProjectId, currentProjectName]);
  const agentView = useMemo(
    () =>
      agentEnabled
        ? toAgentPanelView(claudeAgentState, agentContextLabel, {
            projectId: activeProjectId,
            nameOf: (projectId) => projectNames.get(projectId) ?? null,
          })
        : null,
    [agentEnabled, claudeAgentState, agentContextLabel, activeProjectId, projectNames]
  );

  // The chat follows the project: opening one brings back its latest chat, or
  // an empty one for it, so any project or template can start its own.
  useEffect(() => {
    if (!agentEnabled || !activeProjectId) return;
    void claudeAgent.followProject(activeProjectId, currentProjectName);
  }, [agentEnabled, activeProjectId, currentProjectName]);

  /**
   * A chat picked in Past chats, docked or detached. The chat opens first, so
   * when its project opens after it, the chat is already on that project and
   * followProject leaves it be.
   */
  const openAgentChat = async (chatId: string) => {
    const chat = claudeAgent.getSnapshot().chats.find((entry) => entry.id === chatId);
    if (!chat) return;
    const status = claudeAgent.getSnapshot().session.status;
    if (status === 'working' || status === 'starting') {
      toast({ title: 'The agent is still working', description: 'Stop it, then open the chat again.' });
      return;
    }
    if (!(await claudeAgent.openChat(chatId))) {
      toast({ title: 'That chat is no longer saved' });
      return;
    }
    if (!chat.projectId || chat.projectId === activeProjectIdRef.current) return;
    const project = await db.projects.get(chat.projectId).catch(() => undefined);
    if (!project) {
      toast({
        title: 'The project of that chat was deleted',
        description: 'The chat is open, and your next message is about the project open now.',
      });
      return;
    }
    // The same way a row in Recent projects opens one.
    setActiveProjectId(project.id);
    const params = new URLSearchParams(window.location.search);
    params.set('projectId', project.id);
    window.history.replaceState({}, '', `${window.location.pathname}?${params.toString()}`);
  };

  /** A message from the Agent panel, docked or detached. Pictures arrive as asset refs. */
  const handleAgentSend = async (text: string, attachments: AgentAttachment[]) => {
    try {
      const images = await Promise.all(
        attachments.map((attachment) => assetToImage(attachment.ref, attachment.fileName))
      );
      await claudeAgent.send({ text, preface: buildAttachmentNote(attachments) || undefined, images });
    } catch (error) {
      console.error('Could not send the message to Claude Code', error);
      toast({
        title: 'The message did not reach the agent',
        description: error instanceof Error ? error.message : 'Try sending it again.',
        variant: 'destructive',
      });
    }
  };

  // --- the dock, and the windows it can be torn off into --------------------
  //
  // One object holds everything the four panels render. The docked stack takes
  // it as it stands; useDockHost publishes a cut-down copy of the same object to
  // any detached window. Two views, one description, so they cannot drift.
  //
  // Memoized deliberately: its identity is what decides whether a snapshot goes
  // out, and a canvas drag re-renders this component per pixel.
  const dockData = useMemo<DockData>(
    () => ({
      activeProjectId,
      projectName: currentProjectName,
      selectedElement: selectedElementDetails,
      // The board-level form only when nothing is selected, which is the rule
      // the docked panel has always followed. Counted rather than read off the
      // single-selection id, which is null for a selection of five as well as
      // for an empty one.
      activeArtboardDetails:
        activeArtboardId && selectedElementIds.length === 0 ? (activeArtboard ?? null) : null,
      activeLocale,
      baseLocale: baseLocaleCode,
      localeOverride: selectedLocaleOverride,
      baseElement: selectedBaseElement,
      localeDetached: selectedLocaleDetached,
      layerElements: activeArtboardElements,
      selectedElementId: selectedElementIdOnActiveArtboard,
      selectedElementIds,
      activeArtboardName,
      layerLocaleStates,
      history,
      historyIndex,
      versions,
      isVersionBusy,
      // exportCanvasArtboards is the export's temporary board list, and every
      // value above is derived from it while it is up. Publishing that to a
      // detached panel would offer a person a board they never made.
      isExporting: exportCanvasArtboards !== null,
      tabRequest,
      agent: agentView,
    }),
    [
      activeProjectId,
      currentProjectName,
      selectedElementDetails,
      activeArtboardId,
      selectedElementIdOnActiveArtboard,
      selectedElementIds,
      activeArtboard,
      activeLocale,
      baseLocaleCode,
      selectedLocaleOverride,
      selectedBaseElement,
      selectedLocaleDetached,
      activeArtboardElements,
      activeArtboardName,
      layerLocaleStates,
      history,
      historyIndex,
      versions,
      isVersionBusy,
      exportCanvasArtboards,
      tabRequest,
      agentView,
    ]
  );

  // Not memoized on purpose: nearly every one of these is recreated per render
  // anyway, so a dependency list here would only be a lie. useDockHost keeps it
  // in a ref, so its identity does not cost anything.
  const dockHandlers: DockHandlers = {
    onUpdateElement: handleUpdateSelectedElement,
    onUpdateElementById: handleUpdateElementById,
    onStudioLive: updateStudioLive,
    onTranslateElement: handleTranslateTextElement,
    onUpdateArtboardDetails: handleUpdateArtboardDetails,
    onResetLocaleField: handleResetLocaleField,
    onToggleLocaleDetach: handleToggleLocaleDetach,
    onResetLocaleOverrides: handleResetLocaleOverrides,
    onJumpToHistory: applyHistoryIndex,
    onSaveNamedVersion: (label) => void handleSaveNamedVersion(label),
    onRestoreVersion: (version) => void handleRestoreVersion(version),
    onOpenVersionCopy: (version) => void handleOpenVersionCopy(version),
    onDeleteVersion: (version) => void handleDeleteVersion(version),
    onSelectElement: handleSelectElementFromLayerPanel,
    onAlignElements: handleAlignSelection,
    onDistributeElements: handleDistributeSelection,
    onGroupElements: handleGroupSelection,
    onUngroupElements: handleUngroupSelection,
    onUpdateSpan: handleUpdateSpan,
    onUngroupById: handleUngroupById,
    onRenameGroup: handleRenameGroup,
    onDropLayer: handleDropLayer,
    onMoveSelectionTo: handleMoveSelectionTo,
    onMoveElementLayer: handleMoveElementLayer,
    onDeleteElement: handleDeleteElementFromLayerPanel,
    onRenameElement: handleRenameElementFromLayerPanel,
    onAgentSend: (text, attachments) => void handleAgentSend(text, attachments),
    onAgentStop: () => void claudeAgent.stop(),
    onAgentNewChat: () => {
      // A new chat on the project the old one was about keeps its code
      // folders. When the editor has moved to another project, it starts
      // without them. It talks to the same CLI either way.
      const { chat } = claudeAgent.getSnapshot();
      const sameProject = !chat.projectId || chat.projectId === activeProjectIdRef.current;
      void claudeAgent.newChat(undefined, { folders: sameProject ? chat.folders : [], agent: chat.agent });
    },
    onAgentDetect: () => {
      if (claudeAgent.getSnapshot().chat.agent === 'codex') void claudeAgent.detectCodex(true);
      else void claudeAgent.detect(true);
    },
    onAgentSetModel: (model) => claudeAgent.setModel(model),
    onAgentSetEffort: (effort) => claudeAgent.setEffort(effort),
    onAgentSetAgent: (agent) => {
      claudeAgent.setChatAgent(agent);
      if (agent === 'codex') void claudeAgent.detectCodex();
    },
    onAgentSetCodexModel: (model) => claudeAgent.setCodexModel(model),
    onAgentSetCodexEffort: (effort) => claudeAgent.setCodexEffort(effort),
    onAgentHide: () => {
      claudeAgent.hidePanel();
      if (rightDockTab === 'agent') selectRightDockTab('properties');
      // A window holding only the Agent tab would be left with nothing in it.
      if (dockHost.detachedGroups.includes('agent')) void dockHost.reattach('agent');
    },
    onAgentOpenChat: (chatId) => void openAgentChat(chatId),
    onAgentDeleteChat: (chatId) => void claudeAgent.deleteChat(chatId),
    // A detached window has no opener permission of its own (panels.json), so
    // its links come here. Only web links: nothing else belongs in a browser.
    onAgentOpenLink: (url) => {
      if (/^https?:\/\//i.test(url)) void openExternal(url);
    },
    // Rust's dialog, opened from this window whichever one was clicked:
    // panel windows may open no dialog. The store adds the pick to the chat
    // and puts a refusal or the cap in view.folderNotice.
    onAgentAddFolder: (near) => void claudeAgent.pickFolder({ near, addToChat: true }),
    onAgentRemoveFolder: (path) => void claudeAgent.removeFolder(path),
  };

  const dockHost = useDockHost({
    data: dockData,
    handlers: dockHandlers,
    projectName: currentProjectName,
    onSelectTab: selectRightDockTab,
    // The panel windows belong to the main window. A window a tab was moved
    // into joining their bus would take them over (rule 44).
    enabled: !isSecondaryWindow,
  });

  /** Panels still in the dock. The rest are showing in a window of their own. */
  const dockedPanels = DETACHABLE_PANELS.filter(
    (panel) => !dockHost.detachedPanels.includes(panel) && (panel !== 'agent' || agentEnabled)
  );
  /** True when there is nothing left in the dock to show. */
  const wholeDockDetached = dockedPanels.length === 0;

  /**
   * Show a tab, wherever it lives now.
   *
   * In the dock that means opening the dock on it; in a detached window it means
   * bringing that window forward and letting the snapshot's tabRequest do the
   * rest. Both, because a single panel can be detached while the dock stays.
   */
  const revealDockTab = (tab: RightDockTab) => {
    setTabRequest((current) => ({ tab, token: (current?.token ?? 0) + 1 }));
    if (dockHost.detachedPanels.includes(tab)) {
      const group = dockHost.detachedGroups.includes(PANEL_GROUP_ALL) ? PANEL_GROUP_ALL : tab;
      void dockHost.focus(group);
      return;
    }
    selectRightDockTab(tab);
    setRightDockOpen(true);
  };

  /**
   * Detach, and say so when it did not happen.
   *
   * On the desktop this only fails if the window could not be created. In a
   * browser it fails when the popup blocker takes the window, which looks
   * exactly like nothing happening unless somebody says otherwise.
   */
  const detachPanels = (group: Parameters<typeof dockHost.detach>[0]) => {
    // Panel windows have one label each (panel-dock, panel-layers), so they
    // belong to the main window, and a second editor window would take them
    // over from it.
    if (isSecondaryWindow) {
      toast({
        title: 'Panels open in a window of their own from the main window',
        description: 'Move this tab to the main window to take its panels out.',
      });
      return;
    }
    void dockHost.detach(group).then((opened) => {
      if (opened) return;
      toast({
        title: 'That window could not be opened',
        description: isTauri()
          ? 'Something stopped the panel window from opening. Try again.'
          : 'Your browser blocked the pop-up. Allow pop-ups for this site, then try again.',
        variant: 'destructive',
      });
    });
  };

  // Which display the editor window itself is on, for the "Move editor to
  // display" list. Read when the menu opens, because a display can be plugged
  // in, unplugged or rearranged while the app is running.
  const [editorMonitorId, setEditorMonitorId] = useState<string | null>(null);
  const refreshWindowMenu = async () => {
    const list = await dockHost.refreshMonitors();
    setEditorMonitorId((await monitorOfWindow('main', list))?.id ?? null);
  };

  // Base first, then the export languages in project order. The base entry's
  // code must be null, because the pill row compares it to activeLocale.
  const previewLocaleOptions = useMemo<PreviewLocaleOption[]>(() => {
    if (!hasLocales(artboards)) return [];
    return [
      { code: null, label: localeName(getBaseLocale(artboards)) },
      ...getProjectLocales(artboards).map((entry) => ({ code: entry.code, label: localeName(entry.code) })),
    ];
  }, [artboards]);

  // What a "Selected artboard only" export would produce. Format is detected
  // from this one board, not from the project, so a mixed project reports the
  // selected board's own device correctly.
  const activeArtboardSummary = useMemo(() => {
    if (!activeArtboard) return null;
    const format = detectArtboardsFormat([activeArtboard]);
    return {
      name: activeArtboard.name,
      size: activeArtboard.size,
      format: format === 'mixed' ? null : format,
      creative: isCreativeBoard(activeArtboard),
    };
  }, [activeArtboard]);


  // Copy, for the keyboard and the context menu. The menu passes what was
  // right-clicked: the whole selection when that layer is part of it (a group
  // always is), the one layer otherwise, as Move to tab decides. The keyboard
  // passes nothing and takes the selection. What is copied can be pasted into
  // any project, in this window or another (elementClipboard.ts). Read through
  // the refs, because the keyboard listener can be a few renders old.
  const handleCopyElement = (targetArtboardId?: string | null, targetElementId?: string | null) => {
    const artboardId = targetArtboardId ?? activeArtboardIdRef.current;
    const board = artboardsRef.current.find((ab) => ab.id === artboardId);
    if (!board) return;
    const selection = selectedElementIdsRef.current;
    const wanted = targetElementId && !selection.includes(targetElementId) ? [targetElementId] : selection;
    const transfer = pickElements(board, wanted);
    if (!transfer) return;
    writeElementClipboard({
      transfer,
      source: { projectId: loadedProjectIdRef.current, projectName: projectNameRef.current, artboardId: board.id },
      copiedAt: Date.now(),
    });
    const count = transfer.elements.length;
    toast({
      title: 'Copied',
      description:
        count === 1
          ? `${getElementDisplayName(transfer.elements[0])}. Paste it into any project`
          : `${count} layers. Paste them into any project`,
    });
  };

  // Delete for the context menu. Takes its target the same way Copy does,
  // because the right-clicked element is not necessarily the selected one and
  // it can live on a board other than the active one. handleDeleteSelected
  // (the Delete key) deliberately stays as it is: with nothing selected it
  // falls through to deleting the whole artboard, which is not something a
  // menu item labelled Delete should ever do.
  const handleDeleteElement = (targetArtboardId?: string | null, targetElementId?: string | null) => {
    const artboardId = targetArtboardId ?? activeArtboardId;
    const elementId = targetElementId ?? selectedElementIdOnActiveArtboard;
    if (!artboardId || !elementId) return;

    const element = artboards.find(ab => ab.id === artboardId)?.elements.find(el => el.id === elementId);
    if (!element) return;

    // The component deletes the element itself (see canvasTakesCommits).
    if (!canvasTakesCommits()) return;
    const artboardComponent = artboardRefs.current[artboardId];
    if (!artboardComponent?.deleteElementByIdG) {
      toast({ title: "Cannot Delete Element", description: "Artboard component reference not found.", variant: "destructive" });
      return;
    }
    const name = getElementDisplayName(element);
    artboardComponent.deleteElementByIdG(elementId);
    if (artboardId === activeArtboardId) {
      setSelectedElementIds((ids) => ids.filter((id) => id !== elementId));
    }
    toast({ title: "Element Deleted", description: `${name} was removed from the artboard.` });
  };

  // Paste, for the keyboard and the context menu. Layers copied in this
  // project, in another one or in another window all land through the transfer
  // Move to tab uses (tabs/transfer.ts): their translations come along into the
  // languages this project has, rewritten in its base language, and a group
  // stays a group. The context menu passes the right-clicked artboard and a
  // point to centre them on. The keyboard puts them just below and to the right
  // of the originals on the artboard they came from, and in the same place
  // relative to the edges on any other. Both are about where the layers are
  // drawn in the language on screen, which can give them boxes of their own.
  const handlePasteElement = (targetArtboardId?: string | null, pastePoint?: Point | null) => {
    const clip = readElementClipboard();
    if (!clip) return;
    const artboardId = targetArtboardId ?? activeArtboardIdRef.current;
    if (!artboardsRef.current.some((ab) => ab.id === artboardId)) {
      toast({ title: 'Select an artboard to paste into' });
      return;
    }
    const { transfer, source } = clip;
    const paste = () => {
      const boards = artboardsRef.current;
      const board = boards.find((ab) => ab.id === artboardId);
      if (!board) return;
      const fromHere = source.projectId !== null && source.projectId === loadedProjectIdRef.current;
      const beside = !pastePoint && fromHere && source.artboardId === board.id;
      const placed = placeElements(board, transfer, {
        locales: new Set(getProjectLocales(boards).map((entry) => entry.code)),
        baseLocale: baseLocaleOf(boards),
        at: pastePoint ?? undefined,
        offset: beside ? { x: 20, y: 20 } : undefined,
        viewLocale: activeLocaleRef.current,
      });
      const count = placed.placedIds.length;
      const what = count === 1 ? getElementDisplayName(transfer.elements[0]) : `${count} layers`;
      const landed = handleArtboardsUpdateRef.current(
        boards.map((ab) => (ab.id === board.id ? placed.board : ab)),
        namedChange('Paste', 'copy', what)
      );
      if (!landed) return;
      if (board.id !== activeArtboardIdRef.current) setActiveArtboardId(board.id);
      setSelectedElementIds(placed.placedIds);
      toast({
        title: 'Pasted',
        description: fromHere ? what : `${what} from ${source.projectName || 'Untitled project'}`,
      });
    };
    // Layers from a project with another base language have their text
    // measured in this one's, and the size it fits at is kept: a face that is
    // not on the page yet first (transferFonts.ts), such as a font imported in
    // another window after this one started.
    const faces = whenFacesLoaded(textFacesOf(transfer.elements, transfer.localized, transfer.locales));
    if (!faces) {
      paste();
      return;
    }
    const serial = canvasSerialRef.current;
    void faces.then(() => {
      // Another document went on the canvas meanwhile. The paste was for the one before.
      if (canvasSerialRef.current === serial) paste();
    });
  };

  // Custom right-click: block the browser menu everywhere in the studio (text
  // fields keep the native menu so text copy/paste still works) and open our
  // menu when the click lands in the canvas area. Right-clicking an element
  // selects it first, like every design tool.
  const openCanvasContextMenu = useCallback((clientX: number, clientY: number, target: HTMLElement | null) => {
    if (isPreviewOpen) return;
    if (!target || !canvasContainerRef.current?.contains(target)) {
      setContextMenu(null);
      return;
    }

    const elementNode = target.closest('[data-element-id]');
    // A neighbour's element continuing onto this artboard is that element, on
    // the artboard it belongs to, which is where the menu has to act.
    const spanCopyNode = target.closest('[data-span-of]');
    const artboardNode = target.closest('[data-artboard-dom-id]');
    const elementId =
      spanCopyNode?.getAttribute('data-span-of') ?? elementNode?.getAttribute('data-element-id') ?? null;
    const artboardId =
      spanCopyNode?.getAttribute('data-span-source') ?? artboardNode?.getAttribute('data-artboard-dom-id') ?? null;

    // Convert the click to artboard coordinates via the rendered size, which
    // already includes the display scale and every ancestor zoom transform.
    let pastePoint: Point | null = null;
    if (artboardNode) {
      const rect = artboardNode.getBoundingClientRect();
      const originalWidth = Number(artboardNode.getAttribute('data-original-width'));
      if (rect.width > 0 && originalWidth > 0) {
        const renderedScale = rect.width / originalWidth;
        // Measured on the artboard drawing the copy, so moved back into the
        // pixels of the artboard a paste will land on.
        const shift = Number(spanCopyNode?.getAttribute('data-span-shift')) || 0;
        pastePoint = {
          x: (clientX - rect.left) / renderedScale - shift,
          y: (clientY - rect.top) / renderedScale,
        };
      }
    }

    if (artboardId) {
      setActiveArtboardId(artboardId);
      // A right-click INSIDE an existing selection leaves it alone, so the
      // menu's Group can act on what is already picked. Anywhere else it
      // selects what was clicked, which is what every other design tool does.
      if (!elementId || !selectedElementIdsRef.current.includes(elementId)) {
        handleElementSelectionOnArtboard(elementId);
      }
    }
    setContextMenu({ x: clientX, y: clientY, elementId, artboardId, pastePoint });
  }, [isPreviewOpen, handleElementSelectionOnArtboard]);

  // A press anywhere outside the Agent panel hands the keyboard back to the
  // canvas. The canvas prevents the default on pointerdown, so neither focus
  // nor a text selection leaves the chat by itself: a chat button kept focus
  // after a click on an element (Delete and the arrow keys then did nothing,
  // and Space pressed that button again), and Cmd+C kept copying old chat text.
  useEffect(() => {
    const handBack = (e: PointerEvent) => {
      if (isInAgentPanel(e.target)) return;
      const focused = document.activeElement;
      if (focused instanceof HTMLElement && isInAgentPanel(focused)) focused.blur();
      if (hasAgentPanelSelection()) window.getSelection()?.removeAllRanges();
    };
    document.addEventListener('pointerdown', handBack, true);
    return () => document.removeEventListener('pointerdown', handBack, true);
  }, []);

  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target.isContentEditable ||
        isInAgentPanel(target)
      ) {
        return;
      }
      e.preventDefault();
      openCanvasContextMenu(e.clientX, e.clientY, target);
    };

    document.addEventListener('contextmenu', handleContextMenu);
    return () => document.removeEventListener('contextmenu', handleContextMenu);
  }, [openCanvasContextMenu]);

  /**
   * The touch way into that same menu. A finger has no right button, and iOS
   * Safari does not fire `contextmenu` on a long press, so the press is timed
   * here. Any movement (a scroll, a drag of the element under the finger) or a
   * second finger (a pinch) calls it off, so this only fires on a press that
   * really was a press and stayed put.
   */
  useEffect(() => {
    const container = canvasContainerRef.current;
    if (!container) return;

    let timer: number | null = null;
    let origin: { x: number; y: number; pointerId: number } | null = null;

    const clear = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = null;
      origin = null;
    };

    const handlePointerDown = (e: PointerEvent) => {
      if (e.pointerType === 'mouse') return; // right-click already covers this
      if (!e.isPrimary) { clear(); return; } // a second finger is a pinch
      const target = e.target as HTMLElement;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target.isContentEditable
      ) {
        return;
      }
      origin = { x: e.clientX, y: e.clientY, pointerId: e.pointerId };
      timer = window.setTimeout(() => {
        const held = origin;
        clear();
        if (held) openCanvasContextMenu(held.x, held.y, document.elementFromPoint(held.x, held.y) as HTMLElement | null);
      }, LONG_PRESS_MS);
    };

    const handlePointerMove = (e: PointerEvent) => {
      if (!origin || e.pointerId !== origin.pointerId) return;
      if (Math.abs(e.clientX - origin.x) > LONG_PRESS_SLOP_PX || Math.abs(e.clientY - origin.y) > LONG_PRESS_SLOP_PX) {
        clear();
      }
    };

    container.addEventListener('pointerdown', handlePointerDown);
    container.addEventListener('pointermove', handlePointerMove);
    container.addEventListener('pointerup', clear);
    container.addEventListener('pointercancel', clear);
    return () => {
      clear();
      container.removeEventListener('pointerdown', handlePointerDown);
      container.removeEventListener('pointermove', handlePointerMove);
      container.removeEventListener('pointerup', clear);
      container.removeEventListener('pointercancel', clear);
    };
  }, [openCanvasContextMenu]);
  

  // Common function to load project data and apply positioning
  const loadProjectFromData = async (projectData: ArtboardState[], projectName: string, projectId: string) => {
    // A project keeps at least one artboard (see canOpenAsProject), so a
    // document with none is refused before anything is stored. The callers
    // report the false; the headless bridge returns it to the CLI.
    if (!canOpenAsProject(projectData)) {
      console.warn(`Not opening "${projectName}": it has no artboards.`);
      return false;
    }
    // One window writes a project, so its lock comes before the row is
    // written or the canvas shows it. Another window holding it throws
    // ProjectOpenElsewhereError to whoever asked, which is how the account,
    // cloud and live session opens know to ask instead of reporting a failure.
    await claimProject(projectId, projectName);
    // A tab of this project that leaves for another window meanwhile stops
    // the open before it writes the row or reaches the canvas (stopOpening).
    const open = beginOpen(projectId);
    try {
      return await openProjectData(projectData, projectName, projectId, open.stopped);
    } finally {
      open.end();
      settleLock(projectId);
    }
  };

  const openProjectData = async (
    projectData: ArtboardState[],
    projectName: string,
    projectId: string,
    stopped: () => boolean
  ) => {
    try {
      // The outgoing project may still have a debounced save pending.
      flushProjectSave();
      
      // Apply proper positioning to the artboards. externalizeInlineMedia keeps
      // inline base64 media out of the in-memory state this seeds (issue #19);
      // it is a no-op pass-through when the data already carries references.
      console.log("Loading project data with positioning for:", projectName);
      const finalArtboards = calculateArtboardPositions(
        normalizeLocalization(
          ensureUniqueElementIds(await externalizeInlineMedia(migrateVideoDevices(projectData)))
        )
      );
      console.log("Final artboards with positions:", finalArtboards.map((ab: ArtboardState) => ({ id: ab.id, position: ab.position })));

      // Store what the canvas is about to show. Most callers wrote a row a
      // moment ago, before the passes above; the headless bridge hands in a
      // document that has no row at all, and a project without one is missing
      // from Recent projects and cannot be reopened. An existing row keeps its
      // timestamp and its other fields, because opening a project is not an
      // edit.
      const stored = await db.projects.get(projectId);
      if (stopped()) return false;
      await db.projects.put({
        ...stored,
        id: projectId,
        name: projectName,
        timestamp: stored?.timestamp ?? new Date(),
        projectData: JSON.parse(JSON.stringify(finalArtboards)),
      });
      // The document is replaced and the undo stack starts over, so a stack
      // kept for the one it replaces has nothing left to undo into.
      if (stored) void undoStore.remove(projectId).catch(() => {});
      // An edit made to this same project while the passes above ran is
      // replaced by the document being opened, and its waiting save would
      // write it back over the row stored just now. A waiting save of the
      // project being left is written by putProjectOnCanvas below.
      projectSaves.drop(projectId);
      if (stopped()) return false;

      // Set project details first to avoid triggering effects
      setCurrentProjectName(projectName);
      // Before the id, so the loader effect does not read this project back
      // over the document set below.
      putProjectOnCanvas(projectId);
      setActiveProjectId(projectId);
      // Every open path funnels through here, which is what makes this the one
      // place the cloud auto saver has to be re-armed from, and the one place
      // that can hold on to the state a project was opened in.
      setProjectOpenToken((token) => token + 1);
      openedSnapshotRef.current = { projectId, boards: finalArtboards, name: projectName };
      
      // Set artboards and history without triggering handleArtboardsUpdate
      setArtboards(finalArtboards);
      setHistory([makeHistoryEntry(finalArtboards, namedChange('Open', 'open', projectName))]);
      setHistoryIndex(0);
      
      // Automatically select the first artboard
      setActiveArtboardId(finalArtboards.length > 0 ? finalArtboards[0].id : null);
      setSelectedElementIdOnActiveArtboard(null);
      setIsTemplateSelectorOpen(false);

      // Update URL with new project ID. Here, with the canvas, not after the
      // read below: a tab that leaves for another window during that read
      // takes the canvas to the next tab, and the address bar has to follow.
      if (typeof window !== "undefined") {
        const params = new URLSearchParams(window.location.search);
        params.set("projectId", projectId);
        window.history.replaceState({}, "", `${window.location.pathname}?${params.toString()}`);
      }

      // Update recent projects list
      setRecentProjects(await fetchRecentProjectMetas());

      return true; // Success
    } catch (error) {
      console.error("Error loading project data:", error);
      return false; // Failure
    }
  };

  /**
   * Import project from JSON.
   *
   * Reported step by step, the same way opening from an account or the cloud is
   * (handleOpenFromAccount): an exported file carries its screen recordings and
   * imported fonts inline as base64, so reading it, decoding them and writing
   * them into IndexedDB is a wait of the same order as a download. Without the
   * bar and the overlay the canvas sits on the outgoing project saying nothing.
   */
  const handleImportProjectFromJSON = () => {
    // Create a hidden file input element
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.json';
    fileInput.style.display = 'none';
    
    fileInput.onchange = async (event) => {
      const file = (event.target as HTMLInputElement).files?.[0];
      if (!file) return;

      // The file names the project until the manifest can.
      const fileName = file.name.replace(/\.json$/i, '');
      setLoadPhase('project');
      setProjectLoadStatus({ name: fileName, step: 'Reading the file', ratio: 0 });
      try {
        const fileContent = await file.text();
        setProjectLoadStatus({ name: fileName, step: 'Restoring media and fonts', ratio: 0.25 });
        // Two frames, so that step is on screen before the parse and the base64
        // decode take the main thread for as long as the file is large.
        await new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve))
        );
        // bundleFromJson validates the shape and restores any bundled media and
        // fonts. It still accepts files written before either travelled with
        // the JSON, so older exports keep importing.
        const bundle = bundleFromJson(JSON.parse(fileContent));

        const importedName = bundle.manifest.name || `Imported ${bundle.manifest.id}`;
        // importBundle counts its fonts and media from 0 to 1 of its own; the
        // read and the decode already spent the first third of the bar, and the
        // last slice belongs to building the artboards, so the bar only ever
        // moves forward. Same split the account loader uses.
        const install = splitProgress(
          (step, ratio) => setProjectLoadStatus({ name: importedName, step, ratio }),
          { downloadTo: 0.3, installTo: 0.95 }
        ).install;
        const imported = await importBundle(bundle, {
          // A fresh id keeps an import from overwriting the project it came from.
          projectId: `imported_${Date.now()}`,
          name: importedName,
          onProgress: install,
        });

        setProjectLoadStatus({ name: imported.name, step: 'Preparing artboards', ratio: 0.97 });
        const success = await loadProjectFromData(
          imported.projectData,
          imported.name,
          imported.id
        );

        if (success) {
          toast({
            title: "Project Imported",
            description: `Project "${importedName}" has been imported successfully.`,
            variant: "default",
          });
        } else {
          toast({
            title: "Import Failed",
            description: "There was an error loading the imported project.",
            variant: "destructive",
          });
        }

      } catch (error) {
        console.error("Error importing project:", error);
        toast({
          title: "Import Failed",
          description: error instanceof Error ? error.message : "There was an error reading or parsing the JSON file.",
          variant: "destructive",
        });
      } finally {
        setLoadPhase('idle');
        setProjectLoadStatus(null);
      }
    };

    // Append to body, click, and remove
    document.body.appendChild(fileInput);
    fileInput.click();
    document.body.removeChild(fileInput);
  };

  // Function to generate random project names
const generateRandomProjectName = (): string => {
  const adjectives = [
    'Creative', 'Modern', 'Sleek', 'Bold', 'Elegant', 'Dynamic', 'Fresh', 'Vibrant',
    'Minimal', 'Classic', 'Artistic', 'Professional', 'Stylish', 'Innovative', 'Clean',
    'Bright', 'Cool', 'Warm', 'Sharp', 'Smooth'
  ];
  
  const nouns = [
    'Design', 'Project', 'Studio', 'Canvas', 'Vision', 'Concept', 'Layout', 'Draft',
    'Sketch', 'Mockup', 'Template', 'Framework', 'Blueprint', 'Creation', 'Work',
    'Portfolio', 'Collection', 'Gallery', 'Showcase', 'Board'
  ];
  
  const adjective = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  const number = Math.floor(Math.random() * 1000) + 1;
  
  return `${adjective} ${noun} ${number}`;
};

  // Rendered as an overlay INSIDE the main layout, never as an early return:
  // swapping the whole tree for this dialog used to unmount the palette and
  // canvas (losing tab/drill-in/selection state) whenever the flag flickered
  // during project creation/loading.
  // The tab currently shown in the template picker, and per-category counts for
  // the tab badges. A blank canvas started from this dialog uses the active
  // category's defaultSize (phone screenshot vs 1024×500 feature graphic).
  const activeCategory =
    TEMPLATE_CATEGORIES.find((c) => c.id === templateTab) ?? TEMPLATE_CATEGORIES[0];

  /**
   * Hand a new design to Claude Code or Codex: an empty project for it to work
   * in, the screenshots stored as assets it can place by reference, the Agent
   * tab open on a chat that holds the code folders picked there (Claude Code
   * only), and the first message on its way. Throws a sentence the agent
   * screen shows when there is no project to work in.
   */
  const handleStartClaudeCode = async ({
    instruction,
    screenshots,
    folders: pickedFolders = [],
    agent = 'claude-code',
  }: {
    instruction: string;
    screenshots: UploadedScreenshot[];
    folders?: AgentFolder[];
    agent?: AgentKind;
  }) => {
    // Codex reads no code folder, so a run with it starts without one.
    const folders = agent === 'codex' ? [] : pickedFolders;
    let created: Awaited<ReturnType<typeof createProjectFromTemplateData>>;
    let stored: { ref: string; width: number; height: number; fileName: string }[];
    claudeStartingRef.current = true;
    try {
      // Stored first: if one will not decode, nothing has been made yet and the
      // user is still on the agent screen with everything they entered.
      stored = await Promise.all(
        screenshots.map(async (shot) => {
          const asset = await saveImageAsset(shot.dataUrl, { name: shot.fileName });
          return { ref: asset.ref, width: shot.width, height: shot.height, fileName: shot.fileName };
        })
      );
      created = await createProjectFromTemplateData(
        createBlankProject(pickCanvasSize(screenshots, activeCategory.defaultSize)),
        { nameOverride: projectNameFromInstruction(instruction) }
      );
    } finally {
      claudeStartingRef.current = false;
    }
    if (!created) throw new Error('The new project could not be made. Try again.');

    claudeAgent.setPanelEnabled(true);
    revealDockTab('agent');
    if (isMobileViewport) setIsMobileDockOpen(true);
    // Counts only: never a folder's name or path.
    if (agent === 'codex') track('agent_codex_start', { screenshots: screenshots.length });
    else track('agent_claude_code_start', { screenshots: screenshots.length, folders: folders.length });

    claudeAgent.setChatAgent(agent);
    await claudeAgent.newChat({ projectId: created.projectId, projectName: created.name }, { folders, agent });
    // What the chat really holds: at most three, one per path.
    const chatFolders = claudeAgent.getSnapshot().chat.folders;
    const board = created.artboards[0];
    void claudeAgent
      .send({
        // The words the user sees go on screen before the start, so they name
        // every folder they gave.
        text: instruction || defaultStartText({ screenshots: screenshots.length, folders: chatFolders.length }),
        // The brief waits for the start: a folder Rust refused then (moved,
        // deleted, forgotten) is never named to the agent as readable.
        preface: (granted) =>
          buildFirstRunBrief({
            projectName: created.name,
            placeholderName: created.name === PLACEHOLDER_PROJECT_NAME,
            artboard: board ? { id: board.id, width: board.size.width, height: board.size.height } : null,
            screenshots: stored,
            folders: granted,
          }),
        images: screenshots.map(screenshotToImage),
        skipContext: true,
      })
      .catch((error) => console.error(`Could not start ${agent === 'codex' ? 'Codex' : 'Claude Code'}`, error));
  };
  const templateCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const p of availableProjects) {
      if (p.category) counts[p.category] = (counts[p.category] ?? 0) + 1;
    }
    return counts;
  }, [availableProjects]);

  /**
   * Which project ids exist on this device.
   *
   * The cloud list uses it to mark the overlap and to default that row's Open to
   * "open a copy", so pulling a project down cannot quietly replace the version
   * somebody has been editing here all morning.
   */
  const localProjectIds = useMemo(
    () => new Set(recentProjects.map((project) => project.id)),
    [recentProjects]
  );

  // Name filter for the recent-projects list in the same dialog.
  const filteredRecentProjects = useMemo(() => {
    const query = recentProjectSearch.trim().toLowerCase();
    if (!query) return recentProjects;
    return recentProjects.filter((p) => p.name.toLowerCase().includes(query));
  }, [recentProjects, recentProjectSearch]);

  const templateSelectorDialog = (
      <>
        <Dialog
          // Held back while the tips wizard, the account dialog or Discover is
          // up, so they never stack into a double overlay. Each of those is
          // opened from in here (the tips wizard's Connect storage button, the
          // community tab's own buttons), and this dialog reappears untouched
          // as soon as they close: a controlled `open` change does not run
          // onOpenChange below.
          open={
            isTemplateSelectorOpen &&
            !isTipsOpen &&
            !isAccountOpen &&
            !isDiscoverOpen &&
            !isOpeningSharedLink &&
            !isJoiningInvite &&
            // A project asked for is open in another window: that question
            // comes first, and the start dialog only if it is turned down.
            !projectElsewhere
          }
          onOpenChange={(newOpenState) => {
            if (!newOpenState && claudeStartingRef.current) return;
            // Dismissed, so the + button's new tab is not happening.
            if (!newOpenState) projectTabs.dropNewTabRequest();
            if (!newOpenState && artboards.length === 0) {
              // Tabs from last time and nothing on the canvas: back to the
              // tab used last, rather than a blank project nobody asked for.
              const resume = [...projectTabs.getTabs()].sort((a, b) => b.lastActiveAt - a.lastActiveAt)[0];
              if (resume) {
                activateTab(resume.projectId);
              } else if (availableProjects.length > 0) {
                // Create a blank project when no template is selected
                handleSelectTemplate(createBlankProject(activeCategory.defaultSize));
              }
            }
            setIsTemplateSelectorOpen(newOpenState);
            if (newOpenState) setDialogView('templates');
            // --- 3. Remove projectId from URL when template selector is opened ---
            if (typeof window !== "undefined" && newOpenState) {
              const params = new URLSearchParams(window.location.search);
              params.delete("projectId");
              window.history.replaceState({}, "", `${window.location.pathname}${params.toString() ? "?" + params.toString() : ""}`);
            }
          }}
        >
          <DialogContent className="flex max-h-[92vh] w-[95vw] max-w-[1400px] flex-col">
            {/* Every part of this dialog is a drop target, so somebody browsing
                templates who drags their screenshots in does not have to find
                the right card first. Off on the agent screen, which runs its
                own intake. */}
            <DialogDropLayer
              active={dialogView !== 'agent'}
              onFiles={(files) => {
                // Stay on the graphics screen if that is where the drop landed;
                // bouncing to the screenshot deck would throw away the format
                // and colour the user had already chosen.
                const target = dialogView === 'graphics' ? 'graphics' : 'quickstart';
                setPendingIntakeFiles({ files, token: Date.now(), target });
                if (target === 'quickstart') setDialogView('quickstart');
              }}
            >
            {dialogView === 'agent' || dialogView === 'quickstart' || dialogView === 'graphics' ? (
              <DialogHeader>
                <div className="flex items-start gap-2">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="-ml-2 h-8 w-8 shrink-0"
                    onClick={() =>
                      setDialogView(dialogView === 'agent' ? agentReturnView : 'templates')
                    }
                    aria-label="Back"
                  >
                    <ChevronLeftIcon className="h-4 w-4" />
                  </Button>
                  <div className="min-w-0 flex-1 text-left">
                    <DialogTitle>
                      {dialogView === 'agent'
                        ? 'Design with the AI agent'
                        : dialogView === 'graphics'
                          ? 'Social graphics from your screenshots'
                          : 'Start from your screenshots'}
                    </DialogTitle>
                    <DialogDescription>
                      {dialogView === 'agent'
                        ? 'Upload your screenshots, say what you want, and let the agent build the project.'
                        : dialogView === 'graphics'
                          ? 'Pick a size and every style is drawn at it, with your own screens inside. Open one to edit it.'
                          : 'Drop them in and every design that fits shows your own screens. Pick one to open it.'}
                    </DialogDescription>
                  </div>
                </div>
              </DialogHeader>
            ) : (
              // The two entry cards below say all of this, so the heading is only
              // kept for the dialog's accessible name. sr-only takes it out of
              // flow, so it costs no vertical space either.
              <>
                <DialogTitle className="sr-only">Start a new project</DialogTitle>
                <DialogDescription className="sr-only">
                  Let the AI agent build it, choose a template, or start with a blank canvas.
                </DialogDescription>
              </>
            )}

            {dialogView === 'agent' && (
              // Native overflow container, not Radix ScrollArea: a ScrollArea
              // sized with flex-1 under a max-h parent silently stops scrolling.
              <div className="min-h-0 flex-1 overflow-y-auto px-1 pb-1">
                <AgentStartScreen
                  templates={availableProjects}
                  isLoadingTemplates={isLoadingProjects}
                  onCreateProject={(project, options) => handleSelectTemplate(project, options)}
                  handoffScreenshots={agentHandoff?.shots}
                  handoffToken={agentHandoff?.token}
                  onStartClaudeCode={handleStartClaudeCode}
                />
              </div>
            )}

            {/* Kept MOUNTED once it has been opened, and hidden rather than
                unmounted while another view is up. Everything the user has done
                here lives in its own state: the uploaded set, the order they
                put it in, the app name, the colour. Unmounting to look at the
                AI screen and coming back to an empty drop zone is the whole
                reason this is not a plain conditional. */}
            {quickstartOpened && (
              // Same native scroll container as the agent view, for the same
              // reason: a Radix ScrollArea cannot resolve its height under
              // flex-1 inside a max-h-capped dialog and stops scrolling.
              <div
                className={
                  dialogView === 'quickstart'
                    ? 'min-h-0 flex-1 overflow-y-auto px-1 pb-1'
                    : 'hidden'
                }
              >
                <QuickStartScreen
                  active={dialogView === 'quickstart'}
                  templates={availableProjects}
                  isLoadingTemplates={isLoadingProjects}
                  onCreateProject={(project, options) => handleSelectTemplate(project, options)}
                  pendingFiles={pendingIntakeFiles?.target === 'quickstart' ? pendingIntakeFiles : null}
                  onPendingFilesConsumed={() => setPendingIntakeFiles(null)}
                  onHandOffToAgent={(shots) => {
                    // Carry the upload across. Switching to the agent used to
                    // mean uploading everything a second time.
                    setAgentHandoff({ shots, token: Date.now() });
                    setAgentReturnView('quickstart');
                    setDialogView('agent');
                  }}
                  onBrowseAll={() => setDialogView('templates')}
                />
              </div>
            )}

            {/* Kept mounted once opened, and hidden rather than unmounted, for
                the same reason the quick start above it is: the uploaded set,
                the app name, the colour and the chosen format all live in its
                own state. A native overflow container, never a Radix
                ScrollArea, which cannot resolve its height under flex-1 inside
                a max-h dialog and silently stops scrolling. */}
            {graphicsOpened && (
              <div
                className={
                  dialogView === 'graphics'
                    ? 'min-h-0 flex-1 overflow-y-auto px-1 pb-1'
                    : 'hidden'
                }
              >
                <GraphicsStartScreen
                  active={dialogView === 'graphics'}
                  onCreateProject={(project, options) => handleSelectTemplate(project, options)}
                  pendingFiles={pendingIntakeFiles?.target === 'graphics' ? pendingIntakeFiles : null}
                  onPendingFilesConsumed={() => setPendingIntakeFiles(null)}
                />
              </div>
            )}

            {dialogView === 'templates' && (
            <Tabs value={templateTab} onValueChange={setTemplateTab} className="flex min-h-0 flex-1 flex-col">
              <TabsList className="mx-1 self-start">
                {/* Community leads the row, and the dialog opens on it: what
                    somebody else shipped answers "what should mine look like"
                    better than a grid of empty templates does. */}
                {HAS_DISCOVER && (
                  <TabsTrigger value={COMMUNITY_TAB_ID} className="gap-1.5">
                    <CompassIcon className="h-4 w-4 text-primary" />
                    Community
                  </TabsTrigger>
                )}
                {TEMPLATE_CATEGORIES.map((cat) => (
                  <TabsTrigger key={cat.id} value={cat.id} className="gap-1.5">
                    {cat.label}
                    <span className="inline-flex min-w-[1.25rem] items-center justify-center rounded-full border px-1 text-[11px] tabular-nums text-muted-foreground">
                      {isLoadingProjects ? '…' : (templateCounts[cat.id] ?? 0)}
                    </span>
                  </TabsTrigger>
                ))}
              </TabsList>

              {HAS_DISCOVER && (
              <TabsContent
                value={COMMUNITY_TAB_ID}
                className="mt-2 min-h-0 flex-1 flex-col data-[state=active]:flex"
              >
                <CommunityStartPanel
                  templates={availableProjects}
                  isLoadingTemplates={isLoadingProjects}
                  onUseTemplate={(post) => void handleUseDiscoverPost(post)}
                  onOpenPost={(post) => {
                    setDiscoverPostId(post.id);
                    openDiscover('feed');
                  }}
                  onOpenFeed={() => openDiscover('feed')}
                  onShare={() => openDiscover('share')}
                  canShare={artboards.length > 0}
                  onRequestSignIn={openAccountDialog}
                />
              </TabsContent>
              )}
              {/* data-[state=active]:flex, not a bare flex: inactive panels stay
                  mounted with the hidden attribute, and a bare `flex` overrides
                  [hidden]{display:none}, so each ghost panel's mt-2 leaked ~8px of
                  dead space below the gallery. Gating display on the active state
                  lets hidden win and collapses them. */}
              {TEMPLATE_CATEGORIES.map((cat) => (
                <TabsContent key={cat.id} value={cat.id} className="mt-2 min-h-0 flex-1 flex-col data-[state=active]:flex">
                  <TemplateGallery
                    projects={availableProjects.filter((p) => p.category === cat.id)}
                    onSelect={handleSelectTemplate}
                    isLoading={isLoadingProjects}
                    previewAspect={cat.previewAspect}
                    previewFit={cat.previewFit}
                    gridClassName={cat.gridClassName}
                    emptyState={
                      <div className="flex flex-col items-center justify-center gap-3 py-12 text-center">
                        <p className="max-w-sm text-sm text-muted-foreground">
                          {`No ${cat.label} templates yet.`}{cat.blurb ? ` ${cat.blurb}` : ''}
                        </p>
                        <Button variant="outline" onClick={() => handleSelectTemplate(createBlankProject(cat.defaultSize))}>
                          {`Start blank (${cat.defaultSize.width} × ${cat.defaultSize.height})`}
                        </Button>
                      </div>
                    }
                  />
                </TabsContent>
              ))}
            </Tabs>
            )}

            {/* The agent screen needs the full dialog height for its own content. */}
            {dialogView === 'templates' && (
            <div className="grid shrink-0 items-stretch gap-4 border-t p-4 md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
              {/* Recent projects, laid out in two columns so they take less height. */}
              <div className="min-w-0">
                <div className="mb-2 flex items-center gap-2">
                  <h3 className="shrink-0 text-lg font-semibold">Recent projects</h3>
                  {recentProjects.length > 0 && (
                    <div className="relative ml-auto min-w-0 flex-1 sm:max-w-[16rem]">
                      <SearchIcon className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        placeholder="Search projects..."
                        value={recentProjectSearch}
                        onChange={(event) => setRecentProjectSearch(event.target.value)}
                        className="h-8 pl-8 text-sm"
                      />
                    </div>
                  )}
                </div>
                {recentProjects.length > 0 ? (
                  filteredRecentProjects.length > 0 ? (
                  <ScrollArea className="h-[20vh]">
                    <ul className="grid grid-cols-1 gap-1.5 pr-3 sm:grid-cols-2">
                      {filteredRecentProjects.map((project) => (
                        <li key={project.id} className="flex min-w-0 items-center justify-between gap-1 rounded-md border border-border/60 px-2 hover:bg-muted/50">
                          <div
                            className="min-w-0 flex-grow cursor-pointer py-2 hover:text-primary"
                            onClick={() => {
                              setActiveProjectId(project.id);
                              setIsTemplateSelectorOpen(false);
                              // --- 4. Set projectId in URL when selecting a project ---
                              if (typeof window !== "undefined") {
                                const params = new URLSearchParams(window.location.search);
                                params.set("projectId", project.id);
                                window.history.replaceState({}, "", `${window.location.pathname}?${params.toString()}`);
                              }
                            }}
                          >
                            <div className="truncate font-medium">{project.name}</div>
                            <div className="truncate text-xs text-muted-foreground">Saved on: {project.timestamp.toLocaleString()}</div>
                          </div>
                          {/* Enabled for the open project too, unlike Delete
                              beside it: the open one is exactly the project
                              people want a second language pass of. */}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 shrink-0"
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleDuplicateProject(project);
                            }}
                            disabled={!!duplicatingProjectId}
                            title={`Duplicate "${project.name}"`}
                          >
                            {duplicatingProjectId === project.id ? (
                              <Loader2Icon className="h-4 w-4 animate-spin" />
                            ) : (
                              <CopyIcon className="h-4 w-4" />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 shrink-0 text-destructive hover:bg-destructive/10 hover:text-destructive"
                            onClick={(e) => {
                              e.stopPropagation();
                              setProjectToDelete(project.id);
                            }}
                            // Disable delete button for the currently active project
                            disabled={project.id === activeProjectId}
                            title={project.id === activeProjectId ? "Cannot delete the currently open project" : "Delete project"}
                          >
                            <Trash2Icon className="h-4 w-4" />
                          </Button>
                        </li>
                      ))}
                    </ul>
                  </ScrollArea>
                  ) : (
                    <p className="text-sm text-muted-foreground">No projects match &quot;{recentProjectSearch}&quot;.</p>
                  )
                ) : (
                  <p className="text-sm text-muted-foreground">No recent projects found.</p>
                )}
              </div>
              {/* Four entry points, fastest first: your own screenshots into a
                  finished store design, the same screenshots into social
                  graphics, the AI agent, then an empty canvas. */}
              <div className="grid min-h-[20vh] grid-rows-4 gap-2">
                <QuickStartPromoCard onStart={() => setDialogView('quickstart')} />
                <GraphicsPromoCard onStart={() => setDialogView('graphics')} />
                <AgentPromoBanner
                  onStartAgent={() => {
                    setAgentReturnView('templates');
                    setDialogView('agent');
                  }}
                />
                <BlankCanvasCard
                  onStartBlank={() => handleSelectTemplate(createBlankProject(activeCategory.defaultSize))}
                />
              </div>
            </div>
            )}
            </DialogDropLayer>
          </DialogContent>
        </Dialog>

        {/* Alert Dialog for Project Deletion Confirmation */}
        <AlertDialog open={!!projectToDelete} onOpenChange={(open) => !open && setProjectToDelete(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Are you sure?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently delete this project. This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction 
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => projectToDelete && handleDeleteProject(projectToDelete)}
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Switching or closing the tab of a live session takes this person
            out of it, so it is asked first (confirmLeavingSession). */}
        <AlertDialog open={!!pendingSessionLeave} onOpenChange={(open) => !open && setPendingSessionLeave(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Leave the live session?</AlertDialogTitle>
              <AlertDialogDescription>
                You are editing {currentProjectName} together with others. Leaving this tab takes you out of the
                session. Everyone else stays in it.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Stay</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  const run = pendingSessionLeave?.run;
                  setPendingSessionLeave(null);
                  run?.();
                }}
              >
                {pendingSessionLeave?.action ?? 'Leave'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* A tab another window is dragging, over this one (handleTabTearMove). */}
        {incomingTab && (
          <div
            data-incoming-tab
            className="pointer-events-none fixed inset-0 z-[90] flex items-start justify-center bg-primary/10 ring-4 ring-inset ring-primary/60"
          >
            <div className="mt-16 rounded-full border bg-popover px-4 py-2 text-sm font-medium text-popover-foreground shadow-xl">
              Let go to move {incomingTab.name || 'Untitled project'} here
            </div>
          </div>
        )}

        {/* Closing tabs that have changes (confirmTabClose). */}
        <AlertDialog open={!!pendingTabClose} onOpenChange={(open) => !open && setPendingTabClose(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {pendingTabClose && pendingTabClose.projectIds.length > 1
                  ? `Close ${pendingTabClose.projectIds.length} tabs?`
                  : `Close ${pendingTabClose ? projectNameOf(pendingTabClose.projectIds[0]) : 'this tab'}?`}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {!pendingTabClose || pendingTabClose.projectIds.length === 1
                  ? 'Your changes are saved. You can reopen the tab from All open projects, with its undo history.'
                  : pendingTabClose.changed.length === 1
                    ? `${projectNameOf(pendingTabClose.changed[0])} has changes. They are saved, and you can reopen the tab from All open projects.`
                    : `${pendingTabClose.changed.length} of them have changes. They are saved, and you can reopen the tabs from All open projects.`}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="flex items-center gap-2">
              <Checkbox
                id="tab-close-stop-asking"
                checked={stopAskingOnClose}
                onCheckedChange={(value) => setStopAskingOnClose(value === true)}
              />
              <Label htmlFor="tab-close-stop-asking" className="text-sm font-normal text-muted-foreground">
                Don&apos;t ask again
              </Label>
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  const pending = pendingTabClose;
                  setPendingTabClose(null);
                  // Settings turns the question back on.
                  if (stopAskingOnClose) writePreference('confirmTabClose', false);
                  if (pending && !isExportingRef.current) pending.run();
                }}
              >
                {pendingTabClose && pendingTabClose.projectIds.length > 1 ? 'Close tabs' : 'Close tab'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* One window writes a project at a time (projectLocks.ts). */}
        <AlertDialog open={!!projectElsewhere} onOpenChange={(open) => !open && setProjectElsewhere(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>This project is open in another window</AlertDialogTitle>
              <AlertDialogDescription>
                {projectElsewhere?.name ? `${projectElsewhere.name} is` : 'It is'} being edited there. A
                project can be open in one window at a time, so its edits never overwrite each other.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              {isDesktopApp && (
                <AlertDialogAction
                  className="bg-secondary text-secondary-foreground hover:bg-secondary/80"
                  onClick={() => {
                    const target = projectElsewhere;
                    setProjectElsewhere(null);
                    if (target) {
                      tabBusRef.current?.post({ type: 'show-project', from: EDITOR_WINDOW_ID, projectId: target.projectId });
                    }
                  }}
                >
                  Show that window
                </AlertDialogAction>
              )}
              <AlertDialogAction
                onClick={() => {
                  const target = projectElsewhere;
                  setProjectElsewhere(null);
                  if (target) void takeProjectFromElsewhere(target.projectId);
                }}
              >
                Move it here
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </>
  );

  // --- Desktop MCP server: expose the design tools to external AI agents. ---
  // The Rust transport bridges each MCP request here; this object is the tool
  // implementation. Rebuilt every render so the bridge (which reads it per
  // request via the ref) always closes over the latest state and handlers.
  const resolveBoardId = (artboardId?: string) =>
    artboardId || activeArtboardId || (artboards[0]?.id ?? null);

  // Summarise artboards that are not (yet) in React state — a project the tools
  // just created or opened, whose setArtboards has not re-rendered us. Those
  // open on their first board, hence the default; pass activeId when the
  // selection is something else (e.g. after deleting a board).
  const summarizeArtboards = (boards: ArtboardState[], activeId?: string | null): McpArtboardSummary[] =>
    boards.map((ab, i) => ({
      id: ab.id,
      name: ab.name,
      width: ab.size.width,
      height: ab.size.height,
      backgroundColor: ab.backgroundColor,
      elementCount: ab.elements.length,
      active: activeId === undefined ? i === 0 : ab.id === activeId,
    }));

  // The project's languages as the MCP tools see them. `active` is a parameter
  // because set_locale answers with the state it just moved to, before React
  // has re-rendered this closure.
  const mcpLocaleState = (active: string | null = activeLocale): McpLocaleState => {
    const baseLocale = getBaseLocale(artboards);
    const toSummary = (code: string, base: boolean): McpLocaleSummary => {
      const def = getLocaleDef(code);
      const { translated, total } = localeCompletion(artboards, code);
      return {
        code,
        name: def?.name ?? code,
        nativeName: def?.nativeName ?? code,
        base,
        active: base ? active === null || active === code : active === code,
        // The base language is written, not translated, so it is always complete.
        translated: base ? total : translated,
        total,
      };
    };
    return {
      baseLocale,
      activeLocale: active,
      locales: [
        toSummary(baseLocale, true),
        ...getProjectLocales(artboards).map((entry) => toSummary(entry.code, false)),
      ],
    };
  };

  /**
   * The MCP translate path: run the engine over one or more languages against a
   * single snapshot and hand the boards back UNCOMMITTED, so the caller decides
   * whether this was the whole tool (translate_locales) or one step of a bigger
   * one (add_locales drafting the languages it just added).
   *
   * Sequential, not Promise.all, because the engines share one rate-limit
   * budget, and each language is fed the previous one's output so a single
   * commit at the end carries all of them and one undo takes all of them back.
   *
   * The progress dialog and the abort ref are the ones the app's own translate
   * buttons use: a run started from outside the app still shows the user what
   * is happening and still gives them the cancel button.
   */
  const runMcpTranslation = async (
    boards: ArtboardState[],
    locales: string[],
    options: {
      only: 'empty' | 'stale' | 'all';
      includeManual?: boolean;
      guidance?: string;
      artboardIds?: string[];
      elementIds?: string[];
    }
  ): Promise<{ artboards: ArtboardState[]; result: McpTranslateRunResult }> => {
    const engines = availableEngines();
    // Not an error here. The tool turns "no engine" into the instruction that
    // actually helps a model: write the strings yourself and send them back.
    if (engines.length === 0) {
      return { artboards: boards, result: { engine: null, runs: [], completion: [] } };
    }
    const engine = engines[0];
    const controller = new AbortController();
    translateAbortRef.current = controller;
    setIsCancellingTranslate(false);
    const runs: McpTranslateRun[] = [];
    let next = boards;
    try {
      for (const [index, locale] of locales.entries()) {
        if (controller.signal.aborted) break;
        setTranslateProgress({
          localeLabel: localeLabel(locale),
          done: 0,
          total: 0,
          localeIndex: index + 1,
          localeCount: locales.length,
          phase: 'starting',
        });
        try {
          const result = await translateIntoLocale(next, locale, {
            engine,
            only: options.only,
            includeManual: options.includeManual,
            guidance: options.guidance,
            artboardIds: options.artboardIds,
            elementIds: options.elementIds,
            signal: controller.signal,
            onProgress: (done, total) =>
              setTranslateProgress((prev) =>
                prev ? { ...prev, done, total, phase: 'translating' } : prev
              ),
          });
          next = result.artboards;
          runs.push({
            locale,
            translated: result.translated,
            failed: result.failed,
            skipped: result.skipped,
            rateLimited: result.rateLimited,
          });
        } catch (error) {
          // translateIntoLocale throws only for a setup problem, e.g. a
          // language the machine engine does not cover. One of those must not
          // cost the caller the other languages, or the languages themselves
          // when this is running inside add_locales, so it is reported per
          // language and the loop keeps going.
          console.error('Could not machine translate into', locale, error);
          runs.push({
            locale,
            translated: 0,
            failed: 0,
            skipped: 0,
            rateLimited: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    } finally {
      translateAbortRef.current = null;
      setTranslateProgress(null);
      setIsCancellingTranslate(false);
    }
    return {
      artboards: next,
      result: {
        engine,
        runs,
        completion: locales.map((locale) => ({ locale, ...localeCompletion(next, locale) })),
      },
    };
  };

  // Two frames, which is how long the canvas takes to repaint after a state
  // change. Everything an MCP tool does that the next tool call has to SEE goes
  // through this: opening a project, switching language, capturing a PNG.
  //
  // requestAnimationFrame does not fire while the window is minimized or fully
  // covered, and an agent keeps working then, so a timer ends the wait after a
  // second. React has committed the DOM by then either way, and the capture
  // reads the DOM, not the screen.
  /**
   * True once `projectId` is on the canvas, false once its open gave up (the
   * loader puts activeProjectId back when it cannot open a project).
   */
  const waitForCanvas = (projectId: string, timeoutMs = 15_000) =>
    new Promise<boolean>((resolve) => {
      const started = Date.now();
      let seen = false;
      const check = () => {
        if (loadedProjectIdRef.current === projectId) return resolve(true);
        if (activeProjectIdRef.current === projectId) seen = true;
        else if (seen) return resolve(false);
        if (Date.now() - started > timeoutMs) return resolve(false);
        window.setTimeout(check, 30);
      };
      check();
    });
  const mcpNextPaint = () =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 1_000);
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          clearTimeout(timer);
          resolve();
        })
      );
    });

  /**
   * Run a capture with the canvas showing one language, then put it back.
   *
   * `undefined` means the caller said nothing about language, so the canvas is
   * left exactly where the user had it, which is what every export did before
   * languages existed. An explicit code (or null for the base language) is a
   * round trip: the projection is a memo over `artboards`, so switching is a
   * setState plus a repaint, and the finally is what stops a failed capture
   * from leaving the editor sitting in a language nobody asked for.
   */
  const withLocaleOnCanvas = async <T,>(
    locale: string | null | undefined,
    work: () => Promise<T>
  ): Promise<T> => {
    if (locale === undefined) return work();
    const previous = activeLocaleRef.current;
    const target = !locale || locale === getBaseLocale(artboards) ? null : locale;
    if (target === previous) return work();
    if (target && !getProjectLocales(artboards).some((entry) => entry.code === target)) {
      throw new Error(`This project has no language "${target}".`);
    }
    handleSelectLocale(target);
    await mcpNextPaint();
    try {
      return await work();
    } finally {
      handleSelectLocale(previous);
    }
  };

  // Render one artboard for the MCP export tools. Same capture recipe as the
  // Export dialog (unscale the node, drop editor chrome, restore afterwards),
  // plus the two things an external agent needs: an output scale, so a proof
  // does not have to ship a full-size PNG as base64, and writing straight to
  // disk through Rust — the JS fs plugin only unlocks paths the user picked in
  // a dialog, and these exports are unattended.
  const captureArtboardForMcp = async (
    board: ArtboardState,
    options: { scale?: number; save?: boolean; directory?: string; fileName?: string; includeImage?: boolean }
  ): Promise<McpExportResult> => {
    const node = document.querySelector(`[data-artboard-dom-id="${board.id}"]`) as HTMLElement | null;
    if (!node) throw new Error('That artboard is not on screen; open the project in the app first.');
    const scale = Math.min(4, Math.max(0.1, options.scale ?? 1));

    // Unscale via the clone (the `style` option), never the live node: see
    // captureArtboardDataUrl for the on-screen overlap this used to cause.
    const { backgroundColor, backgroundImage } = artboardBackground(board);
    const dataUrl = await captureNodeToPng(node, {
      width: board.size.width,
      height: board.size.height,
      backgroundColor,
      pixelRatio: scale,
      // false for the same reason as captureArtboardDataUrl: a cache-busted
      // blob: object URL 404s, and uploaded images are blob-backed now.
      cacheBust: false,
      filter: (n) => {
        const el = n as HTMLElement;
        return !(el?.hasAttribute?.('data-export-exclude') || el?.hasAttribute?.('data-interaction-handle'));
      },
      style: {
        transform: 'scale(1)',
        transformOrigin: 'top left',
        width: `${board.size.width}px`,
        height: `${board.size.height}px`,
        backgroundImage,
      },
    });

    const base64 = dataUrl.replace(/^data:image\/png;base64,/, '');
    const result: McpExportResult = {
      artboardId: board.id,
      name: board.name,
      width: Math.round(board.size.width * scale),
      height: Math.round(board.size.height * scale),
      scale,
      // Decoded byte count of the PNG, so a caller can see what dropping the
      // scale actually saved.
      bytes: Math.round((base64.length * 3) / 4),
    };
    if (options.includeImage !== false) result.dataUrl = dataUrl;
    if (options.save) {
      if (!isTauri()) throw new Error('Saving to a file needs the desktop app; ask for the image inline instead.');
      const { invoke } = await import('@tauri-apps/api/core');
      result.path = await invoke<string>('abs_mcp_write_png', {
        directory: options.directory ?? null,
        fileName: sanitizeFileName(options.fileName?.trim() || board.name).replace(/\s+/g, '_'),
        dataBase64: base64,
      });
    }
    return result;
  };

  const templateSummary = (template: Project): McpTemplateSummary => {
    const boards = template.projectData ?? [];
    const first = boards[0];
    return {
      id: template.id,
      name: template.name,
      category: template.category ?? 'uncategorized',
      description: template.description ?? '',
      artboardCount: boards.length,
      deviceSlotCount: boards.reduce(
        (sum, ab) => sum + ab.elements.filter((el) => el.type === 'device').length,
        0
      ),
      width: first?.size.width ?? 0,
      height: first?.size.height ?? 0,
    };
  };

  /** The error a design tool answers with when its commit was turned down. */
  const toolCommitRefused = () => new Error(TOOL_COMMIT_REFUSALS[commitRefusalRef.current ?? 'opening']);

  /**
   * The commit every design tool below makes. handleArtboardsUpdate turns a
   * commit down while an export holds the canvas, or once another project's
   * document has gone onto it, and a tool that went on to answer with its
   * result would report a change that never landed. A tool that commits after
   * an await of its own and builds on the newest state passes the newest
   * handleArtboardsUpdate as `commit`.
   */
  const commitForTool = (
    next: ArtboardState[],
    change?: HistoryChange,
    commit: (boards: ArtboardState[], change?: HistoryChange) => boolean = handleArtboardsUpdate
  ): void => {
    if (!commit(next, change)) throw toolCommitRefused();
  };

  // Every mutating tool below writes the BASE document and commits through
  // commitForTool. None of them may ever be switched to viewArtboards:
  // update_element through a projection would turn a colour change into a
  // per-language override, and delete_element would trip the unproject
  // assertion and silently drop the commit. Only the two read tools project,
  // and only when the caller asks for a language.
  const mcpApi: McpDesignApi = {
    listArtboards: (locale) =>
      // projectArtboards returns `artboards` BY REFERENCE for null, so the
      // no-locale path is byte-for-byte what it always did.
      projectArtboards(artboards, locale ?? null).map((ab) => ({
        id: ab.id,
        name: ab.name,
        width: ab.size.width,
        height: ab.size.height,
        backgroundColor: ab.backgroundColor,
        elementCount: ab.elements.length,
        active: ab.id === activeArtboardId,
        ...creativeSummary(ab),
      })),
    getArtboard: (id, locale) => {
      const boardId = resolveBoardId(id);
      const ab = projectArtboards(artboards, locale ?? null).find((b) => b.id === boardId);
      return ab ? { ...ab, active: ab.id === activeArtboardId } : null;
    },
    createArtboard: ({ name, width, height, preset, backgroundColor }) => {
      let size: Size = { ...DEFAULT_CANVAS_SIZE };
      // An App Store creative preset makes header or search art, which is
      // tagged so it keeps its size and exports under its placement's name.
      const creative = creativeSpecForPreset(preset);
      if (creative) {
        size = { width: creative.width, height: creative.height };
      } else if (preset) {
        const p = ALL_CANVAS_SIZE_PRESETS.find((x) => x.id === preset);
        if (p) size = { width: p.width, height: p.height };
      }
      if (width && height && !creative) size = { width, height };
      const id = `artboard_${Date.now()}`;
      const board: ArtboardState = {
        id,
        name: name || (creative ? creative.boardName : `Artboard ${artboards.length + 1}`),
        position: { x: 0, y: 0 },
        size,
        elements: [],
        backgroundColor: backgroundColor || '#FFFFFF',
        backgroundType: 'solid',
        zoom: 1,
        ...(creative ? { creativeAsset: creative.kind } : {}),
      };
      commitForTool([...artboards, board]);
      setActiveArtboardId(id);
      return {
        id,
        name: board.name,
        width: size.width,
        height: size.height,
        backgroundColor: board.backgroundColor,
        elementCount: 0,
        active: true,
        ...creativeSummary(board),
      };
    },
    setActiveArtboard: (id) => {
      if (!artboards.some((ab) => ab.id === id)) return false;
      setActiveArtboardId(id);
      return true;
    },
    updateArtboard: ({ artboardId, name, width, height, preset, index, scaleContent }) => {
      const boardId = resolveBoardId(artboardId);
      const board = artboards.find((ab) => ab.id === boardId);
      if (!board) return null;

      let size = board.size;
      if (preset) {
        const p = ALL_CANVAS_SIZE_PRESETS.find((x) => x.id === preset);
        if (p) size = { width: p.width, height: p.height };
      }
      if (width || height) {
        size = { width: width ?? size.width, height: height ?? size.height };
      }
      const resized = size.width !== board.size.width || size.height !== board.size.height;
      // Resizing without moving the content leaves every element where it was
      // in absolute pixels, which reads as "the design broke", so scale by
      // default — the same treatment the Devices format conversion applies.
      const elements =
        resized && scaleContent !== false
          ? scaleElementsToCanvas(board.elements, board.size, size)
          : board.elements;

      const updated: ArtboardState = {
        ...board,
        name: name?.trim() ? name.trim() : board.name,
        size,
        elements,
      };
      let next = artboards.map((ab) => (ab.id === boardId ? updated : ab));
      if (typeof index === 'number') {
        const from = next.findIndex((ab) => ab.id === boardId);
        const to = Math.max(0, Math.min(next.length - 1, Math.round(index)));
        const [moved] = next.splice(from, 1);
        next.splice(to, 0, moved);
      }
      commitForTool(next);
      return {
        id: updated.id,
        name: updated.name,
        width: size.width,
        height: size.height,
        backgroundColor: updated.backgroundColor,
        elementCount: updated.elements.length,
        active: updated.id === activeArtboardId,
      };
    },
    deleteArtboard: ({ artboardId }) => {
      const boardId = resolveBoardId(artboardId);
      const board = artboards.find((ab) => ab.id === boardId);
      if (!board) return null;
      // The canvas toolbar refuses to delete the last artboard (CanvasArea
      // passes canDeleteArtboard={artboards.length > 1}); a project with no
      // artboards is a state the UI never produces, so don't create one here.
      if (artboards.length <= 1) {
        throw new Error(
          'That is the only artboard, a project needs at least one. Create another first, or clear this one with delete_element.'
        );
      }
      const remaining = artboards.filter((ab) => ab.id !== boardId);
      // handleArtboardsUpdate clears the selection when the active board is
      // gone; point it at a surviving board so later calls without an explicit
      // artboardId still have a target.
      const nextActiveId = activeArtboardId === boardId ? remaining[0]?.id ?? null : activeArtboardId;
      commitForTool(remaining);
      if (nextActiveId !== activeArtboardId) setActiveArtboardId(nextActiveId);
      return { deletedId: boardId, artboards: summarizeArtboards(remaining, nextActiveId) };
    },
    duplicateArtboard: ({ artboardId, name, index }) => {
      const boardId = resolveBoardId(artboardId);
      const source = artboards.find((ab) => ab.id === boardId);
      if (!source) return null;
      const stamp = Date.now();
      const idMap: Record<string, string> = {};
      const cloned: ArtboardState = {
        ...JSON.parse(JSON.stringify(source)),
        id: `artboard_${stamp}`,
        name: name?.trim() || `${source.name} copy`,
        // Fresh element ids: the copy has to be independently addressable, or
        // update_element would hit whichever board came first.
        elements: source.elements.map((el, i) => {
          const id = `el_${stamp}_${i}_${Math.random().toString(36).slice(2, 7)}`;
          idMap[el.id] = id;
          return { ...JSON.parse(JSON.stringify(el)), id };
        }),
      };
      // The copy keeps its translations, filed under the new ids.
      const copy = remapOverrideIds(cloned, idMap);
      const sourceIndex = artboards.findIndex((ab) => ab.id === boardId);
      const at = typeof index === 'number'
        ? Math.max(0, Math.min(artboards.length, Math.round(index)))
        : sourceIndex + 1;
      const next = [...artboards];
      next.splice(at, 0, copy);
      commitForTool(next);
      setActiveArtboardId(copy.id);
      return {
        id: copy.id,
        name: copy.name,
        width: copy.size.width,
        height: copy.size.height,
        backgroundColor: copy.backgroundColor,
        elementCount: copy.elements.length,
        active: true,
      };
    },
    // --- App Preview video boards -------------------------------------------
    addPreviewScene: ({ sceneId, artboardId, name }) => {
      const anchorId = resolveBoardId(artboardId);
      const anchor = artboards.find((ab) => ab.id === anchorId) ?? null;
      const preset = buildPreviewScenePreset(sceneId, anchor?.size);
      if (!preset) return null;
      // The same door the palette and the "+" button go through, so a scene
      // dropped by a tool is byte-identical to one dropped by hand.
      const board = handleAddNewArtboardAfter(anchorId, {
        preset: name?.trim() ? { ...preset, name: name.trim() } : preset,
        historyLabel: 'Add Preview Scene',
        notice: {
          title: `${name?.trim() || preset.name} added`,
          description: 'Added by an AI tool over MCP.',
        },
      });
      if (!board) throw toolCommitRefused();
      return {
        id: board.id,
        name: board.name,
        width: board.size.width,
        height: board.size.height,
        backgroundColor: board.backgroundColor,
        elementCount: board.elements.length,
        active: true,
      };
    },
    setPreviewDuration: ({ artboardId, seconds }) => {
      const boardId = resolveBoardId(artboardId);
      const board = artboards.find((ab) => ab.id === boardId);
      if (!board) return null;
      const updated: ArtboardState =
        seconds === null || seconds === undefined
          ? (() => {
              const { previewDurationSeconds, ...rest } = board;
              return rest as ArtboardState;
            })()
          : { ...board, previewDurationSeconds: clampPreviewDuration(Number(seconds)) };
      commitForTool(
        artboards.map((ab) => (ab.id === boardId ? updated : ab)),
        namedChange('Preview Length', 'edit', updated.name)
      );
      return summarizePreviewTimeline(updated);
    },
    setAnimation: ({ artboardId, elementId, patch }) => {
      const boardId = resolveBoardId(artboardId);
      const board = artboards.find((ab) => ab.id === boardId);
      const element = board?.elements.find((el) => el.id === elementId);
      if (!board || !element) {
        return { ok: false, message: 'No such element. Call get_artboard for the layer ids.' };
      }
      if (element.type === 'gesture') {
        return {
          ok: false,
          message:
            'A gesture hint has no enter/exit animation: it is timed by triggerTime and gestureDuration. Set those with update_element.',
        };
      }
      if (element.type === 'video' || element.type === 'video-device') {
        return {
          ok: false,
          message:
            'A recording always starts the board, so it takes no enter animation. Trim it with trimStart / trimEnd on update_element instead.',
        };
      }
      const result = buildAnimationPatch(element.animation, patch);
      if ('error' in result) return { ok: false, message: result.error };
      const elements = board.elements.map((el) =>
        el.id === elementId ? ({ ...el, animation: result.animation } as ArtboardElement) : el
      );
      const updated = { ...board, elements };
      commitForTool(
        artboards.map((ab) => (ab.id === boardId ? updated : ab)),
        namedChange('Animate Layer', 'edit', element.name || element.type)
      );
      return { ok: true, timeline: summarizePreviewTimeline(updated) };
    },
    getPreviewTimeline: ({ artboardId }) => {
      const boardId = resolveBoardId(artboardId);
      const board = artboards.find((ab) => ab.id === boardId);
      return board ? summarizePreviewTimeline(board) : null;
    },
    addElement: ({ artboardId, type, subType, props }) => {
      const boardId = resolveBoardId(artboardId);
      const board = artboards.find((ab) => ab.id === boardId);
      if (!board) throw new Error('No artboard to add to. Create one first with create_artboard.');
      const element = buildMcpElement(type, subType, props ?? {}, board);
      if (!element) throw new Error(`Could not create a "${type}" element (shapes and devices need a subType).`);
      commitForTool(
        artboards.map((ab) => (ab.id === boardId ? { ...ab, elements: [...ab.elements, element] } : ab))
      );
      setActiveArtboardId(boardId);
      return { id: element.id };
    },
    addElements: ({ artboardId, elements }) => {
      const boardId = resolveBoardId(artboardId);
      const board = artboards.find((ab) => ab.id === boardId);
      if (!board) throw new Error('No artboard to add to. Create one first with create_artboard.');
      // Build every element before touching state: one bad entry aborts the
      // whole call, so a batch can never leave a half-populated board.
      const built = elements.map((spec, i) => {
        const element = buildMcpElement(spec.type as ElementType, spec.subType, (spec.props ?? {}) as Record<string, any>, board);
        if (!element) {
          throw new Error(`elements[${i}]: could not create a "${spec.type}" element (shapes and devices need a subType).`);
        }
        // buildMcpElement stamps ids from Date.now(), so a same-millisecond
        // batch would collide without the index.
        return { ...element, id: `${element.id}_${i}` } as ArtboardElement;
      });
      commitForTool(
        artboards.map((ab) => (ab.id === boardId ? { ...ab, elements: [...ab.elements, ...built] } : ab))
      );
      setActiveArtboardId(boardId);
      return { ids: built.map((el) => el.id) };
    },
    updateElement: ({ artboardId, elementId, props }) => {
      const boardId = resolveBoardId(artboardId);
      const board = artboards.find((ab) => ab.id === boardId);
      if (!board || !board.elements.some((el) => el.id === elementId)) return false;
      const newElements = board.elements.map((el) =>
        el.id === elementId ? ({ ...el, ...props, id: el.id, type: el.type } as ArtboardElement) : el
      );
      commitForTool(artboards.map((ab) => (ab.id === boardId ? { ...ab, elements: newElements } : ab)));
      return true;
    },
    deleteElement: ({ artboardId, elementId }) => {
      const boardId = resolveBoardId(artboardId);
      const board = artboards.find((ab) => ab.id === boardId);
      if (!board || !board.elements.some((el) => el.id === elementId)) return false;
      commitForTool(
        artboards.map((ab) =>
          ab.id === boardId
            // The element's translations go in the same commit, or a re-minted
            // id could come back to a stale one.
            ? dropElementOverrides({ ...ab, elements: ab.elements.filter((el) => el.id !== elementId) }, [elementId])
            : ab
        )
      );
      setSelectedElementIds((ids) => ids.filter((id) => id !== elementId));
      return true;
    },
    reorderElement: ({ artboardId, elementId, action, index }) => {
      const boardId = resolveBoardId(artboardId);
      const board = artboards.find((ab) => ab.id === boardId);
      const from = board?.elements.findIndex((el) => el.id === elementId) ?? -1;
      if (!board || from < 0) return null;
      const last = board.elements.length - 1;
      let to = from;
      if (typeof index === 'number') to = Math.round(index);
      else if (action === 'front') to = last;
      else if (action === 'back') to = 0;
      else if (action === 'forward') to = from + 1;
      else if (action === 'backward') to = from - 1;
      to = Math.max(0, Math.min(last, to));

      const elements = [...board.elements];
      const [moved] = elements.splice(from, 1);
      elements.splice(to, 0, moved);
      commitForTool(artboards.map((ab) => (ab.id === boardId ? { ...ab, elements } : ab)));
      return { index: to, total: elements.length };
    },
    measureElement: ({ artboardId, elementId }) => {
      const boardId = resolveBoardId(artboardId);
      const board = artboards.find((ab) => ab.id === boardId);
      const element = board?.elements.find((el) => el.id === elementId);
      if (!board || !element) return null;
      const boardNode = document.querySelector(`[data-artboard-dom-id="${boardId}"]`) as HTMLElement | null;
      const elementNode = boardNode?.querySelector(`[data-element-id="${elementId}"]`) as HTMLElement | null;
      if (!boardNode || !elementNode) return null;

      // The canvas draws artboards at 0.3 (times any zoom), so everything the
      // DOM reports has to be divided back into artboard pixels. Deriving the
      // factor from the rendered width covers every transform above us.
      const boardRect = boardNode.getBoundingClientRect();
      const factor = boardRect.width / board.size.width || 1;
      const toArtboard = (rect: DOMRect) => ({
        x: Math.round((rect.left - boardRect.left) / factor),
        y: Math.round((rect.top - boardRect.top) / factor),
        width: Math.round(rect.width / factor),
        height: Math.round(rect.height / factor),
      });

      const box = toArtboard(elementNode.getBoundingClientRect());
      const declared = {
        x: Math.round(element.position.x),
        y: Math.round(element.position.y),
        width: Math.round(element.size.width * (element.scale || 1)),
        height: Math.round(element.size.height * (element.scale || 1)),
      };
      const measurement: McpElementMeasurement = {
        elementId,
        artboardId: boardId,
        type: element.type,
        box,
        declared,
        artboard: { width: board.size.width, height: board.size.height },
      };

      if (element.type === 'text') {
        const body = elementNode.querySelector('[data-text-body]');
        if (body) {
          // A range over the text node gives the union of the line boxes, i.e.
          // where the glyphs really are — which is the whole point of this
          // tool, since the copy is centred and can wrap or clip.
          const range = document.createRange();
          range.selectNodeContents(body);
          const ink = range.getBoundingClientRect();
          range.detach?.();
          if (ink.width > 0 || ink.height > 0) {
            measurement.textBox = toArtboard(ink);
            measurement.clipped =
              measurement.textBox.height > box.height + 1 || measurement.textBox.width > box.width + 1;
          }
        }
        measurement.renderedFontSize = Math.round(element.fontSize / DISPLAY_SCALE_FACTOR);
      }
      return measurement;
    },
    groupElements: ({ artboardId, elementIds, groupId, clear }) => {
      const boardId = resolveBoardId(artboardId);
      const board = artboards.find((ab) => ab.id === boardId);
      if (!board) return null;
      const wanted = new Set(elementIds);
      const hit = board.elements.filter((el) => wanted.has(el.id)).map((el) => el.id);
      if (hit.length === 0) return null;
      const nextGroupId = clear ? undefined : groupId?.trim() || makeGroupId(Date.now());
      // A group made from here is a group the Layers panel lists, so it gets
      // the same kind of name the editor's Group command gives one. Tagging
      // elements into a group that already has a name keeps that name.
      const groupName = nextGroupId
        ? board.elements.find((el) => el.groupId === nextGroupId && el.groupName)?.groupName ??
          nextGroupName(board.elements)
        : undefined;
      commitForTool(
        artboards.map((ab) =>
          ab.id === boardId
            ? {
                ...ab,
                elements: ab.elements.map((el) => {
                  if (!wanted.has(el.id)) return el;
                  if (!nextGroupId) {
                    const { groupId: _dropped, groupName: _unnamed, ...rest } = el;
                    return rest as ArtboardElement;
                  }
                  return { ...el, groupId: nextGroupId, groupName } as ArtboardElement;
                }),
              }
            : ab
        )
      );
      return { groupId: nextGroupId ?? null, elementIds: hit };
    },
    transformElements: ({ artboardId, elementIds, groupId, dx, dy, x, y, scale }) => {
      const boardId = resolveBoardId(artboardId);
      const board = artboards.find((ab) => ab.id === boardId);
      if (!board) return null;
      const wanted = new Set(elementIds ?? []);
      const members = board.elements.filter(
        (el) => (groupId && el.groupId === groupId) || wanted.has(el.id)
      );
      if (members.length === 0) return null;

      // Bounding box of the set, in artboard px, so a scale keeps the
      // arrangement's centre and a move can be expressed as a corner. The same
      // helper the editor's align uses, so a group is in one place whichever
      // of the two moved it: it takes rotation into account, and it leaves out
      // a sound layer, which carries a position it never draws.
      const span = unionBounds(members);
      if (!span) return null;
      const left = span.x;
      const top = span.y;
      const right = span.x + span.width;
      const bottom = span.y + span.height;
      const centerX = (left + right) / 2;
      const centerY = (top + bottom) / 2;
      const factor = typeof scale === 'number' && scale > 0 ? scale : 1;
      // Scale happens first, so x/y have to be measured against the edges the
      // group will have AFTER scaling — otherwise combining scale with x/y
      // lands the box short of where the caller asked for it.
      const scaledLeft = centerX + (left - centerX) * factor;
      const scaledTop = centerY + (top - centerY) * factor;
      const shiftX = (typeof x === 'number' ? x - scaledLeft : 0) + (dx ?? 0);
      const shiftY = (typeof y === 'number' ? y - scaledTop : 0) + (dy ?? 0);

      const ids = new Set(members.map((el) => el.id));
      const elements = board.elements.map((el) => {
        if (!ids.has(el.id)) return el;
        // Scale about the group centre first, then translate, so the two can
        // be combined in one call without the order surprising the caller.
        const position = {
          x: centerX + (el.position.x - centerX) * factor + shiftX,
          y: centerY + (el.position.y - centerY) * factor + shiftY,
        };
        if (factor === 1) return { ...el, position } as ArtboardElement;
        // Text ignores element.scale when it draws (see scaleElementsToCanvas),
        // so its box and font size have to be scaled directly instead.
        if (el.type === 'text') {
          return {
            ...el,
            position,
            size: { width: el.size.width * factor, height: el.size.height * factor },
            fontSize: el.fontSize * factor,
          } as ArtboardElement;
        }
        return { ...el, position, scale: (el.scale || 1) * factor } as ArtboardElement;
      });
      commitForTool(artboards.map((ab) => (ab.id === boardId ? { ...ab, elements } : ab)));
      return {
        elementIds: [...ids],
        bounds: {
          x: Math.round(scaledLeft + shiftX),
          y: Math.round(scaledTop + shiftY),
          width: Math.round((right - left) * factor),
          height: Math.round((bottom - top) * factor),
        },
      };
    },
    /**
     * Align and distribute, over the same pure helpers the editor's own
     * controls use, so an agent and a person arranging the same board get the
     * same answer. Written against the base document like the other MCP
     * writers: an agent is not looking at a language overlay.
     */
    alignElements: ({ artboardId, elementIds, groupId, edge }) => {
      const boardId = resolveBoardId(artboardId);
      const board = artboardsRef.current.find((ab) => ab.id === boardId);
      if (!board) return null;
      const wanted = new Set(elementIds ?? []);
      const members = board.elements.filter(
        (el) => ((groupId && el.groupId === groupId) || wanted.has(el.id)) && hasCanvasBox(el)
      );
      if (members.length < 2) return null;
      const ids = new Set(members.map((el) => el.id));
      const elements = alignElements(board.elements, ids, edge);
      commitForTool(
        artboardsRef.current.map((ab) => (ab.id === boardId ? { ...ab, elements } : ab)),
        namedChange(ALIGN_HISTORY_LABELS[edge], 'move', `${members.length} layers`)
      );
      const span = unionBounds(elements.filter((el) => ids.has(el.id)));
      return {
        elementIds: [...ids],
        bounds: span
          ? { x: Math.round(span.x), y: Math.round(span.y), width: Math.round(span.width), height: Math.round(span.height) }
          : { x: 0, y: 0, width: 0, height: 0 },
      };
    },
    distributeElements: ({ artboardId, elementIds, groupId, axis }) => {
      const boardId = resolveBoardId(artboardId);
      const board = artboardsRef.current.find((ab) => ab.id === boardId);
      if (!board) return null;
      const wanted = new Set(elementIds ?? []);
      const members = board.elements.filter(
        (el) => ((groupId && el.groupId === groupId) || wanted.has(el.id)) && hasCanvasBox(el)
      );
      // Under three there is no gap to even out, so say so rather than
      // reporting a move that did not happen.
      if (members.length < 3) return null;
      const ids = new Set(members.map((el) => el.id));
      const elements = distributeElements(board.elements, ids, axis);
      commitForTool(
        artboardsRef.current.map((ab) => (ab.id === boardId ? { ...ab, elements } : ab)),
        namedChange(
          axis === 'horizontal' ? 'Distribute Horizontally' : 'Distribute Vertically',
          'move',
          `${members.length} layers`
        )
      );
      const span = unionBounds(elements.filter((el) => ids.has(el.id)));
      return {
        elementIds: [...ids],
        bounds: span
          ? { x: Math.round(span.x), y: Math.round(span.y), width: Math.round(span.width), height: Math.round(span.height) }
          : { x: 0, y: 0, width: 0, height: 0 },
      };
    },
    setBackground: ({ artboardId, backgroundColor, gradient }) => {
      const boardId = resolveBoardId(artboardId);
      const board = artboards.find((ab) => ab.id === boardId);
      if (!board) return false;
      const patch: Partial<ArtboardState> = gradient
        ? { backgroundType: 'gradient', backgroundGradient: gradient }
        : backgroundColor
          ? { backgroundType: 'solid', backgroundColor }
          : {};
      if (Object.keys(patch).length === 0) return false;
      commitForTool(artboards.map((ab) => (ab.id === boardId ? { ...ab, ...patch } : ab)));
      return true;
    },
    exportPng: async ({ artboardId, scale, save, directory, fileName, includeImage, locale }) => {
      const boardId = resolveBoardId(artboardId);
      const board = artboards.find((ab) => ab.id === boardId);
      if (!board) throw new Error('No such artboard.');
      return withLocaleOnCanvas(locale, () =>
        captureArtboardForMcp(board, {
          scale,
          save,
          directory,
          fileName,
          includeImage: includeImage ?? !save,
        })
      );
    },
    exportAll: async ({ scale, save, directory, includeImage, locale }) => {
      if (artboards.length === 0) return [];
      const shouldSave = save !== false;
      // Named the way the export dialog names them: the screenshots run 01..N,
      // and header and search art goes out under its placement name with no
      // number, so an upload script never takes it for screenshot 01.
      const shots = screenshotBoards(artboards);
      const padTo = Math.max(2, String(shots.length).length);
      const stems = creativeFileStems(artboards);
      // The language goes in the file name rather than a subfolder: the folder
      // may be the Downloads default, which the caller never named and so
      // cannot predict a subfolder inside. A caller that wants the fastlane
      // layout passes a directory of its own per language.
      const token = locale ? `${locale}_` : '';
      return withLocaleOnCanvas(locale, async () => {
        const results: McpExportResult[] = [];
        for (const board of artboards) {
          results.push(
            await captureArtboardForMcp(board, {
              scale,
              save: shouldSave,
              directory,
              fileName: `${token}${stems[board.id] ?? `${String(shots.indexOf(board) + 1).padStart(padTo, '0')}_${board.name}`}`,
              includeImage: includeImage ?? false,
            })
          );
        }
        return results;
      });
    },

    // -- Templates and projects ----------------------------------------------

    listTemplates: ({ category, query }) => {
      const q = query?.trim().toLowerCase();
      // App Preview video templates are hidden for the same reason the in-app
      // agent hides them: their mockups play a screen RECORDING, which an MCP
      // client has no way to supply.
      return agentUsableTemplates(availableProjects)
        .filter((t) => !category || t.category === category)
        .map(templateSummary)
        .filter((t) => !q || `${t.name} ${t.description} ${t.category}`.toLowerCase().includes(q));
    },
    getTemplate: (templateId) => {
      const template = availableProjects.find((t) => t.id === templateId);
      if (!template) return null;
      return {
        ...templateSummary(template),
        artboards: (template.projectData ?? []).map((ab, index) => ({
          index,
          name: ab.name,
          width: ab.size.width,
          height: ab.size.height,
          deviceSlots: ab.elements
            .filter((el): el is DeviceFrameElementProps => el.type === 'device')
            .map((el) => ({ elementId: el.id, deviceType: el.deviceType, hasScreenshot: !!el.screenshotSrc })),
          textSlots: ab.elements
            .filter((el): el is TextElementProps => el.type === 'text')
            .map((el) => ({ elementId: el.id, content: el.content })),
        })),
      };
    },
    createProjectFromTemplate: async ({ templateId, name, texts, screenshots }) => {
      if (availableProjects.length === 0) {
        throw new Error('Templates are still loading. Try again in a moment.');
      }
      const template = availableProjects.find((t) => t.id === templateId);
      if (!template) throw new Error(`No template "${templateId}". Call list_templates for valid ids.`);
      const created = await createProjectFromTemplateData(template, {
        nameOverride: name,
        texts,
        screenshots,
      });
      if (!created) throw new Error('Could not create a project from that template.');
      return {
        projectId: created.projectId,
        name: created.name,
        artboards: summarizeArtboards(created.artboards),
        warnings: created.warnings,
      };
    },
    applyTemplate: async ({ templateId, texts, screenshots, projectName }) => {
      if (!activeProjectId) {
        throw new Error(
          'No project is open, so there is nothing to apply a template to. Use create_project_from_template to start a new project from it.'
        );
      }
      if (availableProjects.length === 0) {
        throw new Error('Templates are still loading. Try again in a moment.');
      }
      const template = availableProjects.find((t) => t.id === templateId);
      if (!template) throw new Error(`No template "${templateId}". Call list_templates for valid ids.`);
      if (!template.projectData?.length) throw new Error(`Template "${templateId}" has no artboards.`);
      // An export holds the canvas, so the commit at the end would be turned
      // down. Said now, before the work below.
      if (isExportingRef.current) {
        throw new Error('An export is running. Apply the template again once it finishes.');
      }

      // Copied, laid out and filled the way createProjectFromTemplateData does
      // it, then given the passes loadProjectFromData runs on a project it
      // opens, so an applied template ends up the same as a freshly started one.
      const copy = calculateArtboardPositions(
        JSON.parse(JSON.stringify(template.projectData)) as ArtboardState[]
      );
      const warnings = fillTemplateSlots(copy, { texts, screenshots });
      let boards = normalizeLocalization(
        ensureUniqueElementIds(await externalizeInlineMedia(migrateVideoDevices(copy)))
      );

      // The editor kept going during that await. The commit below goes
      // through the newest handleArtboardsUpdate, so edits made meanwhile stay
      // in undo, but an export or another project in the meantime stops the
      // call before it touches anything.
      if (isExportingRef.current) {
        throw new Error(
          'An export started while the template was being prepared, so nothing was changed. Apply the template again once the export finishes.'
        );
      }
      if (activeProjectIdRef.current !== activeProjectId) {
        throw new Error(
          'Another project was opened while the template was being prepared, so nothing was changed. Check list_projects for the one open now before you apply the template again.'
        );
      }

      // The language list belongs to the project, so it carries over. The old
      // boards' translations cannot: each is keyed by an element id the
      // template does not have. Read from the ref, since the boards this
      // render saw may be out of date after the await.
      const languages = artboardsRef.current.find((board) => board.localization)?.localization;
      if (languages) boards = normalizeLocalization(setLocalization(boards, languages));

      // Every board is replaced, and undo does not survive a reload, so the
      // outgoing design is kept as a version first.
      void writeVersion(artboardsRef.current, `Before ${template.name}`, 'safety');
      commitForTool(boards, namedChange('Apply template', 'open', template.name), handleArtboardsUpdateRef.current);
      setActiveArtboardId(boards[0].id);
      setSelectedElementIds([]);

      // Only after the commit: the rename flushes the save that commit
      // scheduled, which still carries the old name, then writes the new one.
      // Renaming first would let that pending save put the old name back.
      const rename = projectName?.trim();
      const renamed = rename ? await handleRenameProject(rename) : false;
      if (rename && !renamed) {
        warnings.push('The template was applied, but the project kept its name. Call rename_project to rename it.');
      }
      return {
        projectId: activeProjectId,
        name: renamed && rename ? rename : projectNameRef.current,
        artboards: summarizeArtboards(boards),
        warnings,
      };
    },
    listProjects: async () => {
      const projects = await db.projects.orderBy('timestamp').reverse().toArray();
      // Read the open project from the URL rather than the closed-over
      // activeProjectId: loadProjectFromData rewrites the URL synchronously, so
      // this is right even for a call that lands before React has re-rendered.
      const openId =
        typeof window !== 'undefined'
          ? new URLSearchParams(window.location.search).get('projectId')
          : activeProjectId;
      return projects.map((p) => ({
        id: p.id,
        name: p.name,
        savedAt: new Date(p.timestamp).toISOString(),
        artboardCount: p.projectData?.length ?? 0,
        open: p.id === openId,
      }));
    },
    openProject: async (projectId) => {
      // Parked in a tab: bring that tab back as it was, undo history and all,
      // the way clicking it would.
      const parked = projectTabsParking.peek(projectId);
      if (parked && projectId !== loadedProjectIdRef.current) {
        activateTab(projectId);
        await mcpNextPaint();
        return {
          projectId,
          name: parked.name,
          artboards: summarizeArtboards(parked.artboards),
          warnings: [],
        };
      }
      // Reopening the already-open project must not resurrect a pre-edit row:
      // commit any pending debounced save before the read.
      flushProjectSave();
      const project = await db.projects.get(projectId);
      if (!project || !project.projectData) return null;
      if (!canOpenAsProject(project.projectData)) {
        throw new Error(
          'That project has no artboards, so there is nothing to open. Pick another with list_projects, or start one with create_project_from_template.'
        );
      }
      const name = project.name || 'Untitled Project';
      if (projectId !== loadedProjectIdRef.current) {
        if ((await projectOpenElsewhere(projectId)) === true) throw new ProjectOpenElsewhereError(projectId, name);
        // The way clicking it in Recent projects or on its tab would: the
        // loader takes its lock and reads it with the undo stack it was left
        // with, which loadProjectFromData would start over.
        activateTab(projectId);
        if (!(await waitForCanvas(projectId))) throw new Error('Could not open that project.');
        await mcpNextPaint();
        return {
          projectId: project.id,
          name,
          artboards: summarizeArtboards(project.projectData),
          warnings: [],
        };
      }
      const success = await loadProjectFromData(project.projectData, name, project.id);
      if (!success) throw new Error('Could not open that project.');
      // Let React paint the reopened canvas before the next tool call, so an
      // export_png right after this finds the artboards in the DOM.
      await mcpNextPaint();
      return {
        projectId: project.id,
        name,
        artboards: summarizeArtboards(project.projectData),
        warnings: [],
      };
    },
    renameProject: async (name) => {
      if (!activeProjectId) {
        throw new Error('No project is open, so there is nothing to rename. Open one with open_project first.');
      }
      const trimmed = name.trim();
      await handleRenameProject(trimmed);
      // A failed write is a toast in handleRenameProject, not a throw, so the
      // saved row is what says whether the name landed.
      const saved = await db.projects.get(activeProjectId);
      if (saved?.name !== trimmed) throw new Error('The new name could not be saved. Try again.');
      return { projectId: activeProjectId, name: trimmed };
    },

    // -- Languages ------------------------------------------------------------

    listLocales: () => mcpLocaleState(),
    setLocale: async (locale) => {
      const baseLocale = getBaseLocale(artboards);
      const next = !locale || locale === baseLocale ? null : locale;
      if (next && !getProjectLocales(artboards).some((entry) => entry.code === next)) return null;
      handleSelectLocale(next);
      // Let the canvas repaint, so an export_png straight after this renders
      // the language that was asked for. Same pattern openProject uses.
      await mcpNextPaint();
      return mcpLocaleState(next);
    },
    setLocalizedText: ({ artboardId, elementId, locale, text }) => {
      const boardId = resolveBoardId(artboardId);
      if (!boardId) return null;
      const applied = applyLocalizedText(artboards, { artboardId: boardId, elementId, locale, text });
      if (!applied) return null;
      commitForTool(
        applied.artboards,
        namedChange('Edit Translations', 'translate', localeLabel(locale))
      );
      return applied.result;
    },

    addLocales: async ({ locales, baseLocale, autoFont, autoFit, machineTranslate }) => {
      const added = addProjectLocales(artboards, locales, { autoFont, autoFit, baseLocale });
      let boards = added.artboards;
      let translation: McpTranslateRunResult | undefined;
      // Only the languages that were actually added get drafted. Re-running the
      // engine over a language that was already there would spend the whole
      // rate-limit budget refreshing copy nobody asked about.
      if (machineTranslate && added.result.added.length > 0) {
        const run = await runMcpTranslation(boards, added.result.added, { only: 'empty' });
        boards = run.artboards;
        translation = run.result;
      }
      // Built from this render's document, so committed through this render's
      // handleArtboardsUpdate (commitForTool's default). When another project
      // went onto the canvas during the run, that turns the commit down and
      // the call answers with an error. The newest handleArtboardsUpdate would
      // take these boards as an edit of the project open now.
      if (boards !== artboards) {
        commitForTool(
          boards,
          namedChange('Add Languages', 'translate', `${added.result.locales.length} languages`)
        );
      }
      // Recounted against the committed boards, so the completion figures
      // include whatever the draft just wrote.
      const result = { ...added.result, locales: localeConfigEntries(boards) };
      return translation ? { ...result, translation } : result;
    },
    removeLocales: ({ locales }) => {
      const removed = removeProjectLocales(artboards, locales);
      if (removed.artboards !== artboards) {
        commitForTool(
          removed.artboards,
          namedChange('Remove Languages', 'translate', removed.result.removed.join(', '))
        );
      }
      // Nothing to do about the language on screen: the effect that watches
      // `artboards` drops the view back to base when the language goes.
      return removed.result;
    },
    setBaseLocale: ({ locale }) => {
      const applied = setProjectBaseLocale(artboards, locale);
      if ('error' in applied) throw new Error(applied.error);
      if (applied.artboards !== artboards) {
        commitForTool(
          applied.artboards,
          namedChange('Set Base Language', 'translate', localeLabel(locale))
        );
      }
      return applied.result;
    },

    listTranslations: (input) => buildTranslationView(artboards, input),
    setLocalizedTexts: ({ writes }) => {
      const applied = applyLocaleTexts(artboards, writes);
      if (applied.artboards !== artboards) {
        const count = applied.result.written + applied.result.cleared;
        commitForTool(
          applied.artboards,
          namedChange('Edit Translations', 'translate', `${count} ${count === 1 ? 'string' : 'strings'}`)
        );
      }
      return applied.result;
    },
    translateLocales: async ({ locales, only, includeManual, guidance, artboardIds, elementIds }) => {
      const run = await runMcpTranslation(artboards, locales, {
        only: only ?? 'empty',
        includeManual,
        guidance,
        artboardIds,
        elementIds,
      });
      // Committed the way add_locales commits its draft, for the same reason.
      if (run.artboards !== artboards) {
        commitForTool(
          run.artboards,
          namedChange('Translate', 'translate', locales.map((code) => localeName(code)).join(', '))
        );
      }
      return run.result;
    },

    exportTranslationsCsv: ({ locales }) => {
      const codes = locales && locales.length > 0
        ? locales
        : getProjectLocales(artboards).map((entry) => entry.code);
      return {
        csv: toCsv(artboards, codes),
        locales: codes,
        rows: buildTranslationRows(artboards, codes).length,
      };
    },
    importTranslationsCsv: ({ csv, dryRun, locales }) => {
      const plan = planCsvImport(artboards, csv);
      const wanted = locales && locales.length > 0 ? new Set(locales) : null;
      const changes = wanted ? plan.changes.filter((change) => wanted.has(change.locale)) : plan.changes;
      if (!dryRun && changes.length > 0) {
        commitForTool(
          applyCsvImport(artboards, changes),
          namedChange('Import Translations', 'translate', `${changes.length} strings`)
        );
      }
      return {
        applied: dryRun ? 0 : changes.length,
        unmatched: plan.unmatched,
        dryRun: dryRun === true,
        changes,
      };
    },

    setLocaleOverride: (input) => {
      const applied = applyLocaleOverride(artboards, {
        ...input,
        artboardId: input.artboardId ?? undefined,
      });
      if ('error' in applied) throw new Error(applied.error);
      if (applied.artboards !== artboards) {
        commitForTool(
          applied.artboards,
          namedChange('Detach For Language', 'translate', localeLabel(input.locale))
        );
      }
      return applied.result;
    },
    resetLocaleOverrides: (input) => {
      const applied = resetLocaleOverrides(artboards, input);
      if ('error' in applied) throw new Error(applied.error);
      if (applied.artboards !== artboards) {
        commitForTool(
          applied.artboards,
          namedChange(
            input.scope === 'element' ? 'Reset Element To Base'
              : input.scope === 'artboard' ? 'Reset Artboard To Base'
              : 'Reset Language To Base',
            'translate',
            localeLabel(input.locale)
          )
        );
      }
      return applied.result;
    },

    // The Claude Code agent's code folders. Rust reads the picture and checks
    // the path; the store knows whether the process can read a folder now, and
    // whether the chat's agent ever could.
    importProjectImage: (path, name) => importProjectImage(path, name),
    agentReadsFolders: () => claudeAgent.agentReadsFolders(),
    agentMayHoldFolderData: () => claudeAgent.agentMayHoldFolderData(),

    // Every tool above closes over this render's artboards. The serial runner
    // holds a call until this says they are the open project's document.
    canvasReady: () => canvasStillHolds(renderedCanvas, canvasSerialRef.current),
  };
  mcpApiRef.current = mcpApi;

  // Same pattern as mcpApiRef above: assigned during render so the bridge never
  // answers with a stale closure over a previous render's artboards.
  headlessHostRef.current = {
    getMcpApi: () => mcpApiRef.current,
    exportImages: (selection) =>
      handleConfirmExport({
        asIs: selection.asIs,
        generateFormats: selection.generateFormats,
        currentArtboardOnly: selection.currentArtboardOnly,
        locales: selection.locales,
      }),
    exportVideo: (request) => handleExportVideo(request as VideoExportRequest),
    capture: (ids, formatId, locale) => handlePublishCapture(ids, formatId, locale),
    loadProject: (data, name, id) => loadProjectFromData(data, name, id),
    getStatus: () => {
      const boards = artboardsRef.current;
      return {
        projectId: activeProjectId,
        projectName: currentProjectName,
        artboards: boards.map((board) => ({
          id: board.id,
          name: board.name,
          width: board.size.width,
          height: board.size.height,
          elements: board.elements.length,
        })),
        locales: getProjectLocales(boards).map((entry) => entry.code),
        baseLocale: hasLocales(boards) ? getBaseLocale(boards) : null,
        activeArtboardId,
      };
    },
  };

  return (
    <>
      {templateSelectorDialog}
      <SidebarProvider defaultOpen>
        <Sidebar side="left" collapsible="icon" variant="sidebar" className="border-r">
          <SidebarHeader className="border-b">
            <div className="flex items-center gap-3 px-2 py-2.5 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
              <Logo withBackground className="h-10 w-10 shrink-0 group-data-[collapsible=icon]:h-8 group-data-[collapsible=icon]:w-8" />
              <div className="flex min-w-0 flex-col group-data-[collapsible=icon]:hidden">
                {/* Wraps rather than truncates: the name is too long for one line here. */}
                <span className="text-sm font-semibold leading-tight tracking-tight">Open Screenshot Generator</span>
                <span className="text-xs leading-tight text-muted-foreground">Canva for App Store &amp; Play Store graphics</span>
              </div>
            </div>
          </SidebarHeader>
          <SidebarContent>
            {/* Discover sits above the palette, not down in the footer with
                Account and Settings: it is a place you go, like the canvas and
                the palette, rather than a preference you set. The rail keeps
                only the compass when the sidebar is collapsed to icons. */}
            {HAS_DISCOVER && (
            <SidebarGroup className="px-2 pb-0 pt-2 group-data-[collapsible=icon]:px-1">
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    tooltip="Discover, designs the community shared"
                    className="w-full border border-primary/25 bg-primary/10 font-medium text-primary hover:bg-primary/15 hover:text-primary"
                    onClick={() => openDiscover('feed')}
                  >
                    <CompassIcon />
                    <span className="group-data-[collapsible=icon]:hidden">Discover</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroup>
            )}
            <StoreArtSourceContext.Provider value={storeArtSource}>
              <ElementPalette
                onAddElement={handlePaletteAddElement}
                onDropElement={handlePaletteDropElement}
                onAddPreviewScene={handlePaletteAddPreviewScene}
                onAddCreativeLook={handlePaletteAddCreativeLook}
              />
            </StoreArtSourceContext.Provider>
          </SidebarContent>
          <SidebarFooter className="group-data-[collapsible=icon]:justify-center">
             <SidebarGroup className="p-0">
              <SidebarMenu>
                {/* Desktop: there only while an update is ready, out, or going in. */}
                <UpdateSidebarItem />
                <SidebarMenuItem>
                  <SidebarMenuButton
                    tooltip={accountSession ? `Account, ${accountSession.account.name}` : 'Account'}
                    className="w-full"
                    onClick={() => openAccountDialog()}
                  >
                    {accountSession ? (
                      <Avatar className="h-4 w-4 shrink-0">
                        {accountSession.account.avatarUrl && (
                          <AvatarImage src={accountSession.account.avatarUrl} alt="" />
                        )}
                        <AvatarFallback className="text-[9px]">
                          {accountSession.account.name.slice(0, 1).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                    ) : (
                      <UserIcon />
                    )}
                    <span className="truncate group-data-[collapsible=icon]:hidden">
                      {accountSession ? accountSession.account.name : 'Account'}
                    </span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  {/* Theme, and the way back into the tips once the startup
                      checkbox is unticked. */}
                  <SidebarMenuButton tooltip="Settings" className="w-full" onClick={() => setIsSettingsOpen(true)}>
                    <SettingsIcon />
                    <span className="group-data-[collapsible=icon]:hidden">Settings</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton tooltip="About" className="w-full" onClick={() => setIsAboutOpen(true)}>
                    <InfoIcon />
                    <span className="group-data-[collapsible=icon]:hidden">About</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroup>
          </SidebarFooter>
        </Sidebar>

        <SidebarInset className="relative flex flex-col overflow-hidden">
          <ProjectTabBar
            tabs={projectTabs.tabs}
            activeProjectId={activeProjectId}
            loadingProjectId={
              activeProjectId && activeProjectId !== renderedCanvasProjectId ? activeProjectId : null
            }
            activeSummary={activeTabSummary}
            closed={projectTabs.closed}
            isSleeping={projectTabs.isSleeping}
            keepsUndo={projectTabs.keepsUndo}
            artboardsFor={tabArtboards}
            onActivate={handleActivateTab}
            onClose={handleCloseTab}
            onNewTab={handleNewTab}
            onMove={projectTabs.move}
            onCloseOthers={handleCloseOtherTabs}
            onCloseToRight={handleCloseTabsToRight}
            onDuplicate={handleDuplicateTab}
            onReopenClosed={handleReopenClosedTab}
            onRename={(name) => void handleRenameProject(name)}
            onDropLayers={(projectId, carry) => {
              const board = artboardsRef.current.find((entry) =>
                entry.elements.some((element) => element.id === carry.elementId)
              );
              if (!board) return;
              const selection = selectedElementIdsRef.current;
              const ids = selection.includes(carry.elementId) ? selection : [carry.elementId];
              void sendLayersToTab(projectId, carry.copy ? 'copy' : 'move', board.id, ids);
            }}
            onSpringLoad={handleSpringLoad}
            onMoveToNewWindow={moveTabToNewWindow}
            onMoveToWindow={moveTabToWindow}
            onTearMove={handleTabTearMove}
            onTearEnd={handleTabTearEnd}
            tearTarget={tearTarget}
            displays={tabDisplays}
            otherWindows={otherWindows}
            onMenuOpen={() => {
              askForOtherWindows();
              refreshTabDisplays();
            }}
            onFindDisplays={
              canAskForDisplays
                ? () => {
                    void requestWebScreenAccess().then((granted) => {
                      if (granted) refreshTabDisplays();
                    });
                  }
                : undefined
            }
            shortcutsBlocked={isTemplateSelectorOpen || isPreviewOpen}
            desktopShortcuts={isDesktopApp}
          />
          <LoadStatusBar
            phase={loadPhase}
            templateProgress={templateProgress}
            projectStep={projectLoadStatus}
          />
          <Toolbar
            onSelectTemplate={() => openStartDialog()}
            onDropInScreenshots={() => openStartDialog('quickstart')}
            onMakeGraphics={() => openStartDialog('graphics')}
            onMakeStoreArt={() => openCreativeDialog(false)}
            onPreview={() => openPreview('single')}
            onPreviewStore={() => openPreview('store')}
            onPreviewCompare={() => openPreview('compare')}
            canCompareLanguages={previewLocaleOptions.length > 1}
            onPublishToStore={() => setIsPublishDialogOpen(true)}
            onOpenGrowth={() => {
              // With new insights waiting, open on them, in an app that has some.
              if (growthMonitor.appIds.length > 0) {
                if (!growthMonitor.appIds.includes(getGrowthSettings().appId ?? '')) {
                  setGrowthSettings({ appId: growthMonitor.appIds[0] });
                }
                setGrowthOpen('insights');
              } else {
                setGrowthOpen('overview');
              }
            }}
            growthBadge={growthMonitor.unseen}
            onShareToDiscover={HAS_DISCOVER ? () => openDiscover('share') : undefined}
            // Undefined with no backend, which is what leaves the Share menu
            // holding only the community entry rather than growing three items
            // that answer "not available in this build".
            onSaveToCloud={isCloudAvailable ? () => void handleSaveToCloud() : undefined}
            onCopyProjectLink={isCloudAvailable ? () => void handleCopyProjectLink() : undefined}
            onOpenCloudProjects={
              isCloudAvailable ? () => openAccountDialog(undefined, 'cloud') : undefined
            }
            isSavingToCloud={isSavingToCloud}
            isCloudSignedIn={isCloudSignedIn}
            isProjectInCloud={!!cloudLink}
            isProjectShared={cloudLink?.visibility === 'link'}
            // Undefined with no session server, which leaves the Share menu
            // exactly as it was rather than offering something that cannot run.
            onEditTogether={
              isCloudAvailable && collab.isConfigured ? () => setIsCollabOpen(true) : undefined
            }
            // Named versions have to be reachable from where people save, not
            // only from a panel in the right dock they may never open.
            onSaveVersion={
              activeProjectId
                ? () => {
                    revealDockTab('versions');
                    void handleSaveNamedVersion(
                      `Version ${versions.filter((entry) => entry.kind === 'named').length + 1}`
                    );
                  }
                : undefined
            }
            collab={
              <CollabBar
                status={collab.status}
                me={collab.me}
                peers={collab.peers}
                onOpen={() => setIsCollabOpen(true)}
              />
            }
            onExport={() => {
              setExportScopedToArtboard(false);
              setIsExportDialogOpen(true);
            }}
            isAppPreviewProject={exportsAppPreview}
            onExportJSON={handleExportProjectAsJSON}
            onImportJSON={handleImportProjectFromJSON}
            // The account dialog is where the projects in storage are listed,
            // and where a signed-out user gets the sign-in first.
            onOpenFromAccount={() =>
              openAccountDialog(
                isAccountConnected
                  ? undefined
                  : 'Sign in to open a project from your own storage.',
                'storage'
              )
            }
            onSaveToAccount={handleSaveToAccount}
            isAccountConnected={isAccountConnected}
            isSavingToAccount={isSavingToAccount}
            onUpdateArtboardSize={handleUpdateArtboardSize}
            initialArtboardSize={getCurrentArtboardSize()}
            onSelectDeviceFormat={handleSelectDeviceFormat}
            activeDeviceFormat={activeDeviceFormat}
            onTranslate={() => {
              setTranslateElementId(null);
              setIsTranslateSingleArtboard(false);
              setIsTranslateDialogOpen(true);
            }}
            isTranslationEnabled={isTranslationEnabled}
            // The BASE document, never viewArtboards: the switcher counts
            // overrides, and a projection has already folded them away.
            artboards={artboards}
            activeLocale={activeLocale}
            onSelectLocale={handleSelectLocale}
            onManageLanguages={() => setIsLanguageManagerOpen(true)}
            onOpenTranslations={() => handleOpenTranslations('all')}
            onUpdateTranslations={handleUpdateTranslations}
            translationAvailable={translationAvailable}
            className="sticky top-0 z-50 bg-card border-b"
          />

          <LocalFontNotice
            families={importedFontsInProject}
            projectId={activeProjectId}
            onExportJson={handleExportProjectAsJSON}
          />

          {activeLocale && (
            <LocaleViewNotice
              locale={activeLocale}
              baseLocale={baseLocaleCode}
              untranslatedCount={untranslatedCount(artboards, activeLocale)}
              onBackToBase={() => handleSelectLocale(null)}
              onOpenTranslations={() => handleOpenTranslations('untranslated')}
              editScope={localeEditScope}
              onEditScopeChange={setLocaleEditScope}
            />
          )}

          {/* Main content area with flex layout */}
          <div className="flex flex-1 overflow-hidden h-full">
            {/* Canvas area - takes remaining space */}
            <div ref={canvasContainerRef} className="flex-1 relative overflow-hidden">
              <CreativeBoardActionsContext.Provider value={creativeBoardActions}>
              <CanvasArea
                artboards={viewArtboards}
                onUpdateArtboards={commitView}
                onUpdateBaseArtboards={handleCanvasStructuralChange}
                activeLocale={activeLocale}
                onAddElementToArtboard={handleAddElementToArtboard}
                onAddPreviewScene={handleAddPreviewScene}
                onAddCreativeLook={handleAddCreativeLook}
                onDropImageFiles={(files, point) => void handleCanvasImageDrop(files, point)}
                activeArtboardId={activeArtboardId}
                setActiveArtboardId={handleArtboardSelection}
                selectedElementIdOnActiveArtboard={selectedElementIdOnActiveArtboard}
                setSelectedElementIdOnActiveArtboard={handleElementSelectionOnArtboard}
                selectedElementIds={selectedElementIds}
                onSetSelectedElementIds={handleSelectElementIds}
                canvasZoom={canvasZoom}
                onZoomChange={setCanvasZoom}
                collabPeers={collab.peers}
                // Wired only during a session, so a pointer move costs nothing
                // when there is nobody to tell.
                onCollabCursor={collab.status === 'off' ? undefined : collab.setCursor}
                artboardRefs={artboardRefs}
                onAddNewArtboardFromToolbar={handleAddNewArtboardAfter}
                onDuplicateArtboardFromToolbar={handleDuplicateArtboard}
                onDeleteArtboardFromToolbar={handleDeleteArtboard}
                onMoveArtboardFromToolbar={handleMoveArtboard}
                onTranslateArtboard={handleTranslateArtboard}
                onExportArtboard={handleExportArtboard}
                activeTool={activeTool}
                isLoading={loadPhase === 'project' || (!!activeProjectId && artboards.length === 0)}
              />
              </CreativeBoardActionsContext.Provider>

              {/* Says what the open is doing, over the canvas rather than in the
                  2px bar at the top of the editor. Held back a beat inside the
                  component, so a local open that finishes immediately does not
                  flash a card. */}
              <ProjectLoadOverlay active={loadPhase === 'project'} status={projectLoadStatus} />

              {/* Full-width App Preview timeline, docked above the tool pill.
                  Shows itself whenever the selected board has motion. */}
              <PreviewTimelineBar
                artboards={viewArtboards}
                activeArtboardId={activeArtboardId}
                selectedElementId={selectedElementIdOnActiveArtboard}
                onSelectElement={(elementId) => handleElementSelectionOnArtboard(elementId)}
                onUpdateElement={handleUpdateElementById}
                onReorderElement={handleReorderElementNextTo}
                onSetDuration={handleSetPreviewDuration}
                onAddSound={handleAddSound}
              />
              <Input
                type="file"
                ref={soundFileInputRef}
                className="hidden"
                accept={AUDIO_ACCEPT}
                onChange={handleSoundFileChosen}
              />

              {/* Floating bar (bottom-left of canvas): the project name, which
                  used to sit in the top toolbar. Dropped on phones, where the
                  bottom row has only enough width for the tools and the zoom
                  pill; renaming stays available from the project list. */}
              <div className="absolute bottom-4 left-4 z-40 hidden items-center gap-2 md:flex">
                <ProjectNameField
                  currentProjectName={currentProjectName}
                  onRenameProject={handleRenameProject}
                  className="rounded-full border border-border bg-card/95 px-2 py-1 shadow-lg backdrop-blur"
                  // Inside the name's own pill, at the end of it: where the
                  // project is saved is a fact about the project. Renders
                  // nothing at all with no backend, or with auto save off.
                  trailing={
                    activeProjectId ? (
                      <>
                        <CloudAutoSaveChip
                          status={cloudAutoSave.status}
                          onSignIn={() =>
                            requireCloudSignIn('Sign in and this project is kept in your cloud on its own.')
                          }
                          onSaveNow={cloudAutoSave.saveNow}
                          onResolveConflict={(remote) => setCloudConflict(remote)}
                        />
                        {/* The second destination. Renders nothing at all until
                            somebody turns syncing on AND has saved this project
                            to their own storage, which is most of the time. */}
                        <AccountSyncChip
                          status={accountSync.status}
                          onConnect={() =>
                            openAccountDialog(
                              'Connect your storage again to keep this project up to date there.',
                              'storage'
                            )
                          }
                          onSyncNow={accountSync.syncNow}
                          onResolveConflict={(remote) => {
                            setConflictFromSync(true);
                            setSaveConflict(remote);
                          }}
                        />
                      </>
                    ) : undefined
                  }
                />
              </div>

              {/* Floating bar (bottom center of canvas): the select and pan
                  tools, then undo/redo, moved down from the top toolbar so they
                  sit with the canvas they act on. Undo and redo are two plain
                  buttons here rather than the dropdown they used to share:
                  the pill has the room, and one click beats two. */}
              {/* Centred on a desktop canvas; pushed to the left edge on a
                  phone so it and the zoom pill share the bottom row instead of
                  sitting on top of each other. */}
              <div className="absolute bottom-4 left-1/2 z-40 flex -translate-x-1/2 items-center gap-1 rounded-full border border-border bg-card/95 px-2 py-1 shadow-lg backdrop-blur max-md:left-3 max-md:translate-x-0">
                <Button
                  variant={activeTool === 'select' ? 'secondary' : 'ghost'}
                  size="icon"
                  className="h-8 w-8 rounded-full"
                  onClick={() => setActiveTool('select')}
                  title="Selection Tool (V)"
                >
                  <MousePointerIcon className="h-[1.1rem] w-[1.1rem]" />
                </Button>
                <Button
                  variant={activeTool === 'pan' ? 'secondary' : 'ghost'}
                  size="icon"
                  className="h-8 w-8 rounded-full"
                  onClick={() => setActiveTool('pan')}
                  title="Pan Tool (H, or hold Space to pan and release to go back)"
                >
                  <HandIcon className="h-[1.1rem] w-[1.1rem]" />
                </Button>

                <div className="mx-1 h-5 w-px bg-border" />

                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 rounded-full"
                  onClick={handleUndo}
                  disabled={historyIndex <= 0}
                  title="Undo (⌘Z)"
                >
                  <UndoIcon className="h-[1.1rem] w-[1.1rem]" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 rounded-full"
                  onClick={handleRedo}
                  disabled={historyIndex >= history.length - 1}
                  title="Redo (⇧⌘Z)"
                >
                  <RedoIcon className="h-[1.1rem] w-[1.1rem]" />
                </Button>
              </div>

              {/* MCP server status (desktop only; renders nothing on the web) */}
              {/* Floating bar (bottom-RIGHT of canvas): the zoom control, with
                  the MCP status beside it rather than stacked on top of it,
                  since that corner was already taken. */}
              <div className="absolute bottom-4 right-4 z-40 flex items-center gap-2">
                <div className="flex items-center gap-1 rounded-full border border-border bg-card/95 px-2 py-1 shadow-lg backdrop-blur">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 rounded-full"
                    onClick={() => setCanvasZoom(prev => Math.max(prev / 1.2, 0.1))}
                    title="Zoom Out"
                  >
                    <ZoomOutIcon className="h-[1.1rem] w-[1.1rem]" />
                  </Button>
                  <button
                    type="button"
                    onClick={() => setCanvasZoom(1)}
                    className="min-w-[48px] text-center text-xs font-semibold tabular-nums hover:text-primary"
                    title="Reset zoom to 100%"
                  >
                    {Math.round(canvasZoom * 100)}%
                  </button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 rounded-full"
                    onClick={() => setCanvasZoom(prev => Math.min(prev * 1.2, 4))}
                    title="Zoom In"
                  >
                    <ZoomInIcon className="h-[1.1rem] w-[1.1rem]" />
                  </Button>
                </div>

                {/* Renders nothing unless there is an MCP server to talk about
                    (always on desktop, on the web only when a relay is
                    configured). Hidden below md regardless: that corner has to
                    hold the zoom pill and the properties button on a phone. */}
                <div className="hidden md:block">
                  {/* Desktop reads the API through the bridge above; on the web
                      this component owns the connection, so it needs it too. */}
                  <McpServerStatus getApi={() => mcpApiRef.current} />
                </div>
              </div>

              {contextMenu && (
                <CanvasContextMenu
                  x={contextMenu.x}
                  y={contextMenu.y}
                  canCopy={!!contextMenu.elementId && !!contextMenu.artboardId}
                  canPaste={!!elementClipboard && !!(contextMenu.artboardId || activeArtboardId)}
                  canDelete={!!contextMenu.elementId && !!contextMenu.artboardId}
                  onCopy={() => handleCopyElement(contextMenu.artboardId, contextMenu.elementId)}
                  onPaste={() => handlePasteElement(contextMenu.artboardId, contextMenu.pastePoint)}
                  onDelete={() => handleDeleteElement(contextMenu.artboardId, contextMenu.elementId)}
                  canGroup={selectionGroupState.canGroup}
                  canUngroup={selectionGroupState.canUngroup}
                  onGroup={handleGroupSelection}
                  onUngroup={handleUngroupSelection}
                  spansArtboards={contextMenu.elementId ? selectionSpansArtboards : null}
                  onToggleSpanArtboards={() => handleUpdateSpan({ spanArtboards: !selectionSpansArtboards })}
                  sendTargets={sendTargets}
                  onSendLayers={(projectId, mode) => {
                    const { artboardId, elementId } = contextMenu;
                    if (!artboardId || !elementId) return;
                    // The whole selection when the menu was opened on part of
                    // it, the one layer otherwise, the way Copy decides.
                    const ids = selectedElementIds.includes(elementId) ? selectedElementIds : [elementId];
                    void sendLayersToTab(projectId, mode, artboardId, ids);
                  }}
                  onSendArtboard={
                    contextMenu.artboardId
                      ? (projectId, mode) => void sendArtboardToTab(projectId, mode, contextMenu.artboardId!)
                      : undefined
                  }
                  onClose={() => setContextMenu(null)}
                />
              )}
            </div>

            {/* Right dock: Agent (once it is on), Properties, History and
                Versions as tabs on top, Layers below, split by a draggable
                divider. Its left edge drags to widen it. Collapsed it becomes
                a slim vertical rail with rotated labels (Android Studio
                tool-window style).

                Any of it can also be torn off into a window of its own, which
                is what a second monitor is for. The panels themselves are
                RightDockPanels either way and this file owns only the chrome
                around them, so the docked stack and the detached one cannot
                drift apart.

                On a phone it is the same panel, moved: a 320px column beside a
                390px screen would leave the canvas 70px wide, so below `lg` it
                lifts out of the row and covers the bottom of the canvas like a
                sheet. No backdrop on purpose, so the element being edited stays
                visible while its properties are changed. */}
            {wholeDockDetached ? (
              // Everything is in another window, so the dock gives its width
              // back to the canvas and keeps only the two controls that matter:
              // find that window, or take it back.
              <div
                className="hidden h-full w-9 flex-shrink-0 flex-col items-center gap-1 border-l bg-card py-1.5 lg:flex"
                data-export-exclude
              >
                <PictureInPicture2Icon className="h-4 w-4 text-primary" aria-hidden="true" />
                <div className="mt-1 h-px w-5 bg-border" />
                <button
                  type="button"
                  className="rounded px-0.5 py-2 text-[11px] font-medium tracking-wide text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  style={{ writingMode: 'vertical-rl' }}
                  onClick={() => void dockHost.focus(PANEL_GROUP_ALL)}
                  title="Bring the panel window forward"
                >
                  Show panels
                </button>
                <button
                  type="button"
                  className="rounded px-0.5 py-2 text-[11px] font-medium tracking-wide text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  style={{ writingMode: 'vertical-rl' }}
                  onClick={() => void dockHost.reattach(PANEL_GROUP_ALL)}
                  title="Close the panel window and put the panels back here"
                >
                  Put back
                </button>
              </div>
            ) : dockOpen ? (
              <div
                className={cn(
                  "relative flex flex-col border-l bg-card",
                  // A variable rather than an inline width, so the phone
                  // sheet's max-lg:w-full still wins below lg. 40rem is the
                  // sidebar plus a canvas worth working in.
                  "h-full w-[var(--right-dock-width)] flex-shrink-0 lg:max-w-[calc(100vw-40rem)]",
                  "max-lg:fixed max-lg:inset-x-0 max-lg:bottom-0 max-lg:z-50 max-lg:h-[70svh] max-lg:w-full max-lg:rounded-t-2xl max-lg:border max-lg:shadow-2xl"
                )}
                style={{ '--right-dock-width': `${rightDockWidth}px` } as React.CSSProperties}
                data-export-exclude
              >
                {/* The left edge widens the dock beside the canvas. The phone
                    sheet is already full width, so it has none. */}
                <div
                  role="separator"
                  aria-orientation="vertical"
                  aria-label="Resize right panel"
                  title="Drag to resize, double-click to reset"
                  className="group absolute inset-y-0 -left-1 z-20 w-2 cursor-col-resize touch-none max-lg:hidden"
                  onPointerDown={(e) => {
                    e.preventDefault();
                    e.currentTarget.setPointerCapture(e.pointerId);
                    dockResizeRef.current = {
                      pointerId: e.pointerId,
                      startX: e.clientX,
                      startWidth: rightDockWidth,
                      lastWidth: rightDockWidth,
                    };
                  }}
                  onPointerMove={(e) => {
                    const drag = dockResizeRef.current;
                    if (!drag || drag.pointerId !== e.pointerId) return;
                    const max = Math.max(RIGHT_DOCK_WIDTH_MIN, Math.min(RIGHT_DOCK_WIDTH_MAX, window.innerWidth - 640));
                    const next = Math.round(
                      Math.min(max, Math.max(RIGHT_DOCK_WIDTH_MIN, drag.startWidth + (drag.startX - e.clientX)))
                    );
                    drag.lastWidth = next;
                    setRightDockWidth(next);
                  }}
                  onPointerUp={(e) => {
                    const drag = dockResizeRef.current;
                    if (!drag || drag.pointerId !== e.pointerId) return;
                    dockResizeRef.current = null;
                    saveRightDockWidth(drag.lastWidth);
                  }}
                  onPointerCancel={() => {
                    dockResizeRef.current = null;
                  }}
                  onDoubleClick={() => saveRightDockWidth(RIGHT_DOCK_WIDTH_MIN)}
                >
                  <div className="mx-auto h-full w-0.5 transition-colors group-hover:bg-primary/60 group-active:bg-primary" />
                  {/* Three dots on the border, always showing, so the edge reads
                      as something to grab before the pointer finds it. */}
                  <div
                    aria-hidden="true"
                    className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-[3px] rounded-full border bg-card px-px py-1"
                  >
                    {[0, 1, 2].map((dot) => (
                      <span
                        key={dot}
                        className="h-[3px] w-[3px] rounded-full bg-muted-foreground/70 transition-colors group-hover:bg-primary group-active:bg-primary"
                      />
                    ))}
                  </div>
                </div>
                <RightDockPanels
                  data={dockData}
                  handlers={dockHandlers}
                  panels={dockedPanels}
                  tab={rightDockTab}
                  onTabChange={selectRightDockTab}
                  layersHeight={layersHeight}
                  onLayersHeightChange={setLayersHeight}
                  onLayersHeightCommit={(height) => {
                    // The phone sheet's split is its own, so it is not saved
                    // over the docked-panel height a desktop session set.
                    if (isMobileViewport) return;
                    try { window.localStorage.setItem(RIGHT_DOCK_LAYERS_HEIGHT_KEY, String(height)); } catch {}
                  }}
                  headerActions={
                    <>
                      {/* Detaching and moving windows is a desktop-sized idea: a
                          phone has one screen and nowhere to put a second
                          window. */}
                      <DropdownMenu onOpenChange={(open) => { if (open) void refreshWindowMenu(); }}>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6 max-lg:hidden"
                            title="Panel and display options"
                            aria-label="Panel and display options"
                          >
                            <MoreHorizontalIcon className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-72">
                          {/* The way to the agent for a project that is already
                              open, without starting a new one from the dialog. */}
                          {claudeAgentState.available && !claudeAgentState.panelEnabled && (
                            <>
                              <DropdownMenuItem
                                className="gap-2"
                                onSelect={() => {
                                  if (!claudeAgent.setChatAgent('claude-code')) {
                                    void claudeAgent.newChat(undefined, { agent: 'claude-code' });
                                  }
                                  claudeAgent.setPanelEnabled(true);
                                  revealDockTab('agent');
                                }}
                              >
                                <ClaudeCodeLogo className="h-4 w-4" />
                                Chat with Claude Code
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                className="gap-2"
                                onSelect={() => {
                                  if (!claudeAgent.setChatAgent('codex')) {
                                    void claudeAgent.newChat(undefined, { agent: 'codex' });
                                  }
                                  claudeAgent.setPanelEnabled(true);
                                  revealDockTab('agent');
                                }}
                              >
                                <CodexLogo className="h-4 w-4" />
                                Chat with Codex
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                            </>
                          )}
                          <DropdownMenuItem
                            className="gap-2"
                            onSelect={() => detachPanels(PANEL_GROUP_ALL)}
                          >
                            <ExternalLinkIcon className="h-4 w-4 text-muted-foreground" />
                            Open all panels in a window
                          </DropdownMenuItem>
                          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                            Open one panel in a window
                          </DropdownMenuLabel>
                          {dockedPanels.map((panel) => (
                            <DropdownMenuItem
                              key={panel}
                              className="gap-2 pl-8 capitalize"
                              onSelect={() => detachPanels(panel)}
                            >
                              {panel}
                            </DropdownMenuItem>
                          ))}
                          {dockHost.detachedGroups.length > 0 && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                className="gap-2"
                                onSelect={() => {
                                  dockHost.detachedGroups.forEach((group) => void dockHost.reattach(group));
                                }}
                              >
                                <PanelRightCloseIcon className="h-4 w-4 text-muted-foreground" />
                                Put every panel back here
                              </DropdownMenuItem>
                            </>
                          )}
                          {dockHost.canAskForDisplays && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                className="gap-2"
                                onSelect={() => void dockHost.requestDisplayAccess()}
                              >
                                <MonitorIcon className="h-4 w-4 text-muted-foreground" />
                                Let this page see my other displays
                              </DropdownMenuItem>
                            </>
                          )}
                          {canPlaceWindows() && (
                            <MonitorMenuItems
                              monitors={dockHost.monitors}
                              currentId={editorMonitorId}
                              label="Move the editor to a display"
                              onPick={(monitor) => {
                                void moveWindowToMonitor('main', monitor).then(refreshWindowMenu);
                              }}
                            />
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6 max-lg:h-8 max-lg:w-8"
                        onClick={() => setDockOpen(false)}
                        title="Collapse right panel"
                        aria-label="Collapse right panel"
                      >
                        <PanelRightCloseIcon className="h-4 w-4 max-lg:hidden" />
                        <ChevronDownIcon className="hidden h-5 w-5 max-lg:block" />
                      </Button>
                    </>
                  }
                />
              </div>
            ) : (
              <>
                <div
                  className="hidden h-full w-9 flex-shrink-0 flex-col items-center gap-1 border-l bg-card py-1.5 lg:flex"
                  data-export-exclude
                >
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => setDockOpen(true)}
                    title="Expand right panel"
                    aria-label="Expand right panel"
                  >
                    <PanelRightOpenIcon className="h-4 w-4" />
                  </Button>
                  <div className="mt-1 h-px w-5 bg-border" />
                  {([
                    ...(agentEnabled ? [{ label: 'Agent', tab: 'agent' as const }] : []),
                    { label: 'Properties', tab: 'properties' as const },
                    { label: 'History', tab: 'history' as const },
                    { label: 'Versions', tab: 'versions' as const },
                    { label: 'Layers', tab: null },
                  ] as { label: string; tab: RightDockTab | null }[]).map(({ label, tab }) => (
                    <button
                      key={label}
                      type="button"
                      className="rounded px-0.5 py-2 text-[11px] font-medium tracking-wide text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                      style={{ writingMode: 'vertical-rl' }}
                      onClick={() => {
                        // Layers has no tab of its own. The chat hides the list
                        // while another tab is there, so asking for Layers from
                        // the chat moves to Properties, where the list shows.
                        if (tab) selectRightDockTab(tab);
                        else if (rightDockTab === 'agent') selectRightDockTab('properties');
                        setDockOpen(true);
                      }}
                      title={"Open " + label}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {/* The phone stand-in for that rail: 36px of vertical labels is
                    both wasted width on a 390px screen and a poor target. */}
                <Button
                  size="icon"
                  className="fixed bottom-[4.5rem] right-3 z-40 h-12 w-12 rounded-full shadow-lg lg:hidden"
                  onClick={() => {
                    // The chat has its own button just above; this one means
                    // the properties, so it does not reopen onto the chat.
                    if (rightDockTab === 'agent') selectRightDockTab('properties');
                    setDockOpen(true);
                  }}
                  title="Open properties"
                  aria-label="Open properties"
                  data-export-exclude
                >
                  <SlidersHorizontalIcon className="h-5 w-5" />
                </Button>
                {agentEnabled && (
                  <Button
                    size="icon"
                    variant="outline"
                    className="fixed bottom-[8.5rem] right-3 z-40 h-12 w-12 rounded-full bg-card shadow-lg lg:hidden"
                    onClick={() => {
                      selectRightDockTab('agent');
                      setDockOpen(true);
                    }}
                    title="Open agent chat"
                    aria-label="Open agent chat"
                    data-export-exclude
                  >
                    {agentKind === 'codex' ? <CodexLogo className="h-5 w-5" /> : <ClaudeCodeLogo className="h-5 w-5" />}
                  </Button>
                )}
              </>
            )}
          </div>

          {isPreviewOpen && (
            <PreviewDialog
              artboards={viewArtboards}
              baseArtboards={artboards}
              localeOptions={previewLocaleOptions}
              activeLocale={activeLocale}
              onSelectLocale={handleSelectLocale}
              initialArtboardId={activeArtboardId}
              projectName={currentProjectName}
              initialMode={previewMode}
              onClose={() => setIsPreviewOpen(false)}
              onAddStoreArt={() => openCreativeDialog(true)}
            />
          )}

          <CreativeAssetsDialog
            isOpen={isCreativeDialogOpen}
            onOpenChange={(open) => {
              setIsCreativeDialogOpen(open);
              // Cancelled from the store preview: back to where the user was.
              if (!open && creativeReturnsToStoreRef.current) {
                creativeReturnsToStoreRef.current = false;
                openPreview('store');
              }
            }}
            artboards={artboards}
            projectName={currentProjectName}
            onAdd={handleAddCreativeBoards}
          />

          {/* App Preview boards get their own dialog: video first, no App
              Store screenshot-size generation (meaningless for a video board),
              PNG demoted to a still. The selected board decides, so a screenshot
              board in the same project still opens the original dialog. */}
          {exportsAppPreview ? (
            <AppPreviewExportDialog
              isOpen={isExportDialogOpen}
              onOpenChange={setIsExportDialogOpen}
              videoBoardCount={videoBoards.length}
              suggestedVideoDuration={suggestedVideoDuration}
              hasRecording={videoBoards.some((ab) => videoInfos[ab.id]?.hasVideo)}
              onExportVideo={handleExportVideo}
              onCancelVideoExport={handleCancelVideoExport}
              onExportStills={(currentArtboardOnly) =>
                handleConfirmExport({ asIs: true, generateFormats: [], currentArtboardOnly })
              }
              videoProgress={videoProgress}
              isVideoExporting={isVideoExporting}
              activeArtboardName={activeArtboardName ?? null}
              artboardCount={artboards.length}
              defaultCurrentArtboardOnly={exportScopedToArtboard}
            />
          ) : (
            <ExportDialog
              isOpen={isExportDialogOpen}
              onOpenChange={setIsExportDialogOpen}
              onConfirmExport={(selection) =>
                handleConfirmExport(selection, { skipAppPreviewBoards: true })
              }
              onPublishToStore={() => {
                setIsExportDialogOpen(false);
                setIsPublishDialogOpen(true);
              }}
              currentFormat={activeDeviceFormat}
              currentSize={screenshotBoards(artboards)[0]?.size ?? artboards[0]?.size}
              activeArtboard={activeArtboardSummary}
              artboardCount={artboards.length - appPreviewBoardCount}
              appPreviewBoardCount={appPreviewBoardCount}
              creativeBoardCount={creativeBoards(artboards).length}
              defaultCurrentArtboardOnly={exportScopedToArtboard}
              artboards={artboards}
              activeLocale={activeLocale}
            />
          )}

          <ExportProgressDialog
            progress={pngProgress}
            onCancel={handleCancelPngExport}
            isCancelling={isCancellingPngExport}
          />

          <TranslateProgressDialog
            progress={translateProgress}
            onCancel={handleCancelTranslation}
            isCancelling={isCancellingTranslate}
          />

          <PublishDialog
            isOpen={isPublishDialogOpen}
            onOpenChange={setIsPublishDialogOpen}
            // Header and search art goes to App Store Connect's Asset Library,
            // not to a screenshot slot, so it is not offered here.
            artboards={publishArtboards}
            activeLocale={activeLocale}
            onCapture={handlePublishCapture}
            onCaptureVideos={handlePublishCaptureVideos}
            projectId={activeProjectId}
            projectName={currentProjectName}
            onOpenGrowth={() => setGrowthOpen('overview')}
          />

          <LanguageManagerDialog
            open={isLanguageManagerOpen}
            onOpenChange={(open) => {
              setIsLanguageManagerOpen(open);
              if (!open) setLanguagePreselect(undefined);
            }}
            artboards={artboards}
            translationAvailable={translationAvailable}
            onApply={(next, opts) => void handleApplyLanguages(next, opts)}
            preselect={languagePreselect}
          />

          <GrowthDialog
            open={growthOpen !== null}
            initialTab={growthOpen ?? undefined}
            onOpenChange={(open) => {
              if (!open) setGrowthOpen(null);
            }}
            onPublish={() => setIsPublishDialogOpen(true)}
            onLocalize={(storeLocales) => {
              const codes = storeLocales
                .map((storeLocale) => localeForAppleLocale(storeLocale))
                .filter((code): code is string => !!code);
              if (artboards.length === 0) {
                toast({ title: 'Open a project first', description: 'The screenshots to translate live in a project.' });
                return;
              }
              setLanguagePreselect(codes);
              setIsLanguageManagerOpen(true);
            }}
            onAskAgent={
              claudeAgentState.available && !isSecondaryWindow
                ? (question) => {
                    const { session, chat } = claudeAgentState;
                    if (session.status === 'working' || session.status === 'starting') {
                      claudeAgent.setPanelEnabled(true);
                      revealDockTab('agent');
                      toast({ title: 'The agent is busy', description: 'Wait for it to finish, or stop it in the Agent tab, then ask again.' });
                      return;
                    }
                    track('growth_ask_agent');
                    void (async () => {
                      // A question about the numbers starts a chat of its own
                      // rather than landing in the middle of a design chat.
                      if (session.items.length > 0) await claudeAgent.newChat(undefined, { agent: chat.agent });
                      claudeAgent.setPanelEnabled(true);
                      revealDockTab('agent');
                      if (isMobileViewport) setIsMobileDockOpen(true);
                      await claudeAgent.send({
                        text: `${question}\n\nRead my App Store numbers with the store tools first (get_store_overview, then the others as needed).`,
                      });
                    })().catch((error) =>
                      toast({
                        title: 'The agent could not take the question',
                        description: error instanceof Error ? error.message : 'Try again in the Agent tab.',
                      })
                    );
                  }
                : undefined
            }
            onOpenProject={(projectId) => {
              void db.projects.get(projectId).then((project) => {
                if (!project) {
                  toast({ title: 'That project is no longer on this device', description: 'It may have been deleted since the upload.' });
                  return;
                }
                // The way a tab click opens it, live session question included.
                handleActivateTab(projectId);
              });
            }}
          />

          <TranslationTableDialog
            open={isTranslationTableOpen}
            onOpenChange={setIsTranslationTableOpen}
            artboards={artboards}
            translationAvailable={translationAvailable}
            initialLocale={translationTableLocale}
            initialFilter={translationTableFilter}
            onSave={handleSaveTranslations}
            // Deliberately does NOT commit: the dialog adopts the result as its
            // new snapshot and it lands with everything else on Save.
            onMachineTranslate={(locale, only) => runLocaleTranslation(locale, only)}
          />

          <SettingsDialog
            open={isSettingsOpen}
            onOpenChange={setIsSettingsOpen}
            // Handed over rather than stacked: two modal dialogs at once fight
            // over the focus trap, and the wizard is a full screen of its own.
            onOpenTips={() => {
              setIsSettingsOpen(false);
              setIsTipsOpen(true);
            }}
          />

          <TipsDialog
            open={isTipsOpen}
            onOpenChange={setIsTipsOpen}
            onConnectStorage={() => {
              setIsTipsOpen(false);
              openAccountDialog('Connect Google Drive or GitHub to keep a copy of your projects.');
            }}
          />

          {/* The community feed, served from the PocketBase backend in
              infra/vps. It shares the canvas: the boards it posts are captured
              from the live DOM by the same routine the PNG export uses, so it
              is handed viewArtboards, the list actually on screen, not the base
              document.

              Reading it needs no account. Posting, commenting, liking and
              saving do, and the session for that is minted from whichever
              storage account is connected — which is why a sign-in prompt in
              there opens this same account dialog rather than a second one. */}
          {HAS_DISCOVER && (
          <DiscoverDialog
            open={isDiscoverOpen}
            onOpenChange={(open) => {
              setIsDiscoverOpen(open);
              if (!open) {
                clearPostParamFromUrl();
                setDiscoverIntent('feed');
              }
            }}
            initialView={discoverIntent}
            templates={availableProjects}
            isLoadingTemplates={isLoadingProjects}
            initialPostId={discoverPostId}
            onInitialPostConsumed={() => setDiscoverPostId(null)}
            onUseTemplate={(post) => void handleUseDiscoverPost(post)}
            projectName={currentProjectName}
            artboards={viewArtboards}
            captureArtboard={captureArtboardDataUrl}
            onRequestSignIn={openAccountDialog}
          />
          )}

          {/* Both project lists live in here: the ones on our backend, and the
              ones in storage the user owns. `cloud` is undefined with no
              backend configured, which collapses it back to the single list it
              has always shown. */}
          <AccountDialog
            open={isAccountOpen}
            onOpenChange={(open) => {
              setIsAccountOpen(open);
              if (!open) setAccountHint(undefined);
            }}
            hint={accountHint}
            initialTab={accountTab}
            onOpenProject={handleOpenFromAccount}
            cloud={
              isCloudAvailable
                ? {
                    isSignedIn: isCloudSignedIn,
                    activeProjectId,
                    activeProjectName: currentProjectName,
                    isSaving: isSavingToCloud,
                    onSave: () => void handleSaveToCloud(),
                    onOpenProject: handleOpenCloudProject,
                    localProjectIds,
                  }
                : undefined
            }
          />

          <SaveToAccountDialog
            open={!!saveConflict}
            onOpenChange={(open) => {
              if (!open) {
                setSaveConflict(null);
                setConflictFromSync(false);
              }
            }}
            existingName={saveConflict?.name ?? ''}
            existingModifiedAt={saveConflict?.modifiedAt}
            suggestedName={`${currentProjectName} copy`}
            storageLabel={accountStorageLabel}
            isSaving={isSavingToAccount}
            changedElsewhere={conflictFromSync}
            onStopSyncing={conflictFromSync ? handleStopSyncingProject : undefined}
            onReplace={() => void runAccountSave()}
            onSaveCopy={(name) => void runAccountSave(name)}
          />

          <CollabDialog
            open={isCollabOpen}
            onOpenChange={setIsCollabOpen}
            status={collab.status}
            inviteUrl={collabInviteUrl}
            me={collab.me}
            peers={collab.peers}
            isWorking={isCollabWorking}
            error={collab.error}
            onCreate={() => void startCollabSession()}
            onCopy={() => void copyCollabUrl(collabInviteUrl ?? '')}
            onLeave={() => collab.stop()}
            onReset={() => void startCollabSession({ rotate: true })}
          />

          <CloudSaveConflictDialog
            open={!!cloudConflict}
            onOpenChange={(open) => {
              if (!open) setCloudConflict(null);
            }}
            remote={cloudConflict}
            isSaving={isSavingToCloud}
            onOverwrite={() => void runCloudSave(true)}
            onOpenRemote={() => {
              const remote = cloudConflict;
              setCloudConflict(null);
              if (remote) void handleOpenCloudProject(remote, false);
            }}
          />

          <TranslateDialog
            isOpen={isTranslateDialogOpen}
            onOpenChange={(open) => {
              setIsTranslateDialogOpen(open);
              if (!open) setTranslateElementId(null);
            }}
            currentLanguage={translateElementId ? translateElementArtboard?.language : currentProjectLanguage}
            disableAllArtboardsOption={isTranslateSingleArtboard}
            scope={translateElementId ? 'element' : 'project'}
            projectHasLanguages={hasLocales(artboards)}
            onOpenTranslations={() => {
              setIsTranslateDialogOpen(false);
              handleOpenTranslations('all');
            }}
            onTranslate={handleTranslateRequest}
          />

          <Dialog open={isAboutOpen} onOpenChange={setIsAboutOpen}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <div className="flex items-center gap-3">
                  <Logo withBackground className="h-12 w-12" />
                  <div className="text-left">
                    <DialogTitle>Open Screenshot Generator</DialogTitle>
                    <DialogDescription>Version {packageJson.version}</DialogDescription>
                  </div>
                </div>
              </DialogHeader>
              <div className="space-y-3 text-sm text-muted-foreground">
                <p>
                  A free, open-source editor for designing app store screenshots. Lay out artboards,
                  drop your screenshots into device frames, automatically translate your text into 50+ languages, and export PNGs sized for Google Play
                  and the Apple App Store.
                </p>
                <p>Projects are saved locally in your browser. Nothing is uploaded anywhere.</p>
              </div>
              {/* Desktop: where updates stand, and the button that acts on it. */}
              <AboutUpdateStatus />
              <DialogFooter className="gap-2 sm:justify-between">
                <Button variant="outline" asChild>
                  <a
                    href={REPO_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => {
                      // WebViews ignore target=_blank; route to the system browser
                      if (isTauri()) {
                        e.preventDefault();
                        openExternal(REPO_URL);
                      }
                    }}
                  >
                    <GithubMark className="mr-2" />
                    View on GitHub
                  </a>
                </Button>
                <Button onClick={() => setIsAboutOpen(false)}>Close</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </SidebarInset>
      </SidebarProvider>
    </>
  );
}

