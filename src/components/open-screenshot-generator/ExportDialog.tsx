
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
import type { Size } from '@/types/artboard';
import {
  APP_STORE_FORMAT_IDS,
  DEVICE_FORMAT_PRESETS,
  type DeviceFormat,
} from '@/lib/deviceRegistry';

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
}

// Shared with AppPreviewExportDialog (the video projects' own dialog), which
// owns all the video UI — this screenshot dialog has none.
export type VideoSizeMode = 'appstore-portrait' | 'appstore-landscape' | 'artboard';

export interface VideoExportRequest {
  fps: number; // 30 or 60
  durationSeconds: number; // 1..30
  sizeMode: VideoSizeMode;
  rawRecordingOnly: boolean;
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
}

// Apple's screenshot-specification tiers for the sizes this app can generate
// (https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/).
const APP_STORE_TIER_NOTES: Partial<Record<DeviceFormat, string>> = {
  'ios': 'Required — iPhone 6.9-inch display',
  'ipad-pro-13': 'Required if your app runs on iPad — 13-inch display',
  'ipad-11': 'Optional — Apple scales your 13-inch shots down if missing',
};

export function ExportDialog({
  isOpen,
  onOpenChange,
  onConfirmExport,
  currentFormat,
  currentSize,
  activeArtboard,
  artboardCount = 0,
  defaultCurrentArtboardOnly = false,
}: ExportDialogProps) {
  const [asIs, setAsIs] = useState(true);
  const [generateFormats, setGenerateFormats] = useState<DeviceFormat[]>([]);
  const [currentArtboardOnly, setCurrentArtboardOnly] = useState(false);

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
    }
  }, [isOpen, defaultCurrentArtboardOnly]);

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

  const nothingSelected = !asIs && generateFormats.length === 0;

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
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>Export Screenshots</DialogTitle>
          <DialogDescription>
            Download the artboards as PNGs, and optionally generate the App
            Store sizes this project is missing. Generated formats convert the
            canvas and mockups on the fly — your project stays untouched.
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
              Apple accepts 1–10 JPG/PNG screenshots per display size.
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
                        {preset.label} — {preset.artboard.width}×{preset.artboard.height}
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

        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button
            onClick={() =>
              onConfirmExport({ asIs, generateFormats, currentArtboardOnly: scopedToArtboard })
            }
            disabled={nothingSelected}
          >
            Export
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
