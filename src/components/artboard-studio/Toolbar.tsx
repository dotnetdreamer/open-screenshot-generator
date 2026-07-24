"use client";
import React, { useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { 
  PlusIcon, 
  DownloadIcon, 
  UndoIcon, 
  RedoIcon, 
  Trash2Icon, 
  MousePointerIcon,
  HandIcon,
  LayoutTemplateIcon,
  FileTextIcon,
  FolderOpenIcon,
  EyeIcon,
  SmartphoneIcon,
  ChevronDownIcon,
  RulerIcon
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Size } from '@/types/artboard';
import { DEVICE_FORMAT_PRESETS, type DeviceFormat, type DeviceFormatPreset } from '@/lib/deviceRegistry';
import { findMatchingPreset } from '@/lib/sizePresets';
import { CanvasSizeDialog } from './CanvasSizeDialog';

interface ToolbarProps {
  onNewArtboard: () => void;
  onSelectTemplate: () => void;
  onPreview: () => void;
  onExport: () => void;
  onExportJSON: () => void;
  onImportJSON: () => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onDeleteSelected: () => void;
  isElementSelected: boolean;
  isArtboardSelected: boolean;
  activeTool: 'select' | 'pan';
  onSetActiveTool: (tool: 'select' | 'pan') => void;
  onUpdateArtboardSize: (width: number, height: number, scaleContent: boolean) => void;
  initialArtboardSize?: Size; // New prop to get current size
  className?: string;
  currentProjectName?: string;
  onRenameProject?: (newName: string) => void;
  onSelectDeviceFormat?: (preset: DeviceFormatPreset) => void;
  // Format the project's mockups are currently on (phone platform or Play
  // Store tablet); null when mixed or none.
  activeDeviceFormat?: DeviceFormat | null;
}

export function Toolbar({ 
  onNewArtboard,
  onSelectTemplate,
  onPreview,
  onExport,
  onExportJSON,
  onImportJSON,
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
  currentProjectName,
  onRenameProject,
  onSelectDeviceFormat,
  activeDeviceFormat,
}: ToolbarProps) {
  const deviceFormatLabel =
    DEVICE_FORMAT_PRESETS.find((p) => p.id === activeDeviceFormat)?.label ?? 'Devices';
  // Canvas Size dialog (replaces the old inline width/height/apply controls)
  const [isSizeDialogOpen, setIsSizeDialogOpen] = useState(false);
  const matchedSizePreset = findMatchingPreset(initialArtboardSize);
  const sizeButtonLabel = initialArtboardSize
    ? `${initialArtboardSize.width} × ${initialArtboardSize.height}`
    : 'Canvas Size';

  // State for project name editing
  const [isEditingProjectName, setIsEditingProjectName] = useState(false);
  const [editingProjectName, setEditingProjectName] = useState(currentProjectName || 'Untitled Project');
  const projectNameInputRef = useRef<HTMLInputElement>(null);

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
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              className="h-10 gap-1 px-2.5"
              disabled={!canUndo && !canRedo}
              title="History"
            >
              <UndoIcon className="h-[1.2rem] w-[1.2rem]" />
              <ChevronDownIcon className="h-3.5 w-3.5 opacity-70" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onClick={onUndo} disabled={!canUndo}>
              <UndoIcon className="mr-2 h-4 w-4" />
              Undo
              <DropdownMenuShortcut>⌘Z</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onRedo} disabled={!canRedo}>
              <RedoIcon className="mr-2 h-4 w-4" />
              Redo
              <DropdownMenuShortcut>⇧⌘Z</DropdownMenuShortcut>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Button
          variant="outline"
          size="icon"
          onClick={onDeleteSelected}
          className={cn(
            "text-destructive hover:text-destructive hover:bg-destructive/10 hover:border-destructive/40",
            (!isElementSelected && !isArtboardSelected) && "cursor-not-allowed"
          )}
          disabled={!isElementSelected && !isArtboardSelected}
          title={isElementSelected ? "Delete Element (Delete)" : isArtboardSelected ? "Delete Artboard (Delete)" : "Select something to delete"}
        >
          <Trash2Icon className="h-[1.2rem] w-[1.2rem]" />
        </Button>
      </div>

      <div className="h-8 w-px bg-muted mx-2" />
      
      {/* Canvas Size — opens the preset picker dialog. Scales + re-centers
          content by default; its checkbox can opt out to the raw resize. */}
      <Button
        variant="outline"
        className="h-9 gap-1.5 px-3"
        onClick={() => setIsSizeDialogOpen(true)}
        title={
          matchedSizePreset
            ? `Canvas size: ${sizeButtonLabel} · ${matchedSizePreset.label}`
            : `Canvas size: ${sizeButtonLabel}`
        }
      >
        <RulerIcon className="h-4 w-4 opacity-80" />
        <span className="text-sm tabular-nums">{sizeButtonLabel}</span>
        {matchedSizePreset && (
          <span className="hidden max-w-[9rem] truncate text-xs text-muted-foreground lg:inline">
            {matchedSizePreset.label}
          </span>
        )}
        <ChevronDownIcon className="h-3.5 w-3.5 opacity-70" />
      </Button>

      <CanvasSizeDialog
        isOpen={isSizeDialogOpen}
        onOpenChange={setIsSizeDialogOpen}
        currentSize={initialArtboardSize}
        onApply={onUpdateArtboardSize}
      />

      <div className="flex-grow" />

      {onSelectDeviceFormat && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              className="h-8"
              title="Convert the project to another device format (canvas + mockups)"
            >
              <SmartphoneIcon className="mr-1.5 h-4 w-4" />
              {deviceFormatLabel}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel className="text-xs">Convert project to</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {DEVICE_FORMAT_PRESETS.map((preset, i) => (
              <React.Fragment key={preset.id}>
                {preset.id === 'ipad-pro-13' && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel className="text-xs">App Store iPads</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                  </>
                )}
                {preset.id === 'tablet-7' && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel className="text-xs">Play Store tablets</DropdownMenuLabel>
                    <DropdownMenuSeparator />
                  </>
                )}
                <DropdownMenuCheckboxItem
                  checked={activeDeviceFormat === preset.id}
                  onClick={() => onSelectDeviceFormat(preset)}
                >
                  {preset.label}
                  <span className="ml-auto pl-4 text-xs text-muted-foreground">
                    {preset.artboard.width}×{preset.artboard.height}
                  </span>
                </DropdownMenuCheckboxItem>
              </React.Fragment>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

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

