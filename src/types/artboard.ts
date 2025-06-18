export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export type ElementType = 'text' | 'shape' | 'device' | 'image';

// Ensure our element types are properly defined for copy/paste operations
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
  fontWeight?: string; // 'normal', 'bold', etc.
  fontStyle?: string; // 'normal', 'italic'
  textDecoration?: string; // 'none', 'underline', 'line-through'
  textAlign?: string; // 'left', 'center', 'right', 'justify'
  lineHeight?: number; // Line height in pixels or as a multiplier
}

export type ShapeType = 
  | 'rectangle' 
  | 'circle' 
  | 'triangle' 
  | 'message' 
  | 'speech-bubble' 
  | 'star' 
  | 'hexagon' 
  | 'pentagon' 
  | 'diamond' 
  | 'custom-polygon';

export interface ShapeElementProps extends BaseElement {
  type: 'shape';
  shapeType: ShapeType;
  fillColor: string;
  strokeColor: string;
  strokeWidth: number;
  // New properties for customizing corners
  borderRadius?: number | string; // For rounded corners (px or %)
  borderRadiusType?: 'uniform' | 'individual'; // Whether to apply same radius to all corners
  borderRadiusTopLeft?: number;
  borderRadiusTopRight?: number;
  borderRadiusBottomRight?: number;
  borderRadiusBottomLeft?: number;
  // For custom shape properties
  customPath?: string; // SVG path for custom shapes
  customPoints?: number; // Number of points (for stars, etc)
  clipPath?: string; // CSS clip-path value
  specialProps?: Record<string, any>; // Additional properties for special shapes
}

export type DeviceType =
  | 'iphone'
  | 'iphone-13'
  | 'iphone-14'
  | 'iphone-15'
  | 'iphone-15-pro'
  | 'android-bar'
  | 'android-notch'
  | 'android-punch-hole'
  | 'tablet'
  | 'desktop'
  | 'custom';

export type DeviceStyleType = 
  | 'normal' 
  | 'perspective-left' 
  | 'perspective-right' 
  | 'perspective-slight-right'
  | 'perspective-slight-left'
  | 'perspective-front' 
  | 'custom';

export interface DeviceFrameElementProps extends BaseElement {
  type: 'device';
  deviceType: DeviceType;
  screenshotSrc?: string; // URL or base64 data
  screenshotObjectFit?: 'contain' | 'cover' | 'fill'; // How screenshot fits
  customFrameSrc?: string; // URL or base64 for user-uploaded mockup for 'custom' type
  // For ALL device types, to define the screenshot's viewport using percentages (0-100)
  // relative to the device's screen area (for predefined) or element bounds (for custom with mask)
  screenshotRect?: { left: number; top: number; width: number; height: number };
  naturalScreenshotWidth?: number;
  naturalScreenshotHeight?: number;
  styleType?: DeviceStyleType;
  matrix3d?: string; // Custom CSS matrix3d transform
}

export interface ImageElementProps extends BaseElement {
  type: 'image';
  imageSrc?: string;
  imageAlt?: string;
  objectFit?: 'contain' | 'cover' | 'fill' | 'none' | 'scale-down';
  opacity?: number;
  borderRadius?: number;
}

export type ArtboardElement = TextElementProps | ShapeElementProps | DeviceFrameElementProps | ImageElementProps;

export interface ArtboardState {
  id: string;
  name: string;
  position: Point;
  size: Size;
  elements: ArtboardElement[];
  backgroundColor: string;
  backgroundType?: 'solid' | 'gradient';
  backgroundGradient?: {
    color1: string;
    color2: string;
    angle: number;
  };
  zoom: number; // Zoom level for the artboard's content itself
  exportScale?: number; // Optional export scale for higher resolution exports
}

export interface Template {
  id: string;
  name: string;
  description: string;
  previewImage?: string;
  dataAiHint?: string; // for placeholder images
  artboards: Partial<ArtboardState>[];
}

export interface TargetStore {
  appName: string;
  exportSizes: {
    name: string;
    width: number;
    height: number;
  }[];
}
