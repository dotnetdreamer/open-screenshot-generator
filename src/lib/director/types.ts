// Director: a screen recording filmed on a 3D phone, with the camera moves
// worked out from what happens in the recording (or from a phone the user
// moves by hand). This file is the data model. Everything in it is plain JSON.
//
// Times are seconds of the film. The film starts at the recording's trim
// start, so film time t shows the recording at trim.start + t. Places on the
// screen are fractions of the recording's width and height, top left origin.

import type { DeviceType } from '@/types/artboard';

/** How much the camera does: Calm moves little and slowly, Bold moves more and faster. */
export type DirectorStyle = 'calm' | 'lively' | 'bold';

/** What happens in a stretch of the recording. */
export type MomentKind =
  /** Something small changes where a finger pressed (a button, a switch, a card). */
  | 'tap'
  /** Letters appear one by one while a keyboard is up. */
  | 'type'
  /** The content slides up or down. */
  | 'scroll'
  /** A new screen comes in (a push, a sheet, a tab, a cut). */
  | 'screen'
  /** Something moves in one place on its own: a chart grows, a card pops in. */
  | 'change'
  /** Nothing changes for a while. */
  | 'still';

/** A rectangle on the recording, in fractions of its width and height. */
export interface Rect01 {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A point on the recording, in fractions of its width and height. */
export interface Point01 {
  x: number;
  y: number;
}

/** The shot a moment gets: worked out by the director, or picked by the user. */
export type ShotChoice = 'auto' | 'close' | 'wide' | 'skip';

export interface Moment {
  id: string;
  kind: MomentKind;
  /** Film seconds. */
  start: number;
  end: number;
  /** Where it happens: what a close-up frames. Null for a moment with no one place (a new screen, a still). */
  focus: Rect01 | null;
  /** Where the finger most likely pressed, for the tap ring. Only for a tap. */
  point?: Point01;
  /** How much it matters, 0 to 1. The director gives close-ups to the moments that matter most. */
  weight: number;
  shot: ShotChoice;
  /** Words shown while the moment plays. */
  caption?: string;
  /** Changed by the user. Planning again from a new analysis keeps an edited moment as it is. */
  edited?: boolean;
}

/** The phone and the camera at one instant. */
export interface Pose {
  /** Degrees. Turns the phone about its long side: positive moves its right edge back. */
  yaw: number;
  /** Degrees. Tips the phone: positive moves its top edge back. */
  pitch: number;
  /** Degrees. Turns the phone in the picture's plane, counterclockwise. */
  roll: number;
  /** The place on the screen the camera centres on, fractions of the screen. */
  fx: number;
  fy: number;
  /** 1 shows the whole phone with room around it; 2 shows half its height. */
  zoom: number;
  /** Moves the phone up the picture, in phone heights. Negative is lower. */
  lift: number;
}

export type Ease = 'smooth' | 'snappy' | 'glide' | 'linear';

/** The pose the camera reaches at `t`, eased from the key before it. */
export interface CameraKey {
  t: number;
  pose: Pose;
  ease: Ease;
  /** Set on a key that starts a hold: the pose stays until the next key. */
  why?: string;
}

/** A ring drawn on the screen where a tap most likely happened. */
export interface TapMark {
  t: number;
  point: Point01;
}

/** Words on screen for a stretch of the film. */
export interface CaptionCue {
  start: number;
  end: number;
  text: string;
  /** The title at the start, the end card, or a moment's caption. */
  role: 'title' | 'caption' | 'end';
}

/** What the director worked out for a film: the camera, the tap rings and the words. */
export interface FilmPlan {
  duration: number;
  keys: CameraKey[];
  taps: TapMark[];
  cues: CaptionCue[];
}

/** One reading of a phone held in the hand, for a take. */
export interface MotionSample {
  /** Film seconds. */
  t: number;
  /** The phone's turn from where it was held at the start, as a quaternion [x, y, z, w] in the phone's own axes. */
  q: [number, number, number, number];
  /** Pinch: 1 is the plan's own framing, more moves in. */
  zoom?: number;
}

/** A take: the phone's movements recorded while the film played. */
export interface MotionTake {
  id: string;
  recordedAt: number;
  samples: MotionSample[];
  /** Where the readings came from, for the note under the take. */
  source: 'remote' | 'this-phone' | 'test';
}

/** Picture shapes the film can be made in. */
export type FilmFormat = 'vertical' | 'portrait' | 'square' | 'landscape';

/** The backdrop and lighting. */
export interface FilmLook {
  /** One of the BACKDROPS ids, or 'brand' for the project's own colours. */
  backdrop: string;
  /** For 'brand': the colours read from the project. */
  colors?: [string, string, string];
}

export interface FilmPhone {
  deviceType: DeviceType;
  /** A finish id of the model, or unset for its default. */
  finish?: string;
}

export interface FilmSound {
  /** Keep the recording's own sound. */
  recording: boolean;
}

export interface FilmText {
  /** A title over the first seconds, usually the app's name. Empty means none. */
  title: string;
  /** Words over the last seconds, the end card. Empty means none. */
  end: string;
  /** Show the moments' captions. */
  captions: boolean;
  /** Draw a ring where taps most likely happened. */
  taps: boolean;
}

/** Where the recording comes from. */
export interface FilmSource {
  /** Row id in the media table. */
  mediaId: string;
  name: string;
  width: number;
  height: number;
  duration: number;
}

/** A short summary of the analysis, kept so the timeline can draw it without reading the recording again. */
export interface ActivityTrack {
  /** Seconds between values. */
  step: number;
  /** How much changed, 0 to 1, one value per step. */
  values: number[];
}

/** How the phone turns: from the plan, or from a take made by hand. */
export type MotionMode = 'auto' | 'hand';

export interface Film {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  /** The project open when the film was made, or null outside the editor. */
  projectId: string | null;
  source: FilmSource;
  /** The part of the recording the film uses, in the recording's seconds. */
  trim: { start: number; end: number };
  format: FilmFormat;
  fps: 30 | 60;
  style: DirectorStyle;
  look: FilmLook;
  phone: FilmPhone;
  text: FilmText;
  sound: FilmSound;
  moments: Moment[];
  activity: ActivityTrack | null;
  /** Bumped when the analysis rules change, so an old film is read again. */
  analysisVersion: number;
  motion: MotionMode;
  take: MotionTake | null;
  /** How strongly a take turns the phone, 0.2 to 1.5. */
  takeStrength: number;
  /** Small pictures from the recording for the timeline, kept so a film opens without reading the recording again. */
  strip?: { t: number; url: string }[];
}
