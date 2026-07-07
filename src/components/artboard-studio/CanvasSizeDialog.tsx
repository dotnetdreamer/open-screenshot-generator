"use client";
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { cn } from '@/lib/utils';
import type { Size } from '@/types/artboard';
import {
  CANVAS_SIZE_PRESET_GROUPS,
  CANVAS_SIZE_MIN,
  CANVAS_SIZE_MAX,
  ALL_CANVAS_SIZE_PRESETS,
  findMatchingPreset,
  isValidCanvasSize,
  type CanvasSizePreset,
} from '@/lib/sizePresets';

interface CanvasSizeDialogProps {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
  // Current canvas size (all artboards share one), used to preselect the
  // matching preset and prefill the custom fields.
  currentSize?: Size;
  // Applies the chosen size — same raw resize as the old Width/Height/Apply
  // controls (resizes every artboard; does not scale content or swap mockups).
  onApply: (width: number, height: number) => void;
}

const CUSTOM_ID = 'custom';

// A proportional thumbnail of the chosen canvas shape — fits inside a fixed
// box so tall portrait and wide landscape sizes both read at a glance.
function AspectPreview({ width, height }: { width: number; height: number }) {
  const valid = width > 0 && height > 0;
  const ratio = valid ? width / height : 1;
  const BOX = 44;
  const w = ratio >= 1 ? BOX : Math.max(8, Math.round(BOX * ratio));
  const h = ratio >= 1 ? Math.max(8, Math.round(BOX / ratio)) : BOX;
  return (
    <div className="flex h-12 w-12 shrink-0 items-center justify-center" aria-hidden="true">
      <div
        className="rounded-[3px] border-2 border-primary/70 bg-primary/10"
        style={{ width: w, height: h }}
      />
    </div>
  );
}

export function CanvasSizeDialog({
  isOpen,
  onOpenChange,
  currentSize,
  onApply,
}: CanvasSizeDialogProps) {
  const [selectedId, setSelectedId] = useState<string>(CUSTOM_ID);
  const [width, setWidth] = useState<string>('');
  const [height, setHeight] = useState<string>('');
  const widthInputRef = useRef<HTMLInputElement>(null);

  // Latest currentSize, read at open time only (see the reset effect below).
  const currentSizeRef = useRef(currentSize);
  currentSizeRef.current = currentSize;

  // Initialize from the current canvas size — ONLY on the closed→open edge.
  // Depending on currentSize here would re-run mid-session whenever the
  // artboard size prop changes reference (e.g. a global undo/redo/delete
  // keystroke while a radio is focused), silently clobbering the user's
  // in-progress selection. Reading via the ref keeps this an initialize-on-open.
  useEffect(() => {
    if (!isOpen) return;
    const cs = currentSizeRef.current;
    const match = findMatchingPreset(cs);
    setWidth(String(cs?.width ?? 1290));
    setHeight(String(cs?.height ?? 2796));
    setSelectedId(match ? match.id : CUSTOM_ID);
  }, [isOpen]);

  const selectPreset = (preset: CanvasSizePreset) => {
    setSelectedId(preset.id);
    setWidth(String(preset.width));
    setHeight(String(preset.height));
  };

  const handleValueChange = (value: string) => {
    if (value === CUSTOM_ID) {
      // Do NOT steal focus into the width input here — Radix radio groups
      // select-on-focus, so arrow-navigating onto Custom would fire this and
      // yank keyboard focus out of the radio group. Pointer clicks focus the
      // width field via onPointerDown on the Custom row instead.
      setSelectedId(CUSTOM_ID);
      return;
    }
    const preset = ALL_CANVAS_SIZE_PRESETS.find((p) => p.id === value);
    if (preset) selectPreset(preset);
  };

  const handleWidthChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setWidth(e.target.value.replace(/[^0-9]/g, ''));
    setSelectedId(CUSTOM_ID);
  };

  const handleHeightChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setHeight(e.target.value.replace(/[^0-9]/g, ''));
    setSelectedId(CUSTOM_ID);
  };

  const numWidth = parseInt(width, 10);
  const numHeight = parseInt(height, 10);
  const valid = isValidCanvasSize(numWidth, numHeight);

  const handleApply = () => {
    if (!valid) return;
    onApply(numWidth, numHeight);
    onOpenChange(false);
  };

  const previewW = Number.isFinite(numWidth) ? numWidth : 0;
  const previewH = Number.isFinite(numHeight) ? numHeight : 0;

  const currentLabel = useMemo(() => {
    const match = findMatchingPreset(currentSize);
    if (!currentSize) return 'Not set';
    return `${currentSize.width} × ${currentSize.height}${match ? ` · ${match.label}` : ''}`;
  }, [currentSize]);

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      {/* flex column + capped height so the header, current bar and footer stay
          fixed and only the preset list scrolls — never clips off short
          viewports or at high browser zoom. */}
      <DialogContent className="flex max-h-[92vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="shrink-0 space-y-1 border-b px-6 py-4">
          <DialogTitle>Canvas Size</DialogTitle>
          <DialogDescription>
            Choose a preset or enter a custom size. It resizes every artboard
            without scaling your content or swapping mockups.
          </DialogDescription>
        </DialogHeader>

        <div className="flex shrink-0 items-center gap-3 border-b bg-muted/40 px-6 py-3">
          <AspectPreview width={previewW} height={previewH} />
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Current
            </p>
            <p className="truncate text-sm font-semibold tabular-nums">{currentLabel}</p>
          </div>
        </div>

        {/* RadioGroup IS the scroll container (flex-1 + min-h-0). A native
            overflow div is used because a Radix ScrollArea under a max-h/flex
            parent can silently stop scrolling (known repo quirk); show-scrollbar
            re-enables a thin scrollbar hidden globally in globals.css. */}
        <RadioGroup
          value={selectedId}
          onValueChange={handleValueChange}
          aria-label="Canvas size presets"
          className="show-scrollbar block min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-4"
        >
          <div className="grid grid-cols-1 gap-x-8 gap-y-6 sm:grid-cols-2">
            {CANVAS_SIZE_PRESET_GROUPS.map((group) => (
              <section
                key={group.key}
                role="group"
                aria-labelledby={`sizegrp-${group.key}`}
                className="space-y-2"
              >
                <h3
                  id={`sizegrp-${group.key}`}
                  className="text-xs font-bold uppercase tracking-wide text-muted-foreground"
                >
                  {group.label}
                </h3>
                <div className="space-y-1.5">
                  {group.presets.map((preset) => {
                    const selected = selectedId === preset.id;
                    return (
                      <label
                        key={preset.id}
                        htmlFor={`size-${preset.id}`}
                        className={cn(
                          'flex cursor-pointer items-center gap-3 rounded-md border p-2.5 transition-shadow hover:shadow-xl',
                          selected
                            ? 'border-primary bg-primary/5 ring-1 ring-primary'
                            : 'border-border'
                        )}
                      >
                        <RadioGroupItem
                          value={preset.id}
                          id={`size-${preset.id}`}
                          aria-label={`${preset.label}${preset.required ? ', required' : ''}, ${preset.width} by ${preset.height}${preset.aspectLabel ? `, ${preset.aspectLabel}` : ''}`}
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
                              <span className="truncate" title={preset.label}>
                                {preset.label}
                              </span>
                              {preset.required && (
                                <span className="shrink-0 rounded-sm border border-primary/40 bg-primary/10 px-1 py-0.5 text-[10px] font-bold uppercase leading-none text-foreground">
                                  Required
                                </span>
                              )}
                            </span>
                            <span className="flex shrink-0 flex-col items-end leading-tight">
                              <span className="text-xs tabular-nums text-muted-foreground">
                                {preset.width}×{preset.height}
                              </span>
                              {preset.aspectLabel && (
                                <span className="text-[10px] tabular-nums text-muted-foreground">
                                  {preset.aspectLabel}
                                </span>
                              )}
                            </span>
                          </div>
                          {preset.note && (
                            <p className="mt-0.5 truncate text-xs text-muted-foreground" title={preset.note}>
                              {preset.note}
                            </p>
                          )}
                        </div>
                      </label>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>

          {/* Custom size — preserves the exact old raw-resize capability. */}
          <section className="space-y-2">
            <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
              Custom
            </h3>
            <div
              className={cn(
                'flex flex-wrap items-center gap-3 rounded-md border p-3 transition-colors',
                selectedId === CUSTOM_ID
                  ? 'border-primary bg-primary/5 ring-1 ring-primary'
                  : 'border-border'
              )}
            >
              <label
                htmlFor={`size-${CUSTOM_ID}`}
                className="flex cursor-pointer items-center gap-2"
                // Pointer-only focus assist: clicking the Custom row focuses the
                // width field. onPointerDown (not the RadioGroup value change)
                // so keyboard arrow-navigation onto Custom never steals focus.
                onPointerDown={() =>
                  requestAnimationFrame(() => widthInputRef.current?.focus())
                }
              >
                <RadioGroupItem value={CUSTOM_ID} id={`size-${CUSTOM_ID}`} aria-label="Custom size" />
                <span className="text-sm font-medium">Custom size</span>
              </label>
              <div className="flex items-end gap-2">
                <div className="flex flex-col">
                  <Label htmlFor="canvas-custom-width" className="mb-0.5 text-xs text-muted-foreground">
                    Width
                  </Label>
                  <Input
                    id="canvas-custom-width"
                    ref={widthInputRef}
                    type="text"
                    inputMode="numeric"
                    value={width}
                    onChange={handleWidthChange}
                    className="h-8 w-20 text-sm"
                  />
                </div>
                <span className="pb-1.5 text-muted-foreground">×</span>
                <div className="flex flex-col">
                  <Label htmlFor="canvas-custom-height" className="mb-0.5 text-xs text-muted-foreground">
                    Height
                  </Label>
                  <Input
                    id="canvas-custom-height"
                    type="text"
                    inputMode="numeric"
                    value={height}
                    onChange={handleHeightChange}
                    className="h-8 w-20 text-sm"
                  />
                </div>
                <span className="pb-1.5 text-xs text-muted-foreground">px</span>
              </div>
            </div>
            {!valid && (width !== '' || height !== '') && (
              <p className="text-xs text-destructive">
                Width and height must be between {CANVAS_SIZE_MIN} and {CANVAS_SIZE_MAX} pixels.
              </p>
            )}
          </section>
        </RadioGroup>

        <DialogFooter className="shrink-0 border-t px-6 py-4">
          <DialogClose asChild>
            <Button variant="outline">Cancel</Button>
          </DialogClose>
          <Button onClick={handleApply} disabled={!valid}>
            Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
