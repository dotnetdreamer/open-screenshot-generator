"use client";
import React, { useState, useEffect, useCallback, useRef } from 'react';
import html2canvas from 'html2canvas'; // Import html2canvas
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
import type { ArtboardState, ElementType, Point, ShapeType, DeviceType, Template, ArtboardElement, DeviceFrameElementProps, TargetStore, ExportDeviceCategory } from '@/types/artboard';
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
import { ExportDialog } from './ExportDialog'; 

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
      size: { width: 1280, height: 800 },
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
      size: { width: 1080, height: 1080 },
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
        size: { width: 390, height: 844 },
        backgroundColor: 'hsl(var(--card))',
        zoom:1,
        position: {x:50, y:50},
        elements: [{id:'dev1', type: 'device', deviceType: 'iphone', position:{x:0,y:0}, size: {width: 390, height: 844}, rotation:0, scale:1 } as DeviceFrameElementProps]
      },
      {
        id: 'artboard_app_2',
        name: 'iPhone Screen 2',
        size: { width: 390, height: 844 },
        backgroundColor: 'hsl(var(--card))',
        zoom:1,
        position: {x:490, y:50},
        elements: [{id:'dev2', type: 'device', deviceType: 'iphone', position:{x:0,y:0}, size: {width: 390, height: 844}, rotation:0, scale:1} as DeviceFrameElementProps]
      },
    ],
  }
];

const ARTBOARD_MARGIN = 15;

function calculateArtboardPositions(artboards: ArtboardState[]): ArtboardState[] {
  let currentX = ARTBOARD_MARGIN;
  return artboards.map(ab => {
    const newPosition = { x: currentX, y: ARTBOARD_MARGIN };
    currentX += (ab.size.width * ab.zoom) + ARTBOARD_MARGIN;
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
  
  const [isExportDialogOpen, setIsExportDialogOpen] = useState(false);
  // exportConfig state is not strictly needed if not used beyond the dialog confirmation
  // const [exportConfig, setExportConfig] = useState<{ store: TargetStore | null; deviceTypes: ExportDeviceCategory[] }>({ store: null, deviceTypes: [] });


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

  useEffect(() => {
    if (artboards.length === 0 && !isTemplateSelectorOpen && sampleTemplates.length > 0) {
        handleSelectTemplate(sampleTemplates.find(t => t.id === 'template_blank') || sampleTemplates[0]);
    }
  }, [isTemplateSelectorOpen, artboards.length]);


  const handleArtboardsUpdate = useCallback((updatedArtboards: ArtboardState[]) => {
    const repositionedArtboards = calculateArtboardPositions(updatedArtboards);
    setArtboards(repositionedArtboards);
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
    pushToHistory(repositionedArtboards);
  }, [activeArtboardId, selectedElementIdOnActiveArtboard, history, historyIndex]); // Added history and historyIndex to deps

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
            el.id === selectedElementIdOnActiveArtboard ? { ...el, ...updates } : el
          ),
        };
      }
      return ab;
    });
    setArtboards(updatedArtboards); 
    pushToHistory(updatedArtboards); 
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

  const handleNewArtboardFromMainToolbar = () => {
    const defaultSize = { width: 1024, height: 768 };
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
    const defaultSize = { width: 1024, height: 768 };
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
    setActiveArtboardId(finalArtboards.length > 0 ? finalArtboards[0].id : null);
    setSelectedElementIdOnActiveArtboard(null);
    setIsTemplateSelectorOpen(false);
    toast({ title: "Template Loaded", description: `Template "${template.name}" applied.` });
  };

  const handleConfirmExport = async (store: TargetStore, deviceTypes: ExportDeviceCategory[]) => {
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
        // Use html2canvas to capture the artboard
        const canvas = await html2canvas(artboardElement, {
          allowTaint: true, // Allows cross-origin images if server headers permit
          useCORS: true,    // Attempts to load cross-origin images via CORS
          scale: 2,         // Increase scale for better quality (e.g., 2x resolution)
          backgroundColor: artboard.backgroundColor === 'hsl(var(--card))' || !artboard.backgroundColor ? 'white' : artboard.backgroundColor, // Ensure background is captured, defaults to white if card color
          logging: true,    // Enable logging for debugging
          // Note: html2canvas captures the current scaled version from the DOM.
          // For true "export at original size", you'd ideally render the artboard off-screen at 100% zoom.
        });
        
        const imageDataUrl = canvas.toDataURL('image/png');
  
        // Create a link to download the image
        const link = document.createElement('a');
        link.href = imageDataUrl;
        // Create a filename (can be more sophisticated later)
        const filename = `${artboard.name.replace(/\s+/g, '_')}_${store}_${deviceTypes.join('-')}.png`;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        // No need to revoke object URL for data URLs
  
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
    setIsExportDialogOpen(false);
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
  }, [handleDeleteSelected, handleUndo, handleRedo, historyIndex, history.length]);

  const handleArtboardSelection = (artboardId: string | null) => {
    setActiveArtboardId(artboardId);
    if (artboardId !== activeArtboardId) {
        setSelectedElementIdOnActiveArtboard(null);
    }
  }

  const handleElementSelectionOnArtboard = (elementId: string | null) => {
    setSelectedElementIdOnActiveArtboard(elementId);
  }

  const handleSelectElementFromLayerPanel = (elementId: string) => {
    setSelectedElementIdOnActiveArtboard(elementId);
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


  const activeArtboard = artboards.find(ab => ab.id === activeArtboardId);
  const activeArtboardElements = activeArtboard ? activeArtboard.elements : [];
  const activeArtboardName = activeArtboard ? activeArtboard.name : undefined;


  if (isTemplateSelectorOpen) {
    return (
      <Dialog
        open={isTemplateSelectorOpen}
        onOpenChange={(newOpenState) => {
          if (!newOpenState && artboards.length === 0 && sampleTemplates.length > 0) {
             handleSelectTemplate(sampleTemplates.find(t => t.id === 'template_blank') || sampleTemplates[0]);
          }
          setIsTemplateSelectorOpen(newOpenState);
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
        </DialogContent>
      </Dialog>
    );
  }


  return (
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
          onExport={() => setIsExportDialogOpen(true)}
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
          className="sticky top-0 z-50 bg-card border-b"
        />
        <PropertiesPanel
          selectedElement={selectedElementDetails}
          onUpdateElement={handleUpdateSelectedElement}
          activeArtboardDetails={
            // Only pass activeArtboard when no element is selected and an artboard is active
            activeArtboardId && !selectedElementIdOnActiveArtboard ? activeArtboard : null
          }
          onUpdateArtboardDetails={handleUpdateArtboardDetails}
          className="sticky top-14 z-40 bg-card border-b" 
        />
        <div className="flex-grow relative overflow-hidden"> 
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
      <ExportDialog
        isOpen={isExportDialogOpen}
        onOpenChange={setIsExportDialogOpen}
        onConfirmExport={handleConfirmExport}
      />
    </SidebarProvider>
  );
}

