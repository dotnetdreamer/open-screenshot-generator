
"use client";
import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  SidebarProvider,
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarTrigger,
  SidebarInset,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarGroup,
  SidebarGroupLabel,
} from "@/components/ui/sidebar";
import { ElementPalette } from './ElementPalette';
import { Toolbar } from './Toolbar';
import { CanvasArea } from './CanvasArea';
import type { ArtboardState, ElementType, Point, ShapeType, DeviceType, Template } from '@/types/artboard';
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
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import Image from 'next/image';
import { ScrollArea } from "@/components/ui/scroll-area";

// Define some sample templates
const sampleTemplates: Template[] = [
  {
    id: 'template_blank',
    name: 'Blank Canvas',
    description: 'Start with a single empty artboard.',
    previewImage: 'https://placehold.co/300x200/e0e0e0/777?text=Blank',
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
        { id: 'txt1', type: 'text', content: 'Your Awesome Post', position: { x: 50, y: 100 }, size: { width: 980, height: 100}, fontSize: 72, color: '#333', fontFamily: 'Impact', rotation: 0, scale: 1 },
        { id: 'shp1', type: 'shape', shapeType: 'rectangle', position: { x: 50, y: 250 }, size: { width: 980, height: 500 }, fillColor: '#D4AF37', strokeColor: '#000000', strokeWidth: 0, rotation: 0, scale: 1 }
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
      { id: 'artboard_app_1', name: 'iPhone Screen 1', size: { width: 390, height: 844 }, backgroundColor: 'hsl(var(--card))', zoom:1, position: {x:50, y:50}, elements: [{id:'dev1', type: 'device', deviceType: 'iphone', position:{x:0,y:0}, size: {width: 390, height: 844}, rotation:0, scale:1}] },
      { id: 'artboard_app_2', name: 'iPhone Screen 2', size: { width: 390, height: 844 }, backgroundColor: 'hsl(var(--card))', zoom:1, position: {x:490, y:50}, elements: [{id:'dev2', type: 'device', deviceType: 'iphone', position:{x:0,y:0}, size: {width: 390, height: 844}, rotation:0, scale:1}] },
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
  const artboardRefs = useRef<Record<string, any>>({}); // To call methods on Artboard component

  const pushToHistory = (newArtboardsState: ArtboardState[]) => {
    const newHistory = history.slice(0, historyIndex + 1);
    newHistory.push(JSON.parse(JSON.stringify(newArtboardsState))); // Deep copy
    setHistory(newHistory);
    setHistoryIndex(newHistory.length - 1);
  };

  useEffect(() => {
    // Load initial template (blank) or selected one
    if (artboards.length === 0 && !isTemplateSelectorOpen) {
        handleSelectTemplate(sampleTemplates[0]); // Default to blank template
    }
  }, [isTemplateSelectorOpen]);


  const handleArtboardsUpdate = useCallback((updatedArtboards: ArtboardState[]) => {
    setArtboards(updatedArtboards);
    pushToHistory(updatedArtboards);
  }, [history, historyIndex]);

  const handleAddElementToArtboard = useCallback((artboardId: string, type: ElementType, subType?: ShapeType | DeviceType, dropPosition?: Point) => {
    const artboardComponent = artboardRefs.current[artboardId];
    if (artboardComponent && typeof artboardComponent.addElement === 'function') {
      artboardComponent.addElement(type, subType, dropPosition);
      // The Artboard component itself will call onUpdateArtboard which triggers history push
    } else {
      toast({ title: "Error", description: "Could not add element to artboard.", variant: "destructive" });
    }
  }, [toast]);


  const handleNewArtboard = () => {
    const newArtboard: ArtboardState = {
      id: `artboard_${Date.now()}`,
      name: `Artboard ${artboards.length + 1}`,
      position: { x: 50 + artboards.length * 50, y: 50 + artboards.length * 50 }, // Cascade new artboards
      size: { width: 1024, height: 768 },
      elements: [],
      backgroundColor: 'hsl(var(--card))',
      zoom: 1,
    };
    const newArtboards = [...artboards, newArtboard];
    handleArtboardsUpdate(newArtboards);
    setActiveArtboardId(newArtboard.id);
    toast({ title: "Artboard Created", description: `Artboard "${newArtboard.name}" added.` });
  };

  const handleSelectTemplate = (template: Template) => {
    const newArtboardsState = template.artboards.map((abConfig, index) => ({
        id: abConfig.id || `template_artboard_${template.id}_${index}`,
        name: abConfig.name || `Artboard ${index + 1}`,
        position: abConfig.position || { x: 50 + index * ( (abConfig.size?.width || 1024) + 50), y: 50 },
        size: abConfig.size || { width: 1024, height: 768 },
        elements: abConfig.elements || [],
        backgroundColor: abConfig.backgroundColor || 'hsl(var(--card))',
        zoom: abConfig.zoom || 1,
    }));
    setArtboards(JSON.parse(JSON.stringify(newArtboardsState))); // Deep copy
    setHistory([JSON.parse(JSON.stringify(newArtboardsState))]);
    setHistoryIndex(0);
    setActiveArtboardId(newArtboardsState.length > 0 ? newArtboardsState[0].id : null);
    setIsTemplateSelectorOpen(false);
    toast({ title: "Template Loaded", description: `Template "${template.name}" applied.` });
  };

  const handleExport = () => {
    toast({ title: "Export Initiated", description: "Exporting artboard... (Not implemented)", variant: "default" });
    // Actual export logic (e.g. html2canvas) would go here
  };
  
  const handleUndo = () => {
    if (historyIndex > 0) {
      setHistoryIndex(prev => prev - 1);
      setArtboards(JSON.parse(JSON.stringify(history[historyIndex - 1]))); // Deep copy
    }
  };

  const handleRedo = () => {
    if (historyIndex < history.length - 1) {
      setHistoryIndex(prev => prev + 1);
      setArtboards(JSON.parse(JSON.stringify(history[historyIndex + 1]))); // Deep copy
    }
  };

  const handleDeleteSelectedElement = () => {
    if (activeArtboardId) {
        const artboardComponent = artboardRefs.current[activeArtboardId];
        const selectedElement = artboardComponent?.getSelectedElement?.(); // Assuming Artboard exposes this
        if(selectedElement && artboardComponent?.deleteElement) {
            artboardComponent.deleteElement(selectedElement.id);
        } else {
            // If Artboard doesn't expose getSelectedElement, we might need selectedElementId in ArtboardStudioLayout state
            // For now, this simplified approach relies on Artboard internal selection
            toast({title: "Cannot Delete", description: "No element selected or artboard not found.", variant: "destructive"});
        }
    }
  };
  
  const currentActiveArtboard = artboards.find(ab => ab.id === activeArtboardId);
  const isElementSelectedOnActiveArtboard = false; // This would require more complex state tracking

  if (isTemplateSelectorOpen) {
    return (
      <Dialog open={isTemplateSelectorOpen} onOpenChange={(open) => { if (!open && artboards.length === 0) setIsTemplateSelectorOpen(true); else setIsTemplateSelectorOpen(open);}}>
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
            <Button variant="outline" onClick={() => handleSelectTemplate(sampleTemplates[0])}>Start Blank</Button>
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
              toast({ title: "No Artboard Selected", description: "Please select or create an artboard first.", variant: "destructive" });
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
          isElementSelected={isElementSelectedOnActiveArtboard} // This needs to be properly tracked
        />
        <div className="flex-grow relative overflow-hidden">
          <CanvasArea
            artboards={artboards}
            onUpdateArtboards={handleArtboardsUpdate}
            onAddElementToArtboard={handleAddElementToArtboard}
            activeArtboardId={activeArtboardId}
            setActiveArtboardId={setActiveArtboardId}
            canvasZoom={canvasZoom}
          />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
