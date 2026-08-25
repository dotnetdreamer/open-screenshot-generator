"use client";
import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  DownloadIcon,
  ImagePlus as ImagePlusIcon,
  Shapes as ShapesIcon,
  LayoutTemplateIcon,
  FileJsonIcon,
  FolderOpenIcon,
  EyeIcon,
  ImagesIcon,
  ClapperboardIcon,
  SmartphoneIcon,
  ChevronDownIcon,
  RulerIcon,
  CloudUploadIcon,
  CloudDownloadIcon,
  // A drive rather than a cloud for bring-your-own-storage: with two clouds in
  // the same menu, one of them had to stop looking like a cloud, and the one
  // that is somebody's own Drive or gists is the one that is not ours.
  HardDriveUploadIcon,
  HardDriveDownloadIcon,
  LinkIcon,
  Loader2Icon,
  HistoryIcon,
  Share2Icon,
  StoreIcon,
  UsersIcon,
  LanguagesIcon
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
import { GithubLinkButton } from './GithubLink';
import { LanguageSwitcher } from './LanguageSwitcher';
import { SidebarTrigger } from '@/components/ui/sidebar';

interface ToolbarProps {
  onSelectTemplate: () => void;
  /**
   * Open the start dialog straight on the screenshot intake. Optional so the
   * prop can be added without touching any other caller.
   */
  onDropInScreenshots?: () => void;
  /** Open the start dialog straight on the social graphics deck. Optional too. */
  onMakeGraphics?: () => void;
  onPreview: () => void;
  /** Preview, opened straight into the store listing mockup. */
  onPreviewStore?: () => void;
  /** Preview, opened straight into the every-language proof sheet. */
  onPreviewCompare?: () => void;
  /** The project has more than one language, so comparing them means something. */
  canCompareLanguages?: boolean;
  onExport: () => void;
  /**
   * True for App Preview projects, where that first item opens the video
   * dialog rather than the screenshot one. The label has to say so: "Artboards
   * as images" is a lie on a board whose output is an MP4.
   */
  isAppPreviewProject?: boolean;
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

  // --- our own cloud (src/lib/cloud) --------------------------------------
  // Undefined when the build has no backend, which is what hides every one of
  // these rather than showing a control that answers "not available".
  /** Save the open project to Open Screenshot Generator's cloud. */
  onSaveToCloud?: () => void;
  /** Turn on a share link for the open project and copy it. */
  onCopyProjectLink?: () => void;
  /** Open the list of projects already saved to the cloud. */
  onOpenCloudProjects?: () => void;
  isSavingToCloud?: boolean;
  /** There is a community account to attribute a cloud save to. */
  isCloudSignedIn?: boolean;
  /** The open project already has a copy in the cloud, so Save reads "Update". */
  isProjectInCloud?: boolean;
  /** Invite people to edit this project live. Absent with no session server. */
  onEditTogether?: () => void;
  /** Keep this exact state in the project's version list. */
  onSaveVersion?: () => void;
  /**
   * Who is in the room, rendered by the layout.
   *
   * A slot rather than props because it is a self-contained widget with its own
   * state (see collab/CollabBar.tsx), and because it renders nothing at all
   * when nobody is collaborating, which is the usual case.
   */
  collab?: React.ReactNode;
  /** That copy has a live share link, so the copy action is a plain copy. */
  isProjectShared?: boolean;
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
  onDropInScreenshots,
  onMakeGraphics,
  onPreview,
  onPreviewStore,
  onPreviewCompare,
  canCompareLanguages = false,
  onExport,
  onPublishToStore,
  onShareToDiscover,
  onExportJSON,
  isAppPreviewProject = false,
  onImportJSON,
  onOpenFromAccount,
  onSaveToAccount,
  isAccountConnected,
  isSavingToAccount = false,
  onSaveToCloud,
  onCopyProjectLink,
  onOpenCloudProjects,
  isSavingToCloud = false,
  isCloudSignedIn = false,
  isProjectInCloud = false,
  isProjectShared = false,
  onEditTogether,
  onSaveVersion,
  collab,
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
        {/* The fast path, reachable with a project already open. Without this
            it exists only on the start screen, which somebody mid-project has
            no reason to go back to. */}
        {onDropInScreenshots && (
          <Button
            variant="outline"
            size="icon"
            onClick={onDropInScreenshots}
            title="Start from screenshots"
          >
            <ImagePlusIcon className="h-[1.2rem] w-[1.2rem]" />
          </Button>
        )}
        {/* Same argument as the button above it: a link preview or a story is
            something you want the day you ship, which is well after the start
            screen is out of reach. */}
        {onMakeGraphics && (
          <Button
            variant="outline"
            size="icon"
            onClick={onMakeGraphics}
            title="Make social graphics"
          >
            <ShapesIcon className="h-[1.2rem] w-[1.2rem]" />
          </Button>
        )}
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

      {/* Preview is a menu for the same reason Import and Export are: the store
          mockup and the language sheet are destinations of their own, and
          making people open the preview first and hunt for a toggle inside it
          hides the two views that answer "is this actually good enough". */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" className="h-8 shrink-0 gap-1" title="Preview the project">
            <EyeIcon className="h-4 w-4" />
            <ChevronDownIcon className="h-3.5 w-3.5 opacity-70" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel className="text-xs">Preview</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={onPreview}>
            <EyeIcon className="mr-2 h-4 w-4 opacity-80" />
            Full screen
          </DropdownMenuItem>
          {onPreviewStore && (
            <DropdownMenuItem onClick={onPreviewStore}>
              <StoreIcon className="mr-2 h-4 w-4 opacity-80" />
              Store listing
              <span className="ml-auto pl-4 text-xs text-muted-foreground">real size</span>
            </DropdownMenuItem>
          )}
          {onPreviewCompare && canCompareLanguages && (
            <DropdownMenuItem onClick={onPreviewCompare}>
              <LanguagesIcon className="mr-2 h-4 w-4 opacity-80" />
              Compare languages
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

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
          {onOpenCloudProjects && (
            <DropdownMenuItem onClick={onOpenCloudProjects}>
              <CloudDownloadIcon className="mr-2 h-4 w-4 opacity-80" />
              From the cloud
            </DropdownMenuItem>
          )}
          {onOpenFromAccount && (
            <DropdownMenuItem onClick={onOpenFromAccount}>
              <HardDriveDownloadIcon className="mr-2 h-4 w-4 opacity-80" />
              From your own storage
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
            {isAppPreviewProject ? (
              <ClapperboardIcon className="mr-2 h-4 w-4 opacity-80" />
            ) : (
              <ImagesIcon className="mr-2 h-4 w-4 opacity-80" />
            )}
            {isAppPreviewProject ? 'App preview video' : 'Artboards as images'}
            {isAppPreviewProject && (
              <span className="ml-auto pl-4 text-xs text-muted-foreground">.mp4</span>
            )}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={onExportJSON}>
            <FileJsonIcon className="mr-2 h-4 w-4 opacity-80" />
            Project file
            <span className="ml-auto pl-4 text-xs text-muted-foreground">.json</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Every "this project goes somewhere that is not a file" lives here:
          our cloud, storage the user owns, and a storefront. Three separate
          icon buttons was three cloud-ish glyphs for what reads as one errand,
          and splitting the two clouds across two menus made the difference
          between them look like a difference in kind rather than in who holds
          the bytes. Which one it lands in is a line of text in one list. */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            className="h-8 shrink-0 gap-1"
            title="Save this project, or upload it to a store"
          >
            {/* The spinner belongs on the trigger, not the item: the menu has
                closed by the time the save is running. */}
            {isSavingToAccount || isSavingToCloud ? (
              <Loader2Icon className="h-4 w-4 animate-spin" />
            ) : (
              <CloudUploadIcon className="h-4 w-4" />
            )}
            <ChevronDownIcon className="h-3.5 w-3.5 opacity-70" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel className="text-xs">Save this project</DropdownMenuLabel>
          <DropdownMenuSeparator />
          {/*
            Signed out these look disabled but stay selectable on purpose: a
            real `disabled` swallows the click, and the click is how we tell the
            user they need to sign in first.
          */}
          {onSaveToCloud && (
            <DropdownMenuItem
              onClick={onSaveToCloud}
              disabled={isSavingToCloud}
              className={cn(!isCloudSignedIn && 'opacity-60')}
            >
              <CloudUploadIcon className="mr-2 h-4 w-4 opacity-80" />
              {isProjectInCloud ? 'Update the cloud copy' : 'To the cloud'}
              {!isCloudSignedIn && (
                <span className="ml-auto pl-4 text-xs text-muted-foreground">sign in</span>
              )}
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            onClick={onSaveToAccount}
            disabled={isSavingToAccount}
            className={cn(!isAccountConnected && 'opacity-60')}
          >
            <HardDriveUploadIcon className="mr-2 h-4 w-4 opacity-80" />
            {/* "your own storage", not "your account": since projects can also
                be saved to our cloud, the word account no longer says which of
                the two a click lands in. */}
            To your own storage
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
          {/* Below the rule because it is not a destination: it keeps a copy
              of this state here, in this browser, so the project can be put
              back the way it was after the tab (and its undo stack) is gone. */}
          {onSaveVersion && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={onSaveVersion}>
                <HistoryIcon className="mr-2 h-4 w-4 opacity-80" />
                Keep a version of this state
              </DropdownMenuItem>
            </>
          )}

          {/* The list of projects already in the cloud is NOT repeated here.
              It lives in the account dialog, which is the one place that holds
              everything about an account, and it is reachable from Open above.
              A second door to it in a menu about saving read as a fourth
              destination. */}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Sharing stays its own button rather than joining that menu: it is the
          last thing people do after an export, and it should cost one click
          from there.

          Everything about *storing* a project is in the menu above, including
          the list of the ones already stored. This button holds only the two
          ways somebody else ends up seeing one, and they are different enough
          that a single button would be wrong half the time: a link hands one
          person the editable project, a post publishes finished images to
          strangers.

          "Get a link" still saves first when it has to. That is not a hidden
          second meaning, it is the only way a link can point at anything.

          Icon only, like everything else on this row. The titles carry the
          meaning, and the language switcher shares this space at laptop widths
          where one stray label is the difference between a clean run and a
          squashed one. */}
      {/* Who is in the room. Renders nothing outside a session. */}
      {collab}

      {(onShareToDiscover || onCopyProjectLink) && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" className="h-8 shrink-0 gap-1" title="Share this project">
              {isSavingToCloud ? (
                <Loader2Icon className="h-4 w-4 animate-spin" />
              ) : (
                <Share2Icon className="h-4 w-4" />
              )}
              <ChevronDownIcon className="h-3.5 w-3.5 opacity-70" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel className="text-xs">Share this project</DropdownMenuLabel>
            <DropdownMenuSeparator />

            {onCopyProjectLink && (
              <DropdownMenuItem
                onClick={onCopyProjectLink}
                disabled={isSavingToCloud}
                className={cn(!isCloudSignedIn && 'opacity-60')}
              >
                <LinkIcon className="mr-2 h-4 w-4 opacity-80" />
                {isProjectShared ? 'Copy the project link' : 'Get a link to share'}
                {!isCloudSignedIn && (
                  <span className="ml-auto pl-4 text-xs text-muted-foreground">sign in</span>
                )}
              </DropdownMenuItem>
            )}

            {onEditTogether && (
              <DropdownMenuItem
                onClick={onEditTogether}
                className={cn(!isCloudSignedIn && 'opacity-60')}
              >
                <UsersIcon className="mr-2 h-4 w-4 opacity-80" />
                Edit together, live
                {!isCloudSignedIn && (
                  <span className="ml-auto pl-4 text-xs text-muted-foreground">sign in</span>
                )}
              </DropdownMenuItem>
            )}

            {onShareToDiscover && (
              <DropdownMenuItem onClick={onShareToDiscover}>
                <UsersIcon className="mr-2 h-4 w-4 opacity-80" />
                Share to the community
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}

      {/* Last on the row, because it leaves the app rather than doing anything
          to the project. The About dialog has the same link, but nobody opens
          an About dialog looking for the source. */}
      <GithubLinkButton />
    </div>
  );
}

