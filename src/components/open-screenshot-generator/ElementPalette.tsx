"use client";
import type React from 'react';
import { createContext, memo, useCallback, useContext, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  TypeIcon,
  SquareIcon,
  CircleIcon,
  TriangleIcon,
  SmartphoneIcon,
  TabletIcon,
  MonitorIcon,
  ImagePlusIcon,
  MessageCircleIcon,
  MessageSquareIcon,
  HexagonIcon,
  StarIcon,
  DiamondIcon,
  ImageIcon,
  ChevronLeftIcon,
  ClapperboardIcon,
  PointerIcon,
  MoveHorizontalIcon,
  MoveVerticalIcon,
  LaptopIcon,
  SearchIcon,
  XIcon,
  FilmIcon,
} from "lucide-react";
import type { ElementType, ShapeType, DeviceType } from '@/types/artboard';
import { ELEMENT_CATEGORIES, type ElementCategory, type LibraryElementDef } from '@/lib/elementLibrary';
import { IMAGE_CATEGORIES, type LibraryImageDef } from '@/lib/imageLibrary';
// 3D pose tables and colored flat presets live in lib/ so the MCP asset library
// lists exactly what these tiles drop (see lib/mcp/assetLibrary.ts).
import {
  POSE_ORDER,
  WATCH_POSE_ORDER,
  MACBOOK_POSE_ORDER,
  IMAC_POSE_ORDER,
  SIDES_3D,
  COLORS_3D,
  IPHONE_3D_SIZES,
  ANDROID_3D_SIZES,
  WATCH_3D_SIZES,
  MACBOOK_3D_SIZES,
  IMAC_3D_SIZES,
  COLORED_IPHONE_TILES,
  COLORED_ANDROID_TILES,
  coloredDeviceStyleProps,
  type ColoredDeviceTileDef,
} from '@/lib/device3dPresets';
import { withBasePath } from '@/lib/basePath';
import { useTouchDrag, type TouchDragBinding } from '@/hooks/use-touch-drag';
import {
  basicLibraryId,
  coloredDeviceLibraryId,
  device3dLibraryId,
  deviceLibraryId,
  elementLibraryId,
  imageLibraryId,
  previewLibraryId,
  previewSceneLibraryId,
} from '@/lib/libraryIds';
import {
  PREVIEW_SCENES,
  PREVIEW_SCENE_DRAG_TYPE,
  PREVIEW_SCENE_DURATION,
  PREVIEW_SCENE_SIZE,
  type PreviewSceneDef,
} from '@/lib/previewScenes';

type PaletteDragStart = (
  e: React.DragEvent<HTMLElement> | null,
  type: ElementType,
  subType?: ShapeType | DeviceType,
  styleProps?: Record<string, any>,
  libraryId?: string
) => void;

/**
 * What a tile carries onto a board, whether by mouse drag, tap or finger drag.
 * A Previews tile carries `sceneId` instead of `type`: it does not add a layer
 * to a board, it adds a board.
 */
export interface PaletteTilePayload {
  label: string;
  type?: ElementType;
  subType?: ShapeType | DeviceType;
  styleProps?: Record<string, any>;
  libraryId?: string;
  /** Set only by a Previews tile. See lib/previewScenes.ts. */
  sceneId?: string;
}

/**
 * Touch-drag handlers for a tile, supplied through context so all six kinds of
 * tile pick them up without another prop threaded through forty call sites.
 * Null on a mouse-only render path (nothing breaks; tiles just keep the native
 * HTML5 drag and the tap fallback).
 */
const TileTouchDragContext = createContext<((payload: PaletteTilePayload) => TouchDragBinding) | null>(null);

function useTileTouchDrag(payload: PaletteTilePayload) {
  const bind = useContext(TileTouchDragContext);
  return bind ? bind(payload) : {};
}

/**
 * Hover card for a palette tile: what it is, plus the library id the element
 * will carry once it is on the canvas (the Properties panel prints the same id).
 * Tiles are far too small to show a full id inline, so it lives here.
 */
const TileTooltip: React.FC<{ label: string; libraryId: string; children: React.ReactNode }> = ({
  label,
  libraryId,
  children,
}) => (
  <Tooltip>
    <TooltipTrigger asChild>{children}</TooltipTrigger>
    <TooltipContent side="right" className="max-w-[16rem] px-2.5 py-1.5">
      <div className="text-xs font-medium">{label}</div>
      <div className="mt-0.5 font-mono text-[10px] text-muted-foreground break-all">{libraryId}</div>
    </TooltipContent>
  </Tooltip>
);

/** Tile showing a pre-rendered 3D pose thumbnail, draggable like other palette items. */
const Device3DThumbTile: React.FC<{
  src: string;
  label: string;
  title: string;
  libraryId: string;
  deviceType: DeviceType;
  styleProps: Record<string, any>;
  onDragStart: PaletteDragStart;
}> = ({ src, label, title, libraryId, deviceType, styleProps, onDragStart }) => (
  <TileTooltip label={title} libraryId={libraryId}>
    <button
      type="button"
      className="flex flex-col items-center gap-1 group cursor-grab active:cursor-grabbing"
      draggable
      onDragStart={(e) => onDragStart(e, 'device', deviceType, styleProps, libraryId)}
      onClick={() => (onDragStart as any)(null, 'device', deviceType, styleProps, libraryId)}
      {...useTileTouchDrag({ label, type: 'device', subType: deviceType, styleProps, libraryId })}
      aria-label={`${title} (${libraryId})`}
    >
      <span className="w-full aspect-square rounded-lg bg-accent/10 group-hover:bg-accent/25 transition-colors flex items-center justify-center p-1.5 overflow-hidden">
        <img src={withBasePath(src)} alt="" className="max-w-full max-h-full object-contain pointer-events-none" draggable={false} />
      </span>
      <span className="text-[10px] text-muted-foreground group-hover:text-foreground transition-colors">{label}</span>
    </button>
  </TileTooltip>
);

/** Small SVG preview of a colored flat device frame. */
const ColoredDeviceGlyph: React.FC<{ def: ColoredDeviceTileDef }> = ({ def }) => {
  const frame = def.props.frameColor || '#111';
  const alpha = def.props.frameOpacity ?? 1;
  const outline = def.props.frameStyle === 'outline';
  const notch = def.props.notchColor || (def.kind === 'notch' ? frame : '#000');
  return (
    <svg viewBox="0 0 64 128" className="h-full" aria-hidden="true" focusable="false">
      <rect
        x="2" y="2" width="60" height="124" rx="13"
        fill={outline ? 'none' : frame}
        fillOpacity={outline ? undefined : alpha}
        stroke={outline ? frame : 'none'}
        strokeWidth={outline ? 3 : 0}
      />
      <rect x="6" y="6" width="52" height="116" rx="9" fill="#101016" />
      {def.kind === 'island' && <rect x="24" y="10" width="16" height="5" rx="2.5" fill={notch} />}
      {def.kind === 'notch' && <rect x="20" y="6" width="24" height="6" rx="3" fill={notch} />}
      {def.kind === 'punch' && <circle cx="32" cy="12" r="2.6" fill={notch} />}
    </svg>
  );
};

// ---- Device library categories (overview grid -> drill-in, like the Element Library) ----

type DeviceCategoryId = '3d-iphone' | '3d-android' | '3d-watch' | '3d-mac' | 'colored-iphone' | 'colored-android' | 'mockups';

const DEVICE_CATEGORY_LABELS: Record<DeviceCategoryId, string> = {
  '3d-iphone': '3D iPhone 17 Pro Max',
  '3d-android': '3D Android',
  '3d-watch': '3D Apple Watch',
  '3d-mac': '3D Mac',
  'colored-iphone': 'Colored iPhone',
  'colored-android': 'Colored Android',
  'mockups': 'Device Mockups',
};

// Representative thumbnails shown on the category cards in the overview grid.
const IPHONE_3D_PREVIEWS = ['upright-left-black', 'side-right-black', 'tilted-left-black', 'reclined-right-white', 'laying-left-white', 'upright-right-white'];
const ANDROID_3D_PREVIEWS = ['upright-left-black', 'side-right-black', 'tilted-left-black', 'reclined-right-white', 'laying-left-white', 'upright-right-white'];
const WATCH_3D_PREVIEWS = ['front-right-black', 'front-left-white', 'side-right-black', 'tilted-left-black', 'reclined-right-white', 'laying-left-white'];
const MAC_3D_PREVIEWS = ['macbook-front-right-black', 'imac-front-right-black', 'macbook-upright-right-white', 'imac-side-left-white', 'macbook-side-right-black', 'macbook-tilted-right-black'];

/** Category card for the device library overview (mini previews + label). */
const DeviceCategoryCard: React.FC<{ label: string; previews: React.ReactNode[]; onOpen: () => void }> = ({ label, previews, onOpen }) => (
  <button
    type="button"
    onClick={onOpen}
    className="flex flex-col items-center gap-1.5 group"
    title={`Browse ${label}`}
  >
    <div className="w-full aspect-square rounded-xl bg-accent/10 group-hover:bg-accent/25 transition-colors p-3 grid grid-cols-3 grid-rows-2 gap-2 place-items-center text-foreground/90">
      {previews.slice(0, 6).map((p, i) => (
        <div key={i} className="w-full h-full flex items-center justify-center overflow-hidden">{p}</div>
      ))}
    </div>
    <span className="text-xs text-muted-foreground group-hover:text-foreground transition-colors text-center leading-tight">{label}</span>
  </button>
);

/** Tile for a colored flat device preset. */
const ColoredDeviceTile: React.FC<{ def: ColoredDeviceTileDef; onDragStart: PaletteDragStart }> = ({ def, onDragStart }) => {
  const styleProps = coloredDeviceStyleProps(def);
  const libraryId = coloredDeviceLibraryId(def.id);
  const title = `Add ${def.label}`;
  return (
    <TileTooltip label={title} libraryId={libraryId}>
      <button
        type="button"
        className="flex flex-col items-center gap-1 group cursor-grab active:cursor-grabbing"
        draggable
        onDragStart={(e) => onDragStart(e, 'device', def.device, styleProps, libraryId)}
        onClick={() => (onDragStart as any)(null, 'device', def.device, styleProps, libraryId)}
        {...useTileTouchDrag({ label: def.label, type: 'device', subType: def.device, styleProps, libraryId })}
        aria-label={`${title} (${libraryId})`}
      >
        <span className="w-full aspect-square rounded-lg bg-accent/10 group-hover:bg-accent/25 transition-colors flex items-center justify-center p-2 overflow-hidden">
          <ColoredDeviceGlyph def={def} />
        </span>
        <span className="text-[10px] text-muted-foreground group-hover:text-foreground transition-colors text-center leading-tight">{def.label}</span>
      </button>
    </TileTooltip>
  );
};

/** Tile for a ready-made image asset (Images tab), draggable like other palette items. */
const ImageLibraryTile: React.FC<{
  item: LibraryImageDef;
  onDragStart: PaletteDragStart;
}> = ({ item, onDragStart }) => {
  const styleProps = {
    imageSrc: item.src,
    imageAlt: item.label,
    name: item.label,
    defaultSize: item.defaultSize,
  };
  const libraryId = imageLibraryId(item.id);
  return (
    <TileTooltip label={`Add ${item.label}`} libraryId={libraryId}>
      <button
        type="button"
        className="flex flex-col items-center gap-1 group cursor-grab active:cursor-grabbing"
        draggable
        onDragStart={(e) => onDragStart(e, 'image', undefined, styleProps, libraryId)}
        onClick={() => (onDragStart as any)(null, 'image', undefined, styleProps, libraryId)}
        {...useTileTouchDrag({ label: item.label, type: 'image', styleProps, libraryId })}
        aria-label={`Add ${item.label} (${libraryId})`}
      >
        <span className="aspect-square w-full rounded-lg bg-accent/10 group-hover:bg-accent/25 transition-colors flex items-center justify-center p-2 overflow-hidden">
          <img src={withBasePath(item.src)} alt="" className="max-w-full max-h-full object-contain pointer-events-none" draggable={false} />
        </span>
        <span className="text-[10px] text-muted-foreground group-hover:text-foreground transition-colors text-center leading-tight">{item.label}</span>
      </button>
    </TileTooltip>
  );
};

/**
 * The Previews tab thumbnail. Deliberately ONE generic glyph for every scene,
 * tinted with that scene's accent: a real thumbnail here would have to be
 * regenerated whenever a scene is retouched, and at 64px the name is what a
 * user actually reads anyway.
 */
const SceneThumb: React.FC<{ accent: string }> = ({ accent }) => (
  <svg viewBox="0 0 64 88" className="h-full w-full" aria-hidden="true" focusable="false">
    <defs>
      <linearGradient id={`scene-bg-${accent.replace('#', '')}`} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor={accent} stopOpacity="0.95" />
        <stop offset="100%" stopColor={accent} stopOpacity="0.5" />
      </linearGradient>
    </defs>
    <rect x="0" y="0" width="64" height="88" rx="9" fill={`url(#scene-bg-${accent.replace('#', '')})`} />
    {/* headline block */}
    <rect x="9" y="10" width="34" height="5" rx="2.5" fill="#fff" fillOpacity="0.95" />
    <rect x="9" y="19" width="22" height="5" rx="2.5" fill="#fff" fillOpacity="0.6" />
    {/* phone with a play badge */}
    <rect x="17" y="32" width="30" height="52" rx="6" fill="#0B0D14" fillOpacity="0.85" />
    <rect x="20" y="35" width="24" height="46" rx="4" fill="#fff" fillOpacity="0.22" />
    <circle cx="32" cy="58" r="8.5" fill="#fff" fillOpacity="0.95" />
    <path d="M29.5 53.5 L37 58 L29.5 62.5 Z" fill={accent} />
  </svg>
);

/**
 * One App Preview scene. Draggable onto the canvas and clickable, like every
 * other palette tile, except what lands is a whole artboard.
 */
const PreviewSceneTile: React.FC<{
  scene: PreviewSceneDef;
  onAdd: (sceneId: string) => void;
  onDragStart: (e: React.DragEvent<HTMLElement>, sceneId: string) => void;
}> = ({ scene, onAdd, onDragStart }) => {
  const libraryId = previewSceneLibraryId(scene.id);
  return (
    <TileTooltip label={`Add the ${scene.label} preview board`} libraryId={libraryId}>
      <button
        type="button"
        className="group flex w-full items-center gap-3 rounded-lg p-2 text-left transition-colors hover:bg-accent/25 cursor-grab active:cursor-grabbing"
        draggable
        onDragStart={(e) => onDragStart(e, scene.id)}
        onClick={() => onAdd(scene.id)}
        {...useTileTouchDrag({ label: scene.label, sceneId: scene.id, libraryId })}
        aria-label={`Add the ${scene.label} preview board (${libraryId})`}
      >
        <span className="h-[68px] w-[50px] shrink-0 overflow-hidden rounded-lg shadow-sm">
          <SceneThumb accent={scene.accent} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-semibold leading-tight text-foreground">{scene.label}</span>
          <span className="mt-0.5 block text-[11px] leading-snug text-muted-foreground">{scene.blurb}</span>
          <span className="mt-1 block font-mono text-[10px] leading-none text-muted-foreground/80">
            {PREVIEW_SCENE_DURATION}s · {scene.elements.length} layers
          </span>
        </span>
      </button>
    </TileTooltip>
  );
};

interface ElementPaletteProps {
  onAddElement: (type: ElementType, subType?: ShapeType | DeviceType, styleProps?: Record<string, any>) => void;
  /**
   * A Previews tile was clicked, or dropped with a finger. `point` is in client
   * coordinates when it came from a drag, so the host can insert the new board
   * after whichever one it landed on. Absent on a host that has no canvas.
   */
  onAddPreviewScene?: (sceneId: string, point?: { x: number; y: number }) => void;
  /**
   * A tile dragged with a finger and let go over the canvas. The point is in
   * client coordinates; the layout works out which board is under it. Absent on
   * a mouse-only host, where the HTML5 drop path covers this.
   */
  onDropElement?: (
    type: ElementType,
    subType: ShapeType | DeviceType | undefined,
    styleProps: Record<string, any> | undefined,
    point: { x: number; y: number }
  ) => void;
}

/**
 * An icon tile in the Elements tab's hand-written groups (Basic, App Preview).
 * Kept as data, not JSX, so the search box can match these the same way it
 * matches the generated vector library.
 */
interface IconTileDef {
  /** Library id suffix; the full id is `basic:<id>` or `preview:<id>`. */
  id: string;
  label: string;
  type: ElementType;
  subType?: ShapeType | DeviceType;
  icon: React.ReactNode;
  styleProps?: Record<string, any>;
  /** Extra words search should match, e.g. 'square' finding the rectangle. */
  keywords?: string;
}

const BASIC_TILES: IconTileDef[] = [
  { id: 'text', label: 'Text', type: 'text', icon: <TypeIcon className="w-6 h-6 text-primary" />, keywords: 'label heading title caption type' },
  { id: 'image', label: 'Image', type: 'image', icon: <ImageIcon className="w-6 h-6 text-primary" />, keywords: 'photo picture upload' },
  { id: 'rectangle', label: 'Rectangle', type: 'shape', subType: 'rectangle', icon: <SquareIcon className="w-6 h-6 text-primary" />, keywords: 'square box rect block' },
  { id: 'circle', label: 'Circle', type: 'shape', subType: 'circle', icon: <CircleIcon className="w-6 h-6 text-primary" />, keywords: 'round ellipse dot ring' },
  { id: 'triangle', label: 'Triangle', type: 'shape', subType: 'triangle', icon: <TriangleIcon className="w-6 h-6 text-primary" />, keywords: 'arrow point' },
  { id: 'star', label: 'Star', type: 'shape', subType: 'star', icon: <StarIcon className="w-6 h-6 text-primary" />, styleProps: { customPoints: 5 }, keywords: 'rating favourite favorite' },
  { id: 'hexagon', label: 'Hexagon', type: 'shape', subType: 'hexagon', icon: <HexagonIcon className="w-6 h-6 text-primary" />, keywords: 'polygon six' },
  { id: 'diamond', label: 'Diamond', type: 'shape', subType: 'diamond', icon: <DiamondIcon className="w-6 h-6 text-primary" />, keywords: 'rhombus kite' },
  {
    id: 'message', label: 'Message', type: 'shape', subType: 'message',
    icon: <MessageSquareIcon className="w-6 h-6 text-primary" />,
    styleProps: { clipPath: 'polygon(0% 0%, 100% 0%, 100% 75%, 75% 75%, 75% 100%, 50% 75%, 0% 75%)' },
    keywords: 'chat bubble comment callout',
  },
  {
    id: 'speech-bubble', label: 'Speech', type: 'shape', subType: 'speech-bubble',
    icon: <MessageCircleIcon className="w-6 h-6 text-primary" />,
    styleProps: { clipPath: 'polygon(0% 0%, 100% 0%, 100% 75%, 85% 75%, 70% 100%, 70% 75%, 0% 75%)' },
    keywords: 'chat bubble comment callout talk',
  },
  { id: 'pentagon', label: 'Pentagon', type: 'shape', subType: 'pentagon', icon: <div className="w-6 h-6 flex items-center justify-center text-primary">5⬠</div>, keywords: 'polygon five' },
];

const PREVIEW_TILES: IconTileDef[] = [
  { id: 'iphone-recording', label: 'iPhone + Recording', type: 'video-device', subType: 'iphone-15-pro', icon: <SmartphoneIcon className="w-6 h-6 text-primary" />, styleProps: { name: 'iPhone Recording' }, keywords: 'video mockup screen capture apple' },
  { id: 'android-recording', label: 'Android + Recording', type: 'video-device', subType: 'android-punch-hole', icon: <SmartphoneIcon className="w-6 h-6 text-primary" />, styleProps: { name: 'Android Recording', defaultSize: { width: 520, height: 1073 } }, keywords: 'video mockup screen capture google' },
  { id: 'recording', label: 'Recording (no frame)', type: 'video', icon: <ClapperboardIcon className="w-6 h-6 text-primary" />, keywords: 'video clip movie mp4 frameless' },
  { id: 'tap', label: 'Tap', type: 'gesture', icon: <PointerIcon className="w-6 h-6 text-primary" />, styleProps: { gestureType: 'tap', name: 'Tap hint' }, keywords: 'gesture touch press click hint' },
  { id: 'double-tap', label: 'Double Tap', type: 'gesture', icon: <PointerIcon className="w-6 h-6 text-primary" />, styleProps: { gestureType: 'double-tap', name: 'Double tap hint' }, keywords: 'gesture touch press click hint' },
  { id: 'swipe-left', label: 'Swipe Left', type: 'gesture', icon: <MoveHorizontalIcon className="w-6 h-6 text-primary" />, styleProps: { gestureType: 'swipe-left', name: 'Swipe left hint', defaultSize: { width: 320, height: 160 } }, keywords: 'gesture drag scroll hint' },
  { id: 'swipe-right', label: 'Swipe Right', type: 'gesture', icon: <MoveHorizontalIcon className="w-6 h-6 text-primary" />, styleProps: { gestureType: 'swipe-right', name: 'Swipe right hint', defaultSize: { width: 320, height: 160 } }, keywords: 'gesture drag scroll hint' },
  { id: 'swipe-up', label: 'Swipe Up', type: 'gesture', icon: <MoveVerticalIcon className="w-6 h-6 text-primary" />, styleProps: { gestureType: 'swipe-up', name: 'Swipe up hint', defaultSize: { width: 160, height: 320 } }, keywords: 'gesture drag scroll hint' },
  { id: 'swipe-down', label: 'Swipe Down', type: 'gesture', icon: <MoveVerticalIcon className="w-6 h-6 text-primary" />, styleProps: { gestureType: 'swipe-down', name: 'Swipe down hint', defaultSize: { width: 160, height: 320 } }, keywords: 'gesture drag scroll hint' },
];

// The two hand-written groups, flattened once with their full library ids and a
// pre-lowercased haystack, so typing in the search box is a plain substring scan.
const ICON_TILE_INDEX = [
  ...BASIC_TILES.map((tile) => ({ tile, libraryId: basicLibraryId(tile.id), group: 'Basic' })),
  ...PREVIEW_TILES.map((tile) => ({ tile, libraryId: previewLibraryId(tile.id), group: 'App Preview' })),
].map((entry) => ({
  ...entry,
  haystack: `${entry.tile.label} ${entry.libraryId} ${entry.group} ${entry.tile.keywords ?? ''}`.toLowerCase(),
}));

// Same for the generated vector library. Built once at module load (461 items),
// so keystrokes only filter, never rebuild.
const LIBRARY_ITEM_INDEX = ELEMENT_CATEGORIES.flatMap((category) =>
  category.items.map((item) => {
    const libraryId = elementLibraryId(item.id);
    return {
      item,
      libraryId,
      group: category.label,
      haystack: `${item.label} ${libraryId} ${category.label}`.toLowerCase(),
    };
  })
);

const DraggableItem: React.FC<{
  onDragStart: PaletteDragStart,
  type: ElementType,
  subType?: ShapeType | DeviceType,
  label: string,
  libraryId: string,
  icon: React.ReactNode,
  className?: string,
  styleProps?: Record<string, any>
}> =
  ({ onDragStart, type, subType, label, libraryId, icon, className, styleProps }) => {
  return (
    <TileTooltip label={`Add ${label}`} libraryId={libraryId}>
      <Button
        variant="ghost"
        className={`w-full justify-start p-2 h-auto text-left ${className}`}
        draggable
        onDragStart={(e) => onDragStart(e, type, subType, styleProps, libraryId)}
        onClick={() => (onDragStart as any)(null, type, subType, styleProps, libraryId)} // Fallback for click
        {...useTileTouchDrag({ label, type, subType, styleProps, libraryId })}
        aria-label={`Add ${label} (${libraryId})`}
      >
        <div className="flex flex-col items-center text-center w-full">
          <div className="p-2 rounded-md bg-accent/10 mb-1">{icon}</div>
          <span className="text-xs">{label}</span>
        </div>
      </Button>
    </TileTooltip>
  );
}

/** Renders a library element's SVG path data as a small preview glyph. */
const ElementPreview: React.FC<{ item: LibraryElementDef; className?: string }> = ({ item, className }) => {
  const special = item.styleProps.specialProps || {};
  const strokeOnly = !!special.strokeOnly;
  const baseStrokeWidth = special.baseStrokeWidth ?? 4;
  const previewStrokeWidth = Math.min(3, Math.max(1.4, baseStrokeWidth * 0.18));
  return (
    <svg viewBox={special.viewBox || '0 0 100 100'} className={className} aria-hidden="true" focusable="false">
      <path
        d={item.styleProps.customPath}
        fill={strokeOnly ? 'none' : 'currentColor'}
        fillRule={special.fillRule === 'evenodd' ? 'evenodd' : undefined}
        stroke={strokeOnly ? 'currentColor' : 'none'}
        strokeWidth={strokeOnly ? previewStrokeWidth : undefined}
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
};

/** Single draggable/clickable tile inside an open library category. */
const LibraryItemTile: React.FC<{
  item: LibraryElementDef;
  onDragStart: PaletteDragStart;
}> = ({ item, onDragStart }) => {
  const libraryId = elementLibraryId(item.id);
  return (
    <TileTooltip label={`Add ${item.label}`} libraryId={libraryId}>
      <button
        type="button"
        className="aspect-square w-full rounded-lg bg-accent/10 hover:bg-accent/25 transition-colors flex items-center justify-center p-2.5 text-foreground/90 cursor-grab active:cursor-grabbing"
        draggable
        onDragStart={(e) => onDragStart(e, 'shape', 'custom-svg', item.styleProps, libraryId)}
        onClick={() => (onDragStart as any)(null, 'shape', 'custom-svg', item.styleProps, libraryId)}
        {...useTileTouchDrag({ label: item.label, type: 'shape', subType: 'custom-svg', styleProps: item.styleProps, libraryId })}
        aria-label={`Add ${item.label} (${libraryId})`}
      >
        <ElementPreview item={item} className="w-full h-full" />
      </button>
    </TileTooltip>
  );
};

/** Category card shown in the library overview grid (mini previews + label). */
const CategoryCard: React.FC<{ category: ElementCategory; onOpen: (id: string) => void }> = ({ category, onOpen }) => {
  return (
    <button
      type="button"
      onClick={() => onOpen(category.id)}
      className="flex flex-col items-center gap-1.5 group"
      title={`Browse ${category.label}`}
    >
      <div className="w-full aspect-square rounded-xl bg-accent/10 group-hover:bg-accent/25 transition-colors p-3 grid grid-cols-3 grid-rows-2 gap-2 place-items-center text-foreground/90">
        {category.items.slice(0, 6).map(item => (
          <ElementPreview key={item.id} item={item} className="w-full h-full" />
        ))}
      </div>
      <span className="text-xs text-muted-foreground group-hover:text-foreground transition-colors">{category.label}</span>
    </button>
  );
};

/**
 * Memoized: the palette holds hundreds of tiles (up to 481 in a search) and
 * nothing in it depends on canvas state, so it must not rebuild every time the
 * layout re-renders. Pass a stable `onAddElement` or the memo does nothing.
 */
export const ElementPalette = memo(function ElementPalette({ onAddElement, onDropElement, onAddPreviewScene }: ElementPaletteProps) {
  const [openCategoryId, setOpenCategoryId] = useState<string | null>(null);
  const openCategory = ELEMENT_CATEGORIES.find(c => c.id === openCategoryId) || null;

  // Elements search. Matches an item's name, its library id and its group, so
  // "arrow", "element:arrow-curve" and "arrows" all land on the same tiles.
  // Results replace the category view while the box has text; the open category
  // is kept, so clearing the box returns to where the user was.
  const [elementQuery, setElementQuery] = useState('');
  const deferredElementQuery = useDeferredValue(elementQuery);
  const searchTerm = deferredElementQuery.trim().toLowerCase();
  const elementResults = useMemo(() => {
    if (!searchTerm) return null;
    return {
      icons: ICON_TILE_INDEX.filter(entry => entry.haystack.includes(searchTerm)),
      library: LIBRARY_ITEM_INDEX.filter(entry => entry.haystack.includes(searchTerm)),
    };
  }, [searchTerm]);
  const resultCount = elementResults ? elementResults.icons.length + elementResults.library.length : 0;
  const [openDeviceCategoryId, setOpenDeviceCategoryId] = useState<DeviceCategoryId | null>(null);
  const [openImageCategoryId, setOpenImageCategoryId] = useState<string | null>(null);
  const openImageCategory = IMAGE_CATEGORIES.find(c => c.id === openImageCategoryId) || null;

  // The layout swaps to the template-selector screen (and back) while a
  // project loads, remounting this palette — keep the chosen tab sticky so it
  // doesn't silently reset to Elements. (Restored in an effect to avoid an
  // SSR hydration mismatch.)
  const [activeTab, setActiveTab] = useState('elements');
  useEffect(() => {
    const saved = window.sessionStorage.getItem('palette-active-tab');
    // 'layers' was a palette tab before the layers panel moved to the floating
    // bottom-right card; a stale saved value would select a tab that no longer
    // exists and blank the palette.
    if (saved && saved !== 'layers' && saved !== activeTab) setActiveTab(saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const handleTabChange = (value: string) => {
    setActiveTab(value);
    try { window.sessionStorage.setItem('palette-active-tab', value); } catch {}
  };

  // The tile's library id rides along in styleProps (both for a drag and a
  // click), so addElement can stamp it on the new element and the Properties
  // panel can show where the layer came from.
  const handleDragStart: PaletteDragStart = (e, type, subType, styleProps, libraryId) => {
    const props = libraryId ? { ...styleProps, libraryId } : styleProps;
    if (e) { // Drag event
      e.dataTransfer.setData('application/artboard-element-type', type);
      if (subType) {
        e.dataTransfer.setData('application/artboard-element-subtype', subType);
      }
      if (props) {
        e.dataTransfer.setData('application/artboard-element-styleprops', JSON.stringify(props));
      }
    } else { // Click event (simulated drag)
      onAddElement(type, subType, props);
    }
  };

  /** A Previews tile picked up with the mouse. Carries only the scene id. */
  const handleSceneDragStart = useCallback((e: React.DragEvent<HTMLElement>, sceneId: string) => {
    e.dataTransfer.setData(PREVIEW_SCENE_DRAG_TYPE, sceneId);
    e.dataTransfer.effectAllowed = 'copy';
  }, []);

  const handleSceneClick = useCallback(
    (sceneId: string) => {
      onAddPreviewScene?.(sceneId);
    },
    [onAddPreviewScene]
  );

  // Finger drags. A tile held for a moment lifts out of the palette and follows
  // the finger; letting go over a board drops the element there, exactly where
  // a mouse drag would have put it.
  const handleTouchDrop = useCallback(
    (payload: PaletteTilePayload, point: { x: number; y: number }) => {
      if (payload.sceneId) {
        onAddPreviewScene?.(payload.sceneId, point);
        return;
      }
      if (!payload.type) return;
      const props = payload.libraryId ? { ...payload.styleProps, libraryId: payload.libraryId } : payload.styleProps;
      if (onDropElement) {
        onDropElement(payload.type, payload.subType, props, point);
      } else {
        onAddElement(payload.type, payload.subType, props);
      }
    },
    [onAddElement, onDropElement, onAddPreviewScene]
  );
  const { bind: bindTileTouchDrag, ghostNode } = useTouchDrag<PaletteTilePayload>({ onDrop: handleTouchDrop });

  return (
    <TileTouchDragContext.Provider value={bindTileTouchDrag}>
    <TooltipProvider delayDuration={200}>
    {ghostNode}
    <div className="h-full flex flex-col">
      <Tabs value={activeTab} onValueChange={handleTabChange} className="h-full flex flex-col">
        <TabsList className="grid w-[95%] grid-cols-4 mx-auto mt-2 h-auto p-0.5">
          <TabsTrigger value="elements" className="flex flex-col items-center gap-0.5 px-0.5 py-1.5 h-auto text-[10px] leading-none">
            <TypeIcon className="w-4 h-4" />
            Elements
          </TabsTrigger>
          <TabsTrigger value="devices" className="flex flex-col items-center gap-0.5 px-0.5 py-1.5 h-auto text-[10px] leading-none">
            <SmartphoneIcon className="w-4 h-4" />
            Devices
          </TabsTrigger>
          <TabsTrigger value="images" className="flex flex-col items-center gap-0.5 px-0.5 py-1.5 h-auto text-[10px] leading-none">
            <ImageIcon className="w-4 h-4" />
            Images
          </TabsTrigger>
          <TabsTrigger value="previews" className="flex flex-col items-center gap-0.5 px-0.5 py-1.5 h-auto text-[10px] leading-none">
            <FilmIcon className="w-4 h-4" />
            Previews
          </TabsTrigger>
        </TabsList>

        {/* Rule: no bare `flex` on TabsContent (it defeats [hidden]), and no
            Radix ScrollArea under flex-1 — the search box needs a sibling
            scroll region, so this tab uses a native overflow-y-auto div. */}
        <TabsContent value="elements" className="flex-grow p-3 pt-2 mt-0 min-h-0 flex-col gap-2 data-[state=active]:flex">
          <div className="relative shrink-0">
            <SearchIcon className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={elementQuery}
              onChange={(event) => setElementQuery(event.target.value)}
              placeholder="Search by name or id"
              aria-label="Search elements by name or id"
              className="h-8 pl-8 pr-7 text-xs"
            />
            {elementQuery && (
              <button
                type="button"
                onClick={() => setElementQuery('')}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
                title="Clear search"
                aria-label="Clear search"
              >
                <XIcon className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {elementResults ? (
              <div>
                <p className="mb-2 px-1 text-[11px] text-muted-foreground">
                  {resultCount === 0
                    ? `Nothing matches "${searchTerm}". Try a name like "arrow", or an id like "element:star".`
                    : `${resultCount} ${resultCount === 1 ? 'match' : 'matches'} for "${searchTerm}"`}
                </p>
                {elementResults.icons.length > 0 && (
                  <div className="grid grid-cols-3 gap-2 pr-1">
                    {elementResults.icons.map(({ tile, libraryId }) => (
                      <DraggableItem
                        key={libraryId}
                        onDragStart={handleDragStart}
                        type={tile.type}
                        subType={tile.subType}
                        label={tile.label}
                        libraryId={libraryId}
                        icon={tile.icon}
                        styleProps={tile.styleProps}
                      />
                    ))}
                  </div>
                )}
                {elementResults.library.length > 0 && (
                  <div className={`grid grid-cols-3 gap-2 pr-1 ${elementResults.icons.length > 0 ? 'mt-2' : ''}`}>
                    {elementResults.library.map(({ item }) => (
                      <LibraryItemTile key={item.id} item={item} onDragStart={handleDragStart} />
                    ))}
                  </div>
                )}
              </div>
            ) : openCategoryId === 'app-preview' ? (
              <div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="mb-2 h-7 px-1.5 text-xs"
                  onClick={() => setOpenCategoryId(null)}
                >
                  <ChevronLeftIcon className="w-4 h-4 mr-0.5" />
                  Back
                </Button>
                <p className="text-[11px] text-muted-foreground mb-2 px-1">
                  Build App Store preview videos: put your screen recording in a
                  phone, add gesture hints, then export the MP4.
                </p>
                <div className="grid grid-cols-3 gap-2 pr-1">
                  {PREVIEW_TILES.map(tile => (
                    <DraggableItem
                      key={tile.id}
                      onDragStart={handleDragStart}
                      type={tile.type}
                      subType={tile.subType}
                      label={tile.label}
                      libraryId={previewLibraryId(tile.id)}
                      icon={tile.icon}
                      styleProps={tile.styleProps}
                    />
                  ))}
                </div>
              </div>
            ) : openCategoryId === 'basic' ? (
              <div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="mb-2 h-7 px-1.5 text-xs"
                  onClick={() => setOpenCategoryId(null)}
                >
                  <ChevronLeftIcon className="w-4 h-4 mr-0.5" />
                  Back
                </Button>
                <div className="grid grid-cols-3 gap-2 pr-1">
                  {BASIC_TILES.map(tile => (
                    <DraggableItem
                      key={tile.id}
                      onDragStart={handleDragStart}
                      type={tile.type}
                      subType={tile.subType}
                      label={tile.label}
                      libraryId={basicLibraryId(tile.id)}
                      icon={tile.icon}
                      styleProps={tile.styleProps}
                    />
                  ))}
                </div>
              </div>
            ) : openCategory ? (
              <div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="mb-2 h-7 px-1.5 text-xs"
                  onClick={() => setOpenCategoryId(null)}
                >
                  <ChevronLeftIcon className="w-4 h-4 mr-0.5" />
                  Back
                </Button>
                <div className="grid grid-cols-3 gap-2 pr-1">
                  {openCategory.items.map(item => (
                    <LibraryItemTile key={item.id} item={item} onDragStart={handleDragStart} />
                  ))}
                </div>
              </div>
            ) : (
              <Card className="shadow-md">
                <CardHeader className="p-3">
                  <CardTitle className="text-base">Element Library</CardTitle>
                </CardHeader>
                <CardContent className="p-2 grid grid-cols-2 gap-x-2 gap-y-3">
                  <DeviceCategoryCard
                    label="Basic"
                    onOpen={() => setOpenCategoryId('basic')}
                    previews={[
                      <TypeIcon key="t" className="w-5 h-5 text-primary" />,
                      <ImageIcon key="i" className="w-5 h-5 text-primary" />,
                      <SquareIcon key="s" className="w-5 h-5 text-primary" />,
                      <CircleIcon key="c" className="w-5 h-5 text-primary" />,
                      <TriangleIcon key="tr" className="w-5 h-5 text-primary" />,
                      <StarIcon key="st" className="w-5 h-5 text-primary" />,
                    ]}
                  />
                  <DeviceCategoryCard
                    label="App Preview"
                    onOpen={() => setOpenCategoryId('app-preview')}
                    previews={[
                      <ClapperboardIcon key="v" className="w-5 h-5 text-primary" />,
                      <PointerIcon key="p" className="w-5 h-5 text-primary" />,
                      <MoveHorizontalIcon key="h" className="w-5 h-5 text-primary" />,
                      <MoveVerticalIcon key="vv" className="w-5 h-5 text-primary" />,
                      <PointerIcon key="p2" className="w-5 h-5 text-primary rotate-12" />,
                      <ClapperboardIcon key="v2" className="w-5 h-5 text-primary -rotate-6" />,
                    ]}
                  />
                  {ELEMENT_CATEGORIES.map(category => (
                    <CategoryCard key={category.id} category={category} onOpen={setOpenCategoryId} />
                  ))}
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>

        <TabsContent value="devices" className="flex-grow p-3 pt-2 mt-0 min-h-0">
          <ScrollArea className="h-full">
            {openDeviceCategoryId ? (
              <div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="mb-2 h-7 px-1.5 text-xs"
                  onClick={() => setOpenDeviceCategoryId(null)}
                >
                  <ChevronLeftIcon className="w-4 h-4 mr-0.5" />
                  Back
                </Button>
                <div className="grid grid-cols-2 gap-x-2 gap-y-3 pr-1">
                  {openDeviceCategoryId === '3d-iphone' &&
                    COLORS_3D.map((color) =>
                      POSE_ORDER.map((pose) =>
                        SIDES_3D.map((side) => (
                          <Device3DThumbTile
                            key={`ip17-${color}-${pose}-${side}`}
                            src={`/elements/device-3d/iphone-${pose}-${side}-${color}.png`}
                            label={color === 'black' ? 'Black' : 'White'}
                            title={`Add iPhone 17 Pro Max 3D, ${pose} ${side} (${color})`}
                            libraryId={device3dLibraryId('iphone', pose, side, color)}
                            deviceType="iphone-17-pro-max"
                            styleProps={{
                              styleType: side === 'left' ? '3d-left' : '3d-right',
                              pose3d: pose,
                              frameColor3d: color,
                              defaultSize: IPHONE_3D_SIZES[pose],
                            }}
                            onDragStart={handleDragStart}
                          />
                        ))
                      )
                    )}
                  {openDeviceCategoryId === '3d-android' &&
                    COLORS_3D.map((color) =>
                      POSE_ORDER.map((pose) =>
                        SIDES_3D.map((side) => (
                          <Device3DThumbTile
                            key={`and3d-${color}-${pose}-${side}`}
                            src={`/elements/device-3d/android-${pose}-${side}-${color}.png`}
                            label={color === 'black' ? 'Black' : 'White'}
                            title={`Add Android 3D, ${pose} ${side} (${color})`}
                            libraryId={device3dLibraryId('android', pose, side, color)}
                            deviceType="android-punch-hole"
                            styleProps={{
                              styleType: side === 'left' ? '3d-left' : '3d-right',
                              pose3d: pose,
                              frameColor3d: color,
                              defaultSize: ANDROID_3D_SIZES[pose],
                            }}
                            onDragStart={handleDragStart}
                          />
                        ))
                      )
                    )}
                  {openDeviceCategoryId === '3d-watch' &&
                    COLORS_3D.map((color) =>
                      WATCH_POSE_ORDER.map((pose) =>
                        SIDES_3D.map((side) => (
                          <Device3DThumbTile
                            key={`watch-${color}-${pose}-${side}`}
                            src={`/elements/device-3d/watch-${pose}-${side}-${color}.png`}
                            label={color === 'black' ? 'Black' : 'White'}
                            title={`Add Apple Watch 3D, ${pose} ${side} (${color})`}
                            libraryId={device3dLibraryId('watch', pose, side, color)}
                            deviceType="apple-watch"
                            styleProps={{
                              styleType: side === 'left' ? '3d-left' : '3d-right',
                              pose3d: pose,
                              frameColor3d: color,
                              defaultSize: WATCH_3D_SIZES[pose],
                            }}
                            onDragStart={handleDragStart}
                          />
                        ))
                      )
                    )}
                  {openDeviceCategoryId === '3d-mac' && (
                    <>
                      {COLORS_3D.map((color) =>
                        MACBOOK_POSE_ORDER.map((pose) =>
                          SIDES_3D.map((side) => (
                            <Device3DThumbTile
                              key={`mb-${color}-${pose}-${side}`}
                              src={`/elements/device-3d/macbook-${pose}-${side}-${color}.png`}
                              label={color === 'black' ? 'MacBook Black' : 'MacBook Silver'}
                              title={`Add MacBook 3D, ${pose} ${side} (${color})`}
                              libraryId={device3dLibraryId('macbook', pose, side, color)}
                              deviceType="macbook"
                              styleProps={{
                                styleType: side === 'left' ? '3d-left' : '3d-right',
                                pose3d: pose,
                                frameColor3d: color,
                                defaultSize: MACBOOK_3D_SIZES[pose],
                              }}
                              onDragStart={handleDragStart}
                            />
                          ))
                        )
                      )}
                      {COLORS_3D.map((color) =>
                        IMAC_POSE_ORDER.map((pose) =>
                          SIDES_3D.map((side) => (
                            <Device3DThumbTile
                              key={`im-${color}-${pose}-${side}`}
                              src={`/elements/device-3d/imac-${pose}-${side}-${color}.png`}
                              label={color === 'black' ? 'iMac Black' : 'iMac Silver'}
                              title={`Add iMac 3D, ${pose} ${side} (${color})`}
                              libraryId={device3dLibraryId('imac', pose, side, color)}
                              deviceType="imac"
                              styleProps={{
                                styleType: side === 'left' ? '3d-left' : '3d-right',
                                pose3d: pose,
                                frameColor3d: color,
                                defaultSize: IMAC_3D_SIZES[pose],
                              }}
                              onDragStart={handleDragStart}
                            />
                          ))
                        )
                      )}
                    </>
                  )}
                  {openDeviceCategoryId === 'colored-iphone' &&
                    COLORED_IPHONE_TILES.map((def) => (
                      <ColoredDeviceTile key={def.id} def={def} onDragStart={handleDragStart} />
                    ))}
                  {openDeviceCategoryId === 'colored-android' &&
                    COLORED_ANDROID_TILES.map((def) => (
                      <ColoredDeviceTile key={def.id} def={def} onDragStart={handleDragStart} />
                    ))}
                  {openDeviceCategoryId === 'mockups' && (
                    <>
                      <DraggableItem onDragStart={handleDragStart} type="device" subType="iphone-17-pro-max" label="iPhone 17 Pro Max" libraryId={deviceLibraryId('iphone-17-pro-max')} icon={<SmartphoneIcon className="w-6 h-6 text-primary" />} styleProps={{ defaultSize: { width: 600, height: 1304 } }} />
                      <DraggableItem onDragStart={handleDragStart} type="device" subType="iphone" label="iPhone" libraryId={deviceLibraryId('iphone')} icon={<SmartphoneIcon className="w-6 h-6 text-primary" />} styleProps={{ borderRadius: '28px' }} />
                      <DraggableItem onDragStart={handleDragStart} type="device" subType="iphone-15-pro" label="iPhone 15 Pro" libraryId={deviceLibraryId('iphone-15-pro')} icon={<SmartphoneIcon className="w-6 h-6 text-primary" />} styleProps={{ borderRadius: '28px' }} />
                      <DraggableItem onDragStart={handleDragStart} type="device" subType="iphone-15" label="iPhone 15" libraryId={deviceLibraryId('iphone-15')} icon={<SmartphoneIcon className="w-6 h-6 text-primary" />} styleProps={{ borderRadius: '28px' }} />
                      <DraggableItem onDragStart={handleDragStart} type="device" subType="iphone-14" label="iPhone 14" libraryId={deviceLibraryId('iphone-14')} icon={<SmartphoneIcon className="w-6 h-6 text-primary" />} styleProps={{ borderRadius: '26px' }} />
                      <DraggableItem onDragStart={handleDragStart} type="device" subType="iphone-13" label="iPhone 13" libraryId={deviceLibraryId('iphone-13')} icon={<SmartphoneIcon className="w-6 h-6 text-primary" />} styleProps={{ borderRadius: '24px' }} />
                      <DraggableItem onDragStart={handleDragStart} type="device" subType="iphone-x" label="iPhone X" libraryId={deviceLibraryId('iphone-x')} icon={<SmartphoneIcon className="w-6 h-6 text-primary" />} styleProps={{ borderRadius: '24px' }} />
                      <DraggableItem onDragStart={handleDragStart} type="device" subType="android-punch-hole" label="Android (Punch Hole)" libraryId={deviceLibraryId('android-punch-hole')} icon={<SmartphoneIcon className="w-6 h-6 text-primary" />} styleProps={{ borderRadius: '16px' }} />
                      <DraggableItem onDragStart={handleDragStart} type="device" subType="android-notch" label="Android (Notch)" libraryId={deviceLibraryId('android-notch')} icon={<SmartphoneIcon className="w-6 h-6 text-primary" />} styleProps={{ borderRadius: '16px' }} />
                      <DraggableItem onDragStart={handleDragStart} type="device" subType="android-bar" label="Android (Bar)" libraryId={deviceLibraryId('android-bar')} icon={<SmartphoneIcon className="w-6 h-6 text-primary" />} styleProps={{ borderRadius: '16px' }} />
                      <DraggableItem onDragStart={handleDragStart} type="device" subType="ipad-pro-13" label="iPad Pro 13-inch" libraryId={deviceLibraryId('ipad-pro-13')} icon={<TabletIcon className="w-6 h-6 text-primary" />} styleProps={{ borderRadius: '16px', defaultSize: { width: 780, height: 1040 } }} />
                      <DraggableItem onDragStart={handleDragStart} type="device" subType="ipad-11" label="iPad 11-inch" libraryId={deviceLibraryId('ipad-11')} icon={<TabletIcon className="w-6 h-6 text-primary" />} styleProps={{ borderRadius: '16px', defaultSize: { width: 740, height: 1074 } }} />
                      <DraggableItem onDragStart={handleDragStart} type="device" subType="tablet" label="Tablet" libraryId={deviceLibraryId('tablet')} icon={<TabletIcon className="w-6 h-6 text-primary" />} styleProps={{ borderRadius: '12px' }} />
                      <DraggableItem onDragStart={handleDragStart} type="device" subType="tablet-7" label="7-inch Tablet" libraryId={deviceLibraryId('tablet-7')} icon={<TabletIcon className="w-6 h-6 text-primary" />} styleProps={{ borderRadius: '12px', defaultSize: { width: 600, height: 960 } }} />
                      <DraggableItem onDragStart={handleDragStart} type="device" subType="tablet-10" label="10-inch Tablet" libraryId={deviceLibraryId('tablet-10')} icon={<TabletIcon className="w-6 h-6 text-primary" />} styleProps={{ borderRadius: '12px', defaultSize: { width: 700, height: 1120 } }} />
                      <DraggableItem onDragStart={handleDragStart} type="device" subType="macbook" label="MacBook" libraryId={deviceLibraryId('macbook')} icon={<LaptopIcon className="w-6 h-6 text-primary" />} styleProps={{ defaultSize: { width: 1000, height: 579 } }} />
                      <DraggableItem onDragStart={handleDragStart} type="device" subType="imac" label="iMac" libraryId={deviceLibraryId('imac')} icon={<MonitorIcon className="w-6 h-6 text-primary" />} styleProps={{ defaultSize: { width: 900, height: 668 } }} />
                      <DraggableItem onDragStart={handleDragStart} type="device" subType="desktop" label="Desktop" libraryId={deviceLibraryId('desktop')} icon={<MonitorIcon className="w-6 h-6 text-primary" />} styleProps={{ borderRadius: '8px' }} />
                      <DraggableItem onDragStart={handleDragStart} type="device" subType="custom" label="Custom" libraryId={deviceLibraryId('custom')} icon={<ImagePlusIcon className="w-6 h-6 text-primary" />} />
                    </>
                  )}
                </div>
              </div>
            ) : (
              <Card className="shadow-md">
                <CardHeader className="p-3">
                  <CardTitle className="text-base">Device Library</CardTitle>
                </CardHeader>
                <CardContent className="p-2 grid grid-cols-2 gap-x-2 gap-y-3">
                  <DeviceCategoryCard
                    label={DEVICE_CATEGORY_LABELS['3d-iphone']}
                    onOpen={() => setOpenDeviceCategoryId('3d-iphone')}
                    previews={IPHONE_3D_PREVIEWS.map((k) => (
                      <img key={k} src={withBasePath(`/elements/device-3d/iphone-${k}.png`)} alt="" className="max-w-full max-h-full object-contain" draggable={false} />
                    ))}
                  />
                  <DeviceCategoryCard
                    label={DEVICE_CATEGORY_LABELS['3d-android']}
                    onOpen={() => setOpenDeviceCategoryId('3d-android')}
                    previews={ANDROID_3D_PREVIEWS.map((k) => (
                      <img key={k} src={withBasePath(`/elements/device-3d/android-${k}.png`)} alt="" className="max-w-full max-h-full object-contain" draggable={false} />
                    ))}
                  />
                  <DeviceCategoryCard
                    label={DEVICE_CATEGORY_LABELS['3d-watch']}
                    onOpen={() => setOpenDeviceCategoryId('3d-watch')}
                    previews={WATCH_3D_PREVIEWS.map((k) => (
                      <img key={k} src={withBasePath(`/elements/device-3d/watch-${k}.png`)} alt="" className="max-w-full max-h-full object-contain" draggable={false} />
                    ))}
                  />
                  <DeviceCategoryCard
                    label={DEVICE_CATEGORY_LABELS['3d-mac']}
                    onOpen={() => setOpenDeviceCategoryId('3d-mac')}
                    previews={MAC_3D_PREVIEWS.map((k) => (
                      <img key={k} src={withBasePath(`/elements/device-3d/${k}.png`)} alt="" className="max-w-full max-h-full object-contain" draggable={false} />
                    ))}
                  />
                  <DeviceCategoryCard
                    label={DEVICE_CATEGORY_LABELS['colored-iphone']}
                    onOpen={() => setOpenDeviceCategoryId('colored-iphone')}
                    previews={COLORED_IPHONE_TILES.slice(0, 6).map((def, i) => (
                      <ColoredDeviceGlyph key={i} def={def} />
                    ))}
                  />
                  <DeviceCategoryCard
                    label={DEVICE_CATEGORY_LABELS['colored-android']}
                    onOpen={() => setOpenDeviceCategoryId('colored-android')}
                    previews={COLORED_ANDROID_TILES.slice(0, 6).map((def, i) => (
                      <ColoredDeviceGlyph key={i} def={def} />
                    ))}
                  />
                  <DeviceCategoryCard
                    label={DEVICE_CATEGORY_LABELS['mockups']}
                    onOpen={() => setOpenDeviceCategoryId('mockups')}
                    previews={[
                      <SmartphoneIcon key="a" className="w-5 h-5 text-primary" />,
                      <SmartphoneIcon key="b" className="w-5 h-5 text-primary rotate-6" />,
                      <TabletIcon key="c" className="w-5 h-5 text-primary" />,
                      <MonitorIcon key="d" className="w-5 h-5 text-primary" />,
                      <SmartphoneIcon key="e" className="w-5 h-5 text-primary -rotate-6" />,
                      <ImagePlusIcon key="f" className="w-5 h-5 text-primary" />,
                    ]}
                  />
                </CardContent>
              </Card>
            )}
          </ScrollArea>
        </TabsContent>

        <TabsContent value="images" className="flex-grow p-3 pt-2 mt-0 min-h-0">
          <ScrollArea className="h-full">
            {openImageCategory ? (
              <div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="mb-2 h-7 px-1.5 text-xs"
                  onClick={() => setOpenImageCategoryId(null)}
                >
                  <ChevronLeftIcon className="w-4 h-4 mr-0.5" />
                  Back
                </Button>
                <div className="grid grid-cols-3 gap-2 pr-1">
                  {openImageCategory.items.map(item => (
                    <ImageLibraryTile key={item.id} item={item} onDragStart={handleDragStart} />
                  ))}
                </div>
              </div>
            ) : (
              <Card className="shadow-md">
                <CardHeader className="p-3">
                  <CardTitle className="text-base">Image Library</CardTitle>
                </CardHeader>
                <CardContent className="p-2 grid grid-cols-2 gap-x-2 gap-y-3">
                  {IMAGE_CATEGORIES.map(category => (
                    <DeviceCategoryCard
                      key={category.id}
                      label={category.label}
                      onOpen={() => setOpenImageCategoryId(category.id)}
                      previews={category.items.slice(0, 6).map(item => (
                        <img key={item.id} src={withBasePath(item.src)} alt="" className="max-w-full max-h-full object-contain" draggable={false} />
                      ))}
                    />
                  ))}
                </CardContent>
              </Card>
            )}
          </ScrollArea>
        </TabsContent>

        {/* Previews: whole artboards, not layers. Each tile drops a finished
            886×1920 App Preview board with its animation script already timed;
            the user swaps the words and drops a recording into the phone. */}
        <TabsContent value="previews" className="flex-grow p-3 pt-2 mt-0 min-h-0">
          <ScrollArea className="h-full">
            <Card className="shadow-md">
              <CardHeader className="p-3 pb-2">
                <CardTitle className="text-base">Preview Scenes</CardTitle>
              </CardHeader>
              <CardContent className="p-2 pt-0">
                <p className="mb-2 px-1 text-[11px] leading-snug text-muted-foreground">
                  Drop one on the canvas to add a whole App Preview board, already
                  animated. Replace the words, drop your screen recording into the
                  phone, then export from Export &gt; App Preview Video.
                </p>
                <div className="grid gap-1">
                  {PREVIEW_SCENES.map((scene) => (
                    <PreviewSceneTile
                      key={scene.id}
                      scene={scene}
                      onAdd={handleSceneClick}
                      onDragStart={handleSceneDragStart}
                    />
                  ))}
                </div>
                <p className="mt-2 rounded-md bg-accent/15 px-2 py-1.5 text-[10px] leading-snug text-muted-foreground">
                  Timed for App Store Connect: {PREVIEW_SCENE_DURATION} seconds, inside Apple's 15 to
                  30 second window. The new board matches the ones you already have, and the MP4
                  renders at Apple's {PREVIEW_SCENE_SIZE.width}×{PREVIEW_SCENE_SIZE.height}. Export
                  with "Store ready with your text" to get a file it accepts.
                </p>
              </CardContent>
            </Card>
          </ScrollArea>
        </TabsContent>

      </Tabs>
    </div>
    </TooltipProvider>
    </TileTouchDragContext.Provider>
  );
});
