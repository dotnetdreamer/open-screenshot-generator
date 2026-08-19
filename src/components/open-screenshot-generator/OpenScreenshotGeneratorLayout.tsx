"use client";
import React, { useState, useEffect, useLayoutEffect, useCallback, useMemo, useRef, useDeferredValue } from 'react';
import { captureNodeToPng } from '@/lib/exportRaster';
import { preloadGoogleFonts } from '@/services/fontService';
import { loadCustomFonts, useCustomFonts } from '@/services/customFonts';
import { isTauri, sanitizeFileName, saveBlobToDisk, saveBlobToPath, saveDataUrlToDisk, saveDataUrlToPath, pickExportDirectory, openExternal, fetchWebviewCrashInfo } from '@/lib/desktop';
import { analyzeArtboardForVideo, exportArtboardVideo, projectHasVideoContent, type ArtboardVideoInfo } from '@/lib/video/videoExport';
import { stopPlayback } from '@/lib/video/playback';
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
import { PropertiesPanel } from './PropertiesPanel';
import { PreviewDialog, type PreviewLocaleOption, type PreviewMode } from './PreviewDialog';
import { TranslateDialog, getLanguageName } from './TranslateDialog';
import { LanguageManagerDialog } from './LanguageManagerDialog';
import { LocaleViewNotice } from './LocaleViewNotice';
import { TranslationTableDialog } from './TranslationTableDialog';
import { translateText, detectLanguage, isTranslationEnabled, AUTO_DETECT } from '@/services/translation';
import { Logo } from './Logo';
import { GithubMark, REPO_URL } from './GithubLink';
import type { ArtboardState, ElementLocaleOverride, ElementType, Point, ProjectLocalization, ShapeType, DeviceType, ArtboardElement, TextElementProps, ShapeElementProps, DeviceFrameElementProps, ImageElementProps, VideoElementProps, VideoDeviceElementProps, GestureElementProps, GestureType, Project, Size } from '@/types/artboard';
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
import { AppPreviewExportDialog } from './AppPreviewExportDialog';
import { ExportProgressDialog, type PngExportProgress } from './ExportProgressDialog';
import { TranslateProgressDialog, type TranslateProgress } from './TranslateProgressDialog';
import { ALL_CANVAS_SIZE_PRESETS, canvasSizeSlug } from '@/lib/sizePresets';
import { artboardBackground } from '@/lib/artboardBackground';
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
import { ProjectNameField } from './ProjectNameField';
import { decodeDataUrl, type PublishImage } from '@/lib/publish';
import { trackTemplateSelected, trackDeviceFormatSelected, trackExportPng, trackExportVideo, trackExportJson } from '@/lib/analytics';

import { AgentPromoBanner } from './start/AgentPromoBanner';
import { BlankCanvasCard } from './start/BlankCanvasCard';
import { AgentStartScreen } from './start/AgentStartScreen';
import { TipsDialog, shouldShowTipsOnStartup } from './TipsDialog';
import { SettingsDialog } from './SettingsDialog';
import { DiscoverDialog } from './discover/DiscoverDialog';
import { isDiscoverConfigured, useDiscoverSession } from '@/lib/discover/session';
import { CommunityStartPanel } from './discover/CommunityStartPanel';
import type { DiscoverPost } from '@/types/discover';
import { CloudSaveConflictDialog } from './cloud/CloudSaveConflictDialog';
import {
  buildShareUrl,
  clearSharedSlugFromUrl,
  getCloudLink,
  loadProjectFromCloud,
  openSharedProject,
  readSharedSlugFromUrl,
  saveProjectToCloud,
  setCloudProjectShared,
  CloudConflictError,
  CloudSignInRequiredError,
  type CloudProject,
  type CloudProjectLink,
} from '@/lib/cloud';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ChevronDownIcon, ChevronLeftIcon, CompassIcon, CopyIcon, HandIcon, InfoIcon, Loader2Icon, MousePointerIcon, PanelRightCloseIcon, PanelRightOpenIcon, RedoIcon, SearchIcon, SettingsIcon, SlidersHorizontalIcon, UndoIcon, UserIcon, ZoomInIcon, ZoomOutIcon } from 'lucide-react';
import { AccountDialog } from './account/AccountDialog';
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
  serializeProject,
  splitProgress,
  useAccount,
  type CloudProjectSummary,
} from '@/lib/account';
import { LayersPanel } from './LayersPanel';
import { HistoryPanel } from './HistoryPanel';
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
import { LoadStatusBar, type ProjectLoadStep } from './LoadStatusBar';
import { LocalFontNotice } from './LocalFontNotice';
import { ProjectLoadOverlay } from './ProjectLoadOverlay';
import packageJson from '../../../package.json';
import { useToast } from '@/hooks/use-toast';
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
import { useClipboard, ClipboardProvider } from '@/contexts/ClipboardContext';
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
const RIGHT_DOCK_LAYERS_HEIGHT_KEY = 'abs-right-dock-layers-height';
const RIGHT_DOCK_TAB_KEY = 'abs-right-dock-tab';
const LAYERS_SECTION_MIN = 120; // px, keeps the layers list usable
// The dock is a bottom sheet on a phone and only 70% of a short screen tall, so
// the layers list starts shorter there than the desktop split. A starting
// height, not a cap: capping it is what made the divider look broken on touch,
// since dragging changed the number and nothing moved.
const MOBILE_LAYERS_SECTION_DEFAULT = 170; // px
// How long the "that applied to every language" notice stays quiet after showing.
// Long enough not to fire on every nudge of a drag, short enough that a user who
// keeps making shared edits keeps being told.
const SHARED_EDIT_NOTICE_INTERVAL_MS = 30_000;
const PROPERTIES_SECTION_MIN = 160; // px, keeps the properties form usable

let historyEntrySeq = 0;

// One history state: the change's name plus the snapshot it restores. The
// snapshot is deep-copied here so later edits to the live artboards can never
// reach back into a recorded state. One stringify serves both the copy and the
// entry's byte size, which is what the HISTORY_MAX_BYTES cap trims against.
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
async function fetchRecentProjectMetas(): Promise<Project[]> {
  const rows = await db.projects.orderBy('timestamp').reverse().toArray();
  return rows.map((row) => ({ ...row, projectData: [] }));
}

// Update the function with reduced margin
function calculateArtboardPositions(artboards: ArtboardState[]): ArtboardState[] {
  let currentX = ARTBOARD_MARGIN;
  console.log("Calculating positions for artboards:", artboards.length);
  return artboards.map((ab, index) => {
    const newPosition = { x: currentX, y: ARTBOARD_MARGIN };
    console.log(`Artboard ${index}: size=${ab.size.width}x${ab.size.height}, position=${newPosition.x},${newPosition.y}`);
    
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

// A one-artboard "Blank Canvas" project at the given size. `size` follows the
// active template tab so a blank Feature Graphic is 1024×500, not a phone.
function createBlankProject(size: Size = { width: 1290, height: 2796 }): Project {
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
  const [artboards, setArtboards] = useState<ArtboardState[]>([]);
  const [activeArtboardId, setActiveArtboardId] = useState<string | null>(null);
  const [canvasZoom, setCanvasZoom] = useState(1);

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
  // Which screen of the start dialog is showing. The template gallery is the
  // dialog, as it always was; the agent is a screen you step into from the
  // banner above it. Reset on open so reopening never lands mid-agent-flow.
  const [dialogView, setDialogView] = useState<'templates' | 'agent'>('templates');
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
  const artboardRefs = useRef<Record<string, any>>({});
  // Latest design-tool API for the desktop MCP server; assigned each render and
  // read per request by the bridge (see the block above the render return).
  const mcpApiRef = useRef<McpDesignApi | null>(null);
  const [selectedElementIdOnActiveArtboard, setSelectedElementIdOnActiveArtboard] = useState<string | null>(null);
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

  // Start the desktop MCP bridge (desktop only): handle requests the Rust
  // transport forwards, and surface the connection URL when the user toggles
  // the server on from the Settings menu.
  useEffect(() => {
    if (!isTauri()) return;
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
  const [currentProjectName, setCurrentProjectName] = useState<string>('Untitled Project');
  const [recentProjects, setRecentProjects] = useState<Project[]>([]);
  const [recentProjectSearch, setRecentProjectSearch] = useState('');
  const [projectToDelete, setProjectToDelete] = useState<string | null>(null);
  // Set while a recent-projects row is being copied, so its button can show a
  // spinner: bundling a project reads every media blob out of Dexie.
  const [duplicatingProjectId, setDuplicatingProjectId] = useState<string | null>(null);
  const [clipboardElement, setClipboardElement] = useState<ArtboardElement | null>(null);
  const [isLoadingTemplate, setIsLoadingTemplate] = useState(false);
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
  // as the sidebar's About option (settings.rs emits abs-open-about).
  useEffect(() => {
    if (!isTauri()) return;
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
  // Which of the dock's top-section tabs is showing: the properties form or
  // the project's history states.
  const [rightDockTab, setRightDockTab] = useState<'properties' | 'history'>('properties');
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
      if (window.localStorage.getItem(RIGHT_DOCK_TAB_KEY) === 'history') setRightDockTab('history');
      const stored = parseInt(window.localStorage.getItem(RIGHT_DOCK_LAYERS_HEIGHT_KEY) ?? '', 10);
      if (Number.isFinite(stored)) {
        setLayersSectionHeight(Math.max(LAYERS_SECTION_MIN, Math.min(700, stored)));
      }
    } catch {}
  }, []);
  const dockContentRef = useRef<HTMLDivElement | null>(null);
  const dividerDragRef = useRef<{ pointerId: number; startY: number; startHeight: number; lastHeight: number } | null>(null);

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

  const selectRightDockTab = (tab: 'properties' | 'history') => {
    setRightDockTab(tab);
    try { window.localStorage.setItem(RIGHT_DOCK_TAB_KEY, tab); } catch {}
  };
  const { clipboardItem, copyToClipboard } = useClipboard();
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
      setIsTemplateSelectorOpen(true);
    }
 }, [activeProjectId]); // Depend on activeProjectId to react to potential initial load via URL (future)

 // Effect to load project when activeProjectId changes
  useEffect(() => {
    if (!activeProjectId && artboards.length === 0) {
      setIsTemplateSelectorOpen(true);
    }

    const loadProject = async () => {
      if (activeProjectId && !isLoadingTemplate) {
        setLoadPhase('project');
        try {
          // Commit any debounced edits of the outgoing project before the
          // switch, so nothing of it is lost or written after we move on.
          flushProjectSave();
          const project = await db.projects.get(activeProjectId);
          if (project && project.projectData) {
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
            setArtboards(projectData);
            setCurrentProjectName(project.name || 'Untitled Project');
            setHistory([makeHistoryEntry(projectData, namedChange('Open', 'open', project.name || undefined))]);
            setHistoryIndex(0);
            // Auto-select the first artboard so a refreshed project opens ready to
            // edit (matches loadProjectFromData, the click-a-template path). Without
            // this, refreshing into ?projectId left nothing selected.
            setActiveArtboardId(projectData.length > 0 ? projectData[0].id : null);
            setSelectedElementIdOnActiveArtboard(null);
            setIsTemplateSelectorOpen(false); // Close template selector if a project is loaded
          } else {
            console.warn(`Project with ID ${activeProjectId} not found.`);
            setActiveProjectId(null); // Clear active project state
            toast({ title: "Project Not Found", description: "The selected project could not be loaded.", variant: "destructive" });
            setIsTemplateSelectorOpen(true); // Re-open template selector
          }
        } catch (error) {
          console.error("Error loading project from Dexie:", error);
          setActiveProjectId(null); // Clear active project state on error
          toast({ title: "Loading Error", description: "Failed to load project. See console for details.", variant: "destructive" });
          setIsTemplateSelectorOpen(true); // Re-open template selector on error
        } finally {
          setLoadPhase('idle');
        }
      }
    };
    loadProject();
 }, [activeProjectId, isLoadingTemplate, toast, setIsTemplateSelectorOpen]); // Added isLoadingTemplate dependency
  /**
   * Record a new history state. `change` names the command when the caller
   * knows it (Paste, Convert to iPhone 15); otherwise the name is recovered by
   * diffing against the previous snapshot, which is what gives canvas drags and
   * properties-panel edits their labels without every call site being touched.
   *
   * Continuous tweaks (a slider fires an update per pixel) collapse into the
   * state they started, so one gesture is one entry in the panel and one undo.
   */
  const pushToHistory = (newArtboardsState: ArtboardState[], change?: HistoryChange) => {
    const trimmed = history.slice(0, historyIndex + 1);
    const previous = trimmed[trimmed.length - 1];
    const described = change ?? describeArtboardsChange(previous?.artboards ?? [], newArtboardsState);
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
   * target IS the open project: handleArtboardsUpdate's db.projects.put is
   * fire and forget, so the row can lag the editor by a tick and a naive copy
   * would quietly drop the last edit.
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
      if (project.id === activeProjectId) {
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

  // Debounced project save (issue #19). A slider can commit per pixel, and each
  // commit used to serialize the whole project and rewrite the full IndexedDB
  // row on the spot: hundreds of stringify+structured-clone passes per gesture.
  // Commits now only schedule; the row is written once the edits go quiet.
  // The scheduled row captures id/name/artboards at schedule time, so a save
  // that fires after a project switch still writes the right data to the right
  // row. Flushed early on unload and before a project switch or duplicate.
  const pendingSaveRef = useRef<{
    timer: ReturnType<typeof setTimeout>;
    id: string;
    name: string;
    artboards: ArtboardState[];
  } | null>(null);
  // Returns the put's promise so close paths can wait for durability; readers
  // that follow up with db.projects.get need not await it, since IndexedDB
  // runs overlapping-scope transactions in creation order.
  const flushProjectSave = useCallback((): Promise<unknown> => {
    const pending = pendingSaveRef.current;
    if (!pending) return Promise.resolve();
    pendingSaveRef.current = null;
    clearTimeout(pending.timer);
    return db.projects.put({
      id: pending.id,
      name: pending.name,
      timestamp: new Date(),
      projectData: JSON.parse(JSON.stringify(pending.artboards)),
    }).catch((error) => {
      console.error("Error saving project to Dexie:", error);
    });
  }, []);
  const scheduleProjectSave = useCallback((id: string, name: string, artboardsToSave: ArtboardState[]) => {
    if (pendingSaveRef.current) clearTimeout(pendingSaveRef.current.timer);
    const timer = setTimeout(() => flushProjectSave(), 600);
    pendingSaveRef.current = { timer, id, name, artboards: artboardsToSave };
  }, [flushProjectSave]);
  // Unload must not lose the last half-second of edits. `pagehide` covers the
  // web; a Tauri window close destroys the webview WITHOUT any unload events,
  // so the desktop shell needs the window's close-requested hook, where the
  // put can actually be awaited before the close proceeds.
  useEffect(() => {
    const flush = () => flushProjectSave();
    window.addEventListener('pagehide', flush);
    let disposed = false;
    let unlistenClose: (() => void) | undefined;
    if (isTauri()) {
      (async () => {
        try {
          const { getCurrentWindow } = await import('@tauri-apps/api/window');
          const unlisten = await getCurrentWindow().onCloseRequested(async () => {
            // Not prevented: the close proceeds after the write settles.
            await flushProjectSave();
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

  const handleArtboardsUpdate = useCallback((updatedArtboards: ArtboardState[], change?: HistoryChange) => {
    console.log("handleArtboardsUpdate called", activeProjectId);
    // An export has a converted or re-projected list on the canvas. A commit
    // arriving now (an MCP tool, a drag settling on mouseup) would be measured
    // against that temporary render and persist it as the project.
    if (isExportingRef.current) {
      console.warn('Ignoring an artboard update while an export is swapping the canvas.');
      return;
    }
    const repositionedArtboards = calculateArtboardPositions(updatedArtboards);
    setArtboards(repositionedArtboards); // Update React state first

    const saveProject = async () => {
      let projectIdToSave = activeProjectId;
      if (!projectIdToSave) {
        // Generate a new ID only if there is no active project
        projectIdToSave = Date.now().toString();
        // Set a random project name for new projects
        setCurrentProjectName(generateRandomProjectName());
      }

      scheduleProjectSave(projectIdToSave, currentProjectName, repositionedArtboards);

      if (activeProjectId !== projectIdToSave) {
        setActiveProjectId(projectIdToSave); // Set the new active project ID if it was just created
      }
    };
    if (activeArtboardId && !repositionedArtboards.find(ab => ab.id === activeArtboardId)) {
        setActiveArtboardId(null);
        setSelectedElementIdOnActiveArtboard(null);
    }
    if (activeArtboardId && selectedElementIdOnActiveArtboard) {
        const currentAb = repositionedArtboards.find(ab => ab.id === activeArtboardId);
        if (currentAb && !currentAb.elements.find(el => el.id === selectedElementIdOnActiveArtboard)) {
            setSelectedElementIdOnActiveArtboard(null);
        }
    }
    saveProject(); // Call the async save function
    pushToHistory(repositionedArtboards, change);
  }, [activeArtboardId, selectedElementIdOnActiveArtboard, activeProjectId, currentProjectName, history, historyIndex, setActiveProjectId]);

  // Board background, name and the rest of the board-level form. It used to run
  // its own db.projects.put and skip repositioning; folding it into the door
  // above is what makes "handleArtboardsUpdate is the only door" true, which is
  // the invariant the locale overlay rests on.
  const handleUpdateArtboardDetails = useCallback((updates: Partial<ArtboardState>) => {
    if (!activeArtboardId) return;
    handleArtboardsUpdate(
      artboardsRef.current.map((ab) => (ab.id === activeArtboardId ? { ...ab, ...updates } : ab))
    );
  }, [activeArtboardId, handleArtboardsUpdate]);

  // What the active language shows. Board count, board order and board ids are
  // identical to the base document; only the handful of keys in
  // LOCALIZABLE_KEYS can differ, plus elements hidden in this language.
  const viewArtboards = useMemo(
    // An export swap is ALREADY resolved for the language it is capturing.
    // Projecting it again would lay the language on screen over the language
    // being exported, which is how you get German text in the Japanese set.
    () => exportCanvasArtboards ?? projectArtboards(artboards, activeLocale),
    [exportCanvasArtboards, artboards, activeLocale]
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
    handleArtboardsUpdate(
      next,
      described ? { ...described, label: `${described.label} (all languages)` } : undefined
    );
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
      handleArtboardsUpdate(next, namedChange(label, 'translate', localeLabel(locale)));
    }
  }, [handleArtboardsUpdate, runLocaleTranslation, toast]);

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
    handleArtboardsUpdate(
      boards,
      namedChange('Add Languages', 'translate', `${next.locales.length} languages`)
    );
    // Viewing a language that was just removed would show a projection of a
    // locale the project no longer has.
    const viewing = activeLocaleRef.current;
    if (viewing && !next.locales.some((entry) => entry.code === viewing)) {
      handleSelectLocale(null);
    }
  }, [handleArtboardsUpdate, handleSelectLocale]);

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
      handleArtboardsUpdate(next, namedChange('Update Translations', 'translate', localeLabel(locale)));
    }
  }, [handleArtboardsUpdate, runLocaleTranslation, toast]);

  // One commit for a whole bulk-entry session, so undo restores all of it.
  const handleSaveTranslations = useCallback((next: ArtboardState[], editedCount: number) => {
    handleArtboardsUpdate(next, namedChange('Edit Translations', 'translate', `${editedCount} strings`));
  }, [handleArtboardsUpdate]);

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

  // The project's current device format (phone platform or Play Store
  // tablet), null when mixed/none — drives the Toolbar Devices menu's button
  // label and checkmarks.
  const activeDeviceFormat = useMemo(() => {
    const format = detectArtboardsFormat(artboards);
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
    handleArtboardsUpdate(converted, namedChange(`Convert to ${preset.label}`, 'device'));
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
      handleArtboardsUpdate(updatedArtboards);
      toast({ title: "Element Renamed", description: `Element renamed to "${newName}".` });
    }
  };

  // Handler for renaming the current project
  const handleRenameProject = async (newName: string) => {
    if (activeProjectId && newName.trim() && newName.trim() !== currentProjectName) {
      const trimmedName = newName.trim();
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
          toast({ title: "Project Renamed", description: `Project renamed to "${trimmedName}".` });
        }
      } catch (error) {
        console.error("Error renaming project:", error);
        toast({ title: "Rename Failed", description: "Failed to rename project.", variant: "destructive" });
      }
    }
  };

  const handleAddElementToArtboard = useCallback((artboardId: string, type: ElementType, subType?: ShapeType | DeviceType, dropPosition?: Point, styleProps?: Record<string, any>) => {
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
  }, [toast]);

  // Stable identity so the memoized ElementPalette does not re-render on every
  // layout state change. The palette can hold hundreds of tiles, and rebuilding
  // them per slider tick is what made scale drags stutter.
  const handlePaletteAddElement = useCallback((type: ElementType, subType?: ShapeType | DeviceType, styleProps?: Record<string, any>) => {
    if (activeArtboardId) {
      handleAddElementToArtboard(activeArtboardId, type, subType, undefined, styleProps);
    } else {
      toast({ title: "No Artboard Active", description: "Please select or create an artboard first.", variant: "destructive" });
    }
  }, [activeArtboardId, handleAddElementToArtboard, toast]);

  /**
   * A palette tile dragged with a finger and released over the canvas. The
   * mouse path goes through the canvas's own drop handler; a finger drag has no
   * drop event to listen for, so the board under the release point is looked up
   * here. Released clear of every board, it still lands (centred on the active
   * one) rather than silently doing nothing.
   */
  const handlePaletteDropElement = useCallback((
    type: ElementType,
    subType: ShapeType | DeviceType | undefined,
    styleProps: Record<string, any> | undefined,
    point: Point
  ) => {
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
  const getCurrentArtboardSize = () => {
    if (activeArtboardId) {
      const activeAb = artboards.find(ab => ab.id === activeArtboardId);
      if (activeAb) {
        return activeAb.size;
      }
    }
    return artboards.length > 0 ? artboards[0].size : { width: 1290, height: 2796 }; // Updated default size
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
    const defaultSize = { width: 1290, height: 2796 }; // Updated default size
    const newSize = currentArtboard ? currentArtboard.size : defaultSize;

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
    handleArtboardsUpdate(
      normalizeLocalization(newArtboardsArray),
      namedChange(options.historyLabel ?? 'Add Artboard', 'artboard', newArtboard.name)
    );
    setActiveArtboardId(newArtboard.id);
    setSelectedElementIdOnActiveArtboard(null);
    toast(options.notice ?? {
      title: "Artboard Added",
      description: `New artboard added after "${artboards[currentIndex]?.name || 'selected'}".`,
    });
    return newArtboard;
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
    let droppedOn: string | null = null;
    if (point) {
      // elementsFromPoint, not elementFromPoint: on a phone the palette sheet
      // is still mounted over the canvas (faded and click-through, but there),
      // so the board can be the second or third thing under the finger.
      const node = document
        .elementsFromPoint(point.x, point.y)
        .map((el) => el.closest('[data-artboard-dom-id]'))
        .find((el): el is Element => !!el) ?? null;
      droppedOn = node?.getAttribute('data-artboard-dom-id') ?? null;
    }
    addPreviewSceneRef.current(sceneId, droppedOn);
  }, []);
  
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

    handleArtboardsUpdate(newArtboardsArray, namedChange('Duplicate Artboard', 'copy', artboardToDuplicate.name));
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
    handleArtboardsUpdate(newArtboardsArray, namedChange('Delete Artboard', 'delete', artboardToDelete.name));

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
  
    handleArtboardsUpdate(newArtboardsArray, namedChange('Move Artboard', 'order', targetArtboard.name));
    toast({ title: "Artboard Moved", description: `Artboard "${targetArtboard.name}" moved ${direction}.` });
  };


  // Copy a template into a new saved project and open it. Shared by the gallery
  // (handleSelectTemplate) and the MCP create_project_from_template tool, so an
  // AI client's project is indistinguishable from a clicked one: same DB row,
  // same Recent-projects entry, same editor state.
  //
  // `texts`/`screenshots` fill the copy BEFORE it is saved, addressed by the
  // template's hand-authored element ids. Unknown or wrong-typed ids are
  // collected as warnings rather than thrown, so one bad id cannot lose a
  // whole design.
  const createProjectFromTemplateData = async (
    template: Project,
    options?: {
      nameOverride?: string;
      texts?: Array<{ elementId: string; content: string }>;
      screenshots?: Array<{ elementId: string; src: string }>;
    }
  ): Promise<{ projectId: string; name: string; artboards: ArtboardState[]; warnings: string[] } | null> => {
    if (!template.projectData || !Array.isArray(template.projectData) || template.projectData.length === 0) {
      return null;
    }
    const projectName = options?.nameOverride?.trim() || `${template.name} Copy`;
    const newProjectId = `project_${Date.now()}`;
    const warnings: string[] = [];

    // Normalize artboard positions so templates with arbitrary stored positions
    // still lay out side by side on first load (same layout applied on add/duplicate).
    const updatedArtboards = calculateArtboardPositions(
      JSON.parse(JSON.stringify(template.projectData)) as ArtboardState[]
    );

    const findElement = (elementId: string): ArtboardElement | null => {
      for (const ab of updatedArtboards) {
        const el = ab.elements.find((e) => e.id === elementId);
        if (el) return el;
      }
      return null;
    };

    for (const { elementId, content } of options?.texts ?? []) {
      const el = findElement(elementId);
      if (!el) { warnings.push(`No element "${elementId}" in this template; text skipped.`); continue; }
      if (el.type !== 'text') { warnings.push(`"${elementId}" is a ${el.type} element, not text; skipped.`); continue; }
      el.content = content;
    }
    for (const { elementId, src } of options?.screenshots ?? []) {
      const el = findElement(elementId);
      if (!el) { warnings.push(`No element "${elementId}" in this template; screenshot skipped.`); continue; }
      if (el.type !== 'device') { warnings.push(`"${elementId}" is a ${el.type} element, not a device frame; skipped.`); continue; }
      el.screenshotSrc = src;
      // Match the device element's own upload handler; screenshotRect is left
      // alone so the template author's crop survives.
      el.screenshotObjectFit = el.screenshotObjectFit ?? 'cover';
    }

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

      const created = await createProjectFromTemplateData(template, { nameOverride: options?.nameOverride });

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
      setIsLoadingTemplate(false); // Reset loading flag on error
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
    try {
      const project = await loadProjectFromAccount(remoteId, (step, ratio) =>
        setProjectLoadStatus({ name, step, ratio })
      );
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
      if (error instanceof AccountAuthError) {
        openAccountDialog(error.message);
      } else {
        toast({
          title: "Could not open",
          description: error instanceof Error ? error.message : "Something went wrong.",
          variant: "destructive",
        });
      }
    } finally {
      setLoadPhase('idle');
      setProjectLoadStatus(null);
    }
  };

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
    setCloudLink(await getCloudLink(activeProjectId, discoverSession?.viewer?.id ?? null));
  }, [activeProjectId, discoverSession, isCloudAvailable]);

  useEffect(() => {
    void refreshCloudLink();
  }, [refreshCloudLink]);

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
    try {
      setLoadPhase('project');
      setProjectLoadStatus({ name: project.name, step: 'Reading your project', ratio: 0 });
      const opened = await loadProjectFromCloud(project.id, {
        asCopy,
        onProgress: (step, ratio) => setProjectLoadStatus({ name: project.name, step, ratio }),
      });
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
      handleCloudError(error, 'Could not open that project');
    } finally {
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
    order?: { indexById: Record<string, number>; total: number },
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
        const filename = `${localePrefix}${orderPrefix}_${artboard.name.replace(/\s+/g, '_')}${deviceSuffix}${sizeSuffix}.png`;
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
  // generate App Store formats (iPhone 6.9-inch, iPad 13/11-inch) the project
  // is missing, once per language the dialog asked for. Every pass renders
  // through exportCanvasArtboards, a temporary canvas list that never touches
  // history or Dexie, so this can never corrupt the user's work.
  const handleConfirmExport = async ({ asIs, generateFormats, currentArtboardOnly, locales }: ExportSelection) => {
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
    const scope = (list: ArtboardState[]) =>
      scopedId ? list.filter((ab) => ab.id === scopedId) : list;

    const targets = scope(original);
    if (targets.length === 0) {
      toast({
        title: "Nothing to export",
        description: currentArtboardOnly
          ? "Select an artboard on the canvas first."
          : "Add an artboard first.",
        variant: "destructive",
      });
      return;
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
    const filesPerLocale = (asIs ? targets.length : 0) + generateFormats.length * targets.length;
    const totalFiles = filesPerLocale * localesToExport.length;
    if (isTauri() && totalFiles > 1) {
      exportDir = await pickExportDirectory('Choose a folder for the exported artboards');
      if (exportDir === null) return;
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
      order: { indexById: Record<string, number>; total: number },
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
    // Closes the mutation door for the whole run. Nothing may write the project
    // while the canvas is showing a converted or re-projected list.
    isExportingRef.current = true;
    try {
      for (const locale of localesToExport) {
        if (pngExportCancelRef.current) break;
        const projected = projectArtboards(original, locale);
        // Rebuilt per language, or the German set would be numbered 13..18
        // instead of 01..06 and every fastlane-style convention expects 1..N.
        const order = {
          indexById: Object.fromEntries(projected.map((ab, i) => [ab.id, i + 1])),
          total: projected.length,
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
          if (!preset) continue;
          const startIndex = nextFileIndex;
          nextFileIndex += targets.length;
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
            ...(await captureWithExportEvents(scope(repositioned), startIndex, order, locale, preset.label))
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
      // The language on screen: a recording can itself be localized, so which
      // boards carry video is answered for the language being exported.
      for (const ab of viewArtboards) {
        try {
          infos[ab.id] = await analyzeArtboardForVideo(ab);
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
  const isAppPreviewProject = useMemo(() => projectHasVideoContent(artboards), [artboards]);

  const videoBoards = artboards.filter((ab) => {
    const info = videoInfos[ab.id];
    return !!info && (info.hasVideo || info.hasMotion);
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
      // Safe mode exports raw footage, so it needs an actual recording.
      return request.rawRecordingOnly ? info.hasVideo : info.hasVideo || info.hasMotion;
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
      return;
    }

    let exportDir: string | null | undefined;
    if (isTauri() && boards.length > 1) {
      exportDir = await pickExportDirectory('Choose a folder for the exported videos');
      if (exportDir === null) return;
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
        const suffix = !request.rawRecordingOnly
          ? 'AppPreview'
          : request.keepOverlays
            ? 'StoreReady_Text'
            : 'StoreReady';
        const filename = `${orderPrefix}_${board.name.replace(/\s+/g, '_')}_${suffix}.mp4`;
        const savedPath = exportDir
          ? await saveBlobToPath(blob, exportDir, filename)
          : await saveBlobToDisk(blob, filename);
        if (savedPath === null) continue; // user cancelled this file's save dialog
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
  }, [history, historyIndex, activeArtboardId, activeProjectId, currentProjectName, scheduleProjectSave]);

  const handleUndo = useCallback(() => {
    applyHistoryIndex(historyIndex - 1);
  }, [applyHistoryIndex, historyIndex]);

  const handleRedo = useCallback(() => {
    applyHistoryIndex(historyIndex + 1);
  }, [applyHistoryIndex, historyIndex]);

  // Fix the handleDeleteSelected function to properly handle deletion
  const handleDeleteSelected = useCallback(() => { 
    if (activeArtboardId && selectedElementIdOnActiveArtboard) {
      // Find the active artboard
      const activeArtboard = artboards.find(ab => ab.id === activeArtboardId);
      if (activeArtboard) {
        // Find the element to delete
        const elementExists = activeArtboard.elements.some(
          el => el.id === selectedElementIdOnActiveArtboard
        );

        // If element exists, delete it
        if (elementExists) {
          const artboardComponent = artboardRefs.current[activeArtboardId];
          if(artboardComponent && artboardComponent.deleteElementByIdG) {
            artboardComponent.deleteElementByIdG(selectedElementIdOnActiveArtboard);
            setSelectedElementIdOnActiveArtboard(null);
            toast({ title: "Element Deleted", description: "Element was removed from the artboard." });
          } else {
            toast({title: "Cannot Delete Element", description: "Artboard component reference not found.", variant: "destructive"});
          }
        } else {
          toast({title: "Cannot Delete Element", description: "Selected element not found in artboard.", variant: "destructive"});
        }
      }
    } else if (activeArtboardId) { 
      handleDeleteArtboard(activeArtboardId); 
    } else {
      toast({title: "Cannot Delete", description: "No artboard or element selected.", variant: "destructive"});
    }
  }, [activeArtboardId, selectedElementIdOnActiveArtboard, artboards, toast]);

  // Add keyboard event handlers for delete, undo, and redo
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Preview mode has its own keyboard handling
      if (isPreviewOpen) return;
      // Skip if we're typing in an input, textarea, etc.
      if (
        e.target instanceof HTMLInputElement || 
        e.target instanceof HTMLTextAreaElement ||
        (e.target instanceof HTMLElement && e.target.isContentEditable)
      ) {
        return;
      }

      // Copy: Ctrl+C or Cmd+C
      if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
        e.preventDefault();
        if (activeArtboardId && selectedElementIdOnActiveArtboard) {
          handleCopyElement();
        }
      }

      // Paste: Ctrl+V or Cmd+V
      if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
        e.preventDefault();
        if (clipboardItem) {
          handlePasteElement();
        }
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

      // Tool shortcuts: H for hand/pan tool, V for selection tool
      if (e.key === 'h' || e.key === 'H') {
        e.preventDefault();
        setActiveTool('pan');
      }

      if (e.key === 'v' || e.key === 'V') {
        e.preventDefault();
        setActiveTool('select');
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleDeleteSelected, handleUndo, handleRedo, historyIndex, history.length, activeArtboardId, selectedElementIdOnActiveArtboard, clipboardItem, setActiveTool, isPreviewOpen]);

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
    if (artboardId !== activeProjectId) {
        setSelectedElementIdOnActiveArtboard(null);
    }
  }

  const handleElementSelectionOnArtboard = (elementId: string | null) => {
    setSelectedElementIdOnActiveArtboard(elementId);
  }

  const handleSelectElementFromLayerPanel = (elementId: string) => {
    setSelectedElementIdOnActiveArtboard(elementId);
  };

  // Add handler for deleting element from layers panel
  const handleDeleteElementFromLayerPanel = (elementId: string) => {
    if (activeArtboardId) {
      const artboardComponent = artboardRefs.current[activeArtboardId];
      if (artboardComponent && artboardComponent.deleteElementByIdG) {
        artboardComponent.deleteElementByIdG(elementId);
        setSelectedElementIdOnActiveArtboard(null);
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
    
    // Update all artboards with the new size
    const updatedArtboards = artboards.map(artboard => ({
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
    handleArtboardsUpdate(updatedArtboards, namedChange(`Canvas Size ${width} x ${height}`, 'resize'));

    toast({
      title: "Artboard Size Updated",
      description: scaleContent
        ? `All artboards resized to ${width} × ${height} pixels with content scaled to fit.`
        : `All artboards resized to ${width} × ${height} pixels`
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
      if (successCount > 0) {
        handleArtboardsUpdate(newArtboards, namedChange('Translate', 'translate', `${successCount} text layers`));
      }
      toast({
        title: "Rate limit exceeded",
        description: `Successfully translated ${successCount} element(s) before hitting the rate limit. Please wait a minute before trying again.`,
        variant: "destructive"
      });
    } else if (successCount > 0) {
      handleArtboardsUpdate(newArtboards, namedChange('Translate', 'translate', `${successCount} text layers`));
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

    handleArtboardsUpdate(
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
    };
  }, [activeArtboard]);


  // Define the copy element handler. Explicit ids come from the context menu
  // (copy exactly what was right-clicked); the keyboard shortcut passes none
  // and falls back to the current selection.
  const handleCopyElement = (targetArtboardId?: string | null, targetElementId?: string | null) => {
    const artboardId = targetArtboardId ?? activeArtboardId;
    const elementId = targetElementId ?? selectedElementIdOnActiveArtboard;
    if (artboardId && elementId) {
      const activeAb = artboards.find(ab => ab.id === artboardId);
      if (activeAb) {
        const elementToCopy = activeAb.elements.find(el => el.id === elementId);

        if (elementToCopy) {
          copyToClipboard(elementToCopy);
          toast({ title: "Copied", description: `${elementToCopy.type} element copied to clipboard.` });
        }
      }
    }
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

    const artboardComponent = artboardRefs.current[artboardId];
    if (!artboardComponent?.deleteElementByIdG) {
      toast({ title: "Cannot Delete Element", description: "Artboard component reference not found.", variant: "destructive" });
      return;
    }
    const name = getElementDisplayName(element);
    artboardComponent.deleteElementByIdG(elementId);
    if (artboardId === activeArtboardId) setSelectedElementIdOnActiveArtboard(null);
    toast({ title: "Element Deleted", description: `${name} was removed from the artboard.` });
  };

  // Define the paste element handler. The context menu passes the right-clicked
  // artboard and a paste point (artboard coordinates) so the element lands
  // under the cursor; the keyboard shortcut offsets from the original instead.
  const handlePasteElement = (targetArtboardId?: string | null, pastePoint?: Point | null) => {
    const artboardId = targetArtboardId ?? activeArtboardId;
    if (artboardId && clipboardItem) {
      const targetArtboard = artboards.find(ab => ab.id === artboardId);
      const elementWidth = clipboardItem.size?.width ?? 0;
      const elementHeight = clipboardItem.size?.height ?? 0;
      const position = pastePoint && targetArtboard
        ? {
            x: Math.max(0, Math.min(pastePoint.x - elementWidth / 2, targetArtboard.size.width - elementWidth)),
            y: Math.max(0, Math.min(pastePoint.y - elementHeight / 2, targetArtboard.size.height - elementHeight)),
          }
        : {
            x: clipboardItem.position.x + 20, // Offset position slightly
            y: clipboardItem.position.y + 20
          };
      const newElement = {
        ...JSON.parse(JSON.stringify(clipboardItem)),
        id: `el_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`, // New unique ID
        position
      };

      const updatedArtboards = artboards.map(ab => {
        if (ab.id === artboardId) {
          return {
            ...ab,
            elements: [...ab.elements, newElement]
          };
        }
        return ab;
      });

      handleArtboardsUpdate(updatedArtboards, namedChange('Paste', 'copy', getElementDisplayName(newElement)));
      if (artboardId !== activeArtboardId) {
        setActiveArtboardId(artboardId);
      }
      setSelectedElementIdOnActiveArtboard(newElement.id);
      toast({ title: "Pasted", description: `${newElement.type} element pasted to artboard.` });
    } else if (!artboardId) {
      toast({
        title: "Cannot Paste",
        description: "Please select an artboard first.",
        variant: "destructive"
      });
    }
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
    const artboardNode = target.closest('[data-artboard-dom-id]');
    const elementId = elementNode?.getAttribute('data-element-id') ?? null;
    const artboardId = artboardNode?.getAttribute('data-artboard-dom-id') ?? null;

    // Convert the click to artboard coordinates via the rendered size, which
    // already includes the display scale and every ancestor zoom transform.
    let pastePoint: Point | null = null;
    if (artboardNode) {
      const rect = artboardNode.getBoundingClientRect();
      const originalWidth = Number(artboardNode.getAttribute('data-original-width'));
      if (rect.width > 0 && originalWidth > 0) {
        const renderedScale = rect.width / originalWidth;
        pastePoint = {
          x: (clientX - rect.left) / renderedScale,
          y: (clientY - rect.top) / renderedScale,
        };
      }
    }

    if (artboardId) {
      setActiveArtboardId(artboardId);
      setSelectedElementIdOnActiveArtboard(elementId);
    }
    setContextMenu({ x: clientX, y: clientY, elementId, artboardId, pastePoint });
  }, [isPreviewOpen]);

  useEffect(() => {
    const handleContextMenu = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target.isContentEditable
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
  
  // Add keyboard shortcuts for copy and paste
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Preview mode has its own keyboard handling
      if (isPreviewOpen) return;
      // Skip if we're typing in an input, textarea, etc.
      if (
        e.target instanceof HTMLInputElement || 
        e.target instanceof HTMLTextAreaElement ||
        (e.target instanceof HTMLElement && e.target.isContentEditable)
      ) {
        return;
      }

      // Copy: Ctrl+C or Cmd+C
      if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
        e.preventDefault();
        if (activeArtboardId && selectedElementIdOnActiveArtboard) {
          handleCopyElement();
        }
      }

      // Paste: Ctrl+V or Cmd+V
      if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
        e.preventDefault();
        if (clipboardItem) {
          handlePasteElement();
        }
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

      // Tool shortcuts: H for hand/pan tool, V for selection tool
      if (e.key === 'h' || e.key === 'H') {
        e.preventDefault();
        setActiveTool('pan');
      }

      if (e.key === 'v' || e.key === 'V') {
        e.preventDefault();
        setActiveTool('select');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleDeleteSelected, handleUndo, handleRedo, historyIndex, history.length, activeArtboardId, selectedElementIdOnActiveArtboard, clipboardItem, isPreviewOpen]);

  // Common function to load project data and apply positioning
  const loadProjectFromData = async (projectData: ArtboardState[], projectName: string, projectId: string) => {
    try {
      setIsLoadingTemplate(true); // Prevent effect from loading project
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
      
      // Set project details first to avoid triggering effects
      setCurrentProjectName(projectName);
      setActiveProjectId(projectId);
      
      // Set artboards and history without triggering handleArtboardsUpdate
      setArtboards(finalArtboards);
      setHistory([makeHistoryEntry(finalArtboards, namedChange('Open', 'open', projectName))]);
      setHistoryIndex(0);
      
      // Automatically select the first artboard
      setActiveArtboardId(finalArtboards.length > 0 ? finalArtboards[0].id : null);
      setSelectedElementIdOnActiveArtboard(null);
      setIsTemplateSelectorOpen(false);

      // Update recent projects list
      setRecentProjects(await fetchRecentProjectMetas());

      // Update URL with new project ID
      if (typeof window !== "undefined") {
        const params = new URLSearchParams(window.location.search);
        params.set("projectId", projectId);
        window.history.replaceState({}, "", `${window.location.pathname}?${params.toString()}`);
      }

      setIsLoadingTemplate(false); // Reset loading flag
      return true; // Success
    } catch (error) {
      console.error("Error loading project data:", error);
      setIsLoadingTemplate(false); // Reset loading flag on error
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
            !isOpeningSharedLink
          }
          onOpenChange={(newOpenState) => {
            if (!newOpenState && artboards.length === 0 && availableProjects.length > 0) {
               // Create a blank project when no template is selected
               handleSelectTemplate(createBlankProject(activeCategory.defaultSize));
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
            {dialogView === 'agent' ? (
              <DialogHeader>
                <div className="flex items-start gap-2">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="-ml-2 h-8 w-8 shrink-0"
                    onClick={() => setDialogView('templates')}
                    aria-label="Back"
                  >
                    <ChevronLeftIcon className="h-4 w-4" />
                  </Button>
                  <div className="min-w-0 flex-1 text-left">
                    <DialogTitle>Design with the AI agent</DialogTitle>
                    <DialogDescription>
                      Upload your screenshots, say what you want, and let the agent build the project.
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
              {/* AI agent and blank-canvas entry points, stacked as two rows. */}
              <div className="grid min-h-[20vh] grid-rows-2 gap-3">
                <AgentPromoBanner onStartAgent={() => setDialogView('agent')} />
                <BlankCanvasCard
                  size={activeCategory.defaultSize}
                  categoryLabel={activeCategory.label}
                  onStartBlank={() => handleSelectTemplate(createBlankProject(activeCategory.defaultSize))}
                />
              </div>
            </div>
            )}
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
  const mcpNextPaint = () =>
    new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    );

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

  // Every mutating tool below writes the BASE document and commits through
  // handleArtboardsUpdate. None of them may ever be switched to viewArtboards:
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
      })),
    getArtboard: (id, locale) => {
      const boardId = resolveBoardId(id);
      const ab = projectArtboards(artboards, locale ?? null).find((b) => b.id === boardId);
      return ab ? { ...ab, active: ab.id === activeArtboardId } : null;
    },
    createArtboard: ({ name, width, height, preset, backgroundColor }) => {
      let size: Size = { width: 1290, height: 2796 };
      if (preset) {
        const p = ALL_CANVAS_SIZE_PRESETS.find((x) => x.id === preset);
        if (p) size = { width: p.width, height: p.height };
      }
      if (width && height) size = { width, height };
      const id = `artboard_${Date.now()}`;
      const board: ArtboardState = {
        id,
        name: name || `Artboard ${artboards.length + 1}`,
        position: { x: 0, y: 0 },
        size,
        elements: [],
        backgroundColor: backgroundColor || '#FFFFFF',
        backgroundType: 'solid',
        zoom: 1,
      };
      handleArtboardsUpdate([...artboards, board]);
      setActiveArtboardId(id);
      return { id, name: board.name, width: size.width, height: size.height, backgroundColor: board.backgroundColor, elementCount: 0, active: true };
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
      handleArtboardsUpdate(next);
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
      handleArtboardsUpdate(remaining);
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
      handleArtboardsUpdate(next);
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
      handleArtboardsUpdate(
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
      handleArtboardsUpdate(
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
      handleArtboardsUpdate(
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
      handleArtboardsUpdate(
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
      handleArtboardsUpdate(artboards.map((ab) => (ab.id === boardId ? { ...ab, elements: newElements } : ab)));
      return true;
    },
    deleteElement: ({ artboardId, elementId }) => {
      const boardId = resolveBoardId(artboardId);
      const board = artboards.find((ab) => ab.id === boardId);
      if (!board || !board.elements.some((el) => el.id === elementId)) return false;
      handleArtboardsUpdate(
        artboards.map((ab) =>
          ab.id === boardId
            // The element's translations go in the same commit, or a re-minted
            // id could come back to a stale one.
            ? dropElementOverrides({ ...ab, elements: ab.elements.filter((el) => el.id !== elementId) }, [elementId])
            : ab
        )
      );
      if (selectedElementIdOnActiveArtboard === elementId) setSelectedElementIdOnActiveArtboard(null);
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
      handleArtboardsUpdate(artboards.map((ab) => (ab.id === boardId ? { ...ab, elements } : ab)));
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
      const nextGroupId = clear ? undefined : groupId?.trim() || `group_${Date.now().toString(36)}`;
      handleArtboardsUpdate(
        artboards.map((ab) =>
          ab.id === boardId
            ? {
                ...ab,
                elements: ab.elements.map((el) =>
                  wanted.has(el.id) ? ({ ...el, groupId: nextGroupId } as ArtboardElement) : el
                ),
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
      // arrangement's centre and a move can be expressed as a corner.
      const left = Math.min(...members.map((el) => el.position.x));
      const top = Math.min(...members.map((el) => el.position.y));
      const right = Math.max(...members.map((el) => el.position.x + el.size.width * (el.scale || 1)));
      const bottom = Math.max(...members.map((el) => el.position.y + el.size.height * (el.scale || 1)));
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
      handleArtboardsUpdate(artboards.map((ab) => (ab.id === boardId ? { ...ab, elements } : ab)));
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
      handleArtboardsUpdate(artboards.map((ab) => (ab.id === boardId ? { ...ab, ...patch } : ab)));
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
      const padTo = Math.max(2, String(artboards.length).length);
      // The language goes in the file name rather than a subfolder: the folder
      // may be the Downloads default, which the caller never named and so
      // cannot predict a subfolder inside. A caller that wants the fastlane
      // layout passes a directory of its own per language.
      const token = locale ? `${locale}_` : '';
      return withLocaleOnCanvas(locale, async () => {
        const results: McpExportResult[] = [];
        for (const [index, board] of artboards.entries()) {
          results.push(
            await captureArtboardForMcp(board, {
              scale,
              save: shouldSave,
              directory,
              fileName: `${token}${String(index + 1).padStart(padTo, '0')}_${board.name}`,
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
      // Reopening the already-open project must not resurrect a pre-edit row:
      // commit any pending debounced save before the read.
      flushProjectSave();
      const project = await db.projects.get(projectId);
      if (!project || !project.projectData) return null;
      const name = project.name || 'Untitled Project';
      const success = await loadProjectFromData(project.projectData, name, project.id);
      if (!success) throw new Error('Could not open that project.');
      // Let React paint the reopened canvas before the next tool call, so an
      // export_png right after this finds the artboards in the DOM.
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
      return {
        projectId: project.id,
        name,
        artboards: summarizeArtboards(project.projectData),
        warnings: [],
      };
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
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
      );
      return mcpLocaleState(next);
    },
    setLocalizedText: ({ artboardId, elementId, locale, text }) => {
      const boardId = resolveBoardId(artboardId);
      if (!boardId) return null;
      const applied = applyLocalizedText(artboards, { artboardId: boardId, elementId, locale, text });
      if (!applied) return null;
      handleArtboardsUpdate(
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
      if (boards !== artboards) {
        handleArtboardsUpdate(
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
        handleArtboardsUpdate(
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
        handleArtboardsUpdate(
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
        handleArtboardsUpdate(
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
      if (run.artboards !== artboards) {
        handleArtboardsUpdate(
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
        handleArtboardsUpdate(
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
        handleArtboardsUpdate(
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
        handleArtboardsUpdate(
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
  };
  mcpApiRef.current = mcpApi;

  return (
    <ClipboardProvider>
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
            <ElementPalette
              onAddElement={handlePaletteAddElement}
              onDropElement={handlePaletteDropElement}
              onAddPreviewScene={handlePaletteAddPreviewScene}
            />
          </SidebarContent>
          <SidebarFooter className="group-data-[collapsible=icon]:justify-center">
             <SidebarGroup className="p-0">
              <SidebarMenu>
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
          <LoadStatusBar
            phase={loadPhase}
            templateProgress={templateProgress}
            projectStep={projectLoadStatus}
          />
          <Toolbar
            onSelectTemplate={() => setIsTemplateSelectorOpen(true)}
            onPreview={() => openPreview('single')}
            onPreviewStore={() => openPreview('store')}
            onPreviewCompare={() => openPreview('compare')}
            canCompareLanguages={previewLocaleOptions.length > 1}
            onPublishToStore={() => setIsPublishDialogOpen(true)}
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
            onExport={() => {
              setExportScopedToArtboard(false);
              setIsExportDialogOpen(true);
            }}
            isAppPreviewProject={isAppPreviewProject}
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
              <CanvasArea
                artboards={viewArtboards}
                onUpdateArtboards={commitView}
                onUpdateBaseArtboards={handleCanvasStructuralChange}
                activeLocale={activeLocale}
                onAddElementToArtboard={handleAddElementToArtboard}
                onAddPreviewScene={handleAddPreviewScene}
                activeArtboardId={activeArtboardId}
                setActiveArtboardId={handleArtboardSelection}
                selectedElementIdOnActiveArtboard={selectedElementIdOnActiveArtboard}
                setSelectedElementIdOnActiveArtboard={handleElementSelectionOnArtboard}
                canvasZoom={canvasZoom}
                onZoomChange={setCanvasZoom}
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
                  canPaste={!!clipboardItem && !!(contextMenu.artboardId || activeArtboardId)}
                  canDelete={!!contextMenu.elementId && !!contextMenu.artboardId}
                  onCopy={() => handleCopyElement(contextMenu.artboardId, contextMenu.elementId)}
                  onPaste={() => handlePasteElement(contextMenu.artboardId, contextMenu.pastePoint)}
                  onDelete={() => handleDeleteElement(contextMenu.artboardId, contextMenu.elementId)}
                  onClose={() => setContextMenu(null)}
                />
              )}
            </div>

            {/* Right dock: Properties/History tabs on top, Layers below,
                resizable split. Collapsed it becomes a slim vertical rail with
                rotated labels (Android Studio tool-window style).

                On a phone it is the same panel, moved: a 320px column beside a
                390px screen would leave the canvas 70px wide, so below `md` it
                lifts out of the row and covers the bottom of the canvas like a
                sheet. No backdrop on purpose, so the element being edited stays
                visible while its properties are changed. */}
            {dockOpen ? (
              <div
                className={cn(
                  "flex flex-col border-l bg-card",
                  "h-full w-80 flex-shrink-0",
                  "max-lg:fixed max-lg:inset-x-0 max-lg:bottom-0 max-lg:z-50 max-lg:h-[70svh] max-lg:w-full max-lg:rounded-t-2xl max-lg:border max-lg:shadow-2xl"
                )}
                data-export-exclude
              >
                <Tabs
                  value={rightDockTab}
                  onValueChange={(value) => selectRightDockTab(value as 'properties' | 'history')}
                  className="flex min-h-0 flex-1 flex-col"
                >
                {/* Underline tabs, not the default segmented pill: inside a
                    320px dock the pill reads as a single button rather than a
                    pair of tabs. -mb-px drops the active underline onto the
                    header rule so the two line up. */}
                <div className="flex h-9 shrink-0 items-stretch justify-between border-b pl-2 pr-1.5">
                  <TabsList className="-mb-px h-auto items-stretch gap-4 rounded-none bg-transparent p-0">
                    <TabsTrigger
                      value="properties"
                      className="rounded-none border-b-2 border-transparent bg-transparent px-0.5 text-xs text-muted-foreground shadow-none data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:font-semibold data-[state=active]:text-foreground data-[state=active]:shadow-none"
                    >
                      Properties
                    </TabsTrigger>
                    <TabsTrigger
                      value="history"
                      className="rounded-none border-b-2 border-transparent bg-transparent px-0.5 text-xs text-muted-foreground shadow-none data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:font-semibold data-[state=active]:text-foreground data-[state=active]:shadow-none"
                    >
                      History
                    </TabsTrigger>
                  </TabsList>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 self-center max-lg:h-8 max-lg:w-8"
                    onClick={() => setDockOpen(false)}
                    title="Collapse right panel"
                    aria-label="Collapse right panel"
                  >
                    <PanelRightCloseIcon className="h-4 w-4 max-lg:hidden" />
                    <ChevronDownIcon className="hidden h-5 w-5 max-lg:block" />
                  </Button>
                </div>
                <div ref={dockContentRef} className="flex min-h-0 flex-1 flex-col">
                  {/* data-[state=active]:flex, never a bare flex: a bare flex
                      class beats Radix's [hidden] and the inactive tab would
                      still take up the dock. */}
                  <TabsContent
                    value="properties"
                    className="m-0 min-h-[10rem] flex-1 overflow-hidden data-[state=active]:flex"
                  >
                    <PropertiesPanel
                      selectedElement={selectedElementDetails}
                      onUpdateElement={handleUpdateSelectedElement}
                      onUpdateElementById={handleUpdateElementById}
                      onTranslateElement={handleTranslateTextElement}
                      activeArtboardDetails={
                        activeArtboardId && !selectedElementIdOnActiveArtboard ? activeArtboard : null
                      }
                      onUpdateArtboardDetails={handleUpdateArtboardDetails}
                      activeLocale={activeLocale}
                      baseLocale={baseLocaleCode}
                      localeOverride={selectedLocaleOverride}
                      baseElement={selectedBaseElement}
                      onResetLocaleField={handleResetLocaleField}
                      localeDetached={selectedLocaleDetached}
                      onToggleLocaleDetach={handleToggleLocaleDetach}
                      onResetLocaleOverrides={handleResetLocaleOverrides}
                      className="h-full border-l-0 shadow-none"
                    />
                  </TabsContent>
                  <TabsContent
                    value="history"
                    className="m-0 min-h-[10rem] flex-1 overflow-hidden data-[state=active]:flex"
                  >
                    <HistoryPanel
                      entries={history}
                      currentIndex={historyIndex}
                      onJumpTo={applyHistoryIndex}
                    />
                  </TabsContent>
                  <div
                    role="separator"
                    aria-orientation="horizontal"
                    title="Drag to resize"
                    // The bar stays 8px, which is all a cursor needs, but a
                    // fingertip cannot aim at 8px. On a coarse pointer the
                    // ::before spreads the hit area 12px above and below without
                    // moving anything on screen; it is positioned, so it
                    // hit-tests above the static panels either side. Gated on
                    // the pointer, because those same 12px would be dead space
                    // stolen from both panels for someone holding a mouse.
                    className={cn(
                      "group relative z-10 h-2 shrink-0 cursor-row-resize touch-none border-y bg-muted/50 hover:bg-primary/15",
                      "[@media(pointer:coarse)]:before:absolute [@media(pointer:coarse)]:before:-inset-y-3 [@media(pointer:coarse)]:before:inset-x-0 [@media(pointer:coarse)]:before:content-['']"
                    )}
                    onPointerDown={(e) => {
                      e.preventDefault();
                      e.currentTarget.setPointerCapture(e.pointerId);
                      dividerDragRef.current = {
                        pointerId: e.pointerId,
                        startY: e.clientY,
                        startHeight: layersHeight,
                        lastHeight: layersHeight,
                      };
                    }}
                    onPointerMove={(e) => {
                      const drag = dividerDragRef.current;
                      if (!drag || drag.pointerId !== e.pointerId) return;
                      const dockHeight = dockContentRef.current?.getBoundingClientRect().height ?? 800;
                      const max = Math.max(LAYERS_SECTION_MIN, dockHeight - PROPERTIES_SECTION_MIN);
                      const next = Math.round(
                        Math.min(max, Math.max(LAYERS_SECTION_MIN, drag.startHeight + (drag.startY - e.clientY)))
                      );
                      drag.lastHeight = next;
                      setLayersHeight(next);
                    }}
                    onPointerUp={(e) => {
                      const drag = dividerDragRef.current;
                      if (!drag || drag.pointerId !== e.pointerId) return;
                      dividerDragRef.current = null;
                      // The phone sheet's split is its own, so it is not saved
                      // over the docked-panel height a desktop session set.
                      if (isMobileViewport) return;
                      try { window.localStorage.setItem(RIGHT_DOCK_LAYERS_HEIGHT_KEY, String(drag.lastHeight)); } catch {}
                    }}
                    onPointerCancel={() => {
                      dividerDragRef.current = null;
                    }}
                  >
                    <div className="absolute left-1/2 top-1/2 h-0.5 w-8 -translate-x-1/2 -translate-y-1/2 rounded-full bg-muted-foreground/40 group-hover:bg-primary/60" />
                  </div>
                  {/* max-h keeps the properties form usable when a persisted
                      height is taller than the current window allows. */}
                  <div
                    style={{ height: layersHeight }}
                    className="max-h-[calc(100%-10rem)] shrink-0 overflow-hidden"
                  >
                    <LayersPanel
                      elements={activeArtboardElements}
                      selectedElementId={selectedElementIdOnActiveArtboard}
                      onSelectElement={handleSelectElementFromLayerPanel}
                      onMoveElementLayer={handleMoveElementLayer}
                      onDeleteElement={handleDeleteElementFromLayerPanel}
                      onRenameElement={handleRenameElementFromLayerPanel}
                      activeArtboardName={activeArtboardName}
                      activeLocale={activeLocale}
                      localeStates={layerLocaleStates}
                    />
                  </div>
                </div>
                </Tabs>
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
                    { label: 'Properties', tab: 'properties' as const },
                    { label: 'History', tab: 'history' as const },
                    { label: 'Layers', tab: null },
                  ]).map(({ label, tab }) => (
                    <button
                      key={label}
                      type="button"
                      className="rounded px-0.5 py-2 text-[11px] font-medium tracking-wide text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                      style={{ writingMode: 'vertical-rl' }}
                      onClick={() => {
                        if (tab) selectRightDockTab(tab);
                        setDockOpen(true);
                      }}
                      title={`Open ${label}`}
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
                  onClick={() => setDockOpen(true)}
                  title="Open properties"
                  aria-label="Open properties"
                  data-export-exclude
                >
                  <SlidersHorizontalIcon className="h-5 w-5" />
                </Button>
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
            />
          )}

          {/* App Preview video projects get their own dialog: video first, no
              App Store screenshot-size generation (meaningless for a video
              board), PNG demoted to a still. Screenshot projects keep the
              original dialog untouched. */}
          {isAppPreviewProject ? (
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
              onConfirmExport={handleConfirmExport}
              onPublishToStore={() => {
                setIsExportDialogOpen(false);
                setIsPublishDialogOpen(true);
              }}
              currentFormat={activeDeviceFormat}
              currentSize={artboards[0]?.size}
              activeArtboard={activeArtboardSummary}
              artboardCount={artboards.length}
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
            artboards={artboards}
            activeLocale={activeLocale}
            onCapture={handlePublishCapture}
          />

          <LanguageManagerDialog
            open={isLanguageManagerOpen}
            onOpenChange={setIsLanguageManagerOpen}
            artboards={artboards}
            translationAvailable={translationAvailable}
            onApply={(next, opts) => void handleApplyLanguages(next, opts)}
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
              if (!open) setSaveConflict(null);
            }}
            existingName={saveConflict?.name ?? ''}
            existingModifiedAt={saveConflict?.modifiedAt}
            suggestedName={`${currentProjectName} copy`}
            storageLabel={accountStorageLabel}
            isSaving={isSavingToAccount}
            onReplace={() => void runAccountSave()}
            onSaveCopy={(name) => void runAccountSave(name)}
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
    </ClipboardProvider>
  );
}

