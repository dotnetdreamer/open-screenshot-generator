/**
 * Limelight scenes in the user's own Google Drive.
 *
 * Only Drive: a scene's media will be videos, which a gist cannot hold, so a
 * GitHub sign-in is told to switch. Saving runs only when the user presses
 * Save to Google Drive, never on a timer (rule 25a), and is the only thing
 * that makes folders there. Opening lists what is there and makes nothing.
 * Everything runs under one Web Lock, so two windows never save the same
 * scene at once.
 */

import { getSession, withFreshSession } from '@/lib/account';
import { googleDriveLimelight, type LimelightRemoteScene } from '@/lib/account/providers/googleDrive';
import type { AccountSession } from '@/lib/account/types';
import { driveOpenPlan, driveScenePayload, readDriveScenePayload, sceneFingerprint } from './driveFormat';
import { newId, normalizeScene, sceneMediaIds } from './scene';
import { getMeta, getPicture, getScene, hasPictures, putPictures, putScene, setMeta } from './store';
import type { LimelightMedia, LimelightScene } from './types';

export type { LimelightRemoteScene };

/** Nobody is signed in: the view asks the user to sign in with Google Drive. */
export class DriveSignInNeeded extends Error {
  constructor() {
    super('Sign in with Google Drive to save your scenes there');
  }
}

/** Signed in with GitHub, which can't hold videos. */
export class DriveNotGoogle extends Error {
  constructor() {
    super('Limelight saves to Google Drive, since videos are too big for GitHub. Switch to Google Drive in Account');
  }
}

function signedIn(): AccountSession {
  const session = getSession();
  if (!session) throw new DriveSignInNeeded();
  if (session.provider !== 'google') throw new DriveNotGoogle();
  return session;
}

/** A fresh token for the next request: a long save can outlast one. */
async function fresh(): Promise<AccountSession> {
  return withFreshSession(signedIn());
}

async function locked<T>(run: () => Promise<T>): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.locks) return navigator.locks.request('osg-limelight-drive', run) as Promise<T>;
  return run();
}

export interface DriveSaveRecord {
  folderId: string;
  savedAt: number;
  /** The scene's updatedAt when it last met Drive. */
  version: number;
  /** What it held then (sceneFingerprint), to tell whether it changed since. */
  content?: string;
}

function recordOf(folderId: string, scene: LimelightScene): DriveSaveRecord {
  return { folderId, savedAt: Date.now(), version: scene.updatedAt, content: sceneFingerprint(scene) };
}

export function driveRecordKey(sceneId: string): string {
  return `drive:${sceneId}`;
}

export async function driveRecord(sceneId: string): Promise<DriveSaveRecord | undefined> {
  return getMeta<DriveSaveRecord>(driveRecordKey(sceneId));
}

/** Saves a scene and its pictures to the user's Drive. */
export async function saveSceneToDrive(sceneId: string, onProgress?: (done: number, total: number) => void): Promise<{ sent: number; kept: number }> {
  return locked(async () => {
    const session = await fresh();
    const scene = await getScene(sceneId);
    if (!scene) throw new Error('That scene is no longer on this device');
    const pictures: Array<{ id: string; mimeType: string; read: () => Promise<Blob> }> = [];
    const kept: LimelightMedia[] = [];
    for (const id of sceneMediaIds(scene)) {
      const media = await getPicture(id);
      if (!media) continue;
      kept.push(media);
      pictures.push({ id, mimeType: media.type, read: async () => new Blob([media.data], { type: media.type }) });
    }
    // The pictures' names and where each came from go in scene.json; their files hold only bytes.
    const json = driveScenePayload(scene, kept);
    const result = await googleDriveLimelight.save(session, { id: scene.id, name: scene.name, json }, pictures, fresh, onProgress);
    await setMeta(driveRecordKey(scene.id), recordOf(result.folderId, scene));
    return { sent: result.sent, kept: result.kept };
  });
}

/** The scenes in the user's Drive, newest first. */
export async function listDriveScenes(): Promise<LimelightRemoteScene[]> {
  return googleDriveLimelight.list(await fresh());
}

async function pictureSize(blob: Blob): Promise<{ width: number; height: number }> {
  try {
    const bitmap = await createImageBitmap(blob);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  } catch {
    return { width: 0, height: 0 };
  }
}

/**
 * Brings a scene from Drive onto this device, with the pictures this device
 * doesn't have. A copy here with changes Drive doesn't have is kept, however
 * close in time: the Drive scene then comes in as a copy beside it
 * (driveOpenPlan).
 */
export async function openSceneFromDrive(remote: LimelightRemoteScene): Promise<{ scene: LimelightScene; copy: boolean }> {
  return locked(async () => {
    const session = await fresh();
    const { json, files } = await googleDriveLimelight.read(session, remote.folderId);
    const payload = readDriveScenePayload(json);
    let scene = payload.scene;
    const wanted = sceneMediaIds(scene);
    const here = await hasPictures(wanted);
    const byId = new Map(files.map((file) => [file.id, file]));
    const fetched: LimelightMedia[] = [];
    for (const id of wanted) {
      if (here.has(id)) continue;
      const file = byId.get(id);
      if (!file) continue;
      const blob = await googleDriveLimelight.download(await fresh(), file.fileId);
      const listed = payload.pictures.get(id);
      const size = listed && listed.width > 0 && listed.height > 0 ? listed : await pictureSize(blob);
      const picture: LimelightMedia = {
        id,
        kind: 'image',
        type: listed?.type ?? (blob.type || 'image/png'),
        name: listed?.name ?? 'Picture',
        width: size.width,
        height: size.height,
        bytes: blob.size,
        data: await blob.arrayBuffer(),
        createdAt: listed?.createdAt ?? Date.now(),
      };
      if (listed?.from) picture.from = listed.from;
      fetched.push(picture);
    }
    if (fetched.length > 0) await putPictures(fetched);
    const local = await getScene(scene.id);
    const record = local ? await driveRecord(scene.id) : undefined;
    const copy = driveOpenPlan(local, scene, record) === 'copy';
    if (copy) {
      const now = Date.now();
      scene = normalizeScene({ ...scene, id: newId('scene'), name: `${scene.name} from Drive`.slice(0, 80), createdAt: now, updatedAt: now });
    }
    await putScene(scene);
    if (!copy) await setMeta(driveRecordKey(scene.id), recordOf(remote.folderId, scene));
    return { scene, copy };
  });
}
