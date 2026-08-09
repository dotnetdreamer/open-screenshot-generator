"use client";
import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { 
  DownloadIcon, 
  UndoIcon, 
  RedoIcon, 
  LayoutTemplateIcon,
  FileTextIcon,
  FolderOpenIcon,
  EyeIcon,
  SmartphoneIcon,
  ChevronDownIcon,
  RulerIcon,
  CloudUploadIcon,
  Loader2Icon,
  GlobeIcon,
  StoreIcon
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
  onSelectTemplate: () => void;
  onPreview: () => void;
  onExport: () => void;
  /** Open the direct-to-store upload dialog (App Store Connect, Google Play). */
  onPublishToStore?: () => void;
  onExportJSON: () => void;
  onImportJSON: () => void;
  /** Push the project to the user's connected storage, or prompt to connect. */
  onSaveToAccount: () => void;
  isAccountConnected: boolean;
  isSavingToAccount?: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onUpdateArtboardSize: (width: number, height: number, scaleContent: boolean) => void;
  initialArtboardSize?: Size; // New prop to get current size
  className?: string;
  onSelectDeviceFormat?: (preset: DeviceFormatPreset) => void;
  onTranslate?: () => void;
  isTranslationEnabled?: boolean;
  // Format the project's mockups are currently on (phone platform or Play
  // Store tablet); null when mixed or none.
  activeDeviceFormat?: DeviceFormat | null;
}

export function Toolbar({ 
  onSelectTemplate,
  onPreview,
  onExport,
  onPublishToStore,
  onExportJSON,
  onImportJSON,
  onSaveToAccount,
  isAccountConnected,
  isSavingToAccount = false,
  canUndo,
  canRedo, 
  onUndo, 
  onRedo,
  onUpdateArtboardSize,
  initialArtboardSize,
  className,
  onSelectDeviceFormat,
  onTranslate,
  isTranslationEnabled = true,
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

  // The project name and its rename affordance live in the floating bar at the
  // bottom left of the canvas now, next to the zoom controls: see
  // ProjectNameField.tsx, rendered from OpenScreenshotGeneratorLayout.

  return (
    <div className={cn("h-14 bg-card border-b shadow-sm flex items-center px-4 space-x-2", className)}>
      {/* Adding an artboard lives on the artboard itself ("Add New Artboard
          After" in its hover toolbar), which is also where the new board ends
          up. A project can never reach zero artboards, since deleting the last
          one is refused, so that affordance is always reachable. */}
      <div className="flex items-center space-x-2">
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

      {/* The select and pan tools live in the floating bar centered at the
          bottom of the canvas now, next to the work they act on. */}

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
      </div>
      {/* Delete deliberately has no toolbar button: the Delete/Backspace key,
          the artboard's own hover toolbar, and the Layers panel all cover it,
          and a destructive control does not need a fourth home up here. */}

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
            {/* Icon only: the current format is already shown by the checkmark
                inside the menu, and by the canvas size button next to it. The
                title keeps it readable on hover. */}
            <Button
              variant="outline"
              className="h-8"
              title={
                activeDeviceFormat
                  ? `Convert the project to another device format (currently ${deviceFormatLabel})`
                  : 'Convert the project to another device format (canvas + mockups)'
              }
            >
              <SmartphoneIcon className="mr-1.5 h-4 w-4" />
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
      </Button>

      {onTranslate && (
        <Button
          variant="outline"
          onClick={onTranslate}
          disabled={!isTranslationEnabled}
          className="h-8"
          title={isTranslationEnabled ? "Translate Text" : "Translation is disabled because API URLs are not configured"}
        >
          <GlobeIcon className="mr-1.5 h-4 w-4" />
        </Button>
      )}

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

      {/*
        Signed out this looks disabled but stays clickable on purpose: a real
        `disabled` button swallows the click, and the click is how we tell the
        user they need to connect an account first.
      */}
      <Button
        variant="outline"
        onClick={onSaveToAccount}
        disabled={isSavingToAccount}
        aria-disabled={!isAccountConnected}
        className={cn('h-8', !isAccountConnected && 'opacity-50')}
        title={
          isAccountConnected
            ? 'Save to account'
            : 'Save to account, sign in to use this'
        }
      >
        {isSavingToAccount ? (
          <Loader2Icon className="mr-1.5 h-4 w-4 animate-spin" />
        ) : (
          <CloudUploadIcon className="mr-1.5 h-4 w-4" />
        )}
      </Button>

      <Button
        variant="outline"
        onClick={onExport}
        className="h-8"
        title="Export Artboards as Images"
      >
        <DownloadIcon className="mr-1.5 h-4 w-4" />
      </Button>

      {/* Straight to the listing, no round trip through the Downloads folder.
          The only labelled button on this side of the toolbar: a storefront
          icon alone would not distinguish it from the export and account
          buttons beside it, both of which are also "send my work somewhere". */}
      {onPublishToStore && (
        <Button
          variant="outline"
          onClick={onPublishToStore}
          className="h-8"
          title="Upload screenshots to App Store Connect or Google Play"
        >
          <StoreIcon className="mr-1.5 h-4 w-4" />
          Upload to store
        </Button>
      )}
    </div>
  );
}

