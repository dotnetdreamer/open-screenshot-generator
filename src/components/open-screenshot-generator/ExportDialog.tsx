
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
import { Slider } from "@/components/ui/slider";
import type { Size } from '@/types/artboard';
import {
  APP_STORE_FORMAT_IDS,
  DEVICE_FORMAT_PRESETS,
  type DeviceFormat,
} from '@/lib/deviceRegistry';
import { useT } from '@/i18n';

// Image encodings the export can produce. JPEG and WebP are lossy and honor
// `quality`; both flatten transparency onto the artboard background colour.
export type ExportImageFormat = 'png' | 'jpeg' | 'svg' | 'webp';

export interface ExportSelection {
  // Export the artboards exactly as they are on the canvas.
  asIs: boolean;
  // App Store formats to additionally generate: each is converted in-memory
  // (store-correct canvas + matching device mockups), captured, then the
  // canvas is restored — the project itself is never modified.
  generateFormats: DeviceFormat[];
  // Subset of artboard ids to export; omitted means every artboard.
  artboardIds?: string[];
  // Image encoding for the captures; omitted means PNG.
  format?: ExportImageFormat;
  // Lossy quality (0..1) for JPEG and WebP; ignored for PNG and SVG.
  quality?: number;
}

// Shared with AppPreviewExportDialog (the video projects' own dialog), which
// owns all the video UI — this screenshot dialog has none.
export type VideoSizeMode = 'appstore-portrait' | 'appstore-landscape' | 'artboard';

export interface VideoExportRequest {
  fps: number; // 30 or 60
  durationSeconds: number; // 1..30
  sizeMode: VideoSizeMode;
  rawRecordingOnly: boolean;
}

export interface VideoExportProgress {
  boardName: string;
  boardIndex: number; // 1-based
  boardCount: number;
  frame: number;
  totalFrames: number;
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
  // Artboards in canvas order, for the scope checklist.
  artboards: { id: string; name: string }[];
}

// Apple's screenshot-specification tiers for the sizes this app can generate
// (https://developer.apple.com/help/app-store-connect/reference/app-information/screenshot-specifications/).
// Keys into the exportDialog.* message namespace.
const APP_STORE_TIER_NOTE_KEYS: Partial<Record<DeviceFormat, 'exportDialog.tierIos' | 'exportDialog.tierIpadPro' | 'exportDialog.tierIpad11'>> = {
  'ios': 'exportDialog.tierIos',
  'ipad-pro-13': 'exportDialog.tierIpadPro',
  'ipad-11': 'exportDialog.tierIpad11',
};

const IMAGE_FORMAT_OPTIONS: { id: ExportImageFormat; label: string; noteKey: 'exportDialog.formatPngNote' | 'exportDialog.formatJpegNote' | 'exportDialog.formatWebpNote' | 'exportDialog.formatSvgNote' }[] = [
  { id: 'png', label: 'PNG', noteKey: 'exportDialog.formatPngNote' },
  { id: 'jpeg', label: 'JPEG', noteKey: 'exportDialog.formatJpegNote' },
  { id: 'webp', label: 'WebP', noteKey: 'exportDialog.formatWebpNote' },
  { id: 'svg', label: 'SVG', noteKey: 'exportDialog.formatSvgNote' },
];

export function ExportDialog({
  isOpen,
  onOpenChange,
  onConfirmExport,
  currentFormat,
  currentSize,
  artboards,
}: ExportDialogProps) {
  const t = useT();
  const [asIs, setAsIs] = useState(true);
  const [generateFormats, setGenerateFormats] = useState<DeviceFormat[]>([]);
  const [scope, setScope] = useState<'all' | 'pick'>('all');
  const [checkedIds, setCheckedIds] = useState<string[]>([]);
  const [format, setFormat] = useState<ExportImageFormat>('png');
  const [quality, setQuality] = useState(0.92);

  useEffect(() => {
    // Reset selection whenever the dialog is reopened
    if (isOpen) {
      setAsIs(true);
      setGenerateFormats([]);
      setScope('all');
      setCheckedIds(artboards.map((ab) => ab.id));
      setFormat('png');
      setQuality(0.92);
    }
  }, [isOpen, artboards]);

  const currentPreset = useMemo(
    () => DEVICE_FORMAT_PRESETS.find((p) => p.id === currentFormat),
    [currentFormat]
  );

  // App Store formats the current canvas does NOT already produce. When the
  // project is already on one (e.g. iPhone at the exact 1290×2796 canvas),
  // the as-is export covers it and it is left out of the generate list.
  const appStorePresets = APP_STORE_FORMAT_IDS
    .map((id) => DEVICE_FORMAT_PRESETS.find((p) => p.id === id)!)
    .filter(Boolean);

  const coveredByAsIs = (formatId: DeviceFormat) => {
    if (currentFormat !== formatId) return false;
    const preset = DEVICE_FORMAT_PRESETS.find((p) => p.id === formatId);
    return (
      !!preset &&
      !!currentSize &&
      currentSize.width === preset.artboard.width &&
      currentSize.height === preset.artboard.height
    );
  };

  const toggleFormat = (formatId: DeviceFormat) => {
    setGenerateFormats((prev) =>
      prev.includes(formatId) ? prev.filter((f) => f !== formatId) : [...prev, formatId]
    );
  };

  const toggleArtboard = (id: string) => {
    setCheckedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const nothingSelected = !asIs && generateFormats.length === 0;
  const noArtboardsPicked = scope === 'pick' && checkedIds.length === 0;

  const handleConfirm = () => {
    // Canvas order is preserved by filtering the prop list rather than using
    // checklist click order, so filename order prefixes stay meaningful.
    const artboardIds =
      scope === 'all'
        ? artboards.map((ab) => ab.id)
        : artboards.filter((ab) => checkedIds.includes(ab.id)).map((ab) => ab.id);
    onConfirmExport({ asIs, generateFormats, artboardIds, format, quality });
  };

  const asIsDescription = currentPreset
    ? currentSize
      ? t('exportDialog.asIsPresetSized', { preset: currentPreset.label, width: currentSize.width, height: currentSize.height })
      : t('exportDialog.asIsPreset', { preset: currentPreset.label })
    : currentSize
      ? t('exportDialog.asIsCurrentSized', { width: currentSize.width, height: currentSize.height })
      : t('exportDialog.asIsCurrent');

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>{t('exportDialog.title')}</DialogTitle>
          <DialogDescription>{t('exportDialog.description')}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div>
            <p className="text-sm font-medium mb-2">{t('exportDialog.scopeLabel')}</p>
            <RadioGroup
              value={scope}
              onValueChange={(v) => setScope(v as 'all' | 'pick')}
              className="grid gap-2"
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="all" id="scope-all" />
                <Label htmlFor="scope-all">{t('exportDialog.scopeAll', { count: artboards.length })}</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="pick" id="scope-pick" />
                <Label htmlFor="scope-pick">{t('exportDialog.scopePick')}</Label>
              </div>
            </RadioGroup>
            {scope === 'pick' && (
              // Native overflow div, not ScrollArea: ScrollArea under max-h stops scrolling
              <div className="mt-2 ml-6 grid max-h-40 gap-2 overflow-y-auto rounded-md border p-3">
                {artboards.map((ab, index) => (
                  <div key={ab.id} className="flex items-center space-x-2">
                    <Checkbox
                      id={`export-ab-${ab.id}`}
                      checked={checkedIds.includes(ab.id)}
                      onCheckedChange={() => toggleArtboard(ab.id)}
                    />
                    <Label htmlFor={`export-ab-${ab.id}`} className="font-normal">
                      {index + 1}. {ab.name}
                    </Label>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <p className="text-sm font-medium mb-2">{t('exportDialog.formatLabel')}</p>
            <RadioGroup
              value={format}
              onValueChange={(v) => setFormat(v as ExportImageFormat)}
              className="grid grid-cols-2 gap-3"
            >
              {IMAGE_FORMAT_OPTIONS.map((option) => (
                <div key={option.id} className="flex items-start space-x-2">
                  <RadioGroupItem value={option.id} id={`format-${option.id}`} className="mt-0.5" />
                  <div className="grid gap-0.5 leading-none">
                    <Label htmlFor={`format-${option.id}`}>{option.label}</Label>
                    <p className="text-xs text-muted-foreground">{t(option.noteKey)}</p>
                  </div>
                </div>
              ))}
            </RadioGroup>
            {format === 'svg' && (
              <p className="mt-2 text-xs text-muted-foreground">
                {t('exportDialog.svgFlattenNote')}
              </p>
            )}
            {(format === 'jpeg' || format === 'webp') && (
              <div className="mt-3 grid gap-1.5">
                <Label htmlFor="export-quality" className="text-sm">
                  {t('exportDialog.quality', { value: Math.round(quality * 100) })}
                </Label>
                <Slider
                  id="export-quality"
                  min={10}
                  max={100}
                  step={1}
                  value={[Math.round(quality * 100)]}
                  onValueChange={(v) => setQuality(v[0] / 100)}
                />
              </div>
            )}
          </div>

          <div className="flex items-start space-x-2">
            <Checkbox
              id="export-as-is"
              checked={asIs}
              onCheckedChange={(v) => setAsIs(v === true)}
            />
            <div className="grid gap-0.5 leading-none">
              <Label htmlFor="export-as-is">{t('exportDialog.exportCurrentCanvas')}</Label>
              <p className="text-xs text-muted-foreground">{asIsDescription}</p>
            </div>
          </div>

          <div>
            <p className="text-sm font-medium mb-0.5">{t('exportDialog.alsoGenerate')}</p>
            <p className="text-xs text-muted-foreground mb-3">
              {t('exportDialog.appleAccepts')}
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
                          ? t('exportDialog.coveredByCanvas')
                          : APP_STORE_TIER_NOTE_KEYS[preset.id]
                            ? t(APP_STORE_TIER_NOTE_KEYS[preset.id]!)
                            : null}
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
            <Button variant="outline">{t('common.cancel')}</Button>
          </DialogClose>
          <Button
            onClick={handleConfirm}
            disabled={nothingSelected || noArtboardsPicked}
          >
            {t('exportDialog.export')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
