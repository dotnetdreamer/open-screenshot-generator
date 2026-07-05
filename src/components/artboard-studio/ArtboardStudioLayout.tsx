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
import { PreviewDialog } from './PreviewDialog';
import { Logo } from './Logo';
import type { ArtboardState, ElementType, Point, ShapeType, DeviceType, ArtboardElement, DeviceFrameElementProps, ImageElementProps, TargetStore, ExportDeviceCategory, Project } from '@/types/artboard';
import { loadProjectTemplates } from '@/services/projectService';

import { Button } from '@/components/ui/button';
import { InfoIcon } from 'lucide-react';
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
import Image from 'next/image';
import { ScrollArea } from '@/components/ui/scroll-area';
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

// Reduce the margin between artboards
const ARTBOARD_MARGIN = 15; // Reduced from 30
const DISPLAY_SCALE_FACTOR = 0.3;

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

export function ArtboardStudioLayout() {
  const [artboards, setArtboards] = useState<ArtboardState[]>([]);
  const [activeArtboardId, setActiveArtboardId] = useState<string | null>(null);
  const [canvasZoom, setCanvasZoom] = useState(1);
  const [history, setHistory] = useState<ArtboardState[][]>([[]]);
  const [historyIndex, setHistoryIndex] = useState(0);
  const [isTemplateSelectorOpen, setIsTemplateSelectorOpen] = useState(true);
  const [availableProjects, setAvailableProjects] = useState<Project[]>([]);
  const { toast } = useToast();
  const artboardRefs = useRef<Record<string, any>>({});
  const [selectedElementIdOnActiveArtboard, setSelectedElementIdOnActiveArtboard] = useState<string | null>(null);
  const [selectedElementDetails, setSelectedElementDetails] = useState<ArtboardElement | null>(null);
  const [activeTool, setActiveTool] = useState<'select' | 'pan'>('select');
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [currentProjectName, setCurrentProjectName] = useState<string>('Untitled Project');
  const [recentProjects, setRecentProjects] = useState<Project[]>([]);
  const [projectToDelete, setProjectToDelete] = useState<string | null>(null);
  const [clipboardElement, setClipboardElement] = useState<ArtboardElement | null>(null);
  const [isLoadingTemplate, setIsLoadingTemplate] = useState(false);
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [isAboutOpen, setIsAboutOpen] = useState(false);
  const { clipboardItem, copyToClipboard } = useClipboard();
  const router = useRouter();
  const searchParams = useSearchParams();
  
  // Load available projects from data/projects folder
  useEffect(() => {
    const loadAvailableProjects = async () => {
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
            setArtboards(project.projectData);
            setCurrentProjectName(project.name || 'Untitled Project');
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


  const handleSelectTemplate = async (template: Project) => {
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
        name: `${template.name} Copy`,
        description: `${template.description}`,
        timestamp: new Date(),
        projectData: JSON.parse(JSON.stringify(updatedArtboards)),
      });

      // Use the common loading function
      const success = await loadProjectFromData(
        updatedArtboards,
        `${template.name} Copy`,
        newProjectId
      );

      if (success) {
        toast({ title: "Project Created", description: `Project "${template.name} Copy" created from template.` });
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
      const finalArtboards = calculateArtboardPositions(projectData);
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

  if (isTemplateSelectorOpen) {
    return (
      <>
        <Dialog
          open={isTemplateSelectorOpen}
          onOpenChange={(newOpenState) => {
            if (!newOpenState && artboards.length === 0 && availableProjects.length > 0) {
               // Create a blank project when no template is selected
               const blankProject: Project = {
                 id: 'blank',
                 name: 'Blank Canvas',
                 description: 'Start with a blank artboard',
                 timestamp: new Date(),
                 projectData: [{
                   id: 'artboard_blank_1',
                   name: 'Blank Artboard',
                   size: { width: 1290, height: 2796 },
                   elements: [],
                   backgroundColor: '#FFFFFF',
                   zoom: 1,
                   position: {x:50, y:50},
                 } as ArtboardState]
               };
               handleSelectTemplate(blankProject);
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
                {availableProjects.map((project: Project) => (
                  <Card
                    key={project.id}
                    className="hover:shadow-xl transition-shadow cursor-pointer"
                    onClick={() => handleSelectTemplate(project)}
                  >
                    <CardHeader className="p-0">
                      {project.previewImage && (
                         <Image
                          src={project.previewImage}
                          alt={project.name}
                          width={300} height={200}
                          className="rounded-t-lg object-cover w-full h-40"
                          data-ai-hint={project.description || "project design"}
                        />
                      )}
                    </CardHeader>
                    <CardContent className="p-4">
                      <CardTitle className="text-lg mb-1">{project.name}</CardTitle>
                      <CardDescription className="text-sm">{project.description}</CardDescription>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </ScrollArea>
             <DialogFooter>
              <Button variant="outline" onClick={() => {
                const blankProject: Project = {
                  id: 'blank',
                  name: 'Blank Canvas',
                  description: 'Start with a blank artboard',
                  timestamp: new Date(),
                  projectData: [{
                    id: 'artboard_blank_1',
                    name: 'Blank Artboard',
                    size: { width: 1290, height: 2796 },
                    elements: [],
                    backgroundColor: '#FFFFFF',
                    zoom: 1,
                    position: {x:50, y:50},
                  } as ArtboardState]
                };
                handleSelectTemplate(blankProject);
              }}>Start Blank</Button>
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
                          <div className="font-medium">{project.name}</div>
                          <div className="text-xs text-muted-foreground">Saved on: {project.timestamp.toLocaleString()}</div>
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
          <SidebarHeader className="border-b">
            <div className="flex items-center gap-3 px-2 py-2.5 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
              <Logo withBackground className="h-10 w-10 shrink-0 group-data-[collapsible=icon]:h-8 group-data-[collapsible=icon]:w-8" />
              <div className="flex min-w-0 flex-col group-data-[collapsible=icon]:hidden">
                <span className="truncate text-base font-semibold leading-tight tracking-tight">Artboard Studio</span>
                <span className="truncate text-xs leading-tight text-muted-foreground">App screenshot designer</span>
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
            currentProjectName={currentProjectName}
            onRenameProject={handleRenameProject}
            className="sticky top-0 z-50 bg-card border-b"
          />
          
          {/* Main content area with flex layout */}
          <div className="flex flex-1 overflow-hidden h-full">
            {/* Canvas area - takes remaining space */}
            <div className="flex-1 relative overflow-hidden">
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
            
            {/* Properties panel - right sidebar */}
            <div className="w-80 flex-shrink-0 h-full">
              <PropertiesPanel
                selectedElement={selectedElementDetails}
                onUpdateElement={handleUpdateSelectedElement}
                activeArtboardDetails={
                  activeArtboardId && !selectedElementIdOnActiveArtboard ? activeArtboard : null
                }
                onUpdateArtboardDetails={handleUpdateArtboardDetails}
                className="h-full"
              />
            </div>
          </div>

          {isPreviewOpen && (
            <PreviewDialog
              artboards={artboards}
              initialArtboardId={activeArtboardId}
              onClose={() => setIsPreviewOpen(false)}
            />
          )}

          <Dialog open={isAboutOpen} onOpenChange={setIsAboutOpen}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <div className="flex items-center gap-3">
                  <Logo withBackground className="h-12 w-12" />
                  <div className="text-left">
                    <DialogTitle>Artboard Studio</DialogTitle>
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
                    href="https://github.com/dotnetdreamer/artboard-studio"
                    target="_blank"
                    rel="noopener noreferrer"
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

