export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

// 'device' is the screenshot mockup; 'video-device' is its App Preview sibling
// that plays a screen recording inside the same frame (see VideoDeviceElement).
// They share the frame chrome (elements/deviceChrome.tsx) but nothing else:
// a video device has no screenshot rect, no 3D pose, and its own properties.
export type ElementType = 'text' | 'shape' | 'device' | 'image' | 'video' | 'video-device' | 'gesture';

// Enter/exit animation presets for App Preview video exports. On the canvas
// elements render static; the presets only play in the exported MP4 (and the
// gesture overlays' looping editor preview). Times are in seconds from the
// start of the video.
export type ElementAnimationPreset =
  | 'fade'
  | 'slide-up'
  | 'slide-down'
  | 'slide-left'
  | 'slide-right'
  | 'scale-up'
  | 'pop';

export interface ElementAnimation {
  enter?: ElementAnimationPreset;
  enterDelay?: number; // seconds; default 0
  enterDuration?: number; // seconds; default 0.6
  exit?: ElementAnimationPreset; // played in reverse (element leaves)
  exitStart?: number; // absolute second the exit begins; default: never
  exitDuration?: number; // seconds; default 0.6
}

// A drop shadow cast by an element's actual silhouette (rendered as a CSS
// drop-shadow filter, so a star casts a star and transparent PNG edges are
// respected). Offsets and blur are in artboard pixels, like position and size.
export interface ElementShadow {
  x: number;
  y: number;
  blur: number;
  /** Any CSS colour, alpha included, e.g. 'rgba(0,0,0,0.35)'. */
  color: string;
}

// A two-stop linear fill, same shape as ArtboardState['backgroundGradient'].
export interface LinearGradient {
  color1: string;
  color2: string;
  angle: number; // degrees
}

// Ensure our element types are properly defined for copy/paste operations
export interface BaseElement {
  id: string;
  type: ElementType;
  name?: string; // Optional custom name for the element
  position: Point;
  size: Size; // Base size, actual display size is base * scale
  rotation: number; // degrees
  scale: number; // multiplier, 1 = 100%
  animation?: ElementAnimation; // App Preview video enter/exit animation
  // Shared visual treatment, applied by DraggableElement around whatever the
  // per-type renderer draws (see src/lib/elementStyle.ts), so every element
  // type gets the same shadow/blur/opacity behaviour on canvas and in exports.
  opacity?: number; // 0..1; 1 (or unset) is fully opaque
  shadow?: ElementShadow;
  blur?: number; // gaussian blur radius in artboard px
  // Free-form tag shared by elements that move together (see the MCP
  // group_elements / transform_elements tools). Purely an id: the elements
  // stay independent layers, nothing nests.
  groupId?: string;
  // The palette tile this element came from, e.g. 'image:touch-as451105828'
  // (see lib/libraryIds.ts). Stamped by the palette and by MCP add_element,
  // shown at the top of the Properties panel so a layer traces back to the
  // library item that made it. Absent on template and hand-built elements.
  libraryId?: string;
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
  // Tracking, in the same units as fontSize (both are divided by the 0.3
  // display scale when rendered), so it stays proportional to the type.
  letterSpacing?: number;
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
  // Two-stop linear gradient fill. Wins over fillColor when set; fillOpacity
  // still applies through the element's own opacity.
  fillGradient?: LinearGradient;
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
  | 'macbook'
  | 'imac'
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

// Phone/tablet mockup with a SCREEN RECORDING playing inside its screen — the
// centrepiece of an App Preview video. Deliberately separate from
// DeviceFrameElementProps: no screenshotRect, no 3D pose, no perspective
// matrix, because a recording only composites into a flat, front-facing frame.
// The recording blob lives in the Dexie `media` table (recordings are tens or
// hundreds of MB; inlining them as base64 in the project row would break it) —
// the element stores only the row id.
export interface VideoDeviceElementProps extends BaseElement {
  type: 'video-device';
  deviceType: DeviceType;
  mediaId?: string; // Dexie media row id of the recording
  trimStart?: number; // seconds into the recording playback starts
  trimEnd?: number; // seconds into the recording playback stops
  objectFit?: 'contain' | 'cover' | 'fill'; // how the recording fills the screen
  // Placeholder shown on the canvas (and in exports) until a recording is
  // uploaded, so templates read as designs instead of black rectangles.
  posterSrc?: string;
  naturalVideoWidth?: number;
  naturalVideoHeight?: number;
  durationSeconds?: number;
  // Same colored-device presets as the flat screenshot frames.
  frameColor?: string;
  frameOpacity?: number;
  frameStyle?: 'solid' | 'outline';
  notchColor?: string;
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

// A standalone video layer (frameless recordings, full-bleed clips). Source is
// either a media-table blob (user uploads) or a URL (template/demo assets).
export interface VideoElementProps extends BaseElement {
  type: 'video';
  mediaId?: string; // Dexie media table row id (user-uploaded recording)
  videoSrc?: string; // URL source (public asset) — used when mediaId is unset
  objectFit?: 'contain' | 'cover' | 'fill';
  borderRadius?: number;
  opacity?: number;
  trimStart?: number; // seconds into the recording playback starts
  trimEnd?: number; // seconds into the recording playback stops
  naturalVideoWidth?: number;
  naturalVideoHeight?: number;
  durationSeconds?: number; // source duration, probed on upload
}

// Animated gesture hints (tap ripples, swipe trails) for App Preview videos.
// On the canvas they loop forever so the designer can see them; in the export
// they play once at triggerTime (or loop when gestureRepeat is set).
export type GestureType =
  | 'tap'
  | 'double-tap'
  | 'swipe-left'
  | 'swipe-right'
  | 'swipe-up'
  | 'swipe-down';

export interface GestureElementProps extends BaseElement {
  type: 'gesture';
  gestureType: GestureType;
  color: string;
  triggerTime?: number; // seconds into the video the gesture plays; default 0.5
  gestureDuration?: number; // seconds one play lasts; default 1.2
  gestureRepeat?: boolean; // loop for the whole video instead of playing once
}

export type ArtboardElement =
  | TextElementProps
  | ShapeElementProps
  | DeviceFrameElementProps
  | ImageElementProps
  | VideoElementProps
  | VideoDeviceElementProps
  | GestureElementProps;

/**
 * One locale's overrides for one element. Every field is optional and anything
 * absent falls back to the base element, which is what makes "change the design
 * once" true: only the keys listed here can ever differ between languages.
 *
 * Deliberately NOT here: position, size, rotation, scale, opacity, shadow,
 * blur, colours, alignment, device model, 3D pose, animation. Once every
 * property can differ, nothing is shared and the propagation guarantee is gone,
 * which is the duplicate model with extra steps.
 *
 * Also deliberately NOT here: fontSize. Auto-shrink for a long translation is
 * DERIVED at projection time (see resolveLocaleFontSize), never stored, so a
 * later change to the base fontSize cannot leave one language behind.
 */
export interface ElementLocaleOverride {
  /** Text elements only. */
  content?: string;
  /** Script substitution, or a hand-picked face for this language. */
  fontFamily?: string;
  /** Device / image / video: the app UI inside the frame is itself localized. */
  screenshotSrc?: string;
  imageSrc?: string;
  mediaId?: string;
  /** Illustrator's Visibility variable: drop a badge in this language only. */
  hidden?: boolean;
  // --- detachable properties -------------------------------------------------
  // Shared with every other language UNTIL the user pulls one apart for this
  // element (see `detached`). Held here so a language that genuinely needs its
  // own metrics or its own box can have them: Nastaliq Urdu and Arabic need
  // more leading than Latin at the same size, and a German compound can overrun
  // a box that English fits. A value present here does nothing while its key is
  // absent from `detached`.
  fontSize?: number;
  lineHeight?: number;
  letterSpacing?: number;
  fontWeight?: string;
  textAlign?: string;
  color?: string;
  position?: Point;
  size?: Size;
  rotation?: number;
  scale?: number;
  /**
   * The property names this element keeps its own copy of in THIS language.
   * Anything not listed follows the shared design, which is what keeps "change
   * it once and every language gets it" true for everything the user has not
   * deliberately taken manual control of. Re-attaching drops both the name and
   * the stored value, so the element snaps back to the base design.
   */
  detached?: string[];
  /**
   * 'auto' means a machine wrote it, so "Update translations" may refresh it.
   * 'manual' means a person did, so nothing ever overwrites it without an
   * explicit opt-in. Set to 'manual' the moment the user types in the field.
   */
  origin?: 'auto' | 'manual';
  /**
   * hash32 of the BASE value this was derived from. When the base text is
   * edited the hash stops matching and the cell reads "English changed since
   * this was translated". Never auto-propagates; every reference tool makes
   * refreshing an explicit action because silent propagation destroys reviewed
   * human translations.
   */
  sourceHash?: string;
}

/** One language the project exports. `code` is a STORE locale, see LOCALES. */
export interface LocaleEntry {
  code: string; // 'de-DE', 'zh-Hans', 'pt-BR'
  /** Substitute a script-appropriate family at projection time. Default true. */
  autoFont?: boolean;
  /** Shrink overflowing text rather than clipping it. Default true. */
  autoFit?: boolean;
}

/**
 * Project-scoped config, MIRRORED onto every artboard. It belongs on Project,
 * but the four db.projects.put sites write exactly {id, name, timestamp,
 * projectData} and bundleFromJson drops every top-level key it does not know,
 * so a Project field is destroyed by the first edit after load. This lives
 * where projectData goes instead. getLocalization() reads the first board that
 * has it and normalizeLocalization() re-stamps every board on load, so a board
 * that arrives from an import or a duplicate cannot cause drift.
 */
export interface ProjectLocalization {
  /** The language the base document is written in. Defaults to 'en-US'. */
  baseLocale: string;
  /** Export languages in order. Never contains baseLocale. */
  locales: LocaleEntry[];
}

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
  // Language its text elements were last translated into (a code from the
  // translate dialog's list). Set only when a whole artboard translated
  // cleanly, so the next run knows what to use as the source instead of
  // assuming English. Unset means "unknown, detect it".
  //
  // NOT the multi-language key: it is cleared on any partial run, so keying
  // overrides off it would silently drop boards out of their language. Its one
  // job in the locale overlay is seeding a default baseLocale.
  language?: string;
  /**
   * Per-locale overrides for this board, keyed locale -> element id.
   * Absent means every language inherits this board verbatim.
   */
  localized?: Record<string, Record<string, ElementLocaleOverride>>;
  /** Project-level config, mirrored onto every board. See ProjectLocalization. */
  localization?: ProjectLocalization;
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
