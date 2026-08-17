"use client";

import type React from 'react';
import { useEffect, useState, useRef } from 'react';
import type { ArtboardElement, TextElementProps, ShapeElementProps, DeviceFrameElementProps, ImageElementProps, DeviceType, DeviceStyleType, ArtboardState, VideoElementProps, VideoDeviceElementProps, GestureElementProps, GestureType, ElementAnimation, ElementAnimationPreset, ElementLocaleOverride, Point, Size } from '@/types/artboard';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { UploadCloudIcon, PaintbrushIcon, Palette, Plus, Minus, Bold, Italic, Underline, Strikethrough, AlignLeft, AlignCenter, AlignRight, ClapperboardIcon, Trash2Icon, Languages, CheckIcon, CopyIcon, RotateCcw, LinkIcon, UnlinkIcon, MoreHorizontalIcon } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { saveMedia } from '@/lib/mediaStore';
import { DEFAULT_GRADIENT, normalizeGradient } from '@/lib/artboardBackground';
import { fitTextBox } from '@/lib/textFit';
import { VIDEO_ACCEPT } from './elements/VideoElement';
import { useToast } from '@/hooks/use-toast';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { cn } from '@/lib/utils';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SelectGroup,
  SelectLabel
} from "@/components/ui/select";
import { FontFamilySelect } from './FontFamilySelect';
import { isTranslationEnabled } from '@/services/translation';
import { DEVICE_PICKER_GROUPS } from '@/lib/deviceRegistry';
import { trackScreenshotUploaded } from '@/lib/analytics';
import { DEFAULT_BASE_LOCALE, localeLabel, localeName } from '@/lib/i18n/locales';
import type { DetachableKey } from '@/lib/i18n/project';

// Panel headings. Derived names read badly for the compound types
// ("Video-device Properties"), so the user-facing ones are spelled out.
const ELEMENT_PANEL_TITLES: Partial<Record<ArtboardElement['type'], string>> = {
  'video-device': 'Recording Mockup',
  video: 'Recording Properties',
  gesture: 'Gesture Hint',
};

/**
 * Scale slider with 1% steppers and a top-left / center anchor.
 *
 * Committing is expensive: `handleArtboardsUpdate` deep-copies every artboard
 * twice (undo history, then a whole-project Dexie write) and re-renders the
 * studio, so one commit per slider tick pegs the main thread for the length of
 * a drag (measured: 5.0s of blocked main thread over a 40-step drag, against
 * 0.5s committing once). So the drag stays local, driving only the label and
 * the slider itself, and the element is resized when the pointer is released.
 * The steppers commit straight away: one discrete change is cheap.
 *
 * Anchor: scale multiplies the element box, which keeps the top-left pinned and
 * grows down and right. `center` compensates by moving the position half the
 * size delta, so the element grows evenly around its middle instead.
 */
const SCALE_MIN = 10;
const SCALE_MAX = 500;

type ScaleAnchor = 'top-left' | 'center';

const ScaleField: React.FC<{
  id: string;
  /** Drops a half-finished drag when the selection moves to another layer. */
  elementId: string;
  scale: number | undefined;
  size: Size;
  position: Point;
  onCommit: (updates: { scale: number; position?: Point }) => void;
}> = ({ id, elementId, scale, size, position, onCommit }) => {
  const committed = Math.round((scale ?? 1) * 100);
  // Non-null only while the user is dragging this slider.
  const [draft, setDraft] = useState<number | null>(null);
  const [anchor, setAnchor] = useState<ScaleAnchor>('top-left');
  const percent = draft ?? committed;

  useEffect(() => { setDraft(null); }, [elementId]);

  const commit = (nextPercent: number) => {
    const nextScale = nextPercent / 100;
    if (anchor === 'top-left') {
      onCommit({ scale: nextScale });
      return;
    }
    const delta = (scale ?? 1) - nextScale;
    onCommit({
      scale: nextScale,
      position: { x: position.x + (size.width * delta) / 2, y: position.y + (size.height * delta) / 2 },
    });
  };

  const step = (delta: number) => {
    const next = Math.min(SCALE_MAX, Math.max(SCALE_MIN, percent + delta));
    if (next === percent) return;
    setDraft(null);
    commit(next);
  };

  return (
    <>
      <div className="flex items-center justify-between gap-1">
        <Label htmlFor={id} className="text-xs">Scale: {percent}%</Label>
        <div className="flex items-center gap-0.5">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-5 w-5"
            onClick={() => step(-1)}
            disabled={percent <= SCALE_MIN}
            title="Scale down 1%"
            aria-label="Scale down 1 percent"
          >
            <Minus className="h-3 w-3" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-5 w-5"
            onClick={() => step(1)}
            disabled={percent >= SCALE_MAX}
            title="Scale up 1%"
            aria-label="Scale up 1 percent"
          >
            <Plus className="h-3 w-3" />
          </Button>
        </div>
      </div>
      <Slider
        id={id}
        min={SCALE_MIN}
        max={SCALE_MAX}
        step={1}
        value={[percent]}
        onValueChange={(value) => setDraft(value[0])}
        onValueCommit={(value) => {
          setDraft(null);
          commit(value[0]);
        }}
        className="my-2"
      />
      <div className="flex items-center gap-1">
        <span className="text-[10px] text-muted-foreground">Grow from</span>
        <div className="flex rounded-md border p-0.5">
          {(['top-left', 'center'] as ScaleAnchor[]).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setAnchor(option)}
              aria-pressed={anchor === option}
              title={option === 'center' ? 'Scale evenly around the center' : 'Keep the top left corner in place'}
              className={cn(
                'rounded px-1.5 py-0.5 text-[10px] leading-none transition-colors',
                anchor === option ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {option === 'center' ? 'Center' : 'Top left'}
            </button>
          ))}
        </div>
      </div>
    </>
  );
};

/**
 * The selected layer's id, at the top of the panel.
 *
 * Prefers the palette tile it came from (`libraryId`, the same id the tile shows
 * on hover and MCP's add_element accepts), so a designer can tell which library
 * item is on the board. Hand-built and template layers have no library id, so
 * those fall back to the element's own id, which is what the MCP tools address.
 */
const ElementIdRow: React.FC<{ element: ArtboardElement }> = ({ element }) => {
  const [copied, setCopied] = useState(false);
  const value = element.libraryId || element.id;
  const label = element.libraryId ? 'Library ID' : 'Element ID';

  // Clear the tick when the selection moves to another layer.
  useEffect(() => { setCopied(false); }, [value]);

  const copy = async () => {
    try {
      await navigator.clipboard?.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard blocked (insecure context or denied permission): the id is
      // still on screen and selectable, so there is nothing to report.
    }
  };

  return (
    <div className="mt-1 flex items-center gap-1.5">
      <span className="shrink-0 text-[10px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <code className="min-w-0 flex-1 truncate rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-foreground/80" title={value}>
        {value}
      </code>
      <Button
        variant="ghost"
        size="icon"
        className="h-5 w-5 shrink-0 text-muted-foreground hover:text-foreground"
        onClick={copy}
        title={copied ? 'Copied' : `Copy ${label.toLowerCase()}`}
        aria-label={copied ? 'Copied' : `Copy ${label.toLowerCase()}`}
      >
        {copied ? <CheckIcon className="h-3 w-3" /> : <CopyIcon className="h-3 w-3" />}
      </Button>
    </div>
  );
};

/**
 * The keys that are ALWAYS a language's own, because they are the language.
 * Mirrors ALWAYS_LOCAL_KEYS. Everything else that can differ is shared until
 * the user detaches it, which is a different control (see LocaleDetachToggle).
 */
type LocalizableField = 'content' | 'screenshotSrc' | 'imageSrc' | 'mediaId';

/**
 * Short tag for a locale chip: 'de-DE' reads DE, because the region repeats the
 * language and the chip has room for two characters. A script subtag is kept,
 * since it is the only thing telling 'zh-Hans' and 'zh-Hant' apart.
 */
function localeChipTag(code: string): string {
  const [primary, second] = code.split('-');
  return second && second.length === 4
    ? `${primary.toUpperCase()}-${second}`
    : primary.toUpperCase();
}

/**
 * Marks a row that can differ per language, while a translated language is on
 * screen. Filled means this language holds a value of its own; outline means
 * the row is still showing the base language and follows every base edit. The
 * reset button exists only when there is something to give back.
 */
const LocaleFieldChip: React.FC<{
  locale: string;
  baseLanguageName: string;
  overridden: boolean;
  onReset?: () => void;
}> = ({ locale, baseLanguageName, overridden, onReset }) => (
  <span className="inline-flex items-center gap-0.5">
    <span
      className={cn(
        'rounded border px-1 py-px text-[9px] font-medium uppercase leading-none tracking-wide',
        overridden
          ? 'border-primary bg-primary text-primary-foreground'
          : 'border-border text-muted-foreground'
      )}
      title={
        overridden
          ? `${localeLabel(locale)} has its own value here`
          : `Showing ${baseLanguageName}, shared with every language`
      }
    >
      {localeChipTag(locale)}
    </span>
    {overridden && onReset && (
      <Button
        variant="ghost"
        size="icon"
        className="h-4 w-4 shrink-0 text-muted-foreground hover:text-foreground"
        onClick={onReset}
        title={`Reset to ${baseLanguageName}`}
        aria-label={`Reset to ${baseLanguageName}`}
      >
        <RotateCcw className="h-3 w-3" />
      </Button>
    )}
  </span>
);

/**
 * One line under a group of properties no language can hold on its own, so a
 * translator is told before the edit rather than after it lands everywhere.
 */
const SharedLanguagesNote: React.FC<{ className?: string }> = ({ className }) => (
  <p className={cn('text-[10px] text-muted-foreground', className)}>Shared across all languages</p>
);

/**
 * What the geometry rows cover. Geometry is one decision, not three: a language
 * that needs its own box has to move and resize it on the canvas as well, and
 * those edits land on position and size rather than on the scale slider. Half
 * of it detached would move the element in every language the moment the user
 * dragged it, which is exactly the surprise the toggle exists to prevent.
 */
const GEOMETRY_KEYS: DetachableKey[] = ['position', 'size', 'scale'];

/**
 * The rest of the groups, for the same reason geometry is one: a toggle has to
 * cover every key its control can write, or the user detaches what the label
 * names and the next drag of the slider beside it still lands on every language.
 */

/** A gradient wins over the flat colour, so the fill is one decision. */
const SHAPE_FILL_KEYS: DetachableKey[] = ['fillColor', 'fillGradient'];

/** Uniform and per corner are two faces of the same control. */
const CORNER_RADIUS_KEYS: DetachableKey[] = [
  'borderRadiusType',
  'borderRadius',
  'borderRadiusTopLeft',
  'borderRadiusTopRight',
  'borderRadiusBottomRight',
  'borderRadiusBottomLeft',
];

/** The presets and the Reset Transform button write all five at once. */
const IMAGE_TRANSFORM_KEYS: DetachableKey[] = [
  'skewX',
  'skewY',
  'perspectiveX',
  'perspectiveY',
  'matrix3d',
];

/** The four screenshot sliders write one rect, and the fit frames the same image. */
const SCREENSHOT_PLACEMENT_KEYS: DetachableKey[] = ['screenshotRect', 'screenshotObjectFit'];

/** Custom Matrix3D only means anything while the perspective is set to custom. */
const DEVICE_PERSPECTIVE_KEYS: DetachableKey[] = ['styleType', 'matrix3d'];

/** Start and end are one trim. */
const TRIM_KEYS: DetachableKey[] = ['trimStart', 'trimEnd'];

/** Looping decides whether the trigger time means anything, so it goes with it. */
const GESTURE_TIMING_KEYS: DetachableKey[] = ['gestureRepeat', 'triggerTime', 'gestureDuration'];

/** One row of buttons, so one toggle: bold, italic and the two decorations. */
const TEXT_STYLE_KEYS: DetachableKey[] = ['fontWeight', 'fontStyle', 'textDecoration'];

/**
 * The BaseElement properties this panel has no field for. Geometry comes from
 * dragging on the canvas, and shadow and blur are written by the AI agent and
 * the MCP tools, so without this list there would be no way to say "the icon
 * sits on the other side in Arabic", which is the whole reason detaching stopped
 * being an allowlist.
 */
type BaseDetachGroupId = 'position' | 'size' | 'scale' | 'rotation' | 'opacity' | 'shadow' | 'blur';

const BASE_DETACH_GROUPS: { id: BaseDetachGroupId; label: string; keys: DetachableKey[] }[] = [
  // Split, not one "Position and size" row. Dragging in a translated language
  // detaches `position` on its own, so a combined row would claim the whole
  // group was shared while it was not, and there would be no way to hand back
  // just the position of one mockup without losing its size with it.
  { id: 'position', label: 'Position', keys: ['position'] },
  { id: 'size', label: 'Size', keys: ['size'] },
  { id: 'scale', label: 'Scale', keys: ['scale'] },
  { id: 'rotation', label: 'Rotation', keys: ['rotation'] },
  { id: 'opacity', label: 'Opacity', keys: ['opacity'] },
  { id: 'shadow', label: 'Shadow', keys: ['shadow'] },
  { id: 'blur', label: 'Blur', keys: ['blur'] },
];

/**
 * Type-specific properties with no field here either. Tracking is the one that
 * earns its row: the AI agent and the MCP tools set it, and spacing that suits
 * Latin is wrong for Arabic or Thai at the same size.
 */
const EXTRA_DETACH_GROUPS: Partial<
  Record<ArtboardElement['type'], { id: string; label: string; keys: DetachableKey[] }[]>
> = {
  text: [{ id: 'letterSpacing', label: 'Letter spacing', keys: ['letterSpacing'] }],
};

/**
 * Groups that already have a toggle sitting beside the control that edits them,
 * per element type. Anything listed here is left out of the catch-all section so
 * the same keys are not offered twice, two inches apart, in the same panel.
 */
const BASE_GROUPS_WITH_A_CONTROL: Record<ArtboardElement['type'], BaseDetachGroupId[]> = {
  text: [],
  shape: [],
  gesture: [],
  // Only `scale` is claimed by the Scale field. Position and size have no field
  // on any type (they come from dragging on the canvas), so they always come
  // from the catch-all section, which is what makes "hand back just the
  // position of this one mockup" reachable.
  device: ['scale', 'rotation'],
  'video-device': ['scale', 'rotation'],
  image: ['scale', 'opacity'],
  video: ['scale', 'opacity'],
};

/**
 * Reset, at the two scopes a single property toggle cannot reach.
 *
 * The per-property way back is the detach toggle itself: re-attaching drops the
 * stored value, so a second control for one property would be a second way to
 * do the same thing. What has no other route is "undo the whole afternoon",
 * which is what these are, and why both of the wide ones ask first: they throw
 * away translations the user may have paid for.
 */
const LocaleResetControls: React.FC<{
  languageName: string;
  baseLanguageName: string;
  /** The element reset only appears when there is something of its own to drop. */
  hasElementOverrides: boolean;
  onReset: (scope: 'element' | 'artboard' | 'project') => void;
}> = ({ languageName, baseLanguageName, hasElementOverrides, onReset }) => {
  const [pending, setPending] = useState<'artboard' | 'project' | null>(null);

  const confirmations = {
    artboard: {
      title: `Reset this artboard to ${baseLanguageName}?`,
      body: `Every element on this artboard gives up what it holds in ${languageName}, translated text included, and goes back to the shared design.`,
      action: 'Reset artboard',
    },
    project: {
      title: `Reset every element in ${languageName}?`,
      body: `Every element on every artboard gives up what it holds in ${languageName}, translated text included, and goes back to the shared design.`,
      action: 'Reset language',
    },
  } as const;

  const confirmation = pending ? confirmations[pending] : null;

  return (
    <div className="border-t pt-3 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Label className="text-xs font-medium">{languageName} overrides</Label>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground"
              title="More reset options"
              aria-label="More reset options"
            >
              <MoreHorizontalIcon className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => setPending('artboard')}>
              Reset this artboard to base
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setPending('project')}>
              Reset every element in this language
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {hasElementOverrides && (
        <Button
          variant="outline"
          size="sm"
          className="h-7 w-full justify-start gap-1.5 text-xs"
          title={`Give up everything this element holds in ${languageName}, translated text included`}
          onClick={() => onReset('element')}
        >
          <RotateCcw className="h-3 w-3" />
          Reset this element to base
        </Button>
      )}
      <AlertDialog
        open={pending !== null}
        onOpenChange={(open) => {
          if (!open) setPending(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmation?.title}</AlertDialogTitle>
            <AlertDialogDescription>{confirmation?.body}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                const scope = pending;
                setPending(null);
                if (scope) onReset(scope);
              }}
            >
              {confirmation?.action}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

/**
 * Says where one shared property stands in the language on screen, and flips it.
 *
 * Shared is the default and is the whole point of the feature, so the control
 * stays quiet until the user pulls the property apart. The chip carries the
 * STATE and the icon carries the ACTION, which is why a detached row shows a
 * link icon beside the words "This language only": the words say where the
 * property stands, the icon says what the click will do. Detached, this button
 * is also the way back, so there is no second control doing the same job.
 */
const LocaleDetachToggle: React.FC<{
  locale: string;
  /** Names the property in the tooltip, e.g. "Line height". */
  what: string;
  languageName: string;
  detached: boolean;
  onToggle: (detach: boolean) => void;
}> = ({ locale, what, languageName, detached, onToggle }) => {
  const action = detached ? 'Back to shared' : `Set ${what.toLowerCase()} for ${languageName} only`;
  // Detached, this button IS the reset for the property, so the tooltip says
  // what the click costs rather than leaving the user hunting for a bin icon.
  const hint = detached ? `Back to shared, drops the ${what.toLowerCase()} ${languageName} kept` : action;
  return (
    <span className="inline-flex items-center gap-1">
      {detached && (
        <span
          className="rounded border border-primary bg-primary px-1 py-px text-[9px] font-medium uppercase leading-none tracking-wide text-primary-foreground"
          title={`${localeLabel(locale)} has its own ${what.toLowerCase()}`}
        >
          {localeChipTag(locale)}
        </span>
      )}
      <Button
        type="button"
        variant="ghost"
        size="sm"
        aria-pressed={detached}
        title={hint}
        aria-label={action}
        onClick={() => onToggle(!detached)}
        className="h-5 shrink-0 gap-1 px-1 text-[10px] font-normal text-muted-foreground hover:text-foreground [&_svg]:size-3"
      >
        {detached ? <LinkIcon /> : <UnlinkIcon />}
        {detached ? 'This language only' : 'Shared'}
      </Button>
    </span>
  );
};

interface PropertiesPanelProps {
  selectedElement: ArtboardElement | null;
  onUpdateElement: (updates: Partial<ArtboardElement>) => void;
  /**
   * Update an element by id even when it is no longer selected. Used to
   * commit pending text edits when the input never fires blur (e.g. the
   * user clicks the artboard, which deselects the element and unmounts
   * the input before blur is delivered).
   */
  onUpdateElementById?: (elementId: string, updates: Partial<ArtboardElement>) => void;
  /**
   * Open the translate dialog scoped to a single text element. Omitted when
   * the host has no translation flow to offer.
   */
  onTranslateElement?: (elementId: string) => void;
  activeArtboardDetails?: ArtboardState | null;
  onUpdateArtboardDetails?: (updates: Partial<ArtboardState>) => void;
  /**
   * The language on screen, or null for the base language. Only text, fonts
   * and screenshots can ever differ per language, so when this is set the
   * panel marks those rows and says out loud that the rest is shared. Absent
   * means the panel behaves exactly as it does for a single-language project.
   */
  activeLocale?: string | null;
  /** The language the document is written in. Named in every reset control. */
  baseLocale?: string;
  /** The selected element's overrides in `activeLocale`, when it has any. */
  localeOverride?: ElementLocaleOverride;
  /**
   * The selected element BEFORE projection, so the panel can show what the
   * base language says next to a translation that replaced it.
   */
  baseElement?: ArtboardElement;
  /** Drops one override key, handing the row back to the base language. */
  onResetLocaleField?: (field: LocalizableField) => void;
  /**
   * The property names the selected element keeps its own copy of in
   * `activeLocale`. Anything absent follows the shared design.
   */
  localeDetached?: string[];
  /**
   * Pulls one shared property apart for `activeLocale`, or hands it back.
   * Omitted when the host has no detach flow, which falls back to the plain
   * "Shared across all languages" note.
   */
  onToggleLocaleDetach?: (keys: DetachableKey[], detach: boolean) => void;
  /**
   * Hands everything back to the base design at one of three scopes: the
   * selected element, every element on the active artboard, or every element in
   * the active language. Omitted when the host has no reset flow, which hides
   * the controls rather than offering a button that does nothing.
   */
  onResetLocaleOverrides?: (scope: 'element' | 'artboard' | 'project') => void;
  className?: string;
}

// Transform presets for quick application
const transformPresets = [
  {
    name: 'None',
    description: 'No transform',
    values: { skewX: 0, skewY: 0, perspectiveX: 0, perspectiveY: 0, matrix3d: '' }
  },
  {
    name: 'Slight Tilt',
    description: 'Slight perspective tilt',
    values: { skewX: 0, skewY: 0, perspectiveX: 5, perspectiveY: 2, matrix3d: '' }
  },
  {
    name: 'Left Perspective',
    description: 'Strong left perspective',
    values: { skewX: 0, skewY: 0, perspectiveX: 0, perspectiveY: 25, matrix3d: '' }
  },
  {
    name: 'Right Perspective',
    description: 'Strong right perspective',
    values: { skewX: 0, skewY: 0, perspectiveX: 0, perspectiveY: -25, matrix3d: '' }
  },
  {
    name: 'Skew Right',
    description: 'Skew to the right',
    values: { skewX: 15, skewY: 0, perspectiveX: 0, perspectiveY: 0, matrix3d: '' }
  },
  {
    name: 'Skew Left',
    description: 'Skew to the left',
    values: { skewX: -15, skewY: 0, perspectiveX: 0, perspectiveY: 0, matrix3d: '' }
  },
  {
    name: 'App Store Style',
    description: 'Popular app store preview style',
    values: { skewX: 0, skewY: 0, perspectiveX: 0, perspectiveY: 0, matrix3d: 'matrix3d(1.11397, -0.175046, 0, 6.13e-05, 0.536454, 0.828959, 0, -5.99e-05, 0, 0, 1, 0, -76.0176, 64.4342, 0, 1)' }
  }
];

// Predefined solid colors
const solidColorPalette = [
  '#E97451', // Burnt Sienna
  '#FF8C00', // Dark Orange
  '#FF0000', // Red
  '#FF69B4', // Hot Pink
  '#9370DB', // Medium Purple
  '#4169E1', // Royal Blue
  '#0000FF', // Blue
  '#40E0D0', // Turquoise
  '#00CED1', // Dark Turquoise
  '#3CB371', // Medium Sea Green
  '#32CD32', // Lime Green
  '#006400', // Dark Green
  '#FFD700', // Gold
  '#D4AF37', // Metallic Gold
  '#8B4513', // Saddle Brown
  '#A52A2A', // Brown
  '#800000', // Maroon
  '#FFFFFF', // White
  '#808080', // Gray
  '#000000', // Black
];

// Expanded gradient presets with more modern and stylish options
const gradientPresets = [
  // Original aesthetically pleasing gradients
  { color1: '#00F260', color2: '#0575E6', angle: 45 },  // Green to Blue
  { color1: '#1A2980', color2: '#26D0CE', angle: 45 },  // Deep Blue to Cyan
  { color1: '#FC5C7D', color2: '#6A82FB', angle: 45 },  // Pink to Purple
  { color1: '#FFAFBD', color2: '#ffc3a0', angle: 45 },  // Light Pink to Light Orange
  
  // New modern vibrant gradients (inspired by your image)
  { color1: '#00FFCC', color2: '#00FF85', angle: 0 },   // Aqua to Mint
  { color1: '#00FFAA', color2: '#42A6FF', angle: 90 },  // Mint to Blue
  { color1: '#4158D0', color2: '#C850C0', angle: 45 },  // Royal Blue to Magenta
  { color1: '#0093E9', color2: '#80D0C7', angle: 160 }, // Azure to Turquoise
  { color1: '#00DBDE', color2: '#FC00FF', angle: 90 },  // Turquoise to Pink
  { color1: '#08AEEA', color2: '#2AF598', angle: 0 },   // Blue to Green
  
  // Vibrant color transitions
  { color1: '#FF9A8B', color2: '#FF6A88', angle: 45 },  // Coral to Pink
  { color1: '#FBAB7E', color2: '#F7CE68', angle: 0 },   // Orange to Yellow
  { color1: '#85FFBD', color2: '#FFFB7D', angle: 45 },  // Mint to Yellow
  { color1: '#FA8BFF', color2: '#2BD2FF', angle: 90 },  // Pink to Blue
  { color1: '#FF3CAC', color2: '#784BA0', angle: 135 }, // Magenta to Purple
  
  // Subtle professional gradients
  { color1: '#D4FC79', color2: '#96E6A1', angle: 45 },  // Lime to Green
  { color1: '#E2B0FF', color2: '#9F44D3', angle: 90 },  // Lavender to Purple
  { color1: '#F9D423', color2: '#FF4E50', angle: 45 },  // Yellow to Red
  { color1: '#A1C4FD', color2: '#C2E9FB', angle: 180 }, // Blue to Light Blue
  { color1: '#FFECD2', color2: '#FCB69F', angle: 0 },   // Cream to Peach
  
  // Dark mode friendly gradients
  { color1: '#434343', color2: '#000000', angle: 90 },  // Dark Gray to Black
  { color1: '#4B1248', color2: '#F0C27B', angle: 45 },  // Dark Purple to Gold
  { color1: '#093028', color2: '#237A57', angle: 45 },  // Dark Green to Forest Green
  { color1: '#1e3c72', color2: '#2a5298', angle: 180 }, // Navy Blue shades
  { color1: '#5D4157', color2: '#A8CABA', angle: 135 }, // Mauve to Pastel Green
];

// DEFAULT_GRADIENT / normalizeGradient live in @/lib/artboardBackground so the
// panel, the canvas renderer and the PNG export all repair a half-filled
// gradient the same way. See the note there on why that matters.

export function PropertiesPanel({
  selectedElement, 
  onUpdateElement, 
  onUpdateElementById,
  onTranslateElement,
  activeArtboardDetails,
  onUpdateArtboardDetails,
  activeLocale,
  baseLocale,
  localeOverride,
  baseElement,
  onResetLocaleField,
  localeDetached,
  onToggleLocaleDetach,
  onResetLocaleOverrides,
  className
}: PropertiesPanelProps) {
  // Use a ref to track client-side initialization
  const isClient = useRef(false);
  const { toast } = useToast();
  const [isClientSide, setIsClientSide] = useState(false);

  // A translated language is on screen only when it is a real one and not the
  // base. Everything locale-aware below hangs off this single flag, so a
  // project without languages renders the panel it has always rendered.
  const baseLanguageCode = baseLocale || DEFAULT_BASE_LOCALE;
  const localeActive = !!activeLocale && activeLocale !== baseLanguageCode;
  const baseLanguageName = localeName(baseLanguageCode);
  const localeLanguageName = localeActive && activeLocale ? localeName(activeLocale) : '';

  const localeChip = (field: LocalizableField) =>
    localeActive && activeLocale ? (
      <LocaleFieldChip
        locale={activeLocale}
        baseLanguageName={baseLanguageName}
        overridden={localeOverride?.[field] !== undefined}
        onReset={onResetLocaleField ? () => onResetLocaleField(field) : undefined}
      />
    ) : null;

  const sharedNote = (className?: string) =>
    localeActive ? <SharedLanguagesNote className={className} /> : null;

  const isKeyDetached = (key: DetachableKey) => !!localeDetached?.includes(key);

  /**
   * The affordance that replaces the "Shared across all languages" note on rows
   * a language IS allowed to hold its own copy of. Renders nothing outside a
   * translated language, and the plain note when the host offers no detach
   * flow, so both of those keep the panel they have always had.
   */
  const detachToggle = (keys: DetachableKey | DetachableKey[], what: string) => {
    if (!localeActive || !activeLocale) return null;
    if (!onToggleLocaleDetach) return <SharedLanguagesNote />;
    const group = Array.isArray(keys) ? keys : [keys];
    // ANY key detached reads as detached. Editing in a translated language pulls
    // apart only the property that actually changed, so a partly detached group
    // is now the normal case, and `every` would have claimed a group was shared
    // while one of its keys was not. Clicking hands the whole group back, which
    // is what "reset this control to base" means.
    const detached = group.some(isKeyDetached);
    return (
      <LocaleDetachToggle
        locale={activeLocale}
        what={what}
        languageName={localeLanguageName}
        detached={detached}
        // One call for the whole group, not one per key: a geometry toggle
        // covers three keys, and three separate commits in one click would all
        // start from the same artboards snapshot and only the last would land.
        onToggle={(next) => {
          const changing = group.filter((key) => isKeyDetached(key) !== next);
          if (changing.length > 0) onToggleLocaleDetach(changing, next);
        }}
      />
    );
  };

  /**
   * A control's label with its detach affordance beside it. Returns the label
   * UNTOUCHED outside a translated language, so a project with no languages
   * renders the same DOM it rendered before any of this existed.
   */
  const detachLabelRow = (
    label: React.ReactNode,
    keys: DetachableKey | DetachableKey[],
    what: string
  ) =>
    localeActive ? (
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        {label}
        {detachToggle(keys, what)}
      </div>
    ) : (
      label
    );

  /**
   * Detaching the family or the size is how the user says "I am choosing this
   * myself", so the automatic helpers stand down (see resolveElementForLocale).
   * That is invisible from the canvas, so the row says it.
   */
  const detachNote = (key: DetachableKey, text: string) =>
    localeActive && isKeyDetached(key) ? (
      <p className="text-[10px] text-muted-foreground">{text}</p>
    ) : null;

  /**
   * The base properties with no field in this panel (see BASE_DETACH_GROUPS).
   * They still get a toggle, because the edit that needs them per language is
   * made on the canvas or by the agent, and there would otherwise be nowhere to
   * say so beforehand. Nothing here without a translated language on screen, and
   * nothing here without a host to take the toggle.
   */
  const renderLocaleBaseProperties = (element: ArtboardElement) => {
    if (!localeActive || !onToggleLocaleDetach) return null;
    const covered = BASE_GROUPS_WITH_A_CONTROL[element.type] || [];
    const groups = [
      ...BASE_DETACH_GROUPS.filter((group) => !covered.includes(group.id)),
      ...(EXTRA_DETACH_GROUPS[element.type] || []),
    ];
    if (groups.length === 0) return null;
    return (
      <div className="border-t pt-3 flex flex-col space-y-2">
        <Label className="text-xs font-medium">Other properties</Label>
        <p className="text-[11px] text-muted-foreground">
          No field for these here: they come from the canvas, the AI agent or the
          MCP tools. Detach one to give {localeLanguageName} its own value
        </p>
        {groups.map((group) => (
          <div key={group.id} className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
            <span className="text-xs">{group.label}</span>
            {detachToggle(group.keys, group.label)}
          </div>
        ))}
      </div>
    );
  };

  /**
   * Bookkeeping, not a value: an override carrying only these says nothing about
   * this language and must not light up a reset button.
   */
  const OVERRIDE_BOOKKEEPING_KEYS = new Set(['origin', 'sourceHash', 'detached']);

  const selectedHasLocaleOverrides =
    (localeDetached?.length ?? 0) > 0 ||
    Object.entries((localeOverride ?? {}) as Record<string, unknown>).some(
      ([key, value]) => value !== undefined && !OVERRIDE_BOOKKEEPING_KEYS.has(key)
    );

  /**
   * The way back at element, artboard and project scope. Absent outside a
   * translated language and absent without a host to run the reset, so both of
   * those render the panel they always rendered.
   */
  const renderLocaleResetControls = (hasElementOverrides: boolean) =>
    localeActive && onResetLocaleOverrides ? (
      <LocaleResetControls
        languageName={localeLanguageName}
        baseLanguageName={baseLanguageName}
        hasElementOverrides={hasElementOverrides}
        onReset={onResetLocaleOverrides}
      />
    ) : null;

  // Background state for artboard
  const [solidColor, setSolidColor] = useState('#FFFFFF');
  const [gradientColor1, setGradientColor1] = useState(DEFAULT_GRADIENT.color1);
  const [gradientColor2, setGradientColor2] = useState(DEFAULT_GRADIENT.color2);
  const [gradientAngle, setGradientAngle] = useState(DEFAULT_GRADIENT.angle);
  const [activeBackgroundTab, setActiveBackgroundTab] = useState<'solid' | 'gradient'>('solid');

  const [localContent, setLocalContent] = useState('');
  // Uncommitted text-content edit, keyed by element id so it can still be
  // committed after the element is deselected (blur may never fire).
  const pendingTextEditRef = useRef<{ elementId: string; content: string } | null>(null);
  const hiddenFileInputRef = useRef<HTMLInputElement>(null);
  const [uploadPurpose, setUploadPurpose] = useState<'customFrame' | 'screenshot' | 'image' | null>(null);

  const [screenshotLeft, setScreenshotLeft] = useState(5);
  const [screenshotTop, setScreenshotTop] = useState(5);
  const [screenshotWidth, setScreenshotWidth] = useState(90);
  const [screenshotHeight, setScreenshotHeight] = useState(90);

  // Text element states for styling options
  const [fontWeight, setFontWeight] = useState<string>('normal');
  const [fontStyle, setFontStyle] = useState<string>('normal');
  const [textDecoration, setTextDecoration] = useState<string>('none');
  const [textAlign, setTextAlign] = useState<string>('left');
  const [lineHeight, setLineHeight] = useState<number>(1.2);

  // Add state for shape corner controls
  const [borderRadiusType, setBorderRadiusType] = useState<'uniform' | 'individual'>('uniform');
  const [uniformBorderRadius, setUniformBorderRadius] = useState<number>(0);
  const [cornerTopLeft, setCornerTopLeft] = useState<number>(0);
  const [cornerTopRight, setCornerTopRight] = useState<number>(0);
  const [cornerBottomRight, setCornerBottomRight] = useState<number>(0);
  const [cornerBottomLeft, setCornerBottomLeft] = useState<number>(0);
  const [customPoints, setCustomPoints] = useState<number>(5);
  
  // Add state for circle inner radius
  const [innerRadius, setInnerRadius] = useState<number>(0);
  
  // Add state for fill opacity
  const [fillOpacity, setFillOpacity] = useState<number>(1);

  // Function to convert CSS variables to hex color
  const cssVarToHex = (cssVar: string): string => {
    // Check if it's a CSS variable format like 'hsl(var(--card))'
    if (cssVar?.toLowerCase().includes('var(--') || cssVar?.toLowerCase().includes('hsl')) {
      // Return a default color that matches the theme
      return '#FFFFFF'; // Default white to match light theme card color
    }
    return cssVar || '#FFFFFF';
  };

  useEffect(() => {
    // Mark as client-side rendered to avoid hydration issues
    isClient.current = true;
    setIsClientSide(true);

    // Commit any text edit left pending for a different (deselected) element
    // before syncing local state to the new selection.
    const pending = pendingTextEditRef.current;
    if (pending && pending.elementId !== selectedElement?.id) {
      pendingTextEditRef.current = null;
      onUpdateElementById?.(pending.elementId, { content: pending.content });
    }
    
    if (selectedElement?.type === 'text') {
      const textElement = selectedElement as TextElementProps;
      // Don't clobber an in-progress edit of the same element (e.g. the
      // element moved while the input still holds unsaved text).
      if (!pendingTextEditRef.current || pendingTextEditRef.current.elementId !== textElement.id) {
        setLocalContent(textElement.content);
      }
      // Set text styling states with default values if not present
      setFontWeight(textElement.fontWeight || 'normal');
      setFontStyle(textElement.fontStyle || 'normal');
      setTextDecoration(textElement.textDecoration || 'none');
      setTextAlign(textElement.textAlign || 'left');
      setLineHeight(textElement.lineHeight || 1.2);
    }
    if (selectedElement?.type === 'device') {
      const deviceElement = selectedElement as DeviceFrameElementProps;
      if (deviceElement.screenshotRect) { // Applies to all device types if rect exists
        setScreenshotLeft(deviceElement.screenshotRect.left);
        setScreenshotTop(deviceElement.screenshotRect.top);
        setScreenshotWidth(deviceElement.screenshotRect.width);
        setScreenshotHeight(deviceElement.screenshotRect.height);
      } else {
        // Default values if no rect (e.g. before screenshot upload)
        setScreenshotLeft(5);
        setScreenshotTop(5);
        setScreenshotWidth(90);
        setScreenshotHeight(90);
      }
    }
    if (selectedElement?.type === 'shape') {
      const shapeElement = selectedElement as ShapeElementProps;
      // Initialize shape-specific states
      setCustomPoints(shapeElement.customPoints || 5);
      setInnerRadius(shapeElement.innerRadius || 0);
      setFillOpacity(shapeElement.fillOpacity || 1);
      
      // Initialize corner radius states
      setBorderRadiusType(shapeElement.borderRadiusType || 'uniform');
      setUniformBorderRadius(typeof shapeElement.borderRadius === 'number' ? shapeElement.borderRadius : 0);
      setCornerTopLeft(shapeElement.borderRadiusTopLeft || 0);
      setCornerTopRight(shapeElement.borderRadiusTopRight || 0);
      setCornerBottomRight(shapeElement.borderRadiusBottomRight || 0);
      setCornerBottomLeft(shapeElement.borderRadiusBottomLeft || 0);
    }

    // Initialize background controls when artboard is selected and after client-side rendering
    if (isClient.current && !selectedElement && activeArtboardDetails) {
      // Convert CSS variables to hex if needed
      const backgroundColor = cssVarToHex(activeArtboardDetails.backgroundColor);
      setSolidColor(backgroundColor);
      setActiveBackgroundTab(activeArtboardDetails.backgroundType || 'solid');
      
      if (activeArtboardDetails.backgroundGradient) {
        const gradient = normalizeGradient(activeArtboardDetails.backgroundGradient);
        setGradientColor1(gradient.color1);
        setGradientColor2(gradient.color2);
        setGradientAngle(gradient.angle);
      }
    }
  }, [selectedElement, activeArtboardDetails]);

  // Handle background tab change
  const handleBackgroundTabChange = (value: string) => {
    if (!onUpdateArtboardDetails) return;
    
    const tabValue = value as 'solid' | 'gradient';
    setActiveBackgroundTab(tabValue);
    
    // When switching tabs, update the background type
    const updates: Partial<ArtboardState> = {
      backgroundType: tabValue
    };
    
    // Initialize gradient settings when switching to gradient, and repair any
    // half-filled gradient that came in with the project.
    if (tabValue === 'gradient' && activeArtboardDetails) {
      updates.backgroundGradient = normalizeGradient(
        activeArtboardDetails.backgroundGradient || {
          color1: gradientColor1,
          color2: gradientColor2,
          angle: gradientAngle
        }
      );
    }
    
    onUpdateArtboardDetails(updates);
  };

  // Handle solid color change
  const handleSolidColorChange = (color: string) => {
    if (!onUpdateArtboardDetails) return;
    
    // Don't allow setting CSS variables through the color picker
    if (color?.toLowerCase().includes('var(') || color?.toLowerCase().includes('hsl(var')) {
      color = '#FFFFFF';
    }
    
    setSolidColor(color);
    onUpdateArtboardDetails({ backgroundColor: color });
  };

  // Handle gradient color or angle change
  const handleGradientChange = (
    property: 'color1' | 'color2' | 'angle',
    value: string | number
  ) => {
    if (!onUpdateArtboardDetails || !activeArtboardDetails) return;
    
    const updates = normalizeGradient(
      activeArtboardDetails.backgroundGradient || {
        color1: gradientColor1,
        color2: gradientColor2,
        angle: gradientAngle
      }
    );
    
    if (property === 'color1') {
      setGradientColor1(value as string);
      updates.color1 = value as string;
    } else if (property === 'color2') {
      setGradientColor2(value as string);
      updates.color2 = value as string;
    } else if (property === 'angle') {
      setGradientAngle(value as number);
      updates.angle = value as number;
    }
    
    onUpdateArtboardDetails({ backgroundGradient: updates });
  };

  // Apply a gradient preset
  const applyGradientPreset = (preset: { color1: string; color2: string; angle: number }) => {
    if (!onUpdateArtboardDetails) return;
    
    setGradientColor1(preset.color1);
    setGradientColor2(preset.color2);
    setGradientAngle(preset.angle);
    
    onUpdateArtboardDetails({
      backgroundType: 'gradient',
      backgroundGradient: preset
    });
  };

  // Text lays out from more than its content: the family, the size, the weight
  // and the line height all change how much room it needs, and the box clips.
  // Anything that moves one of those goes through here, which folds the box fix
  // into the SAME update so the change stays one undo.
  const TEXT_LAYOUT_KEYS: Array<keyof TextElementProps> = [
    'content',
    'fontSize',
    'fontFamily',
    'fontWeight',
    'fontStyle',
    'lineHeight',
    'letterSpacing',
  ];

  const applyTextUpdate = async (updates: Partial<TextElementProps>) => {
    const element = selectedElement?.type === 'text' ? (selectedElement as TextElementProps) : null;
    // Growing the box is a base-language operation. fitTextBox grows only and
    // splits the growth above and below, so it moves position.y, and position
    // is shared: fitting a long German headline here would drag the English
    // one down too. In a translated language the overflow is answered by
    // shrinking the type at projection time instead.
    if (!element || localeActive || !TEXT_LAYOUT_KEYS.some((key) => key in updates)) {
      onUpdateElement(updates);
      return;
    }
    // A family picked a second ago can still be downloading, and measuring
    // then would size the box for the fallback face.
    if (typeof updates.fontFamily === 'string') {
      try {
        await document.fonts.load(`16px "${updates.fontFamily}"`);
      } catch {
        // Unknown family: fall through and measure whatever renders.
      }
    }
    const next = { ...element, ...updates } as TextElementProps;
    const fit = fitTextBox(next, next.content);
    onUpdateElement(fit ? { ...updates, ...fit } : updates);
  };

  // Text element handlers
  const handleTextContentChange = (elementId: string, content: string) => {
    setLocalContent(content);
    pendingTextEditRef.current = { elementId, content };
  };

  const handleTextContentBlur = () => {
    const pending = pendingTextEditRef.current;
    if (!pending) return;
    pendingTextEditRef.current = null;
    if (selectedElement?.type === 'text' && selectedElement.id === pending.elementId) {
      const element = selectedElement as TextElementProps;
      if (pending.content !== element.content) {
        void applyTextUpdate({ content: pending.content });
      }
    } else {
      // Selection already moved on; commit to the original element.
      onUpdateElementById?.(pending.elementId, { content: pending.content });
    }
  };

  // Device element handlers
  const handleImageUploadButtonClick = (purpose: 'customFrame' | 'screenshot' | 'image') => {
    setUploadPurpose(purpose);
    hiddenFileInputRef.current?.click();
  };

  // App Preview recordings (device screen video + standalone video element)
  const videoFileInputRef = useRef<HTMLInputElement>(null);
  const handleRecordingSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (videoFileInputRef.current) videoFileInputRef.current.value = '';
    if (!file || !selectedElement) return;
    try {
      const { id, probe } = await saveMedia(file, file.name);
      if (selectedElement.type === 'video-device') {
        onUpdateElement({
          mediaId: id,
          naturalVideoWidth: probe.width,
          naturalVideoHeight: probe.height,
          durationSeconds: probe.duration,
          trimStart: undefined,
          trimEnd: undefined,
        });
      } else if (selectedElement.type === 'video') {
        onUpdateElement({
          mediaId: id,
          videoSrc: undefined,
          naturalVideoWidth: probe.width,
          naturalVideoHeight: probe.height,
          durationSeconds: probe.duration,
          trimStart: undefined,
          trimEnd: undefined,
        });
      }
    } catch (error) {
      toast({
        title: 'Could not load recording',
        description: error instanceof Error ? error.message : 'The file could not be read.',
        variant: 'destructive',
      });
    }
  };

  const secondsInput = (value: number | undefined, onChange: (v: number | undefined) => void, id: string, placeholder: string) => (
    <Input
      id={id}
      type="number"
      min={0}
      step={0.1}
      className="h-8 text-xs"
      value={value ?? ''}
      placeholder={placeholder}
      onChange={(e) => {
        const raw = e.target.value;
        if (raw === '') return onChange(undefined);
        const v = parseFloat(raw);
        if (!Number.isNaN(v) && v >= 0) onChange(v);
      }}
    />
  );

  const handleFileSelected = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file && uploadPurpose) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const dataUrl = reader.result as string;
        if (uploadPurpose === 'customFrame' && selectedElement && selectedElement.type === 'device' && (selectedElement as DeviceFrameElementProps).deviceType === 'custom') {
          onUpdateElement({ customFrameSrc: dataUrl, screenshotSrc: undefined, screenshotRect: undefined, naturalScreenshotHeight: undefined, naturalScreenshotWidth: undefined });
        } else if (uploadPurpose === 'screenshot') {
          const img = new window.Image();
          img.onload = () => {
            // Predefined devices already carry a padded screen area, so the
            // screenshot should FILL it (0,0,100,100); insetting reveals the
            // black screen background as a fake bezel and hides the notch /
            // punch-hole (black on black). Only the 'custom' frame needs the
            // 5% inset. Mirrors DeviceFrameElement's own upload handler.
            const isCustomFrame =
              selectedElement?.type === 'device' &&
              (selectedElement as DeviceFrameElementProps).deviceType === 'custom';
            onUpdateElement({
              screenshotSrc: dataUrl,
              naturalScreenshotWidth: img.naturalWidth,
              naturalScreenshotHeight: img.naturalHeight,
              screenshotRect: isCustomFrame
                ? { left: 5, top: 5, width: 90, height: 90 }
                : { left: 0, top: 0, width: 100, height: 100 },
            });
            trackScreenshotUploaded({
              source: 'properties_panel',
              deviceType:
                selectedElement?.type === 'device'
                  ? (selectedElement as DeviceFrameElementProps).deviceType
                  : undefined,
            });
          };
          img.src = dataUrl;
        } else if (uploadPurpose === 'image') {
          onUpdateElement({
            imageSrc: dataUrl,
            imageAlt: file.name,
          });
        }
        setUploadPurpose(null);
      };
      reader.readAsDataURL(file);
    }
    if (hiddenFileInputRef.current) {
      hiddenFileInputRef.current.value = "";
    }
  };

  const handleScreenshotRectChange = (type: 'left' | 'top' | 'width' | 'height', value: number) => {
    const currentRect = (selectedElement as DeviceFrameElementProps)?.screenshotRect || { left: 5, top: 5, width: 90, height: 90 };
    const newRect = { ...currentRect };

    if (type === 'left') { setScreenshotLeft(value); newRect.left = value; }
    if (type === 'top') { setScreenshotTop(value); newRect.top = value; }
    if (type === 'width') { setScreenshotWidth(value); newRect.width = value; }
    if (type === 'height') { setScreenshotHeight(value); newRect.height = value; }

    onUpdateElement({ screenshotRect: newRect });
  };

  // Add device style type handler
  const handleDeviceStyleTypeChange = (styleType: string) => {
    if (selectedElement?.type === 'device') {
      onUpdateElement({ styleType: styleType as DeviceStyleType });
    }
  };
  
  // Add custom matrix3d handler
  const handleCustomMatrix3dChange = (matrix3d: string) => {
    if (selectedElement?.type === 'device') {
      onUpdateElement({ matrix3d });
    }
  };

  // Fix: Define the renderDeviceProperties function here
  const renderDeviceProperties = (element: DeviceFrameElementProps) => {
    // The upload writes to whichever element the panel was handed, so in a
    // translated language it lands in that language's override map on its own.
    // All this row owes the user is the chip saying which language it hits.
    const screenshotUploadButton = (
      <Button
        variant="outline"
        size="sm"
        onClick={() => handleImageUploadButtonClick('screenshot')}
        className="text-xs h-8"
      >
        <UploadCloudIcon className="w-3 h-3 mr-1.5" />
        {element.screenshotSrc ? 'Change Screenshot' : 'Upload Screenshot'}
      </Button>
    );

    return (
    <>
      {element.deviceType !== 'custom' && (
        <div className="flex flex-col space-y-1 min-w-[150px]">
          <Label htmlFor="deviceModel" className="text-xs">
            Device Model
          </Label>
          <Select
            value={element.deviceType}
            onValueChange={(v) => {
              if (v !== element.deviceType) {
                // The layout routes deviceType changes through the
                // screen-aware swap (bounds refit + overlay adaptation).
                onUpdateElement({ deviceType: v as DeviceType });
              }
            }}
          >
            <SelectTrigger id="deviceModel" className="h-8 text-xs">
              <SelectValue placeholder="Select Device" />
            </SelectTrigger>
            <SelectContent>
              {DEVICE_PICKER_GROUPS.map((group) => (
                <SelectGroup key={group.label}>
                  <SelectLabel>{group.label}</SelectLabel>
                  {group.devices.map((d) => (
                    <SelectItem key={d.id} value={d.id}>{d.label}</SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      {element.deviceType === 'custom' && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => handleImageUploadButtonClick('customFrame')}
          className="text-xs h-8"
        >
          <UploadCloudIcon className="w-3 h-3 mr-1.5" />
          {element.customFrameSrc ? 'Change Mockup' : 'Upload Mockup'}
        </Button>
      )}
      {localeActive ? (
        <div className="flex flex-col space-y-1.5 items-start">
          <div className="flex items-center gap-1.5">
            <Label className="text-xs">Screenshot</Label>
            {localeChip('screenshotSrc')}
          </div>
          {screenshotUploadButton}
        </div>
      ) : (
        screenshotUploadButton
      )}

      <div className="flex flex-col space-y-1 min-w-[150px]">
        <ScaleField
          id="deviceScale"
          elementId={element.id}
          scale={element.scale}
          size={element.size}
          position={element.position}
          onCommit={onUpdateElement}
        />
        {detachToggle(['scale'], 'scale')}
      </div>
      <div className="flex flex-col space-y-1 min-w-[150px]">
        {detachLabelRow(
          <Label htmlFor="deviceRotation" className="text-xs">
            Rotation: {Math.round(element.rotation || 0)}°
          </Label>,
          'rotation',
          'Rotation'
        )}
        <Slider
          id="deviceRotation"
          min={-180}
          max={180}
          step={1}
          value={[element.rotation || 0]}
          onValueChange={(value) => onUpdateElement({ rotation: value[0] })}
          className="my-2"
        />
      </div>

      {/* Device style type selector with the new perspective options */}
      <div className="flex flex-col space-y-1 min-w-[150px]">
        {detachLabelRow(
          <Label htmlFor="deviceStyleType" className="text-xs">
            Device Perspective
          </Label>,
          // The custom matrix below is only reachable through this select, so
          // the two travel together.
          DEVICE_PERSPECTIVE_KEYS,
          'Perspective'
        )}
        <Select
          value={element.styleType || 'normal'}
          onValueChange={handleDeviceStyleTypeChange}
        >
          <SelectTrigger id="deviceStyleType" className="h-8 text-xs">
            <SelectValue placeholder="Select Perspective" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="normal">Normal</SelectItem>
            <SelectItem value="3d-left">3D Left Side</SelectItem>
            <SelectItem value="3d-right">3D Right Side</SelectItem>
            <SelectItem value="perspective-left">Left Angle</SelectItem>
            <SelectItem value="perspective-slight-left">Slight Left</SelectItem>
            <SelectItem value="perspective-right">Right Angle</SelectItem>
            <SelectItem value="perspective-slight-right">Slight Right</SelectItem>
            <SelectItem value="perspective-front">Front Angle</SelectItem>
            <SelectItem value="custom">Custom Matrix3D</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* 3D pose + body finish (only for the true-3D styles) */}
      {(element.styleType === '3d-left' || element.styleType === '3d-right') && (
        <>
          <div className="flex flex-col space-y-1 min-w-[150px]">
            {detachLabelRow(
              <Label htmlFor="devicePose3d" className="text-xs">3D Pose</Label>,
              'pose3d',
              'Pose'
            )}
            <Select
              value={element.pose3d || 'classic'}
              onValueChange={(v) => onUpdateElement({ pose3d: v as DeviceFrameElementProps['pose3d'] })}
            >
              <SelectTrigger id="devicePose3d" className="h-8 text-xs">
                <SelectValue placeholder="Select Pose" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="classic">Classic</SelectItem>
                <SelectItem value="front">Front</SelectItem>
                <SelectItem value="upright">Upright</SelectItem>
                <SelectItem value="side">Side</SelectItem>
                <SelectItem value="tilted">Tilted</SelectItem>
                <SelectItem value="reclined">Reclined</SelectItem>
                <SelectItem value="laying">Laying</SelectItem>
                <SelectItem value="floating">Floating</SelectItem>
                <SelectItem value="drifting">Drifting</SelectItem>
                <SelectItem value="isometric">Isometric</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col space-y-1 min-w-[150px]">
            {detachLabelRow(
              <Label htmlFor="deviceFinish3d" className="text-xs">Body Finish</Label>,
              'frameColor3d',
              'Body finish'
            )}
            <Select
              value={element.frameColor3d || 'titanium'}
              onValueChange={(v) => onUpdateElement({ frameColor3d: v as DeviceFrameElementProps['frameColor3d'] })}
            >
              <SelectTrigger id="deviceFinish3d" className="h-8 text-xs">
                <SelectValue placeholder="Select Finish" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="titanium">Titanium</SelectItem>
                <SelectItem value="black">Black</SelectItem>
                <SelectItem value="white">White</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </>
      )}

      {/* Colored-frame controls for the flat styles */}
      {element.styleType !== '3d-left' && element.styleType !== '3d-right' && element.deviceType !== 'custom' && (
        <>
          <div className="grid grid-cols-2 gap-2 min-w-[100%]">
            <div>
              {detachLabelRow(
                <Label htmlFor="deviceFrameColor" className="text-xs">Frame Color</Label>,
                'frameColor',
                'Frame color'
              )}
              <div className="flex mt-1.5">
                <Input
                  id="deviceFrameColor"
                  type="color"
                  className="w-8 h-8 p-1 cursor-pointer"
                  value={element.frameColor || '#111111'}
                  onChange={(e) => onUpdateElement({ frameColor: e.target.value })}
                />
                <Input
                  type="text"
                  className="flex-1 h-8 ml-2 text-xs"
                  value={element.frameColor || ''}
                  placeholder="default"
                  onChange={(e) => onUpdateElement({ frameColor: e.target.value || undefined })}
                />
              </div>
            </div>
            <div>
              {detachLabelRow(
                <Label htmlFor="deviceNotchColor" className="text-xs">Notch Color</Label>,
                'notchColor',
                'Notch color'
              )}
              <div className="flex mt-1.5">
                <Input
                  id="deviceNotchColor"
                  type="color"
                  className="w-8 h-8 p-1 cursor-pointer"
                  value={element.notchColor || '#000000'}
                  onChange={(e) => onUpdateElement({ notchColor: e.target.value })}
                />
                <Input
                  type="text"
                  className="flex-1 h-8 ml-2 text-xs"
                  value={element.notchColor || ''}
                  placeholder="default"
                  onChange={(e) => onUpdateElement({ notchColor: e.target.value || undefined })}
                />
              </div>
            </div>
          </div>
          <div className="flex flex-col space-y-1 min-w-[150px]">
            {detachLabelRow(
              <Label htmlFor="deviceFrameOpacity" className="text-xs">
                Frame Opacity: {Math.round((element.frameOpacity ?? 1) * 100)}%
              </Label>,
              'frameOpacity',
              'Frame opacity'
            )}
            <Slider
              id="deviceFrameOpacity"
              min={0}
              max={100}
              step={1}
              value={[(element.frameOpacity ?? 1) * 100]}
              onValueChange={(v) => onUpdateElement({ frameOpacity: v[0] / 100 })}
              className="my-2"
            />
          </div>
          <div className="flex flex-col space-y-1 min-w-[150px]">
            {detachLabelRow(
              <Label htmlFor="deviceFrameStyle" className="text-xs">Frame Style</Label>,
              'frameStyle',
              'Frame style'
            )}
            <Select
              value={element.frameStyle || 'solid'}
              onValueChange={(v) => onUpdateElement({ frameStyle: v as DeviceFrameElementProps['frameStyle'] })}
            >
              <SelectTrigger id="deviceFrameStyle" className="h-8 text-xs">
                <SelectValue placeholder="Frame Style" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="solid">Solid</SelectItem>
                <SelectItem value="outline">Outline</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </>
      )}

      {/* Show custom matrix3d input when custom style is selected */}
      {element.styleType === 'custom' && (
        <div className="flex flex-col space-y-1 min-w-[100%]">
          <Label htmlFor="customMatrix3d" className="text-xs">
            Custom Matrix3D
          </Label>
          <Input
            id="customMatrix3d"
            value={element.matrix3d || ''}
            onChange={(e) => handleCustomMatrix3dChange(e.target.value)}
            placeholder="matrix3d(1,0,0,0, 0,1,0,0, 0,0,1,0, 0,0,0,1)"
            className="text-xs h-8 font-mono"
          />
          <p className="text-xs text-muted-foreground">
            Example: matrix3d(1.04438, 0.150877, 0, -5.73e-05, -1.65196, 2.31898, 0, -0.0001854, 0, 0, 1, 0, 64.9858, -3.12602, 0, 1)
          </p>
        </div>
      )}
      
      {/* Screenshot adjustment sliders for ALL device types if screenshotSrc and screenshotRect exist */}
      {element.screenshotSrc && element.screenshotRect && (
        <>
          {/* One toggle for the four sliders, because they write one rect. The
              header only exists to carry it, so it stays out of the panel a
              single-language project renders. */}
          {localeActive && (
            <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 min-w-[120px]">
              <Label className="text-xs">Screenshot Placement</Label>
              {detachToggle(SCREENSHOT_PLACEMENT_KEYS, 'Screenshot placement')}
            </div>
          )}
          <div className="flex flex-col space-y-1 min-w-[120px]">
            <Label htmlFor="ssLeft" className="text-xs">Screenshot Left: {screenshotLeft}%</Label>
            <Slider id="ssLeft" min={-50} max={150} step={0.5} value={[screenshotLeft]} onValueChange={(val) => handleScreenshotRectChange('left', val[0])} />
          </div>
          <div className="flex flex-col space-y-1 min-w-[120px]">
            <Label htmlFor="ssTop" className="text-xs">Screenshot Top: {screenshotTop}%</Label>
            <Slider id="ssTop" min={-50} max={150} step={0.5} value={[screenshotTop]} onValueChange={(val) => handleScreenshotRectChange('top', val[0])} />
          </div>
          <div className="flex flex-col space-y-1 min-w-[120px]">
            <Label htmlFor="ssWidth" className="text-xs">Screenshot Width: {screenshotWidth}%</Label>
            <Slider id="ssWidth" min={10} max={200} step={0.5} value={[screenshotWidth]} onValueChange={(val) => handleScreenshotRectChange('width', val[0])} />
          </div>
          <div className="flex flex-col space-y-1 min-w-[120px]">
            <Label htmlFor="ssHeight" className="text-xs">Screenshot Height: {screenshotHeight}%</Label>
            <Slider id="ssHeight" min={10} max={200} step={0.5} value={[screenshotHeight]} onValueChange={(val) => handleScreenshotRectChange('height', val[0])} />
          </div>
        </>
      )}
      <Input
        type="file"
        ref={hiddenFileInputRef}
        onChange={handleFileSelected}
        className="hidden"
        accept="image/*"
      />
    </>
    );
  };

  // Phone/tablet mockup playing a screen recording. Deliberately NOT the
  // screenshot device panel: no screenshot upload, no screenshot rect sliders,
  // no 3D pose or perspective (a recording only composites into a flat frame).
  const renderVideoDeviceProperties = (element: VideoDeviceElementProps) => (
    <>
      <div className="flex flex-col space-y-1 min-w-[150px]">
        <Label htmlFor="vdDeviceModel" className="text-xs">Device Model</Label>
        <Select
          value={element.deviceType}
          onValueChange={(v) => onUpdateElement({ deviceType: v as DeviceType })}
        >
          <SelectTrigger id="vdDeviceModel" className="h-8 text-xs">
            <SelectValue placeholder="Select Device" />
          </SelectTrigger>
          <SelectContent>
            {DEVICE_PICKER_GROUPS.filter((g) => g.platform !== 'neutral').map((group) => (
              <SelectGroup key={group.label}>
                <SelectLabel>{group.label}</SelectLabel>
                {group.devices
                  // Watches can't host an App Preview video (Apple takes
                  // screenshots only for watchOS), so they're left out.
                  .filter((d) => d.category !== 'watch')
                  .map((d) => (
                    <SelectItem key={d.id} value={d.id}>{d.label}</SelectItem>
                  ))}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col space-y-1.5 border rounded-md p-2 bg-muted/30">
        <div className="flex items-center gap-1.5">
          <Label className="text-xs font-medium flex items-center gap-1">
            <ClapperboardIcon className="w-3.5 h-3.5" />
            Screen Recording
          </Label>
          {localeChip('mediaId')}
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => videoFileInputRef.current?.click()}
            className="text-xs h-8"
          >
            <UploadCloudIcon className="w-3 h-3 mr-1.5" />
            {element.mediaId ? 'Change Recording' : 'Upload Recording'}
          </Button>
          {element.mediaId && (
            <Button
              variant="ghost"
              size="sm"
              className="text-xs h-8"
              onClick={() =>
                onUpdateElement({
                  mediaId: undefined,
                  trimStart: undefined,
                  trimEnd: undefined,
                  durationSeconds: undefined,
                  naturalVideoWidth: undefined,
                  naturalVideoHeight: undefined,
                })
              }
            >
              <Trash2Icon className="w-3 h-3 mr-1" />
              Remove
            </Button>
          )}
        </div>
        {element.mediaId ? (
          <>
            {element.durationSeconds ? (
              <p className="text-[11px] text-muted-foreground">
                {element.naturalVideoWidth}×{element.naturalVideoHeight}, {element.durationSeconds.toFixed(1)}s
              </p>
            ) : null}
            {/* Start and end are one trim, so one toggle above the pair rather
                than a cramped one in each half. Gated, like every affordance
                here, so a project with no languages sees the panel it had. */}
            {localeActive && (
              <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
                <Label className="text-xs">Trim</Label>
                {detachToggle(TRIM_KEYS, 'Trim')}
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <div className="grid gap-1">
                <Label htmlFor="vdTrimStart" className="text-xs">Trim start (s)</Label>
                {secondsInput(element.trimStart, (v) => onUpdateElement({ trimStart: v }), 'vdTrimStart', '0')}
              </div>
              <div className="grid gap-1">
                <Label htmlFor="vdTrimEnd" className="text-xs">Trim end (s)</Label>
                {secondsInput(element.trimEnd, (v) => onUpdateElement({ trimEnd: v }), 'vdTrimEnd', 'full length')}
              </div>
            </div>
          </>
        ) : (
          <p className="text-[11px] text-muted-foreground">
            Record your app on the phone, then drop the MP4 or MOV in here. It
            plays inside the screen and renders into the exported video.
          </p>
        )}
      </div>

      <div className="flex flex-col space-y-1 min-w-[150px]">
        {detachLabelRow(
          <Label htmlFor="vdFit" className="text-xs">Recording Fit</Label>,
          'objectFit',
          'Recording fit'
        )}
        <Select
          value={element.objectFit || 'cover'}
          onValueChange={(v) => onUpdateElement({ objectFit: v as VideoDeviceElementProps['objectFit'] })}
        >
          <SelectTrigger id="vdFit" className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="cover">Cover (fill the screen)</SelectItem>
            <SelectItem value="contain">Contain (show all of it)</SelectItem>
            <SelectItem value="fill">Stretch</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col space-y-1 min-w-[150px]">
        <ScaleField
          id="vdScale"
          elementId={element.id}
          scale={element.scale}
          size={element.size}
          position={element.position}
          onCommit={onUpdateElement}
        />
        {detachToggle(['scale'], 'scale')}
      </div>
      <div className="flex flex-col space-y-1 min-w-[150px]">
        {detachLabelRow(
          <Label htmlFor="vdRotation" className="text-xs">
            Rotation: {Math.round(element.rotation || 0)}°
          </Label>,
          'rotation',
          'Rotation'
        )}
        <Slider
          id="vdRotation"
          min={-180}
          max={180}
          step={1}
          value={[element.rotation || 0]}
          onValueChange={(value) => onUpdateElement({ rotation: value[0] })}
          className="my-2"
        />
      </div>

      <div className="grid grid-cols-2 gap-2 min-w-[100%]">
        <div>
          {detachLabelRow(
            <Label htmlFor="vdFrameColor" className="text-xs">Frame Color</Label>,
            'frameColor',
            'Frame color'
          )}
          <div className="flex mt-1.5">
            <Input
              id="vdFrameColor"
              type="color"
              className="w-8 h-8 p-1 cursor-pointer"
              value={element.frameColor || '#1e1e1e'}
              onChange={(e) => onUpdateElement({ frameColor: e.target.value })}
            />
            <Input
              type="text"
              className="flex-1 h-8 ml-2 text-xs"
              value={element.frameColor || ''}
              placeholder="default"
              onChange={(e) => onUpdateElement({ frameColor: e.target.value || undefined })}
            />
          </div>
        </div>
        <div>
          {detachLabelRow(
            <Label htmlFor="vdNotchColor" className="text-xs">Notch Color</Label>,
            'notchColor',
            'Notch color'
          )}
          <div className="flex mt-1.5">
            <Input
              id="vdNotchColor"
              type="color"
              className="w-8 h-8 p-1 cursor-pointer"
              value={element.notchColor || '#000000'}
              onChange={(e) => onUpdateElement({ notchColor: e.target.value })}
            />
            <Input
              type="text"
              className="flex-1 h-8 ml-2 text-xs"
              value={element.notchColor || ''}
              placeholder="default"
              onChange={(e) => onUpdateElement({ notchColor: e.target.value || undefined })}
            />
          </div>
        </div>
      </div>
      <div className="flex flex-col space-y-1 min-w-[150px]">
        {detachLabelRow(
          <Label htmlFor="vdFrameOpacity" className="text-xs">
            Frame Opacity: {Math.round((element.frameOpacity ?? 1) * 100)}%
          </Label>,
          'frameOpacity',
          'Frame opacity'
        )}
        <Slider
          id="vdFrameOpacity"
          min={0}
          max={100}
          step={1}
          value={[(element.frameOpacity ?? 1) * 100]}
          onValueChange={(v) => onUpdateElement({ frameOpacity: v[0] / 100 })}
          className="my-2"
        />
      </div>
      <div className="flex flex-col space-y-1 min-w-[150px]">
        {detachLabelRow(
          <Label htmlFor="vdFrameStyle" className="text-xs">Frame Style</Label>,
          'frameStyle',
          'Frame style'
        )}
        <Select
          value={element.frameStyle || 'solid'}
          onValueChange={(v) => onUpdateElement({ frameStyle: v as VideoDeviceElementProps['frameStyle'] })}
        >
          <SelectTrigger id="vdFrameStyle" className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="solid">Solid</SelectItem>
            <SelectItem value="outline">Outline</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </>
  );

  const renderVideoProperties = (element: VideoElementProps) => (
    <>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => videoFileInputRef.current?.click()}
          className="text-xs h-8"
        >
          <UploadCloudIcon className="w-3 h-3 mr-1.5" />
          {element.mediaId || element.videoSrc ? 'Change Recording' : 'Upload Recording'}
        </Button>
        {localeChip('mediaId')}
      </div>
      {element.durationSeconds ? (
        <p className="text-xs text-muted-foreground">
          {element.naturalVideoWidth}×{element.naturalVideoHeight}, {element.durationSeconds.toFixed(1)}s
        </p>
      ) : null}
      {/* One toggle above the pair: start and end are one trim. */}
      {localeActive && (
        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
          <Label className="text-xs">Trim</Label>
          {detachToggle(TRIM_KEYS, 'Trim')}
        </div>
      )}
      <div className="grid grid-cols-2 gap-2">
        <div className="grid gap-1">
          <Label htmlFor="vTrimStart" className="text-xs">Trim start (s)</Label>
          {secondsInput(element.trimStart, (v) => onUpdateElement({ trimStart: v }), 'vTrimStart', '0')}
        </div>
        <div className="grid gap-1">
          <Label htmlFor="vTrimEnd" className="text-xs">Trim end (s)</Label>
          {secondsInput(element.trimEnd, (v) => onUpdateElement({ trimEnd: v }), 'vTrimEnd', 'full length')}
        </div>
      </div>
      <div className="flex flex-col space-y-1 min-w-[150px]">
        {detachLabelRow(
          <Label htmlFor="videoObjectFit" className="text-xs">Fit</Label>,
          'objectFit',
          'Fit'
        )}
        <Select
          value={element.objectFit || 'cover'}
          onValueChange={(value) => onUpdateElement({ objectFit: value as VideoElementProps['objectFit'] })}
        >
          <SelectTrigger id="videoObjectFit" className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="cover">Cover</SelectItem>
            <SelectItem value="contain">Contain</SelectItem>
            <SelectItem value="fill">Fill</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col space-y-1 min-w-[150px]">
        {detachLabelRow(
          <Label htmlFor="videoOpacity" className="text-xs">
            Opacity: {Math.round((element.opacity ?? 1) * 100)}%
          </Label>,
          'opacity',
          'Opacity'
        )}
        <Slider
          id="videoOpacity"
          min={0}
          max={100}
          step={1}
          value={[(element.opacity ?? 1) * 100]}
          onValueChange={(value) => onUpdateElement({ opacity: value[0] / 100 })}
          className="my-2"
        />
      </div>
      <div className="flex flex-col space-y-1 min-w-[150px]">
        {detachLabelRow(
          <Label htmlFor="videoRadius" className="text-xs">
            Corner Radius: {element.borderRadius || 0}px
          </Label>,
          'borderRadius',
          'Corner radius'
        )}
        <Slider
          id="videoRadius"
          min={0}
          max={200}
          step={1}
          value={[element.borderRadius || 0]}
          onValueChange={(value) => onUpdateElement({ borderRadius: value[0] })}
          className="my-2"
        />
      </div>
      <div className="flex flex-col space-y-1 min-w-[150px]">
        {detachLabelRow(
          <Label htmlFor="videoScale" className="text-xs">
            Scale: {Math.round((element.scale || 1) * 100)}%
          </Label>,
          ['scale'],
          'scale'
        )}
        <Slider
          id="videoScale"
          min={10}
          max={500}
          step={1}
          value={[(element.scale || 1) * 100]}
          onValueChange={(value) => onUpdateElement({ scale: value[0] / 100 })}
          className="my-2"
        />
      </div>
    </>
  );

  const renderGestureProperties = (element: GestureElementProps) => {
    // The padding belongs to whichever element ends up being the row: the
    // switch alone today, the switch plus its toggle in a translated language.
    const repeatSwitch = (
      <div className={cn('flex items-center gap-2', !localeActive && 'pt-1')}>
        <input
          id="gestureRepeat"
          type="checkbox"
          className="h-4 w-4 accent-primary"
          checked={element.gestureRepeat ?? false}
          onChange={(e) => onUpdateElement({ gestureRepeat: e.target.checked })}
        />
        <Label htmlFor="gestureRepeat" className="text-xs">Loop for the whole video</Label>
      </div>
    );

    return (
    <>
      <div className="flex flex-col space-y-1 min-w-[150px]">
        {detachLabelRow(
          <Label htmlFor="gestureType" className="text-xs">Gesture</Label>,
          'gestureType',
          'Gesture'
        )}
        <Select
          value={element.gestureType}
          onValueChange={(value) => onUpdateElement({ gestureType: value as GestureType })}
        >
          <SelectTrigger id="gestureType" className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="tap">Tap</SelectItem>
            <SelectItem value="double-tap">Double Tap</SelectItem>
            <SelectItem value="swipe-left">Swipe Left</SelectItem>
            <SelectItem value="swipe-right">Swipe Right</SelectItem>
            <SelectItem value="swipe-up">Swipe Up</SelectItem>
            <SelectItem value="swipe-down">Swipe Down</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div>
        {detachLabelRow(
          <Label htmlFor="gestureColor" className="text-xs">Color</Label>,
          'color',
          'Color'
        )}
        <div className="flex mt-1.5">
          <Input
            id="gestureColor"
            type="color"
            className="w-8 h-8 p-1 cursor-pointer"
            value={element.color || '#ffffff'}
            onChange={(e) => onUpdateElement({ color: e.target.value })}
          />
          <Input
            type="text"
            className="flex-1 h-8 ml-2 text-xs"
            value={element.color || ''}
            onChange={(e) => onUpdateElement({ color: e.target.value })}
          />
        </div>
      </div>
      {/* Looping, the trigger time and the length are one timing decision, so
          the toggle beside the switch covers all three. Outside a translated
          language the switch is the whole row, exactly as it was. */}
      {localeActive ? (
        <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 pt-1">
          {repeatSwitch}
          {detachToggle(GESTURE_TIMING_KEYS, 'Timing')}
        </div>
      ) : (
        repeatSwitch
      )}
      <div className="grid grid-cols-2 gap-2">
        {!element.gestureRepeat && (
          <div className="grid gap-1">
            <Label htmlFor="gestureTrigger" className="text-xs">Plays at (s)</Label>
            {secondsInput(element.triggerTime, (v) => onUpdateElement({ triggerTime: v }), 'gestureTrigger', '0.5')}
          </div>
        )}
        <div className="grid gap-1">
          <Label htmlFor="gestureDuration" className="text-xs">Length (s)</Label>
          {secondsInput(element.gestureDuration, (v) => onUpdateElement({ gestureDuration: v }), 'gestureDuration', '1.2')}
        </div>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Loops on the canvas as a preview. In the exported video it plays at the
        time set above.
      </p>
    </>
    );
  };

  // Enter/exit animation for the exported App Preview video. Available on
  // every visual element type; gestures carry their own timing instead.
  const updateAnimation = (patch: Partial<ElementAnimation>) => {
    if (!selectedElement) return;
    const next: ElementAnimation = { ...(selectedElement.animation || {}), ...patch };
    if (!next.enter) {
      next.enterDelay = undefined;
      next.enterDuration = undefined;
    }
    if (!next.exit) {
      next.exitStart = undefined;
      next.exitDuration = undefined;
    }
    onUpdateElement({ animation: next.enter || next.exit ? next : undefined });
  };

  const ANIMATION_OPTIONS: { value: ElementAnimationPreset; label: string }[] = [
    { value: 'fade', label: 'Fade' },
    { value: 'slide-up', label: 'Slide Up' },
    { value: 'slide-down', label: 'Slide Down' },
    { value: 'slide-left', label: 'Slide Left' },
    { value: 'slide-right', label: 'Slide Right' },
    { value: 'scale-up', label: 'Scale Up' },
    { value: 'pop', label: 'Pop' },
  ];

  const renderAnimationProperties = (element: ArtboardElement) => (
    <div className="border-t pt-3 flex flex-col space-y-2">
      <Label className="text-xs font-medium flex items-center gap-1">
        <ClapperboardIcon className="w-3.5 h-3.5" />
        Video Animation
      </Label>
      <p className="text-[11px] text-muted-foreground">
        Plays in the exported App Preview video. The canvas stays static.
      </p>
      {/* The one group with no toggle, and the only remaining home for the
          static note: `animation` is never detachable, because a timeline that
          differed per language would desynchronise the video export. */}
      {sharedNote()}
      <div className="grid grid-cols-3 gap-2">
        <div className="grid gap-1">
          <Label htmlFor="animEnter" className="text-xs">Enter</Label>
          <Select
            value={element.animation?.enter ?? 'none'}
            onValueChange={(value) =>
              updateAnimation({ enter: value === 'none' ? undefined : (value as ElementAnimationPreset) })
            }
          >
            <SelectTrigger id="animEnter" className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              {ANIMATION_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {element.animation?.enter && (
          <>
            <div className="grid gap-1">
              <Label htmlFor="animEnterDelay" className="text-xs">Delay (s)</Label>
              {secondsInput(element.animation?.enterDelay, (v) => updateAnimation({ enterDelay: v }), 'animEnterDelay', '0')}
            </div>
            <div className="grid gap-1">
              <Label htmlFor="animEnterDuration" className="text-xs">Length (s)</Label>
              {secondsInput(element.animation?.enterDuration, (v) => updateAnimation({ enterDuration: v }), 'animEnterDuration', '0.6')}
            </div>
          </>
        )}
      </div>
      <div className="grid grid-cols-3 gap-2">
        <div className="grid gap-1">
          <Label htmlFor="animExit" className="text-xs">Exit</Label>
          <Select
            value={element.animation?.exit ?? 'none'}
            onValueChange={(value) =>
              updateAnimation({ exit: value === 'none' ? undefined : (value as ElementAnimationPreset) })
            }
          >
            <SelectTrigger id="animExit" className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              {ANIMATION_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {element.animation?.exit && (
          <>
            <div className="grid gap-1">
              <Label htmlFor="animExitStart" className="text-xs">Starts at (s)</Label>
              {secondsInput(element.animation?.exitStart, (v) => updateAnimation({ exitStart: v }), 'animExitStart', 'never')}
            </div>
            <div className="grid gap-1">
              <Label htmlFor="animExitDuration" className="text-xs">Length (s)</Label>
              {secondsInput(element.animation?.exitDuration, (v) => updateAnimation({ exitDuration: v }), 'animExitDuration', '0.6')}
            </div>
          </>
        )}
      </div>
    </div>
  );

  // Update text styling - simplified to directly update element
  const toggleFontStyle = (property: 'fontWeight' | 'fontStyle' | 'textDecoration', value: string) => {
    if (!selectedElement || selectedElement.type !== 'text') return;
    
    let newValue = value;
    
    // Toggle logic
    if (property === 'fontWeight') {
      newValue = fontWeight === 'bold' ? 'normal' : 'bold';
      setFontWeight(newValue);
    }
    else if (property === 'fontStyle') {
      newValue = fontStyle === 'italic' ? 'normal' : 'italic';
      setFontStyle(newValue);
    }
    else if (property === 'textDecoration') {
      // Handle multiple text decorations (underline, line-through)
      const currentDecoration = textDecoration || 'none';
      if (value === 'underline') {
        newValue = currentDecoration.includes('underline')
          ? currentDecoration.replace('underline', '').trim()
          : `${currentDecoration === 'none' ? '' : currentDecoration} underline`.trim();
      } else if (value === 'line-through') {
        newValue = currentDecoration.includes('line-through')
          ? currentDecoration.replace('line-through', '').trim()
          : `${currentDecoration === 'none' ? '' : currentDecoration} line-through`.trim();
      }
      
      // If empty after removing decorations, set to 'none'
      if (!newValue) newValue = 'none';
      setTextDecoration(newValue);
    }
    
    // Direct update to the element
    const updates: Partial<TextElementProps> = {};
    updates[property] = newValue;
    void applyTextUpdate(updates);
  };

  // Update text alignment - simplified direct update
  const setTextAlignment = (alignment: string) => {
    if (!selectedElement || selectedElement.type !== 'text') return;
    setTextAlign(alignment);
    onUpdateElement({ textAlign: alignment });
  };

  // Update line height - handle direct update
  const handleLineHeightChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!selectedElement || selectedElement.type !== 'text') return;
    const value = parseFloat(e.target.value) || 1.2;
    setLineHeight(value);
    void applyTextUpdate({ lineHeight: value });
  };

  // Render text properties in a more compact horizontal layout
  const renderTextProperties = (element: TextElementProps) => {
    const contentOverridden = localeOverride?.content !== undefined;
    const baseContent = baseElement?.type === 'text' ? (baseElement as TextElementProps).content : '';
    return (
      <div className="space-y-4">
        {/* Content */}
        <div className="space-y-2">
          <div className="flex items-center gap-1.5">
            <Label htmlFor="textContent" className="text-xs font-medium">Content</Label>
            {localeChip('content')}
          </div>
          <div className="flex items-start gap-1.5">
            {/* A textarea, not an input: text elements keep their newlines
                (the canvas renders them with white-space: pre-wrap), and a
                single-line input silently swallowed every one of them. */}
            <Textarea
              id="textContent"
              value={localContent}
              onChange={(e) => handleTextContentChange(element.id, e.target.value)}
              onBlur={handleTextContentBlur}
              rows={Math.min(6, Math.max(2, localContent.split('\n').length))}
              // Nothing written for this language yet, so what is in the box is
              // the base string on loan: muted so it reads as a prompt.
              className={cn(
                'min-h-[60px] resize-y text-sm',
                localeActive && !contentOverridden && 'text-muted-foreground'
              )}
            />
            {onTranslateElement && (
              <Button
                variant="outline"
                size="icon"
                className="h-10 w-10 shrink-0"
                disabled={!isTranslationEnabled || !localContent.trim()}
                title={
                  isTranslationEnabled
                    ? "Translate this text"
                    : "Translation is disabled because API URLs are not configured"
                }
                aria-label="Translate this text"
                onClick={() => {
                  // Flush an edit the blur may not have committed yet, so the
                  // dialog translates what is in the box, not the stale value.
                  handleTextContentBlur();
                  onTranslateElement(element.id);
                }}
              >
                <Languages className="h-4 w-4" />
              </Button>
            )}
          </div>
          {localeActive && !contentOverridden && (
            <p className="text-[11px] text-muted-foreground">
              Showing {baseLanguageName}. Type to write the {localeLanguageName} version
            </p>
          )}
          {localeActive && contentOverridden && baseContent && (
            <p className="text-[11px] text-muted-foreground line-clamp-2" title={baseContent}>
              {baseLanguageName}: {baseContent}
            </p>
          )}
          <p className="text-[11px] text-muted-foreground">Press Enter for a line break</p>
        </div>

        {/* Font Family */}
        <div className="space-y-2">
          <div className="flex items-center gap-1.5">
            <Label htmlFor="fontFamily" className="text-xs font-medium">Font Family</Label>
            {detachToggle('fontFamily', 'Font family')}
          </div>
          <FontFamilySelect
            id="fontFamily"
            value={element.fontFamily || 'Arial'}
            onValueChange={(value) => void applyTextUpdate({ fontFamily: value })}
            allowImport
          />
          {detachNote('fontFamily', 'Automatic script matching is off for this element')}
        </div>

        {/* Font Size and Line Height */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2">
            {detachLabelRow(
              <Label htmlFor="fontSize" className="text-xs font-medium">Font Size</Label>,
              'fontSize',
              'Font size'
            )}
            <Input
              id="fontSize"
              type="number"
              value={element.fontSize}
              onChange={(e) => void applyTextUpdate({ fontSize: parseInt(e.target.value, 10) || 16 })}
              className="text-sm"
            />
            {detachNote('fontSize', 'Automatic shrinking is off for this element')}
          </div>

          <div className="space-y-2">
            {detachLabelRow(
              <Label htmlFor="lineHeight" className="text-xs font-medium">Line Height</Label>,
              'lineHeight',
              'Line height'
            )}
            <Input
              id="lineHeight"
              type="number"
              value={lineHeight}
              onChange={handleLineHeightChange}
              className="text-sm"
              step="0.1"
            />
          </div>
        </div>

        {/* Font Color */}
        <div className="space-y-2">
          {detachLabelRow(
            <Label htmlFor="fontColor" className="text-xs font-medium">Color</Label>,
            'color',
            'Color'
          )}
          <div className="flex items-center gap-2">
            <Input
              id="fontColor"
              type="color"
              value={element.color}
              onChange={(e) => onUpdateElement({ color: e.target.value })}
              className="w-10 h-10 p-1"
            />
            <Input
              type="text"
              value={element.color}
              onChange={(e) => onUpdateElement({ color: e.target.value })}
              className="flex-1 text-xs font-mono"
            />
          </div>
        </div>

        {/* Font Style. One toggle for the four buttons: a language that wants
            its own weight almost always wants the italic that goes with it, and
            a half-detached row would send the next click to every language. */}
        <div className="space-y-2">
          {detachLabelRow(
            <Label className="text-xs font-medium">Text Style</Label>,
            TEXT_STYLE_KEYS,
            'Text style'
          )}
          <div className="flex items-center space-x-1 flex-wrap gap-1">
            <Button
              variant={fontWeight === 'bold' ? 'default' : 'outline'}
              size="icon"
              className="h-8 w-8"
              onClick={() => toggleFontStyle('fontWeight', 'bold')}
              title="Bold"
            >
              <Bold className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant={fontStyle === 'italic' ? 'default' : 'outline'}
              size="icon"
              className="h-8 w-8"
              onClick={() => toggleFontStyle('fontStyle', 'italic')}
              title="Italic"
            >
              <Italic className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant={textDecoration?.includes('underline') ? 'default' : 'outline'}
              size="icon"
              className="h-8 w-8"
              onClick={() => toggleFontStyle('textDecoration', 'underline')}
              title="Underline"
            >
              <Underline className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant={textDecoration?.includes('line-through') ? 'default' : 'outline'}
              size="icon"
              className="h-8 w-8"
              onClick={() => toggleFontStyle('textDecoration', 'line-through')}
              title="Strikethrough"
            >
              <Strikethrough className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
          
        {/* Text Alignment */}
        <div className="space-y-2">
          {detachLabelRow(
            <Label className="text-xs font-medium">Text Alignment</Label>,
            'textAlign',
            'Alignment'
          )}
          <div className="flex items-center space-x-1">
            <Button
              variant={textAlign === 'left' ? 'default' : 'outline'}
              size="icon"
              className="h-8 w-8"
              onClick={() => setTextAlignment('left')}
              title="Align Left"
            >
              <AlignLeft className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant={textAlign === 'center' ? 'default' : 'outline'}
              size="icon"
              className="h-8 w-8"
              onClick={() => setTextAlignment('center')}
              title="Align Center"
            >
              <AlignCenter className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant={textAlign === 'right' ? 'default' : 'outline'}
              size="icon"
              className="h-8 w-8"
              onClick={() => setTextAlignment('right')}
              title="Align Right"
            >
              <AlignRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </div>
    );
  };

  // Add handlers for corner controls
  const handleBorderRadiusTypeChange = (type: 'uniform' | 'individual') => {
    setBorderRadiusType(type);
    if (type === 'uniform') {
      onUpdateElement({
        borderRadiusType: 'uniform',
        borderRadius: uniformBorderRadius,
        borderRadiusTopLeft: undefined,
        borderRadiusTopRight: undefined,
        borderRadiusBottomRight: undefined,
        borderRadiusBottomLeft: undefined
      });
    } else {
      onUpdateElement({
        borderRadiusType: 'individual',
        borderRadius: undefined,
        borderRadiusTopLeft: cornerTopLeft,
        borderRadiusTopRight: cornerTopRight,
        borderRadiusBottomRight: cornerBottomRight,
        borderRadiusBottomLeft: cornerBottomLeft
      });
    }
  };

  const handleUniformBorderRadiusChange = (radius: number) => {
    setUniformBorderRadius(radius);
    onUpdateElement({
      borderRadius: radius
    });
  };

  const handleIndividualCornerChange = (
    corner: 'topLeft' | 'topRight' | 'bottomRight' | 'bottomLeft',
    value: number
  ) => {
    switch (corner) {
      case 'topLeft':
        setCornerTopLeft(value);
        onUpdateElement({ borderRadiusTopLeft: value });
        break;
      case 'topRight':
        setCornerTopRight(value);
        onUpdateElement({ borderRadiusTopRight: value });
        break;
      case 'bottomRight':
        setCornerBottomRight(value);
        onUpdateElement({ borderRadiusBottomRight: value });
        break;
      case 'bottomLeft':
        setCornerBottomLeft(value);
        onUpdateElement({ borderRadiusBottomLeft: value });
        break;
    }
  };

  // Add the missing handleCustomPointsChange function
  const handleCustomPointsChange = (points: number) => {
    setCustomPoints(points);
    onUpdateElement({
      customPoints: points
    });
  };

  // Add handler for circle inner radius
  const handleInnerRadiusChange = (radius: number) => {
    setInnerRadius(radius);
    onUpdateElement({
      innerRadius: radius
    });
  };

  // Add handler for fill opacity
  const handleFillOpacityChange = (opacity: number) => {
    setFillOpacity(opacity);
    onUpdateElement({
      fillOpacity: opacity
    });
  };

  // Function to render image properties
  const renderImageProperties = (element: ImageElementProps) => {
    console.log('Rendering image properties for element:', element.id, 'skewX:', element.skewX, 'skewY:', element.skewY);
    
    return (
    <div className="space-y-4">
      {/* Image Upload and Basic Properties */}
      <div className="w-full flex flex-wrap gap-2 items-start">
        {/* Image Upload Button, with the size multiplier right under it */}
        <div className="flex-shrink-0 w-[172px]">
          <div className="flex items-center gap-1.5 mb-1">
            <Label className="text-xs">Image</Label>
            {localeChip('imageSrc')}
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleImageUploadButtonClick('image')}
            className="text-xs h-8 w-full"
          >
            <UploadCloudIcon className="w-3 h-3 mr-1.5" />
            {element.imageSrc ? 'Change Image' : 'Upload Image'}
          </Button>

          {/* Scale. Multiplies the element box, same as the corner handles and
              the device panel's slider, so it carries into exports too. */}
          <div className="mt-2">
            <ScaleField
              id="imageScale"
              elementId={element.id}
              scale={element.scale}
              size={element.size}
              position={element.position}
              onCommit={onUpdateElement}
            />
            {detachToggle(['scale'], 'scale')}
          </div>
        </div>

        {/* Object Fit */}
        <div className="w-[120px]">
          {detachLabelRow(
            <Label htmlFor="objectFit" className="text-xs mb-1 block">Object Fit</Label>,
            'objectFit',
            'Object fit'
          )}
          <Select
            value={element.objectFit || 'cover'}
            onValueChange={(value) => onUpdateElement({ objectFit: value as 'contain' | 'cover' | 'fill' | 'none' | 'scale-down' })}
          >
            <SelectTrigger id="objectFit" className="h-8 text-xs">
              <SelectValue placeholder="Object Fit" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="cover">Cover</SelectItem>
              <SelectItem value="contain">Contain</SelectItem>
              <SelectItem value="fill">Fill</SelectItem>
              <SelectItem value="none">None</SelectItem>
              <SelectItem value="scale-down">Scale Down</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Opacity */}
        <div className="w-[120px]">
          {detachLabelRow(
            <Label htmlFor="opacity" className="text-xs mb-1 block">
              Opacity: {Math.round((element.opacity || 1) * 100)}%
            </Label>,
            'opacity',
            'Opacity'
          )}
          <Slider
            id="opacity"
            min={0}
            max={1}
            step={0.01}
            value={[element.opacity || 1]}
            onValueChange={(value) => onUpdateElement({ opacity: value[0] })}
            className="my-2"
          />
        </div>

        {/* Border Radius */}
        <div className="w-[120px]">
          {detachLabelRow(
            <Label htmlFor="imageBorderRadius" className="text-xs mb-1 block">
              Border Radius: {element.borderRadius || 0}px
            </Label>,
            'borderRadius',
            'Border radius'
          )}
          <Slider
            id="imageBorderRadius"
            min={0}
            max={50}
            step={1}
            value={[element.borderRadius || 0]}
            onValueChange={(value) => onUpdateElement({ borderRadius: value[0] })}
            className="my-2"
          />
        </div>

        {/* Image Alt Text */}
        <div className="flex-1 min-w-[150px]">
          {detachLabelRow(
            <Label htmlFor="imageAlt" className="text-xs mb-1 block">Alt Text</Label>,
            'imageAlt',
            'Alt text'
          )}
          <Input
            id="imageAlt"
            value={element.imageAlt || ''}
            onChange={(e) => onUpdateElement({ imageAlt: e.target.value })}
            placeholder="Describe the image"
            className="text-xs h-8"
          />
        </div>
      </div>

      {/* Transform Properties */}
      <div className="space-y-3">
        <div className="text-sm font-medium text-foreground border-b pb-1">Transform</div>
        {/* One toggle for the whole group: the presets and the Reset Transform
            button write all five keys at once, so anything finer would leave
            half the transform reaching every language. */}
        {detachToggle(IMAGE_TRANSFORM_KEYS, 'Transform')}

        {/* Transform Presets */}
        <div>
          <Label className="text-xs mb-2 block">Transform Presets</Label>
          <div className="grid grid-cols-2 gap-2">
            {transformPresets.map((preset) => (
              <Button
                key={preset.name}
                variant="outline"
                size="sm"
                onClick={() => {
                  console.log('Applying transform preset:', preset.name, preset.values);
                  onUpdateElement(preset.values);
                }}
                className="text-xs h-8 justify-start"
                title={preset.description}
              >
                {preset.name}
              </Button>
            ))}
          </div>
        </div>

        {/* Skew Controls */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="skewX" className="text-xs mb-1 block">
              Skew X: {element.skewX || 0}°
            </Label>
            <Slider
              id="skewX"
              min={-45}
              max={45}
              step={1}
              value={[element.skewX || 0]}
              onValueChange={(value) => {
                console.log('Updating skewX to:', value[0]);
                onUpdateElement({ skewX: value[0] });
              }}
              className="my-2"
            />
          </div>
          
          <div>
            <Label htmlFor="skewY" className="text-xs mb-1 block">
              Skew Y: {element.skewY || 0}°
            </Label>
            <Slider
              id="skewY"
              min={-45}
              max={45}
              step={1}
              value={[element.skewY || 0]}
              onValueChange={(value) => {
                console.log('Updating skewY to:', value[0]);
                onUpdateElement({ skewY: value[0] });
              }}
              className="my-2"
            />
          </div>
        </div>

        {/* Perspective Controls */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="perspectiveX" className="text-xs mb-1 block">
              Perspective X: {element.perspectiveX || 0}°
            </Label>
            <Slider
              id="perspectiveX"
              min={-60}
              max={60}
              step={1}
              value={[element.perspectiveX || 0]}
              onValueChange={(value) => {
                console.log('Updating perspectiveX to:', value[0]);
                onUpdateElement({ perspectiveX: value[0] });
              }}
              className="my-2"
            />
          </div>
          
          <div>
            <Label htmlFor="perspectiveY" className="text-xs mb-1 block">
              Perspective Y: {element.perspectiveY || 0}°
            </Label>
            <Slider
              id="perspectiveY"
              min={-60}
              max={60}
              step={1}
              value={[element.perspectiveY || 0]}
              onValueChange={(value) => {
                console.log('Updating perspectiveY to:', value[0]);
                onUpdateElement({ perspectiveY: value[0] });
              }}
              className="my-2"
            />
          </div>
        </div>

        {/* Custom Matrix3D */}
        <div>
          <Label htmlFor="matrix3d" className="text-xs mb-1 block">
            Custom Matrix3D
          </Label>
          <Textarea
            id="matrix3d"
            value={element.matrix3d || ''}
            onChange={(e) => onUpdateElement({ matrix3d: e.target.value })}
            placeholder="matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)"
            className="text-xs h-20 resize-none"
          />
          <p className="text-xs text-muted-foreground mt-1">
            Enter a custom CSS matrix3d transform. Leave blank to use individual controls above.
          </p>
        </div>

        {/* Reset Transform Button */}
        <div className="flex justify-end">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onUpdateElement({ 
              skewX: 0, 
              skewY: 0, 
              perspectiveX: 0, 
              perspectiveY: 0,
              matrix3d: '' 
            })}
            className="text-xs"
          >
            Reset Transform
          </Button>
        </div>
      </div>
    </div>
  );
  };

  // Function to render shape-specific controls
  const renderShapeProperties = (element: ShapeElementProps) => {
    console.log('renderShapeProperties called with element:', element);
    console.log('element.shapeType:', element.shapeType);
    console.log('element.innerRadius:', element.innerRadius);
    
    return (
    <div className="space-y-4">
      {/* Shape Fill and Stroke controls - horizontal layout */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          {detachLabelRow(
            <Label htmlFor="fillColor">Fill Color</Label>,
            // A gradient fill wins over this colour, so the two are one choice.
            SHAPE_FILL_KEYS,
            'Fill'
          )}
          <div className="flex mt-1.5">
            <Input
              id="fillColor"
              type="color"
              className="w-10 h-10 p-1 cursor-pointer"
              value={element.fillColor}
              onChange={(e) => onUpdateElement({ fillColor: e.target.value })}
            />
            <Input
              type="text"
              className="flex-1 h-10 ml-2"
              value={element.fillColor}
              onChange={(e) => onUpdateElement({ fillColor: e.target.value })}
            />
          </div>
        </div>
        <div>
          {detachLabelRow(
            <Label htmlFor="strokeColor">Stroke Color</Label>,
            'strokeColor',
            'Stroke color'
          )}
          <div className="flex mt-1.5">
            <Input
              id="strokeColor"
              type="color"
              className="w-10 h-10 p-1 cursor-pointer"
              value={element.strokeColor}
              onChange={(e) => onUpdateElement({ strokeColor: e.target.value })}
            />
            <Input
              type="text"
              className="flex-1 h-10 ml-2"
              value={element.strokeColor}
              onChange={(e) => onUpdateElement({ strokeColor: e.target.value })}
            />
          </div>
        </div>
      </div>

      <div>
        {detachLabelRow(
          <Label htmlFor="strokeWidth">Stroke Width</Label>,
          'strokeWidth',
          'Stroke width'
        )}
        <div className="flex items-center gap-2">
          <Input
            id="strokeWidth"
            type="range"
            min="0"
            max="20"
            step="1"
            className="flex-1"
            value={element.strokeWidth || 0}
            onChange={(e) => onUpdateElement({ strokeWidth: parseInt(e.target.value) })}
          />
          <div className="w-10 text-center">{element.strokeWidth || 0}px</div>
        </div>
      </div>

      {/* Shape-specific controls */}
      {element.shapeType === 'star' && (
        <div>
          {detachLabelRow(
            <Label htmlFor="customPoints">Star Points</Label>,
            'customPoints',
            'Star points'
          )}
          <div className="flex items-center gap-2">
            <Input
              id="customPoints"
              type="range"
              min="3"
              max="12"
              step="1"
              className="flex-1"
              value={customPoints}
              onChange={(e) => handleCustomPointsChange(parseInt(e.target.value))}
            />
            <div className="w-10 text-center">{customPoints}</div>
          </div>
        </div>
      )}

      {/* Circle and Diamond inner radius control */}
      {(element.shapeType === 'circle' || element.shapeType === 'diamond') && (
        <div>
          {detachLabelRow(
            <Label htmlFor="innerRadius">Inner Radius</Label>,
            'innerRadius',
            'Inner radius'
          )}
          <div className="flex items-center gap-2">
            <Input
              id="innerRadius"
              type="range"
              min="0"
              max="95"
              step="1"
              className="flex-1"
              value={innerRadius}
              onChange={(e) => handleInnerRadiusChange(parseInt(e.target.value))}
            />
            <div className="w-12 text-center">{innerRadius}%</div>
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            Creates a ring/donut shape when {'>'}0
          </div>
        </div>
      )}

      {/* Fill Opacity control for all shapes */}
      <div>
        {detachLabelRow(
          <Label htmlFor="fillOpacity">Fill Opacity</Label>,
          'fillOpacity',
          'Fill opacity'
        )}
        <div className="flex items-center gap-2">
          <Input
            id="fillOpacity"
            type="range"
            min="0"
            max="1"
            step="0.01"
            className="flex-1"
            value={fillOpacity}
            onChange={(e) => handleFillOpacityChange(parseFloat(e.target.value))}
          />
          <div className="w-12 text-center">{Math.round(fillOpacity * 100)}%</div>
        </div>
        <div className="text-xs text-muted-foreground mt-1">
          Adjust transparency of the fill color
        </div>
      </div>

      {/* Only show corner controls for rectangle shape - with improved horizontal layout */}
      {element.shapeType === 'rectangle' && (
        <>
          <div>
            {/* One toggle for the whole corner section: uniform and per corner
                are two faces of the same control, and switching between them
                rewrites all six keys. */}
            {detachLabelRow(<Label>Corner Type</Label>, CORNER_RADIUS_KEYS, 'Corners')}
            <div className="flex gap-2 mt-1.5">
              <Button
                variant={borderRadiusType === 'uniform' ? 'default' : 'outline'}
                size="sm"
                onClick={() => handleBorderRadiusTypeChange('uniform')}
                className="flex-1"
              >
                Uniform
              </Button>
              <Button
                variant={borderRadiusType === 'individual' ? 'default' : 'outline'}
                size="sm"
                onClick={() => handleBorderRadiusTypeChange('individual')}
                className="flex-1"
              >
                Individual
              </Button>
            </div>
          </div>

          {borderRadiusType === 'uniform' ? (
            <div>
              <Label htmlFor="uniformRadius">Corner Radius</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="uniformRadius"
                  type="range"
                  min="0"
                  max="100"
                  step="1"
                  className="flex-1"
                  value={uniformBorderRadius}
                  onChange={(e) => handleUniformBorderRadiusChange(parseInt(e.target.value))}
                />
                <div className="w-12 text-center">{uniformBorderRadius}px</div>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <Label className="text-sm">Individual Corners</Label>
                <div className="flex items-center space-x-2">
                  <div className="text-xs text-muted-foreground">Preview:</div>
                  <div className="w-10 h-10 border border-dashed border-muted-foreground rounded-md overflow-hidden">
                    <div 
                      className="w-full h-full bg-primary/20"
                      style={{
                        borderTopLeftRadius: `${cornerTopLeft}px`,
                        borderTopRightRadius: `${cornerTopRight}px`,
                        borderBottomRightRadius: `${cornerBottomRight}px`,
                        borderBottomLeftRadius: `${cornerBottomLeft}px`,
                      }}
                    />
                  </div>
                </div>
              </div>
              
              {/* Enhanced horizontal layout for corner controls */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="flex justify-between">
                    <Label htmlFor="cornerTL" className="text-xs">Top Left</Label>
                    <div className="text-xs">{cornerTopLeft}px</div>
                  </div>
                  <Input
                    id="cornerTL"
                    type="range"
                    min="0"
                    max="100"
                    step="1"
                    className="w-full h-6"
                    value={cornerTopLeft}
                    onChange={(e) => handleIndividualCornerChange('topLeft', parseInt(e.target.value))}
                  />
                </div>
                
                <div>
                  <div className="flex justify-between">
                    <Label htmlFor="cornerTR" className="text-xs">Top Right</Label>
                    <div className="text-xs">{cornerTopRight}px</div>
                  </div>
                  <Input
                    id="cornerTR"
                    type="range"
                    min="0"
                    max="100"
                    step="1"
                    className="w-full h-6"
                    value={cornerTopRight}
                    onChange={(e) => handleIndividualCornerChange('topRight', parseInt(e.target.value))}
                  />
                </div>
                
                <div>
                  <div className="flex justify-between">
                    <Label htmlFor="cornerBL" className="text-xs">Bottom Left</Label>
                    <div className="text-xs">{cornerBottomLeft}px</div>
                  </div>
                  <Input
                    id="cornerBL"
                    type="range"
                    min="0"
                    max="100"
                    step="1"
                    className="w-full h-6"
                    value={cornerBottomLeft}
                    onChange={(e) => handleIndividualCornerChange('bottomLeft', parseInt(e.target.value))}
                  />
                </div>
                
                <div>
                  <div className="flex justify-between">
                    <Label htmlFor="cornerBR" className="text-xs">Bottom Right</Label>
                    <div className="text-xs">{cornerBottomRight}px</div>
                  </div>
                  <Input
                    id="cornerBR"
                    type="range"
                    min="0"
                    max="100"
                    step="1"
                    className="w-full h-6"
                    value={cornerBottomRight}
                    onChange={(e) => handleIndividualCornerChange('bottomRight', parseInt(e.target.value))}
                  />
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
    );
  };

  // No element or artboard selected
  if (!selectedElement && !activeArtboardDetails) {
    return (
      <div className={cn("w-full h-full bg-card border-l shadow-md flex flex-col overflow-hidden", className)} suppressHydrationWarning>
        <div className="px-4 py-3 border-b bg-card">
          <div className="font-medium text-foreground">Properties</div>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-3">
          <div className="text-sm text-muted-foreground">Select an element or artboard to see its properties.</div>
        </div>
      </div>
    );
  }

  // Artboard background properties
  if (!selectedElement && activeArtboardDetails && isClientSide) {
    // Ensure we display a proper hex color, not CSS variables
    const displayColor = cssVarToHex(solidColor);
    // Never render straight from the colour state: a partial gradient (or a
    // value kept across a Fast Refresh) would otherwise blow up the panel.
    const displayGradient = normalizeGradient({
      color1: gradientColor1,
      color2: gradientColor2,
      angle: gradientAngle,
    });

    return (
      <div className={cn("w-full h-full bg-card border-l shadow-md flex flex-col overflow-hidden", className)} suppressHydrationWarning>
        <div className="px-4 py-3 border-b bg-card">
          <div className="font-medium text-foreground">Artboard Background</div>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4 text-sm">
          {/* Artboard Name */}
          <div className="space-y-2">
            <Label htmlFor="artboardName" className="text-xs font-medium">Artboard Name</Label>
            <Input
              id="artboardName"
              value={activeArtboardDetails.name || ''}
              onChange={(e) => onUpdateArtboardDetails?.({ name: e.target.value })}
              placeholder="Enter artboard name"
              className="text-sm"
            />
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="bgType" className="text-xs font-medium">Background Type</Label>
            <RadioGroup 
              id="bgType"
              value={activeBackgroundTab}
              onValueChange={handleBackgroundTabChange}
              className="flex flex-col space-y-2"
            >
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="solid" id="solid" />
                <Label htmlFor="solid" className="text-xs cursor-pointer">Solid Color</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="gradient" id="gradient" />
                <Label htmlFor="gradient" className="text-xs cursor-pointer">Gradient</Label>
              </div>
            </RadioGroup>
          </div>

          {activeBackgroundTab === 'solid' ? (
            <div className="space-y-2">
              <Label htmlFor="bgColor" className="text-xs font-medium">Background Color</Label>
              <div className="space-y-2">
                <div className="flex items-center space-x-2">
                  <Input
                    id="bgColor"
                    type="color"
                    value={displayColor}
                    onChange={(e) => handleSolidColorChange(e.target.value)}
                    className="w-10 h-10 p-1"
                  />
                  <Input
                    type="text"
                    value={displayColor.toUpperCase()}
                    onChange={(e) => handleSolidColorChange(e.target.value)}
                    className="flex-1 font-mono text-xs"
                  />
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label className="text-xs font-medium">First Color</Label>
                <div className="flex items-center space-x-2">
                  <Input
                    type="color"
                    value={displayGradient.color1}
                    onChange={(e) => handleGradientChange('color1', e.target.value)}
                    className="w-10 h-10 p-1"
                  />
                  <Input
                    type="text"
                    value={displayGradient.color1.toUpperCase()}
                    onChange={(e) => handleGradientChange('color1', e.target.value)}
                    className="flex-1 font-mono text-xs"
                  />
                </div>
              </div>
              
              <div className="space-y-2">
                <Label className="text-xs font-medium">Second Color</Label>
                <div className="flex items-center space-x-2">
                  <Input
                    type="color"
                    value={displayGradient.color2}
                    onChange={(e) => handleGradientChange('color2', e.target.value)}
                    className="w-10 h-10 p-1"
                  />
                  <Input
                    type="text"
                    value={displayGradient.color2.toUpperCase()}
                    onChange={(e) => handleGradientChange('color2', e.target.value)}
                    className="flex-1 font-mono text-xs"
                  />
                </div>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="gradientAngle" className="text-xs font-medium">
                  Angle: {displayGradient.angle}°
                </Label>
                <Slider
                  id="gradientAngle"
                  min={0}
                  max={360}
                  step={1}
                  value={[displayGradient.angle]}
                  onValueChange={(value) => handleGradientChange('angle', value[0])}
                  className="w-full"
                />
              </div>
            </div>
          )}

          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="w-full">
                <Palette className="w-3 h-3 mr-1" />
                <span>{activeBackgroundTab === 'solid' ? 'Color Presets' : 'Gradient Presets'}</span>
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-72 p-2">
              <div className="space-y-2">
                <Label className="text-xs">
                  {activeBackgroundTab === 'solid' ? 'Color Palette' : 'Gradient Presets'}
                </Label>
                
                {activeBackgroundTab === 'solid' ? (
                  <div className="grid grid-cols-5 gap-1">
                    {solidColorPalette.slice(0, 20).map((color, index) => (
                      <button
                        key={`solid-${index}`}
                        className="w-8 h-8 rounded border border-border hover:opacity-80 focus:ring-2 focus:ring-primary"
                        style={{ backgroundColor: color }}
                        onClick={() => handleSolidColorChange(color)}
                        title={color}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="grid grid-cols-3 gap-1">
                    {gradientPresets.map((preset, index) => (
                      <button
                        key={`gradient-${index}`}
                        className="h-10 rounded border border-border hover:opacity-80 focus:ring-2 focus:ring-primary"
                        style={{
                          background: `linear-gradient(${preset.angle}deg, ${preset.color1}, ${preset.color2})`
                        }}
                        onClick={() => applyGradientPreset(preset)}
                      />
                    ))}
                  </div>
                )}
              </div>
            </PopoverContent>
          </Popover>

          {/* Nothing is selected here, so only the wider scopes apply: without
              this the artboard reset would be unreachable until the user picked
              an element first. */}
          {renderLocaleResetControls(false)}
        </div>
      </div>
    );
  }

  // Element properties
  if (selectedElement) {
    return (
      <div className={cn("w-full h-full bg-card border-l shadow-md flex flex-col overflow-hidden", className)} suppressHydrationWarning>
        <div className="px-4 py-3 border-b bg-card">
          <div className="font-medium text-foreground">
            {ELEMENT_PANEL_TITLES[selectedElement.type] ??
              `${selectedElement.type.charAt(0).toUpperCase() + selectedElement.type.slice(1)} Properties`}
          </div>
          <ElementIdRow element={selectedElement} />
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4 text-sm">
          {selectedElement.type === 'text' && renderTextProperties(selectedElement as TextElementProps)}
          {selectedElement.type === 'shape' && renderShapeProperties(selectedElement as ShapeElementProps)}
          {selectedElement.type === 'device' && renderDeviceProperties(selectedElement as DeviceFrameElementProps)}
          {selectedElement.type === 'image' && renderImageProperties(selectedElement as ImageElementProps)}
          {selectedElement.type === 'video' && renderVideoProperties(selectedElement as VideoElementProps)}
          {selectedElement.type === 'video-device' && renderVideoDeviceProperties(selectedElement as VideoDeviceElementProps)}
          {selectedElement.type === 'gesture' && renderGestureProperties(selectedElement as GestureElementProps)}
          {/* "Other properties" belongs with the rest of the element's
              properties, above the video timeline block: it is the per-language
              detach list for base properties, not part of the animation. */}
          {renderLocaleBaseProperties(selectedElement)}
          {selectedElement.type !== 'gesture' && renderAnimationProperties(selectedElement)}
          {renderLocaleResetControls(selectedHasLocaleOverrides)}
        </div>

        {/* Move the hidden file input outside of device-specific rendering */}
        <Input
          type="file"
          ref={hiddenFileInputRef}
          onChange={handleFileSelected}
          className="hidden"
          accept="image/*"
        />
        <Input
          type="file"
          ref={videoFileInputRef}
          onChange={handleRecordingSelected}
          className="hidden"
          accept={VIDEO_ACCEPT}
        />
      </div>
    );
  }

  // Default fallback
  return (
    <div className={cn("w-full h-full bg-card border-l shadow-md flex flex-col overflow-hidden", className)} suppressHydrationWarning>
      <div className="px-4 py-3 border-b bg-card">
        <div className="font-medium text-foreground">Properties</div>
      </div>
      <div className="flex-1 overflow-y-auto px-4 py-3">
        <div className="text-sm text-muted-foreground">Select an element to view properties</div>
      </div>
    </div>
  );
}
