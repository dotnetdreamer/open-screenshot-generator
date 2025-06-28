"use client";
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { toPng } from 'html-to-image';
import { preloadGoogleFonts } from '@/services/fontService';
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
import { PropertiesPanel } from './PropertiesPanel';
import type { ArtboardState, ElementType, Point, ShapeType, DeviceType, Template, ArtboardElement, DeviceFrameElementProps, ImageElementProps, TargetStore, ExportDeviceCategory } from '@/types/artboard';
import { Button } from '@/components/ui/button';
import { SettingsIcon, InfoIcon } from 'lucide-react';
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
import Image from 'next/image';
import { ScrollArea } from '@/components/ui/scroll-area';
import { SidebarInset } from '@/components/ui/sidebar';
import { db } from '@/database'; // Import the Dexie database
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

interface Project {
  id: string;
  timestamp: Date;
  projectData: ArtboardState[]; // Assuming projectData is an array of ArtboardState
}

// Update the initial size values in the templates
const sampleTemplates: Template[] = [
  {
    id: 'template_blank',
    name: 'Blank Canvas',
    description: 'Start with a single empty artboard.',
    previewImage: 'https://placehold.co/300x200/e0e0e0/777?text=Blank',
    dataAiHint: 'blank canvas',
    artboards: [{
      id: 'artboard_blank_1',
      name: 'Blank Artboard',
      size: { width: 1290, height: 2796 }, // Updated size
      elements: [],
      backgroundColor: 'hsl(var(--card))',
      zoom: 1,
      position: {x:50, y:50},
    }],
  },
  {
    id: 'template_social_post',
    name: 'Social Media Post',
    description: 'A square artboard perfect for social media.',
    previewImage: 'https://placehold.co/300x200/5F9EA0/FFFFFF?text=Social',
    dataAiHint: 'social media interface',
    artboards: [{
      id: 'artboard_social_1',
      name: 'Social Post',
      size: { width: 1290, height: 2796 },  // Updated size
      backgroundColor: 'hsl(var(--card))',
      zoom: 1,
      position: {x:50, y:50},
      elements: [
        { id: 'txt1', type: 'text', content: 'Your Awesome Post', position: { x: 50, y: 100 }, size: { width: 980, height: 100}, fontSize: 72, color: '#333', fontFamily: 'Impact', rotation: 0, scale: 1 } as ArtboardElement,
        { id: 'shp1', type: 'shape', shapeType: 'rectangle', position: { x: 50, y: 250 }, size: { width: 980, height: 500 }, fillColor: '#D4AF37', strokeColor: '#000000', strokeWidth: 0, rotation: 0, scale: 1 } as ArtboardElement
      ],
    }],
  },
  {
    id: 'template_app_showcase',
    name: 'App Screenshot Showcase',
    description: 'Artboards for app store screenshots.',
    previewImage: 'https://placehold.co/300x200/D4AF37/333333?text=App',
    dataAiHint: 'app store mobile',
    artboards: [
      {
        id: 'artboard_app_1',
        name: 'iPhone Screen 1',
        size: { width: 1290, height: 2796 }, // Updated size
        backgroundColor: 'hsl(var(--card))',
        zoom:1,
        position: {x:50, y:50},
        elements: [{id:'dev1', type: 'device', deviceType: 'iphone', position:{x:0,y:0}, size: {width: 1290, height: 2796}, rotation:0, scale:1 } as DeviceFrameElementProps]
      },
      {
        id: 'artboard_app_2',
        name: 'iPhone Screen 2',
        size: { width: 1290, height: 2796 }, // Updated size
        backgroundColor: 'hsl(var(--card))',
        zoom:1,
        position: {x:490, y:50},
        elements: [{id:'dev2', type: 'device', deviceType: 'iphone', position:{x:0,y:0}, size: {width: 1290, height: 2796}, rotation:0, scale:1} as DeviceFrameElementProps]
      },
    ],
  }
];

// Reduce the margin between artboards
const ARTBOARD_MARGIN = 15; // Reduced from 30
const DISPLAY_SCALE_FACTOR = 0.3;

// Update the function with reduced margin
function calculateArtboardPositions(artboards: ArtboardState[]): ArtboardState[] {
  let currentX = ARTBOARD_MARGIN;
  return artboards.map(ab => {
    const newPosition = { x: currentX, y: ARTBOARD_MARGIN };
    
    // Calculate next position with reduced margin
    currentX += (ab.size.width * DISPLAY_SCALE_FACTOR) + ARTBOARD_MARGIN;
    
    return { ...ab, position: newPosition };
  });
}

export function ArtboardStudioLayout() {
  const [artboards, setArtboards] = useState<ArtboardState[]>([]);
  const [activeArtboardId, setActiveArtboardId] = useState<string | null>(null);
  const [canvasZoom, setCanvasZoom] = useState(1);
  const [history, setHistory] = useState<ArtboardState[][]>([[]]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [isTemplateSelectorOpen, setIsTemplateSelectorOpen] = useState(true);
  const { toast } = useToast();
  const artboardRefs = useRef<Record<string, any>>({});
  const [selectedElementIdOnActiveArtboard, setSelectedElementIdOnActiveArtboard] = useState<string | null>(null);
  const [selectedElementDetails, setSelectedElementDetails] = useState<ArtboardElement | null>(null);
  const [activeTool, setActiveTool] = useState<'select' | 'pan'>('select');
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [recentProjects, setRecentProjects] = useState<Project[]>([]);
  const [projectToDelete, setProjectToDelete] = useState<string | null>(null);
  const [clipboardElement, setClipboardElement] = useState<ArtboardElement | null>(null);
  const { clipboardItem, copyToClipboard } = useClipboard();
  const router = useRouter();
  const searchParams = useSearchParams();
  
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
      if (activeProjectId) {
        try {
          const project = await db.projects.get(activeProjectId);
          if (project && project.projectData) {
            setArtboards(project.projectData);
            setHistory([JSON.parse(JSON.stringify(project.projectData))]);
            setHistoryIndex(0);
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
 }, [activeProjectId, toast, setIsTemplateSelectorOpen]); // Depend on activeProjectId and necessary setters/toast
  const pushToHistory = (newArtboardsState: ArtboardState[]) => {
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push(JSON.parse(JSON.stringify(newArtboardsState))); // Deep copy
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
  };

  // Define the handleUpdateArtboardDetails function to update artboard background settings
  const handleUpdateArtboardDetails = useCallback((updates: Partial<ArtboardState>) => {
    if (!activeArtboardId) return;

    const updatedArtboards = artboards.map(ab => {
      if (ab.id === activeArtboardId) {
        return { ...ab, ...updates };
      }
      return ab;
    });
    
    setArtboards(updatedArtboards);
    pushToHistory(updatedArtboards);
  }, [activeArtboardId, artboards, pushToHistory]);

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
      }
  
      // Save to Dexie database
      db.projects.put({
        id: projectIdToSave,
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
  }, [activeArtboardId, selectedElementIdOnActiveArtboard, activeProjectId, history, historyIndex, setActiveProjectId]);

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


  const handleAddElementToArtboard = useCallback((artboardId: string, type: ElementType, subType?: ShapeType | DeviceType, dropPosition?: Point) => {
    const artboardComponent = artboardRefs.current[artboardId];
    if (artboardComponent && typeof artboardComponent.addElement === 'function') {
      const newElementId = artboardComponent.addElement(type, subType, dropPosition);
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


  const handleSelectTemplate = (template: Template) => {
    const templateArtboards: ArtboardState[] = template.artboards.map((abConfig, index) => {
       const baseElements = abConfig.elements ? JSON.parse(JSON.stringify(abConfig.elements)) : [];
       const processedElements = baseElements.map((el: ArtboardElement) => {
         if (el.type === 'device') {
           const deviceEl = el as DeviceFrameElementProps;
           if (!deviceEl.screenshotRect) { 
            if (deviceEl.deviceType === 'custom') {
              deviceEl.screenshotRect = { left: 5, top: 5, width: 90, height: 90 };
            } else {
              deviceEl.screenshotRect = { left: 0, top: 0, width: 100, height: 100 };
            }
           }
         }
         return el;
       });

      // Convert CSS variables to hex color if present
      let backgroundColor = abConfig.backgroundColor || '#FFFFFF';
      if (backgroundColor?.toLowerCase().includes('var(') || backgroundColor?.toLowerCase().includes('hsl')) {
        backgroundColor = '#FFFFFF';
      }

      return {
        id: abConfig.id || `template_artboard_${template.id}_${index}_${Date.now()}`,
        name: abConfig.name || `Artboard ${index + 1}`,
        position: {x:0, y:0}, 
        size: abConfig.size || { width: 1024, height: 768 },
        elements: processedElements,
        backgroundColor: backgroundColor,
        backgroundType: abConfig.backgroundType || 'solid',
        backgroundGradient: abConfig.backgroundGradient,
        zoom: abConfig.zoom || 1,
      } as ArtboardState
    });

    const finalArtboards = calculateArtboardPositions(templateArtboards);
    setArtboards(finalArtboards);
    setHistory([JSON.parse(JSON.stringify(finalArtboards))]); 
    setHistoryIndex(0);
    // Automatically select the first artboard
    setActiveArtboardId(finalArtboards.length > 0 ? finalArtboards[0].id : null);
    setSelectedElementIdOnActiveArtboard(null);
    setIsTemplateSelectorOpen(false);
    toast({ title: "Template Loaded", description: `Template "${template.name}" applied.` });
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
      const url = URL.createObjectURL(blob);
      
      const link = document.createElement('a');
      link.href = url;
      link.download = `artboard-project-${projectData.id}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      toast({
        title: "Project Exported",
        description: "Project has been exported as JSON file from database.",
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
  
  // Modify the export function to handle the display scale factor without doubling resolution
  const handleExportArtboards = async () => {
    toast({
      title: "Export Process Initiated",
      description: `Generating images... This might take a moment.`,
      variant: "default",
    });

    for (const artboard of artboards) {
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
          style: {
            width: `${artboard.size.width}px`,
            height: `${artboard.size.height}px`,
          }
        });
        
        // Restore original styling after export
        artboardElement.style.transform = originalTransform;
        artboardElement.style.width = originalWidth;
        artboardElement.style.height = originalHeight;

        // Create a link to download the image
        const link = document.createElement('a');
        link.href = imageDataUrl;
        // Create a simple filename
        const filename = `${artboard.name.replace(/\s+/g, '_')}.png`;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);

        toast({
          title: "Artboard Exported",
          description: `"${artboard.name}" has been downloaded.`,
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
    };

    window.addEventListener('keydown', handleKeyDown);
    
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleDeleteSelected, handleUndo, handleRedo, historyIndex, history.length, activeArtboardId, selectedElementIdOnActiveArtboard, clipboardItem]);

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


  // Define the copy element handler
  const handleCopyElement = () => {
    if (activeArtboardId && selectedElementIdOnActiveArtboard) {
      const activeAb = artboards.find(ab => ab.id === activeArtboardId);
      if (activeAb) {
        const elementToCopy = activeAb.elements.find(
          el => el.id === selectedElementIdOnActiveArtboard
        );
        
        if (elementToCopy) {
          copyToClipboard(elementToCopy);
          toast({ title: "Copied", description: `${elementToCopy.type} element copied to clipboard.` });
        }
      }
    }
  };

  // Define the paste element handler
  const handlePasteElement = () => {
    if (activeArtboardId && clipboardItem) {
      const newElement = { 
        ...JSON.parse(JSON.stringify(clipboardItem)),
        id: `el_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`, // New unique ID
        position: { 
          x: clipboardItem.position.x + 20, // Offset position slightly
          y: clipboardItem.position.y + 20 
        }
      };
      
      const updatedArtboards = artboards.map(ab => {
        if (ab.id === activeArtboardId) {
          return {
            ...ab,
            elements: [...ab.elements, newElement]
          };
        }
        return ab;
      });
      
      handleArtboardsUpdate(updatedArtboards);
      setSelectedElementIdOnActiveArtboard(newElement.id);
      toast({ title: "Pasted", description: `${newElement.type} element pasted to artboard.` });
    } else if (!activeArtboardId) {
      toast({ 
        title: "Cannot Paste", 
        description: "Please select an artboard first.", 
        variant: "destructive" 
      });
    }
  };
  
  // Add keyboard shortcuts for copy and paste
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
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
    };

    window.addEventListener('keydown', handleKeyDown);
    
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleDeleteSelected, handleUndo, handleRedo, historyIndex, history.length, activeArtboardId, selectedElementIdOnActiveArtboard, clipboardItem]);

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
            description: "The selected file does not appear to be a valid Artboard Studio project.",
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
          timestamp: new Date(), // Use current timestamp for when it was imported
          projectData: JSON.parse(JSON.stringify(importedData.projectData)), // Deep copy
        });

        // Load the imported project
        setActiveProjectId(newProjectId);
        setArtboards(importedData.projectData);
        setHistory([JSON.parse(JSON.stringify(importedData.projectData))]);
        setHistoryIndex(0);
        setIsTemplateSelectorOpen(false);

        // Update the recent projects list
        const updatedProjects = await db.projects.orderBy("timestamp").reverse().toArray();
        setRecentProjects(updatedProjects);

        // Update URL with new project ID
        if (typeof window !== "undefined") {
          const params = new URLSearchParams(window.location.search);
          params.set("projectId", newProjectId);
          window.history.replaceState({}, "", `${window.location.pathname}?${params.toString()}`);
        }

        toast({
          title: "Project Imported",
          description: `Project "${importedData.id}" has been imported successfully.`,
          variant: "default",
        });

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

  if (isTemplateSelectorOpen) {
    return (
      <>
        <Dialog
          open={isTemplateSelectorOpen}
          onOpenChange={(newOpenState) => {
            if (!newOpenState && artboards.length === 0 && sampleTemplates.length > 0) {
               handleSelectTemplate(sampleTemplates.find(t => t.id === 'template_blank') || sampleTemplates[0]);
            }
            setIsTemplateSelectorOpen(newOpenState);
            // --- 3. Remove projectId from URL when template selector is opened ---
            if (typeof window !== "undefined" && newOpenState) {
              const params = new URLSearchParams(window.location.search);
              params.delete("projectId");
              window.history.replaceState({}, "", `${window.location.pathname}${params.toString() ? "?" + params.toString() : ""}`);
            }
          }}
        >
          <DialogContent className="max-w-3xl">
            <DialogHeader>
              <DialogTitle>Start a New Project</DialogTitle>
              <DialogDescription>Choose a template or start with a blank canvas.</DialogDescription>
            </DialogHeader>
            <ScrollArea className="max-h-[70vh]">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 p-4">
                {sampleTemplates.map(template => (
                  <Card
                    key={template.id}
                    className="hover:shadow-xl transition-shadow cursor-pointer"
                    onClick={() => handleSelectTemplate(template)}
                  >
                    <CardHeader className="p-0">
                      {template.previewImage && (
                         <Image
                          src={template.previewImage}
                          alt={template.name}
                          width={300} height={200}
                          className="rounded-t-lg object-cover w-full h-40"
                          data-ai-hint={template.dataAiHint || "abstract design"}
                        />
                      )}
                    </CardHeader>
                    <CardContent className="p-4">
                      <CardTitle className="text-lg mb-1">{template.name}</CardTitle>
                      <CardDescription className="text-sm">{template.description}</CardDescription>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </ScrollArea>
             <DialogFooter>
              <Button variant="outline" onClick={() => {if (sampleTemplates.length > 0) handleSelectTemplate(sampleTemplates.find(t => t.id === 'template_blank') || sampleTemplates[0])}}>Start Blank</Button>
            </DialogFooter>

            {/* New Section for Recent Projects */}
            <div className="p-4 border-t mt-4">
              <h3 className="text-lg font-semibold mb-2">Recent projects</h3>
              {recentProjects.length > 0 ? (
                <ScrollArea className="h-[20vh]">
                  <ul className="divide-y divide-border">
                    {recentProjects.map((project) => (
                      <li key={project.id} className="py-1 flex items-center justify-between hover:bg-muted/50 rounded px-1">
                        <div 
                          className="flex-grow py-2 cursor-pointer hover:text-primary"
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
                          Project saved on: {project.timestamp.toLocaleString()}
                        </div>
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          className="h-8 w-8 text-destructive hover:bg-destructive/10 hover:text-destructive" 
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
  }

  return (
    <ClipboardProvider>
      <SidebarProvider defaultOpen>
        <Sidebar side="left" collapsible="icon" variant="sidebar" className="border-r">
          <SidebarHeader>
            <Button variant="ghost" size="icon" className="text-lg font-semibold tracking-tight h-10 w-10 flex items-center justify-center">
               <svg viewBox="0 0 100 100" className="w-6 h-6 fill-primary">
                  <rect x="10" y="10" width="50" height="30" rx="5"/>
                  <rect x="20" y="50" width="70" height="40" rx="5"/>
               </svg>
            </Button>
            <span className="text-lg font-semibold tracking-tight group-data-[collapsible=icon]:hidden">Artboard Studio</span>
          </SidebarHeader>
          <SidebarContent>
            <ElementPalette
              onAddElement={(type, subType) => {
                if (activeArtboardId) {
                  handleAddElementToArtboard(activeArtboardId, type, subType);
                } else {
                  toast({ title: "No Artboard Active", description: "Please select or create an artboard first.", variant: "destructive" });
                }
              }}
              activeArtboardElements={activeArtboardElements}
              selectedElementIdOnActiveArtboard={selectedElementIdOnActiveArtboard}
              onSelectElementInLayerPanel={handleSelectElementFromLayerPanel}
              onMoveElementLayer={handleMoveElementLayer}
              onDeleteElement={handleDeleteElementFromLayerPanel}
              onRenameElement={handleRenameElementFromLayerPanel}
              activeArtboardName={activeArtboardName}
            />
          </SidebarContent>
          <SidebarFooter className="group-data-[collapsible=icon]:justify-center">
             <SidebarGroup className="p-0">
              <SidebarMenu>
                <SidebarMenuItem>
                  <SidebarMenuButton tooltip="Settings (N/A)" className="w-full">
                    <SettingsIcon />
                    <span className="group-data-[collapsible=icon]:hidden">Settings</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
                <SidebarMenuItem>
                  <SidebarMenuButton tooltip="About (N/A)" className="w-full">
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
            onExport={handleExportArtboards}
            onExportJSON={handleExportProjectAsJSON}
            onImportJSON={handleImportProjectFromJSON}
            onZoomIn={() => setCanvasZoom(prev => Math.min(prev * 1.2, 4))}
            onZoomOut={() => setCanvasZoom(prev => Math.max(prev / 1.2, 0.1))}
            currentZoom={canvasZoom}
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
            onCopyElement={handleCopyElement}
            onPasteElement={handlePasteElement}
            canCopy={!!selectedElementIdOnActiveArtboard}
            canPaste={!!clipboardItem && !!activeArtboardId}
            className="sticky top-0 z-50 bg-card border-b"
          />
          <PropertiesPanel
            selectedElement={selectedElementDetails}
            onUpdateElement={handleUpdateSelectedElement}
            activeArtboardDetails={
              activeArtboardId && !selectedElementIdOnActiveArtboard ? activeArtboard : null
            }
            onUpdateArtboardDetails={handleUpdateArtboardDetails}
            className="sticky top-14 z-40 bg-card border-b shadow-md mb-3" // Adjusted from mb-4 to mb-3
          />
          <div className="flex-grow relative overflow-hidden pt-3"> {/* Adjusted from pt-4 to pt-3 */}
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
          </div>
        </SidebarInset>
      </SidebarProvider>
    </ClipboardProvider>
  );
}

