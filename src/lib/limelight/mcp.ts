/**
 * Limelight for the AI agents: what the `*_limelight_*` MCP tools do, behind
 * one `McpDesignApi.limelight` method the layout implements with this module,
 * so desktopMcpServer.ts imports nothing new (rule 81: the CLI loads that
 * module in Node, and nothing here may load there).
 *
 * Every change goes through edit.ts and normalizeScene, so an agent's scene
 * follows the same rules as one made by hand. When the Limelight view is
 * mounted it registers a host: a scene it has open is read from it (after
 * its unsaved changes are written) and changed through it, as one undo step
 * the user can take back, so the view never saves its older copy over the
 * agent's. Any other scene is read and written in the database directly.
 * The view does not have to be open, and a tool never switches the user's
 * screen to it.
 */

import type { ArtboardState, DeviceType } from '@/types/artboard';
import { assetIdFromRef, getMediaAsset, isAssetRef } from '@/lib/mediaStore';
import { actorAt } from './animate';
import { cameraOnActor, cameraToFitAll, cannotAdd, deviceCount, freeName, laterThan, setFormat, setLook } from './edit';
import { stageDevices } from './devices';
import { FORMAT_PRESETS, formatPresetById } from './presets';
import { originOf, projectShots, shotBlob } from './projectShots';
import {
  DEFAULT_LIFT,
  defaultFormat,
  deviceHeight,
  deviceWidth,
  isStageDevice,
  newDeviceActor,
  newId,
  newScene,
  newTextActor,
  normalizeCamera,
  normalizeLook,
  normalizeScene,
} from './scene';
import { addPicture, deleteScene, getScene, listMyTemplates, listScenes, putScene } from './store';
import { TEMPLATES, buildTemplate, fromMyTemplate } from './templates';
import type { CameraShot, CameraState, DeviceActor, LimelightActor, LimelightScene, ScreenChange, ScreenOrigin, ScreenTransition } from './types';
import { LIMELIGHT_EASES, SCREEN_TRANSITIONS } from './types';

export interface LimelightProjectSource {
  id: string | null;
  name: string;
  artboards: ArtboardState[];
}

/** What the mounted view lends the tools. */
export interface LimelightHost {
  /** The scene open in the view, as it is now. */
  openScene(): LimelightScene | null;
  /** Puts a changed scene in the view as one undo step; the view saves it. */
  apply(next: LimelightScene): void;
  /** Writes the view's unsaved changes. */
  flush(): Promise<boolean>;
  /** Reads the list of scenes again. */
  refresh(): void;
}

let host: LimelightHost | null = null;

export function setLimelightHost(next: LimelightHost | null) {
  host = next;
}

export interface LimelightToolResult {
  json: unknown;
  /** A picture of a frame, base64 without the data: prefix. */
  image?: { data: string; mimeType: string };
}

class ToolError extends Error {}

type Args = Record<string, unknown>;

function text(value: unknown, name: string, required = false): string | undefined {
  if (value === undefined || value === null || value === '') {
    if (required) throw new ToolError(`${name} is needed`);
    return undefined;
  }
  if (typeof value !== 'string') throw new ToolError(`${name} must be text`);
  return value;
}

function number(value: unknown, name: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) throw new ToolError(`${name} must be a number`);
  return n;
}

function object(value: unknown, name: string): Args | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'object' || Array.isArray(value)) throw new ToolError(`${name} must be an object`);
  return value as Args;
}

function list(value: unknown, name: string): unknown[] | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) throw new ToolError(`${name} must be a list`);
  return value;
}

// ---------------------------------------------------------------------------
// Reading and writing a scene
// ---------------------------------------------------------------------------

async function readScene(sceneId: string): Promise<LimelightScene> {
  const open = host?.openScene();
  if (open && open.id === sceneId) return open;
  const scene = await getScene(sceneId);
  if (!scene) throw new ToolError(`There is no Limelight scene ${sceneId}. list_limelight_scenes lists them`);
  return scene;
}

async function writeScene(next: LimelightScene): Promise<LimelightScene> {
  const scene = normalizeScene({ ...next, updatedAt: laterThan(next.updatedAt) });
  const open = host?.openScene();
  if (open && open.id === scene.id) host?.apply(scene);
  else {
    await putScene(scene);
    host?.refresh();
  }
  return scene;
}

/** What an agent needs to see of a scene to change it: everything, with times rounded for reading. */
function describe(scene: LimelightScene) {
  return {
    sceneId: scene.id,
    name: scene.name,
    format: scene.format,
    look: scene.look,
    camera: scene.camera,
    actors: scene.actors,
    template: scene.template ?? null,
  };
}

// ---------------------------------------------------------------------------
// Pictures for the screens
// ---------------------------------------------------------------------------

interface PictureRequest {
  artboardId?: string;
  src?: string;
}

async function blobFromSrc(src: string): Promise<Blob | null> {
  if (isAssetRef(src)) return (await getMediaAsset(assetIdFromRef(src)))?.blob ?? null;
  if (/^(data:image\/|blob:|https?:\/\/)/i.test(src)) {
    const response = await fetch(src);
    if (!response.ok) throw new ToolError(`That picture could not be read (HTTP ${response.status})`);
    return await response.blob();
  }
  throw new ToolError('A picture src is an asset: reference (upload_asset, list_assets), a data: URL or a web address');
}

/**
 * Copies pictures into Limelight and gives back their media ids: from the open
 * project's artboards (each one's device screenshot), from `src`, or, with
 * `fromProject`, the project's own screenshots in canvas order.
 */
async function importPictures(requests: PictureRequest[], fromProject: boolean, project: LimelightProjectSource): Promise<string[]> {
  const shots = projectShots(project.artboards);
  const items: Array<{ blob: Blob; name: string; from?: ScreenOrigin }> = [];
  if (fromProject) {
    const own = shots.filter((shot) => !shot.sample);
    for (const shot of (own.length > 0 ? own : shots).slice(0, 12)) {
      const blob = await shotBlob(shot.src);
      if (blob) items.push({ blob, name: shot.artboardName, from: originOf(project.id, shot) });
    }
  }
  for (const request of requests) {
    if (request.artboardId) {
      const shot = shots.find((s) => s.artboardId === request.artboardId);
      if (!shot) throw new ToolError(`Artboard ${request.artboardId} of the open project has no device screenshot`);
      const blob = await shotBlob(shot.src);
      if (!blob) throw new ToolError(`The screenshot on artboard ${request.artboardId} could not be read`);
      items.push({ blob, name: shot.artboardName, from: originOf(project.id, shot) });
    } else if (request.src) {
      const blob = await blobFromSrc(request.src);
      if (!blob) throw new ToolError(`There is no picture at ${request.src.slice(0, 60)}`);
      items.push({ blob, name: 'Picture' });
    }
  }
  const ids: string[] = [];
  for (const item of items) ids.push((await addPicture(item.blob, item.name, item.from)).id);
  return ids;
}

function pictureRequests(value: unknown): PictureRequest[] {
  return (list(value, 'pictures') ?? []).map((item, i) => {
    const entry = object(item, `pictures[${i}]`) ?? {};
    const request: PictureRequest = { artboardId: text(entry.artboardId, 'artboardId'), src: text(entry.src, 'src') };
    if (!request.artboardId && !request.src) throw new ToolError(`pictures[${i}] needs an artboardId or a src`);
    return request;
  });
}

/** Screens that change from one picture to the next, evenly over [from, to]. */
function spread(media: string[], from: number, to: number, transition: ScreenTransition): ScreenChange[] {
  const step = media.length > 1 ? (to - from) / media.length : 0;
  return media.map((id, i) => ({ id: newId('screen'), time: Math.round((from + step * i) * 100) / 100, media: id, transition: i === 0 ? 'cut' : transition, duration: 0.5 }));
}

// ---------------------------------------------------------------------------
// The tools
// ---------------------------------------------------------------------------

async function listScenesTool() {
  const open = host?.openScene()?.id ?? null;
  const scenes = (await listScenes()).map(({ thumb: _thumb, thumbType: _type, ...summary }) => ({ sceneId: summary.id, ...summary, id: undefined, open: summary.id === open }));
  return { scenes, count: scenes.length };
}

async function listTemplatesTool() {
  const mine = await listMyTemplates().catch(() => []);
  return {
    templates: TEMPLATES.map((template) => ({ template: template.id, name: template.name, hint: template.hint, devices: template.devices, look: template.environment })),
    myTemplates: mine.map((template) => ({ template: template.id, name: template.name, devices: template.scene.actors.filter((actor) => actor.kind === 'device').length })),
    sizes: FORMAT_PRESETS.map((preset) => ({ size: preset.id, label: preset.label, width: preset.width, height: preset.height, fps: preset.fps })),
    devices: stageDevices().map((option) => ({ device: option.device, label: option.label, group: option.group })),
  };
}

async function createSceneTool(args: Args, project: LimelightProjectSource) {
  const template = text(args.template, 'template');
  const size = text(args.size, 'size');
  const preset = size ? formatPresetById(size) : undefined;
  if (size && !preset) throw new ToolError(`There is no size ${size}. list_limelight_templates lists the sizes`);
  const format = preset ? { width: preset.width, height: preset.height, fps: preset.fps, duration: preset.rules ? preset.rules.minSeconds : 15, preset: preset.id } : defaultFormat();
  const duration = number(args.duration, 'duration');
  if (duration !== undefined) format.duration = duration;
  const pictures = await importPictures(pictureRequests(args.pictures), args.fromProject === true, project);
  const name = text(args.name, 'name') ?? (project.name ? `${project.name} promo` : undefined);
  let scene: LimelightScene | null = null;
  if (template) {
    if (TEMPLATES.some((t) => t.id === template)) scene = buildTemplate(template, { format, pictures, title: project.name, name });
    else {
      const mine = (await listMyTemplates()).find((t) => t.id === template);
      if (!mine) throw new ToolError(`There is no template ${template}. list_limelight_templates lists them`);
      scene = fromMyTemplate(mine.scene, pictures, name);
    }
  } else {
    scene = newScene({ name, format, media: pictures[0] ?? null });
    const phone = scene.actors[0];
    if (phone?.kind === 'device' && pictures.length > 1) scene = { ...scene, actors: [{ ...phone, screens: spread(pictures, 0, format.duration, 'slide') }] };
  }
  if (!scene) throw new ToolError('The scene could not be made');
  if (duration !== undefined && template) scene = setFormat(scene, { duration }, true);
  const saved = normalizeScene(scene);
  await putScene(saved);
  host?.refresh();
  return { ...describe(saved), next: 'render_limelight_frame shows how it looks; the Limelight view lists it under Your scenes' };
}

async function addActorTool(args: Args, project: LimelightProjectSource) {
  const scene = await readScene(text(args.sceneId, 'sceneId', true)!);
  const kind = text(args.kind, 'kind') ?? 'device';
  if (kind !== 'device' && kind !== 'title') throw new ToolError('kind is device or title');
  const blocked = cannotAdd(scene, kind === 'title' ? 'text' : 'device');
  if (blocked) throw new ToolError(blocked);
  const position = object(args.position, 'position');
  const turn = object(args.turn, 'turn');
  let actor: LimelightActor;
  if (kind === 'title') {
    const words = text(args.text, 'text', true)!;
    const devices = scene.actors.filter((a): a is DeviceActor => a.kind === 'device');
    const top = devices.reduce((edge, device) => Math.max(edge, actorAt(device, 0).position.y + deviceHeight(device.device) / 2), 10);
    actor = newTextActor(words.slice(0, 200), { x: number(position?.x, 'position.x') ?? 0, y: number(position?.y, 'position.y') ?? top + 2.5, z: number(position?.z, 'position.z') ?? 0 });
    const size = number(args.size, 'size');
    if (size !== undefined) actor.size = size;
    const color = text(args.color, 'color');
    if (color) actor.color = color;
    const font = text(args.font, 'font');
    if (font) actor.font = font;
  } else {
    const device = (text(args.device, 'device') ?? scene.actors.find((a): a is DeviceActor => a.kind === 'device')?.device ?? 'iphone-17-pro') as DeviceType;
    if (!isStageDevice(device)) throw new ToolError(`${device} has no 3D model. list_limelight_templates lists the devices`);
    // Beside the devices already there, unless a place is given.
    const right = scene.actors.reduce((edge, a) => (a.kind === 'device' ? Math.max(edge, actorAt(a, 0).position.x + deviceWidth(a.device) / 2) : edge), -Infinity);
    const x = number(position?.x, 'position.x') ?? (Number.isFinite(right) ? right + 3 + deviceWidth(device) / 2 : 0);
    actor = newDeviceActor(device, {
      position: { x, y: number(position?.y, 'position.y') ?? deviceHeight(device) / 2 + DEFAULT_LIFT, z: number(position?.z, 'position.z') ?? 0 },
      turn: { yaw: number(turn?.yaw, 'turn.yaw') ?? 0, pitch: number(turn?.pitch, 'turn.pitch') ?? 0, roll: number(turn?.roll, 'turn.roll') ?? 0 },
    });
    const pictures = await importPictures(pictureRequests(args.pictures), args.fromProject === true, project);
    actor.screens = spread(pictures, 0, scene.format.duration, 'slide');
  }
  const scale = number(args.scale, 'scale');
  if (scale !== undefined) actor.poses = actor.poses.map((pose) => ({ ...pose, scale }));
  actor.motion = { float: number(args.float, 'float') ?? 0, spin: number(args.spin, 'spin') ?? 0 };
  const name = text(args.name, 'name');
  actor.name = freeName(scene, name ?? actor.name);
  const saved = await writeScene({ ...scene, actors: [...scene.actors, actor] });
  const added = saved.actors[saved.actors.length - 1];
  return { sceneId: saved.id, actorId: added.id, actor: added, devices: deviceCount(saved), next: 'set_limelight_camera with fit true frames everything; render_limelight_frame shows it' };
}

async function updateActorTool(args: Args, project: LimelightProjectSource) {
  const scene = await readScene(text(args.sceneId, 'sceneId', true)!);
  const actorId = text(args.actorId, 'actorId', true)!;
  const actor = scene.actors.find((a) => a.id === actorId);
  if (!actor) throw new ToolError(`There is no actor ${actorId} in this scene. get_limelight_scene lists them`);
  const patch = object(args.changes, 'changes') ?? {};
  const next: Args = { ...actor, ...patch, id: actor.id, kind: actor.kind };
  // Float and spin can be given on their own.
  if (patch.float !== undefined || patch.spin !== undefined) {
    next.motion = { ...actor.motion, ...(patch.float !== undefined ? { float: number(patch.float, 'float') } : {}), ...(patch.spin !== undefined ? { spin: number(patch.spin, 'spin') } : {}) };
    delete next.float;
    delete next.spin;
  }
  if (patch.poses !== undefined) {
    const poses = list(patch.poses, 'poses')!;
    next.poses = poses.map((pose, i) => {
      const p = object(pose, `poses[${i}]`) ?? {};
      if (p.ease !== undefined && !LIMELIGHT_EASES.includes(p.ease as never)) throw new ToolError(`poses[${i}].ease is one of ${LIMELIGHT_EASES.join(', ')}`);
      return p;
    });
  }
  if (actor.kind === 'device' && patch.pictures !== undefined) {
    const media = await importPictures(pictureRequests(patch.pictures), false, project);
    const transition = (text(patch.transition, 'transition') ?? 'slide') as ScreenTransition;
    if (!SCREEN_TRANSITIONS.includes(transition)) throw new ToolError(`transition is one of ${SCREEN_TRANSITIONS.join(', ')}`);
    next.screens = spread(media, 0, scene.format.duration, transition);
    delete next.pictures;
    delete next.transition;
  }
  if (actor.kind === 'device' && patch.device !== undefined && !isStageDevice(patch.device)) throw new ToolError(`${String(patch.device)} has no 3D model`);
  const saved = await writeScene({ ...scene, actors: scene.actors.map((a) => (a.id === actorId ? (next as unknown as LimelightActor) : a)) });
  return { sceneId: saved.id, actor: saved.actors.find((a) => a.id === actorId) ?? null };
}

async function removeActorTool(args: Args) {
  const scene = await readScene(text(args.sceneId, 'sceneId', true)!);
  const actorId = text(args.actorId, 'actorId', true)!;
  if (!scene.actors.some((a) => a.id === actorId)) throw new ToolError(`There is no actor ${actorId} in this scene`);
  const saved = await writeScene({ ...scene, actors: scene.actors.filter((a) => a.id !== actorId) });
  return { sceneId: saved.id, removed: actorId, actors: saved.actors.length };
}

async function setCameraTool(args: Args) {
  const scene = await readScene(text(args.sceneId, 'sceneId', true)!);
  const given = list(args.shots, 'shots');
  let shots: CameraShot[] = scene.camera.shots;
  if (given) {
    if (given.length === 0) throw new ToolError('A scene keeps at least one shot');
    let previous: CameraState = scene.camera.shots[0].camera;
    const sorted = given
      .map((shot, i) => ({ shot: object(shot, `shots[${i}]`) ?? {}, i }))
      .sort((a, b) => (number(a.shot.time, 'time') ?? 0) - (number(b.shot.time, 'time') ?? 0));
    shots = sorted.map(({ shot, i }) => {
      const time = number(shot.time, `shots[${i}].time`) ?? 0;
      const ease = text(shot.ease, `shots[${i}].ease`) ?? 'smooth';
      if (!LIMELIGHT_EASES.includes(ease as never)) throw new ToolError(`shots[${i}].ease is one of ${LIMELIGHT_EASES.join(', ')}`);
      let camera = normalizeCamera({ ...previous, ...shot, target: shot.target ?? previous.target }, previous);
      const lookAt = text(shot.lookAt, `shots[${i}].lookAt`);
      if (lookAt) {
        if (!scene.actors.some((a) => a.id === lookAt)) throw new ToolError(`shots[${i}].lookAt names no actor`);
        camera = cameraOnActor(scene, lookAt, time, camera);
      }
      if (shot.fit === true) {
        const pull = number(shot.pull, `shots[${i}].pull`) ?? 1;
        const fit = cameraToFitAll(scene, time, camera);
        camera = { ...fit, distance: fit.distance * pull };
      }
      previous = camera;
      return { id: newId('shot'), time, ease: ease as CameraShot['ease'], camera };
    });
  }
  const shake = number(args.shake, 'shake');
  const saved = await writeScene({ ...scene, camera: { shots, shake: shake ?? scene.camera.shake } });
  return { sceneId: saved.id, camera: saved.camera, next: 'render_limelight_frame at a few times shows the move' };
}

async function setLookTool(args: Args) {
  let scene = await readScene(text(args.sceneId, 'sceneId', true)!);
  const look = object(args.look, 'look');
  if (look) {
    const environment = text(look.environment, 'look.environment');
    // A new environment brings its own backdrop and light unless they are given too.
    const base = environment && environment !== scene.look.environment ? normalizeLook({ environment }) : scene.look;
    scene = setLook(scene, normalizeLook({ ...base, ...look, backdrop: { ...base.backdrop, ...(object(look.backdrop, 'look.backdrop') ?? {}) }, light: { ...base.light, ...(object(look.light, 'look.light') ?? {}) } }));
  }
  const size = text(args.size, 'size');
  const format: Record<string, unknown> = {};
  if (size) {
    const preset = formatPresetById(size);
    if (!preset) throw new ToolError(`There is no size ${size}. list_limelight_templates lists the sizes`);
    Object.assign(format, { width: preset.width, height: preset.height, fps: preset.fps, preset: preset.id });
  }
  const duration = number(args.duration, 'duration');
  if (duration !== undefined) format.duration = duration;
  const fps = number(args.fps, 'fps');
  if (fps !== undefined) format.fps = fps;
  if (Object.keys(format).length > 0) scene = setFormat(scene, format, true);
  const saved = await writeScene(scene);
  return { sceneId: saved.id, look: saved.look, format: saved.format };
}

async function updateSceneTool(args: Args) {
  const current = await readScene(text(args.sceneId, 'sceneId', true)!);
  const given = object(args.scene, 'scene');
  if (!given) throw new ToolError('scene is needed: the whole scene, as get_limelight_scene gives it');
  const saved = await writeScene(normalizeScene({ ...given, id: current.id, createdAt: current.createdAt }));
  return describe(saved);
}

async function renderTool(args: Args): Promise<LimelightToolResult> {
  const scene = await readScene(text(args.sceneId, 'sceneId', true)!);
  const time = Math.min(scene.format.duration, Math.max(0, number(args.time, 'time') ?? 0));
  // Small enough to come back under 256 KB as base64, which the Agent panel shows.
  const width = Math.round(Math.min(720, Math.max(160, number(args.width, 'width') ?? 360)));
  const height = Math.round((width * scene.format.height) / scene.format.width);
  const { LimelightStage } = await import('./stage/stage');
  const { getPictureBlob } = await import('./store');
  const stage = new LimelightStage({ loadMedia: getPictureBlob });
  try {
    stage.setScene(scene);
    const blob = await stage.renderStill({ width, height, time, type: 'image/jpeg' });
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return {
      json: { sceneId: scene.id, time, width, height, bytes: bytes.length },
      image: { data: btoa(binary), mimeType: 'image/jpeg' },
    };
  } finally {
    stage.dispose();
  }
}

async function deleteSceneTool(args: Args) {
  const sceneId = text(args.sceneId, 'sceneId', true)!;
  if (host?.openScene()?.id === sceneId) throw new ToolError('That scene is open in the Limelight view. Ask the user to delete it there');
  await getScene(sceneId).then((scene) => {
    if (!scene) throw new ToolError(`There is no Limelight scene ${sceneId}`);
  });
  await deleteScene(sceneId);
  host?.refresh();
  return { deleted: sceneId };
}

export const LIMELIGHT_TOOLS = [
  'list_limelight_scenes',
  'get_limelight_scene',
  'create_limelight_scene',
  'list_limelight_templates',
  'add_limelight_actor',
  'update_limelight_actor',
  'remove_limelight_actor',
  'set_limelight_camera',
  'set_limelight_look',
  'update_limelight_scene',
  'render_limelight_frame',
  'delete_limelight_scene',
] as const;

export type LimelightToolName = (typeof LIMELIGHT_TOOLS)[number];

/** Runs one Limelight tool. Throws an Error whose message is for the agent. */
export async function runLimelightTool(tool: string, args: Args, project: () => LimelightProjectSource): Promise<LimelightToolResult> {
  // The view's unsaved changes first, so what the agent reads is what the user sees.
  if (host) await host.flush();
  switch (tool as LimelightToolName) {
    case 'list_limelight_scenes':
      return { json: await listScenesTool() };
    case 'get_limelight_scene':
      return { json: describe(await readScene(text(args.sceneId, 'sceneId', true)!)) };
    case 'create_limelight_scene':
      return { json: await createSceneTool(args, project()) };
    case 'list_limelight_templates':
      return { json: await listTemplatesTool() };
    case 'add_limelight_actor':
      return { json: await addActorTool(args, project()) };
    case 'update_limelight_actor':
      return { json: await updateActorTool(args, project()) };
    case 'remove_limelight_actor':
      return { json: await removeActorTool(args) };
    case 'set_limelight_camera':
      return { json: await setCameraTool(args) };
    case 'set_limelight_look':
      return { json: await setLookTool(args) };
    case 'update_limelight_scene':
      return { json: await updateSceneTool(args) };
    case 'render_limelight_frame':
      return await renderTool(args);
    case 'delete_limelight_scene':
      return { json: await deleteSceneTool(args) };
    default:
      throw new ToolError(`There is no Limelight tool ${tool}`);
  }
}
