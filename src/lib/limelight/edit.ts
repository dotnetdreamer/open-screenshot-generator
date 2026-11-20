/**
 * Changes to a Limelight scene, as pure functions that return a new scene.
 * The view and the agent's tools both go through these, so a shot the camera
 * drag adds and one an agent adds follow the same rules, and every change is
 * a new object React and the undo stack can tell apart.
 */

import { actorAt, cameraAt } from './animate';
import { DISTANCE_MAX, DISTANCE_MIN, cameraPose, distanceToFrame, nearestAngle } from './camera';
import { DURATION_MAX, DURATION_MIN, MAX_ACTORS, MAX_DEVICES, MAX_KEYS, MAX_SCREENS, deviceHeight, newId, normalizeFormat } from './scene';
import { hullPoints } from '@/lib/device3dGeometry';
import { CAP_SHARE, faceReady, measureLineWidth, tableLineWidth } from './fonts';
import { stageModelFor } from './models';
import type {
  ActorMotion,
  ActorPose,
  CameraShot,
  CameraState,
  DeviceActor,
  LimelightActor,
  LimelightEase,
  LimelightFormat,
  LimelightLook,
  LimelightMusic,
  LimelightScene,
  ScreenChange,
  PictureActor,
  TextActor,
  Turn,
  XYZ,
} from './types';

/** Two keys closer than this are the same moment: about a frame at 30 frames a second. */
export const SAME_MOMENT = 1 / 30 - 0.001;

/**
 * A change: later than the last one even if this computer's clock is behind
 * the one the scene was last saved on, so Google Drive can tell it is new.
 */
export function laterThan(updatedAt: number): number {
  return Math.max(Date.now(), (Number.isFinite(updatedAt) ? updatedAt : 0) + 1);
}

function touch(scene: LimelightScene, patch: Partial<LimelightScene>): LimelightScene {
  return { ...scene, ...patch, updatedAt: laterThan(scene.updatedAt) };
}

function sorted<T extends { time: number }>(keys: T[]): T[] {
  return keys.slice().sort((a, b) => a.time - b.time);
}

// ---------------------------------------------------------------------------
// Camera shots
// ---------------------------------------------------------------------------

export interface ShotResult {
  scene: LimelightScene;
  shotId: string;
  /** True when a new shot was made, false when one at that moment was changed. */
  added: boolean;
}

/**
 * Puts the camera at `camera` at `time`: the shot already at that moment
 * changes, or a new shot is added. Angles are moved to the turn nearest the
 * shots either side, so a new shot never swings the long way round.
 */
export function setShotAt(scene: LimelightScene, time: number, camera: CameraState, ease?: LimelightEase): ShotResult {
  const shots = scene.camera.shots;
  const at = Math.max(0, time);
  const existing = shots.find((shot) => Math.abs(shot.time - at) <= SAME_MOMENT);
  const reference = cameraAt(shots, 0, at);
  const next: CameraState = {
    ...camera,
    target: { ...camera.target },
    azimuth: nearestAngle(camera.azimuth, reference.azimuth),
    roll: nearestAngle(camera.roll, reference.roll),
  };
  if (existing) {
    const changed = shots.map((shot) => (shot.id === existing.id ? { ...shot, camera: next, ease: ease ?? shot.ease } : shot));
    return { scene: touch(scene, { camera: { ...scene.camera, shots: changed } }), shotId: existing.id, added: false };
  }
  if (shots.length >= MAX_KEYS) {
    // Full: change the nearest shot instead of adding one.
    const nearest = shots.reduce((best, shot) => (Math.abs(shot.time - at) < Math.abs(best.time - at) ? shot : best));
    const changed = shots.map((shot) => (shot.id === nearest.id ? { ...shot, camera: next } : shot));
    return { scene: touch(scene, { camera: { ...scene.camera, shots: changed } }), shotId: nearest.id, added: false };
  }
  // A new shot leaves the way the shot before it did, so a run of glides stays one.
  const before = sorted(shots).filter((shot) => shot.time < at).pop();
  const shot: CameraShot = { id: newId('shot'), time: at, ease: ease ?? before?.ease ?? 'smooth', camera: next };
  return { scene: touch(scene, { camera: { ...scene.camera, shots: sorted([...shots, shot]) } }), shotId: shot.id, added: true };
}

export function updateShot(scene: LimelightScene, shotId: string, patch: Partial<Pick<CameraShot, 'time' | 'ease' | 'camera'>>): LimelightScene {
  const shots = scene.camera.shots.map((shot) =>
    shot.id === shotId
      ? { ...shot, ...patch, time: patch.time === undefined ? shot.time : Math.max(0, patch.time), camera: patch.camera ? { ...patch.camera, target: { ...patch.camera.target } } : shot.camera }
      : shot
  );
  return touch(scene, { camera: { ...scene.camera, shots: sorted(shots) } });
}

/** Removes a shot. The last one stays: a scene always has a camera. */
export function removeShot(scene: LimelightScene, shotId: string): LimelightScene {
  if (scene.camera.shots.length <= 1) return scene;
  return touch(scene, { camera: { ...scene.camera, shots: scene.camera.shots.filter((shot) => shot.id !== shotId) } });
}

export function setShake(scene: LimelightScene, shake: number): LimelightScene {
  return touch(scene, { camera: { ...scene.camera, shake: Math.min(1, Math.max(0, shake)) } });
}

// ---------------------------------------------------------------------------
// Actors
// ---------------------------------------------------------------------------

export function deviceCount(scene: LimelightScene): number {
  return scene.actors.filter((actor) => actor.kind === 'device').length;
}

/** Why another actor of this kind can't be added, or null when it can. */
export function cannotAdd(scene: LimelightScene, kind: LimelightActor['kind']): string | null {
  if (scene.actors.length >= MAX_ACTORS) return `A scene holds up to ${MAX_ACTORS} things`;
  if (kind === 'device' && deviceCount(scene) >= MAX_DEVICES) return `A scene holds up to ${MAX_DEVICES} devices`;
  return null;
}

export function addActor(scene: LimelightScene, actor: LimelightActor): LimelightScene {
  if (cannotAdd(scene, actor.kind)) return scene;
  return touch(scene, { actors: [...scene.actors, actor] });
}

export function removeActor(scene: LimelightScene, actorId: string): LimelightScene {
  return touch(scene, { actors: scene.actors.filter((actor) => actor.id !== actorId) });
}

/** Fields of a device, a title or a picture card; each actor takes the ones it has. */
type ActorPatch = Partial<Omit<DeviceActor, 'id' | 'kind' | 'poses' | 'screens'>> &
  Partial<Omit<TextActor, 'id' | 'kind' | 'poses'>> &
  Partial<Omit<PictureActor, 'id' | 'kind' | 'poses' | 'media'>>;

export function updateActor(scene: LimelightScene, actorId: string, patch: ActorPatch): LimelightScene {
  return touch(scene, {
    actors: scene.actors.map((actor) => (actor.id === actorId ? ({ ...actor, ...patch, id: actor.id, kind: actor.kind } as LimelightActor) : actor)),
  });
}

export function setMotion(scene: LimelightScene, actorId: string, motion: Partial<ActorMotion>): LimelightScene {
  return touch(scene, {
    actors: scene.actors.map((actor) => (actor.id === actorId ? { ...actor, motion: { ...actor.motion, ...motion } } : actor)),
  });
}

/** Moves an actor to the front or back of the list, for text drawn over text. */
export function moveActor(scene: LimelightScene, actorId: string, toIndex: number): LimelightScene {
  const from = scene.actors.findIndex((actor) => actor.id === actorId);
  if (from < 0) return scene;
  const actors = scene.actors.slice();
  const [actor] = actors.splice(from, 1);
  actors.splice(Math.max(0, Math.min(actors.length, toIndex)), 0, actor);
  return touch(scene, { actors });
}

export function duplicateActor(scene: LimelightScene, actorId: string, offset = { x: 9, y: 0, z: 0 }): { scene: LimelightScene; actorId: string | null } {
  const source = scene.actors.find((actor) => actor.id === actorId);
  if (!source || cannotAdd(scene, source.kind)) return { scene, actorId: null };
  const copy: LimelightActor = JSON.parse(JSON.stringify(source));
  copy.id = newId('actor');
  copy.name = `${source.name} copy`.slice(0, 80);
  copy.poses = copy.poses.map((pose) => ({
    ...pose,
    id: newId('pose'),
    position: { x: pose.position.x + offset.x, y: pose.position.y + offset.y, z: pose.position.z + offset.z },
  }));
  if (copy.kind === 'device') copy.screens = copy.screens.map((screen) => ({ ...screen, id: newId('screen') }));
  return { scene: touch(scene, { actors: [...scene.actors, copy] }), actorId: copy.id };
}

// ---------------------------------------------------------------------------
// Poses
// ---------------------------------------------------------------------------

export type PoseValues = Pick<ActorPose, 'position' | 'turn' | 'scale' | 'opacity'>;

export interface PoseResult {
  scene: LimelightScene;
  poseId: string | null;
  added: boolean;
}

/**
 * Changes where an actor is at `time`. An actor with one pose stays still, so
 * its only pose changes wherever the playhead is. An animated actor (two
 * poses or more) gets the pose at that moment changed, or a new one.
 * `addKey` makes a new pose even on a still actor: the first step of
 * animating it.
 */
export function setPoseAt(scene: LimelightScene, actorId: string, time: number, values: Partial<PoseValues>, addKey = false): PoseResult {
  const actor = scene.actors.find((a) => a.id === actorId);
  if (!actor) return { scene, poseId: null, added: false };
  const at = Math.max(0, time);
  const now = actorAt({ ...actor, motion: { float: 0, spin: 0 } }, at);
  const merge = (pose: ActorPose): ActorPose => ({
    ...pose,
    position: values.position ? { ...values.position } : pose.position,
    turn: values.turn ? { ...values.turn } : pose.turn,
    scale: values.scale ?? pose.scale,
    opacity: values.opacity ?? pose.opacity,
  });
  const write = (poses: ActorPose[]) =>
    touch(scene, { actors: scene.actors.map((a) => (a.id === actorId ? ({ ...a, poses: sorted(poses) } as LimelightActor) : a)) });
  const existing = actor.poses.find((pose) => Math.abs(pose.time - at) <= SAME_MOMENT);
  if (existing) return { scene: write(actor.poses.map((pose) => (pose.id === existing.id ? merge(pose) : pose))), poseId: existing.id, added: false };
  if ((actor.poses.length === 1 && !addKey) || actor.poses.length >= MAX_KEYS) {
    const only = actor.poses.length === 1 ? actor.poses[0] : actor.poses.reduce((best, pose) => (Math.abs(pose.time - at) < Math.abs(best.time - at) ? pose : best));
    return { scene: write(actor.poses.map((pose) => (pose.id === only.id ? merge(pose) : pose))), poseId: only.id, added: false };
  }
  const before = sorted(actor.poses).filter((pose) => pose.time < at).pop();
  const pose = merge({ id: newId('pose'), time: at, ease: before?.ease ?? 'smooth', position: now.position, turn: now.turn, scale: now.scale, opacity: now.opacity });
  return { scene: write([...actor.poses, pose]), poseId: pose.id, added: true };
}

export function updatePose(scene: LimelightScene, actorId: string, poseId: string, patch: Partial<Omit<ActorPose, 'id'>>): LimelightScene {
  return touch(scene, {
    actors: scene.actors.map((actor) =>
      actor.id === actorId
        ? ({ ...actor, poses: sorted(actor.poses.map((pose) => (pose.id === poseId ? { ...pose, ...patch, id: pose.id, time: Math.max(0, patch.time ?? pose.time) } : pose))) } as LimelightActor)
        : actor
    ),
  });
}

export function removePose(scene: LimelightScene, actorId: string, poseId: string): LimelightScene {
  return touch(scene, {
    actors: scene.actors.map((actor) =>
      actor.id === actorId && actor.poses.length > 1 ? ({ ...actor, poses: actor.poses.filter((pose) => pose.id !== poseId) } as LimelightActor) : actor
    ),
  });
}

// ---------------------------------------------------------------------------
// Screens
// ---------------------------------------------------------------------------

export function setScreens(scene: LimelightScene, actorId: string, screens: ScreenChange[]): LimelightScene {
  return touch(scene, {
    actors: scene.actors.map((actor) => (actor.id === actorId && actor.kind === 'device' ? { ...actor, screens: sorted(screens).slice(0, MAX_SCREENS) } : actor)),
  });
}

/** Shows a picture on a device from `time` on: the change at that moment takes it, or a new change is added. */
export function setScreenAt(scene: LimelightScene, actorId: string, time: number, media: string | null, extra: Partial<ScreenChange> = {}): LimelightScene {
  const actor = scene.actors.find((a): a is DeviceActor => a.id === actorId && a.kind === 'device');
  if (!actor) return scene;
  const at = Math.max(0, time);
  const existing = actor.screens.find((screen) => Math.abs(screen.time - at) <= SAME_MOMENT);
  if (existing) return setScreens(scene, actorId, actor.screens.map((screen) => (screen.id === existing.id ? { ...screen, ...extra, media, id: screen.id } : screen)));
  const change: ScreenChange = { id: newId('screen'), time: at, media, transition: actor.screens.length === 0 ? 'cut' : 'slide', duration: 0.5, ...extra };
  return setScreens(scene, actorId, [...actor.screens, change]);
}

// ---------------------------------------------------------------------------
// The scene
// ---------------------------------------------------------------------------

export function setLook(scene: LimelightScene, patch: Partial<LimelightLook>): LimelightScene {
  return touch(scene, { look: { ...scene.look, ...patch } });
}

/** Sets the scene's music; undefined takes it away. */
export function setMusic(scene: LimelightScene, music: LimelightMusic | undefined): LimelightScene {
  const next = touch(scene, { music });
  if (!music) delete next.music;
  return next;
}

export function rename(scene: LimelightScene, name: string): LimelightScene {
  return touch(scene, { name: name.trim().slice(0, 80) || 'Untitled scene' });
}

/**
 * Sets the size and frame rate. With `retime`, a new length stretches every
 * key's time along with it, so the moves keep their shape; without it, keys
 * stay where they are.
 */
export function setFormat(scene: LimelightScene, patch: Partial<LimelightFormat>, retime = true): LimelightScene {
  const format = normalizeFormat({ ...scene.format, ...patch });
  if (!retime || format.duration === scene.format.duration || scene.format.duration <= 0) return touch(scene, { format });
  return touch(retimeScene(scene, format.duration / scene.format.duration), { format });
}

/** Multiplies every key's time by `factor`. */
export function retimeScene(scene: LimelightScene, factor: number): LimelightScene {
  const k = Math.max(0.01, factor);
  return {
    ...scene,
    camera: { ...scene.camera, shots: scene.camera.shots.map((shot) => ({ ...shot, time: shot.time * k })) },
    actors: scene.actors.map((actor) => {
      const poses = actor.poses.map((pose) => ({ ...pose, time: pose.time * k }));
      if (actor.kind === 'picture') return actor.shine === undefined ? { ...actor, poses } : { ...actor, poses, shine: actor.shine * k };
      if (actor.kind !== 'device') {
        // Words that come in keep their place in the video: they start and take longer in step with it.
        return actor.reveal ? { ...actor, poses, reveal: { ...actor.reveal, time: actor.reveal.time * k, duration: actor.reveal.duration * k } } : { ...actor, poses };
      }
      return { ...actor, poses, screens: actor.screens.map((screen) => ({ ...screen, time: screen.time * k })) };
    }),
  };
}

export function clampDuration(seconds: number): number {
  return Math.min(DURATION_MAX, Math.max(DURATION_MIN, seconds));
}

/**
 * A camera that looks at an actor, framed so a device fills about two thirds
 * of the picture's height, from the angle the camera has now.
 */
export function cameraOnActor(scene: LimelightScene, actorId: string, time: number, camera: CameraState): CameraState {
  const actor = scene.actors.find((a) => a.id === actorId);
  if (!actor) return camera;
  const frame = actorAt(actor, time);
  const height =
    actor.kind === 'device' ? deviceHeight(actor.device) * frame.scale : actor.kind === 'picture' ? Math.max(actor.height, actor.width * 0.75) * frame.scale : Math.max(2, actor.size * 3);
  const aspect = scene.format.width / scene.format.height;
  return { ...camera, target: { ...frame.position }, distance: distanceToFrame(height, 0.66, camera.lens, aspect), focus: 0 };
}

/** A name not used by another actor: "iPhone 17 Pro", then "iPhone 17 Pro 2". */
export function freeName(scene: LimelightScene, name: string): string {
  const taken = new Set(scene.actors.map((actor) => actor.name));
  if (!taken.has(name)) return name;
  for (let n = 2; n < 100; n++) {
    const next = `${name} ${n}`;
    if (!taken.has(next)) return next;
  }
  return name;
}

/** Turns a point the way a device is turned: roll after pitch after yaw (three.js Euler order ZXY). */
export function turnPoint(p: XYZ, turn: Turn): XYZ {
  const k = Math.PI / 180;
  const [cy, sy] = [Math.cos(turn.yaw * k), Math.sin(turn.yaw * k)];
  const [cp, sp] = [Math.cos(turn.pitch * k), Math.sin(turn.pitch * k)];
  const [cr, sr] = [Math.cos(turn.roll * k), Math.sin(turn.roll * k)];
  let x = p.x * cy + p.z * sy;
  let z = -p.x * sy + p.z * cy;
  let y = p.y;
  const y2 = y * cp - z * sp;
  z = y * sp + z * cp;
  y = y2;
  return { x: x * cr - y * sr, y: x * sr + y * cr, z };
}

/**
 * How much room a title's words take, in centimetres: `size` is a capital's
 * height, and a line is 1.2 times the font tall (a capital is 0.7 of the
 * font). Each line is measured on a canvas in the title's own face
 * (fonts.ts); once that face has loaded the measure is exact, and before
 * it has, the measure is taken at least as wide as the letters' table, so a
 * wide face isn't framed as the narrower fallback. With no canvas (Node) it
 * is the table. An average letter width framed "WWW" at little more than
 * half its width and cut both ends off.
 */
export function titleBox(text: string, size: number, weight: number, font = ''): { width: number; height: number } {
  const lines = text.split('\n');
  const widest = Math.max(
    0,
    ...lines.map((line) => {
      const table = tableLineWidth(line);
      const face = { weight, font, text: line };
      const measured = font ? measureLineWidth(line, face) : null;
      if (measured === null) return table;
      // Ready for this line's own letters: a face loaded for Latin may not have its Japanese yet.
      return faceReady(face) ? measured : Math.max(measured, table);
    })
  );
  return { width: widest * size, height: (lines.length * size * 1.2) / CAP_SHARE };
}

/**
 * Where a title's highlight starts on each line, as an index into the line:
 * the last `count` words of the whole title are highlighted, counted back
 * across lines. A line with none of them gets its own length.
 */
export function highlightStarts(lines: string[], count: number): number[] {
  const starts = lines.map((line) => line.length);
  let left = Math.max(0, Math.floor(count));
  for (let i = lines.length - 1; i >= 0 && left > 0; i--) {
    const spans = Array.from(lines[i].matchAll(/\S+/g), (match) => match.index ?? 0);
    for (let j = spans.length - 1; j >= 0 && left > 0; j--, left--) starts[i] = spans[j];
  }
  return starts;
}

/**
 * Points on the outside of every visible actor at `time`, in centimetres on
 * the stage: a device's measured hull (device3dGeometry's, which follows a
 * foldable's posture), a title's box.
 */
export function stagePoints(scene: LimelightScene, time: number): XYZ[] {
  const points: XYZ[] = [];
  for (const actor of scene.actors) {
    if (actor.hidden) continue;
    const frame = actorAt(actor, time);
    if (frame.scale <= 0 || frame.opacity <= 0) continue;
    let local: XYZ[];
    if (actor.kind === 'device') {
      const model = stageModelFor(actor.device);
      if (!model) continue;
      const posture = model.fold ? { opening: actor.fold ?? model.fold.opening, across: false } : undefined;
      local = hullPoints(model, posture).map(([x, y, z]) => ({ x: x / 10, y: y / 10, z: z / 10 }));
    } else if (actor.kind === 'picture') {
      const { width, height, depth } = actor;
      local = [-1, 1].flatMap((sx) => [-1, 1].flatMap((sy) => [-1, 1].map((sz) => ({ x: (sx * width) / 2, y: (sy * height) / 2, z: (sz * depth) / 2 }))));
    } else {
      const box = titleBox(actor.text, actor.size, actor.weight, actor.font);
      local = [-1, 1].flatMap((sx) => [-1, 1].map((sy) => ({ x: (sx * box.width) / 2, y: (sy * box.height) / 2, z: 0 })));
    }
    for (const p of local) {
      const q = turnPoint({ x: p.x * frame.scale, y: p.y * frame.scale, z: p.z * frame.scale }, frame.turn);
      points.push({ x: q.x + frame.position.x, y: q.y + frame.position.y, z: q.z + frame.position.z });
    }
  }
  return points;
}

/**
 * A camera that sees every device and title at `time`, from the angle and
 * lens it has now. The target moves to the middle of them all, and the
 * camera stands just far enough back for every point of their outsides to be
 * inside `share` of the picture, across and up, so a lone phone fills a tall
 * frame and two side by side fill a wide one.
 */
export function cameraToFitAll(scene: LimelightScene, time: number, camera: CameraState, share = 0.8): CameraState {
  return cameraToFitPoints(stagePoints(scene, time), camera, scene.format.width / scene.format.height, share);
}

/** A camera that keeps its angle and lens and stands just far enough back to see every point within `share` of the picture. */
export function cameraToFitPoints(points: XYZ[], camera: CameraState, aspect: number, share = 0.8): CameraState {
  if (points.length === 0) return camera;
  const lo = { x: Infinity, y: Infinity, z: Infinity };
  const hi = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const p of points) {
    lo.x = Math.min(lo.x, p.x);
    lo.y = Math.min(lo.y, p.y);
    lo.z = Math.min(lo.z, p.z);
    hi.x = Math.max(hi.x, p.x);
    hi.y = Math.max(hi.y, p.y);
    hi.z = Math.max(hi.z, p.z);
  }
  const target = { x: (lo.x + hi.x) / 2, y: (lo.y + hi.y) / 2, z: (lo.z + hi.z) / 2 };
  const pose = cameraPose({ ...camera, target }, aspect);
  const toward = { x: pose.position.x - target.x, y: pose.position.y - target.y, z: pose.position.z - target.z };
  const length = Math.hypot(toward.x, toward.y, toward.z) || 1;
  const tanV = Math.tan((pose.fov * Math.PI) / 360) * share;
  const tanH = tanV * aspect;
  let distance = DISTANCE_MIN;
  for (const p of points) {
    const rel = { x: p.x - target.x, y: p.y - target.y, z: p.z - target.z };
    const across = Math.abs(rel.x * pose.right.x + rel.y * pose.right.y + rel.z * pose.right.z);
    const up = Math.abs(rel.x * pose.up.x + rel.y * pose.up.y + rel.z * pose.up.z);
    // How far the point stands out toward the camera, which it then needs less distance for.
    const near = (rel.x * toward.x + rel.y * toward.y + rel.z * toward.z) / length;
    distance = Math.max(distance, near + across / tanH, near + up / tanV);
  }
  return { ...camera, target, distance: Math.min(DISTANCE_MAX, distance), focus: 0 };
}

/**
 * The director's camera: outside the video's, seeing every actor and every
 * place the video's camera goes during the scene, from above and to one side.
 */
export function directorCamera(scene: LimelightScene, aspect: number): CameraState {
  const points = stagePoints(scene, 0);
  const duration = scene.format.duration;
  for (let i = 0; i <= 24; i++) {
    const at = (duration * i) / 24;
    points.push(...stagePoints(scene, at));
    points.push(cameraPose(cameraAt(scene.camera.shots, 0, at), scene.format.width / scene.format.height).position);
  }
  const first = scene.camera.shots[0].camera;
  const angle: CameraState = { ...first, azimuth: first.azimuth + 40, elevation: 32, roll: 0, lens: 35 };
  return cameraToFitPoints(points, angle, aspect, 0.86);
}
