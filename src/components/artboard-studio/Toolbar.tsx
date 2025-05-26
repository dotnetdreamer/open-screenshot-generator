"use client";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { PlusSquareIcon, LayoutTemplateIcon, DownloadIcon, ZoomInIcon, ZoomOutIcon, HandIcon, MousePointerIcon, UndoIcon, RedoIcon, Trash2Icon } from "lucide-react";
import { cn } from "@/lib/utils";

interface ToolbarProps {
  onNewArtboard: () => void;
  onSelectTemplate: () => void;
  onExport: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  currentZoom: number;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onDeleteSelected?: () => void;
  isElementSelected?: boolean;
  isArtboardSelected?: boolean; 
  activeTool: 'select' | 'pan';
  onSetActiveTool: (tool: 'select' | 'pan') => void;
  className?: string;
}

export function Toolbar({
  onNewArtboard,
  onSelectTemplate,
  onExport,
  onZoomIn,
  onZoomOut,
  currentZoom,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onDeleteSelected,
  isElementSelected,
  isArtboardSelected,
  activeTool,
  onSetActiveTool,
  className,
}: ToolbarProps) {
  return (
    <div className={cn("w-full flex items-center gap-2 p-2 h-14", className)}>
      <Button
        variant="outline"
        size="icon"
        onClick={onNewArtboard}
        title="New Artboard"
      >
        <PlusSquareIcon className="h-4 w-4" />
      </Button>
      
      <Button
        variant="outline"
        size="icon"
        onClick={onSelectTemplate}
        title="Select Template"
      >
        <LayoutTemplateIcon className="h-4 w-4" />
      </Button>
      
      <Separator orientation="vertical" className="h-6" />

      <Button
        variant={activeTool === 'select' ? 'secondary' : 'outline'} 
        size="icon" 
        onClick={() => onSetActiveTool('select')}
        title="Select Tool (V)"
      > 
        <MousePointerIcon className="h-4 w-4" />
      </Button>
      <Button
        variant={activeTool === 'pan' ? 'secondary' : 'outline'} 
        size="icon" 
        onClick={() => onSetActiveTool('pan')}
        title="Pan Tool (H)"
      >
        <HandIcon className="h-4 w-4" />
      </Button>
      
      <Separator orientation="vertical" className="h-6" />

      <Button
        variant="outline"
        size="icon"
        onClick={onUndo}
        disabled={!canUndo}
        title="Undo (Ctrl+Z)"
      >
        <UndoIcon className="h-4 w-4" />
      </Button>
      <Button
        variant="outline"
        size="icon"
        onClick={onRedo}
        disabled={!canRedo}
        title="Redo (Ctrl+Shift+Z or Ctrl+Y)"
      >
        <RedoIcon className="h-4 w-4" />
      </Button>
      
      {(isElementSelected || isArtboardSelected) && onDeleteSelected && (
        <>
          <Separator orientation="vertical" className="h-6" />
          <Button
            variant="outline"
            size={isElementSelected || isArtboardSelected ? "default" : "icon"}
            onClick={() => {
              if (isElementSelected || isArtboardSelected) {
                console.log("Delete button clicked");
                onDeleteSelected();
              }
            }}
            title="Delete selected (Delete key)"
            disabled={!isElementSelected && !isArtboardSelected}
            className={cn(
              isElementSelected || isArtboardSelected ? "px-3" : "",
              "ml-auto" // Push to right
            )}
          >
            {(isElementSelected || isArtboardSelected) && (
              <span className="mr-2">Delete</span>
            )}
            <Trash2Icon className="h-4 w-4" />
          </Button>
        </>
      )}

      <div className="flex-grow" /> {/* Spacer */}

      <Button variant="ghost" className="w-20 tabular-nums" onClick={() => {/* TODO: reset zoom potentially */}}>
        {Math.round(currentZoom * 100)}%
      </Button>

      <Button
        variant="outline"
        size="icon"
        onClick={onZoomOut}
        title="Zoom Out (-)"
      >
        <ZoomOutIcon className="h-4 w-4" />
      </Button>
      
      <Button
        variant="outline"
        size="icon"
        onClick={onZoomIn}
        title="Zoom In (+)"
      >
        <ZoomInIcon className="h-4 w-4" />
      </Button>

      <Separator orientation="vertical" className="h-6" />

      <Button
        onClick={onExport}
        className="bg-primary hover:bg-primary/90 text-primary-foreground"
      >
        <DownloadIcon className="w-4 h-4 mr-2" />
        Export
      </Button>
    </div>
  );
}

