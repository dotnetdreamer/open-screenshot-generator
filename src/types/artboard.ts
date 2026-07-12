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
  name?: string; // Optional custom name for the element
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
  | 'custom-polygon'
  | 'custom-svg';

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
  // For circle inner radius (creates ring/donut effect)
  innerRadius?: number; // Percentage of the outer radius (0-95)
  // For fill color opacity
  fillOpacity?: number; // Opacity value from 0 to 1 (0 = transparent, 1 = opaque)
}

export type DeviceType =
  | 'iphone'
  | 'iphone-x'
  | 'iphone-13'
  | 'iphone-14'
  | 'iphone-15'
  | 'iphone-15-pro'
  | 'iphone-17-pro-max'
  | 'ipad-pro-13'
  | 'ipad-11'
  | 'apple-watch'
  | 'android-bar'
  | 'android-notch'
  | 'android-punch-hole'
  | 'tablet'
  | 'tablet-7'
  | 'tablet-10'
  | 'desktop'
  | 'custom';

export type DeviceStyleType =
  | 'normal'
  | '3d-left'
  | '3d-right'
  | 'perspective-left'
  | 'perspective-right'
  | 'perspective-slight-right'
  | 'perspective-slight-left'
  | 'perspective-front'
  | 'custom';

// Pose presets for the true-3D (three.js) device styles. 'classic' is the
// original near-frontal product shot; 'front' is dead-on (no yaw at all — the
// watch group's straight-on look); the rest recline the device toward the
// camera in increasing steps (matching common mockup panels). 'floating' and
// 'drifting' add an in-image diagonal roll for tossed-phone hero collages;
// 'leaning' is a gentle diagonal rest (screen ~90% visible) and 'soaring' a
// dramatic opposite-lean float with the camera above the face.
export type Device3DPose = 'classic' | 'front' | 'upright' | 'side' | 'tilted' | 'reclined' | 'laying' | 'floating' | 'drifting' | 'leaning' | 'soaring' | 'isometric';

// Body finish for the true-3D device styles. 'titanium' is the original look
// and remains the default for existing projects.
export type Device3DFrameColor = 'titanium' | 'black' | 'white';

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
  pose3d?: Device3DPose; // Pose preset when styleType is '3d-left' / '3d-right'
  frameColor3d?: Device3DFrameColor; // Body finish for the 3D styles
  // Colored-device presets for the flat (non-3D) frames:
  frameColor?: string; // any CSS color; overrides the per-device default body color
  frameOpacity?: number; // 0..1 alpha applied to the flat frame color (transparent devices)
  frameStyle?: 'solid' | 'outline'; // outline = colored ring around a hollow frame
  notchColor?: string; // overrides the notch / island / punch-hole fill
}

export interface ImageElementProps extends BaseElement {
  type: 'image';
  imageSrc?: string;
  imageAlt?: string;
  objectFit?: 'contain' | 'cover' | 'fill' | 'none' | 'scale-down';
  opacity?: number;
  borderRadius?: number;
  // Transform properties
  skewX?: number; // Skew along X-axis in degrees
  skewY?: number; // Skew along Y-axis in degrees
  perspectiveX?: number; // Perspective tilt along X-axis
  perspectiveY?: number; // Perspective tilt along Y-axis
  matrix3d?: string; // Custom CSS matrix3d transform
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



export interface Project {
  id: string;
  name: string;
  timestamp: Date;
  projectData: ArtboardState[];
  description?: string; // For template projects
  previewImage?: string; // For template projects
  category?: string; // Template category id (see TEMPLATE_CATEGORIES); groups templates into dialog tabs
}
