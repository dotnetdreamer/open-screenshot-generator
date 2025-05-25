
"use client";
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  SidebarProvider,
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  // SidebarTrigger, // Not used here, but could be if we want a global toggle
  // SidebarInset, // We use SidebarInset directly
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarGroup,
  // SidebarGroupLabel, // Not used here
} from "@/components/ui/sidebar";
import { ElementPalette } from './ElementPalette';
import { Toolbar } from './Toolbar';
import { CanvasArea } from './CanvasArea';
import { PropertiesPanel } from './PropertiesPanel'; // Import the new panel
import type { ArtboardState, ElementType, Point, ShapeType, DeviceType, Template, ArtboardElement } from '@/types/artboard';
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
import { SidebarInset } from '@/components/ui/sidebar'; // Direct import for clarity

// Define some sample templates
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
      { id: 'artboard_app_1', name: 'iPhone Screen 1', size: { width: 390, height: 844 }, backgroundColor: 'hsl(var(--card))', zoom:1, position: {x:50, y:50}, elements: [{id:'dev1', type: 'device', deviceType: 'iphone', position:{x:0,y:0}, size: {width: 390, height: 844}, rotation:0, scale:1} as ArtboardElement] },
      { id: 'artboard_app_2', name: 'iPhone Screen 2', size: { width: 390, height: 844 }, backgroundColor: 'hsl(var(--card))', zoom:1, position: {x:490, y:50}, elements: [{id:'dev2', type: 'device', deviceType: 'iphone', position:{x:0,y:0}, size: {width: 390, height: 844}, rotation:0, scale:1} as ArtboardElement] },
    ],
  }
];


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


  const pushToHistory = (newArtboardsState: ArtboardState[]) => {
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push(JSON.parse(JSON.stringify(newArtboardsState))); 
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
  };

  useEffect(() => {
    if (artboards.length === 0 && !isTemplateSelectorOpen && sampleTemplates.length > 0) {
        handleSelectTemplate(sampleTemplates[0]); 
    }
  }, [isTemplateSelectorOpen, artboards.length]);


  const handleArtboardsUpdate = useCallback((updatedArtboards: ArtboardState[]) => {
    setArtboards(updatedArtboards);
    if (activeArtboardId && !updatedArtboards.find(ab => ab.id === activeArtboardId)) {
        setActiveArtboardId(null);
        setSelectedElementIdOnActiveArtboard(null);
    }
    if (activeArtboardId && selectedElementIdOnActiveArtboard) {
        const currentAb = updatedArtboards.find(ab => ab.id === activeArtboardId);
        if (currentAb && !currentAb.elements.find(el => el.id === selectedElementIdOnActiveArtboard)) {
            setSelectedElementIdOnActiveArtboard(null);
        }
    }
    pushToHistory(updatedArtboards);
  }, [activeArtboardId, selectedElementIdOnActiveArtboard]); // Removed history and historyIndex as they cause infinite loops here

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
    // Note: handleArtboardsUpdate internally calls pushToHistory
    handleArtboardsUpdate(updatedArtboards);
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


  const handleNewArtboard = () => {
    const artboardMargin = 50;
    let newPosition: Point;

    if (artboards.length > 0) {
      const lastArtboard = artboards[artboards.length - 1];
      const lastArtboardActualWidth = (lastArtboard.size.width * lastArtboard.zoom);
      newPosition = {
        x: lastArtboard.position.x + lastArtboardActualWidth + artboardMargin,
        y: lastArtboard.position.y, 
      };
    } else {
      newPosition = { x: artboardMargin, y: artboardMargin };
    }

    const newArtboard: ArtboardState = {
      id: `artboard_${Date.now()}`,
      name: `Artboard ${artboards.length + 1}`,
      position: newPosition,
      size: { width: 1024, height: 768 },
      elements: [],
      backgroundColor: 'hsl(var(--card))',
      zoom: 1,
    };
    const newArtboards = [...artboards, newArtboard];
    handleArtboardsUpdate(newArtboards);
    setActiveArtboardId(newArtboard.id);
    setSelectedElementIdOnActiveArtboard(null);
    toast({ title: "Artboard Created", description: `Artboard "${newArtboard.name}" added.` });
  };

  const handleSelectTemplate = (template: Template) => {
    const artboardMargin = 50;
    const processedTemplateArtboards: ArtboardState[] = [];
    let currentX = artboardMargin;

    template.artboards.forEach((abConfig, index) => {
        const artboardWidth = (abConfig.size?.width || 1024) * (abConfig.zoom || 1);
        const position: Point = abConfig.position ? abConfig.position : { x: currentX, y: artboardMargin };
        
        processedTemplateArtboards.push({
            id: abConfig.id || `template_artboard_${template.id}_${index}_${Date.now()}`,
            name: abConfig.name || `Artboard ${index + 1}`,
            position: position,
            size: abConfig.size || { width: 1024, height: 768 },
            elements: abConfig.elements ? JSON.parse(JSON.stringify(abConfig.elements)) : [],
            backgroundColor: abConfig.backgroundColor || 'hsl(var(--card))',
            zoom: abConfig.zoom || 1,
        } as ArtboardState);
        
        if (!abConfig.position) { // Only advance currentX if position wasn't predefined
            currentX += artboardWidth + artboardMargin;
        }
    });
    
    setArtboards(JSON.parse(JSON.stringify(processedTemplateArtboards))); 
    setHistory([JSON.parse(JSON.stringify(processedTemplateArtboards))]);
    setHistoryIndex(0);
    setActiveArtboardId(processedTemplateArtboards.length > 0 ? processedTemplateArtboards[0].id : null);
    setSelectedElementIdOnActiveArtboard(null);
    setIsTemplateSelectorOpen(false);
    toast({ title: "Template Loaded", description: `Template "${template.name}" applied.` });
  };

  const handleExport = () => {
    toast({ title: "Export Initiated", description: "Exporting artboard... (Not implemented)", variant: "default" });
  };
  
  const handleUndo = () => {
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
  };

  const handleRedo = () => {
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
  };

  const handleDeleteSelectedElement = () => {
    if (activeArtboardId && selectedElementIdOnActiveArtboard) {
        const artboardComponent = artboardRefs.current[activeArtboardId];
        if(artboardComponent && artboardComponent.deleteElementByIdG) {
            artboardComponent.deleteElementByIdG(selectedElementIdOnActiveArtboard);
            // Element deletion will trigger onUpdateArtboardElements in Artboard,
            // which calls handleArtboardsUpdate, then pushToHistory.
            setSelectedElementIdOnActiveArtboard(null); 
        } else {
            toast({title: "Cannot Delete", description: "Artboard or element ref not found.", variant: "destructive"});
        }
    } else if (activeArtboardId) { // No element selected, but an artboard is
             const newArtboards = artboards.filter(ab => ab.id !== activeArtboardId);
             handleArtboardsUpdate(newArtboards); 
             setActiveArtboardId(newArtboards.length > 0 ? newArtboards[0].id : null);
             setSelectedElementIdOnActiveArtboard(null);
             toast({ title: "Artboard Deleted", description: "The active artboard has been deleted." });
    } else {
            toast({title: "Cannot Delete", description: "No artboard or element selected.", variant: "destructive"});
    }
  };
  
  const handleArtboardSelection = (artboardId: string | null) => {
    setActiveArtboardId(artboardId);
    if (artboardId !== activeArtboardId) { 
        setSelectedElementIdOnActiveArtboard(null);
    }
  }

  const handleElementSelectionOnArtboard = (elementId: string | null) => {
    setSelectedElementIdOnActiveArtboard(elementId);
  }


  if (isTemplateSelectorOpen) {
    return (
      <Dialog 
        open={isTemplateSelectorOpen} 
        onOpenChange={(newOpenState) => {
          if (!newOpenState) { 
            if (artboards.length === 0 && sampleTemplates.length > 0) {
              handleSelectTemplate(sampleTemplates[0]);
            } else {
              setIsTemplateSelectorOpen(false);
            }
          } else { 
            setIsTemplateSelectorOpen(true);
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
            <Button variant="outline" onClick={() => {if (sampleTemplates.length > 0) handleSelectTemplate(sampleTemplates[0])}}>Start Blank</Button>
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
          <ElementPalette onAddElement={(type, subType) => {
            if (activeArtboardId) {
              handleAddElementToArtboard(activeArtboardId, type, subType);
            } else {
              toast({ title: "No Artboard Active", description: "Please select or create an artboard first.", variant: "destructive" });
            }
          }} />
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
          onNewArtboard={handleNewArtboard}
          onSelectTemplate={() => setIsTemplateSelectorOpen(true)}
          onExport={handleExport}
          onZoomIn={() => setCanvasZoom(prev => Math.min(prev * 1.2, 4))}
          onZoomOut={() => setCanvasZoom(prev => Math.max(prev / 1.2, 0.1))}
          currentZoom={canvasZoom}
          canUndo={historyIndex > 0}
          canRedo={historyIndex < history.length - 1}
          onUndo={handleUndo}
          onRedo={handleRedo}
          onDeleteSelected={handleDeleteSelectedElement}
          isElementSelected={!!selectedElementIdOnActiveArtboard}
          isArtboardSelected={!!activeArtboardId}
        />
        <PropertiesPanel 
            selectedElement={selectedElementDetails}
            onUpdateElement={handleUpdateSelectedElement}
        />
        <div className="flex-grow relative overflow-hidden"> {/* This div will contain the CanvasArea */}
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
          />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
