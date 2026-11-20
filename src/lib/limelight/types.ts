/**
 * Limelight: promo videos of the user's app, filmed with a real camera on a
 * 3D stage.
 *
 * A scene is plain data. Everything that moves is a list of keys over time,
 * and what the stage shows at a moment comes from `sceneAt` in animate.ts, a
 * pure function of the scene and the time. The preview, a still, the agent's
 * look at a frame and the video export all draw the same picture for the same
 * moment because of that, and a template is just a scene without the user's
 * pictures in it.
 *
 * Units: lengths are centimetres, angles degrees, times seconds. The floor is
 * y = 0 and y points up. A device with no turn shows its screen toward +z,
 * which is where a camera at azimuth 0 stands.
 */

import type { DeviceType } from '@/types/artboard';

export const LIMELIGHT_SCENE_VERSION = 1;

export interface XYZ {
  x: number;
  y: number;
  z: number;
}

/**
 * How a device is turned, in the order the 3D Studio uses: roll after pitch
 * after yaw. Yaw spins it about its own long axis (positive shows its left
 * side), pitch tips its top toward the camera, roll turns it in the picture.
 */
export interface Turn {
  yaw: number;
  pitch: number;
  roll: number;
}

/**
 * How a move goes from one key to the next one.
 *
 *   smooth  speeds up, then slows down and stops at the next key
 *   glide   keeps moving through the keys on one curved path
 *   steady  the same speed all the way
 *   snappy  a quick start and a long, slow finish
 *   bounce  goes a little past the next key and settles back
 *   cut     stays put, then jumps to the next key when its time comes
 */
export type LimelightEase = 'smooth' | 'glide' | 'steady' | 'snappy' | 'bounce' | 'cut';

export const LIMELIGHT_EASES: LimelightEase[] = ['smooth', 'glide', 'steady', 'snappy', 'bounce', 'cut'];

/** Where the camera is and how it sees, at one moment. */
export interface CameraState {
  /** The point the camera looks at. */
  target: XYZ;
  /** Degrees round the target: 0 is in front, positive moves the camera to the right. */
  azimuth: number;
  /** Degrees above the target. Negative looks up from below. */
  elevation: number;
  /** Centimetres from the camera to the target. */
  distance: number;
  /** Degrees the picture tilts. Positive turns it clockwise. */
  roll: number;
  /** Focal length in millimetres, as on a full frame camera across the picture's short side. */
  lens: number;
  /** The f-number. Small numbers blur what is out of focus more, when depth of field is on. */
  aperture: number;
  /** Centimetres from the target to where the picture is sharpest. 0 is the target, positive is behind it. */
  focus: number;
}

/** A camera key: where the camera is at `time`, and how it moves on to the next shot. */
export interface CameraShot {
  id: string;
  time: number;
  ease: LimelightEase;
  camera: CameraState;
}

export interface LimelightCamera {
  /** In time order, at least one. A scene with one shot holds the camera still. */
  shots: CameraShot[];
  /** A handheld wobble: 0 is a tripod, 1 is a lot. */
  shake: number;
}

/** An actor key: where an actor is at `time`, and how it moves on to the next pose. */
export interface ActorPose {
  id: string;
  time: number;
  ease: LimelightEase;
  position: XYZ;
  turn: Turn;
  /** 1 is the real size. */
  scale: number;
  /** 0 to 1. Text fades with it; a device shows while it is above 0. */
  opacity: number;
}

/** Movement on top of the poses, worked out from the time alone. */
export interface ActorMotion {
  /** Centimetres the actor drifts up and down, with a slight sway. 0 keeps it still. */
  float: number;
  /** Degrees a second the actor turns about its own upright axis, like a turntable. */
  spin: number;
}

/** How the screen changes to the next picture. */
export type ScreenTransition = 'cut' | 'fade' | 'slide' | 'scroll' | 'zoom';

export const SCREEN_TRANSITIONS: ScreenTransition[] = ['cut', 'fade', 'slide', 'scroll', 'zoom'];

/** Where a picture on a screen came from, so a language's own screenshot can take its place. */
export interface ScreenOrigin {
  projectId: string;
  artboardId: string;
  elementId?: string;
  /** The language the picture was taken in; unset is the project's own language. */
  locale?: string;
}

/** From `time` on, the device's display shows this picture. */
export interface ScreenChange {
  id: string;
  time: number;
  /** A picture in the scene's media, or null for a screen that is off. */
  media: string | null;
  transition: ScreenTransition;
  /** Seconds the transition takes. */
  duration: number;
  from?: ScreenOrigin;
}

interface ActorBase {
  id: string;
  name: string;
  /** In time order, at least one. An actor with one pose stays where it is. */
  poses: ActorPose[];
  motion: ActorMotion;
  /** Left off the stage without being deleted. */
  hidden?: boolean;
}

export interface DeviceActor extends ActorBase {
  kind: 'device';
  /** A phone or tablet with a 3D model, at its real size (stageModelFor in models.ts). */
  device: DeviceType;
  /** One of the model's own finishes by id. */
  finish?: string;
  /** A custom body colour, #rrggbb. Wins over the finish. */
  color?: string;
  /** How a picture fills the display: cover crops it, contain shows all of it. */
  fit: 'cover' | 'contain';
  /** 0 to 1: the reflection on the screen glass. */
  glare: number;
  /** A foldable only: degrees open, 0 closed and 180 flat. Unset is the model's own. */
  fold?: number;
  /** In time order. Empty is a screen that is off. */
  screens: ScreenChange[];
}

export interface TextActor extends ActorBase {
  kind: 'text';
  text: string;
  font: string;
  weight: number;
  /** Centimetres from the top of a capital letter to the baseline. */
  size: number;
  color: string;
  align: 'left' | 'center' | 'right';
  /** 'camera' keeps the words turned toward the camera, whatever the pose says. */
  facing: 'pose' | 'camera';
}

export type LimelightActor = DeviceActor | TextActor;

/** The light and the ground. */
export type LimelightEnvironment = 'studio' | 'daylight' | 'sunset' | 'night' | 'noir';

export const LIMELIGHT_ENVIRONMENTS: LimelightEnvironment[] = ['studio', 'daylight', 'sunset', 'night', 'noir'];

export interface LimelightBackdrop {
  style: 'solid' | 'linear' | 'radial';
  /** #rrggbb. A solid backdrop uses `top` only. */
  top: string;
  bottom: string;
}

export interface LimelightLight {
  /** Degrees round the stage from the front, positive from the right. */
  azimuth: number;
  /** Degrees above the floor. */
  elevation: number;
  /** 1 is the default brightness. */
  intensity: number;
}

export interface LimelightLook {
  environment: LimelightEnvironment;
  backdrop: LimelightBackdrop;
  light: LimelightLight;
  /** 1 is the default brightness of the whole picture. */
  exposure: number;
  /** 0 to 1: the soft shadow on the floor under the actors. */
  shadow: number;
  /** Blur what is in front of and behind the focus, the way a real lens does. */
  depthOfField: boolean;
  /** 0 to 1: darker corners. */
  vignette: number;
  /** 0 to 1: film grain. */
  grain: number;
}

/** The video's size and timing. */
export interface LimelightFormat {
  width: number;
  height: number;
  fps: number;
  /** Seconds. */
  duration: number;
  /** The size preset it was set from, when it was. */
  preset?: string;
}

export interface LimelightScene {
  version: typeof LIMELIGHT_SCENE_VERSION;
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  format: LimelightFormat;
  look: LimelightLook;
  camera: LimelightCamera;
  /** Back to front only matters for text over text; the stage sorts by depth. */
  actors: LimelightActor[];
  /** The template the scene started from. */
  template?: string;
}

/** A picture kept for a scene's screens, in the Limelight database. */
export interface LimelightMedia {
  id: string;
  kind: 'image';
  /** The MIME type. */
  type: string;
  name: string;
  width: number;
  height: number;
  bytes: number;
  /**
   * The file itself. An ArrayBuffer rather than a Blob, since Playwright's
   * WebKit cannot store a Blob in IndexedDB (rule 63 in .agents/AGENTS.md).
   */
  data: ArrayBuffer;
  createdAt: number;
  from?: ScreenOrigin;
}

/** What the stage shows at one moment, from `sceneAt`. */
export interface ActorFrame {
  position: XYZ;
  turn: Turn;
  scale: number;
  opacity: number;
}

export interface ScreenFrame {
  /** The picture showing, or coming in. */
  media: string | null;
  /** The picture going out while a transition runs. */
  previous?: string | null;
  transition: ScreenTransition;
  /** 0 to 1 through the transition; 1 when none runs. */
  progress: number;
}

export interface SceneFrame {
  time: number;
  camera: CameraState;
  actors: Record<string, ActorFrame>;
  screens: Record<string, ScreenFrame>;
}
