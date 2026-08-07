"use client";
import React, { useState, useEffect, useLayoutEffect, useCallback, useMemo, useRef, useDeferredValue } from 'react';
import { toPng, toJpeg, toSvg } from 'html-to-image';
import { preloadGoogleFonts } from '@/services/fontService';
import { isTauri, sanitizeFileName, saveBlobToDisk, saveBlobToPath, saveDataUrlToDisk, saveDataUrlToPath, pickExportDirectory, openExternal } from '@/lib/desktop';
import { analyzeArtboardForVideo, exportArtboardVideo, projectHasVideoContent, type ArtboardVideoInfo } from '@/lib/video/videoExport';
import { migrateVideoDevices } from '@/lib/video/migrateVideoDevices';
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
import { CanvasArea } from './CanvasArea';
import { CanvasContextMenu } from './CanvasContextMenu';
import { PropertiesPanel } from './PropertiesPanel';
import { PreviewDialog } from './PreviewDialog';
import { TranslateDialog, getLanguageName } from './TranslateDialog';
import { translateText, detectLanguage, isTranslationEnabled, AUTO_DETECT } from '@/services/translation';
import { Logo } from './Logo';
import type { ArtboardState, ElementType, Point, ShapeType, DeviceType, ArtboardElement, TextElementProps, ShapeElementProps, DeviceFrameElementProps, ImageElementProps, Project, Size } from '@/types/artboard';
import { ExportDialog, type ExportSelection, type ExportImageFormat, type VideoExportRequest, type VideoExportProgress } from './ExportDialog';
import { AppPreviewExportDialog } from './AppPreviewExportDialog';
import { ALL_CANVAS_SIZE_PRESETS } from '@/lib/sizePresets';
import { artboardBackground } from '@/lib/artboardBackground';
import {
  startDesktopMcpBridge,
  getMcpStatus,
  listenMcpStatus,
  type McpDesignApi,
  type McpArtboardSummary,
  type McpElementMeasurement,
  type McpExportResult,
  type McpTemplateSummary,
} from '@/lib/mcp/desktopMcpServer';
import { McpServerStatus } from './McpServerStatus';
import { agentUsableTemplates } from '@/lib/ai/templateCatalog';
import { autoPlaceScreenshotsPlan, buildProjectFromPlan } from '@/lib/ai/buildProjectFromPlan';
import { readScreenshotFile, type UploadedScreenshot } from '@/lib/ai/imageUtils';
import { loadProjectTemplates } from '@/services/projectService';
import { TEMPLATE_CATEGORIES } from '@/lib/templateCategories';
import { convertArtboardsToFormat, detectArtboardsFormat, swapDeviceInElements, scaleElementsToCanvas, DEVICE_FORMAT_PRESETS, type DeviceFormatPreset } from '@/lib/deviceRegistry';
import { alignElementsWithinArtboard, selectionBounds, type ElementAlignment } from '@/lib/elementAlignment';
import { trackTemplateSelected, trackDeviceFormatSelected, trackExportPng, trackExportVideo, trackExportJson } from '@/lib/analytics';

import { AgentPromoBanner } from './start/AgentPromoBanner';
import { BlankCanvasCard } from './start/BlankCanvasCard';
import { AgentStartScreen } from './start/AgentStartScreen';
import { TemplateProposalPicker } from './start/TemplateProposalPicker';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ChevronLeftIcon, InfoIcon, Loader2Icon, PanelRightCloseIcon, PanelRightOpenIcon, SearchIcon, UserIcon, ZoomInIcon, ZoomOutIcon } from 'lucide-react';
import { AccountDialog } from './account/AccountDialog';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  AccountAuthError,
  bundleFromJson,
  bundleToJson,
  importBundle,
  loadProjectFromAccount,
  saveProjectToAccount,
  serializeProject,
  useAccount,
} from '@/lib/account';
import { LayersPanel } from './LayersPanel';
import { LanguageSwitcher } from './LanguageSwitcher';
import { LoadStatusBar } from './LoadStatusBar';
import packageJson from '../../../package.json';
import { useToast } from '@/hooks/use-toast';
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
import { useT } from '@/i18n';

// Reduce the margin between artboards
const ARTBOARD_MARGIN = 15; // Reduced from 30
const DISPLAY_SCALE_FACTOR = 0.3;

// Right dock (Properties + Layers) persistence. localStorage so the layout
// survives an app relaunch, not just a reload.
const RIGHT_DOCK_OPEN_KEY = 'abs-right-dock-open';
const RIGHT_DOCK_LAYERS_HEIGHT_KEY = 'abs-right-dock-layers-height';
const LAYERS_SECTION_MIN = 120; // px, keeps the layers list usable
const PROPERTIES_SECTION_MIN = 160; // px, keeps the properties form usable

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

// html-to-image has no WebP encoder, so WebP exports capture PNG first and
// re-encode through a hidden canvas. The canvas is pre-filled with the
// artboard colour because WebP export is flattened (no alpha), matching JPEG.
async function rasterToWebPDataUrl(
  pngDataUrl: string,
  backgroundColor: string,
  quality: number
): Promise<string> {
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new window.Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not decode the captured PNG for WebP encoding.'));
    img.src = pngDataUrl;
  });
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not create a canvas for WebP encoding.');
  ctx.fillStyle = backgroundColor;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/webp', quality)
  );
  if (!blob) throw new Error('WebP encoding failed.');
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Could not read the encoded WebP.'));
    reader.readAsDataURL(blob);
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
  const t = useT();
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
          placeholder={t('gallery.searchPlaceholder')}
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
                {t('gallery.noMatches', { query: deferredQuery.trim() })}
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
                          {t('gallery.screens', { count: screens })}
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
  const t = useT();
  const [artboards, setArtboards] = useState<ArtboardState[]>([]);
  const [activeArtboardId, setActiveArtboardId] = useState<string | null>(null);
  const [canvasZoom, setCanvasZoom] = useState(1);
  const [history, setHistory] = useState<ArtboardState[][]>([[]]);
  const [historyIndex, setHistoryIndex] = useState(0);
  // Seed from the URL: closed when refreshing straight into an open project
  // (?projectId present), open on a fresh visit. Prevents the selector flashing
  // open-then-closed on refresh. See getInitialProjectIdFromUrl.
  const [isTemplateSelectorOpen, setIsTemplateSelectorOpen] = useState(
    () => getInitialProjectIdFromUrl() === null
  );
  // Which screen of the start dialog is showing. The template gallery is the
  // dialog, as it always was; the agent is a screen you step into from the
  // banner above it. Reset on open so reopening never lands mid-agent-flow.
  const [dialogView, setDialogView] = useState<'templates' | 'agent'>('templates');
  const [templateTab, setTemplateTab] = useState<string>(TEMPLATE_CATEGORIES[0].id);
  const [availableProjects, setAvailableProjects] = useState<Project[]>([]);
  const [isLoadingProjects, setIsLoadingProjects] = useState(true);
  // Load-progress feedback for the top status bar. 'templates' = fetching the
  // template gallery on startup (determinate: done/total); 'project' = opening a
  // template/saved project into the canvas (indeterminate). 'idle' hides the bar.
  const [loadPhase, setLoadPhase] = useState<'idle' | 'templates' | 'project'>('templates');
  const [templateProgress, setTemplateProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 });
  const { toast } = useToast();
  const artboardRefs = useRef<Record<string, any>>({});
  // Latest design-tool API for the desktop MCP server; assigned each render and
  // read per request by the bridge (see the block above the render return).
  const mcpApiRef = useRef<McpDesignApi | null>(null);
  const [selectedElementIdsOnActiveArtboard, setSelectedElementIdsOnActiveArtboard] = useState<string[]>([]);
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
            ? { title: t('toasts.mcpServerOn'), description: t('toasts.mcpServerOnDesc', { url: status.url }) }
            : { title: t('toasts.mcpServerOff'), description: t('toasts.mcpServerOffDesc') }
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
  // The element the properties panel edits, derived from the selection: only
  // a single selection exposes per-property editing; a multi-selection shows
  // the panel's multi-select state instead.
  const selectedElementDetails = useMemo(() => {
    if (!activeArtboardId || selectedElementIdsOnActiveArtboard.length !== 1) return null;
    const activeAb = artboards.find((ab) => ab.id === activeArtboardId);
    return activeAb?.elements.find((el) => el.id === selectedElementIdsOnActiveArtboard[0]) ?? null;
  }, [activeArtboardId, selectedElementIdsOnActiveArtboard, artboards]);
  const [activeTool, setActiveTool] = useState<'select' | 'pan'>('select');
  // Seed from the URL so the project-loading and selector effects see the real
  // active id on the first render instead of a transient null (which would force
  // the template dialog open for a frame on refresh). See getInitialProjectIdFromUrl.
  const [activeProjectId, setActiveProjectId] = useState<string | null>(getInitialProjectIdFromUrl);
  const [currentProjectName, setCurrentProjectName] = useState<string>('Untitled Project');
  const [recentProjects, setRecentProjects] = useState<Project[]>([]);
  const [projectToDelete, setProjectToDelete] = useState<string | null>(null);
  const [clipboardElement, setClipboardElement] = useState<ArtboardElement | null>(null);
  const [isLoadingTemplate, setIsLoadingTemplate] = useState(false);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);
  // App Preview video export: per-board analysis (which boards carry video
  // content) is recomputed when the export dialog opens; progress/abort state
  // drives the dialog's render section.
  const [videoInfos, setVideoInfos] = useState<Record<string, ArtboardVideoInfo>>({});
  const [isVideoExporting, setIsVideoExporting] = useState(false);
  const [videoProgress, setVideoProgress] = useState<VideoExportProgress | null>(null);
  const videoExportAbortRef = useRef<AbortController | null>(null);
  const [isAboutOpen, setIsAboutOpen] = useState(false);
  // Bulk OS drop onto an empty canvas: the dropped images are read into
  // screenshots, then the template proposal dialog offers to auto-build a
  // project from them (deterministic, no AI).
  const [bulkDropDialogOpen, setBulkDropDialogOpen] = useState(false);
  const [bulkDropScreenshots, setBulkDropScreenshots] = useState<UploadedScreenshot[]>([]);
  const [bulkDropReading, setBulkDropReading] = useState(false);
  // Cloud account (Bring-Your-Own-Storage). `accountHint` is set when the
  // dialog is opened from a gated action so it can explain why it appeared.
  const [isAccountOpen, setIsAccountOpen] = useState(false);
  const [accountHint, setAccountHint] = useState<string | undefined>(undefined);
  const [isSavingToAccount, setIsSavingToAccount] = useState(false);
  const { session: accountSession, isSignedIn: isAccountConnected } = useAccount();
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
  const [isTranslateDialogOpen, setIsTranslateDialogOpen] = useState<boolean>(false);
  const [isTranslateSingleArtboard, setIsTranslateSingleArtboard] = useState<boolean>(false);
  // Set when the run is scoped to one text element (the properties panel
  // button); null means the dialog translates artboards as before.
  const [translateElementId, setTranslateElementId] = useState<string | null>(null);

  const handleTranslateArtboard = (artboardId: string) => {
    handleArtboardSelection(artboardId);
    setTranslateElementId(null);
    setIsTranslateSingleArtboard(true);
    setIsTranslateDialogOpen(true);
  };

  const handleTranslateTextElement = (elementId: string) => {
    setTranslateElementId(elementId);
    setIsTranslateSingleArtboard(true);
    setIsTranslateDialogOpen(true);
  };
  useLayoutEffect(() => {
    try {
      if (window.localStorage.getItem(RIGHT_DOCK_OPEN_KEY) === '0') setIsRightDockOpen(false);
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
  const { clipboardItems, copyElementsToClipboard } = useClipboard();
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
          title: t('toasts.loadingError'),
          description: t('toasts.failedToLoadProjects'),
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
        const projects = await db.projects.orderBy("timestamp").reverse().toArray();
        setRecentProjects(projects);
      } catch (error) {
        console.error("Error fetching recent projects:", error);
        // Optionally show a toast or handle the error gracefully
      }
    };

    fetchRecentProjects();
  }, [activeProjectId]); // Add activeProjectId as a dependency

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
          const project = await db.projects.get(activeProjectId);
          if (project && project.projectData) {
            // Projects saved before recordings became their own element type
            // still carry them on the screenshot device — convert on load.
            const projectData = migrateVideoDevices(project.projectData);
            setArtboards(projectData);
            setCurrentProjectName(project.name || 'Untitled Project');
            setHistory([JSON.parse(JSON.stringify(projectData))]);
            setHistoryIndex(0);
            // Auto-select the first artboard so a refreshed project opens ready to
            // edit (matches loadProjectFromData, the click-a-template path). Without
            // this, refreshing into ?projectId left nothing selected.
            setActiveArtboardId(projectData.length > 0 ? projectData[0].id : null);
            setSelectedElementIdsOnActiveArtboard([]);
            setIsTemplateSelectorOpen(false); // Close template selector if a project is loaded
          } else {
            console.warn(`Project with ID ${activeProjectId} not found.`);
            setActiveProjectId(null); // Clear active project state
            toast({ title: t('toasts.projectNotFound'), description: t('toasts.projectCouldNotLoad'), variant: "destructive" });
            setIsTemplateSelectorOpen(true); // Re-open template selector
          }
        } catch (error) {
          console.error("Error loading project from Dexie:", error);
          setActiveProjectId(null); // Clear active project state on error
          toast({ title: t('toasts.loadingError'), description: t('toasts.failedToLoadProject'), variant: "destructive" });
          setIsTemplateSelectorOpen(true); // Re-open template selector on error
        } finally {
          setLoadPhase('idle');
        }
      }
    };
    loadProject();
 }, [activeProjectId, isLoadingTemplate, toast, setIsTemplateSelectorOpen]); // Added isLoadingTemplate dependency
  const pushToHistory = (newArtboardsState: ArtboardState[]) => {
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push(JSON.parse(JSON.stringify(newArtboardsState))); // Deep copy
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
  };

  // Define the handleUpdateArtboardDetails function to update artboard background settings
  const handleUpdateArtboardDetails = useCallback(async (updates: Partial<ArtboardState>) => {
    if (!activeArtboardId) return;

    const updatedArtboards = artboards.map(ab => {
      if (ab.id === activeArtboardId) {
        return { ...ab, ...updates };
      }
      return ab;
    });
    
    setArtboards(updatedArtboards);
    pushToHistory(updatedArtboards);

    // Save to database
    if (activeProjectId) {
      try {
        await db.projects.put({
          id: activeProjectId,
          name: currentProjectName,
          timestamp: new Date(),
          projectData: JSON.parse(JSON.stringify(updatedArtboards)),
        });
      } catch (error) {
        console.error("Error saving artboard updates to database:", error);
      }
    }
  }, [activeArtboardId, artboards, pushToHistory, activeProjectId, currentProjectName]);

  // Add the missing handleDeleteProject function
  const handleDeleteProject = async (projectId: string) => {
    try {
      await db.projects.delete(projectId);
      toast({ 
        title: t('toasts.projectDeleted'), 
        description: t('toasts.projectDeletedDesc')
      });
      // Update the recentProjects list
      const updatedProjects = await db.projects.orderBy("timestamp").reverse().toArray();
      setRecentProjects(updatedProjects);
    } catch (error) {
      console.error("Error deleting project:", error);
      toast({ 
        title: t('toasts.deleteFailed'), 
        description: t('toasts.deleteFailedDesc'),
        variant: "destructive"
      });
    } finally {
      setProjectToDelete(null);
    }
  };

  const handleArtboardsUpdate = useCallback((updatedArtboards: ArtboardState[]) => {
    console.log("handleArtboardsUpdate called", activeProjectId);
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
  
      // Save to Dexie database
      db.projects.put({
        id: projectIdToSave,
        name: currentProjectName,
        timestamp: new Date(),
        projectData: JSON.parse(JSON.stringify(repositionedArtboards)), // Save the full state
      }).catch(error => {
        console.error("Error saving project to Dexie:", error);
      });

      if (activeProjectId !== projectIdToSave) {
        setActiveProjectId(projectIdToSave); // Set the new active project ID if it was just created
      }
    };
    if (activeArtboardId && !repositionedArtboards.find(ab => ab.id === activeArtboardId)) {
        setActiveArtboardId(null);
        setSelectedElementIdsOnActiveArtboard([]);
    }
    if (activeArtboardId && selectedElementIdsOnActiveArtboard.length > 0) {
        const currentAb = repositionedArtboards.find(ab => ab.id === activeArtboardId);
        if (currentAb) {
            // Prune ids the update removed (deletions, device swaps) so the
            // selection never points at elements that no longer exist.
            const surviving = selectedElementIdsOnActiveArtboard.filter(id =>
                currentAb.elements.some(el => el.id === id)
            );
            if (surviving.length !== selectedElementIdsOnActiveArtboard.length) {
                setSelectedElementIdsOnActiveArtboard(surviving);
            }
        }
    }
    saveProject(); // Call the async save function
    pushToHistory(repositionedArtboards);
  }, [activeArtboardId, selectedElementIdsOnActiveArtboard, activeProjectId, currentProjectName, history, historyIndex, setActiveProjectId]);

  const handleUpdateSelectedElement = (updates: Partial<ArtboardElement>) => {
    if (!activeArtboardId || selectedElementIdsOnActiveArtboard.length !== 1) return;
    const targetElementId = selectedElementIdsOnActiveArtboard[0];

    const updatedArtboards = artboards.map(ab => {
      if (ab.id === activeArtboardId) {
        // Device model changes go through the screen-aware swap so overlays
        // authored on the screen area (screen fills, pre-baked screenshots)
        // re-fit to the new device's screen rect and corner radius.
        const deviceTarget = (updates as Partial<DeviceFrameElementProps>).deviceType;
        if (deviceTarget) {
          const swappedElements = swapDeviceInElements(ab.elements, targetElementId, deviceTarget);
          if (swappedElements) {
            return { ...ab, elements: swappedElements };
          }
        }
        return {
          ...ab,
          elements: ab.elements.map(el =>
            el.id === targetElementId ? { ...el, ...updates } as ArtboardElement : el
          ),
        };
      }
      return ab;
    });
    handleArtboardsUpdate(updatedArtboards);
  };

  // Update an element by id regardless of the current selection. Used by the
  // properties panel to commit pending text edits after the element has
  // already been deselected (e.g. the user clicked the artboard background).
  const handleUpdateElementById = (elementId: string, updates: Partial<ArtboardElement>) => {
    let found = false;
    const updatedArtboards = artboards.map(ab => {
      if (!ab.elements.some(el => el.id === elementId)) return ab;
      found = true;
      return {
        ...ab,
        elements: ab.elements.map(el =>
          el.id === elementId ? { ...el, ...updates } as ArtboardElement : el
        ),
      };
    });
    if (found) handleArtboardsUpdate(updatedArtboards);
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
        title: t('toasts.nothingToConvert'),
        description: t('toasts.nothingToConvertDesc', {
          width: preset.artboard.width,
          height: preset.artboard.height,
          preset: preset.label,
          skipped: skipped > 0 ? t('toasts.skippedSuffix', { count: skipped }) : '',
        }),
      });
      return;
    }
    handleArtboardsUpdate(converted);
    trackDeviceFormatSelected({ format: preset.id, formatLabel: preset.label });
    const parts = [
      resized > 0 ? t('toasts.convertedResized', { count: resized, width: preset.artboard.width, height: preset.artboard.height }) : '',
      swapped > 0 ? t('toasts.convertedSwapped', { count: swapped }) : '',
      skipped > 0 ? t('toasts.convertedSkipped', { count: skipped }) : '',
    ].filter(Boolean);
    toast({
      title: t('toasts.convertedTo', { preset: preset.label }),
      description: t('toasts.convertedDesc', { parts: parts.join(', ') }),
    });
  };

  // Add handler for renaming element from layers panel
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
      toast({ title: t('toasts.elementRenamed'), description: t('toasts.elementRenamedDesc', { name: newName }) });
    }
  };

  // Handler for renaming the current project
  const handleRenameProject = async (newName: string) => {
    if (activeProjectId && newName.trim() && newName.trim() !== currentProjectName) {
      const trimmedName = newName.trim();
      setCurrentProjectName(trimmedName);
      
      // Update the project in the database
      try {
        const project = await db.projects.get(activeProjectId);
        if (project) {
          await db.projects.put({
            ...project,
            name: trimmedName,
          });
          toast({ title: t('toasts.projectRenamed'), description: t('toasts.projectRenamedDesc', { name: trimmedName }) });
        }
      } catch (error) {
        console.error("Error renaming project:", error);
        toast({ title: t('toasts.renameFailed'), description: t('toasts.renameFailedDesc'), variant: "destructive" });
      }
    }
  };

  const handleAddElementToArtboard = useCallback((artboardId: string, type: ElementType, subType?: ShapeType | DeviceType, dropPosition?: Point, styleProps?: Record<string, any>) => {
    const artboardComponent = artboardRefs.current[artboardId];
    if (artboardComponent && typeof artboardComponent.addElement === 'function') {
      const newElementId = artboardComponent.addElement(type, subType, dropPosition, styleProps);
      if (newElementId) {
        setSelectedElementIdsOnActiveArtboard([newElementId]);
        setActiveArtboardId(artboardId);
      }
    } else {
      toast({ title: t('toasts.error'), description: t('toasts.couldNotAddElement'), variant: "destructive" });
    }
  }, [toast, t]);

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

  // Handle new artboard creation with updated default size
  const handleNewArtboardFromMainToolbar = () => {
    if (activeArtboardId && artboards.some(ab => ab.id === activeArtboardId)) {
      handleAddNewArtboardAfter(activeArtboardId);
      return;
    }
    const defaultSize = { width: 1290, height: 2796 }; // Updated default size
    const newSize = artboards.length > 0 && artboards[artboards.length - 1]
                    ? artboards[artboards.length - 1].size
                    : defaultSize;

    const newArtboard: ArtboardState = {
      id: `artboard_${Date.now()}`,
      name: `Artboard ${artboards.length + 1}`,
      position: { x: 0, y: 0 }, 
      size: newSize,
      elements: [], 
      backgroundColor: '#FFFFFF', // Use explicit hex color instead of CSS variable
      backgroundType: 'solid',
      zoom: 1,
    };
    
    const newArtboards = [...artboards, newArtboard];
    handleArtboardsUpdate(newArtboards);
    setActiveArtboardId(newArtboard.id);
    setSelectedElementIdsOnActiveArtboard([]);
    toast({ title: t('toasts.artboardCreated'), description: t('toasts.artboardCreatedDesc', { name: newArtboard.name }) });
  };

  const handleAddNewArtboardAfter = (currentArtboardId: string) => {
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
    };

    const currentIndex = artboards.findIndex(ab => ab.id === currentArtboardId);
    let newArtboardsArray = [...artboards];
    if (currentIndex !== -1) {
      newArtboardsArray.splice(currentIndex + 1, 0, newArtboard);
    } else {
      newArtboardsArray.push(newArtboard); 
    }
    
    handleArtboardsUpdate(newArtboardsArray);
    setActiveArtboardId(newArtboard.id);
    setSelectedElementIdsOnActiveArtboard([]);
    toast({ title: t('toasts.artboardAdded'), description: t('toasts.artboardAddedDesc', { name: artboards[currentIndex]?.name || 'selected' }) });
  };
  
  const handleDuplicateArtboard = (artboardId: string) => {
    const artboardToDuplicate = artboards.find(ab => ab.id === artboardId);
    if (!artboardToDuplicate) return;
  
    const duplicatedArtboard: ArtboardState = JSON.parse(JSON.stringify(artboardToDuplicate)); 
    duplicatedArtboard.id = `artboard_${Date.now()}`;
    duplicatedArtboard.name = `${artboardToDuplicate.name} Copy`;
  
    const currentIndex = artboards.findIndex(ab => ab.id === artboardId);
    let newArtboardsArray = [...artboards];
    if (currentIndex !== -1) {
      newArtboardsArray.splice(currentIndex + 1, 0, duplicatedArtboard);
    } else {
      newArtboardsArray.push(duplicatedArtboard);
    }
  
    handleArtboardsUpdate(newArtboardsArray);
    setActiveArtboardId(duplicatedArtboard.id);
    toast({ title: t('toasts.artboardDuplicated'), description: t('toasts.artboardDuplicatedDesc', { name: artboardToDuplicate.name }) });
  };
  
  const handleDeleteArtboard = (artboardId: string) => {
    if (artboards.length <= 1) {
      toast({ title: t('toasts.cannotDelete'), description: t('toasts.mustHaveOneArtboard'), variant: "destructive" });
      return;
    }
    const artboardToDelete = artboards.find(ab => ab.id === artboardId);
    if (!artboardToDelete) return;

    const newArtboardsArray = artboards.filter(ab => ab.id !== artboardId);
    handleArtboardsUpdate(newArtboardsArray);

    if (activeArtboardId === artboardId) {
      setActiveArtboardId(newArtboardsArray.length > 0 ? newArtboardsArray[0].id : null);
      setSelectedElementIdsOnActiveArtboard([]);
    }
    toast({ title: t('toasts.artboardDeleted'), description: t('toasts.artboardDeletedDesc', { name: artboardToDelete.name }) });
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
  
    handleArtboardsUpdate(newArtboardsArray); 
    toast({ title: t('toasts.artboardMoved'), description: t('toasts.artboardMovedDesc', { name: targetArtboard.name, direction: t(direction === 'left' ? 'toasts.directionLeft' : 'toasts.directionRight') }) });
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

    await db.projects.put({
      id: newProjectId,
      name: projectName,
      description: template.description,
      timestamp: new Date(),
      projectData: JSON.parse(JSON.stringify(updatedArtboards)),
    });

    const success = await loadProjectFromData(updatedArtboards, projectName, newProjectId);
    if (!success) return null;
    return { projectId: newProjectId, name: projectName, artboards: updatedArtboards, warnings };
  };

  // `nameOverride` lets the AI agent name the project itself; the gallery and
  // "Start Blank" paths keep the historic "<template> Copy" naming.
  const handleSelectTemplate = async (template: Project, options?: { nameOverride?: string }) => {
    try {
      if (!template.projectData || !Array.isArray(template.projectData) || template.projectData.length === 0) {
        toast({
          title: t('toasts.invalidTemplate'),
          description: t('toasts.invalidTemplateDesc'),
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
        toast({ title: t('toasts.projectCreated'), description: t('toasts.projectCreatedDesc', { name: created.name }) });
        return;
      }

      toast({
        title: t('toasts.creationFailed'),
        description: t('toasts.creationFailedDesc'),
        variant: "destructive"
      });
    } catch (error) {
      console.error("Error creating project from template:", error);
      setIsLoadingTemplate(false); // Reset loading flag on error
      toast({
        title: t('toasts.creationFailed'),
        description: t('toasts.creationFailedDesc'),
        variant: "destructive"
      });
    }
  };

  // Image files dropped onto a canvas with no artboards: read them, then offer
  // to auto-build a project from a ranked template pick (no AI involved).
  const MAX_BULK_DROP_SCREENSHOTS = 12;
  const handleImagesDroppedOnEmptyCanvas = async (files: File[]) => {
    const accepted = files.slice(0, MAX_BULK_DROP_SCREENSHOTS);
    // The start dialog can be up over the empty canvas; take it down directly
    // (NOT through its onOpenChange, which would auto-create a blank project
    // under the proposal). If the user dismisses the proposal they can reopen
    // the start dialog from the toolbar's template button.
    setIsTemplateSelectorOpen(false);
    setBulkDropDialogOpen(true);
    setBulkDropReading(true);
    setBulkDropScreenshots([]);
    try {
      const shots = await Promise.all(accepted.map(readScreenshotFile));
      setBulkDropScreenshots(shots);
      if (files.length > accepted.length) {
        toast({
          title: t('toasts.someImagesSkipped'),
          description: t('toasts.someImagesSkippedDesc', { count: accepted.length }),
        });
      }
    } catch {
      setBulkDropDialogOpen(false);
      toast({
        title: t('toasts.couldNotReadImages'),
        description: t('toasts.useImageFiles'),
        variant: "destructive",
      });
    } finally {
      setBulkDropReading(false);
    }
  };

  // The picked template becomes a project through the same handoff the AI
  // agent uses (auto-place plan -> build -> handleSelectTemplate).
  const handleBulkDropPick = async (template: Project) => {
    try {
      const built = buildProjectFromPlan(
        autoPlaceScreenshotsPlan(template),
        bulkDropScreenshots,
        agentUsableTemplates(availableProjects)
      );
      setBulkDropDialogOpen(false);
      setBulkDropScreenshots([]);
      await handleSelectTemplate(built.project, { nameOverride: built.project.name });
    } catch (error) {
      toast({
        title: t('toasts.couldNotBuild'),
        description: error instanceof Error ? error.message : t('toasts.somethingWentWrong'),
        variant: "destructive",
      });
    }
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
        title: t('toasts.noActiveProject'),
        description: t('toasts.saveBeforeExport'),
        variant: "destructive",
      });
      return;
    }

    try {
      // Fetch the current project from IndexedDB
      const project = await db.projects.get(activeProjectId);
      
      if (!project) {
        toast({
          title: t('toasts.projectNotFound'),
          description: t('toasts.couldNotFindActive'),
          variant: "destructive",
        });
        return;
      }

      // Bundle the row together with the media blobs it references. Exporting
      // the row alone (what this used to do) left video elements dead on any
      // other machine, because recordings live in a separate Dexie table.
      const bundle = await serializeProject(project);
      const jsonString = await bundleToJson(bundle);
      const blob = new Blob([jsonString], { type: 'application/json' });
      // Desktop-safe save: native dialog in Tauri, anchor download on the web
      const savedPath = await saveBlobToDisk(blob, `artboard-project-${project.id}.json`);
      if (savedPath === null) return; // user cancelled the save dialog

      trackExportJson();

      toast({
        title: t('toasts.projectExported'),
        description: savedPath ? t('toasts.savedTo', { path: savedPath }) : t('toasts.projectExportedDesc'),
        variant: "default",
      });
    } catch (error) {
      console.error("Error exporting project:", error);
      toast({
        title: t('toasts.exportFailed'),
        description: t('toasts.exportFailedDesc'),
        variant: "destructive",
      });
    }
  };

  // --- cloud account (Bring-Your-Own-Storage) -------------------------------

  const openAccountDialog = (hint?: string) => {
    setAccountHint(hint);
    setIsAccountOpen(true);
  };

  /**
   * Toolbar "Save to account". Signed out this is how the user finds out they
   * need to connect, so it opens the dialog instead of doing nothing.
   */
  const handleSaveToAccount = async () => {
    if (!isAccountConnected) {
      openAccountDialog(t('account.gateHintSave'));
      return;
    }
    if (!activeProjectId) {
      toast({
        title: t('toasts.nothingToSave'),
        description: t('toasts.createOrOpen'),
        variant: "destructive",
      });
      return;
    }

    setIsSavingToAccount(true);
    try {
      const saved = await saveProjectToAccount(activeProjectId);
      toast({
        title: t('toasts.savedToAccount'),
        description: t('toasts.savedToAccountDesc', {
          name: saved.name,
          storage: accountSession ? (accountSession.provider === 'google' ? 'Google Drive' : 'GitHub gists') : t('toasts.storageFallback'),
        }),
      });
    } catch (error) {
      // An expired sign-in already cleared the session, so send the user back
      // through the dialog rather than showing a dead end.
      if (error instanceof AccountAuthError) {
        openAccountDialog(error.message);
      } else {
        toast({
          title: t('toasts.couldNotSave'),
          description: error instanceof Error ? error.message : t('toasts.somethingWentWrong'),
          variant: "destructive",
        });
      }
    } finally {
      setIsSavingToAccount(false);
    }
  };

  /** Pull a project out of the connected account and open it in the editor. */
  const handleOpenFromAccount = async (remoteId: string, name: string) => {
    try {
      const project = await loadProjectFromAccount(remoteId);
      const success = await loadProjectFromData(project.projectData, project.name, project.id);
      if (success) {
        setIsTemplateSelectorOpen(false);
        toast({ title: t('toasts.projectOpened'), description: t('toasts.projectOpenedDesc', { name: project.name }) });
      } else {
        toast({ title: t('toasts.couldNotOpen'), description: t('toasts.failedToLoad', { name }), variant: "destructive" });
      }
    } catch (error) {
      if (error instanceof AccountAuthError) {
        openAccountDialog(error.message);
      } else {
        toast({
          title: t('toasts.couldNotOpen'),
          description: error instanceof Error ? error.message : t('toasts.somethingWentWrong'),
          variant: "destructive",
        });
      }
    }
  };

  // Capture a list of artboards to image downloads by grabbing each board's
  // live DOM node (matched by artboard id). The list must be what the canvas
  // is currently rendering — for generated formats, handleConfirmExport
  // swaps the converted list in first and restores afterwards.
  const captureArtboards = async (
    list: ArtboardState[],
    exportDir?: string | null,
    options: {
      format?: ExportImageFormat;
      quality?: number;
      // Restrict the capture to these artboard ids; omitted captures the whole
      // list. Skipped boards still consume their loop index, so filename
      // order prefixes match the on-canvas positions.
      selectedIds?: ReadonlySet<string>;
    } = {},
  ) => {
    const { format = 'png', quality = 0.92, selectedIds } = options;
    // Array order matches canvas order (calculateArtboardPositions lays boards
    // out left-to-right by index), so the loop index is the on-canvas position.
    const orderPadWidth = Math.max(2, String(list.length).length);

    for (const [index, artboard] of list.entries()) {
      if (selectedIds && !selectedIds.has(artboard.id)) continue;

      // Find the DOM element for the artboard content
      const artboardElement = document.querySelector(`[data-artboard-dom-id="${artboard.id}"]`) as HTMLElement | null;

      if (!artboardElement) {
        console.warn(`Could not find DOM element for artboard: ${artboard.name}`);
        toast({
          title: t('toasts.exportWarning'),
          description: t('toasts.couldNotFindArtboard', { name: artboard.name }),
          variant: "destructive",
        });
        continue;
      }

      try {
        // Store original transform and dimensions
        const originalTransform = artboardElement.style.transform;
        const originalWidth = artboardElement.style.width;
        const originalHeight = artboardElement.style.height;

        // Remove scale transform for export
        artboardElement.style.transform = 'scale(1)';

        // Use html-to-image to capture the artboard at exact specified dimensions
        const { backgroundColor, backgroundImage } = artboardBackground(artboard);
        const captureOptions = {
          width: artboard.size.width,
          height: artboard.size.height,
          backgroundColor,
          pixelRatio: 1, // Set to 1 to avoid doubling resolution
          cacheBust: true, // Prevent caching issues
          // Editor chrome (selection outlines, resize handles, upload buttons)
          // must never be baked into the exported image
          filter: (node: Node) => {
            const el = node as HTMLElement;
            return !(el?.hasAttribute?.('data-export-exclude') || el?.hasAttribute?.('data-interaction-handle'));
          },
          style: {
            width: `${artboard.size.width}px`,
            height: `${artboard.size.height}px`,
            backgroundImage,
          }
        };

        let imageDataUrl: string;
        if (format === 'jpeg') {
          // JPEG has no alpha: html-to-image fills transparent pixels with backgroundColor
          imageDataUrl = await toJpeg(artboardElement, { ...captureOptions, quality });
        } else if (format === 'svg') {
          imageDataUrl = await toSvg(artboardElement, captureOptions);
        } else if (format === 'webp') {
          const pngDataUrl = await toPng(artboardElement, captureOptions);
          imageDataUrl = await rasterToWebPDataUrl(pngDataUrl, backgroundColor, quality);
        } else {
          imageDataUrl = await toPng(artboardElement, captureOptions);
        }

        // Restore original styling after export
        artboardElement.style.transform = originalTransform;
        artboardElement.style.width = originalWidth;
        artboardElement.style.height = originalHeight;

        // Prefix with the canvas position (zero-padded so 10+ boards sort correctly)
        const orderPrefix = String(index + 1).padStart(orderPadWidth, '0');
        // Suffix with the artboard's device format (iPhone/Android/tablet) so the
        // same board exported for different stores stays distinguishable on disk.
        // Detected per artboard, not project-wide, so mixed projects tag correctly.
        const artboardFormat = detectArtboardsFormat([artboard]);
        const deviceLabel = artboardFormat && artboardFormat !== 'mixed'
          ? DEVICE_FORMAT_PRESETS.find((p) => p.id === artboardFormat)?.label
          : undefined;
        const deviceSuffix = deviceLabel ? `_${deviceLabel.replace(/\s+/g, '_')}` : '';
        const extension = format === 'jpeg' ? 'jpg' : format;
        const filename = `${orderPrefix}_${artboard.name.replace(/\s+/g, '_')}${deviceSuffix}.${extension}`;
        // Desktop-safe save: batch exports write into the pre-picked folder,
        // single files get a native save dialog in Tauri or an anchor
        // download on the web
        const savedPath = exportDir
          ? await saveDataUrlToPath(imageDataUrl, exportDir, filename)
          : await saveDataUrlToDisk(imageDataUrl, filename);
        if (savedPath === null) continue; // user cancelled this board's save dialog

        toast({
          title: t('toasts.artboardExported'),
          description: savedPath ? t('toasts.savedTo', { path: savedPath }) : t('toasts.artboardDownloaded', { name: artboard.name }),
          variant: "default",
        });

      } catch (error) {
        console.error("Error exporting artboard:", artboard.name, error);
        toast({
          title: t('toasts.exportError'),
          description: t('toasts.exportArtboardFailed', { name: artboard.name }),
          variant: "destructive",
        });
      }
    }
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
  // is missing. Generated formats are converted in-memory with the same
  // engine as the Devices menu, rendered, captured, then the original state
  // is restored — plain setArtboards keeps history and the saved project
  // untouched, so this can never corrupt the user's work.
  const handleConfirmExport = async ({ asIs, generateFormats, artboardIds, format, quality }: ExportSelection) => {
    setIsExportDialogOpen(false);

    const original = artboards;
    const selectedIds: ReadonlySet<string> = new Set(artboardIds ?? original.map((ab) => ab.id));
    const selectedCount = original.reduce((n, ab) => n + (selectedIds.has(ab.id) ? 1 : 0), 0);
    if (selectedCount === 0) return; // the dialog blocks this; never capture nothing

    // Desktop batch exports pick one destination folder up front instead of
    // opening a native save dialog per file; cancelling the picker aborts
    // the whole export. Single-file exports keep the per-file save dialog.
    let exportDir: string | null | undefined;
    const totalFiles = (asIs ? selectedCount : 0) + generateFormats.length * selectedCount;
    if (isTauri() && totalFiles > 1) {
      exportDir = await pickExportDirectory(t('toasts.pickArtboardFolder'));
      if (exportDir === null) return;
    }

    trackExportPng({
      mode: generateFormats.length > 0 ? 'app_store' : 'as_is',
      formats: generateFormats,
      artboardCount: selectedCount,
      fileCount: totalFiles,
    });

    toast({
      title: t('toasts.exportInitiated'),
      description: t('toasts.exportInitiatedDesc'),
      variant: "default",
    });

    // 3D device canvases re-render supersampled while an export is in flight
    // (see Device3DRenderer); dispatched per capture pass so devices swapped
    // in by a format conversion get the treatment too. The small wait lets
    // that buffer swap present.
    const captureWithExportEvents = async (list: ArtboardState[]) => {
      window.dispatchEvent(new CustomEvent('artboard:export', { detail: { phase: 'begin' } }));
      await new Promise((resolve) => setTimeout(resolve, 100));
      try {
        await captureArtboards(list, exportDir, { format, quality, selectedIds });
      } finally {
        window.dispatchEvent(new CustomEvent('artboard:export', { detail: { phase: 'end' } }));
      }
    };

    try {
      if (asIs) {
        await captureWithExportEvents(original);
      }
      for (const formatId of generateFormats) {
        const preset = DEVICE_FORMAT_PRESETS.find((p) => p.id === formatId);
        if (!preset) continue;
        const { artboards: converted } = convertArtboardsToFormat(original, preset);
        const repositioned = calculateArtboardPositions(converted);
        setArtboards(repositioned);
        await waitForCanvasToSettle(400);
        await captureWithExportEvents(repositioned);
      }
    } catch (error) {
      console.error("Error during multi-format export:", error);
      toast({
        title: t('toasts.exportError'),
        description: t('toasts.exportErrorDesc'),
        variant: "destructive",
      });
    } finally {
      if (generateFormats.length > 0) {
        setArtboards(original);
      }
    }
  };

  // Re-analyze which boards carry video content (recordings, gestures,
  // animations) each time the export dialog opens. Async because recording
  // durations live in the Dexie media table.
  useEffect(() => {
    if (!isExportDialogOpen) return;
    let cancelled = false;
    (async () => {
      const infos: Record<string, ArtboardVideoInfo> = {};
      for (const ab of artboards) {
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
  }, [isExportDialogOpen, artboards]);

  // An App Preview project is one that carries recording mockups, recordings,
  // gesture hints or animations — it gets the video export dialog.
  const isAppPreviewProject = useMemo(() => projectHasVideoContent(artboards), [artboards]);

  // Stable identity for the ExportDialog scope checklist: a fresh .map on
  // every render would retrigger the dialog's reset-on-open effect and wipe
  // the user's picks mid-interaction.
  const exportDialogBoards = useMemo(
    () => artboards.map((ab) => ({ id: ab.id, name: ab.name })),
    [artboards]
  );

  const videoBoards = artboards.filter((ab) => {
    const info = videoInfos[ab.id];
    return !!info && (info.hasVideo || info.hasMotion);
  });
  const suggestedVideoDuration = videoBoards.reduce(
    (max, ab) => Math.max(max, videoInfos[ab.id]?.suggestedDuration ?? 0),
    0
  ) || 15;

  // Render each video-bearing artboard to its own MP4 (sequentially — the
  // encoder and the sprite captures both want the main thread).
  const handleExportVideo = async (request: VideoExportRequest) => {
    const boards = artboards.filter((ab) => {
      const info = videoInfos[ab.id];
      if (!info) return false;
      // Safe mode exports raw footage, so it needs an actual recording.
      return request.rawRecordingOnly ? info.hasVideo : info.hasVideo || info.hasMotion;
    });
    if (boards.length === 0) {
      toast({
        title: t('toasts.nothingToExport'),
        description: request.rawRecordingOnly
          ? t('toasts.safeModeNeedsRecording')
          : t('toasts.addRecordingFirst'),
        variant: 'destructive',
      });
      return;
    }

    let exportDir: string | null | undefined;
    if (isTauri() && boards.length > 1) {
      exportDir = await pickExportDirectory(t('toasts.pickVideoFolder'));
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
        const orderPrefix = String(artboards.indexOf(board) + 1).padStart(orderPadWidth, '0');
        const filename = `${orderPrefix}_${board.name.replace(/\s+/g, '_')}_AppPreview.mp4`;
        const savedPath = exportDir
          ? await saveBlobToPath(blob, exportDir, filename)
          : await saveBlobToDisk(blob, filename);
        if (savedPath === null) continue; // user cancelled this file's save dialog
        toast({
          title: t('toasts.videoExported'),
          description: savedPath ? t('toasts.savedTo', { path: savedPath }) : t('toasts.videoDownloaded', { name: filename }),
        });
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        toast({ title: t('toasts.videoExportCancelled') });
      } else {
        console.error('Video export failed:', error);
        toast({
          title: t('toasts.videoExportFailed'),
          description: error instanceof Error ? error.message : t('toasts.seeConsole'),
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

  const handleUndo = useCallback(() => {
    if (historyIndex > 0) {
      const newHistoryIndex = historyIndex - 1;
      setHistoryIndex(newHistoryIndex);
      const prevState = JSON.parse(JSON.stringify(history[newHistoryIndex]));
      setArtboards(prevState); 
       if (activeArtboardId && !prevState.find((ab: ArtboardState) => ab.id === activeArtboardId)) {
        setActiveArtboardId(prevState.length > 0 ? prevState[0].id : null);
      }
      setSelectedElementIdsOnActiveArtboard([]);
    }
  }, [historyIndex, history, activeArtboardId]);

  const handleRedo = useCallback(() => {
    if (historyIndex < history.length - 1) {
      const newHistoryIndex = historyIndex + 1;
      setHistoryIndex(newHistoryIndex);
      const nextState = JSON.parse(JSON.stringify(history[newHistoryIndex]));
      setArtboards(nextState); 
       if (activeArtboardId && !nextState.find((ab: ArtboardState) => ab.id === activeArtboardId)) {
        setActiveArtboardId(nextState.length > 0 ? nextState[0].id : null);
      }
      setSelectedElementIdsOnActiveArtboard([]);
    }
  }, [historyIndex, history, activeArtboardId, history.length]);

  // Delete the whole selection on the active artboard in a single commit, or
  // the active artboard itself when no element is selected.
  const handleDeleteSelected = useCallback(() => { 
    if (activeArtboardId && selectedElementIdsOnActiveArtboard.length > 0) {
      const activeArtboard = artboards.find(ab => ab.id === activeArtboardId);
      if (activeArtboard) {
        const wanted = new Set(selectedElementIdsOnActiveArtboard);
        const remaining = activeArtboard.elements.filter(el => !wanted.has(el.id));
        const removedCount = activeArtboard.elements.length - remaining.length;

        if (removedCount > 0) {
          handleArtboardsUpdate(artboards.map(ab =>
            ab.id === activeArtboardId ? { ...ab, elements: remaining } : ab
          ));
          setSelectedElementIdsOnActiveArtboard([]);
          toast({
            title: removedCount === 1 ? t('toasts.elementDeleted') : t('toasts.elementsDeleted'),
            description: removedCount === 1
              ? t('toasts.elementDeletedDesc')
              : t('toasts.elementsDeletedDesc', { count: removedCount }),
          });
        } else {
          toast({title: t('toasts.cannotDeleteElement'), description: t('toasts.elementNotFound'), variant: "destructive"});
        }
      }
    } else if (activeArtboardId) { 
      handleDeleteArtboard(activeArtboardId); 
    } else {
      toast({title: t('toasts.cannotDelete'), description: t('toasts.noArtboardOrElement'), variant: "destructive"});
    }
  }, [activeArtboardId, selectedElementIdsOnActiveArtboard, artboards, toast, handleArtboardsUpdate, t]);

  // Arrow-key nudging: arrows move the selection 1 artboard px, Shift+arrows
  // 10 px. One history commit per press via handleArtboardsUpdate.
  const handleNudgeSelected = useCallback((dx: number, dy: number) => {
    if (!activeArtboardId || selectedElementIdsOnActiveArtboard.length === 0) return;
    const activeArtboard = artboards.find(ab => ab.id === activeArtboardId);
    if (!activeArtboard) return;
    const wanted = new Set(selectedElementIdsOnActiveArtboard);
    if (!activeArtboard.elements.some(el => wanted.has(el.id))) return;
    handleArtboardsUpdate(artboards.map(ab =>
      ab.id !== activeArtboardId
        ? ab
        : {
            ...ab,
            elements: ab.elements.map(el =>
              wanted.has(el.id)
                ? ({ ...el, position: { x: el.position.x + dx, y: el.position.y + dy } } as ArtboardElement)
                : el
            ),
          }
    ));
  }, [activeArtboardId, selectedElementIdsOnActiveArtboard, artboards, handleArtboardsUpdate]);

  // Add keyboard event handlers for delete, undo, redo, clipboard, selection
  // and nudging. This is the ONLY keydown effect; keep every shortcut here.
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

      const hasElementSelection = selectedElementIdsOnActiveArtboard.length > 0;

      // Copy: Ctrl+C or Cmd+C
      if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
        e.preventDefault();
        if (activeArtboardId && hasElementSelection) {
          handleCopyElement();
        }
      }

      // Paste: Ctrl+V or Cmd+V
      if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
        e.preventDefault();
        if (clipboardItems.length > 0) {
          handlePasteElement();
        }
      }

      // Select all on the active artboard: Ctrl+A or Cmd+A
      if ((e.ctrlKey || e.metaKey) && (e.key === 'a' || e.key === 'A')) {
        if (activeArtboardId) {
          e.preventDefault();
          const activeAb = artboards.find(ab => ab.id === activeArtboardId);
          if (activeAb) {
            setSelectedElementIdsOnActiveArtboard(activeAb.elements.map(el => el.id));
          }
        }
      }

      // Escape clears the element selection
      if (e.key === 'Escape' && hasElementSelection) {
        setSelectedElementIdsOnActiveArtboard([]);
      }

      // Nudge: arrows move the selection 1 artboard px, Shift+arrows 10 px
      if (e.key.startsWith('Arrow') && activeArtboardId && hasElementSelection) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        handleNudgeSelected(dx, dy);
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
  }, [handleDeleteSelected, handleNudgeSelected, handleUndo, handleRedo, historyIndex, history.length, activeArtboardId, selectedElementIdsOnActiveArtboard, clipboardItems, artboards, setActiveTool, isPreviewOpen]);

  const handleArtboardSelection = (artboardId: string | null) => {
    setActiveArtboardId(artboardId);
    if (artboardId !== activeArtboardId) {
        setSelectedElementIdsOnActiveArtboard([]);
    }
  }

  // Single-id selection entry point (canvas click, layers panel). A plain
  // call selects just that element (or clears when null); { additive: true }
  // toggles it in/out of the current selection (Shift/Ctrl/Cmd click).
  const handleElementSelectionOnArtboard = (elementId: string | null, modifiers?: { additive?: boolean }) => {
    setSelectedElementIdsOnActiveArtboard((prev) => {
      if (elementId === null) return [];
      if (modifiers?.additive) {
        return prev.includes(elementId) ? prev.filter((id) => id !== elementId) : [...prev, elementId];
      }
      return [elementId];
    });
  }

  // Bulk selection entry point (marquee, select-all, paste).
  const handleElementsSelectionOnArtboard = (elementIds: string[]) => {
    setSelectedElementIdsOnActiveArtboard(elementIds);
  }

  const handleSelectElementFromLayerPanel = (elementId: string, modifiers?: { additive?: boolean }) => {
    handleElementSelectionOnArtboard(elementId, modifiers);
  };

  // Add handler for deleting element from layers panel
  const handleDeleteElementFromLayerPanel = (elementId: string) => {
    if (activeArtboardId) {
      const artboardComponent = artboardRefs.current[activeArtboardId];
      if (artboardComponent && artboardComponent.deleteElementByIdG) {
        artboardComponent.deleteElementByIdG(elementId);
        setSelectedElementIdsOnActiveArtboard((prev) => prev.filter((id) => id !== elementId));
        toast({ title: t('toasts.elementDeleted'), description: t('toasts.elementDeletedDesc') });
      } else {
        toast({ title: t('toasts.cannotDeleteElement'), description: t('toasts.artboardRefNotFound'), variant: "destructive" });
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

  // Alignment controls in the properties panel. A single element aligns
  // inside the artboard bounds; a multi-selection aligns inside its own
  // bounding box, with distribute available at 3+ elements. One commit per
  // click via handleArtboardsUpdate, so undo restores the previous layout.
  const handleAlignElements = useCallback((mode: ElementAlignment) => {
    if (!activeArtboardId || selectedElementIdsOnActiveArtboard.length === 0) return;
    const activeAb = artboards.find(ab => ab.id === activeArtboardId);
    if (!activeAb) return;
    const alignedElements = alignElementsWithinArtboard(activeAb, selectedElementIdsOnActiveArtboard, mode);
    if (!alignedElements) return; // nothing would move; skip the history entry
    handleArtboardsUpdate(artboards.map(ab =>
      ab.id === activeArtboardId ? { ...ab, elements: alignedElements } : ab
    ));
  }, [activeArtboardId, selectedElementIdsOnActiveArtboard, artboards, handleArtboardsUpdate]);

  // Applies a new canvas size to every artboard. With `scaleContent` (the
  // Canvas Size dialog's default) each artboard's elements are uniformly
  // scaled and re-centered — same treatment as the Devices format conversion —
  // so designs survive aspect-ratio changes instead of getting cropped.
  const handleUpdateArtboardSize = (width: number, height: number, scaleContent = true) => {
    if (width < 100 || height < 100 || width > 5000 || height > 5000) {
      toast({ 
        title: t('toasts.invalidDimensions'), 
        description: t('toasts.invalidDimensionsDesc', { min: 100, max: 5000 }),
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
    
    // Recalculate positions to avoid overlap
    const repositionedArtboards = calculateArtboardPositions(updatedArtboards);
    
    // Update state
    setArtboards(repositionedArtboards);
    pushToHistory(repositionedArtboards);
    
    toast({ 
      title: t('toasts.sizeUpdated'), 
      description: scaleContent
        ? t('toasts.sizeUpdatedScaled', { width, height })
        : t('toasts.sizeUpdatedPlain', { width, height })
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
        title: t('toasts.noTextFound'),
        description: t('toasts.noTextFoundDesc')
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
        title: t('toasts.nothingToTranslate'),
        description: t('toasts.alreadyInLanguage', { language: getLanguageName(targetLanguage) })
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
        handleArtboardsUpdate(newArtboards);
      }
      toast({
        title: t('toasts.rateLimitExceeded'),
        description: t('toasts.rateLimitDesc', { count: successCount }),
        variant: "destructive"
      });
    } else if (successCount > 0) {
      handleArtboardsUpdate(newArtboards);
      toast({
        title: t('toasts.translationComplete'),
        description: `${t('toasts.translationCompleteDesc', { count: successCount })}${failCount > 0 ? t('toasts.translationFailedPart', { count: failCount }) : ''}`
      });
    } else if (failCount > 0) {
      toast({
        title: t('toasts.translationFailed'),
        description: t('toasts.translationFailedDesc'),
        variant: "destructive"
      });
    } else {
      toast({
        title: t('toasts.noTextFound'),
        description: t('toasts.noTextFoundDesc')
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
        title: t('toasts.nothingToTranslate'),
        description: t('toasts.nothingToTranslateEmpty')
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
        title: t('toasts.nothingToTranslate'),
        description: t('toasts.alreadyInLanguage', { language: getLanguageName(targetLanguage) })
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
        title: e?.status === 429 ? t('toasts.rateLimitExceeded') : t('toasts.translationFailed'),
        description: e?.status === 429
          ? t('toasts.rateLimitWait')
          : t('toasts.translationFailedElement'),
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
      )
    );

    toast({
      title: t('toasts.translationComplete'),
      description: t('toasts.textTranslatedTo', { language: getLanguageName(targetLanguage) })
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


  // Preload Google Fonts on component mount
  useEffect(() => {
    preloadGoogleFonts();
  }, []);
  
  const activeArtboard = artboards.find(ab => ab.id === activeArtboardId);
  const activeArtboardElements = activeArtboard ? activeArtboard.elements : [];
  const activeArtboardName = activeArtboard ? activeArtboard.name : undefined;


  // Define the copy element handler. Explicit ids come from the context menu:
  // copying a right-clicked element that is part of the current selection
  // copies the whole set, otherwise just that element. The keyboard shortcut
  // passes no ids and copies the current selection.
  const handleCopyElement = (targetArtboardId?: string | null, targetElementId?: string | null) => {
    const artboardId = targetArtboardId ?? activeArtboardId;
    if (!artboardId) return;
    const activeAb = artboards.find(ab => ab.id === artboardId);
    if (!activeAb) return;

    let elementsToCopy: ArtboardElement[] = [];
    if (targetElementId) {
      const selectionOnTarget = artboardId === activeArtboardId ? selectedElementIdsOnActiveArtboard : [];
      const wanted = selectionOnTarget.includes(targetElementId) ? new Set(selectionOnTarget) : new Set([targetElementId]);
      elementsToCopy = activeAb.elements.filter(el => wanted.has(el.id));
    } else if (artboardId === activeArtboardId) {
      const wanted = new Set(selectedElementIdsOnActiveArtboard);
      elementsToCopy = activeAb.elements.filter(el => wanted.has(el.id));
    }

    if (elementsToCopy.length > 0) {
      copyElementsToClipboard(elementsToCopy);
      toast({
        title: t('toasts.copied'),
        description: elementsToCopy.length === 1
          ? t('toasts.copiedOne', { type: elementsToCopy[0].type })
          : t('toasts.copiedMany', { count: elementsToCopy.length }),
      });
    }
  };

  // Define the paste element handler. The context menu passes the right-clicked
  // artboard and a paste point (artboard coordinates) so the set lands centered
  // under the cursor; the keyboard shortcut offsets from the original instead.
  // A multi-element paste preserves the relative arrangement.
  const handlePasteElement = (targetArtboardId?: string | null, pastePoint?: Point | null) => {
    const artboardId = targetArtboardId ?? activeArtboardId;
    if (artboardId && clipboardItems.length > 0) {
      const targetArtboard = artboards.find(ab => ab.id === artboardId);
      const bounds = selectionBounds(clipboardItems);
      const stamp = Date.now();

      let offsetX = 20; // Offset position slightly when no paste point is given
      let offsetY = 20;
      if (pastePoint && targetArtboard && bounds) {
        offsetX = pastePoint.x - bounds.width / 2 - bounds.left;
        offsetY = pastePoint.y - bounds.height / 2 - bounds.top;
        // Clamp so the pasted set stays inside the artboard
        offsetX = Math.max(-bounds.left, Math.min(offsetX, targetArtboard.size.width - bounds.right));
        offsetY = Math.max(-bounds.top, Math.min(offsetY, targetArtboard.size.height - bounds.bottom));
      }

      const newElements = clipboardItems.map((item, index) => ({
        ...JSON.parse(JSON.stringify(item)),
        id: `el_${stamp}_${index}_${Math.random().toString(36).substr(2, 5)}`, // New unique IDs
        position: { x: item.position.x + offsetX, y: item.position.y + offsetY },
      })) as ArtboardElement[];

      const updatedArtboards = artboards.map(ab => {
        if (ab.id === artboardId) {
          return {
            ...ab,
            elements: [...ab.elements, ...newElements]
          };
        }
        return ab;
      });

      handleArtboardsUpdate(updatedArtboards);
      if (artboardId !== activeArtboardId) {
        setActiveArtboardId(artboardId);
      }
      setSelectedElementIdsOnActiveArtboard(newElements.map(el => el.id));
      toast({
        title: t('toasts.pasted'),
        description: newElements.length === 1
          ? t('toasts.pastedOne', { type: newElements[0].type })
          : t('toasts.pastedMany', { count: newElements.length }),
      });
    } else if (!artboardId) {
      toast({
        title: t('toasts.cannotPaste'),
        description: t('toasts.selectArtboardFirst'),
        variant: "destructive"
      });
    }
  };

  // Custom right-click: block the browser menu everywhere in the studio (text
  // fields keep the native menu so text copy/paste still works) and open our
  // menu when the click lands in the canvas area. Right-clicking an element
  // selects it first, like every design tool.
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

      if (isPreviewOpen) return;
      if (!canvasContainerRef.current?.contains(target)) {
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
            x: (e.clientX - rect.left) / renderedScale,
            y: (e.clientY - rect.top) / renderedScale,
          };
        }
      }

      if (artboardId) {
        setActiveArtboardId(artboardId);
        if (elementId) {
          // Right-clicking an element that is already in the selection keeps
          // the set (so Copy acts on all of it); otherwise it selects alone.
          setSelectedElementIdsOnActiveArtboard(
            artboardId === activeArtboardId && selectedElementIdsOnActiveArtboard.includes(elementId)
              ? selectedElementIdsOnActiveArtboard
              : [elementId]
          );
        } else {
          setSelectedElementIdsOnActiveArtboard([]);
        }
      }
      setContextMenu({ x: e.clientX, y: e.clientY, elementId, artboardId, pastePoint });
    };

    document.addEventListener('contextmenu', handleContextMenu);
    return () => document.removeEventListener('contextmenu', handleContextMenu);
  }, [isPreviewOpen, activeArtboardId, selectedElementIdsOnActiveArtboard]);
  
  // NOTE: keyboard shortcuts live in a single consolidated keydown effect
  // further up (delete/undo/redo/clipboard/select-all/nudge). A second,
  // identical keydown effect used to be registered here; do not re-add one.

  // Common function to load project data and apply positioning
  const loadProjectFromData = async (projectData: ArtboardState[], projectName: string, projectId: string) => {
    try {
      setIsLoadingTemplate(true); // Prevent effect from loading project
      
      // Apply proper positioning to the artboards
      console.log("Loading project data with positioning for:", projectName);
      const finalArtboards = calculateArtboardPositions(migrateVideoDevices(projectData));
      console.log("Final artboards with positions:", finalArtboards.map((ab: ArtboardState) => ({ id: ab.id, position: ab.position })));
      
      // Set project details first to avoid triggering effects
      setCurrentProjectName(projectName);
      setActiveProjectId(projectId);
      
      // Set artboards and history without triggering handleArtboardsUpdate
      setArtboards(finalArtboards);
      setHistory([JSON.parse(JSON.stringify(finalArtboards))]); 
      setHistoryIndex(0);
      
      // Automatically select the first artboard
      setActiveArtboardId(finalArtboards.length > 0 ? finalArtboards[0].id : null);
      setSelectedElementIdsOnActiveArtboard([]);
      setIsTemplateSelectorOpen(false);

      // Update recent projects list
      const updatedProjects = await db.projects.orderBy("timestamp").reverse().toArray();
      setRecentProjects(updatedProjects);

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

  // Import project from JSON
  const handleImportProjectFromJSON = () => {
    // Create a hidden file input element
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.json';
    fileInput.style.display = 'none';
    
    fileInput.onchange = async (event) => {
      const file = (event.target as HTMLInputElement).files?.[0];
      if (!file) return;

      try {
        const fileContent = await file.text();
        // bundleFromJson validates the shape and restores any bundled media.
        // It still accepts files written before media travelled with the JSON.
        const bundle = bundleFromJson(JSON.parse(fileContent));

        const importedName = bundle.manifest.name || `Imported ${bundle.manifest.id}`;
        const imported = await importBundle(bundle, {
          // A fresh id keeps an import from overwriting the project it came from.
          projectId: `imported_${Date.now()}`,
          name: importedName,
        });

        const success = await loadProjectFromData(
          imported.projectData,
          imported.name,
          imported.id
        );

        if (success) {
          toast({
            title: t('toasts.projectImported'),
            description: t('toasts.projectImportedDesc', { name: importedName }),
            variant: "default",
          });
        } else {
          toast({
            title: t('toasts.importFailed'),
            description: t('toasts.importFailedDesc'),
            variant: "destructive",
          });
        }

      } catch (error) {
        console.error("Error importing project:", error);
        toast({
          title: t('toasts.importFailed'),
          description: error instanceof Error ? error.message : t('toasts.importParseError'),
          variant: "destructive",
        });
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

  const templateSelectorDialog = (
      <>
        <Dialog
          open={isTemplateSelectorOpen}
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
                    aria-label={t('common.back')}
                  >
                    <ChevronLeftIcon className="h-4 w-4" />
                  </Button>
                  <div className="min-w-0 flex-1 text-left">
                    <DialogTitle>{t('gallery.agentViewTitle')}</DialogTitle>
                    <DialogDescription>{t('gallery.agentViewDesc')}</DialogDescription>
                  </div>
                </div>
              </DialogHeader>
            ) : (
              // The two entry cards below say all of this, so the heading is only
              // kept for the dialog's accessible name. sr-only takes it out of
              // flow, so it costs no vertical space either.
              <>
                <DialogTitle className="sr-only">{t('gallery.startDialogTitle')}</DialogTitle>
                <DialogDescription className="sr-only">
                  {t('gallery.startDialogDesc')}
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
                {TEMPLATE_CATEGORIES.map((cat) => (
                  <TabsTrigger key={cat.id} value={cat.id} className="gap-1.5">
                    {cat.label}
                    <span className="inline-flex min-w-[1.25rem] items-center justify-center rounded-full border px-1 text-[11px] tabular-nums text-muted-foreground">
                      {isLoadingProjects ? '…' : (templateCounts[cat.id] ?? 0)}
                    </span>
                  </TabsTrigger>
                ))}
              </TabsList>
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
                          {t('gallery.emptyCategory', { category: cat.label })}{cat.blurb ? ` ${cat.blurb}` : ''}
                        </p>
                        <Button variant="outline" onClick={() => handleSelectTemplate(createBlankProject(cat.defaultSize))}>
                          {t('gallery.startBlankSize', { width: cat.defaultSize.width, height: cat.defaultSize.height })}
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
                <h3 className="text-lg font-semibold mb-2">{t('gallery.recentProjects')}</h3>
                {recentProjects.length > 0 ? (
                  <ScrollArea className="h-[20vh]">
                    <ul className="grid grid-cols-1 gap-1.5 pr-3 sm:grid-cols-2">
                      {recentProjects.map((project) => (
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
                            <div className="truncate text-xs text-muted-foreground">{t('gallery.savedOn', { date: project.timestamp.toLocaleString() })}</div>
                          </div>
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
                            title={project.id === activeProjectId ? t('gallery.cannotDeleteOpen') : t('gallery.deleteProject')}
                          >
                            <Trash2Icon className="h-4 w-4" />
                          </Button>
                        </li>
                      ))}
                    </ul>
                  </ScrollArea>
                ) : (
                  <p className="text-sm text-muted-foreground">{t('gallery.noRecent')}</p>
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
              <AlertDialogTitle>{t('gallery.deleteConfirmTitle')}</AlertDialogTitle>
              <AlertDialogDescription>{t('gallery.deleteConfirmDesc')}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
              <AlertDialogAction 
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => projectToDelete && handleDeleteProject(projectToDelete)}
              >
                {t('common.delete')}
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

  // Render one artboard for the MCP export tools. Same capture recipe as the
  // Export dialog (unscale the node, drop editor chrome, restore afterwards),
  // plus the two things an external agent needs: an output scale, so a proof
  // does not have to ship a full-size PNG as base64, and writing straight to
  // disk through Rust — the JS fs plugin only unlocks paths the user picked in
  // a dialog, and these exports are unattended.
  //
  // Deliberately PNG-only: the agent contract promises lossless stills and the
  // Rust writer (abs_mcp_write_png) stores PNG bytes, so the Export dialog's
  // format picker (JPEG/SVG/WebP) does not apply here.
  const captureArtboardForMcp = async (
    board: ArtboardState,
    options: { scale?: number; save?: boolean; directory?: string; fileName?: string; includeImage?: boolean }
  ): Promise<McpExportResult> => {
    const node = document.querySelector(`[data-artboard-dom-id="${board.id}"]`) as HTMLElement | null;
    if (!node) throw new Error('That artboard is not on screen; open the project in the app first.');
    const scale = Math.min(4, Math.max(0.1, options.scale ?? 1));

    const original = { transform: node.style.transform, width: node.style.width, height: node.style.height };
    node.style.transform = 'scale(1)';
    let dataUrl: string;
    try {
      const { backgroundColor, backgroundImage } = artboardBackground(board);
      dataUrl = await toPng(node, {
        width: board.size.width,
        height: board.size.height,
        backgroundColor,
        pixelRatio: scale,
        cacheBust: true,
        filter: (n) => {
          const el = n as HTMLElement;
          return !(el?.hasAttribute?.('data-export-exclude') || el?.hasAttribute?.('data-interaction-handle'));
        },
        style: { width: `${board.size.width}px`, height: `${board.size.height}px`, backgroundImage },
      });
    } finally {
      node.style.transform = original.transform;
      node.style.width = original.width;
      node.style.height = original.height;
    }

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

  const mcpApi: McpDesignApi = {
    listArtboards: () =>
      artboards.map((ab) => ({
        id: ab.id,
        name: ab.name,
        width: ab.size.width,
        height: ab.size.height,
        backgroundColor: ab.backgroundColor,
        elementCount: ab.elements.length,
        active: ab.id === activeArtboardId,
      })),
    getArtboard: (id) => {
      const boardId = resolveBoardId(id);
      const ab = artboards.find((b) => b.id === boardId);
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
          'That is the only artboard — a project needs at least one. Create another first, or clear this one with delete_element.'
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
      const copy: ArtboardState = {
        ...JSON.parse(JSON.stringify(source)),
        id: `artboard_${stamp}`,
        name: name?.trim() || `${source.name} copy`,
        // Fresh element ids: the copy has to be independently addressable, or
        // update_element would hit whichever board came first.
        elements: source.elements.map((el, i) => ({
          ...JSON.parse(JSON.stringify(el)),
          id: `el_${stamp}_${i}_${Math.random().toString(36).slice(2, 7)}`,
        })),
      };
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
        artboards.map((ab) => (ab.id === boardId ? { ...ab, elements: ab.elements.filter((el) => el.id !== elementId) } : ab))
      );
      if (selectedElementIdsOnActiveArtboard.includes(elementId)) {
        setSelectedElementIdsOnActiveArtboard((prev) => prev.filter((id) => id !== elementId));
      }
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
    exportPng: async ({ artboardId, scale, save, directory, fileName, includeImage }) => {
      const boardId = resolveBoardId(artboardId);
      const board = artboards.find((ab) => ab.id === boardId);
      if (!board) throw new Error('No such artboard.');
      return captureArtboardForMcp(board, {
        scale,
        save,
        directory,
        fileName,
        includeImage: includeImage ?? !save,
      });
    },
    exportAll: async ({ scale, save, directory, includeImage }) => {
      if (artboards.length === 0) return [];
      const shouldSave = save !== false;
      const results: McpExportResult[] = [];
      const padTo = Math.max(2, String(artboards.length).length);
      for (const [index, board] of artboards.entries()) {
        results.push(
          await captureArtboardForMcp(board, {
            scale,
            save: shouldSave,
            directory,
            fileName: `${String(index + 1).padStart(padTo, '0')}_${board.name}`,
            includeImage: includeImage ?? false,
          })
        );
      }
      return results;
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
                <span className="text-xs leading-tight text-muted-foreground">{t('chrome.tagline')}</span>
              </div>
            </div>
          </SidebarHeader>
          <SidebarContent>
            <ElementPalette
              onAddElement={(type, subType, styleProps) => {
                if (activeArtboardId) {
                  handleAddElementToArtboard(activeArtboardId, type, subType, undefined, styleProps);
                } else {
                  toast({ title: t('toasts.noArtboardActive'), description: t('toasts.selectOrCreateArtboard'), variant: "destructive" });
                }
              }}
            />
          </SidebarContent>
          <SidebarFooter className="group-data-[collapsible=icon]:justify-center">
             <SidebarGroup className="p-0">
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton
                    tooltip={accountSession ? t('chrome.accountTooltipNamed', { name: accountSession.account.name }) : t('chrome.account')}
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
                      {accountSession ? accountSession.account.name : t('chrome.account')}
                    </span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <LanguageSwitcher />
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton tooltip={t('chrome.about')} className="w-full" onClick={() => setIsAboutOpen(true)}>
                    <InfoIcon />
                    <span className="group-data-[collapsible=icon]:hidden">{t('chrome.about')}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroup>
          </SidebarFooter>
        </Sidebar>

        <SidebarInset className="relative flex flex-col overflow-hidden">
          <LoadStatusBar phase={loadPhase} templateProgress={templateProgress} />
          <Toolbar
            onNewArtboard={handleNewArtboardFromMainToolbar}
            onSelectTemplate={() => setIsTemplateSelectorOpen(true)}
            onPreview={() => setIsPreviewOpen(true)}
            onExport={() => setIsExportDialogOpen(true)}
            onExportJSON={handleExportProjectAsJSON}
            onImportJSON={handleImportProjectFromJSON}
            onSaveToAccount={handleSaveToAccount}
            isAccountConnected={isAccountConnected}
            isSavingToAccount={isSavingToAccount}
            canUndo={historyIndex > 0}
            canRedo={historyIndex < history.length - 1}
            onUndo={handleUndo}
            onRedo={handleRedo}
            onDeleteSelected={handleDeleteSelected}
            isElementSelected={selectedElementIdsOnActiveArtboard.length > 0}
            isArtboardSelected={!!activeArtboardId}
            activeTool={activeTool}
            onSetActiveTool={setActiveTool}
            onUpdateArtboardSize={handleUpdateArtboardSize}
            initialArtboardSize={getCurrentArtboardSize()}
            currentProjectName={currentProjectName}
            onRenameProject={handleRenameProject}
            onSelectDeviceFormat={handleSelectDeviceFormat}
            activeDeviceFormat={activeDeviceFormat}
            onTranslate={() => {
              setTranslateElementId(null);
              setIsTranslateSingleArtboard(false);
              setIsTranslateDialogOpen(true);
            }}
            isTranslationEnabled={isTranslationEnabled}
            className="sticky top-0 z-50 bg-card border-b"
          />
          
          {/* Main content area with flex layout */}
          <div className="flex flex-1 overflow-hidden h-full">
            {/* Canvas area - takes remaining space */}
            <div ref={canvasContainerRef} className="flex-1 relative overflow-hidden">
              <CanvasArea
                artboards={artboards}
                onUpdateArtboards={handleArtboardsUpdate}
                onAddElementToArtboard={handleAddElementToArtboard}
                activeArtboardId={activeArtboardId}
                setActiveArtboardId={handleArtboardSelection}
                selectedElementIdsOnActiveArtboard={selectedElementIdsOnActiveArtboard}
                setSelectedElementIdOnActiveArtboard={handleElementSelectionOnArtboard}
                setSelectedElementIdsOnActiveArtboard={handleElementsSelectionOnArtboard}
                canvasZoom={canvasZoom}
                onCanvasZoomChange={setCanvasZoom}
                artboardRefs={artboardRefs}
                onAddNewArtboardFromToolbar={handleAddNewArtboardAfter}
                onDuplicateArtboardFromToolbar={handleDuplicateArtboard}
                onDeleteArtboardFromToolbar={handleDeleteArtboard}
                onMoveArtboardFromToolbar={handleMoveArtboard}
                onTranslateArtboard={handleTranslateArtboard}
                activeTool={activeTool}
                isLoading={loadPhase === 'project' || (!!activeProjectId && artboards.length === 0)}
                onImagesDroppedOnEmptyCanvas={(files) => void handleImagesDroppedOnEmptyCanvas(files)}
              />

              {/* Floating zoom control (bottom-left of canvas) */}
              <div className="absolute bottom-4 left-4 z-40 flex items-center gap-1 rounded-full border border-border bg-card/95 px-2 py-1 shadow-lg backdrop-blur">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 rounded-full"
                  onClick={() => setCanvasZoom(prev => Math.max(prev / 1.2, 0.1))}
                  title={t('chrome.zoomOut')}
                >
                  <ZoomOutIcon className="h-[1.1rem] w-[1.1rem]" />
                </Button>
                <button
                  type="button"
                  onClick={() => setCanvasZoom(1)}
                  className="min-w-[48px] text-center text-xs font-semibold tabular-nums hover:text-primary"
                  title={t('chrome.resetZoom')}
                >
                  {Math.round(canvasZoom * 100)}%
                </button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 rounded-full"
                  onClick={() => setCanvasZoom(prev => Math.min(prev * 1.2, 4))}
                  title={t('chrome.zoomIn')}
                >
                  <ZoomInIcon className="h-[1.1rem] w-[1.1rem]" />
                </Button>
              </div>

              {/* MCP server status (desktop only; renders nothing on the web) */}
              <McpServerStatus className="absolute bottom-4 right-4 z-40" />

              {contextMenu && (
                <CanvasContextMenu
                  x={contextMenu.x}
                  y={contextMenu.y}
                  canCopy={!!contextMenu.elementId && !!contextMenu.artboardId}
                  canPaste={clipboardItems.length > 0 && !!(contextMenu.artboardId || activeArtboardId)}
                  onCopy={() => handleCopyElement(contextMenu.artboardId, contextMenu.elementId)}
                  onPaste={() => handlePasteElement(contextMenu.artboardId, contextMenu.pastePoint)}
                  onClose={() => setContextMenu(null)}
                />
              )}
            </div>

            {/* Right dock: Properties on top, Layers below, resizable split.
                Collapsed it becomes a slim vertical rail with rotated labels
                (Android Studio tool-window style). */}
            {isRightDockOpen ? (
              <div className="flex h-full w-80 flex-shrink-0 flex-col border-l bg-card" data-export-exclude>
                <div className="flex h-9 shrink-0 items-center justify-between border-b pl-3 pr-1.5">
                  <span className="text-sm font-semibold">{t('chrome.properties')}</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => setRightDockOpen(false)}
                    title={t('chrome.collapsePanel')}
                    aria-label={t('chrome.collapsePanel')}
                  >
                    <PanelRightCloseIcon className="h-4 w-4" />
                  </Button>
                </div>
                <div ref={dockContentRef} className="flex min-h-0 flex-1 flex-col">
                  <div className="min-h-[10rem] flex-1 overflow-hidden">
                    <PropertiesPanel
                      selectedElement={selectedElementDetails}
                      selectionCount={selectedElementIdsOnActiveArtboard.length}
                      onAlignElements={handleAlignElements}
                      onUpdateElement={handleUpdateSelectedElement}
                      onUpdateElementById={handleUpdateElementById}
                      onTranslateElement={handleTranslateTextElement}
                      activeArtboardDetails={
                        activeArtboardId && selectedElementIdsOnActiveArtboard.length === 0 ? activeArtboard : null
                      }
                      onUpdateArtboardDetails={handleUpdateArtboardDetails}
                      className="h-full border-l-0 shadow-none"
                    />
                  </div>
                  <div
                    role="separator"
                    aria-orientation="horizontal"
                    title={t('chrome.dragToResize')}
                    className="group relative h-2 shrink-0 cursor-row-resize touch-none border-y bg-muted/50 hover:bg-primary/15"
                    onPointerDown={(e) => {
                      e.preventDefault();
                      e.currentTarget.setPointerCapture(e.pointerId);
                      dividerDragRef.current = {
                        pointerId: e.pointerId,
                        startY: e.clientY,
                        startHeight: layersSectionHeight,
                        lastHeight: layersSectionHeight,
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
                      setLayersSectionHeight(next);
                    }}
                    onPointerUp={(e) => {
                      const drag = dividerDragRef.current;
                      if (!drag || drag.pointerId !== e.pointerId) return;
                      dividerDragRef.current = null;
                      try { window.localStorage.setItem(RIGHT_DOCK_LAYERS_HEIGHT_KEY, String(drag.lastHeight)); } catch {}
                    }}
                    onPointerCancel={() => {
                      dividerDragRef.current = null;
                    }}
                  >
                    <div className="absolute left-1/2 top-1/2 h-0.5 w-8 -translate-x-1/2 -translate-y-1/2 rounded-full bg-muted-foreground/40 group-hover:bg-primary/60" />
                  </div>
                  {/* max-h keeps the properties form usable when a persisted
                      height is taller than the current window allows */}
                  <div
                    style={{ height: layersSectionHeight }}
                    className="max-h-[calc(100%-10rem)] shrink-0 overflow-hidden"
                  >
                    <LayersPanel
                      elements={activeArtboardElements}
                      selectedElementIds={selectedElementIdsOnActiveArtboard}
                      onSelectElement={handleSelectElementFromLayerPanel}
                      onMoveElementLayer={handleMoveElementLayer}
                      onDeleteElement={handleDeleteElementFromLayerPanel}
                      onRenameElement={handleRenameElementFromLayerPanel}
                      activeArtboardName={activeArtboardName}
                    />
                  </div>
                </div>
              </div>
            ) : (
              <div
                className="flex h-full w-9 flex-shrink-0 flex-col items-center gap-1 border-l bg-card py-1.5"
                data-export-exclude
              >
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  onClick={() => setRightDockOpen(true)}
                  title={t('chrome.expandPanel')}
                  aria-label={t('chrome.expandPanel')}
                >
                  <PanelRightOpenIcon className="h-4 w-4" />
                </Button>
                <div className="mt-1 h-px w-5 bg-border" />
                {(['chrome.properties', 'chrome.layers'] as const).map((labelKey) => (
                  <button
                    key={labelKey}
                    type="button"
                    className="rounded px-0.5 py-2 text-[11px] font-medium tracking-wide text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    style={{ writingMode: 'vertical-rl' }}
                    onClick={() => setRightDockOpen(true)}
                    title={t('chrome.openLabel', { label: t(labelKey) })}
                  >
                    {t(labelKey)}
                  </button>
                ))}
              </div>
            )}
          </div>

          {isPreviewOpen && (
            <PreviewDialog
              artboards={artboards}
              initialArtboardId={activeArtboardId}
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
              onExportVideo={handleExportVideo}
              onCancelVideoExport={handleCancelVideoExport}
              onExportStills={() => handleConfirmExport({ asIs: true, generateFormats: [] })}
              videoProgress={videoProgress}
              isVideoExporting={isVideoExporting}
            />
          ) : (
            <ExportDialog
              isOpen={isExportDialogOpen}
              onOpenChange={setIsExportDialogOpen}
              onConfirmExport={handleConfirmExport}
              currentFormat={activeDeviceFormat}
              currentSize={artboards[0]?.size}
              artboards={exportDialogBoards}
            />
          )}

          <AccountDialog
            open={isAccountOpen}
            onOpenChange={(open) => {
              setIsAccountOpen(open);
              if (!open) setAccountHint(undefined);
            }}
            hint={accountHint}
            onOpenProject={handleOpenFromAccount}
          />

          {/* Bulk drop onto an empty canvas: rank templates by device-slot fit
              and build the picked one with the screenshots auto-placed. */}
          <Dialog
            open={bulkDropDialogOpen}
            onOpenChange={(open) => {
              setBulkDropDialogOpen(open);
              if (!open) setBulkDropScreenshots([]);
            }}
          >
            <DialogContent className="max-w-3xl">
              <DialogHeader>
                <DialogTitle className="sr-only">{t('proposal.title')}</DialogTitle>
                <DialogDescription className="sr-only">
                  {t('gallery.bulkDropDesc')}
                </DialogDescription>
              </DialogHeader>
              {bulkDropReading ? (
                <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
                  <Loader2Icon className="h-4 w-4 animate-spin" />
                  {t('gallery.readingImages')}
                </div>
              ) : (
                <TemplateProposalPicker
                  templates={availableProjects}
                  screenshots={bulkDropScreenshots}
                  onPick={(template) => void handleBulkDropPick(template)}
                />
              )}
            </DialogContent>
          </Dialog>

          <TranslateDialog
            isOpen={isTranslateDialogOpen}
            onOpenChange={(open) => {
              setIsTranslateDialogOpen(open);
              if (!open) setTranslateElementId(null);
            }}
            currentLanguage={translateElementId ? translateElementArtboard?.language : currentProjectLanguage}
            disableAllArtboardsOption={isTranslateSingleArtboard}
            scope={translateElementId ? 'element' : 'project'}
            onTranslate={handleTranslateRequest}
          />

          <Dialog open={isAboutOpen} onOpenChange={setIsAboutOpen}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <div className="flex items-center gap-3">
                  <Logo withBackground className="h-12 w-12" />
                  <div className="text-left">
                    <DialogTitle>Open Screenshot Generator</DialogTitle>
                    <DialogDescription>{t('about.version', { version: packageJson.version })}</DialogDescription>
                  </div>
                </div>
              </DialogHeader>
              <div className="space-y-3 text-sm text-muted-foreground">
                <p>{t('about.body1')}</p>
                <p>{t('about.body2')}</p>
              </div>
              <DialogFooter className="gap-2 sm:justify-between">
                <Button variant="outline" asChild>
                  <a
                    href="https://github.com/dotnetdreamer/open-screenshot-generator"
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => {
                      // WebViews ignore target=_blank; route to the system browser
                      if (isTauri()) {
                        e.preventDefault();
                        openExternal("https://github.com/dotnetdreamer/open-screenshot-generator");
                      }
                    }}
                  >
                    {t('about.viewOnGithub')}
                  </a>
                </Button>
                <Button onClick={() => setIsAboutOpen(false)}>{t('common.close')}</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </SidebarInset>
      </SidebarProvider>
    </ClipboardProvider>
  );
}

