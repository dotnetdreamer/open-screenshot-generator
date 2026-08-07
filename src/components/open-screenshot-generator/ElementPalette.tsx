"use client";
import type React from 'react';
import { useCallback, useEffect, useState } from 'react';
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  UploadCloudIcon,
} from "lucide-react";
import type { ElementType, ShapeType, DeviceType } from '@/types/artboard';
import { ELEMENT_CATEGORIES, type ElementCategory, type LibraryElementDef } from '@/lib/elementLibrary';
import { IMAGE_CATEGORIES, type LibraryImageDef } from '@/lib/imageLibrary';
import { listUploadedImages, useMediaUrl, type MediaAsset } from '@/lib/mediaStore';
import { UploadsPanel } from './UploadsPanel';
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

type PaletteDragStart = (
  e: React.DragEvent<HTMLElement> | null,
  type: ElementType,
  subType?: ShapeType | DeviceType,
  styleProps?: Record<string, any>
) => void;

/** Tile showing a pre-rendered 3D pose thumbnail, draggable like other palette items. */
const Device3DThumbTile: React.FC<{
  src: string;
  label: string;
  title: string;
  deviceType: DeviceType;
  styleProps: Record<string, any>;
  onDragStart: PaletteDragStart;
}> = ({ src, label, title, deviceType, styleProps, onDragStart }) => (
  <button
    type="button"
    className="flex flex-col items-center gap-1 group cursor-grab active:cursor-grabbing"
    draggable
    onDragStart={(e) => onDragStart(e, 'device', deviceType, styleProps)}
    onClick={() => (onDragStart as any)(null, 'device', deviceType, styleProps)}
    title={title}
    aria-label={title}
  >
    <span className="w-full aspect-square rounded-lg bg-accent/10 group-hover:bg-accent/25 transition-colors flex items-center justify-center p-1.5 overflow-hidden">
      <img src={withBasePath(src)} alt="" className="max-w-full max-h-full object-contain pointer-events-none" draggable={false} />
    </span>
    <span className="text-[10px] text-muted-foreground group-hover:text-foreground transition-colors">{label}</span>
  </button>
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
  const title = `Add ${def.label}`;
  return (
    <button
      type="button"
      className="flex flex-col items-center gap-1 group cursor-grab active:cursor-grabbing"
      draggable
      onDragStart={(e) => onDragStart(e, 'device', def.device, styleProps)}
      onClick={() => (onDragStart as any)(null, 'device', def.device, styleProps)}
      title={title}
      aria-label={title}
    >
      <span className="w-full aspect-square rounded-lg bg-accent/10 group-hover:bg-accent/25 transition-colors flex items-center justify-center p-2 overflow-hidden">
        <ColoredDeviceGlyph def={def} />
      </span>
      <span className="text-[10px] text-muted-foreground group-hover:text-foreground transition-colors text-center leading-tight">{def.label}</span>
    </button>
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
  return (
    <button
      type="button"
      className="flex flex-col items-center gap-1 group cursor-grab active:cursor-grabbing"
      draggable
      onDragStart={(e) => onDragStart(e, 'image', undefined, styleProps)}
      onClick={() => (onDragStart as any)(null, 'image', undefined, styleProps)}
      title={`Add ${item.label}`}
      aria-label={`Add ${item.label}`}
    >
      <span className="aspect-square w-full rounded-lg bg-accent/10 group-hover:bg-accent/25 transition-colors flex items-center justify-center p-2 overflow-hidden">
        <img src={withBasePath(item.src)} alt="" className="max-w-full max-h-full object-contain pointer-events-none" draggable={false} />
      </span>
      <span className="text-[10px] text-muted-foreground group-hover:text-foreground transition-colors text-center leading-tight">{item.label}</span>
    </button>
  );
};

/** Mini thumbnail for the "Your uploads" category card, from the shared object-URL cache. */
const UploadedAssetPreview: React.FC<{ id: string }> = ({ id }) => {
  const url = useMediaUrl(id);
  return url ? (
    <img src={url} alt="" className="max-w-full max-h-full object-contain" draggable={false} />
  ) : null;
};

interface ElementPaletteProps {
  onAddElement: (type: ElementType, subType?: ShapeType | DeviceType, styleProps?: Record<string, any>) => void;
}

const DraggableItem: React.FC<{
  onDragStart: (e: React.DragEvent<HTMLElement>, type: ElementType, subType?: ShapeType | DeviceType, styleProps?: Record<string, any>) => void,
  type: ElementType,
  subType?: ShapeType | DeviceType,
  label: string,
  icon: React.ReactNode,
  className?: string,
  styleProps?: Record<string, any>
}> =
  ({ onDragStart, type, subType, label, icon, className, styleProps }) => {
  return (
    <Button
      variant="ghost"
      className={`w-full justify-start p-2 h-auto text-left ${className}`}
      draggable
      onDragStart={(e) => onDragStart(e, type, subType, styleProps)}
      onClick={() => (onDragStart as any)(null, type, subType, styleProps)} // Fallback for click
      title={`Add ${label}`}
    >
      <div className="flex flex-col items-center text-center w-full">
        <div className="p-2 rounded-md bg-accent/10 mb-1">{icon}</div>
        <span className="text-xs">{label}</span>
      </div>
    </Button>
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
  onDragStart: (e: React.DragEvent<HTMLElement>, type: ElementType, subType?: ShapeType | DeviceType, styleProps?: Record<string, any>) => void;
}> = ({ item, onDragStart }) => {
  return (
    <button
      type="button"
      className="aspect-square w-full rounded-lg bg-accent/10 hover:bg-accent/25 transition-colors flex items-center justify-center p-2.5 text-foreground/90 cursor-grab active:cursor-grabbing"
      draggable
      onDragStart={(e) => onDragStart(e, 'shape', 'custom-svg', item.styleProps)}
      onClick={() => (onDragStart as any)(null, 'shape', 'custom-svg', item.styleProps)}
      title={`Add ${item.label}`}
      aria-label={`Add ${item.label}`}
    >
      <ElementPreview item={item} className="w-full h-full" />
    </button>
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

export function ElementPalette({ onAddElement }: ElementPaletteProps) {
  const [openCategoryId, setOpenCategoryId] = useState<string | null>(null);
  const openCategory = ELEMENT_CATEGORIES.find(c => c.id === openCategoryId) || null;
  const [openDeviceCategoryId, setOpenDeviceCategoryId] = useState<DeviceCategoryId | null>(null);
  const [openImageCategoryId, setOpenImageCategoryId] = useState<string | null>(null);
  const openImageCategory = IMAGE_CATEGORIES.find(c => c.id === openImageCategoryId) || null;

  // User-uploaded image library (pinned first category in the Images tab).
  // The palette owns the list so the overview card can preview recent uploads;
  // the drill-in panel mutates and asks for a re-list via refreshUploads.
  const [uploadedAssets, setUploadedAssets] = useState<MediaAsset[]>([]);
  const refreshUploads = useCallback(() => {
    listUploadedImages()
      .then(setUploadedAssets)
      .catch(() => setUploadedAssets([]));
  }, []);
  useEffect(() => {
    refreshUploads();
  }, [refreshUploads]);

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

  const handleDragStart = (e: React.DragEvent<HTMLElement> | null, type: ElementType, subType?: ShapeType | DeviceType, styleProps?: Record<string, any>) => {
    if (e) { // Drag event
      e.dataTransfer.setData('application/artboard-element-type', type);
      if (subType) {
        e.dataTransfer.setData('application/artboard-element-subtype', subType);
      }
      if (styleProps) {
        e.dataTransfer.setData('application/artboard-element-styleprops', JSON.stringify(styleProps));
      }
    } else { // Click event (simulated drag)
      onAddElement(type, subType, styleProps);
    }
  };

  return (
    <div className="h-full flex flex-col">
      <Tabs value={activeTab} onValueChange={handleTabChange} className="h-full flex flex-col">
        <TabsList className="grid w-[95%] grid-cols-3 mx-auto mt-2 h-auto p-0.5">
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
        </TabsList>

        <TabsContent value="elements" className="flex-grow p-3 pt-2 mt-0 min-h-0">
          <ScrollArea className="h-full">
            {openCategoryId === 'app-preview' ? (
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
                  <DraggableItem
                    onDragStart={handleDragStart}
                    type="video-device"
                    subType="iphone-15-pro"
                    label="iPhone + Recording"
                    icon={<SmartphoneIcon className="w-6 h-6 text-primary" />}
                    styleProps={{ name: 'iPhone Recording' }}
                  />
                  <DraggableItem
                    onDragStart={handleDragStart}
                    type="video-device"
                    subType="android-punch-hole"
                    label="Android + Recording"
                    icon={<SmartphoneIcon className="w-6 h-6 text-primary" />}
                    styleProps={{ name: 'Android Recording', defaultSize: { width: 520, height: 1073 } }}
                  />
                  <DraggableItem
                    onDragStart={handleDragStart}
                    type="video"
                    label="Recording (no frame)"
                    icon={<ClapperboardIcon className="w-6 h-6 text-primary" />}
                  />
                  <DraggableItem
                    onDragStart={handleDragStart}
                    type="gesture"
                    label="Tap"
                    icon={<PointerIcon className="w-6 h-6 text-primary" />}
                    styleProps={{ gestureType: 'tap', name: 'Tap hint' }}
                  />
                  <DraggableItem
                    onDragStart={handleDragStart}
                    type="gesture"
                    label="Double Tap"
                    icon={<PointerIcon className="w-6 h-6 text-primary" />}
                    styleProps={{ gestureType: 'double-tap', name: 'Double tap hint' }}
                  />
                  <DraggableItem
                    onDragStart={handleDragStart}
                    type="gesture"
                    label="Swipe Left"
                    icon={<MoveHorizontalIcon className="w-6 h-6 text-primary" />}
                    styleProps={{ gestureType: 'swipe-left', name: 'Swipe left hint', defaultSize: { width: 320, height: 160 } }}
                  />
                  <DraggableItem
                    onDragStart={handleDragStart}
                    type="gesture"
                    label="Swipe Right"
                    icon={<MoveHorizontalIcon className="w-6 h-6 text-primary" />}
                    styleProps={{ gestureType: 'swipe-right', name: 'Swipe right hint', defaultSize: { width: 320, height: 160 } }}
                  />
                  <DraggableItem
                    onDragStart={handleDragStart}
                    type="gesture"
                    label="Swipe Up"
                    icon={<MoveVerticalIcon className="w-6 h-6 text-primary" />}
                    styleProps={{ gestureType: 'swipe-up', name: 'Swipe up hint', defaultSize: { width: 160, height: 320 } }}
                  />
                  <DraggableItem
                    onDragStart={handleDragStart}
                    type="gesture"
                    label="Swipe Down"
                    icon={<MoveVerticalIcon className="w-6 h-6 text-primary" />}
                    styleProps={{ gestureType: 'swipe-down', name: 'Swipe down hint', defaultSize: { width: 160, height: 320 } }}
                  />
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
                    {/* Text Element */}
                    <DraggableItem
                      onDragStart={handleDragStart}
                      type="text"
                      label="Text"
                      icon={<TypeIcon className="w-6 h-6 text-primary" />}
                    />

                    {/* Image Element */}
                    <DraggableItem
                      onDragStart={handleDragStart}
                      type="image"
                      label="Image"
                      icon={<ImageIcon className="w-6 h-6 text-primary" />}
                    />

                    {/* Basic Shapes */}
                    <DraggableItem
                      onDragStart={handleDragStart}
                      type="shape"
                      subType="rectangle"
                      label="Rectangle"
                      icon={<SquareIcon className="w-6 h-6 text-primary" />}
                    />
                    <DraggableItem
                      onDragStart={handleDragStart}
                      type="shape"
                      subType="circle"
                      label="Circle"
                      icon={<CircleIcon className="w-6 h-6 text-primary" />}
                    />
                    <DraggableItem
                      onDragStart={handleDragStart}
                      type="shape"
                      subType="triangle"
                      label="Triangle"
                      icon={<TriangleIcon className="w-6 h-6 text-primary" />}
                    />

                    {/* Advanced Shapes */}
                    <DraggableItem
                      onDragStart={handleDragStart}
                      type="shape"
                      subType="star"
                      label="Star"
                      icon={<StarIcon className="w-6 h-6 text-primary" />}
                      styleProps={{ customPoints: 5 }}
                    />
                    <DraggableItem
                      onDragStart={handleDragStart}
                      type="shape"
                      subType="hexagon"
                      label="Hexagon"
                      icon={<HexagonIcon className="w-6 h-6 text-primary" />}
                    />
                    <DraggableItem
                      onDragStart={handleDragStart}
                      type="shape"
                      subType="diamond"
                      label="Diamond"
                      icon={<DiamondIcon className="w-6 h-6 text-primary" />}
                    />
                    <DraggableItem
                      onDragStart={handleDragStart}
                      type="shape"
                      subType="message"
                      label="Message"
                      icon={<MessageSquareIcon className="w-6 h-6 text-primary" />}
                      styleProps={{ clipPath: 'polygon(0% 0%, 100% 0%, 100% 75%, 75% 75%, 75% 100%, 50% 75%, 0% 75%)' }}
                    />
                    <DraggableItem
                      onDragStart={handleDragStart}
                      type="shape"
                      subType="speech-bubble"
                      label="Speech"
                      icon={<MessageCircleIcon className="w-6 h-6 text-primary" />}
                      styleProps={{ clipPath: 'polygon(0% 0%, 100% 0%, 100% 75%, 85% 75%, 70% 100%, 70% 75%, 0% 75%)' }}
                    />
                    <DraggableItem
                      onDragStart={handleDragStart}
                      type="shape"
                      subType="pentagon"
                      label="Pentagon"
                      icon={<div className="w-6 h-6 flex items-center justify-center text-primary">5⬠</div>}
                    />
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
          </ScrollArea>
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
                            title={`Add iPhone 17 Pro Max 3D — ${pose} ${side} (${color})`}
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
                            title={`Add Android 3D — ${pose} ${side} (${color})`}
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
                            title={`Add Apple Watch 3D — ${pose} ${side} (${color})`}
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
                              title={`Add MacBook 3D — ${pose} ${side} (${color})`}
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
                              title={`Add iMac 3D — ${pose} ${side} (${color})`}
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
                      <DraggableItem onDragStart={handleDragStart} type="device" subType="iphone-17-pro-max" label="iPhone 17 Pro Max" icon={<SmartphoneIcon className="w-6 h-6 text-primary" />} styleProps={{ defaultSize: { width: 600, height: 1304 } }} />
                      <DraggableItem onDragStart={handleDragStart} type="device" subType="iphone" label="iPhone" icon={<SmartphoneIcon className="w-6 h-6 text-primary" />} styleProps={{ borderRadius: '28px' }} />
                      <DraggableItem onDragStart={handleDragStart} type="device" subType="iphone-15-pro" label="iPhone 15 Pro" icon={<SmartphoneIcon className="w-6 h-6 text-primary" />} styleProps={{ borderRadius: '28px' }} />
                      <DraggableItem onDragStart={handleDragStart} type="device" subType="iphone-15" label="iPhone 15" icon={<SmartphoneIcon className="w-6 h-6 text-primary" />} styleProps={{ borderRadius: '28px' }} />
                      <DraggableItem onDragStart={handleDragStart} type="device" subType="iphone-14" label="iPhone 14" icon={<SmartphoneIcon className="w-6 h-6 text-primary" />} styleProps={{ borderRadius: '26px' }} />
                      <DraggableItem onDragStart={handleDragStart} type="device" subType="iphone-13" label="iPhone 13" icon={<SmartphoneIcon className="w-6 h-6 text-primary" />} styleProps={{ borderRadius: '24px' }} />
                      <DraggableItem onDragStart={handleDragStart} type="device" subType="iphone-x" label="iPhone X" icon={<SmartphoneIcon className="w-6 h-6 text-primary" />} styleProps={{ borderRadius: '24px' }} />
                      <DraggableItem onDragStart={handleDragStart} type="device" subType="android-punch-hole" label="Android (Punch Hole)" icon={<SmartphoneIcon className="w-6 h-6 text-primary" />} styleProps={{ borderRadius: '16px' }} />
                      <DraggableItem onDragStart={handleDragStart} type="device" subType="android-notch" label="Android (Notch)" icon={<SmartphoneIcon className="w-6 h-6 text-primary" />} styleProps={{ borderRadius: '16px' }} />
                      <DraggableItem onDragStart={handleDragStart} type="device" subType="android-bar" label="Android (Bar)" icon={<SmartphoneIcon className="w-6 h-6 text-primary" />} styleProps={{ borderRadius: '16px' }} />
                      <DraggableItem onDragStart={handleDragStart} type="device" subType="ipad-pro-13" label="iPad Pro 13-inch" icon={<TabletIcon className="w-6 h-6 text-primary" />} styleProps={{ borderRadius: '16px', defaultSize: { width: 780, height: 1040 } }} />
                      <DraggableItem onDragStart={handleDragStart} type="device" subType="ipad-11" label="iPad 11-inch" icon={<TabletIcon className="w-6 h-6 text-primary" />} styleProps={{ borderRadius: '16px', defaultSize: { width: 740, height: 1074 } }} />
                      <DraggableItem onDragStart={handleDragStart} type="device" subType="tablet" label="Tablet" icon={<TabletIcon className="w-6 h-6 text-primary" />} styleProps={{ borderRadius: '12px' }} />
                      <DraggableItem onDragStart={handleDragStart} type="device" subType="tablet-7" label="7-inch Tablet" icon={<TabletIcon className="w-6 h-6 text-primary" />} styleProps={{ borderRadius: '12px', defaultSize: { width: 600, height: 960 } }} />
                      <DraggableItem onDragStart={handleDragStart} type="device" subType="tablet-10" label="10-inch Tablet" icon={<TabletIcon className="w-6 h-6 text-primary" />} styleProps={{ borderRadius: '12px', defaultSize: { width: 700, height: 1120 } }} />
                      <DraggableItem onDragStart={handleDragStart} type="device" subType="macbook" label="MacBook" icon={<LaptopIcon className="w-6 h-6 text-primary" />} styleProps={{ defaultSize: { width: 1000, height: 579 } }} />
                      <DraggableItem onDragStart={handleDragStart} type="device" subType="imac" label="iMac" icon={<MonitorIcon className="w-6 h-6 text-primary" />} styleProps={{ defaultSize: { width: 900, height: 668 } }} />
                      <DraggableItem onDragStart={handleDragStart} type="device" subType="desktop" label="Desktop" icon={<MonitorIcon className="w-6 h-6 text-primary" />} styleProps={{ borderRadius: '8px' }} />
                      <DraggableItem onDragStart={handleDragStart} type="device" subType="custom" label="Custom" icon={<ImagePlusIcon className="w-6 h-6 text-primary" />} />
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
            {openImageCategoryId === 'uploads' ? (
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
                <UploadsPanel
                  assets={uploadedAssets}
                  onChanged={refreshUploads}
                  onDragStart={handleDragStart}
                />
              </div>
            ) : openImageCategory ? (
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
                  <DeviceCategoryCard
                    label="Your uploads"
                    onOpen={() => setOpenImageCategoryId('uploads')}
                    previews={
                      uploadedAssets.length > 0
                        ? uploadedAssets.slice(0, 6).map(asset => (
                            <UploadedAssetPreview key={asset.id} id={asset.id} />
                          ))
                        : [<UploadCloudIcon key="empty" className="w-5 h-5 text-primary" />]
                    }
                  />
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

      </Tabs>
    </div>
  );
}
