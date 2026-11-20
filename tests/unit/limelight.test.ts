// Limelight's scene maths (src/lib/limelight): the timing curves, the keys
// sampled between, the camera's place and lens, reading any input back as a
// scene, and the edits the view and the agent share.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { actorAt, cameraAt, easeProgress, frameMediaIds, sampleTrack, sceneAt, screenAt, type Track } from '@/lib/limelight/animate';
import { cameraPose, dollyZoomTo, lensForFov, nearestAngle, orbitBy, panBy, verticalFov } from '@/lib/limelight/camera';
import { addActor, laterThan, removeActor, rename } from '@/lib/limelight/edit';
import type { DeviceType } from '@/types/artboard';
import { studioModelFor } from '@/lib/device3dStudio';
import { driveOpenPlan, driveScenePayload, readDriveScenePayload, sceneFingerprint } from '@/lib/limelight/driveFormat';
import { SceneHistory } from '@/lib/limelight/history';
import { REAL_SIZES, stageModelFor } from '@/lib/limelight/models';
import { KEEP, StageMedia } from '@/lib/limelight/stage/media';
import type { Picture } from '@/lib/limelight/stage/screen';
import { picturesToDelete, rowPictures } from '@/lib/limelight/store';
import {
  cameraOnActor,
  cameraToFitAll,
  stagePoints,
  turnPoint,
  duplicateActor,
  removeShot,
  setFormat,
  setPoseAt,
  setScreenAt,
  setShotAt,
  updateShot,
} from '@/lib/limelight/edit';
import { FORMAT_PRESETS, storeRuleProblem } from '@/lib/limelight/presets';
import { TEMPLATES, buildTemplate } from '@/lib/limelight/templates';
import { DEFAULT_DEVICE, MAX_DEVICES, deviceHeight, deviceWidth, newDeviceActor, newScene, normalizeScene, sceneMediaIds } from '@/lib/limelight/scene';
import { LIMELIGHT_EASES, type CameraState, type LimelightEase, type LimelightScene, type ScreenChange } from '@/lib/limelight/types';

const close = (actual: number, expected: number, tolerance = 1e-6, label = '') =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label} expected ${expected}, got ${actual}`);

function track(times: number[], eases: LimelightEase[], values: number[]): Track {
  return { times, eases, values: values.map((v) => [v]) };
}

const at = (t: Track, time: number) => sampleTrack(t, time)[0];

/** The slope just before and just after `time`. */
function slopes(t: Track, time: number, h = 1e-4): [number, number] {
  return [(at(t, time) - at(t, time - h)) / h, (at(t, time + h) - at(t, time)) / h];
}

test('limelight: every ease starts at 0 and ends at 1', () => {
  for (const ease of LIMELIGHT_EASES) {
    close(easeProgress(ease, 0), 0, 1e-9, `${ease} at 0`);
    close(easeProgress(ease, 1), 1, 1e-9, `${ease} at 1`);
  }
});

test('limelight: smooth, snappy and bounce start from rest', () => {
  for (const ease of ['smooth', 'snappy', 'bounce'] as const) {
    const start = (easeProgress(ease, 1e-4) - easeProgress(ease, 0)) / 1e-4;
    assert.ok(Math.abs(start) < 0.02, `${ease} starts at speed ${start}`);
  }
  const smoothEnd = (easeProgress('smooth', 1) - easeProgress('smooth', 1 - 1e-4)) / 1e-4;
  assert.ok(Math.abs(smoothEnd) < 0.02, `smooth ends at speed ${smoothEnd}`);
});

test('limelight: snappy is ahead of smooth early on, bounce goes past and comes back, cut holds', () => {
  assert.ok(easeProgress('snappy', 0.3) > easeProgress('smooth', 0.3) + 0.2);
  let peak = 0;
  for (let u = 0; u <= 1; u += 0.01) peak = Math.max(peak, easeProgress('bounce', u));
  assert.ok(peak > 1.05 && peak < 1.2, `bounce peaks at ${peak}`);
  assert.equal(easeProgress('cut', 0.999), 0);
});

test('limelight: one key holds, and times outside the keys clamp to the ends', () => {
  assert.deepEqual(sampleTrack(track([2], ['smooth'], [5]), 10), [5]);
  const t = track([1, 3], ['steady', 'steady'], [10, 20]);
  assert.equal(at(t, 0), 10);
  assert.equal(at(t, 5), 20);
  close(at(t, 2), 15);
});

test('limelight: cut holds the value until the next key and then jumps', () => {
  const t = track([0, 2], ['cut', 'smooth'], [0, 8]);
  assert.equal(at(t, 1.999), 0);
  assert.equal(at(t, 2), 8);
});

test('limelight: a run of glides has one speed through each key', () => {
  const t = track([0, 2, 3, 6], ['glide', 'glide', 'glide', 'glide'], [0, 10, 14, 30]);
  for (const key of [2, 3]) {
    const [before, after] = slopes(t, key);
    close(before, after, 0.01, `slope at ${key}`);
    assert.ok(before > 0.5, `glide keeps moving through ${key} (speed ${before})`);
  }
});

test('limelight: a glide never swings past its keys', () => {
  // Rising then flat: Catmull-Rom would overshoot 10 on the way to the plateau.
  const t = track([0, 1, 2, 3], ['glide', 'glide', 'glide', 'glide'], [0, 10, 10, 10]);
  for (let time = 0; time <= 3; time += 0.01) assert.ok(at(t, time) <= 10 + 1e-9, `${at(t, time)} at ${time}`);
  // Down and up again: the valley holds at the key, with no dip below it.
  const v = track([0, 1, 2], ['glide', 'glide', 'glide'], [10, 2, 10]);
  for (let time = 0; time <= 2; time += 0.01) assert.ok(at(v, time) >= 2 - 1e-9, `${at(v, time)} at ${time}`);
});

test('limelight: a glide comes to rest where it meets a stop, and runs at steady speed beside steady', () => {
  const stop = track([0, 2, 4], ['glide', 'smooth', 'smooth'], [0, 10, 0]);
  const [into, outOf] = slopes(stop, 2);
  assert.ok(Math.abs(into) < 0.05 && Math.abs(outOf) < 0.05, `stops at the join: ${into}, ${outOf}`);
  const steady = track([0, 2, 4], ['glide', 'steady', 'steady'], [0, 10, 20]);
  const [g, s] = slopes(steady, 2);
  close(g, 5, 0.02, 'glide arrives at the steady speed');
  close(s, 5, 0.02, 'steady speed');
});

test('limelight: two glides alone drift in a straight line', () => {
  const t = track([0, 4], ['glide', 'glide'], [0, 8]);
  for (const time of [1, 2, 3]) close(at(t, time), time * 2, 1e-9);
});

test('limelight: the lens is measured across the short side', () => {
  close(verticalFov(50, 3 / 2), (2 * Math.atan(12 / 50) * 180) / Math.PI, 1e-9);
  // On a tall picture the short side is across, so the height sees more.
  close(verticalFov(50, 9 / 16), (2 * Math.atan(12 / (9 / 16) / 50) * 180) / Math.PI, 1e-9);
  for (const aspect of [9 / 16, 1, 16 / 9]) close(lensForFov(verticalFov(85, aspect), aspect), 85, 1e-9);
});

const camera = (patch: Partial<CameraState> = {}): CameraState => ({
  target: { x: 0, y: 10, z: 0 },
  azimuth: 0,
  elevation: 0,
  distance: 40,
  roll: 0,
  lens: 50,
  aperture: 2.8,
  focus: 0,
  ...patch,
});

test('limelight: the camera stands in front at azimuth 0 and to the right at 90', () => {
  const front = cameraPose(camera(), 1);
  close(front.position.x, 0);
  close(front.position.z, 40);
  close(front.position.y, 10);
  const right = cameraPose(camera({ azimuth: 90 }), 1);
  close(right.position.x, 40);
  close(right.position.z, 0, 1e-9);
  const above = cameraPose(camera({ elevation: 30 }), 1);
  close(above.position.y, 10 + 40 * Math.sin(Math.PI / 6));
});

test('limelight: positive roll turns the picture clockwise', () => {
  // The camera's up leans to its left, so the world in the picture turns clockwise.
  const pose = cameraPose(camera({ roll: 90 }), 1);
  close(pose.up.x, -1, 1e-9);
  close(pose.up.y, 0, 1e-9);
  close(pose.right.y, 1, 1e-9);
});

test('limelight: angles take the short way round', () => {
  assert.equal(nearestAngle(350, 10), -10);
  assert.equal(nearestAngle(10, 350), 370);
  assert.equal(nearestAngle(725, 0), 5);
});

test('limelight: a pan slides the target sideways and keeps the angle and distance', () => {
  const start = camera({ azimuth: 30, elevation: 10 });
  const moved = panBy(start, 100, 0, 800, 9 / 16);
  assert.equal(moved.azimuth, 30);
  assert.equal(moved.distance, 40);
  const pose = cameraPose(start, 9 / 16);
  const dx = moved.target.x - start.target.x;
  const dz = moved.target.z - start.target.z;
  // Dragging right moves the camera to its left, against its right vector.
  assert.ok(dx * pose.right.x + dz * pose.right.z < 0);
  close(moved.target.y, start.target.y, 1e-9);
});

test('limelight: an orbit stops short of straight down', () => {
  const swung = orbitBy(camera(), 0, 100000, 800);
  assert.equal(swung.elevation, 88);
});

test('limelight: a dolly zoom keeps the target the same size', () => {
  const start = camera({ lens: 35, distance: 30 });
  const zoomed = dollyZoomTo(start, 85, 9 / 16);
  const size = (c: CameraState) => c.distance * Math.tan((verticalFov(c.lens, 9 / 16) * Math.PI) / 360);
  close(size(zoomed), size(start), 1e-9);
  assert.equal(zoomed.lens, 85);
});

test('limelight: a new scene has a phone and a camera that moves', () => {
  const scene = newScene();
  assert.equal(scene.actors.length, 1);
  assert.equal(scene.actors[0].kind, 'device');
  assert.equal(scene.camera.shots.length, 2);
  const first = cameraAt(scene.camera.shots, 0, 0);
  const last = cameraAt(scene.camera.shots, 0, scene.format.duration);
  assert.notEqual(first.azimuth, last.azimuth);
  const frame = sceneAt(scene, scene.format.duration / 2);
  assert.ok(frame.actors[scene.actors[0].id]);
  // The phone floats just above the floor.
  const phone = actorAt(scene.actors[0], 0);
  assert.ok(phone.position.y - deviceHeight(DEFAULT_DEVICE) / 2 > 0);
});

test('limelight: anything at all reads back as a scene', () => {
  for (const input of [null, 42, 'scene', [], { actors: 'no' }, { camera: { shots: [{ time: 'x' }] } }]) {
    const scene = normalizeScene(input);
    assert.equal(scene.version, 1);
    assert.ok(scene.camera.shots.length >= 1);
    assert.ok(Array.isArray(scene.actors));
    assert.ok(scene.format.width >= 240);
  }
});

test('limelight: reading back drops unknown kinds, swaps unknown devices and clamps numbers', () => {
  const scene = normalizeScene({
    id: 'scene_a',
    format: { width: 99999, height: 3, fps: 500, duration: -4 },
    camera: {
      shake: 9,
      shots: [
        { id: 'b', time: 5, ease: 'wiggle', camera: { lens: 1000, aperture: 0, elevation: 120, distance: 1 } },
        { id: 'b', time: 1, camera: { azimuth: 30 } },
      ],
    },
    actors: [
      { kind: 'dragon' },
      { kind: 'device', id: 'dup', device: 'toaster', glare: 4, color: 'red', poses: [{ time: 0, scale: -2 }] },
      { kind: 'text', id: 'dup', text: 'Hello', weight: 333, color: '#ABC', size: 1000 },
    ],
  });
  assert.equal(scene.format.width, 4096);
  assert.equal(scene.format.height, 240);
  assert.equal(scene.format.fps, 60);
  assert.equal(scene.format.duration, 1);
  assert.equal(scene.camera.shake, 1);
  // Sorted by time, with the repeated id replaced.
  assert.deepEqual(scene.camera.shots.map((shot) => shot.time), [1, 5]);
  assert.notEqual(scene.camera.shots[0].id, scene.camera.shots[1].id);
  const late = scene.camera.shots[1];
  assert.equal(late.ease, 'smooth');
  assert.equal(late.camera.lens, 300);
  assert.equal(late.camera.aperture, 1);
  assert.equal(late.camera.elevation, 88);
  assert.equal(late.camera.distance, 4);
  assert.equal(scene.actors.length, 2);
  const [device, text] = scene.actors;
  assert.equal(device.kind, 'device');
  if (device.kind === 'device') {
    assert.equal(device.device, DEFAULT_DEVICE);
    assert.equal(device.glare, 1);
    assert.equal(device.color, undefined);
    assert.equal(device.poses[0].scale, 0);
  }
  assert.notEqual(device.id, text.id);
  if (text.kind === 'text') {
    assert.equal(text.weight, 300);
    assert.equal(text.color, '#aabbcc');
    assert.equal(text.size, 100);
  }
});

test('limelight: a scene holds a limited number of devices', () => {
  const actors = Array.from({ length: MAX_DEVICES + 3 }, () => ({ kind: 'device' }));
  assert.equal(normalizeScene({ actors }).actors.length, MAX_DEVICES);
});

test('limelight: a scene read back twice is the same scene', () => {
  const scene = newScene();
  const once = normalizeScene(JSON.parse(JSON.stringify(scene)));
  const twice = normalizeScene(JSON.parse(JSON.stringify(once)));
  assert.deepEqual(twice, once);
  assert.deepEqual(once.camera, scene.camera);
  assert.deepEqual(once.actors, scene.actors);
});

test('limelight: a shot added between two others turns the short way and copies the ease before it', () => {
  const scene = newScene();
  const [first, last] = scene.camera.shots;
  const glided = updateShot(scene, first.id, { ease: 'glide' });
  const mid = cameraAt(glided.camera.shots, 0, last.time / 2);
  const { scene: next, added, shotId } = setShotAt(glided, last.time / 2, { ...mid, azimuth: mid.azimuth + 360 });
  assert.ok(added);
  const shot = next.camera.shots.find((s) => s.id === shotId)!;
  close(shot.camera.azimuth, mid.azimuth, 1e-9);
  assert.equal(shot.ease, 'glide');
  assert.deepEqual(next.camera.shots.map((s) => s.time), [0, last.time / 2, last.time]);
  // The same moment again changes that shot instead of adding one.
  const again = setShotAt(next, last.time / 2 + 0.01, { ...mid, distance: 99 });
  assert.equal(again.added, false);
  assert.equal(again.scene.camera.shots.length, 3);
});

test('limelight: the last shot stays', () => {
  let scene = newScene();
  for (const shot of scene.camera.shots) scene = removeShot(scene, shot.id);
  assert.equal(scene.camera.shots.length, 1);
});

test('limelight: a still actor keeps one pose until a key is asked for', () => {
  const scene = newScene();
  const id = scene.actors[0].id;
  const moved = setPoseAt(scene, id, 3, { position: { x: 5, y: 9, z: 0 } });
  assert.equal(moved.added, false);
  assert.equal(moved.scene.actors[0].poses.length, 1);
  assert.equal(moved.scene.actors[0].poses[0].position.x, 5);
  const keyed = setPoseAt(moved.scene, id, 3, { position: { x: -5, y: 9, z: 0 } }, true);
  assert.equal(keyed.added, true);
  assert.equal(keyed.scene.actors[0].poses.length, 2);
  close(actorAt(keyed.scene.actors[0], 3).position.x, -5, 1e-9);
  // Animated now, so a change at another moment adds a pose there.
  const third = setPoseAt(keyed.scene, id, 6, { scale: 2 });
  assert.equal(third.added, true);
  assert.equal(third.scene.actors[0].poses.length, 3);
});

test('limelight: a new length stretches the keys with it', () => {
  const scene = newScene();
  const longer = setFormat(scene, { duration: scene.format.duration * 2 });
  assert.deepEqual(
    longer.camera.shots.map((shot) => shot.time),
    scene.camera.shots.map((shot) => shot.time * 2)
  );
  const kept = setFormat(scene, { duration: scene.format.duration * 2 }, false);
  assert.deepEqual(kept.camera.shots.map((shot) => shot.time), scene.camera.shots.map((shot) => shot.time));
});

test('limelight: a screen change slides in over its duration', () => {
  const screens: ScreenChange[] = [
    { id: 'a', time: 0, media: 'one', transition: 'cut', duration: 0.5 },
    { id: 'b', time: 2, media: 'two', transition: 'slide', duration: 0.5 },
    { id: 'c', time: 4, media: 'three', transition: 'cut', duration: 0.5 },
  ];
  assert.deepEqual(screenAt(screens, 1), { media: 'one', transition: 'cut', progress: 1 });
  const mid = screenAt(screens, 2.25);
  assert.equal(mid.media, 'two');
  assert.equal(mid.previous, 'one');
  close(mid.progress, 0.5, 1e-9);
  assert.equal(screenAt(screens, 2.6).previous, undefined);
  assert.equal(screenAt(screens, 4.1).previous, undefined);
  assert.equal(screenAt([], 1).media, null);
  // Before the first change, the first picture already shows.
  assert.equal(screenAt([{ id: 'x', time: 3, media: 'late', transition: 'fade', duration: 1 }], 0).media, 'late');
});

test('limelight: pictures added to a screen are found again', () => {
  let scene = newScene();
  const id = scene.actors[0].id;
  scene = setScreenAt(scene, id, 0, 'media_one');
  scene = setScreenAt(scene, id, 3, 'media_two');
  assert.deepEqual([...sceneMediaIds(scene)].sort(), ['media_one', 'media_two']);
  const device = scene.actors[0];
  assert.ok(device.kind === 'device' && device.screens.length === 2 && device.screens[1].transition === 'slide');
});

test('limelight: a copy of a device moves over and keeps its look', () => {
  const scene = newScene();
  const { scene: next, actorId } = duplicateActor(scene, scene.actors[0].id);
  assert.ok(actorId);
  assert.equal(next.actors.length, 2);
  close(next.actors[1].poses[0].position.x, scene.actors[0].poses[0].position.x + 9, 1e-9);
  assert.notEqual(next.actors[1].poses[0].id, scene.actors[0].poses[0].id);
});

test('limelight: framing an actor points the camera at it', () => {
  const scene = newScene();
  const actor = newDeviceActor('ipad-pro-13', { position: { x: 30, y: 20, z: -10 } });
  const framed = cameraOnActor({ ...scene, actors: [...scene.actors, actor] }, actor.id, 0, scene.camera.shots[0].camera);
  assert.deepEqual(framed.target, { x: 30, y: 20, z: -10 });
  assert.ok(framed.distance > scene.camera.shots[0].camera.distance, 'a tablet needs the camera further back');
});

test('limelight: the App Store size warns about length and frame rate', () => {
  assert.equal(storeRuleProblem({ width: 886, height: 1920, fps: 30, duration: 20, preset: 'app-store-iphone' }), null);
  assert.match(storeRuleProblem({ width: 886, height: 1920, fps: 30, duration: 8, preset: 'app-store-iphone' }) ?? '', /15 to 30 seconds/);
  assert.match(storeRuleProblem({ width: 886, height: 1920, fps: 60, duration: 20, preset: 'app-store-iphone' }) ?? '', /30 frames/);
  assert.equal(storeRuleProblem({ width: 1080, height: 1920, fps: 60, duration: 8, preset: 'story' }), null);
});

/** Where a stage point lands in the picture, from -1 to 1 across and up. */
function project(camera: CameraState, aspect: number, p: { x: number; y: number; z: number }): [number, number] {
  const pose = cameraPose(camera, aspect);
  const rel = { x: p.x - pose.position.x, y: p.y - pose.position.y, z: p.z - pose.position.z };
  const forward = { x: pose.target.x - pose.position.x, y: pose.target.y - pose.position.y, z: pose.target.z - pose.position.z };
  const length = Math.hypot(forward.x, forward.y, forward.z);
  const depth = (rel.x * forward.x + rel.y * forward.y + rel.z * forward.z) / length;
  const tan = Math.tan((pose.fov * Math.PI) / 360);
  const x = (rel.x * pose.right.x + rel.y * pose.right.y + rel.z * pose.right.z) / (depth * tan * aspect);
  const y = (rel.x * pose.up.x + rel.y * pose.up.y + rel.z * pose.up.z) / (depth * tan);
  return [x, y];
}

test('limelight: turning a point follows the 3D Studio order, roll after pitch after yaw', () => {
  const p = turnPoint({ x: 1, y: 0, z: 0 }, { yaw: 90, pitch: 0, roll: 0 });
  close(p.x, 0, 1e-9);
  close(p.z, -1, 1e-9);
  const q = turnPoint({ x: 0, y: 1, z: 0 }, { yaw: 0, pitch: 90, roll: 0 });
  close(q.z, 1, 1e-9);
  const r = turnPoint({ x: 1, y: 0, z: 0 }, { yaw: 0, pitch: 0, roll: 90 });
  close(r.y, 1, 1e-9);
});

test('limelight: Fit puts every device just inside the picture', () => {
  for (const extra of [null, 'ipad-pro-13', 'iphone-duo'] as const) {
    let scene = newScene();
    if (extra) scene = addActor(scene, newDeviceActor(extra, { position: { x: 30, y: 15, z: -10 }, turn: { yaw: -30, pitch: 0, roll: 0 } }));
    const aspect = scene.format.width / scene.format.height;
    const camera = cameraToFitAll(scene, 0, scene.camera.shots[0].camera);
    const projected = stagePoints(scene, 0).map((p) => project(camera, aspect, p));
    const widest = Math.max(...projected.map(([x]) => Math.abs(x)));
    const tallest = Math.max(...projected.map(([, y]) => Math.abs(y)));
    assert.ok(widest <= 0.801 && tallest <= 0.801, `${extra}: everything inside (${widest.toFixed(3)}, ${tallest.toFixed(3)})`);
    // Just inside: one side or the other touches the margin, so nothing is small for no reason.
    assert.ok(Math.max(widest, tallest) > 0.75, `${extra}: fills the picture (${widest.toFixed(3)}, ${tallest.toFixed(3)})`);
  }
});

test('limelight: every template builds at every size with any number of pictures', () => {
  for (const template of TEMPLATES) {
    for (const preset of FORMAT_PRESETS) {
      for (const count of [0, 1, 3, 6]) {
        const pictures = Array.from({ length: count }, (_, i) => `media_${i}`);
        const format = { width: preset.width, height: preset.height, fps: preset.fps, duration: 15, preset: preset.id };
        const scene = buildTemplate(template.id, { format, pictures, title: 'Juniper' });
        assert.ok(scene, template.id);
        // Stable: reading it back changes nothing, so the template made a valid scene.
        assert.deepEqual(normalizeScene(JSON.parse(JSON.stringify(scene))), scene, `${template.id} at ${preset.id} with ${count}`);
        assert.equal(scene.template, template.id);
        assert.equal(scene.format.width, preset.width);
        // Every picture is on some screen.
        const shown = sceneMediaIds(scene);
        const expected = template.id === 'turntable' ? pictures.slice(0, 1) : pictures;
        for (const id of expected) assert.ok(shown.has(id), `${template.id} shows ${id}`);
        const devices = scene.actors.filter((actor) => actor.kind === 'device').length;
        assert.equal(devices, template.devices, `${template.id} has ${template.devices} devices`);
      }
    }
  }
});

test('limelight: a template shot that is not pulled in keeps every device in the picture', () => {
  for (const template of TEMPLATES) {
    const scene = buildTemplate(template.id, { pictures: ['media_a', 'media_b', 'media_c'] })!;
    const aspect = scene.format.width / scene.format.height;
    for (const shot of scene.camera.shots) {
      const points = stagePoints(scene, shot.time).map((p) => project(shot.camera, aspect, p));
      const out = Math.max(...points.map(([x, y]) => Math.max(Math.abs(x), Math.abs(y))));
      // Templates frame by Fit at 80% and pull from there; up to 1.2 times closer still fits.
      assert.ok(out <= 1.001 || template.id === 'push-in' || template.id === 'title-opener', `${template.id} shot at ${shot.time}: ${out.toFixed(3)}`);
    }
  }
});

test('limelight: the turntable ends where it starts, so the video loops', () => {
  const scene = buildTemplate('turntable', { pictures: ['media_a'] })!;
  const start = actorAt(scene.actors[0], 0);
  const end = actorAt(scene.actors[0], scene.format.duration);
  close(end.turn.yaw - start.turn.yaw, 360, 1e-9);
});

// ---------------------------------------------------------------------------
// What the November 2026 audit found: each test fails on the code it reported.
// ---------------------------------------------------------------------------

/** Pictures that are their own id, decoded at once; `closed` says which were let go, `decoded` how many reads there were. */
function fakeMedia(known: string[], fail = new Set<string>()) {
  const closed = new Set<string>();
  let reads = 0;
  const media = new StageMedia(
    async (id) => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      return known.includes(id) ? new Blob([id]) : null;
    },
    () => {},
    async (blob) => {
      reads++;
      const id = await blob.text();
      if (fail.has(id)) throw new Error('not a picture');
      return { width: 4, height: 4, close: () => closed.add(id) } as unknown as Picture;
    }
  );
  return { media, closed, decoded: () => reads };
}

test('limelight: a frame asks only for the pictures its moment shows', () => {
  let scene = newScene({ media: 'media_a' });
  const phone = scene.actors[0].id;
  scene = setScreenAt(scene, phone, 4, 'media_b', { transition: 'slide' });
  scene = setScreenAt(scene, phone, 8, 'media_c', { transition: 'slide' });
  assert.deepEqual([...frameMediaIds(sceneAt(scene, 1))], ['media_a']);
  // During the slide, the picture going out is drawn too.
  assert.deepEqual([...frameMediaIds(sceneAt(scene, 4.2))].sort(), ['media_a', 'media_b']);
  assert.deepEqual([...frameMediaIds(sceneAt(scene, 9))], ['media_c']);
});

test('limelight: a frame keeps its pictures however many the scene shows', async () => {
  const ids = Array.from({ length: 13 }, (_, i) => `media_${i}`);
  const { media, closed } = fakeMedia(ids);
  // All thirteen held at once: none is let go while held, past the dozen kept.
  const release = await media.hold(ids);
  for (const id of ids) assert.ok(media.get(id), `${id} is there`);
  assert.equal(closed.size, 0);
  release();
  assert.equal(media.size, KEEP);
  // One moment after another, again and again: each frame's picture is there when it is drawn.
  for (const k of [0, 12, 6, 0, 12, 1, 7, 2]) {
    const done = await media.hold([ids[k]]);
    assert.ok(media.get(ids[k]), `${ids[k]} is there for its frame`);
    done();
    assert.ok(media.size <= KEEP);
  }
});

test("limelight: two frames drawn at once never take each other's pictures", async () => {
  const ids = Array.from({ length: 30 }, (_, i) => `media_${i}`);
  const { media } = fakeMedia(ids);
  const first = media.hold([ids[0]]);
  // Nineteen pictures load while the first frame still waits to be drawn.
  const second = media.hold(ids.slice(1, 20));
  const releaseFirst = await first;
  const releaseSecond = await second;
  assert.ok(media.get(ids[0]), 'the first frame still has its picture');
  for (const id of ids.slice(1, 20)) assert.ok(media.get(id));
  releaseSecond();
  releaseFirst();
  assert.ok(media.size <= KEEP);
});

test('limelight: the canvas keeps every picture its frame shows, sixteen as well as one, and reads each once', async () => {
  // Eight phones changing picture at once: every frame on the canvas shows sixteen.
  const ids = Array.from({ length: 16 }, (_, i) => `media_${i}`);
  const { media, decoded } = fakeMedia(ids);
  const frame = new Set(ids);
  for (let drawn = 0; drawn < 6; drawn++) {
    // As the stage draws a frame: says what it shows, then asks for each picture.
    media.show(frame);
    for (const id of ids) media.get(id);
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  for (const id of ids) assert.ok(media.get(id), `${id} is there for the frame`);
  assert.equal(decoded(), 16, 'each picture was read once');
  // The next moment shows one: the rest may go, down to the dozen kept.
  media.show(new Set([ids[0]]));
  assert.equal(media.size, KEEP);
  assert.ok(media.get(ids[0]));
});

test('limelight: a picture that is gone or unreadable does not keep a frame waiting', async () => {
  const { media } = fakeMedia(['media_ok', 'media_bad'], new Set(['media_bad']));
  const release = await media.hold(['media_ok', 'media_bad', 'media_gone']);
  assert.ok(media.get('media_ok'));
  assert.equal(media.get('media_bad'), null);
  assert.equal(media.get('media_gone'), null);
  release();
});

test('limelight: a picture an undo step shows stays when another scene that shows it is deleted', () => {
  // B is a copy of A (Make a copy), so the two share the picture.
  const a = newScene({ name: 'A', media: 'media_p' });
  const b = { ...a, id: 'scene_b', name: 'B' };
  const history = new SceneHistory();
  history.record(a);
  const after = removeActor(a, a.actors[0].id);
  // What A's row keeps at its next save: the picture only its undo step shows.
  const own = sceneMediaIds(after);
  const held = [...history.pictures()].filter((id) => !own.has(id));
  assert.deepEqual(held, ['media_p']);
  assert.deepEqual(picturesToDelete(rowPictures({ scene: b }), [{ scene: after, held }], []), []);
  // Before that save, the open view's undo steps say so themselves.
  assert.deepEqual(picturesToDelete(rowPictures({ scene: b }), [{ scene: after }], history.pictures()), []);
  // Held by nothing, it goes with B.
  assert.deepEqual(picturesToDelete(rowPictures({ scene: b }), [{ scene: after }], []), ['media_p']);
  // A scene deleted with pictures only its undo steps showed takes them along.
  assert.deepEqual(picturesToDelete(rowPictures({ scene: after, held }), [], []), ['media_p']);
  history.clear();
  assert.equal(history.pictures().size, 0);
});

test('limelight: every device stands at its real size, and the editor keeps its own', () => {
  for (const [device, size] of Object.entries(REAL_SIZES)) {
    const model = stageModelFor(device as DeviceType)!;
    close(model.width, size!.width, 0.05, `${device} width`);
    close(model.height, size!.height, 0.05, `${device} height`);
    assert.equal(model.thickness, size!.thickness);
    assert.ok(model.display.width > 0 && model.display.width < model.width, `${device} has a screen inside its body`);
  }
  // Apple's numbers, in centimetres on the stage.
  close(deviceWidth('ipad-pro-13'), 21.55, 1e-9);
  close(deviceHeight('ipad-pro-13'), 28.16, 1e-9);
  close(deviceHeight('ipad-11'), 24.97, 1e-9);
  close(deviceWidth('iphone-15-pro'), 7.06, 1e-9);
  assert.ok(deviceHeight('tablet-7') < deviceHeight('tablet-10') && deviceHeight('tablet-10') < deviceHeight('ipad-pro-13'));
  // The generic tablets' screens come out the size each is named for.
  const inches = (device: DeviceType) => {
    const display = stageModelFor(device)!.display;
    return Math.hypot(display.width, display.height) / 25.4;
  };
  close(inches('tablet-7'), 7, 0.01, 'tablet-7');
  close(inches('tablet-10'), 10, 0.01, 'tablet-10');
  close(inches('ipad-pro-13'), 13, 0.05, 'ipad-pro-13');
  // Measured phones are their own models, and the editor's stand-ins are as they were.
  assert.equal(stageModelFor('iphone-17-pro'), studioModelFor('iphone-17-pro'));
  assert.equal(studioModelFor('ipad-pro-13')!.width, 180);
  assert.equal(studioModelFor('tablet-7')!.width, 180);
  assert.equal(studioModelFor('iphone-15')!.width, 72);
});

test('limelight: a change is later than the last one even when the clock is behind', () => {
  const ahead = Date.now() + 3_600_000;
  assert.equal(laterThan(ahead), ahead + 1);
  assert.ok(laterThan(0) >= Date.now() - 5);
  const scene = { ...newScene({ media: null }), updatedAt: ahead };
  assert.ok(rename(scene, 'Later').updatedAt > ahead);
});

/** The record a save to Drive, or an open from it, leaves of the scene. */
const met = (scene: LimelightScene) => ({ version: scene.updatedAt, content: sceneFingerprint(scene) });

test('limelight: opening from Drive never writes over a change made here, however close in time', () => {
  const saved = { ...newScene({ name: 'Promo', media: null }), updatedAt: 1_000_000 };
  const editedHere = { ...rename(saved, 'Promo here'), updatedAt: saved.updatedAt + 500 };
  const editedThere = { ...rename(saved, 'Promo there'), updatedAt: saved.updatedAt + 60_000 };
  // Saved to Drive, then changed here half a second later: both are kept.
  assert.equal(driveOpenPlan(editedHere, saved, met(saved)), 'copy');
  // Unchanged here since it met Drive: Drive's newer one takes its place.
  assert.equal(driveOpenPlan(saved, editedThere, met(saved)), 'replace');
  // Changed in both places: both kept.
  assert.equal(driveOpenPlan(editedHere, editedThere, met(saved)), 'copy');
  // The same scene, or none here: nothing to lose.
  assert.equal(driveOpenPlan(saved, { ...saved }, undefined), 'replace');
  assert.equal(driveOpenPlan(null, saved, undefined), 'replace');
  // Never met Drive on this device, and different: both kept.
  assert.equal(driveOpenPlan(editedHere, saved, undefined), 'copy');
  // An older copy in Drive never replaces a newer one here.
  assert.equal(driveOpenPlan(editedThere, saved, met(editedThere)), 'copy');
  // A record from before fingerprints can't tell, so both are kept.
  assert.equal(driveOpenPlan(saved, editedThere, { version: saved.updatedAt }), 'copy');
  // The fingerprint is the contents, whenever they were saved.
  assert.equal(sceneFingerprint({ ...saved, updatedAt: 5 }), sceneFingerprint(saved));
  assert.notEqual(sceneFingerprint(editedHere), sceneFingerprint(saved));
  // Every template, as the database or Drive gives it back, keeps its fingerprint, so an unchanged scene is never taken for a changed one.
  for (const template of TEMPLATES) {
    const scene = buildTemplate(template.id, { pictures: ['media_a', 'media_b', 'media_c'] })!;
    const back = JSON.parse(JSON.stringify(scene));
    assert.equal(sceneFingerprint(back), sceneFingerprint(scene), template.id);
    assert.equal(driveOpenPlan(back, { ...rename(scene, 'Changed there'), updatedAt: scene.updatedAt + 1 }, met(scene)), 'replace', template.id);
  }
});

test('limelight: an undo back past a save to Drive is a change here, so opening the Drive copy keeps both', () => {
  // The audit's steps: rename, save to Drive, undo, open from Drive.
  const original = { ...newScene({ name: 'Original', media: null }), updatedAt: 1_000 };
  const renamed = { ...rename(original, 'Saved rename'), updatedAt: 2_000 };
  const history = new SceneHistory();
  history.record(original);
  const savedToDrive = met(renamed);
  const undone = history.undo(renamed)!;
  assert.equal(undone.name, 'Original');
  // Undo is a change like any other: later than the scene it replaced, not the time it once had.
  assert.ok(undone.updatedAt > renamed.updatedAt, `undone at ${undone.updatedAt}, renamed at ${renamed.updatedAt}`);
  assert.equal(driveOpenPlan(undone, renamed, savedToDrive), 'copy');
  // Even with the old time back, its contents aren't what Drive was given.
  assert.equal(driveOpenPlan(original, renamed, savedToDrive), 'copy');
  // Redo is later again, and back to just what Drive has: nothing here to lose.
  const redone = history.redo(undone)!;
  assert.equal(redone.name, 'Saved rename');
  assert.ok(redone.updatedAt > undone.updatedAt);
  assert.equal(driveOpenPlan(redone, renamed, savedToDrive), 'replace');
});

test('limelight: a scene in Drive keeps what each picture is and where it came from', () => {
  const from = { projectId: 'proj_1', artboardId: 'ab_home', locale: 'de' };
  const scene = newScene({ name: 'Promo', media: 'media_p', from });
  const json = driveScenePayload(scene, [{ id: 'media_p', kind: 'image', type: 'image/png', name: 'Home.png', width: 1320, height: 2868, bytes: 1234, data: new ArrayBuffer(4), createdAt: 42, from }]);
  const back = readDriveScenePayload(json);
  assert.equal(back.scene.id, scene.id);
  assert.deepEqual(back.pictures.get('media_p'), { id: 'media_p', kind: 'image', type: 'image/png', name: 'Home.png', width: 1320, height: 2868, bytes: 1234, createdAt: 42, from });
  // A scene.json from before pictures were listed is the scene alone.
  const old = readDriveScenePayload(JSON.stringify(scene));
  assert.equal(old.scene.id, scene.id);
  assert.equal(old.pictures.size, 0);
  // Anything odd in the list is dropped, not trusted.
  const odd = readDriveScenePayload(JSON.stringify({ kind: 'limelight-scene', version: 1, scene, pictures: [{ id: 'media_p', type: 'text/html', name: 5, from: { projectId: 1 } }, 'junk'] }));
  const picture = odd.pictures.get('media_p')!;
  assert.deepEqual([picture.type, picture.name, picture.from, odd.pictures.size], ['image/png', 'Picture', undefined, 1]);
  assert.throws(() => readDriveScenePayload('{'), /couldn't be read/);
});
