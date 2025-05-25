
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
    <TooltipProvider delayDuration={200}>
      <div className={cn("h-14 bg-card border-b shadow-sm flex items-center px-4 space-x-2", className)}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" onClick={onNewArtboard}>
              <PlusSquareIcon className="w-5 h-5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>New Artboard</p>
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" onClick={onSelectTemplate}>
              <LayoutTemplateIcon className="w-5 h-5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>Select Template</p>
          </TooltipContent>
        </Tooltip>

        <Separator orientation="vertical" className="h-6" />

        <Tooltip>
          <TooltipTrigger asChild>
            <Button 
              variant={activeTool === 'select' ? 'secondary' : 'ghost'} 
              size="icon" 
              onClick={() => onSetActiveTool('select')}
            > 
              <MousePointerIcon className="w-5 h-5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>Select Tool (V)</p>
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button 
              variant={activeTool === 'pan' ? 'secondary' : 'ghost'} 
              size="icon" 
              onClick={() => onSetActiveTool('pan')}
            >
              <HandIcon className="w-5 h-5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>Pan Tool (H)</p>
          </TooltipContent>
        </Tooltip>
        
        <Separator orientation="vertical" className="h-6" />

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" onClick={onUndo} disabled={!canUndo}>
              <UndoIcon className="w-5 h-5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>Undo (Ctrl+Z)</p>
          </TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" onClick={onRedo} disabled={!canRedo}>
              <RedoIcon className="w-5 h-5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>Redo (Ctrl+Y)</p>
          </TooltipContent>
        </Tooltip>

        {(isElementSelected || isArtboardSelected) && onDeleteSelected && (
          <>
            <Separator orientation="vertical" className="h-6" />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" onClick={onDeleteSelected} className="text-destructive hover:text-destructive-foreground hover:bg-destructive/90">
                  <Trash2Icon className="w-5 h-5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                <p>Delete Selected (Del/Backspace)</p>
              </TooltipContent>
            </Tooltip>
          </>
        )}


        <div className="flex-grow" /> {/* Spacer */}

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" onClick={onZoomOut}>
              <ZoomOutIcon className="w-5 h-5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>Zoom Out (-)</p>
          </TooltipContent>
        </Tooltip>
        
        <Button variant="ghost" className="w-20 tabular-nums" onClick={() => {/* TODO: reset zoom potentially */}}>
          {Math.round(currentZoom * 100)}%
        </Button>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" onClick={onZoomIn}>
              <ZoomInIcon className="w-5 h-5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>Zoom In (+)</p>
          </TooltipContent>
        </Tooltip>

        <Separator orientation="vertical" className="h-6" />

        <Tooltip>
          <TooltipTrigger asChild>
            <Button onClick={onExport} className="bg-primary hover:bg-primary/90 text-primary-foreground">
              <DownloadIcon className="w-4 h-4 mr-2" />
              Export
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            <p>Export Artboard(s)</p>
          </TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}

