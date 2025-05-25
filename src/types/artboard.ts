
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
  size: Size;
  rotation: number; // degrees
  scale: number; // percentage, 1 = 100%
}

export interface TextElementProps extends BaseElement {
  type: 'text';
  content: string;
  fontSize: number;
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

export type DeviceType = 'iphone' | 'android-phone' | 'tablet' | 'desktop';
export interface DeviceFrameElementProps extends BaseElement {
  type: 'device';
  deviceType: DeviceType;
  screenshotSrc?: string; // URL or base64 data
}

export type ArtboardElement = TextElementProps | ShapeElementProps | DeviceFrameElementProps;

export interface ArtboardState {
  id: string;
  name: string;
  position: Point; // Position on the infinite canvas (if applicable, for now fixed)
  size: Size;
  elements: ArtboardElement[];
  backgroundColor: string;
  zoom: number;
}

export interface Template {
  id: string;
  name: string;
  description: string;
  previewImage?: string;
  artboards: Partial<ArtboardState>[]; // Initial artboard configurations
}
