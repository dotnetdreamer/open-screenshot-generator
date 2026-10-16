"use client";

import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import { FlipHorizontal2, RotateCcw, Rotate3d } from 'lucide-react';
import type { Device3DLight, Device3DOrientation, DeviceFrameElementProps } from '@/types/artboard';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { cn } from '@/lib/utils';
import { withBasePath } from '@/lib/basePath';
import {
  STUDIO_LENS_MAX,
  STUDIO_LENS_MIN,
  STUDIO_LIGHT_ELEVATION_MAX,
  STUDIO_LIGHT_ELEVATION_MIN,
  STUDIO_LIGHT_INTENSITY_MAX,
  STUDIO_LIGHT_INTENSITY_MIN,
  STUDIO_LOOKS,
  exposedSide,
  isMeasuredModel,
  lightForOrientation,
  matchStudioLook,
  mirrorOrientation,
  studioCustomColorOf,
  studioFinishOf,
  studioGlareOf,
  studioLensOf,
  studioLightOf,
  studioModelFor,
  studioOrientationOf,
  withStudioRehug,
  wrapDegrees,
  type StudioLook,
} from '@/lib/device3dStudio';
import { updateStudioLive, type StudioLiveHandler, type StudioLiveState } from '@/lib/device3dStudioLive';

interface StudioDevicePropertiesProps {
  element: DeviceFrameElementProps;
  onUpdateElement: (updates: Partial<DeviceFrameElementProps>) => void;
  onUpdateElementById?: (elementId: string, updates: Partial<DeviceFrameElementProps>) => void;
  onStudioLive?: StudioLiveHandler;
  /**
   * The panel's label row, which adds the per-language detach toggle when a
   * translated language is on screen and returns the label untouched otherwise.
   */
  labelRow: (label: React.ReactNode, keys: string | string[], what: string) => React.ReactNode;
}

/**
 * A slider that previews on the canvas while it is dragged and commits once,
 * on release. The preview goes through device3dStudioLive, so the drag costs
 * no undo entries and no project writes (see ScaleField for why that matters).
 */
function LiveSlider({
  id,
  value,
  min,
  max,
  step,
  onLive,
  onCommit,
  onCancel,
}: {
  id: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onLive: (next: number) => void;
  onCommit: (next: number) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<number | null>(null);
  useEffect(() => setDraft(null), [value]);
  return (
    <Slider
      id={id}
      min={min}
      max={max}
      step={step}
      value={[draft ?? value]}
      onValueChange={(next) => {
        setDraft(next[0]);
        onLive(next[0]);
      }}
      onValueCommit={(next) => {
        setDraft(null);
        onCommit(next[0]);
      }}
      onPointerCancel={() => {
        setDraft(null);
        onCancel();
      }}
      className="my-2"
    />
  );
}

/**
 * Where the key light comes from, as a dot on a disc: the middle is straight
 * ahead, the edge is light from the side, up is from above.
 */
function LightPad({
  light,
  onLive,
  onCommit,
}: {
  light: Device3DLight;
  onLive: (next: Device3DLight) => void;
  onCommit: (next: Device3DLight) => void;
}) {
  const padRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef<Device3DLight | null>(null);
  const [draft, setDraft] = useState<Device3DLight | null>(null);
  const shown = draft ?? light;
  const az = (shown.azimuth * Math.PI) / 180;
  const el = (shown.elevation * Math.PI) / 180;
  // Front hemisphere, seen from the camera.
  const dotX = Math.sin(Math.max(-Math.PI / 2, Math.min(Math.PI / 2, az))) * Math.cos(el);
  const dotY = Math.sin(el);

  const lightAt = (clientX: number, clientY: number): Device3DLight => {
    const rect = padRef.current!.getBoundingClientRect();
    let x = ((clientX - rect.left) / rect.width) * 2 - 1;
    let y = 1 - ((clientY - rect.top) / rect.height) * 2;
    const len = Math.hypot(x, y);
    if (len > 1) {
      x /= len;
      y /= len;
    }
    const elevation = Math.max(
      STUDIO_LIGHT_ELEVATION_MIN,
      Math.min(STUDIO_LIGHT_ELEVATION_MAX, (Math.asin(Math.max(-1, Math.min(1, y))) * 180) / Math.PI)
    );
    const cosEl = Math.cos((elevation * Math.PI) / 180) || 1e-6;
    const azimuth = (Math.asin(Math.max(-1, Math.min(1, x / cosEl))) * 180) / Math.PI;
    return { ...light, azimuth: Math.round(azimuth), elevation: Math.round(elevation) };
  };

  const release = () => {
    const next = draggingRef.current;
    draggingRef.current = null;
    setDraft(null);
    if (next) onCommit(next);
  };

  return (
    <div
      ref={padRef}
      role="slider"
      aria-label="Light direction"
      aria-valuetext={`From ${shown.azimuth < 0 ? 'the left' : shown.azimuth > 0 ? 'the right' : 'the front'}, ${Math.round(shown.elevation)}° up`}
      tabIndex={0}
      className="relative h-20 w-20 shrink-0 cursor-crosshair rounded-full border bg-gradient-to-b from-muted to-background touch-none"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        const next = lightAt(e.clientX, e.clientY);
        draggingRef.current = next;
        setDraft(next);
        onLive(next);
      }}
      onPointerMove={(e) => {
        if (!draggingRef.current) return;
        const next = lightAt(e.clientX, e.clientY);
        draggingRef.current = next;
        setDraft(next);
        onLive(next);
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 15 : 5;
        let next: Device3DLight | null = null;
        if (e.key === 'ArrowLeft') next = { ...light, azimuth: Math.max(-90, light.azimuth - step) };
        if (e.key === 'ArrowRight') next = { ...light, azimuth: Math.min(90, light.azimuth + step) };
        if (e.key === 'ArrowUp') next = { ...light, elevation: Math.min(STUDIO_LIGHT_ELEVATION_MAX, light.elevation + step) };
        if (e.key === 'ArrowDown') next = { ...light, elevation: Math.max(STUDIO_LIGHT_ELEVATION_MIN, light.elevation - step) };
        if (!next) return;
        e.preventDefault();
        onCommit(next);
      }}
    >
      <div className="pointer-events-none absolute inset-[22%] rounded-full border border-dashed border-border" />
      <div
        className="pointer-events-none absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background bg-amber-400 shadow"
        style={{ left: `${50 + dotX * 50}%`, top: `${50 - dotY * 50}%` }}
      />
    </div>
  );
}

/** The 3D Studio section of a device's properties. */
export function StudioDeviceProperties({ element, onUpdateElement, onUpdateElementById, onStudioLive = updateStudioLive, labelRow }: StudioDevicePropertiesProps) {
  const id = element.id;
  const model = studioModelFor(element.deviceType);
  const orientation = studioOrientationOf(element);
  const lens = studioLensOf(element);
  const light = studioLightOf(element);
  const glare = studioGlareOf(element);
  const finish = model ? studioFinishOf(element, model) : null;
  const custom = studioCustomColorOf(element);
  const matched = matchStudioLook(orientation);
  const [customColor, setCustomColor] = useState(finish?.frame ?? '#888888');
  useEffect(() => setCustomColor(finish?.frame ?? '#888888'), [id, finish?.frame]);
  // The color picker reports every step of a drag. The canvas follows each
  // one live and the color lands once the picking pauses.
  const colorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingColor = useRef<{ elementId: string; color: string; commit: typeof onUpdateElement } | null>(null);
  const callbacksRef = useRef({ onUpdateElementById, onStudioLive });
  callbacksRef.current = { onUpdateElementById, onStudioLive };
  const finishColor = (save: boolean) => {
    if (colorTimer.current) clearTimeout(colorTimer.current);
    colorTimer.current = null;
    const pending = pendingColor.current;
    pendingColor.current = null;
    if (!pending) return false;
    if (save) {
      const updates = { bodyColor3d: pending.color };
      if (callbacksRef.current.onUpdateElementById) callbacksRef.current.onUpdateElementById(pending.elementId, updates);
      else pending.commit(updates);
    }
    callbacksRef.current.onStudioLive(pending.elementId, null, save ? 'commit' : 'cancel');
    return true;
  };
  const finishColorRef = useRef(finishColor);
  finishColorRef.current = finishColor;
  useEffect(() => () => {
    if (!finishColorRef.current(true)) callbacksRef.current.onStudioLive(id, null, 'cancel');
  }, [id]);

  if (!model || !finish) return null;

  const live = (state: StudioLiveState) => onStudioLive(id, state);
  const cancelLive = () => onStudioLive(id, null, 'cancel');
  const commit = (updates: Partial<DeviceFrameElementProps>) => {
    onUpdateElement(updates);
    onStudioLive(id, null, 'commit');
  };
  const commitOrientation = (next: Device3DOrientation) => commit(withStudioRehug(element, { rotation3d: next }));

  const applyLook = (look: StudioLook) => {
    // A look keeps the way the device faces now, and swings the key light to
    // the rail it shows, the way the posed tiles are lit.
    const facingRight = exposedSide(orientation) > 0 && orientation.yaw !== 0;
    const next = facingRight ? mirrorOrientation(look.orientation) : look.orientation;
    onUpdateElement({
      ...withStudioRehug(element, { rotation3d: next }),
      light3d: lightForOrientation(light, next),
    });
  };

  const angleRow = (key: 'yaw' | 'pitch' | 'roll', label: string) => (
    <div className="flex flex-col space-y-1 min-w-[150px]">
      <Label htmlFor={`studio-${key}`} className="text-xs">
        {label}: {Math.round(orientation[key])}°
      </Label>
      <LiveSlider
        id={`studio-${key}`}
        value={orientation[key]}
        min={key === 'pitch' ? -90 : -180}
        max={key === 'pitch' ? 90 : 180}
        step={1}
        onLive={(v) => live({ orientation: { ...orientation, [key]: v } })}
        onCommit={(v) => commitOrientation({ ...orientation, [key]: wrapDegrees(v) })}
        onCancel={cancelLive}
      />
    </div>
  );

  return (
    <div className="flex w-full flex-col gap-3 rounded-lg border bg-muted/30 p-2.5">
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center gap-1.5 text-xs font-medium">
          <Rotate3d className="h-3.5 w-3.5 text-primary" />
          3D Studio
        </div>
        <p className="text-[11px] leading-snug text-muted-foreground">
          {!isMeasuredModel(element.deviceType)
            ? 'A generic shape. Pick an iPhone 16 or newer, or a Pixel, in Device Model for an exact one'
            : model.maker === 'google'
              ? `${model.label}, built to Google's device frame and hardware diagram`
              : `${model.label}, built to Apple's dimensional drawings`}
        </p>
      </div>

      <div className="flex flex-col gap-1.5">
        {labelRow(
          <Label className="text-xs">
            Finish: {finish.label}
          </Label>,
          ['finish3d', 'bodyColor3d'],
          'Finish'
        )}
        <div className="flex flex-wrap items-center gap-1.5">
          {model.finishes.map((option) => {
            const active = !custom && option.id === finish.id;
            return (
              <button
                key={option.id}
                type="button"
                title={option.label}
                aria-label={`${option.label} finish`}
                aria-pressed={active}
                onClick={() => {
                  finishColor(false);
                  onUpdateElement({ finish3d: option.id, bodyColor3d: '' });
                }}
                className={cn(
                  'h-6 w-6 rounded-full border shadow-sm transition-transform hover:scale-110',
                  active && 'ring-2 ring-primary ring-offset-1 ring-offset-background'
                )}
                style={{ background: `linear-gradient(135deg, ${option.frame} 50%, ${option.back} 50%)` }}
              />
            );
          })}
          <Input
            type="color"
            aria-label="Custom finish color"
            title="Custom color"
            className={cn('h-6 w-8 cursor-pointer p-0.5', custom && 'ring-2 ring-primary ring-offset-1 ring-offset-background')}
            value={customColor}
            onChange={(e) => {
              const next = e.target.value;
              setCustomColor(next);
              const preview = studioFinishOf({ bodyColor3d: next }, model);
              live({ finish: { frame: preview.frame, back: preview.back } });
              if (colorTimer.current) clearTimeout(colorTimer.current);
              pendingColor.current = { elementId: id, color: next, commit: onUpdateElement };
              colorTimer.current = setTimeout(() => {
                finishColorRef.current(true);
              }, 300);
            }}
            onBlur={() => finishColor(true)}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        {labelRow(<Label className="text-xs">Angle</Label>, 'rotation3d', 'Angle')}
        <div className="grid grid-cols-4 gap-1.5">
          {STUDIO_LOOKS.map((look) => {
            const active = matched?.look.id === look.id;
            return (
              <button
                key={look.id}
                type="button"
                title={look.label}
                aria-label={`${look.label} look`}
                aria-pressed={active}
                onClick={() => applyLook(look)}
                className={cn(
                  'flex aspect-square items-center justify-center rounded-md border p-1 transition-colors',
                  active ? 'border-primary bg-primary/10' : 'border-transparent bg-background hover:border-border'
                )}
              >
                <img
                  src={withBasePath(`/elements/device-3d/studio/look-${look.id}.png`)}
                  alt=""
                  className={cn('max-h-full max-w-full object-contain', active && matched?.mirrored && '-scale-x-100')}
                  draggable={false}
                />
              </button>
            );
          })}
        </div>
        <div className="flex gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 flex-1 text-xs"
            title="Face the other way"
            onClick={() => {
              const next = mirrorOrientation(orientation);
              onUpdateElement({
                ...withStudioRehug(element, { rotation3d: next }),
                light3d: { ...light, azimuth: wrapDegrees(-light.azimuth) },
              });
            }}
          >
            <FlipHorizontal2 className="mr-1 h-3 w-3" />
            Mirror
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 flex-1 text-xs"
            title="Straight on, facing you"
            onClick={() => commitOrientation({ yaw: 0, pitch: 0, roll: 0 })}
          >
            <RotateCcw className="mr-1 h-3 w-3" />
            Reset angle
          </Button>
        </div>
      </div>

      {angleRow('yaw', 'Turn')}
      {angleRow('pitch', 'Tilt')}
      {angleRow('roll', 'Spin')}
      <p className="text-[11px] leading-snug text-muted-foreground">
        Or drag the round handle in the middle of the device
      </p>

      <div className="flex flex-col space-y-1 min-w-[150px]">
        {labelRow(
          <Label htmlFor="studio-lens" className="text-xs">
            Perspective: {Math.round(lens)}°
          </Label>,
          'lens3d',
          'Perspective'
        )}
        <LiveSlider
          id="studio-lens"
          value={lens}
          min={STUDIO_LENS_MIN}
          max={STUDIO_LENS_MAX}
          step={1}
          onLive={(v) => live({ lens: v })}
          onCommit={(v) => commit(withStudioRehug(element, { lens3d: v }))}
          onCancel={cancelLive}
        />
        <div className="flex justify-between text-[10px] text-muted-foreground">
          <span>Flat</span>
          <span>Dramatic</span>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        {labelRow(<Label className="text-xs">Light</Label>, 'light3d', 'Light')}
        <div className="flex items-center gap-3">
          <LightPad light={light} onLive={(next) => live({ light: next })} onCommit={(next) => commit({ light3d: next })} />
          <div className="flex min-w-0 flex-1 flex-col">
            <Label htmlFor="studio-light-strength" className="text-xs">
              Strength: {Math.round(light.intensity * 100)}%
            </Label>
            <LiveSlider
              id="studio-light-strength"
              value={Math.round(light.intensity * 100)}
              min={Math.round(STUDIO_LIGHT_INTENSITY_MIN * 100)}
              max={Math.round(STUDIO_LIGHT_INTENSITY_MAX * 100)}
              step={5}
              onLive={(v) => live({ light: { ...light, intensity: v / 100 } })}
              onCommit={(v) => commit({ light3d: { ...light, intensity: v / 100 } })}
              onCancel={cancelLive}
            />
          </div>
        </div>
      </div>

      <div className="flex flex-col space-y-1 min-w-[150px]">
        {labelRow(
          <Label htmlFor="studio-glare" className="text-xs">
            Screen glare: {Math.round(glare * 100)}%
          </Label>,
          'glare3d',
          'Screen glare'
        )}
        <LiveSlider
          id="studio-glare"
          value={Math.round(glare * 100)}
          min={0}
          max={100}
          step={1}
          onLive={(v) => live({ glare: v / 100 })}
          onCommit={(v) => commit({ glare3d: v / 100 })}
          onCancel={cancelLive}
        />
      </div>
    </div>
  );
}
