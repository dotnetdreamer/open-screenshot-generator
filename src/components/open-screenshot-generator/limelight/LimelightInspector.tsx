"use client";

// The Limelight panel on the right. What it shows follows the selection:
// the whole scene (the video's size and length, the look, the light), a
// camera shot (lens, blur, focus and where the camera stands), a device
// (model, finish, the pictures on its screen, where it is and how it moves)
// or a title.
//
// Changing where a thing is changes it at the playhead: a thing with one
// pose stays still, so its only pose moves; an animated one gets a pose at
// that moment (setPoseAt). "Animate from here" is how a still thing starts
// to move.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CopyIcon, EyeIcon, EyeOffIcon, ImagePlusIcon, Loader2Icon, PlusIcon, Trash2Icon, VideoIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useImageSrc } from '@/lib/mediaStore';
import { useToast } from '@/hooks/use-toast';
import { ToastAction } from '@/components/ui/toast';
import { getFontOptions } from '@/services/fontService';
import { withBasePath } from '@/lib/basePath';
import { stageModelFor } from '@/lib/limelight/models';
import { actorAt } from '@/lib/limelight/animate';
import { dollyZoomTo, LENS_MAX, LENS_MIN } from '@/lib/limelight/camera';
import {
  cameraOnActor,
  duplicateActor,
  removeActor,
  removePose,
  removeShot,
  setFormat,
  setLook,
  setMotion,
  setMusic,
  setPoseAt,
  setScreens,
  setShake,
  updateActor,
  updatePose,
  updateShot,
} from '@/lib/limelight/edit';
import { stageDevices } from '@/lib/limelight/devices';
import { ENVIRONMENT_PRESETS, FORMAT_PRESETS, environmentPreset, formatPresetById, storeRuleProblem } from '@/lib/limelight/presets';
import type { ProjectShot } from '@/lib/limelight/projectShots';
import { deviceHeight } from '@/lib/limelight/scene';
import { getPictureBlob } from '@/lib/limelight/store';
import type {
  CameraState,
  DeviceActor,
  LimelightActor,
  LimelightEase,
  LimelightScene,
  PictureActor,
  ScreenTransition,
  TextActor,
  TextReveal,
  TextRevealStyle,
} from '@/lib/limelight/types';
import { cn } from '@/lib/utils';
import { Choices, ColorWell, Info, Section, SliderRow, formatSeconds, type ChangePhase } from './controls';
import type { LimelightSelection } from './LimelightTimeline';
import { useSettledTime, type TimeStore } from './time';

export const EASE_OPTIONS: Array<{ value: LimelightEase; label: string; hint: string }> = [
  { value: 'smooth', label: 'Smooth', hint: 'Speeds up, then slows to a stop at the next one' },
  { value: 'glide', label: 'Glide', hint: 'Keeps moving through to the next one without stopping' },
  { value: 'steady', label: 'Steady', hint: 'The same speed all the way' },
  { value: 'snappy', label: 'Snappy', hint: 'A quick start and a long, slow finish' },
  { value: 'bounce', label: 'Bounce', hint: 'Goes a little past, then settles back' },
  { value: 'cut', label: 'Cut', hint: 'Stays still, then jumps when the next one starts' },
];

const TRANSITIONS: Array<{ value: ScreenTransition; label: string; hint: string }> = [
  { value: 'slide', label: 'Slide in', hint: 'Like opening a page in an app' },
  { value: 'scroll', label: 'Scroll', hint: 'Like scrolling down a page' },
  { value: 'fade', label: 'Fade', hint: 'One picture fades into the next' },
  { value: 'zoom', label: 'Zoom in', hint: 'Like opening an app from its icon' },
  { value: 'cut', label: 'Cut', hint: 'Changes at once' },
];

/** The app's own fonts that write Latin letters, A to Z. */
const FONTS = Array.from(new Set(getFontOptions().filter((font) => font.script === 'latin').map((font) => font.value))).sort((a, b) => a.localeCompare(b));

export interface InspectorProps {
  scene: LimelightScene;
  selection: LimelightSelection;
  time: TimeStore;
  hasPostEffects: boolean;
  projectShots: ProjectShot[];
  onSelect: (selection: LimelightSelection) => void;
  /** Saves a change. Changes with the same merge key close together are one undo step. */
  onCommit: (next: LimelightScene, merge?: string) => void;
  /** Ends a run of changes: the next one is its own undo step. */
  onSeal: () => void;
  onSeek: (time: number) => void;
  /** The camera as the stage shows it now. */
  viewCamera: () => CameraState | null;
  onAddPictures: (actorId: string, source: { files: File[] } | { shots: ProjectShot[] }) => Promise<void>;
  /** Moves the camera at the playhead back until everything is in the shot. */
  onFitAll: () => void;
}

/** Commits a slider's step, sealing the undo step when it is let go. */
function useChange(props: InspectorProps) {
  return (next: LimelightScene, phase: ChangePhase, merge: string) => {
    props.onCommit(next, merge);
    if (phase === 'done') props.onSeal();
  };
}

// ---------------------------------------------------------------------------
// Pictures
// ---------------------------------------------------------------------------

const pictureUrls = new Map<string, Promise<string | null>>();

/** An object URL for one of Limelight's pictures, kept for the session like getMediaUrl. */
function pictureUrl(id: string): Promise<string | null> {
  let pending = pictureUrls.get(id);
  if (!pending) {
    pending = getPictureBlob(id).then((blob) => (blob ? URL.createObjectURL(blob) : null));
    pictureUrls.set(id, pending);
  }
  return pending;
}

function PictureThumb({ id, className }: { id: string | null; className?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setUrl(null);
    if (id) void pictureUrl(id).then((next) => live && setUrl(next));
    return () => {
      live = false;
    };
  }, [id]);
  return (
    <div className={cn('overflow-hidden rounded-md bg-muted', className)}>
      {url ? <img src={url} alt="" className="h-full w-full object-cover" draggable={false} /> : null}
    </div>
  );
}

function ShotThumb({ shot }: { shot: ProjectShot }) {
  const resolved = useImageSrc(shot.src);
  const src = resolved ? withBasePath(resolved) : undefined;
  return src ? <img src={src} alt="" className="h-full w-full object-cover" draggable={false} loading="lazy" /> : <div className="h-full w-full bg-muted" />;
}

function ProjectPicker({ shots, onPick }: { shots: ProjectShot[]; onPick: (shots: ProjectShot[]) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const own = shots.filter((shot) => !shot.sample);
  const disabled = shots.length === 0;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" size="sm" variant="outline" className="h-8 flex-1 gap-1.5" disabled={disabled} title={disabled ? 'Open a project with screenshots in the editor first' : undefined}>
          <PlusIcon className="h-3.5 w-3.5" />
          From your project
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-3">
        <div className="mb-2 flex items-center gap-2">
          <p className="text-xs font-medium">Pick screenshots for this screen</p>
          {own.length > 1 && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="ml-auto h-7 px-2 text-xs"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                await onPick(own).finally(() => setBusy(false));
                setOpen(false);
              }}
            >
              Use all {own.length}
            </Button>
          )}
        </div>
        <div className="grid max-h-72 grid-cols-4 gap-2 overflow-y-auto">
          {shots.map((shot) => (
            <button
              key={shot.key}
              type="button"
              className="group relative aspect-[9/19] overflow-hidden rounded-md border hover:border-primary disabled:opacity-50"
              title={shot.sample ? `${shot.artboardName}, the template's sample picture` : shot.artboardName}
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                await onPick([shot]).finally(() => setBusy(false));
                setOpen(false);
              }}
            >
              <ShotThumb shot={shot} />
            </button>
          ))}
        </div>
        {busy && (
          <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2Icon className="h-3 w-3 animate-spin" /> Adding the pictures
          </p>
        )}
      </PopoverContent>
    </Popover>
  );
}

// ---------------------------------------------------------------------------
// The scene
// ---------------------------------------------------------------------------

function SceneInspector(props: InspectorProps) {
  const { scene, hasPostEffects } = props;
  const change = useChange(props);
  const { format, look } = scene;
  const preset = formatPresetById(format.preset);
  const problem = storeRuleProblem(format);
  return (
    <>
      <Section title="Video">
        <div className="space-y-1.5">
          <div className="text-xs font-medium">Size</div>
          <Select
            value={preset?.id ?? 'custom'}
            onValueChange={(id) => {
              const next = formatPresetById(id);
              if (!next) return;
              // A store size brings its frame rate; the length stays.
              props.onCommit(setFormat(scene, { width: next.width, height: next.height, fps: Math.min(next.fps, next.rules?.maxFps ?? 60), preset: next.id }, false));
              props.onSeal();
            }}
          >
            <SelectTrigger className="h-8 text-xs" aria-label="Video size">
              <SelectValue placeholder={`${format.width} x ${format.height}`} />
            </SelectTrigger>
            <SelectContent>
              {FORMAT_PRESETS.map((option) => (
                <SelectItem key={option.id} value={option.id} className="text-xs">
                  {option.label}, {option.width} x {option.height}
                </SelectItem>
              ))}
              {!preset && (
                <SelectItem value="custom" className="text-xs" disabled>
                  {format.width} x {format.height}
                </SelectItem>
              )}
            </SelectContent>
          </Select>
          {problem && <p className="text-xs text-amber-600 dark:text-amber-400">{problem}</p>}
        </div>
        <SliderRow
          label="Length"
          value={format.duration}
          min={2}
          max={60}
          step={0.5}
          format={(v) => `${v} s`}
          info="The shots and poses stretch with the length, so the moves keep their shape"
          onChange={(v, phase) => change(setFormat(scene, { duration: v }, true), phase, 'length')}
        />
        <Choices
          label="Frames a second"
          value={String(format.fps) as '24' | '30' | '60'}
          options={[
            { value: '24', label: '24', hint: 'The look of a film' },
            { value: '30', label: '30', hint: 'What the App Store takes' },
            { value: '60', label: '60', hint: 'Extra smooth, for social posts' },
          ]}
          onChange={(fps) => {
            props.onCommit(setFormat(scene, { fps: Number(fps) }, false));
            props.onSeal();
          }}
        />
      </Section>
      <Section title="Look">
        <div className="grid grid-cols-2 gap-2">
          {ENVIRONMENT_PRESETS.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={look.environment === option.id}
              onClick={() => {
                const base = environmentPreset(option.id);
                props.onCommit(setLook(scene, { environment: option.id, backdrop: { ...base.backdrop }, light: { ...base.light }, exposure: base.exposure, shadow: base.shadow }));
                props.onSeal();
              }}
              className={cn('overflow-hidden rounded-lg border text-left transition-colors', look.environment === option.id ? 'border-primary ring-1 ring-primary' : 'hover:border-foreground/30')}
            >
              <div
                className="h-10 w-full"
                style={{
                  background:
                    option.backdrop.style === 'radial'
                      ? `radial-gradient(circle at 50% 45%, ${option.backdrop.top}, ${option.backdrop.bottom})`
                      : `linear-gradient(${option.backdrop.top}, ${option.backdrop.bottom})`,
                }}
              />
              <div className="px-2 py-1.5">
                <div className="text-xs font-medium">{option.label}</div>
                <div className="truncate text-[11px] text-muted-foreground">{option.hint}</div>
              </div>
            </button>
          ))}
        </div>
      </Section>
      <Section title="Music">
        <Choices
          value={scene.music?.track ?? 'none'}
          options={[
            { value: 'none', label: 'None', hint: 'A silent video' },
            { value: 'pulse', label: 'Pulse', hint: 'Upbeat, with drums on the beat and a cymbal on every cut' },
            { value: 'calm', label: 'Calm', hint: 'Slow and warm, with soft drums and a bell' },
          ]}
          onChange={(track) => {
            props.onCommit(setMusic(scene, track === 'none' ? undefined : { track, volume: scene.music?.volume ?? 0.8 }));
            props.onSeal();
          }}
        />
        {scene.music && (
          <SliderRow
            label="Volume"
            value={scene.music.volume}
            min={0}
            max={1}
            step={0.01}
            format={(v) => `${Math.round(v * 100)}%`}
            onChange={(v, phase) => change(setMusic(scene, { ...scene.music!, volume: v }), phase, 'music-volume')}
          />
        )}
        <p className="text-[11px] text-muted-foreground">Made by the app at your video&apos;s length, so its beat lands on your cuts</p>
      </Section>
      <Section title="Backdrop">
        <Choices
          value={look.backdrop.style}
          options={[
            { value: 'glow', label: 'Lights', hint: 'Soft lights in one colour that shift as the camera moves' },
            { value: 'radial', label: 'Glow', hint: 'Lighter in the middle' },
            { value: 'linear', label: 'Fade', hint: 'Top colour to bottom colour' },
            { value: 'solid', label: 'Plain', hint: 'One colour' },
          ]}
          columns={4}
          onChange={(style) => {
            props.onCommit(setLook(scene, { backdrop: { ...look.backdrop, style } }));
            props.onSeal();
          }}
        />
        <ColorWell
          label={look.backdrop.style === 'glow' ? 'Lights' : look.backdrop.style === 'radial' ? 'Middle' : 'Top'}
          value={look.backdrop.top}
          onChange={(v, phase) => change(setLook(scene, { backdrop: { ...look.backdrop, top: v } }), phase, 'backdrop-top')}
        />
        {look.backdrop.style !== 'solid' && (
          <ColorWell
            label={look.backdrop.style === 'glow' ? 'Behind them' : look.backdrop.style === 'radial' ? 'Edges' : 'Bottom'}
            value={look.backdrop.bottom}
            onChange={(v, phase) => change(setLook(scene, { backdrop: { ...look.backdrop, bottom: v } }), phase, 'backdrop-bottom')}
          />
        )}
      </Section>
      <Section title="Light">
        <SliderRow label="Comes from" value={look.light.azimuth} min={-180} max={180} format={(v) => `${Math.round(v)}°`} info="0 is from the front, 90 from the right, -90 from the left" onChange={(v, phase) => change(setLook(scene, { light: { ...look.light, azimuth: v } }), phase, 'light-azimuth')} />
        <SliderRow label="Height" value={look.light.elevation} min={0} max={90} format={(v) => `${Math.round(v)}°`} onChange={(v, phase) => change(setLook(scene, { light: { ...look.light, elevation: v } }), phase, 'light-elevation')} />
        <SliderRow label="Brightness" value={look.light.intensity} min={0.2} max={2.5} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onChange={(v, phase) => change(setLook(scene, { light: { ...look.light, intensity: v } }), phase, 'light-intensity')} />
        <SliderRow label="Exposure" value={look.exposure} min={0.5} max={2} step={0.05} format={(v) => `${Math.round(v * 100)}%`} info="Brightens or darkens the devices. Screens and the backdrop keep their own colours" onChange={(v, phase) => change(setLook(scene, { exposure: v }), phase, 'exposure')} />
        <SliderRow label="Shadow" value={look.shadow} min={0} max={1} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onChange={(v, phase) => change(setLook(scene, { shadow: v }), phase, 'shadow')} />
      </Section>
      <Section title="Camera">
        <label className={cn('flex items-center gap-2 text-xs', !hasPostEffects && 'opacity-50')}>
          <span className="font-medium">Depth of field</span>
          <Info text="Blurs what's in front of and behind the focus, the way a real lens does. Each shot sets its own blur and focus" />
          <Switch className="ml-auto" checked={look.depthOfField && hasPostEffects} disabled={!hasPostEffects} onCheckedChange={(on) => { props.onCommit(setLook(scene, { depthOfField: on })); props.onSeal(); }} aria-label="Depth of field" />
        </label>
        {!hasPostEffects && <p className="text-[11px] text-muted-foreground">This browser can't draw blur, vignette or grain</p>}
        <SliderRow label="Handheld" value={scene.camera.shake} min={0} max={1} step={0.05} format={(v) => (v === 0 ? 'Off' : `${Math.round(v * 100)}%`)} info="A gentle wobble, as if someone holds the camera" onChange={(v, phase) => change(setShake(scene, v), phase, 'shake')} />
        <SliderRow label="Vignette" value={look.vignette} min={0} max={1} step={0.05} disabled={!hasPostEffects} format={(v) => (v === 0 ? 'Off' : `${Math.round(v * 100)}%`)} onChange={(v, phase) => change(setLook(scene, { vignette: v }), phase, 'vignette')} />
        <SliderRow label="Film grain" value={look.grain} min={0} max={1} step={0.05} disabled={!hasPostEffects} format={(v) => (v === 0 ? 'Off' : `${Math.round(v * 100)}%`)} onChange={(v, phase) => change(setLook(scene, { grain: v }), phase, 'grain')} />
      </Section>
    </>
  );
}

// ---------------------------------------------------------------------------
// A shot
// ---------------------------------------------------------------------------

function ShotInspector(props: InspectorProps & { shotId: string }) {
  const { scene, shotId, hasPostEffects } = props;
  const change = useChange(props);
  const [keepSize, setKeepSize] = useState(true);
  const index = scene.camera.shots.findIndex((shot) => shot.id === shotId);
  const shot = scene.camera.shots[index];
  if (!shot) return null;
  const camera = shot.camera;
  const last = index === scene.camera.shots.length - 1;
  const aspect = scene.format.width / scene.format.height;
  const setCamera = (patch: Partial<CameraState>, phase: ChangePhase, merge: string) =>
    change(updateShot(scene, shot.id, { camera: { ...camera, ...patch, target: patch.target ?? camera.target } }), phase, `${merge}:${shot.id}`);
  const setLens = (lens: number, phase: ChangePhase) =>
    change(updateShot(scene, shot.id, { camera: keepSize ? dollyZoomTo(camera, lens, aspect) : { ...camera, lens } }), phase, `lens:${shot.id}`);
  const dof = scene.look.depthOfField && hasPostEffects;
  return (
    <>
      <Section
        title={`Shot ${index + 1} at ${formatSeconds(shot.time)}`}
        action={
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-7 w-7 text-muted-foreground hover:text-destructive"
            disabled={scene.camera.shots.length <= 1}
            title={scene.camera.shots.length <= 1 ? 'A scene keeps at least one shot' : 'Delete this shot'}
            aria-label="Delete this shot"
            onClick={() => {
              props.onCommit(removeShot(scene, shot.id));
              props.onSeal();
              props.onSelect({ kind: 'scene' });
            }}
          >
            <Trash2Icon className="h-3.5 w-3.5" />
          </Button>
        }
      >
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-8 w-full gap-1.5"
          onClick={() => {
            const view = props.viewCamera();
            if (!view) return;
            props.onCommit(updateShot(scene, shot.id, { camera: view }));
            props.onSeal();
          }}
          title="Puts this shot's camera where the stage's camera is now"
        >
          <VideoIcon className="h-3.5 w-3.5" />
          Use the view on the stage
        </Button>
        {last ? (
          <p className="text-xs text-muted-foreground">The last shot. The camera stays here until the video ends.</p>
        ) : (
          <Choices label="How the camera moves to the next shot" value={shot.ease} options={EASE_OPTIONS} onChange={(ease) => { props.onCommit(updateShot(scene, shot.id, { ease })); props.onSeal(); }} />
        )}
      </Section>
      <Section title="Lens">
        <SliderRow label="Lens" value={camera.lens} min={LENS_MIN} max={200} format={(v) => `${Math.round(v)} mm`} info="Small numbers see wide and bend the view; big numbers look flat, like product photos" onChange={setLens} />
        <div className="flex gap-1">
          {[24, 35, 50, 85, 135].map((lens) => (
            <Button key={lens} type="button" size="sm" variant={Math.round(camera.lens) === lens ? 'secondary' : 'ghost'} className="h-7 flex-1 px-0 text-[11px]" onClick={() => setLens(lens, 'done')}>
              {lens}
            </Button>
          ))}
        </div>
        <label className="flex items-center gap-2 text-xs">
          <span>Keep the size when the lens changes</span>
          <Info text="Moves the camera closer or further as the lens changes, so the device stays the same size and only the look of the space around it changes" />
          <Switch className="ml-auto" checked={keepSize} onCheckedChange={setKeepSize} aria-label="Keep the size when the lens changes" />
        </label>
        <SliderRow label="Blur" value={camera.aperture} min={1.4} max={16} step={0.1} disabled={!dof} format={(v) => `f/${v.toFixed(1)}`} info={dof ? 'Smaller numbers blur what is out of focus more' : 'Turn on depth of field for the scene first'} onChange={(v, phase) => setCamera({ aperture: v }, phase, 'aperture')} />
        <SliderRow label="Focus" value={camera.focus} min={-30} max={30} step={0.5} disabled={!dof} format={(v) => (v === 0 ? 'On target' : `${v > 0 ? '+' : ''}${v} cm`)} info="Where the picture is sharpest: on what the camera looks at, or in front of it or behind it" onChange={(v, phase) => setCamera({ focus: v }, phase, 'focus')} />
      </Section>
      <Section title="Where the camera is">
        <SliderRow label="Around" value={camera.azimuth} min={camera.azimuth - 180} max={camera.azimuth + 180} format={(v) => `${Math.round(v)}°`} info="Swings the camera round what it looks at" onChange={(v, phase) => setCamera({ azimuth: v }, phase, 'azimuth')} />
        <SliderRow label="Height" value={camera.elevation} min={-60} max={85} format={(v) => `${Math.round(v)}°`} onChange={(v, phase) => setCamera({ elevation: v }, phase, 'elevation')} />
        <SliderRow label="Distance" value={camera.distance} min={5} max={300} step={0.5} format={(v) => `${Math.round(v)} cm`} onChange={(v, phase) => setCamera({ distance: v }, phase, 'distance')} />
        <SliderRow label="Tilt" value={camera.roll} min={-45} max={45} step={0.5} format={(v) => `${Math.round(v)}°`} onChange={(v, phase) => setCamera({ roll: v }, phase, 'roll')} />
        <div className="space-y-1.5">
          <div className="text-xs font-medium">Looks at</div>
          <Select
            value=""
            onValueChange={(actorId) => {
              props.onCommit(updateShot(scene, shot.id, { camera: cameraOnActor(scene, actorId, shot.time, camera) }));
              props.onSeal();
            }}
          >
            <SelectTrigger className="h-8 text-xs" aria-label="Point the camera at">
              <SelectValue placeholder="Point the camera at..." />
            </SelectTrigger>
            <SelectContent>
              {scene.actors.map((actor) => (
                <SelectItem key={actor.id} value={actor.id} className="text-xs">
                  {actor.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </Section>
    </>
  );
}

// ---------------------------------------------------------------------------
// Things on the stage
// ---------------------------------------------------------------------------

function PlaceSection(props: InspectorProps & { actor: LimelightActor }) {
  const { scene, actor, time } = props;
  const change = useChange(props);
  const now = useSettledTime(time);
  const still = actorAt({ ...actor, motion: { float: 0, spin: 0 } }, now);
  const animated = actor.poses.length > 1;
  const set = (values: Parameters<typeof setPoseAt>[3], phase: ChangePhase, merge: string) =>
    change(setPoseAt(scene, actor.id, time.get(), values).scene, phase, `${merge}:${actor.id}:${Math.round(time.get() * 30)}`);
  const position = still.position;
  return (
    <Section
      title={animated ? `Place at ${formatSeconds(now)}` : 'Place'}
      action={
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 gap-1 px-2 text-xs"
          title={animated ? 'Adds a pose at the playhead' : 'Keeps this place as the start and adds a pose at the playhead, so you can move it from here'}
          onClick={() => {
            const result = setPoseAt(scene, actor.id, time.get(), {}, true);
            props.onCommit(result.scene);
            props.onSeal();
            if (result.poseId) props.onSelect({ kind: 'pose', actorId: actor.id, id: result.poseId });
          }}
        >
          <PlusIcon className="h-3 w-3" />
          {animated ? 'Pose here' : 'Animate from here'}
        </Button>
      }
    >
      {!animated && <p className="text-[11px] text-muted-foreground">Stays in one place. Add a pose to move it over time</p>}
      <SliderRow label="Left and right" value={position.x} min={-80} max={80} step={0.1} format={(v) => `${v.toFixed(1)} cm`} onChange={(v, phase) => set({ position: { ...position, x: v } }, phase, 'x')} />
      <SliderRow label="Up and down" value={position.y} min={0} max={80} step={0.1} format={(v) => `${v.toFixed(1)} cm`} onChange={(v, phase) => set({ position: { ...position, y: v } }, phase, 'y')} />
      <SliderRow label="Near and far" value={position.z} min={-80} max={80} step={0.1} format={(v) => `${v.toFixed(1)} cm`} onChange={(v, phase) => set({ position: { ...position, z: v } }, phase, 'z')} />
      <SliderRow label="Turn" value={still.turn.yaw} min={-180} max={180} format={(v) => `${Math.round(v)}°`} onChange={(v, phase) => set({ turn: { ...still.turn, yaw: v } }, phase, 'yaw')} />
      <SliderRow label="Tip" value={still.turn.pitch} min={-90} max={90} format={(v) => `${Math.round(v)}°`} onChange={(v, phase) => set({ turn: { ...still.turn, pitch: v } }, phase, 'pitch')} />
      <SliderRow label="Lean" value={still.turn.roll} min={-180} max={180} format={(v) => `${Math.round(v)}°`} onChange={(v, phase) => set({ turn: { ...still.turn, roll: v } }, phase, 'roll')} />
      <SliderRow label="Size" value={still.scale} min={0} max={3} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v, phase) => set({ scale: v }, phase, 'scale')} />
      {actor.kind === 'text' && (
        <SliderRow label="Opacity" value={still.opacity} min={0} max={1} step={0.01} format={(v) => `${Math.round(v * 100)}%`} onChange={(v, phase) => set({ opacity: v }, phase, 'opacity')} />
      )}
    </Section>
  );
}

function MotionSection(props: InspectorProps & { actor: LimelightActor }) {
  const { scene, actor } = props;
  const change = useChange(props);
  return (
    <Section title="Always moving">
      <SliderRow label="Float" value={actor.motion.float} min={0} max={4} step={0.1} format={(v) => (v === 0 ? 'Off' : `${v.toFixed(1)} cm`)} info="Drifts gently up and down, with a slight sway" onChange={(v, phase) => change(setMotion(scene, actor.id, { float: v }), phase, `float:${actor.id}`)} />
      <SliderRow label="Spin" value={actor.motion.spin} min={-90} max={90} step={1} format={(v) => (v === 0 ? 'Off' : `${Math.round(v)}° a second`)} info="Turns round on the spot, like a turntable" onChange={(v, phase) => change(setMotion(scene, actor.id, { spin: v }), phase, `spin:${actor.id}`)} />
    </Section>
  );
}

function PoseSection(props: InspectorProps & { actor: LimelightActor; poseId: string }) {
  const { scene, actor, poseId } = props;
  const index = actor.poses.findIndex((pose) => pose.id === poseId);
  const pose = actor.poses[index];
  if (!pose) return null;
  const last = index === actor.poses.length - 1;
  return (
    <Section
      title={`Pose ${index + 1} at ${formatSeconds(pose.time)}`}
      action={
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-7 w-7 text-muted-foreground hover:text-destructive"
          disabled={actor.poses.length <= 1}
          aria-label="Delete this pose"
          title={actor.poses.length <= 1 ? 'Everything keeps at least one pose' : 'Delete this pose'}
          onClick={() => {
            props.onCommit(removePose(scene, actor.id, pose.id));
            props.onSeal();
            props.onSelect({ kind: 'actor', id: actor.id });
          }}
        >
          <Trash2Icon className="h-3.5 w-3.5" />
        </Button>
      }
    >
      {last ? (
        <p className="text-xs text-muted-foreground">The last pose. It stays here until the video ends.</p>
      ) : (
        <Choices label="How it moves to the next pose" value={pose.ease} options={EASE_OPTIONS} onChange={(ease) => { props.onCommit(updatePose(scene, actor.id, pose.id, { ease })); props.onSeal(); }} />
      )}
    </Section>
  );
}

function ActorHeader(props: InspectorProps & { actor: LimelightActor }) {
  const { scene, actor } = props;
  const [name, setName] = useState(actor.name);
  useEffect(() => setName(actor.name), [actor.name]);
  return (
    <Section
      title={actor.kind === 'device' ? 'Device' : actor.kind === 'picture' ? 'Picture' : 'Title'}
      action={
        <div className="flex gap-0.5">
          <Button type="button" size="icon" variant="ghost" className="h-7 w-7" aria-label={actor.hidden ? 'Show' : 'Hide'} title={actor.hidden ? 'Show' : 'Hide'} onClick={() => { props.onCommit(updateActor(scene, actor.id, { hidden: actor.hidden ? undefined : true })); props.onSeal(); }}>
            {actor.hidden ? <EyeOffIcon className="h-3.5 w-3.5" /> : <EyeIcon className="h-3.5 w-3.5" />}
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            aria-label="Make a copy"
            title="Make a copy"
            onClick={() => {
              const result = duplicateActor(scene, actor.id);
              if (!result.actorId) return;
              props.onCommit(result.scene);
              props.onSeal();
              props.onSelect({ kind: 'actor', id: result.actorId });
            }}
          >
            <CopyIcon className="h-3.5 w-3.5" />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-7 w-7 text-muted-foreground hover:text-destructive"
            aria-label="Delete"
            title="Delete"
            onClick={() => {
              props.onCommit(removeActor(scene, actor.id));
              props.onSeal();
              props.onSelect({ kind: 'scene' });
            }}
          >
            <Trash2Icon className="h-3.5 w-3.5" />
          </Button>
        </div>
      }
    >
      <Input
        value={name}
        aria-label="Name"
        className="h-8 text-xs"
        onChange={(event) => setName(event.target.value)}
        onBlur={() => {
          const next = name.trim().slice(0, 80);
          if (next && next !== actor.name) {
            props.onCommit(updateActor(scene, actor.id, { name: next }));
            props.onSeal();
          } else setName(actor.name);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
        }}
      />
    </Section>
  );
}

function DeviceInspector(props: InspectorProps & { actor: DeviceActor }) {
  const { scene, actor, time } = props;
  const change = useChange(props);
  const fileRef = useRef<HTMLInputElement>(null);
  const [adding, setAdding] = useState(false);
  const { toast } = useToast();
  const model = stageModelFor(actor.device);
  const devices = useMemo(() => stageDevices(), []);
  const groups = ['iPhone', 'Android', 'Tablets'] as const;
  const custom = actor.color ?? null;
  const add = async (source: { files: File[] } | { shots: ProjectShot[] }) => {
    setAdding(true);
    try {
      await props.onAddPictures(actor.id, source);
    } finally {
      setAdding(false);
    }
  };
  return (
    <>
      <ActorHeader {...props} actor={actor} />
      <Section title="Model">
        <Select
          value={actor.device}
          onValueChange={(device) => {
            const nextModel = stageModelFor(device as DeviceActor['device']);
            // Keeps the bottom where it was, so a taller device doesn't sink into the floor.
            const lift = (deviceHeight(device as DeviceActor['device']) - deviceHeight(actor.device)) / 2;
            const poses = actor.poses.map((pose) => ({ ...pose, position: { ...pose.position, y: pose.position.y + lift * pose.scale } }));
            const renamed = actor.name === model?.label ? nextModel?.label ?? actor.name : actor.name;
            const next = updateActor(scene, actor.id, { device: device as DeviceActor['device'], finish: nextModel?.defaultFinish, color: undefined, name: renamed, fold: undefined });
            props.onCommit({ ...next, actors: next.actors.map((a) => (a.id === actor.id ? ({ ...a, poses } as LimelightActor) : a)) });
            props.onSeal();
            // A tablet or an opened foldable is far bigger than a phone: offer to frame it again.
            const ratio = deviceHeight(device as DeviceActor['device']) / deviceHeight(actor.device);
            if ((ratio > 1.25 || ratio < 0.8 || !!nextModel?.fold !== !!model?.fold) && nextModel) {
              toast({
                title: `Now ${nextModel.label}`,
                description: ratio > 1 || nextModel.fold ? 'It may not fit the shot. Fit moves the camera back to see all of it.' : 'Fit moves the camera in to fill the shot again.',
                action: (
                  <ToastAction altText="Fit everything in the shot" onClick={props.onFitAll}>
                    Fit
                  </ToastAction>
                ),
              });
            }
          }}
        >
          <SelectTrigger className="h-8 text-xs" aria-label="Model">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="max-h-80">
            {groups.map((group) => (
              <SelectGroup key={group}>
                <SelectLabel className="text-[11px]">{group}</SelectLabel>
                {devices
                  .filter((option) => option.group === group)
                  .map((option) => (
                    <SelectItem key={option.device} value={option.device} className="text-xs">
                      {option.label}
                    </SelectItem>
                  ))}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
        {model && (
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Finish">
            {model.finishes.map((finish) => (
              <button
                key={finish.id}
                type="button"
                role="radio"
                aria-checked={!custom && (actor.finish ?? model.defaultFinish) === finish.id}
                title={finish.label}
                aria-label={finish.label}
                className={cn('h-6 w-6 rounded-full border-2 transition-transform hover:scale-110', !custom && (actor.finish ?? model.defaultFinish) === finish.id ? 'border-primary' : 'border-transparent ring-1 ring-border')}
                style={{ background: `linear-gradient(135deg, ${finish.frame}, ${finish.back})` }}
                onClick={() => {
                  props.onCommit(updateActor(scene, actor.id, { finish: finish.id, color: undefined }));
                  props.onSeal();
                }}
              />
            ))}
          </div>
        )}
        <ColorWell label="Your own colour" value={custom ?? '#3a3a3c'} onChange={(v, phase) => change(updateActor(scene, actor.id, { color: v }), phase, `color:${actor.id}`)} />
      </Section>
      <Section title="Screen">
        <Choices
          value={actor.fit}
          columns={2}
          options={[
            { value: 'cover', label: 'Fill the screen', hint: 'Crops the picture to the screen' },
            { value: 'contain', label: 'Whole picture', hint: 'Shows all of it, with bars if the shape differs' },
          ]}
          onChange={(fit) => {
            props.onCommit(updateActor(scene, actor.id, { fit }));
            props.onSeal();
          }}
        />
        <SliderRow label="Glass reflection" value={actor.glare} min={0} max={1} step={0.05} format={(v) => `${Math.round(v * 100)}%`} onChange={(v, phase) => change(updateActor(scene, actor.id, { glare: v }), phase, `glare:${actor.id}`)} />
        {model?.fold && (
          <SliderRow label="Open" value={actor.fold ?? model.fold.opening} min={0} max={180} format={(v) => `${Math.round(v)}°`} info="0 is closed, 180 is open flat" onChange={(v, phase) => change(updateActor(scene, actor.id, { fold: v }), phase, `fold:${actor.id}`)} />
        )}
        <div className="space-y-2" data-testid="limelight-pictures">
          <div className="flex items-center gap-1.5 text-xs font-medium">
            Pictures
            <Info text="What the screen shows, and from when. Add more and the screen changes from one to the next, the way your app moves between screens" />
          </div>
          {actor.screens.length === 0 && <p className="text-[11px] text-muted-foreground">The screen is off. Add a screenshot of your app</p>}
          {actor.screens.map((screen, index) => (
            <div key={screen.id} className={cn('flex items-center gap-2 rounded-md border p-1.5', props.selection.kind === 'screen' && props.selection.id === screen.id && 'border-primary')}>
              <button type="button" className="shrink-0" onClick={() => { props.onSelect({ kind: 'screen', actorId: actor.id, id: screen.id }); props.onSeek(screen.time); }} aria-label={`Picture ${index + 1}`}>
                <PictureThumb id={screen.media} className="h-12 w-6" />
              </button>
              <div className="min-w-0 flex-1 space-y-1">
                <div className="text-[11px] text-muted-foreground">From {formatSeconds(screen.time)}</div>
                {index > 0 && (
                  <Select
                    value={screen.transition}
                    onValueChange={(transition) => {
                      props.onCommit(setScreens(scene, actor.id, actor.screens.map((s) => (s.id === screen.id ? { ...s, transition: transition as ScreenTransition } : s))));
                      props.onSeal();
                    }}
                  >
                    <SelectTrigger className="h-7 text-[11px]" aria-label="How the picture comes in">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {TRANSITIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value} className="text-xs">
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </div>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
                aria-label={`Take picture ${index + 1} off the screen`}
                title="Take this picture off the screen"
                onClick={() => {
                  props.onCommit(setScreens(scene, actor.id, actor.screens.filter((s) => s.id !== screen.id)));
                  props.onSeal();
                }}
              >
                <Trash2Icon className="h-3.5 w-3.5" />
              </Button>
            </div>
          ))}
          <div className="flex gap-2">
            <ProjectPicker shots={props.projectShots} onPick={(shots) => add({ shots })} />
            <Button type="button" size="sm" variant="outline" className="h-8 flex-1 gap-1.5" disabled={adding} onClick={() => fileRef.current?.click()}>
              {adding ? <Loader2Icon className="h-3.5 w-3.5 animate-spin" /> : <ImagePlusIcon className="h-3.5 w-3.5" />}
              Upload
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(event) => {
                const files = Array.from(event.target.files ?? []);
                event.target.value = '';
                if (files.length > 0) void add({ files });
              }}
            />
          </div>
          <p className="text-[11px] text-muted-foreground">New pictures start at the playhead, now {formatSeconds(time.get())}</p>
        </div>
      </Section>
      {props.selection.kind === 'pose' && <PoseSection {...props} actor={actor} poseId={props.selection.id} />}
      <PlaceSection {...props} actor={actor} />
      <MotionSection {...props} actor={actor} />
    </>
  );
}

function TextInspector(props: InspectorProps & { actor: TextActor }) {
  const { scene, actor } = props;
  const change = useChange(props);
  const [text, setText] = useState(actor.text);
  useEffect(() => setText(actor.text), [actor.text]);
  return (
    <>
      <ActorHeader {...props} actor={actor} />
      <Section title="Words">
        <Textarea
          value={text}
          aria-label="Words"
          className="min-h-16 font-sans text-sm"
          onChange={(event) => {
            setText(event.target.value);
            props.onCommit(updateActor(scene, actor.id, { text: event.target.value.slice(0, 200) }), `text:${actor.id}`);
          }}
          onBlur={() => props.onSeal()}
        />
        <div className="space-y-1.5">
          <div className="text-xs font-medium">Font</div>
          <Select value={actor.font} onValueChange={(font) => { props.onCommit(updateActor(scene, actor.id, { font })); props.onSeal(); }}>
            <SelectTrigger className="h-8 text-xs" aria-label="Font">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(FONTS.includes(actor.font) ? FONTS : [actor.font, ...FONTS]).map((font) => (
                <SelectItem key={font} value={font} className="text-xs" style={{ fontFamily: font }}>
                  {font}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Choices
          value={String(actor.weight) as '400' | '600' | '700' | '800'}
          options={[
            { value: '400', label: 'Regular' },
            { value: '600', label: 'Semibold' },
            { value: '700', label: 'Bold' },
            { value: '800', label: 'Heavy' },
          ]}
          columns={4}
          onChange={(weight) => { props.onCommit(updateActor(scene, actor.id, { weight: Number(weight) })); props.onSeal(); }}
        />
        <SliderRow label="Letter height" value={actor.size} min={0.3} max={12} step={0.1} format={(v) => `${v.toFixed(1)} cm`} onChange={(v, phase) => change(updateActor(scene, actor.id, { size: v }), phase, `size:${actor.id}`)} />
        <ColorWell label="Colour" value={actor.color} onChange={(v, phase) => change(updateActor(scene, actor.id, { color: v }), phase, `textcolor:${actor.id}`)} />
        <SliderRow
          label="Last words in another colour"
          value={actor.highlight?.words ?? 0}
          min={0}
          max={Math.max(1, Math.min(12, actor.text.split(/\s+/).filter(Boolean).length))}
          step={1}
          format={(v) => (v === 0 ? 'None' : `${v}`)}
          onChange={(v, phase) =>
            change(updateActor(scene, actor.id, { highlight: v > 0 ? { color: actor.highlight?.color ?? '#7c9cff', words: Math.round(v) } : undefined }), phase, `highlight:${actor.id}`)
          }
        />
        {actor.highlight && (
          <ColorWell
            label="Their colour"
            value={actor.highlight.color}
            onChange={(v, phase) => change(updateActor(scene, actor.id, { highlight: { words: actor.highlight?.words ?? 1, color: v } }), phase, `highlightcolor:${actor.id}`)}
          />
        )}
        <Choices
          value={actor.align}
          options={[
            { value: 'left', label: 'Left' },
            { value: 'center', label: 'Centre' },
            { value: 'right', label: 'Right' },
          ]}
          onChange={(align) => { props.onCommit(updateActor(scene, actor.id, { align })); props.onSeal(); }}
        />
        <label className="flex items-center gap-2 text-xs">
          <span className="font-medium">Always face the camera</span>
          <Switch className="ml-auto" checked={actor.facing === 'camera'} onCheckedChange={(on) => { props.onCommit(updateActor(scene, actor.id, { facing: on ? 'camera' : 'pose' })); props.onSeal(); }} aria-label="Always face the camera" />
        </label>
      </Section>
      <RevealSection {...props} actor={actor} />
      {props.selection.kind === 'pose' && <PoseSection {...props} actor={actor} poseId={props.selection.id} />}
      <PlaceSection {...props} actor={actor} />
      <MotionSection {...props} actor={actor} />
    </>
  );
}

/** A picture standing on its own: the app's icon, or a card lifted off a screen. */
function PictureInspector(props: InspectorProps & { actor: PictureActor }) {
  const { scene, actor } = props;
  const change = useChange(props);
  const aspect = actor.width / actor.height;
  return (
    <>
      <ActorHeader {...props} actor={actor} />
      <Section title="Card">
        <PictureThumb id={actor.media} className="mx-auto h-24 w-auto max-w-full rounded-md border object-contain" />
        <SliderRow
          label="Width"
          value={actor.width}
          min={1}
          max={40}
          step={0.1}
          format={(v) => `${v.toFixed(1)} cm`}
          onChange={(v, phase) => change(updateActor(scene, actor.id, { width: v, height: v / aspect }), phase, `card-width:${actor.id}`)}
        />
        <SliderRow
          label="Corners"
          value={actor.corner}
          min={0}
          max={0.5}
          step={0.005}
          format={(v) => `${Math.round(v * 200)}%`}
          onChange={(v, phase) => change(updateActor(scene, actor.id, { corner: v }), phase, `card-corner:${actor.id}`)}
        />
        <SliderRow
          label="Thickness"
          value={actor.depth}
          min={0}
          max={4}
          step={0.05}
          format={(v) => (v === 0 ? 'Flat' : `${v.toFixed(2)} cm`)}
          onChange={(v, phase) => change(updateActor(scene, actor.id, { depth: v }), phase, `card-depth:${actor.id}`)}
        />
        <SliderRow
          label="Shine"
          value={actor.glare}
          min={0}
          max={1}
          step={0.01}
          format={(v) => `${Math.round(v * 100)}%`}
          onChange={(v, phase) => change(updateActor(scene, actor.id, { glare: v }), phase, `card-glare:${actor.id}`)}
        />
      </Section>
      {props.selection.kind === 'pose' && <PoseSection {...props} actor={actor} poseId={props.selection.id} />}
      <PlaceSection {...props} actor={actor} />
      <MotionSection {...props} actor={actor} />
    </>
  );
}

/** How a title's words come in: all at once, or one after another from a moment of the video. */
function RevealSection(props: InspectorProps & { actor: TextActor }) {
  const { scene, actor } = props;
  const change = useChange(props);
  const reveal = actor.reveal;
  const set = (next: TextReveal | undefined) => {
    props.onCommit(updateActor(scene, actor.id, { reveal: next }));
    props.onSeal();
  };
  return (
    <Section title="Words come in" action={<Info text="Rise: each word comes up from behind its line. Fade: each one fades in. Pop: each one grows in. They start at the playhead when you pick one." />}>
      <Choices<TextRevealStyle | 'none'>
        value={reveal?.style ?? 'none'}
        options={[
          { value: 'none', label: 'At once' },
          { value: 'rise', label: 'Rise' },
          { value: 'fade', label: 'Fade' },
          { value: 'pop', label: 'Pop' },
        ]}
        columns={4}
        onChange={(style) =>
          set(style === 'none' ? undefined : { style, by: reveal?.by ?? 'word', time: reveal?.time ?? props.time.get(), duration: reveal?.duration ?? 0.8 })
        }
      />
      {reveal && (
        <>
          <Choices
            value={reveal.by}
            options={[
              { value: 'word', label: 'Word by word' },
              { value: 'letter', label: 'Letter by letter' },
            ]}
            columns={2}
            onChange={(by) => set({ ...reveal, by })}
          />
          <SliderRow
            label="Starts at"
            value={reveal.time}
            min={0}
            max={scene.format.duration}
            step={0.05}
            format={(v) => formatSeconds(v)}
            onChange={(v, phase) => change(updateActor(scene, actor.id, { reveal: { ...reveal, time: v } }), phase, `reveal-time:${actor.id}`)}
          />
          <SliderRow
            label="Takes"
            value={reveal.duration}
            min={0.1}
            max={4}
            step={0.05}
            format={(v) => `${v.toFixed(1)} s`}
            onChange={(v, phase) => change(updateActor(scene, actor.id, { reveal: { ...reveal, duration: v } }), phase, `reveal-length:${actor.id}`)}
          />
        </>
      )}
    </Section>
  );
}

export function LimelightInspector(props: InspectorProps) {
  const { scene, selection } = props;
  let body: React.ReactNode;
  if (selection.kind === 'shot') body = <ShotInspector {...props} shotId={selection.id} />;
  else if (selection.kind === 'scene') body = <SceneInspector {...props} />;
  else {
    const actorId = 'actorId' in selection ? selection.actorId : selection.id;
    const actor = scene.actors.find((a) => a.id === actorId);
    if (!actor) body = <SceneInspector {...props} />;
    else if (actor.kind === 'device') body = <DeviceInspector {...props} actor={actor} />;
    else if (actor.kind === 'picture') body = <PictureInspector {...props} actor={actor} />;
    else body = <TextInspector {...props} actor={actor} />;
  }
  return (
    <aside className="flex w-72 shrink-0 flex-col border-l bg-background" aria-label="Properties" data-testid="limelight-inspector">
      <div className="min-h-0 flex-1 overflow-y-auto">{body}</div>
    </aside>
  );
}
