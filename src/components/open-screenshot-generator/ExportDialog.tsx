
"use client";
import React, { useState, useEffect, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type { ArtboardState, Size } from '@/types/artboard';
import {
  APP_STORE_FORMAT_IDS,
  DEVICE_FORMAT_PRESETS,
  type DeviceFormat,
} from '@/lib/deviceRegistry';
import { getBaseLocale, getProjectLocales, hasLocales } from '@/lib/i18n/localization';
import { localeLabel, localeName } from '@/lib/i18n/locales';
import { isTauri } from '@/lib/desktop';

export interface ExportSelection {
  // Export the artboards exactly as they are on the canvas.
  asIs: boolean;
  // App Store formats to additionally generate: each is converted in-memory
  // (store-correct canvas + matching device mockups), captured, then the
  // canvas is restored — the project itself is never modified.
  generateFormats: DeviceFormat[];
  // Narrow every selection above to the artboard the canvas has selected
  // instead of the whole project. Off unless the dialog was opened from an
  // artboard's own toolbar.
  currentArtboardOnly: boolean;
  // Languages to render, in the project's own order with the base language
  // first. Absent means "whatever the canvas is showing", which is every
  // project that has no languages, so the existing export path is unchanged.
  locales?: string[];
}

// Shared with AppPreviewExportDialog (the video projects' own dialog), which
// owns all the video UI — this screenshot dialog has none.
export type VideoSizeMode = 'appstore-portrait' | 'appstore-landscape' | 'artboard';

export interface VideoExportRequest {
  fps: number; // 30 or 60
  durationSeconds: number; // 1..30
  sizeMode: VideoSizeMode;
  rawRecordingOnly: boolean;
  // Store-safe render that keeps the explanatory overlays (text + gesture
  // hints) over the footage. Only meaningful with rawRecordingOnly.
  keepOverlays?: boolean;
  // Let a store-safe render stand in the recording mockup's poster when the
  // board carries no recording yet, so the layout can be proofed before the
  // footage exists. The result is NOT uploadable (guideline 2.3.4 wants a
  // screen capture), which is why the dialog only sets this behind a warning.
  allowPosterFallback?: boolean;
  // Render only the artboard the canvas has selected, not every video board.
  currentArtboardOnly: boolean;
}

export interface VideoExportProgress {
  boardName: string;
  boardIndex: number; // 1-based
  boardCount: number;
  frame: number;
  totalFrames: number;
}

// The artboard the canvas has selected, with its own format and size so the
// scoped export can describe exactly what it produces (a mixed project's
// selected board need not match the project-wide format).
export interface ActiveArtboardSummary {
  name: string;
  size: Size;
  format: DeviceFormat | null;
}

interface ExportDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  onConfirmExport: (selection: ExportSelection) => void;
  // Hand off to the direct-to-store upload dialog. Optional so the export
  // dialog still stands alone if publishing is ever unavailable.
  onPublishToStore?: () => void;
  // The project's detected device format (null when mixed or none) and the
  // first artboard's size — used to tell the user what "as-is" produces and
  // which App Store sizes are missing.
  currentFormat: DeviceFormat | null;
  currentSize?: Size;
  activeArtboard?: ActiveArtboardSummary | null;
  artboardCount?: number;
  // Set when the dialog is opened from an artboard's own toolbar, where
  // "export this board" is the whole intent.
  defaultCurrentArtboardOnly?: boolean;
  // The BASE document, read only for its language list (hasLocales /
  // getProjectLocales). Passing the whole array rather than a prebuilt list
  // keeps the single source of truth in the boards themselves, which is where
  // the overlay stores it.
  artboards?: ArtboardState[];
  // The language the canvas is showing, null while the base language is.
  activeLocale?: string | null;
}

// Stable identity so the language memos below do not recompute on every render
// of a project that has no languages.
const NO_ARTBOARDS: ArtboardState[] = [];

// Above this many files a web export is worth warning about: every file is its
// own anchor download (see saveDataUrlToDisk in desktop.ts), so the browser
// asks to allow multiple downloads and then drops them all in one folder
// unsorted. Desktop writes into a folder the user picks, so it says nothing.
const WEB_DOWNLOAD_WARNING_FILES = 12;

type LocaleExportMode = 'active' | 'all' | 'custom';

// Apple's screenshot-specification tiers for the sizes this app can generate
// (https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/).
const APP_STORE_TIER_NOTES: Partial<Record<DeviceFormat, string>> = {
  'ios': 'Required, iPhone 6.9-inch display',
  'ipad-pro-13': 'Required if your app runs on iPad, 13-inch display',
  'ipad-11': 'Optional, Apple scales your 13-inch shots down if missing',
};

export function ExportDialog({
  isOpen,
  onOpenChange,
  onConfirmExport,
  onPublishToStore,
  currentFormat,
  currentSize,
  activeArtboard,
  artboardCount = 0,
  defaultCurrentArtboardOnly = false,
  artboards = NO_ARTBOARDS,
  activeLocale = null,
}: ExportDialogProps) {
  const [asIs, setAsIs] = useState(true);
  const [generateFormats, setGenerateFormats] = useState<DeviceFormat[]>([]);
  const [currentArtboardOnly, setCurrentArtboardOnly] = useState(false);
  const [localeMode, setLocaleMode] = useState<LocaleExportMode>('active');
  const [customLocales, setCustomLocales] = useState<string[]>([]);
  // isTauri() reads window, so it lies during SSR and the first client render
  // and would flash the web-only download warning inside the desktop app.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const canScopeToArtboard = !!activeArtboard;
  // Everything below describes what the export produces, so it has to follow
  // the scope: a scoped run reports the selected board's own format and size.
  const scopedToArtboard = canScopeToArtboard && currentArtboardOnly;
  const effectiveFormat = scopedToArtboard ? activeArtboard!.format : currentFormat;
  const effectiveSize = scopedToArtboard ? activeArtboard!.size : currentSize;

  useEffect(() => {
    // Reset selection whenever the dialog is reopened
    if (isOpen) {
      setAsIs(true);
      setGenerateFormats([]);
      setCurrentArtboardOnly(defaultCurrentArtboardOnly);
      setLocaleMode('active');
      setCustomLocales([]);
    }
  }, [isOpen, defaultCurrentArtboardOnly]);

  // The project's languages, base first, in the order the switcher shows them
  // so the exported filenames sort the same way. Empty until a project has
  // more than one language, which hides the whole section.
  const projectLocales = useMemo(() => {
    if (!hasLocales(artboards)) return [];
    return [getBaseLocale(artboards), ...getProjectLocales(artboards).map((entry) => entry.code)];
  }, [artboards]);
  const showLocales = projectLocales.length > 1;
  // activeLocale is null while the base language is showing.
  const activeExportLocale = activeLocale ?? projectLocales[0] ?? '';

  const selectedLocales = useMemo(() => {
    if (!showLocales) return [];
    if (localeMode === 'all') return projectLocales;
    if (localeMode === 'custom') return projectLocales.filter((code) => customLocales.includes(code));
    return [activeExportLocale];
  }, [showLocales, localeMode, projectLocales, customLocales, activeExportLocale]);

  const toggleLocale = (code: string) => {
    setCustomLocales((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code]
    );
  };

  const currentPreset = useMemo(
    () => DEVICE_FORMAT_PRESETS.find((p) => p.id === effectiveFormat),
    [effectiveFormat]
  );

  // App Store formats the current canvas does NOT already produce. When the
  // project is already on one (e.g. iPhone at the exact 1290×2796 canvas),
  // the as-is export covers it and it is left out of the generate list.
  const appStorePresets = APP_STORE_FORMAT_IDS
    .map((id) => DEVICE_FORMAT_PRESETS.find((p) => p.id === id)!)
    .filter(Boolean);

  const coveredByAsIs = (formatId: DeviceFormat) => {
    if (effectiveFormat !== formatId) return false;
    const preset = DEVICE_FORMAT_PRESETS.find((p) => p.id === formatId);
    return (
      !!preset &&
      !!effectiveSize &&
      effectiveSize.width === preset.artboard.width &&
      effectiveSize.height === preset.artboard.height
    );
  };

  const toggleFormat = (formatId: DeviceFormat) => {
    setGenerateFormats((prev) =>
      prev.includes(formatId) ? prev.filter((f) => f !== formatId) : [...prev, formatId]
    );
  };

  const noLocaleSelected = showLocales && selectedLocales.length === 0;
  const nothingSelected = (!asIs && generateFormats.length === 0) || noLocaleSelected;

  // Every pass (the as-is capture plus each generated format) produces one file
  // per board in scope, and every language repeats the lot. Languages are the
  // multiplier people underestimate, so the count is spelled out below.
  const boardsInScope = scopedToArtboard ? 1 : Math.max(1, artboardCount);
  const passCount = (asIs ? 1 : 0) + generateFormats.length;
  const localeCount = showLocales ? selectedLocales.length : 1;
  const fileCount = passCount * boardsInScope * localeCount;
  const fileCountBreakdown = [
    `${boardsInScope} ${boardsInScope === 1 ? 'artboard' : 'artboards'}`,
    `${passCount} ${passCount === 1 ? 'size' : 'sizes'}`,
    localeCount > 1 ? `${localeCount} languages` : null,
  ]
    .filter(Boolean)
    .join(', ');
  // Desktop batch exports pick one folder up front; the web build has no zip
  // and no folder picker, so each file is its own browser download.
  const warnAboutWebDownloads =
    mounted && !isTauri() && fileCount > WEB_DOWNLOAD_WARNING_FILES;

  const asIsDescription = currentPreset
    ? `${currentPreset.label} layout${effectiveSize ? `, ${effectiveSize.width}×${effectiveSize.height}` : ''}`
    : effectiveSize
      ? `Current layout, ${effectiveSize.width}×${effectiveSize.height}`
      : 'Current layout';

  const scopeDescription = !canScopeToArtboard
    ? 'Select an artboard on the canvas first'
    : currentArtboardOnly
      ? `Only "${activeArtboard!.name}" is exported`
      : artboardCount > 1
        ? `Leave off to export all ${artboardCount} artboards`
        : 'This project has one artboard';

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      {/* The language section makes this dialog tall enough to run off a
          laptop screen, so it scrolls inside itself rather than clipping. */}
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Export Screenshots</DialogTitle>
          <DialogDescription>
            Download the artboards as PNGs, and optionally generate the App
            Store sizes this project is missing. Generated formats convert the
            canvas and mockups on the fly, your project stays untouched.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="flex items-start space-x-2">
            <Checkbox
              id="export-as-is"
              checked={asIs}
              onCheckedChange={(v) => setAsIs(v === true)}
            />
            <div className="grid gap-0.5 leading-none">
              <Label htmlFor="export-as-is">Export current canvas</Label>
              <p className="text-xs text-muted-foreground">{asIsDescription}</p>
            </div>
          </div>

          {/* Scope applies to every box above and below: with it on, the
              as-is capture and each generated format produce one file for the
              selected board instead of one per artboard. */}
          <div className="flex items-start space-x-2">
            <Checkbox
              id="export-current-artboard-only"
              disabled={!canScopeToArtboard}
              checked={scopedToArtboard}
              onCheckedChange={(v) => setCurrentArtboardOnly(v === true)}
            />
            <div className="grid gap-0.5 leading-none">
              <Label
                htmlFor="export-current-artboard-only"
                className={!canScopeToArtboard ? 'text-muted-foreground' : undefined}
              >
                Selected artboard only
              </Label>
              <p className="text-xs text-muted-foreground">{scopeDescription}</p>
            </div>
          </div>

          <div>
            <p className="text-sm font-medium mb-0.5">Also generate for the App Store</p>
            <p className="text-xs text-muted-foreground mb-3">
              Apple accepts 1 to 10 JPG/PNG screenshots per display size.
            </p>
            <div className="grid gap-3">
              {appStorePresets.map((preset) => {
                const covered = coveredByAsIs(preset.id);
                return (
                  <div key={preset.id} className="flex items-start space-x-2">
                    <Checkbox
                      id={`gen-${preset.id}`}
                      disabled={covered}
                      checked={!covered && generateFormats.includes(preset.id)}
                      onCheckedChange={() => toggleFormat(preset.id)}
                    />
                    <div className="grid gap-0.5 leading-none">
                      <Label
                        htmlFor={`gen-${preset.id}`}
                        className={covered ? 'text-muted-foreground' : undefined}
                      >
                        {preset.label}: {preset.artboard.width}×{preset.artboard.height}
                      </Label>
                      <p className="text-xs text-muted-foreground">
                        {covered
                          ? 'Already covered by the current canvas'
                          : APP_STORE_TIER_NOTES[preset.id]}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Only a project with languages sees this. Everything above is
              rendered once per language selected here, so it sits last, next
              to the file count it drives. */}
          {showLocales && (
            <div>
              <p className="text-sm font-medium mb-0.5">Languages</p>
              <p className="text-xs text-muted-foreground mb-3">
                Each language renders the whole selection again, with its own
                text and screenshots. Filenames start with the language code.
              </p>
              <RadioGroup
                className="grid gap-2"
                value={localeMode}
                onValueChange={(v) => {
                  const mode = v as LocaleExportMode;
                  setLocaleMode(mode);
                  // Start the custom list from what is on screen, so the mode
                  // never lands on "nothing selected".
                  if (mode === 'custom' && customLocales.length === 0) {
                    setCustomLocales([activeExportLocale]);
                  }
                }}
              >
                <div className="flex items-start space-x-2">
                  <RadioGroupItem id="export-locale-active" value="active" className="mt-0.5" />
                  <div className="grid gap-0.5 leading-none">
                    <Label htmlFor="export-locale-active">
                      {localeName(activeExportLocale)} only
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      The language the canvas is showing
                    </p>
                  </div>
                </div>
                <div className="flex items-start space-x-2">
                  <RadioGroupItem id="export-locale-all" value="all" className="mt-0.5" />
                  <div className="grid gap-0.5 leading-none">
                    <Label htmlFor="export-locale-all">
                      All {projectLocales.length} languages
                    </Label>
                    <p className="text-xs text-muted-foreground">
                      {projectLocales.map((code) => localeName(code)).join(', ')}
                    </p>
                  </div>
                </div>
                <div className="flex items-start space-x-2">
                  <RadioGroupItem id="export-locale-custom" value="custom" className="mt-0.5" />
                  <div className="grid gap-0.5 leading-none">
                    <Label htmlFor="export-locale-custom">Pick languages</Label>
                    <p className="text-xs text-muted-foreground">
                      {localeMode === 'custom' && noLocaleSelected
                        ? 'Tick at least one language'
                        : 'Export a subset, for a partial store update'}
                    </p>
                  </div>
                </div>
              </RadioGroup>

              {localeMode === 'custom' && (
                /* Native overflow rather than a ScrollArea: a Radix one under a
                   capped height silently stops scrolling. */
                <div className="mt-3 grid max-h-40 gap-2 overflow-y-auto rounded-md border p-3">
                  {projectLocales.map((code) => (
                    <div key={code} className="flex items-center space-x-2">
                      <Checkbox
                        id={`export-locale-${code}`}
                        checked={customLocales.includes(code)}
                        onCheckedChange={() => toggleLocale(code)}
                      />
                      <Label htmlFor={`export-locale-${code}`} className="font-normal">
                        {localeLabel(code)}
                      </Label>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Languages times formats times boards runs away fast, and on the
              web every file is a separate download, so the total is stated
              before the user presses Export rather than discovered after. */}
          <div className="rounded-md border bg-muted/40 px-3 py-2">
            <p className="text-sm font-medium">
              {fileCount} PNG {fileCount === 1 ? 'file' : 'files'}
            </p>
            <p className="text-xs text-muted-foreground">
              {noLocaleSelected
                ? 'Pick at least one language'
                : nothingSelected
                  ? 'Nothing selected yet'
                  : fileCountBreakdown}
            </p>
            {warnAboutWebDownloads && !nothingSelected && (
              <p className="mt-1.5 text-xs text-amber-600 dark:text-amber-500">
                In the browser each file is its own download, so your browser
                will ask to allow {fileCount} of them. The desktop app saves the
                whole run into one folder you pick.
              </p>
            )}
          </div>

        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          {onPublishToStore ? (
            <Button
              variant="link"
              className="h-auto justify-start p-0 text-xs text-muted-foreground"
              onClick={onPublishToStore}
            >
              Upload to the store instead
            </Button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button
              onClick={() =>
              onConfirmExport({
                asIs,
                generateFormats,
                currentArtboardOnly: scopedToArtboard,
                // Left off entirely on a project with no languages, so the
                // export path keeps its existing single-pass behaviour.
                locales: showLocales ? selectedLocales : undefined,
              })
            }
              disabled={nothingSelected}
            >
              Export
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
