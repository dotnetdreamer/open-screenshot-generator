"use client";
import React, { useState, useEffect, useLayoutEffect, useCallback, useMemo, useRef, useDeferredValue } from 'react';
import { toPng } from 'html-to-image';
import { preloadGoogleFonts } from '@/services/fontService';
import { isTauri, saveBlobToDisk, saveBlobToPath, saveDataUrlToDisk, saveDataUrlToPath, pickExportDirectory, openExternal } from '@/lib/desktop';
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
import { Logo } from './Logo';
import type { ArtboardState, ElementType, Point, ShapeType, DeviceType, ArtboardElement, TextElementProps, ShapeElementProps, DeviceFrameElementProps, ImageElementProps, Project, Size } from '@/types/artboard';
import { ExportDialog, type ExportSelection, type VideoExportRequest, type VideoExportProgress } from './ExportDialog';
import { AppPreviewExportDialog } from './AppPreviewExportDialog';
import { ALL_CANVAS_SIZE_PRESETS } from '@/lib/sizePresets';
import { startDesktopMcpBridge, getMcpStatus, listenMcpStatus, type McpDesignApi } from '@/lib/mcp/desktopMcpServer';
import { McpServerStatus } from './McpServerStatus';
import { loadProjectTemplates } from '@/services/projectService';
import { TEMPLATE_CATEGORIES } from '@/lib/templateCategories';
import { convertArtboardsToFormat, detectArtboardsFormat, swapDeviceInElements, DEVICE_FORMAT_PRESETS, type DeviceFormatPreset } from '@/lib/deviceRegistry';

import { AgentPromoBanner } from './start/AgentPromoBanner';
import { BlankCanvasCard } from './start/BlankCanvasCard';
import { AgentStartScreen } from './start/AgentStartScreen';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ChevronLeftIcon, InfoIcon, PanelRightCloseIcon, PanelRightOpenIcon, SearchIcon, ZoomInIcon, ZoomOutIcon } from 'lucide-react';
import { LayersPanel } from './LayersPanel';
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

export function ArtboardStudioLayout() {
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
  const { clipboardItem, copyToClipboard } = useClipboard();
  const router = useRouter();
  const searchParams = useSearchParams();
  
  // Load available projects from data/projects folder
  useEffect(() => {
    const loadAvailableProjects = async () => {
      setIsLoadingProjects(true);
      try {
        const projects = await loadProjectTemplates();
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
        }
      } else {
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
        title: "Project Deleted", 
        description: "The project has been removed from your recent projects."
      });
      // Update the recentProjects list
      const updatedProjects = await db.projects.orderBy("timestamp").reverse().toArray();
      setRecentProjects(updatedProjects);
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
        setSelectedElementIdOnActiveArtboard(null);
    }
    if (activeArtboardId && selectedElementIdOnActiveArtboard) {
        const currentAb = repositionedArtboards.find(ab => ab.id === activeArtboardId);
        if (currentAb && !currentAb.elements.find(el => el.id === selectedElementIdOnActiveArtboard)) {
            setSelectedElementIdOnActiveArtboard(null);
        }
    }
    saveProject(); // Call the async save function
    pushToHistory(repositionedArtboards);
  }, [activeArtboardId, selectedElementIdOnActiveArtboard, activeProjectId, currentProjectName, history, historyIndex, setActiveProjectId]);

  useEffect(() => {
    if (activeArtboardId && selectedElementIdOnActiveArtboard) {
      const activeAb = artboards.find(ab => ab.id === activeArtboardId);
      if (activeAb) {
        const element = activeAb.elements.find(el => el.id === selectedElementIdOnActiveArtboard);
        setSelectedElementDetails(element || null);
      } else {
        setSelectedElementDetails(null);
      }
    } else {
      setSelectedElementDetails(null);
    }
  }, [activeArtboardId, selectedElementIdOnActiveArtboard, artboards]);

  const handleUpdateSelectedElement = (updates: Partial<ArtboardElement>) => {
    if (!activeArtboardId || !selectedElementIdOnActiveArtboard) return;

    const updatedArtboards = artboards.map(ab => {
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
    handleArtboardsUpdate(updatedArtboards);
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
    handleArtboardsUpdate(converted);
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
      toast({ title: "Element Renamed", description: `Element renamed to "${newName}".` });
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
    setSelectedElementIdOnActiveArtboard(null);
    toast({ title: "Artboard Created", description: `Artboard "${newArtboard.name}" added.` });
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
    setSelectedElementIdOnActiveArtboard(null);
    toast({ title: "Artboard Added", description: `New artboard added after "${artboards[currentIndex]?.name || 'selected'}".` });
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
    handleArtboardsUpdate(newArtboardsArray);

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
  
    handleArtboardsUpdate(newArtboardsArray); 
    toast({ title: "Artboard Moved", description: `Artboard "${targetArtboard.name}" moved ${direction}.` });
  };


  // `nameOverride` lets the AI agent name the project itself; the gallery and
  // "Start Blank" paths keep the historic "<template> Copy" naming.
  const handleSelectTemplate = async (template: Project, options?: { nameOverride?: string }) => {
    const projectName = options?.nameOverride?.trim() || `${template.name} Copy`;
    try {
      // Validate that template has project data
      if (!template.projectData || !Array.isArray(template.projectData) || template.projectData.length === 0) {
        toast({ 
          title: "Invalid Template", 
          description: "The selected template does not contain valid project data.", 
          variant: "destructive" 
        });
        return;
      }

      // Generate a new unique ID for the copied project
      const newProjectId = `project_${Date.now()}`;
      
      // Create a deep copy of the template's project data.
      // Normalize artboard positions so templates with arbitrary stored positions
      // still lay out side by side on first load (same layout applied on add/duplicate).
      const updatedArtboards = calculateArtboardPositions(JSON.parse(JSON.stringify(template.projectData)));

      // Save the copied project to IndexedDB
      await db.projects.put({
        id: newProjectId,
        name: projectName,
        description: `${template.description}`,
        timestamp: new Date(),
        projectData: JSON.parse(JSON.stringify(updatedArtboards)),
      });

      // Use the common loading function
      const success = await loadProjectFromData(
        updatedArtboards,
        projectName,
        newProjectId
      );

      if (success) {
        toast({ title: "Project Created", description: `Project "${projectName}" created.` });
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
      // Fetch the current project from IndexedDB
      const project = await db.projects.get(activeProjectId);
      
      if (!project) {
        toast({
          title: "Project Not Found",
          description: "Could not find the active project in the database.",
          variant: "destructive",
        });
        return;
      }

      // Export the exact project data from IndexedDB
      const projectData = {
        id: project.id,
        timestamp: project.timestamp,
        projectData: project.projectData
      };

      const jsonString = JSON.stringify(projectData, null, 2);
      const blob = new Blob([jsonString], { type: 'application/json' });
      // Desktop-safe save: native dialog in Tauri, anchor download on the web
      const savedPath = await saveBlobToDisk(blob, `artboard-project-${projectData.id}.json`);
      if (savedPath === null) return; // user cancelled the save dialog

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
  
  // Capture a list of artboards to PNG downloads by grabbing each board's
  // live DOM node (matched by artboard id). The list must be what the canvas
  // is currently rendering — for generated formats, handleConfirmExport
  // swaps the converted list in first and restores afterwards.
  const captureArtboards = async (list: ArtboardState[], exportDir?: string | null) => {
    // Array order matches canvas order (calculateArtboardPositions lays boards
    // out left-to-right by index), so the loop index is the on-canvas position.
    const orderPadWidth = Math.max(2, String(list.length).length);

    for (const [index, artboard] of list.entries()) {
      // Find the DOM element for the artboard content
      const artboardElement = document.querySelector(`[data-artboard-dom-id="${artboard.id}"]`) as HTMLElement | null;

      if (!artboardElement) {
        console.warn(`Could not find DOM element for artboard: ${artboard.name}`);
        toast({
          title: "Export Warning",
          description: `Could not find artboard '${artboard.name}' to export.`,
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
        const imageDataUrl = await toPng(artboardElement, {
          width: artboard.size.width,
          height: artboard.size.height,
          backgroundColor: artboard.backgroundColor === 'hsl(var(--card))' || !artboard.backgroundColor ? 'white' : artboard.backgroundColor,
          pixelRatio: 1, // Set to 1 to avoid doubling resolution
          cacheBust: true, // Prevent caching issues
          // Editor chrome (selection outlines, resize handles, upload buttons)
          // must never be baked into the exported image
          filter: (node) => {
            const el = node as HTMLElement;
            return !(el?.hasAttribute?.('data-export-exclude') || el?.hasAttribute?.('data-interaction-handle'));
          },
          style: {
            width: `${artboard.size.width}px`,
            height: `${artboard.size.height}px`,
          }
        });
        
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
        const filename = `${orderPrefix}_${artboard.name.replace(/\s+/g, '_')}${deviceSuffix}.png`;
        // Desktop-safe save: batch exports write into the pre-picked folder,
        // single files get a native save dialog in Tauri or an anchor
        // download on the web
        const savedPath = exportDir
          ? await saveDataUrlToPath(imageDataUrl, exportDir, filename)
          : await saveDataUrlToDisk(imageDataUrl, filename);
        if (savedPath === null) continue; // user cancelled this board's save dialog

        toast({
          title: "Artboard Exported",
          description: savedPath ? `Saved to ${savedPath}` : `"${artboard.name}" has been downloaded.`,
          variant: "default",
        });

      } catch (error) {
        console.error("Error exporting artboard:", artboard.name, error);
        toast({
          title: "Export Error",
          description: `Failed to export artboard "${artboard.name}". See console for details.`,
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
  const handleConfirmExport = async ({ asIs, generateFormats }: ExportSelection) => {
    setIsExportDialogOpen(false);

    const original = artboards;

    // Desktop batch exports pick one destination folder up front instead of
    // opening a native save dialog per file; cancelling the picker aborts
    // the whole export. Single-file exports keep the per-file save dialog.
    let exportDir: string | null | undefined;
    const totalFiles = (asIs ? original.length : 0) + generateFormats.length * original.length;
    if (isTauri() && totalFiles > 1) {
      exportDir = await pickExportDirectory('Choose a folder for the exported artboards');
      if (exportDir === null) return;
    }

    toast({
      title: "Export Process Initiated",
      description: `Generating images... This might take a moment.`,
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
        await captureArtboards(list, exportDir);
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
        title: "Export Error",
        description: "Something went wrong during export. See console for details.",
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
        title: 'Nothing to export',
        description: request.rawRecordingOnly
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

  const handleUndo = useCallback(() => {
    if (historyIndex > 0) {
      const newHistoryIndex = historyIndex - 1;
      setHistoryIndex(newHistoryIndex);
      const prevState = JSON.parse(JSON.stringify(history[newHistoryIndex]));
      setArtboards(prevState); 
       if (activeArtboardId && !prevState.find((ab: ArtboardState) => ab.id === activeArtboardId)) {
        setActiveArtboardId(prevState.length > 0 ? prevState[0].id : null);
      }
      setSelectedElementIdOnActiveArtboard(null);
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
      setSelectedElementIdOnActiveArtboard(null);
    }
  }, [historyIndex, history, activeArtboardId, history.length]);

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

  // Update the handleUpdateArtboardSize function
  const handleUpdateArtboardSize = (width: number, height: number) => {
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
      }
    }));
    
    // Recalculate positions to avoid overlap
    const repositionedArtboards = calculateArtboardPositions(updatedArtboards);
    
    // Update state
    setArtboards(repositionedArtboards);
    pushToHistory(repositionedArtboards);
    
    toast({ 
      title: "Artboard Size Updated", 
      description: `All artboards resized to ${width} × ${height} pixels`
    });
  };

  // Preload Google Fonts on component mount
  useEffect(() => {
    preloadGoogleFonts();
  }, []);
  
  const activeArtboard = artboards.find(ab => ab.id === activeArtboardId);
  const activeArtboardElements = activeArtboard ? activeArtboard.elements : [];
  const activeArtboardName = activeArtboard ? activeArtboard.name : undefined;


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

      handleArtboardsUpdate(updatedArtboards);
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
        setSelectedElementIdOnActiveArtboard(elementId);
      }
      setContextMenu({ x: e.clientX, y: e.clientY, elementId, artboardId, pastePoint });
    };

    document.addEventListener('contextmenu', handleContextMenu);
    return () => document.removeEventListener('contextmenu', handleContextMenu);
  }, [isPreviewOpen]);
  
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
      setSelectedElementIdOnActiveArtboard(null);
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
        const importedData = JSON.parse(fileContent);

        // Validate the imported data structure
        if (!importedData.id || !importedData.timestamp || !importedData.projectData) {
          toast({
            title: "Invalid File Format",
            description: "The selected file does not appear to be a valid Open Screenshot Generator project.",
            variant: "destructive",
          });
          return;
        }

        // Validate that projectData is an array
        if (!Array.isArray(importedData.projectData)) {
          toast({
            title: "Invalid Project Data",
            description: "The project data format is not valid.",
            variant: "destructive",
          });
          return;
        }

        // Generate a new unique ID for the imported project
        const newProjectId = `imported_${Date.now()}`;
        
        // Save the imported project to IndexedDB with a new ID
        await db.projects.put({
          id: newProjectId,
          name: `Imported ${importedData.id}`,
          timestamp: new Date(), // Use current timestamp for when it was imported
          projectData: JSON.parse(JSON.stringify(importedData.projectData)), // Deep copy
        });

        // Use the common loading function
        const success = await loadProjectFromData(
          importedData.projectData,
          `Imported ${importedData.id}`,
          newProjectId
        );

        if (success) {
          toast({
            title: "Project Imported",
            description: `Project "${importedData.id}" has been imported successfully.`,
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
          description: "There was an error reading or parsing the JSON file.",
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
                <h3 className="text-lg font-semibold mb-2">Recent projects</h3>
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
                            <div className="truncate text-xs text-muted-foreground">Saved on: {project.timestamp.toLocaleString()}</div>
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
                            title={project.id === activeProjectId ? "Cannot delete the currently open project" : "Delete project"}
                          >
                            <Trash2Icon className="h-4 w-4" />
                          </Button>
                        </li>
                      ))}
                    </ul>
                  </ScrollArea>
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
      if (selectedElementIdOnActiveArtboard === elementId) setSelectedElementIdOnActiveArtboard(null);
      return true;
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
    exportPng: async ({ artboardId }) => {
      const boardId = resolveBoardId(artboardId);
      const board = artboards.find((ab) => ab.id === boardId);
      if (!board) throw new Error('No such artboard.');
      const el = document.querySelector(`[data-artboard-dom-id="${boardId}"]`) as HTMLElement | null;
      if (!el) throw new Error('That artboard is not on screen; open the project in the app first.');
      // Same capture recipe as the Export dialog: unscale, exclude editor chrome,
      // render at the artboard's real pixel size, then restore the styles.
      const original = { transform: el.style.transform, width: el.style.width, height: el.style.height };
      el.style.transform = 'scale(1)';
      try {
        const dataUrl = await toPng(el, {
          width: board.size.width,
          height: board.size.height,
          backgroundColor: board.backgroundColor === 'hsl(var(--card))' || !board.backgroundColor ? 'white' : board.backgroundColor,
          pixelRatio: 1,
          cacheBust: true,
          filter: (node) => {
            const n = node as HTMLElement;
            return !(n?.hasAttribute?.('data-export-exclude') || n?.hasAttribute?.('data-interaction-handle'));
          },
          style: { width: `${board.size.width}px`, height: `${board.size.height}px` },
        });
        return { dataUrl, width: board.size.width, height: board.size.height };
      } finally {
        el.style.transform = original.transform;
        el.style.width = original.width;
        el.style.height = original.height;
      }
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
            <ElementPalette
              onAddElement={(type, subType, styleProps) => {
                if (activeArtboardId) {
                  handleAddElementToArtboard(activeArtboardId, type, subType, undefined, styleProps);
                } else {
                  toast({ title: "No Artboard Active", description: "Please select or create an artboard first.", variant: "destructive" });
                }
              }}
            />
          </SidebarContent>
          <SidebarFooter className="group-data-[collapsible=icon]:justify-center">
             <SidebarGroup className="p-0">
              <SidebarMenu>
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

        <SidebarInset className="flex flex-col overflow-hidden">
          <Toolbar
            onNewArtboard={handleNewArtboardFromMainToolbar}
            onSelectTemplate={() => setIsTemplateSelectorOpen(true)}
            onPreview={() => setIsPreviewOpen(true)}
            onExport={() => setIsExportDialogOpen(true)}
            onExportJSON={handleExportProjectAsJSON}
            onImportJSON={handleImportProjectFromJSON}
            canUndo={historyIndex > 0}
            canRedo={historyIndex < history.length - 1}
            onUndo={handleUndo}
            onRedo={handleRedo}
            onDeleteSelected={handleDeleteSelected}
            isElementSelected={!!selectedElementIdOnActiveArtboard}
            isArtboardSelected={!!activeArtboardId}
            activeTool={activeTool}
            onSetActiveTool={setActiveTool}
            onUpdateArtboardSize={handleUpdateArtboardSize}
            initialArtboardSize={getCurrentArtboardSize()}
            currentProjectName={currentProjectName}
            onRenameProject={handleRenameProject}
            onSelectDeviceFormat={handleSelectDeviceFormat}
            activeDeviceFormat={activeDeviceFormat}
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
                selectedElementIdOnActiveArtboard={selectedElementIdOnActiveArtboard}
                setSelectedElementIdOnActiveArtboard={handleElementSelectionOnArtboard}
                canvasZoom={canvasZoom}
                artboardRefs={artboardRefs}
                onAddNewArtboardFromToolbar={handleAddNewArtboardAfter}
                onDuplicateArtboardFromToolbar={handleDuplicateArtboard}
                onDeleteArtboardFromToolbar={handleDeleteArtboard}
                onMoveArtboardFromToolbar={handleMoveArtboard}
                activeTool={activeTool}
              />

              {/* Floating zoom control (bottom-left of canvas) */}
              <div className="absolute bottom-4 left-4 z-40 flex items-center gap-1 rounded-full border border-border bg-card/95 px-2 py-1 shadow-lg backdrop-blur">
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

              {/* MCP server status (desktop only; renders nothing on the web) */}
              <McpServerStatus className="absolute bottom-4 right-4 z-40" />

              {contextMenu && (
                <CanvasContextMenu
                  x={contextMenu.x}
                  y={contextMenu.y}
                  canCopy={!!contextMenu.elementId && !!contextMenu.artboardId}
                  canPaste={!!clipboardItem && !!(contextMenu.artboardId || activeArtboardId)}
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
                  <span className="text-sm font-semibold">Properties</span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={() => setRightDockOpen(false)}
                    title="Collapse right panel"
                    aria-label="Collapse right panel"
                  >
                    <PanelRightCloseIcon className="h-4 w-4" />
                  </Button>
                </div>
                <div ref={dockContentRef} className="flex min-h-0 flex-1 flex-col">
                  <div className="min-h-[10rem] flex-1 overflow-hidden">
                    <PropertiesPanel
                      selectedElement={selectedElementDetails}
                      onUpdateElement={handleUpdateSelectedElement}
                      activeArtboardDetails={
                        activeArtboardId && !selectedElementIdOnActiveArtboard ? activeArtboard : null
                      }
                      onUpdateArtboardDetails={handleUpdateArtboardDetails}
                      className="h-full border-l-0 shadow-none"
                    />
                  </div>
                  <div
                    role="separator"
                    aria-orientation="horizontal"
                    title="Drag to resize"
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
                      selectedElementId={selectedElementIdOnActiveArtboard}
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
                  title="Expand right panel"
                  aria-label="Expand right panel"
                >
                  <PanelRightOpenIcon className="h-4 w-4" />
                </Button>
                <div className="mt-1 h-px w-5 bg-border" />
                {(['Properties', 'Layers'] as const).map((label) => (
                  <button
                    key={label}
                    type="button"
                    className="rounded px-0.5 py-2 text-[11px] font-medium tracking-wide text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                    style={{ writingMode: 'vertical-rl' }}
                    onClick={() => setRightDockOpen(true)}
                    title={`Open ${label}`}
                  >
                    {label}
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
            />
          )}

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
                  drop your screenshots into device frames, and export PNGs sized for Google Play
                  and the Apple App Store.
                </p>
                <p>Projects are saved locally in your browser. Nothing is uploaded anywhere.</p>
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

