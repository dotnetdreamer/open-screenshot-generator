/**
 * What a Limelight scene looks like in Google Drive, and what opening one
 * does to the copy on this device. Plain functions, so they are tested
 * without Drive (drive.ts does the requests).
 *
 * scene.json holds the scene and, beside it, what each picture is: its name,
 * type, size and where in a project it came from. The picture files carry
 * only their bytes, so without this a scene opened on another computer would
 * lose which artboard each screenshot was, which a video per language needs.
 */

import { normalizeOrigin, normalizeScene } from './scene';
import type { LimelightMedia, LimelightScene } from './types';

/** A picture as scene.json lists it: everything but its bytes. */
export type DrivePicture = Omit<LimelightMedia, 'data'>;

export interface DriveScenePayload {
  kind: 'limelight-scene';
  version: 1;
  scene: LimelightScene;
  pictures: DrivePicture[];
}

export function driveScenePayload(scene: LimelightScene, pictures: LimelightMedia[]): string {
  const payload: DriveScenePayload = {
    kind: 'limelight-scene',
    version: 1,
    scene,
    pictures: pictures.map(({ data: _data, ...rest }) => rest),
  };
  return JSON.stringify(payload);
}

function pictureFrom(value: unknown): DrivePicture | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== 'string') return null;
  const count = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) && n >= 0 ? Math.round(n) : 0);
  const picture: DrivePicture = {
    id: v.id,
    kind: 'image',
    type: typeof v.type === 'string' && v.type.startsWith('image/') ? v.type.slice(0, 60) : 'image/png',
    name: typeof v.name === 'string' && v.name.trim() ? v.name.slice(0, 120) : 'Picture',
    width: count(v.width),
    height: count(v.height),
    bytes: count(v.bytes),
    createdAt: count(v.createdAt) || Date.now(),
  };
  const from = normalizeOrigin(v.from);
  if (from) picture.from = from;
  return picture;
}

/**
 * The scene in a scene.json and what it says of each picture, by id. A file
 * saved before pictures were listed is the scene alone, and says nothing.
 */
export function readDriveScenePayload(json: string): { scene: LimelightScene; pictures: Map<string, DrivePicture> } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("That scene in Google Drive couldn't be read");
  }
  const wrapped = !!parsed && typeof parsed === 'object' && (parsed as { kind?: unknown }).kind === 'limelight-scene';
  const raw = wrapped ? (parsed as { scene?: unknown }).scene : parsed;
  const pictures = new Map<string, DrivePicture>();
  if (wrapped) {
    const list = (parsed as { pictures?: unknown }).pictures;
    for (const item of Array.isArray(list) ? list : []) {
      const picture = pictureFrom(item);
      if (picture) pictures.set(picture.id, picture);
    }
  }
  return { scene: normalizeScene(raw), pictures };
}

/** A scene's contents as text, whenever it was saved. */
function contents(scene: LimelightScene): string {
  return JSON.stringify({ ...normalizeScene(scene), updatedAt: 0 });
}

/** Two copies of a scene with the same contents, whenever each was saved. */
function sameScene(a: LimelightScene, b: LimelightScene): boolean {
  return contents(a) === contents(b);
}

/**
 * A short fingerprint of what a scene holds, whenever it was saved: 53 bits
 * of a string hash (cyrb53), the same for two copies with the same contents.
 * The record of a save keeps it, so "changed since" is about the scene, not
 * a clock.
 */
export function sceneFingerprint(scene: LimelightScene): string {
  const text = contents(scene);
  let h1 = 0xdeadbeef ^ text.length;
  let h2 = 0x41c6ce57 ^ text.length;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** The scene as it was when it last met Drive, saved or opened. */
export interface DriveSynced {
  /** Its updatedAt then. */
  version: number;
  /** sceneFingerprint of it then. A record from before fingerprints has none. */
  content?: string;
}

/**
 * What opening `remote` from Drive does to the copy on this device:
 * 'replace' when nothing here would be lost, 'copy' to bring the Drive one
 * in beside it. Nothing here is lost when there is no copy, when the two
 * are the same, or when this copy holds just what it held when it last met
 * Drive (`synced`) and the Drive one is no older. Any other change here,
 * however close in time, and an undo back past the save, keeps both.
 */
export function driveOpenPlan(local: LimelightScene | null, remote: LimelightScene, synced: DriveSynced | undefined): 'replace' | 'copy' {
  if (!local) return 'replace';
  if (sameScene(local, remote)) return 'replace';
  // Compared by contents, not by updatedAt, which an undo once set back.
  const unchangedHere = synced?.content !== undefined && synced.content === sceneFingerprint(local);
  return unchangedHere && remote.updatedAt >= local.updatedAt ? 'replace' : 'copy';
}
