export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export type ElementType = 'text' | 'shape' | 'device';

export interface BaseElement {
  id: string;
  type: ElementType;
  position: Point;
  size: Size; // Base size, actual display size is base * scale
  rotation: number; // degrees
  scale: number; // multiplier, 1 = 100%
}

export interface TextElementProps extends BaseElement {
  type: 'text';
  content: string;
  fontSize: number; // Base font size, actual display is fontSize * element.scale
  color: string;
  fontFamily: string;
}

export type ShapeType = 'rectangle' | 'circle' | 'triangle';
export interface ShapeElementProps extends BaseElement {
  type: 'shape';
  shapeType: ShapeType;
  fillColor: string;
  strokeColor: string;
  strokeWidth: number;
}

export type DeviceType =
  | 'iphone'
  | 'android-punch-hole'
  | 'android-notch'
  | 'android-bar'
  | 'tablet'
  | 'desktop'
  | 'custom';

export interface DeviceFrameElementProps extends BaseElement {
  type: 'device';
  deviceType: DeviceType;
  screenshotSrc?: string; // URL or base64 data
  screenshotObjectFit?: 'contain' | 'cover'; // How screenshot fits
  customFrameSrc?: string; // URL or base64 for user-uploaded mockup for 'custom' type
  // For ALL device types, to define the screenshot's viewport using percentages (0-100)
  // relative to the device's screen area (for predefined) or element bounds (for custom with mask)
  screenshotRect?: { left: number; top: number; width: number; height: number };
  naturalScreenshotWidth?: number;
  naturalScreenshotHeight?: number;
}

export type ArtboardElement = TextElementProps | ShapeElementProps | DeviceFrameElementProps;

export interface ArtboardState {
  id: string;
  name: string;
  position: Point;
  size: Size;
  elements: ArtboardElement[];
  backgroundColor: string;
  backgroundType: 'solid' | 'gradient';
  backgroundGradient?: {
    color1: string;
    color2: string;
    angle: number;
  };
  zoom: number; // Zoom level for the artboard's content itself
}

export interface Template {
  id: string;
  name: string;
  description: string;
  previewImage?: string;
  dataAiHint?: string; // for placeholder images
  artboards: Partial<ArtboardState>[];
}
