"use client";
import React, { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { 
  PlusIcon, 
  DownloadIcon, 
  UndoIcon, 
  RedoIcon, 
  Trash2Icon, 
  ZoomInIcon,
  ZoomOutIcon,
  MousePointerIcon,
  HandIcon,
  LayoutTemplateIcon,
  CopyIcon,
  ClipboardPasteIcon,
  FileTextIcon,
  FolderOpenIcon,
  EyeIcon
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Size } from '@/types/artboard';
import { useClipboard } from '@/contexts/ClipboardContext';

interface ToolbarProps {
  onNewArtboard: () => void;
  onSelectTemplate: () => void;
  onPreview: () => void;
  onExport: () => void;
  onExportJSON: () => void;
  onImportJSON: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  currentZoom: number;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onDeleteSelected: () => void;
  isElementSelected: boolean;
  isArtboardSelected: boolean;
  activeTool: 'select' | 'pan';
  onSetActiveTool: (tool: 'select' | 'pan') => void;
  onUpdateArtboardSize: (width: number, height: number) => void;
  initialArtboardSize?: Size; // New prop to get current size
  className?: string;
  onCopyElement?: () => void;
  onPasteElement?: () => void;
  canCopy?: boolean;
  canPaste?: boolean;
  currentProjectName?: string;
  onRenameProject?: (newName: string) => void;
}

export function Toolbar({ 
  onNewArtboard,
  onSelectTemplate,
  onPreview,
  onExport,
  onExportJSON,
  onImportJSON,
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
  onUpdateArtboardSize,
  initialArtboardSize,
  className,
  onCopyElement,
  onPasteElement,
  canCopy = false,
  canPaste = false,
  currentProjectName,
  onRenameProject,
}: ToolbarProps) {
  const { clipboardItem } = useClipboard();
  // Initialize with the new default values
  const [width, setWidth] = useState<string>("1290");
  const [height, setHeight] = useState<string>("2796");
  
  // State for project name editing
  const [isEditingProjectName, setIsEditingProjectName] = useState(false);
  const [editingProjectName, setEditingProjectName] = useState(currentProjectName || 'Untitled Project');
  const projectNameInputRef = useRef<HTMLInputElement>(null);

  // Update input values when artboard size changes
  useEffect(() => {
    if (initialArtboardSize) {
      setWidth(initialArtboardSize.width.toString());
      setHeight(initialArtboardSize.height.toString());
    }
  }, [initialArtboardSize]);

  // Update project name when it changes
  useEffect(() => {
    setEditingProjectName(currentProjectName || 'Untitled Project');
  }, [currentProjectName]);

  // Focus input when editing starts
  useEffect(() => {
    if (isEditingProjectName && projectNameInputRef.current) {
      projectNameInputRef.current.focus();
      projectNameInputRef.current.select();
    }
  }, [isEditingProjectName]);

  const handleWidthChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/[^0-9]/g, '');
    setWidth(value);
  };

  const handleHeightChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value.replace(/[^0-9]/g, '');
    setHeight(value);
  };

  const handleApplySize = () => {
    const numWidth = parseInt(width, 10);
    const numHeight = parseInt(height, 10);

    if (numWidth >= 100 && numWidth <= 5000 && numHeight >= 100 && numHeight <= 5000) {
      onUpdateArtboardSize(numWidth, numHeight);
    } else {
      alert("Width and height must be between 100 and 5000 pixels");
    }
  };

  const handleProjectNameDoubleClick = () => {
    setIsEditingProjectName(true);
    setEditingProjectName(currentProjectName || 'Untitled Project');
  };

  const handleProjectNameSubmit = () => {
    if (editingProjectName.trim() && onRenameProject) {
      onRenameProject(editingProjectName.trim());
    }
    setIsEditingProjectName(false);
  };

  const handleProjectNameCancel = () => {
    setEditingProjectName(currentProjectName || 'Untitled Project');
    setIsEditingProjectName(false);
  };

  const handleProjectNameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleProjectNameSubmit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      handleProjectNameCancel();
    }
  };

  return (
    <div className={cn("h-14 bg-card border-b shadow-sm flex items-center px-4 space-x-2", className)}>
      {/* Project Name Section */}
      <div className="flex items-center space-x-2 mr-4">
        {isEditingProjectName ? (
          <Input
            ref={projectNameInputRef}
            value={editingProjectName}
            onChange={(e) => setEditingProjectName(e.target.value)}
            onKeyDown={handleProjectNameKeyDown}
            onBlur={handleProjectNameSubmit}
            className="h-8 w-48 text-sm font-medium"
            placeholder="Project name..."
          />
        ) : (
          <div 
            className="flex items-center space-x-1 cursor-pointer hover:bg-accent/50 rounded px-2 py-1"
            onDoubleClick={handleProjectNameDoubleClick}
            title="Double-click to rename project"
          >
            <span className="text-sm font-medium text-foreground">
              {currentProjectName || 'Untitled Project'}
            </span>
          </div>
        )}
      </div>

      <div className="h-8 w-px bg-muted mx-2" />

      <div className="flex items-center space-x-2">
        <Button
          variant="outline"
          size="icon"
          onClick={onNewArtboard}
          title="New Artboard"
        >
          <PlusIcon className="h-[1.2rem] w-[1.2rem]" />
        </Button>

        <Button
          variant="outline"
          size="icon"
          onClick={onSelectTemplate}
          title="Select Template"
        >
          <LayoutTemplateIcon className="h-[1.2rem] w-[1.2rem]" />
        </Button>

        {/* Add Copy and Paste buttons here, after Select Template */}
        <Button
          variant="outline"
          size="icon"
          onClick={onCopyElement}
          disabled={!canCopy}
          className="h-8 w-8"
          title="Copy (Ctrl+C)"
        >
          <CopyIcon className="h-4 w-4" />
        </Button>

        <Button
          variant="outline"
          size="icon"
          onClick={onPasteElement}
          disabled={!canPaste}
          className="h-8 w-8"
          title="Paste (Ctrl+V)"
        >
          <ClipboardPasteIcon className="h-4 w-4" />
        </Button>
      </div>

      <div className="h-8 w-px bg-muted mx-2" />

      <div className="flex items-center space-x-2">
        <Button
          variant={activeTool === 'select' ? 'secondary' : 'outline'}
          size="icon"
          onClick={() => onSetActiveTool('select')}
          title="Selection Tool (V)"
        >
          <MousePointerIcon className="h-[1.2rem] w-[1.2rem]" />
        </Button>

        <Button
          variant={activeTool === 'pan' ? 'secondary' : 'outline'}
          size="icon"
          onClick={() => onSetActiveTool('pan')}
          title="Pan Tool (H)"
        >
          <HandIcon className="h-[1.2rem] w-[1.2rem]" />
        </Button>
      </div>

      <div className="h-8 w-px bg-muted mx-2" />

      <div className="flex items-center space-x-2">
        <Button
          variant="outline"
          size="icon"
          onClick={onZoomOut}
          title="Zoom Out"
        >
          <ZoomOutIcon className="h-[1.2rem] w-[1.2rem]" />
        </Button>

        <div className="min-w-[60px] text-center text-xs font-mono">
          {Math.round(currentZoom * 100)}%
        </div>

        <Button
          variant="outline"
          size="icon"
          onClick={onZoomIn}
          title="Zoom In"
        >
          <ZoomInIcon className="h-[1.2rem] w-[1.2rem]" />
        </Button>
      </div>

      <div className="h-8 w-px bg-muted mx-2" />

      <div className="flex items-center space-x-2">
        <Button
          variant="outline"
          size="icon"
          onClick={onUndo}
          disabled={!canUndo}
          title="Undo (Ctrl/⌘+Z)"
          className="opacity-75 hover:opacity-100"
        >
          <UndoIcon className="h-[1.2rem] w-[1.2rem]" />
        </Button>

        <Button
          variant="outline"
          size="icon"
          onClick={onRedo}
          disabled={!canRedo}
          title="Redo (Ctrl/⌘+Y or Ctrl/⌘+Shift+Z)"
          className="opacity-75 hover:opacity-100"
        >
          <RedoIcon className="h-[1.2rem] w-[1.2rem]" />
        </Button>

        <Button
          variant="ghost"
          size="icon"
          onClick={onDeleteSelected}
          className={cn(
            "text-destructive opacity-75 hover:opacity-100 hover:bg-destructive/10",
            (!isElementSelected && !isArtboardSelected) && "opacity-40 cursor-not-allowed hover:opacity-40"
          )}
          disabled={!isElementSelected && !isArtboardSelected}
          title={isElementSelected ? "Delete Element (Delete)" : isArtboardSelected ? "Delete Artboard (Delete)" : "Select something to delete"}
        >
          <Trash2Icon className="h-[1.2rem] w-[1.2rem]" />
        </Button>
      </div>

      <div className="h-8 w-px bg-muted mx-2" />
      
      {/* Artboard Size Controls */}
      <div className="flex items-center space-x-3">
        <div className="flex flex-col">
          <Label htmlFor="artboard-width" className="text-xs mb-0.5 text-muted-foreground">Width</Label>
          <Input
            id="artboard-width"
            type="text"
            value={width}
            onChange={handleWidthChange}
            className="h-7 w-16 text-xs"
          />
        </div>
        <span className="text-muted-foreground">×</span>
        <div className="flex flex-col">
          <Label htmlFor="artboard-height" className="text-xs mb-0.5 text-muted-foreground">Height</Label>
          <Input
            id="artboard-height"
            type="text"
            value={height}
            onChange={handleHeightChange}
            className="h-7 w-16 text-xs"
          />
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleApplySize}
          className="h-7 px-2 text-xs"
        >
          Apply
        </Button>
      </div>
      
      <div className="flex-grow" />

      <Button
        variant="outline"
        onClick={onPreview}
        className="h-8"
        title="Preview final result"
      >
        <EyeIcon className="mr-1.5 h-4 w-4" />
        Preview
      </Button>

      <Button
        variant="outline"
        onClick={onImportJSON}
        className="h-8"
        title="Import Project from JSON"
      >
        <FolderOpenIcon className="mr-1.5 h-4 w-4" />
      </Button>

      <Button 
        variant="outline" 
        onClick={onExportJSON} 
        className="h-8"
        title="Export Project as JSON"
      >
        <FileTextIcon className="mr-1.5 h-4 w-4" />
      </Button>

      <Button 
        variant="outline" 
        onClick={onExport} 
        className="h-8"
        title="Export Artboards as Images"
      >
        <DownloadIcon className="mr-1.5 h-4 w-4" />
      </Button>
    </div>
  );
}

