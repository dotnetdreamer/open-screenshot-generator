// Director: screen recordings filmed on a 3D phone, with the camera moves
// worked out from what happens in them (or from a phone the user moves by
// hand). This file is the data model. Everything in it is plain JSON.
//
// A film is a row of clips, one after another: each clip shows a part of one
// recording. Two clocks run through the model, and every field says which:
// film seconds (from the film's start) and recording seconds (from the start
// of a clip's own recording). A clip keeps its moments in recording seconds,
// so trimming, splitting, moving or swapping clips never rewrites them; the
// film's moments are worked out from the clips (timeline.ts). Places on the
// screen are fractions of the recording's width and height, top left origin.

import type { DeviceType } from '@/types/artboard';

/**
 * How much the camera does: Calm moves little and slowly, Bold moves more and
 * faster. Cinematic opens close on the screen at a steep angle and pulls back
 * fast, holds the phone big and low under the words, and spins it in at each
 * new recording.
 */
export type DirectorStyle = 'calm' | 'lively' | 'bold' | 'cinematic';

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
  /** Recording seconds inside a clip; film seconds once worked out for the whole film (filmMoments). */
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
  /**
   * Deleted by the user. Kept on the clip, unseen, so reading the recording
   * again doesn't bring the same moment back. Nothing but a new reading looks at it.
   */
  removed?: boolean;
  /**
   * Where Director found this moment, in its recording's seconds, kept however
   * the user moves or changes it. A new reading knows the moment by this, so
   * the user's version stands and the moment never comes back twice. Absent on
   * a moment the user added.
   */
  found?: MomentOrigin;
  /**
   * Moved here by the user from another clip. It stands for nothing found in
   * this clip: the clip it came from keeps a deleted copy that stands for it.
   */
  movedIn?: boolean;
}

/** A moment as Director found it: the recording, the kind, and when, in the recording's seconds. */
export interface MomentOrigin {
  mediaId: string;
  kind: MomentKind;
  start: number;
  end: number;
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
  /** The lens's angle of view in degrees. Unset is the stage's long lens (22); a wider one close up makes a steep angle look steeper. */
  lens?: number;
}

/** `whip` is a fast move that speeds up hard and lands soft, for a pull-back. */
export type Ease = 'smooth' | 'snappy' | 'glide' | 'linear' | 'whip';

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
  /** Metres the phone moved toward the person since Center; used only with the film's forward and back on. */
  depth?: number;
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
  /** Picked by the user; otherwise the phone follows the first recording's shape. */
  picked?: boolean;
}

export interface FilmSound {
  /** Keep the recording's own sound. */
  recording: boolean;
}

/**
 * How the words look. Soft rises in word by word at the top. Headline is big
 * and set to the left, line by line. Bold captions are capitals at the
 * bottom, outlined, popping in word by word.
 */
export type WordsStyle = 'soft' | 'headline' | 'punchy';

/** The last seconds of the film: the app's icon and name, and where to get it. */
export interface EndCard {
  on: boolean;
  /** The app's name under the icon. Empty uses the title. */
  name: string;
  /** Apple's and Google's own badges, used as they come and never animated. */
  appStore: boolean;
  googlePlay: boolean;
  /** A white card over the film; otherwise the film's own backdrop, with the phone moved down under the card. */
  light: boolean;
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
  /** How the words look. Unset is 'soft'. Words between *stars* take the highlight in every style. */
  style?: WordsStyle;
  /** The words' colour. Unset follows the style and the backdrop. */
  ink?: string;
  /** The highlight's colour. Unset follows the style and the backdrop. */
  accent?: string;
  /** The app's icon, a PNG data URL at most 512 pixels across: on the end card, and at the top with `logo`. */
  icon?: string;
  /** The icon at the top while the film plays, with rings going out from it. */
  logo?: boolean;
  card?: EndCard;
}

/** A recording: a row in the media table and what it is. */
export interface FilmSource {
  /** Row id in the media table. */
  mediaId: string;
  name: string;
  width: number;
  height: number;
  /** The whole recording's length, in seconds. */
  duration: number;
}

/** A short summary of the analysis, kept so the timeline can draw it without reading the recording again. */
export interface ActivityTrack {
  /** Seconds between values. */
  step: number;
  /** How much changed, 0 to 1, one value per step. */
  values: number[];
  /** Recording seconds where the first value is. Unset is 0. */
  start?: number;
}

/** One stretch of the film: a part of one recording. */
export interface FilmClip extends FilmSource {
  id: string;
  /** The part of the recording the clip shows, in recording seconds. */
  in: number;
  out: number;
  /** What happens in the recording, in recording seconds. */
  moments: Moment[];
  activity: ActivityTrack | null;
  /** The part of the recording read for moments, and the rules it was read by; null before it's read. */
  read: { start: number; end: number; version: number } | null;
  /** Small pictures for the timeline, in recording seconds, kept so a film opens without reading the recording again. */
  strip?: { t: number; url: string }[];
}

/** How the phone turns: from the plan, or from a take made by hand. */
export type MotionMode = 'auto' | 'hand';

export interface Film {
  id: string;
  /** 2 since films have clips; a stored film without it is upgraded when read (upgradeFilm). */
  version: 2;
  name: string;
  /** The user typed the name; until then the first recording names the film. */
  named?: boolean;
  createdAt: number;
  updatedAt: number;
  /** The project open when the film was made, or null outside the editor. */
  projectId: string | null;
  /** The template the film started from. */
  template?: string;
  /** The recordings, one after another. Empty while the moves come first. */
  clips: FilmClip[];
  /** Film seconds the film runs while it has no recording: a take made first is recorded against it. */
  placeholderLength: number;
  format: FilmFormat;
  fps: 30 | 60;
  style: DirectorStyle;
  look: FilmLook;
  phone: FilmPhone;
  text: FilmText;
  sound: FilmSound;
  motion: MotionMode;
  take: MotionTake | null;
  /** How strongly a take turns the phone, 0.2 to 1.5. */
  takeStrength: number;
  /** Forward and back: a phone moved closer moves the phone in the film in. Off unless turned on, as a hand's push isn't always clean. */
  handDepth?: boolean;
}
