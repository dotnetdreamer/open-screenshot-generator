"use client";
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { DeviceType, Device3DPose, Device3DFrameColor } from '@/types/artboard';
import { withBasePath } from '@/lib/basePath';

interface Device3DRendererProps {
  deviceType: DeviceType;
  side: 'left' | 'right';
  screenshotSrc?: string;
  objectFit?: 'contain' | 'cover' | 'fill';
  pose?: Device3DPose;
  frameColor?: Device3DFrameColor;
}

type NotchKind = 'island' | 'notch' | 'punch' | 'none';

// All lengths are fractions of the device body width (world width = 1).
interface DeviceMetrics {
  cornerRadius: number;
  screenRadius: number;
  bezel: number;
  thickness: number;
  notch: NotchKind;
}

const DEFAULT_METRICS: DeviceMetrics = { cornerRadius: 0.12, screenRadius: 0.095, bezel: 0.03, thickness: 0.08, notch: 'none' };

const DEVICE_METRICS: Partial<Record<DeviceType, DeviceMetrics>> = {
  'iphone-15': { cornerRadius: 0.14, screenRadius: 0.11, bezel: 0.03, thickness: 0.08, notch: 'island' },
  'iphone-15-pro': { cornerRadius: 0.14, screenRadius: 0.11, bezel: 0.028, thickness: 0.08, notch: 'island' },
  'iphone-17-pro-max': { cornerRadius: 0.15, screenRadius: 0.12, bezel: 0.026, thickness: 0.078, notch: 'island' },
  'iphone-14': { cornerRadius: 0.13, screenRadius: 0.10, bezel: 0.03, thickness: 0.08, notch: 'notch' },
  'iphone-13': { cornerRadius: 0.12, screenRadius: 0.09, bezel: 0.03, thickness: 0.08, notch: 'notch' },
  'iphone-x': { cornerRadius: 0.12, screenRadius: 0.09, bezel: 0.03, thickness: 0.08, notch: 'notch' },
  'iphone': { cornerRadius: 0.10, screenRadius: 0.08, bezel: 0.035, thickness: 0.08, notch: 'none' },
  'android-bar': { cornerRadius: 0.06, screenRadius: 0.04, bezel: 0.03, thickness: 0.075, notch: 'none' },
  'android-notch': { cornerRadius: 0.06, screenRadius: 0.04, bezel: 0.03, thickness: 0.075, notch: 'notch' },
  'android-punch-hole': { cornerRadius: 0.06, screenRadius: 0.04, bezel: 0.03, thickness: 0.075, notch: 'punch' },
  'ipad-pro-13': { cornerRadius: 0.045, screenRadius: 0.032, bezel: 0.032, thickness: 0.028, notch: 'none' },
  'ipad-11': { cornerRadius: 0.05, screenRadius: 0.036, bezel: 0.036, thickness: 0.032, notch: 'none' },
  'tablet': { cornerRadius: 0.05, screenRadius: 0.035, bezel: 0.05, thickness: 0.045, notch: 'none' },
  'tablet-7': { cornerRadius: 0.06, screenRadius: 0.04, bezel: 0.045, thickness: 0.05, notch: 'none' },
  'tablet-10': { cornerRadius: 0.05, screenRadius: 0.035, bezel: 0.03, thickness: 0.042, notch: 'none' },
  'desktop': { cornerRadius: 0.02, screenRadius: 0.012, bezel: 0.02, thickness: 0.03, notch: 'none' },
};

const CAMERA_FOV = 20;

// Pose presets: yaw spins the device toward its exposed rail (mirrored for
// side 'right'), pitch reclines it back toward the camera so it reads as
// viewed from above, roll leans the projected long axis diagonally in the
// image plane (also mirrored). Values eyeballed against common 3D-mockup panels.
// Without bodyAspect the device body's proportions follow the element box (the
// device fills the box); bodyAspect pins true phone proportions instead — used
// by the rolled poses where a box-derived body reads visibly squat.
const POSES: Record<Device3DPose, { yaw: number; pitch: number; roll?: number; bodyAspect?: number }> = {
  classic: { yaw: 24, pitch: 0 },
  upright: { yaw: 34, pitch: 0 },
  side: { yaw: 54, pitch: 0 },
  tilted: { yaw: 30, pitch: 26 },
  reclined: { yaw: 33, pitch: 48 },
  laying: { yaw: 28, pitch: 66 },
  floating: { yaw: 34, pitch: 36, roll: -20, bodyAspect: 2.05 },
  drifting: { yaw: 32, pitch: 46, roll: -35, bodyAspect: 2.05 },
};

// Body finishes. 'titanium' is the original look and stays the default.
const FRAME_COLORS: Record<Device3DFrameColor, { rail: number; railRoughness: number; railEnv: number; button: number }> = {
  titanium: { rail: 0x8a8a90, railRoughness: 0.42, railEnv: 0.85, button: 0xb8b8be },
  black: { rail: 0x3b3b40, railRoughness: 0.45, railEnv: 0.7, button: 0x4a4a50 },
  white: { rail: 0xdcdce0, railRoughness: 0.32, railEnv: 1.0, button: 0xe6e6ea },
};

function roundedRectShape(w: number, h: number, r: number): THREE.Shape {
  const radius = Math.min(r, w / 2, h / 2);
  const x = -w / 2;
  const y = -h / 2;
  const s = new THREE.Shape();
  s.moveTo(x + radius, y);
  s.lineTo(x + w - radius, y);
  s.absarc(x + w - radius, y + radius, radius, -Math.PI / 2, 0, false);
  s.lineTo(x + w, y + h - radius);
  s.absarc(x + w - radius, y + h - radius, radius, 0, Math.PI / 2, false);
  s.lineTo(x + radius, y + h);
  s.absarc(x + radius, y + h - radius, radius, Math.PI / 2, Math.PI, false);
  s.lineTo(x, y + radius);
  s.absarc(x + radius, y + radius, radius, Math.PI, Math.PI * 1.5, false);
  return s;
}

// ShapeGeometry writes raw shape XY into the uv attribute; remap to 0..1 so a
// texture spans the whole (origin-centered) shape.
function normalizeShapeUVs(geo: THREE.BufferGeometry, w: number, h: number) {
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, uv.getX(i) / w + 0.5, uv.getY(i) / h + 0.5);
  }
  uv.needsUpdate = true;
}

/**
 * Renders a device as real 3D geometry with three.js. The body is an extruded
 * rounded-rect (black glass caps + metallic rail via per-face materials) and the
 * screenshot is a texture on the screen face, so it sits in the exact same
 * perspective as the body. Camera distance is proportional to the device, which
 * keeps the 3D depth identical no matter how large the element is drawn.
 */
export function Device3DRenderer({ deviceType, side, screenshotSrc, objectFit = 'cover', pose = 'classic', frameColor = 'titanium' }: Device3DRendererProps) {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    const canvas = renderer.domElement;
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.display = 'block';
    mount.appendChild(canvas);

    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    // Heavy blur turns the room's small bright lights into soft studio panels;
    // sharp reflections show up as pixel noise on the high-curvature corner
    // bevels of the metal rail.
    const envTexture = pmrem.fromScene(new RoomEnvironment(), 0.35).texture;
    scene.environment = envTexture;

    const camera = new THREE.PerspectiveCamera(CAMERA_FOV, 1, 0.1, 100);

    // Key light aimed at the exposed side rail; the environment map does the rest.
    const sideSign = side === 'left' ? -1 : 1;
    const keyLight = new THREE.DirectionalLight(0xffffff, 1.4);
    keyLight.position.set(sideSign * 3, 2.5, 4);
    scene.add(keyLight);
    const fillLight = new THREE.DirectionalLight(0xffffff, 0.4);
    fillLight.position.set(-sideSign * 2, -1.5, 3);
    scene.add(fillLight);
    scene.add(new THREE.AmbientLight(0xffffff, 0.2));

    const group = new THREE.Group();
    const poseAngles = POSES[pose] ?? POSES.classic;
    const yawRad = THREE.MathUtils.degToRad(poseAngles.yaw) * -sideSign;
    const pitchRad = THREE.MathUtils.degToRad(poseAngles.pitch);
    const rollRad = THREE.MathUtils.degToRad(poseAngles.roll ?? 0) * -sideSign;
    // Yaw about Y first, then recline about the world X axis — like a phone
    // spun on a table, then the table tipped toward the camera — then roll
    // about the camera axis so the long axis leans diagonally in the image.
    const poseQuat = new THREE.Quaternion()
      .setFromAxisAngle(new THREE.Vector3(0, 0, 1), rollRad)
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), pitchRad))
      .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yawRad));
    group.quaternion.copy(poseQuat);
    scene.add(group);

    const metrics = DEVICE_METRICS[deviceType] ?? DEFAULT_METRICS;
    const disposables: Array<{ dispose(): void }> = [];
    let texture: THREE.Texture | null = null;
    let textureImage: HTMLImageElement | null = null;
    let shotMesh: THREE.Mesh | null = null;
    let screenSize = { w: 0, h: 0, radius: 0, z: 0 };
    let disposed = false;

    // All renders are synchronous (render-on-demand, no rAF loop): the drawing
    // buffer must always hold a finished frame because PNG export can snapshot
    // the canvas at any moment.
    const render = () => renderer.render(scene, camera);

    const track = <T extends { dispose(): void }>(obj: T): T => {
      disposables.push(obj);
      return obj;
    };

    // (Re)creates the screenshot plane for the current screen size + texture.
    const updateShot = () => {
      if (shotMesh) {
        group.remove(shotMesh);
        shotMesh.geometry.dispose();
        (shotMesh.material as THREE.Material).dispose();
        shotMesh = null;
      }
      if (!texture || !textureImage || screenSize.w <= 0) return;

      let { w, h } = screenSize;
      const screenAspect = w / h;
      const imgAspect = textureImage.naturalWidth / textureImage.naturalHeight;
      texture.wrapS = THREE.ClampToEdgeWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping;
      texture.repeat.set(1, 1);
      texture.offset.set(0, 0);

      let geo: THREE.BufferGeometry;
      if (objectFit === 'contain') {
        // Letterbox: shrink the plane; the black screen face shows through as bars.
        if (imgAspect > screenAspect) h = w / imgAspect;
        else w = h * imgAspect;
        geo = new THREE.PlaneGeometry(w, h);
      } else {
        if (objectFit === 'cover') {
          // Crop the texture via repeat/offset so it covers the screen shape.
          if (imgAspect > screenAspect) {
            const rx = screenAspect / imgAspect;
            texture.repeat.set(rx, 1);
            texture.offset.set((1 - rx) / 2, 0);
          } else {
            const ry = imgAspect / screenAspect;
            texture.repeat.set(1, ry);
            texture.offset.set(0, (1 - ry) / 2);
          }
        }
        geo = new THREE.ShapeGeometry(roundedRectShape(w, h, screenSize.radius), 24);
        normalizeShapeUVs(geo, w, h);
      }
      // Screens emit light — unlit material so the screenshot shows at full brightness.
      const mat = new THREE.MeshBasicMaterial({ map: texture, toneMapped: false });
      shotMesh = new THREE.Mesh(geo, mat);
      shotMesh.position.z = screenSize.z + 0.001;
      shotMesh.renderOrder = 1;
      group.add(shotMesh);
    };

    // Builds body + screen + notch + buttons for the element's current aspect ratio.
    const buildDevice = (aspect: number) => {
      for (const child of [...group.children]) group.remove(child);
      for (const d of disposables.splice(0)) d.dispose();
      shotMesh = null;

      const w = 1;
      const h = THREE.MathUtils.clamp(poseAngles.bodyAspect ?? aspect, 0.3, 4);
      const t = metrics.thickness;
      const bevel = t * 0.22;
      const depth = t - 2 * bevel;

      // The bevel expands the outline by bevelSize, so shrink the base shape to
      // keep the finished body exactly w × h at its waist.
      const bodyShape = roundedRectShape(w - 2 * bevel, h - 2 * bevel, Math.max(metrics.cornerRadius - bevel, 0.02));
      const rawBodyGeo = new THREE.ExtrudeGeometry(bodyShape, {
        depth,
        bevelEnabled: true,
        bevelThickness: bevel,
        bevelSize: bevel,
        bevelSegments: 10,
        curveSegments: 64,
      });
      // ExtrudeGeometry is flat-shaded, which makes every segment of the curved
      // bevel catch the environment separately (visible faceting on the metal
      // edge). Weld normals across shallow angles, keeping genuine creases sharp.
      const bodyGeo = track(toCreasedNormals(rawBodyGeo, THREE.MathUtils.degToRad(30)));
      rawBodyGeo.dispose();
      bodyGeo.translate(0, 0, -depth / 2);
      // Material 0 = front/back caps (black glass), 1 = extruded rail.
      const finish = FRAME_COLORS[frameColor] ?? FRAME_COLORS.titanium;
      const capMat = track(new THREE.MeshStandardMaterial({ color: 0x0b0b0d, metalness: 0.4, roughness: 0.3 }));
      // Brushed rather than polished: a rougher rail with damped reflections
      // avoids specular sparkle on the smooth-shaded bevel curvature.
      const railMat = track(new THREE.MeshStandardMaterial({ color: finish.rail, metalness: 1.0, roughness: finish.railRoughness, envMapIntensity: finish.railEnv }));
      group.add(new THREE.Mesh(bodyGeo, [capMat, railMat]));

      // Screen face sits just above the front cap.
      const frontZ = depth / 2 + bevel;
      const bezelWorld = metrics.bezel * w;
      const sw = w - 2 * bezelWorld;
      const sh = h - 2 * bezelWorld;
      const sr = Math.max(metrics.screenRadius - bezelWorld * 0.5, 0.02);
      screenSize = { w: sw, h: sh, radius: sr, z: frontZ + 0.0015 };

      const screenGeo = track(new THREE.ShapeGeometry(roundedRectShape(sw, sh, sr), 24));
      const screenMat = track(new THREE.MeshStandardMaterial({ color: 0x000000, metalness: 0.1, roughness: 0.25 }));
      const screenMesh = new THREE.Mesh(screenGeo, screenMat);
      screenMesh.position.z = screenSize.z;
      group.add(screenMesh);

      // Camera cutout, drawn above the screenshot.
      const notchMat = track(new THREE.MeshBasicMaterial({ color: 0x000000 }));
      let notchGeo: THREE.BufferGeometry | null = null;
      let notchY = 0;
      if (metrics.notch === 'island') {
        const nw = w * 0.24;
        const nh = w * 0.068;
        notchGeo = track(new THREE.ShapeGeometry(roundedRectShape(nw, nh, nh / 2), 16));
        notchY = sh / 2 - nh / 2 - w * 0.03;
      } else if (metrics.notch === 'notch') {
        const nw = w * 0.32;
        const nh = w * 0.075;
        notchGeo = track(new THREE.ShapeGeometry(roundedRectShape(nw, nh, nh * 0.4), 16));
        notchY = sh / 2 - nh / 2 + 0.001;
      } else if (metrics.notch === 'punch') {
        notchGeo = track(new THREE.CircleGeometry(w * 0.025, 24));
        notchY = sh / 2 - w * 0.05;
      }
      if (notchGeo) {
        const notchMesh = new THREE.Mesh(notchGeo, notchMat);
        notchMesh.position.set(0, notchY, screenSize.z + 0.002);
        notchMesh.renderOrder = 2;
        group.add(notchMesh);
      }

      // Side buttons on the rail facing the viewer (phones/tablets only).
      // Anchored in fixed world units below the corner radius — fractions of the
      // device height would let buttons ride up into the corner arc on short or
      // user-squashed elements and poke out of the silhouette as dark bumps.
      if (metrics.notch !== 'none' || deviceType === 'iphone' || deviceType === 'tablet' || deviceType === 'ipad-pro-13' || deviceType === 'ipad-11') {
        const finishForButtons = FRAME_COLORS[frameColor] ?? FRAME_COLORS.titanium;
        const buttonMat = track(new THREE.MeshStandardMaterial({ color: finishForButtons.button, metalness: 0.9, roughness: 0.45 }));
        const buttonSpecs = side === 'left'
          ? [{ len: 0.11 }, { len: 0.11 }] // volume up/down
          : [{ len: 0.16 }]; // power
        const gap = 0.05;
        let cursorY = h / 2 - metrics.cornerRadius - 0.12; // top of first button
        const stackLen = buttonSpecs.reduce((sum, s) => sum + s.len, 0) + gap * (buttonSpecs.length - 1);
        if (cursorY - stackLen > -h / 2 + metrics.cornerRadius) {
          for (const spec of buttonSpecs) {
            const geo = track(new THREE.CapsuleGeometry(t * 0.16, spec.len, 8, 16));
            const mesh = new THREE.Mesh(geo, buttonMat);
            mesh.position.set(sideSign * (w / 2 + t * 0.02), cursorY - spec.len / 2, 0);
            group.add(mesh);
            cursorY -= spec.len + gap;
          }
        }
      }

      // USB-C slot on the bottom rail — only really visible in the reclined
      // poses where the camera looks down past the bottom edge.
      if (deviceType !== 'desktop') {
        const portMat = track(new THREE.MeshStandardMaterial({ color: 0x121214, metalness: 0.4, roughness: 0.55 }));
        const portGeo = track(new THREE.CapsuleGeometry(t * 0.1, 0.075, 6, 12));
        portGeo.rotateZ(Math.PI / 2); // capsule axis Y -> X, lying along the rail
        const portMesh = new THREE.Mesh(portGeo, portMat);
        portMesh.position.set(0, -h / 2, 0);
        group.add(portMesh);
      }

      updateShot();
    };

    const layoutCamera = (cw: number, ch: number) => {
      const aspect = cw / ch;
      const h = THREE.MathUtils.clamp(poseAngles.bodyAspect ?? ch / cw, 0.3, 4);
      const tanV = Math.tan(THREE.MathUtils.degToRad(CAMERA_FOV / 2));
      const margin = 1.08;
      // Fit the pose-rotated device box exactly: a corner at camera-space
      // (x, y, z) fits iff |y| <= tan(fov/2)·(dist − z) vertically and
      // |x| <= tan(fov/2)·aspect·(dist − z) horizontally — solve for dist.
      const t2 = metrics.thickness / 2;
      const corner = new THREE.Vector3();
      let dist = 0.1;
      for (const sx of [-0.5, 0.5]) {
        for (const sy of [-0.5, 0.5]) {
          for (const sz of [-1, 1]) {
            corner.set(sx, sy * h, sz * t2).applyQuaternion(poseQuat);
            dist = Math.max(
              dist,
              corner.z + (Math.abs(corner.y) * margin) / tanV,
              corner.z + (Math.abs(corner.x) * margin) / (tanV * aspect),
            );
          }
        }
      }
      camera.aspect = aspect;
      camera.near = dist * 0.05;
      camera.far = dist * 10;
      // Slightly above center, like a product shot looking marginally down.
      camera.position.set(0, dist * 0.02, dist);
      camera.lookAt(0, 0, 0);
      camera.updateProjectionMatrix();
    };

    let lastAspect = 0;
    let lastPixelRatio = 0;
    let lastW = 0;
    let lastH = 0;
    // The artboard scales elements with CSS transforms (zoom / display scale
    // factor), which don't change clientWidth. Derive the true on-screen scale
    // so the canvas backing store matches what the user actually sees.
    const effectivePixelRatio = () => {
      const rect = mount.getBoundingClientRect();
      const cssScale = mount.clientWidth > 0 ? rect.width / mount.clientWidth : 1;
      // Target ~2× the pixels actually shown on screen. Browser canvas
      // downscaling is plain bilinear (averages only 4 texels), so a backing
      // store much larger than 2× the displayed size starts skipping pixels and
      // re-introduces jaggies — bigger is NOT smoother. The floor of 1 keeps the
      // bitmap at least layout-sized because PNG export draws the canvas at its
      // layout size regardless of the current zoom. This also bounds memory to
      // roughly what is visible on screen.
      const target = cssScale * (window.devicePixelRatio || 1) * 2;
      return Math.min(Math.max(target, 1), 3);
    };

    // The expensive path: reallocating the drawing buffer and re-extruding the
    // body (~50k triangles + normal welding). Never run this per drag frame.
    const applySize = () => {
      const cw = mount.clientWidth;
      const ch = mount.clientHeight;
      if (cw < 2 || ch < 2) return;
      const pr = effectivePixelRatio();
      if (pr !== lastPixelRatio || cw !== lastW || ch !== lastH) {
        lastPixelRatio = pr;
        lastW = cw;
        lastH = ch;
        renderer.setPixelRatio(pr);
        renderer.setSize(cw, ch, false);
        layoutCamera(cw, ch);
      }
      const aspect = ch / cw;
      // Rebuild geometry only when the element's proportions actually change.
      if (Math.abs(aspect - lastAspect) > 0.005) {
        lastAspect = aspect;
        buildDevice(aspect);
      }
      // setSize() wipes the drawing buffer, so a frame must be presented before
      // returning (the app rescales the artboard right before exporting, and a
      // deferred render would let the export capture a blank canvas).
      render();
    };

    // While the user drags a resize handle, the canvas simply CSS-stretches with
    // the element (cheap); the buffer + geometry snap to crisp once idle.
    let resizeTimer = 0;
    let firstSize = true;
    const handleResize = () => {
      if (firstSize) {
        firstSize = false;
        applySize();
        return;
      }
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(applySize, 110);
    };

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(mount);
    handleResize();
    // ResizeObserver can't see ancestor transform changes (artboard zoom), so
    // cheaply poll the effective scale and re-render sharper when it changes.
    const scaleWatch = window.setInterval(() => {
      if (Math.abs(effectivePixelRatio() - lastPixelRatio) > 0.1) applySize();
    }, 800);

    // PNG export draws the canvas 1:1 into the output (no browser downscale),
    // which exposes specular aliasing on the metal rail that the on-screen
    // downscale normally averages away. While an export is in flight, render at
    // 2x layout pixels so the capture gets the same ~2x supersampling the
    // on-screen path targets, then restore the regular buffer.
    const handleExportPhase = (e: Event) => {
      const phase = (e as CustomEvent).detail?.phase;
      const cw = mount.clientWidth;
      const ch = mount.clientHeight;
      if (phase === 'begin') {
        if (cw < 2 || ch < 2) return;
        renderer.setPixelRatio(Math.max(2, lastPixelRatio));
        renderer.setSize(cw, ch, false);
        layoutCamera(cw, ch);
        render();
      } else {
        lastPixelRatio = 0; // force applySize to rebuild the on-screen buffer
        applySize();
      }
    };
    window.addEventListener('artboard:export', handleExportPhase);

    if (screenshotSrc) {
      const img = new window.Image();
      img.onload = () => {
        if (disposed) return;
        textureImage = img;
        texture = new THREE.Texture(img);
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
        texture.needsUpdate = true;
        updateShot();
        render();
      };
      img.src = withBasePath(screenshotSrc);
    }

    return () => {
      disposed = true;
      window.removeEventListener('artboard:export', handleExportPhase);
      window.clearInterval(scaleWatch);
      window.clearTimeout(resizeTimer);
      resizeObserver.disconnect();
      for (const d of disposables.splice(0)) d.dispose();
      if (shotMesh) {
        shotMesh.geometry.dispose();
        (shotMesh.material as THREE.Material).dispose();
      }
      texture?.dispose();
      envTexture.dispose();
      pmrem.dispose();
      renderer.dispose();
      // dispose() frees GPU resources but the browser's WebGL context slot is
      // only released when the canvas is GC'd. Force-lose it so a batch swap of
      // N 3D devices can't transiently hold 2N context slots and evict other
      // live canvases ("oldest context will be lost").
      renderer.forceContextLoss();
      mount.removeChild(canvas);
    };
  }, [deviceType, side, screenshotSrc, objectFit, pose, frameColor]);

  return <div ref={mountRef} style={{ width: '100%', height: '100%', pointerEvents: 'none' }} />;
}
