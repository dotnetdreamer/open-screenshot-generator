"use client";
import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  DownloadIcon,
  LayoutTemplateIcon,
  FileJsonIcon,
  FolderOpenIcon,
  EyeIcon,
  ImagesIcon,
  SmartphoneIcon,
  ChevronDownIcon,
  RulerIcon,
  CloudUploadIcon,
  CloudDownloadIcon,
  Loader2Icon,
  Share2Icon,
  StoreIcon
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { ArtboardState, Size } from '@/types/artboard';
import { DEVICE_FORMAT_PRESETS, type DeviceFormat, type DeviceFormatPreset } from '@/lib/deviceRegistry';
import { findMatchingPreset } from '@/lib/sizePresets';
import { CanvasSizeDialog } from './CanvasSizeDialog';
import { LanguageSwitcher } from './LanguageSwitcher';
import { SidebarTrigger } from '@/components/ui/sidebar';

interface ToolbarProps {
  onSelectTemplate: () => void;
  onPreview: () => void;
  onExport: () => void;
  /** Open the direct-to-store upload dialog (App Store Connect, Google Play). */
  onPublishToStore?: () => void;
  /** Post the open project to the community feed (Discover). */
  onShareToDiscover?: () => void;
  onExportJSON: () => void;
  onImportJSON: () => void;
  /** Open the account dialog, where the projects in storage can be opened. */
  onOpenFromAccount?: () => void;
  /** Push the project to the user's connected storage, or prompt to connect. */
  onSaveToAccount: () => void;
  isAccountConnected: boolean;
  isSavingToAccount?: boolean;
  onUpdateArtboardSize: (width: number, height: number, scaleContent: boolean) => void;
  initialArtboardSize?: Size; // New prop to get current size
  className?: string;
  onSelectDeviceFormat?: (preset: DeviceFormatPreset) => void;
  onTranslate?: () => void;
  isTranslationEnabled?: boolean;
  // Format the project's mockups are currently on (phone platform or Play
  // Store tablet); null when mixed or none.
  activeDeviceFormat?: DeviceFormat | null;

  // Locale overlay. Deliberately NOT gated on isTranslationEnabled: a project
  // localized by hand, or from a CSV a translator filled in, needs no
  // LibreTranslate at all, and hiding the switcher would hide the whole
  // feature from everyone who never configured a translation server.
  /** The BASE document, every language. The switcher reads its locale list. */
  artboards?: ArtboardState[];
  /** null means the base language is showing. */
  activeLocale?: string | null;
  onSelectLocale?: (locale: string | null) => void;
  onManageLanguages?: () => void;
  onOpenTranslations?: () => void;
  onUpdateTranslations?: () => void;
  /** A machine path exists (LibreTranslate configured, or an AI provider). */
  translationAvailable?: boolean;
}

export function Toolbar({ 
  onSelectTemplate,
  onPreview,
  onExport,
  onPublishToStore,
  onShareToDiscover,
  onExportJSON,
  onImportJSON,
  onOpenFromAccount,
  onSaveToAccount,
  isAccountConnected,
  isSavingToAccount = false,
  onUpdateArtboardSize,
  initialArtboardSize,
  className,
  onSelectDeviceFormat,
  onTranslate,
  isTranslationEnabled = true,
  activeDeviceFormat,
  artboards,
  activeLocale = null,
  onSelectLocale,
  onManageLanguages,
  onOpenTranslations,
  onUpdateTranslations,
  translationAvailable = false,
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
    // Below md the row scrolls sideways instead of squashing: every control
    // stays reachable with a swipe, which beats hiding half of them behind a
    // "more" menu on the one screen size where the toolbar is the only chrome
    // that is always visible. `shrink-0` on each item is what makes it scroll
    // rather than compress.
    <div
      className={cn(
        "h-14 bg-card border-b shadow-sm flex items-center px-4 space-x-2",
        "overflow-x-auto overflow-y-hidden lg:overflow-visible [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        className
      )}
    >
      {/* The palette is off-canvas on a phone (the sidebar turns into a sheet
          below md), so it needs a way back in. On desktop the sidebar has its
          own rail and this would be a second control for the same thing. */}
      <SidebarTrigger className="h-9 w-9 shrink-0 lg:hidden" title="Open elements palette" />

      {/* Adding an artboard lives on the artboard itself ("Add New Artboard
          After" in its hover toolbar), which is also where the new board ends
          up. A project can never reach zero artboards, since deleting the last
          one is refused, so that affordance is always reachable. */}
      <div className="flex shrink-0 items-center space-x-2">
        <Button
          variant="outline"
          size="icon"
          onClick={onSelectTemplate}
          title="Select Template"
        >
          <LayoutTemplateIcon className="h-[1.2rem] w-[1.2rem]" />
        </Button>
      </div>

      <div className="h-8 w-px shrink-0 bg-muted mx-2" />

      {/* The select and pan tools and the undo/redo pair live in the floating
          bar centered at the bottom of the canvas now, next to the work they
          act on.

          Delete deliberately has no button anywhere up here: the
          Delete/Backspace key, the artboard's own hover toolbar, and the Layers
          panel all cover it, and a destructive control does not need a fourth
          home. */}


      {/* Canvas Size — opens the preset picker dialog. Scales + re-centers
          content by default; its checkbox can opt out to the raw resize. */}
      <Button
        variant="outline"
        className="h-9 shrink-0 gap-1.5 px-3"
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

      {/* The only genuinely free horizontal space in the chrome. The language
          controls sit at its LEFT edge, beside the canvas controls they belong
          with, rather than joining the action run on the right, which is
          already several icon buttons plus a labelled one.

          No min-w-0 on purpose: the spacer must not shrink past the switcher
          and clip it. When the row runs out of room the give comes from the
          canvas-size button's truncating preset label, since every button to
          the right of here is shrink-0. */}
      {/* Translating used to be its own button here. It is inside the switcher
          now: "add a language" and "translate the text" are the same errand to
          anyone who has not yet learned that this app treats them separately. */}
      <div className="flex shrink-0 flex-grow items-center gap-2">
        {artboards && onSelectLocale && onManageLanguages && onOpenTranslations && onUpdateTranslations && (
          <LanguageSwitcher
            artboards={artboards}
            activeLocale={activeLocale}
            onSelectLocale={onSelectLocale}
            onManageLanguages={onManageLanguages}
            onOpenTranslations={onOpenTranslations}
            onUpdateTranslations={onUpdateTranslations}
            onTranslate={onTranslate}
            translateEnabled={isTranslationEnabled}
            translationAvailable={translationAvailable}
          />
        )}
      </div>

      {onSelectDeviceFormat && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            {/* Icon only: the current format is already shown by the checkmark
                inside the menu, and by the canvas size button next to it. The
                title keeps it readable on hover. */}
            <Button
              variant="outline"
              className="h-8 shrink-0"
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
        className="h-8 shrink-0"
        title="Preview final result"
      >
        <EyeIcon className="mr-1.5 h-4 w-4" />
      </Button>

      {/* Import and Export are one button each, with their sources and their
          destinations behind them. Two menus beat the three unlabelled icon
          buttons this replaced (open file, save JSON, save images): a folder, a
          page and a down arrow all read as "a file moves somewhere" and gave no
          hint which one carried the project rather than the artwork. */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" className="h-8 shrink-0 gap-1" title="Open a project">
            <FolderOpenIcon className="h-4 w-4" />
            <ChevronDownIcon className="h-3.5 w-3.5 opacity-70" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel className="text-xs">Open a project</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onImportJSON}>
            <FileJsonIcon className="mr-2 h-4 w-4 opacity-80" />
            From a project file
            <span className="ml-auto pl-4 text-xs text-muted-foreground">.json</span>
          </DropdownMenuItem>
          {onOpenFromAccount && (
            <DropdownMenuItem onClick={onOpenFromAccount}>
              <CloudDownloadIcon className="mr-2 h-4 w-4 opacity-80" />
              From your account
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" className="h-8 shrink-0 gap-1" title="Export">
            <DownloadIcon className="h-4 w-4" />
            <ChevronDownIcon className="h-3.5 w-3.5 opacity-70" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel className="text-xs">Export</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {/* Images first: it is what most sessions end with, and the JSON is
              the "keep working on this later" path rather than the output. */}
          <DropdownMenuItem onClick={onExport}>
            <ImagesIcon className="mr-2 h-4 w-4 opacity-80" />
            Artboards as images
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onExportJSON}>
            <FileJsonIcon className="mr-2 h-4 w-4 opacity-80" />
            Project file
            <span className="ml-auto pl-4 text-xs text-muted-foreground">.json</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Upload lives with Save to account for the same reason Open and Export
          are each one button: both send the project somewhere that is not a
          file, and side by side a cloud and a storefront were two icons for
          what reads as the same errand. */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            className="h-8 shrink-0 gap-1"
            title="Save to your account, or upload to a store"
          >
            {/* The spinner belongs on the trigger, not the item: the menu has
                closed by the time the save is running. */}
            {isSavingToAccount ? (
              <Loader2Icon className="h-4 w-4 animate-spin" />
            ) : (
              <CloudUploadIcon className="h-4 w-4" />
            )}
            <ChevronDownIcon className="h-3.5 w-3.5 opacity-70" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel className="text-xs">Send this project</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {/*
            Signed out this looks disabled but stays selectable on purpose: a
            real `disabled` swallows the click, and the click is how we tell the
            user they need to connect an account first.
          */}
          <DropdownMenuItem
            onClick={onSaveToAccount}
            disabled={isSavingToAccount}
            className={cn(!isAccountConnected && 'opacity-60')}
          >
            <CloudUploadIcon className="mr-2 h-4 w-4 opacity-80" />
            To your account
            {!isAccountConnected && (
              <span className="ml-auto pl-4 text-xs text-muted-foreground">sign in</span>
            )}
          </DropdownMenuItem>
          {onPublishToStore && (
            <DropdownMenuItem onClick={onPublishToStore}>
              <StoreIcon className="mr-2 h-4 w-4 opacity-80" />
              To App Store Connect or Google Play
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Sharing stays a button of its own rather than joining that menu:
          posting the set is the last thing people do after an export, and it
          should cost one click from there.

          Icon only, like everything else on this row. The title carries the
          meaning, and the language switcher shares this space at laptop widths
          where one stray label is the difference between a clean run and a
          squashed one. */}
      {onShareToDiscover && (
        <Button
          variant="outline"
          onClick={onShareToDiscover}
          className="h-8 shrink-0"
          title="Share this design to the community feed"
        >
          <Share2Icon className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}

