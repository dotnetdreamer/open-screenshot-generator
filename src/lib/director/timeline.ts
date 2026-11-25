// The film's timeline: clips one after another, each a part of one
// recording, and everything that maps between film seconds and a clip's
// recording seconds. The editing a person does on the timeline (split,
// trim, move, swap a recording, change the recording from a point on) and
// on the moments is here too. Pure, so the view, the player, the export and
// the tests share every rule.

import { ANALYSIS_VERSION } from './analyze';
import type { ActivityTrack, Film, FilmClip, FilmSource, Moment, MomentKind, MomentOrigin, Rect01 } from './types';

/** The longest a film's recordings can be together, in seconds. */
export const MAX_FILM_SECONDS = 90;
/** The shortest a clip can be. */
export const MIN_CLIP_SECONDS = 0.5;
/** A split leaves at least this much on each side. */
export const MIN_SPLIT_SIDE = 0.3;
/** A moment a clip's ends cut down to less than this (or less than its own length) is left out. */
const MIN_MOMENT = 0.2;

export function clipLength(clip: Pick<FilmClip, 'in' | 'out'>): number {
  return Math.max(0, clip.out - clip.in);
}

/** A clip and where it sits in the film. */
export interface ClipSpan {
  clip: FilmClip;
  index: number;
  /** Film seconds. */
  start: number;
  end: number;
}

export function clipSpans(film: Pick<Film, 'clips'>): ClipSpan[] {
  let at = 0;
  return film.clips.map((clip, index) => {
    const start = at;
    at += clipLength(clip);
    return { clip, index, start, end: at };
  });
}

/** Film seconds of the recordings together, or the placeholder's length in a film without one. */
export function bodyLength(film: Pick<Film, 'clips' | 'placeholderLength'>): number {
  if (!film.clips.length) return Math.max(1, film.placeholderLength);
  return Math.max(MIN_CLIP_SECONDS, film.clips.reduce((sum, clip) => sum + clipLength(clip), 0));
}

/** The clip showing at film time `t`: the last one through the end hold, and none in a film without a recording. */
export function spanAt(film: Pick<Film, 'clips'>, t: number): ClipSpan | null {
  const spans = clipSpans(film);
  if (!spans.length) return null;
  for (const span of spans) if (t < span.end - 1e-9) return span;
  return spans[spans.length - 1];
}

/** Recording seconds for film time `t` in a span, held at the clip's ends. */
export function sourceTime(span: ClipSpan, t: number): number {
  return Math.min(span.clip.out, Math.max(span.clip.in, span.clip.in + (t - span.start)));
}

/** Film seconds for recording seconds `s` of a span's clip. */
export function filmTimeOf(span: ClipSpan, s: number): number {
  return span.start + (s - span.clip.in);
}

/** Where one clip ends and the next begins, in film seconds. */
export function cutTimes(film: Pick<Film, 'clips'>): number[] {
  return clipSpans(film)
    .slice(1)
    .map((span) => span.start);
}

/**
 * Every clip's moments in film seconds, cut to the part of the recording
 * each clip shows. A moment the clip shows whole stays however short it is
 * (a tap is often a tenth of a second); one a clip's end cuts into stays when
 * enough of it shows.
 */
export function filmMoments(film: Pick<Film, 'clips'>): Moment[] {
  const out: Moment[] = [];
  for (const span of clipSpans(film)) {
    for (const m of span.clip.moments) {
      if (m.removed) continue;
      const s = Math.max(m.start, span.clip.in);
      const e = Math.min(m.end, span.clip.out);
      if (e <= s || e - s < Math.min(MIN_MOMENT, m.end - m.start) - 1e-9) continue;
      out.push({ ...m, start: filmTimeOf(span, s), end: filmTimeOf(span, e) });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/** Film seconds still free for recordings, leaving out one clip's own. */
export function roomLeft(film: Pick<Film, 'clips'>, exceptClipId?: string): number {
  const used = film.clips.reduce((sum, clip) => (clip.id === exceptClipId ? sum : sum + clipLength(clip)), 0);
  return Math.max(0, MAX_FILM_SECONDS - used);
}

/** Does a clip need reading for its moments: never read, read by older rules, or showing a part that wasn't read. */
export function clipNeedsRead(clip: FilmClip): boolean {
  const read = clip.read;
  if (!read || read.version < ANALYSIS_VERSION || !clip.strip?.length) return true;
  return clip.in < read.start - 0.05 || clip.out > read.end + 0.05;
}

// ---------------------------------------------------------------------------
// Ids
// ---------------------------------------------------------------------------

function nextClipId(film: Pick<Film, 'clips'>): string {
  let n = film.clips.length + 1;
  while (film.clips.some((clip) => clip.id === `c${n}`)) n += 1;
  return `c${n}`;
}

/** A moment's id inside its clip, without the clip's part: "m3" of "c2-m3". */
function localId(id: string): string {
  const dash = id.indexOf('-');
  return dash >= 0 ? id.slice(dash + 1) : id;
}

/** `${clipId}-${local}`, made unique among `taken`. */
function momentId(clipId: string, local: string, taken: Set<string>): string {
  let id = `${clipId}-${local}`;
  let n = 2;
  while (taken.has(id)) id = `${clipId}-${local}_${n++}`;
  taken.add(id);
  return id;
}

function allMomentIds(film: Pick<Film, 'clips'>): Set<string> {
  return new Set(film.clips.flatMap((clip) => clip.moments.map((m) => m.id)));
}

function touch(film: Film, clips: FilmClip[], extra: Partial<Film> = {}): Film {
  return { ...film, ...extra, clips, updatedAt: Date.now() };
}

// ---------------------------------------------------------------------------
// Clips
// ---------------------------------------------------------------------------

function blankClip(id: string, source: FilmSource, inT: number, outT: number): FilmClip {
  return {
    id,
    mediaId: source.mediaId,
    name: source.name,
    width: source.width,
    height: source.height,
    duration: source.duration,
    in: inT,
    out: outT,
    moments: [],
    activity: null,
    read: null,
  };
}

/**
 * A recording added as a clip at `index` (the end by default), as long as
 * there's room left in the film for it. Null when there's no room, or the
 * recording is too short to use.
 */
export function addClip(film: Film, source: FilmSource, index = film.clips.length): { film: Film; clipId: string } | null {
  const room = roomLeft(film);
  const out = Math.min(source.duration, room);
  if (out < MIN_CLIP_SECONDS) return null;
  const clip = blankClip(nextClipId(film), source, 0, out);
  const clips = [...film.clips];
  clips.splice(Math.min(Math.max(0, index), clips.length), 0, clip);
  return { film: touch(film, clips), clipId: clip.id };
}

/** The clip under film time `t` cut in two there. Null when `t` is too near either end of its clip. */
export function splitAt(film: Film, t: number): { film: Film; left: string; right: string } | null {
  const span = spanAt(film, t);
  if (!span || t < span.start || t > span.end) return null;
  const s = sourceTime(span, t);
  if (s - span.clip.in < MIN_SPLIT_SIDE || span.clip.out - s < MIN_SPLIT_SIDE) return null;
  const rightId = nextClipId(film);
  const taken = allMomentIds(film);
  const left: FilmClip = { ...span.clip, out: s };
  // Both halves keep what was read from the recording; each shows its own part of it.
  const right: FilmClip = { ...span.clip, id: rightId, in: s, moments: span.clip.moments.map((m) => ({ ...m, id: momentId(rightId, localId(m.id), taken) })) };
  const clips = [...film.clips];
  clips.splice(span.index, 1, left, right);
  return { film: touch(film, clips), left: left.id, right: rightId };
}

/**
 * Another recording in a clip's place. The last clip shows the whole new
 * recording (as much as fits); a clip with others after it keeps its
 * length, so they stay where they are, unless the new recording is shorter.
 */
export function replaceClip(film: Film, clipId: string, source: FilmSource): Film {
  const index = film.clips.findIndex((clip) => clip.id === clipId);
  if (index < 0) return film;
  const old = film.clips[index];
  const last = index === film.clips.length - 1;
  const want = last ? source.duration : clipLength(old);
  const out = Math.max(Math.min(MIN_CLIP_SECONDS, source.duration), Math.min(source.duration, want, roomLeft(film, clipId)));
  const clips = [...film.clips];
  clips[index] = blankClip(old.id, source, 0, out);
  return touch(film, clips);
}

/**
 * The recording changes at film time `t`: the clip there is split, and the
 * part from `t` on shows `source` instead. At a clip's start the whole clip
 * changes; at the film's end (or in a film with no recording yet) the
 * recording is added after the others.
 */
export function changeRecordingFrom(film: Film, t: number, source: FilmSource): { film: Film; clipId: string } | null {
  const spans = clipSpans(film);
  if (!spans.length || t >= spans[spans.length - 1].end - MIN_SPLIT_SIDE) return addClip(film, source);
  const span = spanAt(film, Math.max(0, t))!;
  if (t - span.start < MIN_SPLIT_SIDE) return { film: replaceClip(film, span.clip.id, source), clipId: span.clip.id };
  if (span.end - t < MIN_SPLIT_SIDE) {
    const next = spans[span.index + 1];
    return next ? { film: replaceClip(film, next.clip.id, source), clipId: next.clip.id } : addClip(film, source);
  }
  const split = splitAt(film, t);
  if (!split) return { film: replaceClip(film, span.clip.id, source), clipId: span.clip.id };
  return { film: replaceClip(split.film, split.right, source), clipId: split.right };
}

/** A clip's part of its recording changed, in recording seconds, kept to the recording and to the room in the film. */
export function trimClip(film: Film, clipId: string, patch: { in?: number; out?: number }): Film {
  const index = film.clips.findIndex((clip) => clip.id === clipId);
  if (index < 0) return film;
  const clip = film.clips[index];
  const room = Math.max(MIN_CLIP_SECONDS, roomLeft(film, clipId));
  const minimum = Math.min(MIN_CLIP_SECONDS, clip.duration);
  let inT = Math.min(Math.max(0, patch.in ?? clip.in), Math.max(0, clip.duration - minimum));
  let outT = Math.min(clip.duration, Math.max(inT + minimum, patch.out ?? clip.out));
  if (outT - inT > room) {
    if (patch.in !== undefined && patch.out === undefined) inT = outT - room;
    else outT = inT + room;
  }
  if (inT === clip.in && outT === clip.out) return film;
  const clips = [...film.clips];
  clips[index] = { ...clip, in: inT, out: outT };
  return touch(film, clips);
}

/** A clip moved to `toIndex` among the clips. */
export function moveClip(film: Film, clipId: string, toIndex: number): Film {
  const from = film.clips.findIndex((clip) => clip.id === clipId);
  if (from < 0) return film;
  const to = Math.min(Math.max(0, toIndex), film.clips.length - 1);
  if (to === from) return film;
  const clips = [...film.clips];
  const [clip] = clips.splice(from, 1);
  clips.splice(to, 0, clip);
  return touch(film, clips);
}

/** A clip taken out; the clips after it close the gap. A film left with none goes back to its placeholder. */
export function removeClip(film: Film, clipId: string): Film {
  const clips = film.clips.filter((clip) => clip.id !== clipId);
  if (clips.length === film.clips.length) return film;
  return touch(film, clips);
}

// ---------------------------------------------------------------------------
// Moments
// ---------------------------------------------------------------------------

/** True for a moment the user added ("u1", or "u1_2" once it moved to another clip), not one Director found. */
function addedByUser(m: Moment): boolean {
  return !m.found && !m.movedIn && /^u\d/.test(localId(m.id));
}

/**
 * Where Director found a moment, so a new reading of its clip knows it: its
 * `found`, or for a moment read before origins were kept, where it is now in
 * the recording `mediaId` of its clip. Null for a moment that stands for
 * nothing Director found in this clip: one the user added, or one moved in
 * from another clip (its own clip keeps a deleted copy that stands for it).
 */
export function originOf(m: Moment, mediaId = ''): MomentOrigin | null {
  if (m.movedIn || addedByUser(m)) return null;
  if (m.found) return m.found;
  return { mediaId, kind: m.kind, start: m.start, end: m.end };
}

/** Whether a new reading's moment could be the one Director found at `origin` before: the same recording and kind, about the same time. */
function sameFinding(origin: MomentOrigin, m: Moment): boolean {
  const mediaId = m.found?.mediaId;
  if (origin.mediaId && mediaId && origin.mediaId !== mediaId) return false;
  return origin.kind === m.kind && m.start < origin.end + 0.2 && m.end > origin.start - 0.2;
}

/** How far a new reading's moment is from where a moment was found: the closest is the same moment. */
function findingDistance(origin: MomentOrigin, m: Moment): number {
  return Math.abs(m.start - origin.start) + Math.abs(m.end - origin.end);
}

/**
 * A new reading of one clip, keeping what the user did there. Every moment
 * the user edited or deleted in this clip stays as they left it, and stands
 * for exactly one moment of the new reading, the closest one Director found
 * again, which is left out so it never comes back or shows twice. Two taps a
 * tenth of a second apart are two moments: deleting one leaves the other. A
 * moment the user added, or moved in from another clip, stands for nothing.
 * `mediaId` is the clip's recording, for moments read before origins were
 * kept. Every moment ends up with its own id.
 */
export function mergeMoments(found: Moment[], previous: Moment[], mediaId = ''): Moment[] {
  const kept = previous.filter((m) => m.edited);
  const pairs: { found: Moment; kept: Moment; distance: number }[] = [];
  for (const k of kept) {
    const origin = originOf(k, mediaId);
    if (!origin) continue;
    for (const f of found) if (sameFinding(origin, f)) pairs.push({ found: f, kept: k, distance: findingDistance(origin, f) });
  }
  pairs.sort((a, b) => a.distance - b.distance);
  const claimed = new Set<Moment>();
  const used = new Set<Moment>();
  for (const pair of pairs) {
    if (claimed.has(pair.found) || used.has(pair.kept)) continue;
    claimed.add(pair.found);
    used.add(pair.kept);
  }
  const fresh = found.filter((m) => !claimed.has(m));
  const all = [...kept, ...fresh].sort((a, b) => a.start - b.start);
  const seen = new Set<string>();
  return all.map((m, index) => {
    if (!seen.has(m.id)) {
      seen.add(m.id);
      return m;
    }
    let n = index + 1;
    while (seen.has(`${m.id}_${n}`)) n += 1;
    seen.add(`${m.id}_${n}`);
    return { ...m, id: `${m.id}_${n}` };
  });
}

export interface ClipReading {
  /** Found moments, in recording seconds, with the reader's own ids ("m1"). */
  moments: Moment[];
  activity: ActivityTrack;
  /** Recording seconds. */
  thumbs: { t: number; url: string }[];
  /** The part of the recording that was read, in recording seconds. */
  range: { start: number; end: number };
}

/** What reading a clip's recording found, kept on the clip (and its moments given the clip's ids). */
export function withClipReading(film: Film, clipId: string, reading: ClipReading): Film {
  const index = film.clips.findIndex((clip) => clip.id === clipId);
  if (index < 0) return film;
  const clip = film.clips[index];
  const taken = new Set(film.clips.filter((c) => c.id !== clipId).flatMap((c) => c.moments.map((m) => m.id)));
  for (const m of clip.moments) if (m.edited) taken.add(m.id);
  const found = reading.moments.map((m) => ({
    ...m,
    id: momentId(clipId, localId(m.id), taken),
    found: { mediaId: clip.mediaId, kind: m.kind, start: m.start, end: m.end },
  }));
  // Only this clip's own decisions count: another clip showing the same part of
  // the recording has its own moments, and a moment moved away left a deleted copy here.
  const clips = [...film.clips];
  clips[index] = {
    ...clip,
    moments: mergeMoments(found, clip.moments, clip.mediaId),
    activity: reading.activity,
    read: { start: reading.range.start, end: reading.range.end, version: ANALYSIS_VERSION },
    strip: reading.thumbs,
  };
  return touch(film, clips);
}

function findMoment(film: Film, id: string): { clipIndex: number; moment: Moment } | null {
  for (let clipIndex = 0; clipIndex < film.clips.length; clipIndex++) {
    const moment = film.clips[clipIndex].moments.find((m) => m.id === id && !m.removed);
    if (moment) return { clipIndex, moment };
  }
  return null;
}

/**
 * A change to one moment, marking it as the user's. Times in the patch are
 * film seconds; a moment moved into another clip moves to that clip.
 */
export function editMoment(film: Film, id: string, patch: Partial<Omit<Moment, 'id'>>): Film {
  return retimeMoment(film, id, patch).film;
}

/**
 * A moment as the user leaves it: kept with where Director found it (`found`,
 * written now for a moment read before origins were kept, from where it still
 * is), so a new reading knows it.
 */
function withOrigin(m: Moment, mediaId: string): Moment {
  if (m.found || m.movedIn || addedByUser(m)) return m;
  return { ...m, found: { mediaId, kind: m.kind, start: m.start, end: m.end } };
}

/**
 * `editMoment`, also giving the moment's id afterwards: a moment moved into
 * another clip takes an id of that clip, and whatever had it picked follows it.
 */
export function retimeMoment(film: Film, id: string, patch: Partial<Omit<Moment, 'id'>>): { film: Film; id: string } {
  const found = findMoment(film, id);
  if (!found) return { film, id };
  const spans = clipSpans(film);
  const span = spans[found.clipIndex];
  const clips = film.clips.map((clip) => ({ ...clip, moments: [...clip.moments] }));
  const own = clips[found.clipIndex];
  const moment = withOrigin(found.moment, own.mediaId);
  if (patch.start === undefined && patch.end === undefined) {
    own.moments = own.moments.map((m) => (m.id === id ? { ...moment, ...patch, edited: true } : m));
    return { film: touch(film, clips), id };
  }
  // The moment as the timeline shows it, in film seconds, then the change.
  const shownStart = filmTimeOf(span, Math.max(found.moment.start, span.clip.in));
  const shownEnd = filmTimeOf(span, Math.min(found.moment.end, span.clip.out));
  const body = bodyLength(film);
  const startT = Math.min(Math.max(0, patch.start ?? shownStart), Math.max(0, body - MIN_MOMENT));
  const length = Math.max(MIN_MOMENT, (patch.end ?? shownEnd) - (patch.start ?? shownStart));
  const target = spanAt(film, startT)!;
  const s = sourceTime(target, startT);
  const e = Math.min(target.clip.out, s + length);
  const startS = Math.min(s, Math.max(target.clip.in, e - MIN_MOMENT));
  const { start: _start, end: _end, ...rest } = patch;
  const placed = { start: startS, end: Math.max(e, startS + MIN_MOMENT), edited: true };
  if (target.index === found.clipIndex) {
    own.moments = own.moments.map((m) => (m.id === id ? { ...moment, ...rest, ...placed } : m)).sort((a, b) => a.start - b.start);
    return { film: touch(film, clips), id };
  }
  // Into another clip. A moment Director found leaves a deleted copy in its own
  // clip, which stands for it when that clip is read again, even once the
  // other clip is gone; the moved one stands for nothing where it lands.
  const stays = originOf(moment, own.mediaId) !== null;
  own.moments = stays ? own.moments.map((m) => (m.id === id ? { ...moment, removed: true, edited: true } : m)) : own.moments.filter((m) => m.id !== id);
  const home = clips[target.index];
  const nextId = momentId(home.id, localId(id), allMomentIds({ clips }));
  const { found: _found, ...unfound } = moment;
  home.moments = [...home.moments, { ...unfound, ...rest, ...placed, id: nextId, movedIn: stays || !!moment.movedIn }].sort((a, b) => a.start - b.start);
  return { film: touch(film, clips), id: nextId };
}

/** A moment the user adds at film time `t`: a close-up on the middle of the screen, which they then move. Null without a recording. */
export function addMoment(film: Film, t: number, kind: MomentKind = 'tap', focus: Rect01 = { x: 0.2, y: 0.35, w: 0.6, h: 0.22 }): { film: Film; id: string } | null {
  const span = spanAt(film, t);
  if (!span) return null;
  const s = Math.min(sourceTime(span, t), Math.max(span.clip.in, span.clip.out - 0.6));
  const clips = film.clips.map((clip) => ({ ...clip }));
  const clip = clips[span.index];
  let n = 1;
  while (clip.moments.some((m) => localId(m.id) === `u${n}`)) n += 1;
  const id = momentId(clip.id, `u${n}`, allMomentIds(film));
  const moment: Moment = { id, kind, start: s, end: Math.min(clip.out, s + 1.2), focus, weight: 1, shot: 'close', edited: true };
  clip.moments = [...clip.moments, moment].sort((a, b) => a.start - b.start);
  return { film: touch(film, clips), id };
}

/**
 * A moment deleted. One Director found in this clip stays on it, marked
 * removed and keeping where it was found, so reading the clip again doesn't
 * bring it back. One the user added, or moved in from another clip (whose own
 * clip already keeps a deleted copy), just goes, whatever id it has.
 */
export function removeMoment(film: Film, id: string): Film {
  const found = findMoment(film, id);
  if (!found) return film;
  const clips = film.clips.map((clip, index) => {
    if (index !== found.clipIndex) return clip;
    const moment = withOrigin(found.moment, clip.mediaId);
    const stays = originOf(moment, clip.mediaId) !== null;
    return { ...clip, moments: stays ? clip.moments.map((m) => (m.id === id ? { ...moment, removed: true, edited: true } : m)) : clip.moments.filter((m) => m.id !== id) };
  });
  return touch(film, clips);
}

// ---------------------------------------------------------------------------
// Films saved before clips
// ---------------------------------------------------------------------------

/** A film as it was stored before clips: one recording, and its moments in film seconds. */
interface FilmBeforeClips extends Omit<Film, 'version' | 'clips' | 'placeholderLength' | 'template'> {
  source: FilmSource;
  trim: { start: number; end: number };
  moments: Moment[];
  activity: ActivityTrack | null;
  analysisVersion: number;
  strip?: { t: number; url: string }[];
}

/** A stored film in today's shape: one saved before clips becomes a film of one clip. */
export function upgradeFilm(stored: Film | FilmBeforeClips): Film {
  if ((stored as Film).version === 2 && Array.isArray((stored as Film).clips)) return stored as Film;
  const old = stored as FilmBeforeClips;
  const shift = old.trim.start;
  const clip: FilmClip = {
    ...blankClip('c1', old.source, old.trim.start, old.trim.end),
    moments: (old.moments ?? []).map((m) => ({ ...m, id: `c1-${m.id}`, start: m.start + shift, end: m.end + shift })),
    activity: old.activity ? { ...old.activity, start: shift } : null,
    read: old.analysisVersion ? { start: old.trim.start, end: old.trim.end, version: old.analysisVersion } : null,
    strip: old.strip?.map((thumb) => ({ t: thumb.t + shift, url: thumb.url })),
  };
  const { source: _source, trim: _trim, moments: _moments, activity: _activity, analysisVersion: _version, strip: _strip, ...rest } = old;
  return { ...rest, version: 2, clips: [clip], placeholderLength: 15 };
}
