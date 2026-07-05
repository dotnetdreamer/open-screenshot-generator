"use client";
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { toCreasedNormals } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { DeviceType } from '@/types/artboard';

interface Device3DRendererProps {
  deviceType: DeviceType;
  side: 'left' | 'right';
  screenshotSrc?: string;
  objectFit?: 'contain' | 'cover' | 'fill';
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
  'iphone-14': { cornerRadius: 0.13, screenRadius: 0.10, bezel: 0.03, thickness: 0.08, notch: 'notch' },
  'iphone-13': { cornerRadius: 0.12, screenRadius: 0.09, bezel: 0.03, thickness: 0.08, notch: 'notch' },
  'iphone-x': { cornerRadius: 0.12, screenRadius: 0.09, bezel: 0.03, thickness: 0.08, notch: 'notch' },
  'iphone': { cornerRadius: 0.10, screenRadius: 0.08, bezel: 0.035, thickness: 0.08, notch: 'none' },
  'android-bar': { cornerRadius: 0.06, screenRadius: 0.04, bezel: 0.03, thickness: 0.075, notch: 'none' },
  'android-notch': { cornerRadius: 0.06, screenRadius: 0.04, bezel: 0.03, thickness: 0.075, notch: 'notch' },
  'android-punch-hole': { cornerRadius: 0.06, screenRadius: 0.04, bezel: 0.03, thickness: 0.075, notch: 'punch' },
  'tablet': { cornerRadius: 0.05, screenRadius: 0.035, bezel: 0.05, thickness: 0.045, notch: 'none' },
  'desktop': { cornerRadius: 0.02, screenRadius: 0.012, bezel: 0.02, thickness: 0.03, notch: 'none' },
};

const ROTATION_DEG = 24;
const CAMERA_FOV = 20;

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
export function Device3DRenderer({ deviceType, side, screenshotSrc, objectFit = 'cover' }: Device3DRendererProps) {
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
    const envTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
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
    group.rotation.y = THREE.MathUtils.degToRad(ROTATION_DEG) * -sideSign;
    scene.add(group);

    const metrics = DEVICE_METRICS[deviceType] ?? DEFAULT_METRICS;
    const disposables: Array<{ dispose(): void }> = [];
    let texture: THREE.Texture | null = null;
    let textureImage: HTMLImageElement | null = null;
    let shotMesh: THREE.Mesh | null = null;
    let screenSize = { w: 0, h: 0, radius: 0, z: 0 };
    let disposed = false;

    let raf = 0;
    const requestRender = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => renderer.render(scene, camera));
    };

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
      const h = THREE.MathUtils.clamp(aspect, 0.3, 4);
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
      // Material 0 = front/back caps (black glass), 1 = extruded rail (titanium).
      const capMat = track(new THREE.MeshStandardMaterial({ color: 0x0b0b0d, metalness: 0.4, roughness: 0.3 }));
      // Brushed rather than polished: a rougher rail with damped reflections
      // avoids specular sparkle on the smooth-shaded bevel curvature.
      const railMat = track(new THREE.MeshStandardMaterial({ color: 0x8a8a90, metalness: 1.0, roughness: 0.42, envMapIntensity: 0.85 }));
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
      if (metrics.notch !== 'none' || deviceType === 'iphone' || deviceType === 'tablet') {
        const buttonMat = track(new THREE.MeshStandardMaterial({ color: 0xb8b8be, metalness: 0.9, roughness: 0.45 }));
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

      updateShot();
    };

    const layoutCamera = (cw: number, ch: number) => {
      const aspect = cw / ch;
      const h = THREE.MathUtils.clamp(ch / cw, 0.3, 4);
      const halfFov = THREE.MathUtils.degToRad(CAMERA_FOV / 2);
      const margin = 1.1;
      const angle = THREE.MathUtils.degToRad(ROTATION_DEG);
      const rotatedW = Math.cos(angle) + metrics.thickness * Math.sin(angle);
      const distH = (h / 2) * margin / Math.tan(halfFov);
      const distW = (rotatedW / 2) * margin / (Math.tan(halfFov) * aspect);
      const dist = Math.max(distH, distW);
      camera.aspect = aspect;
      camera.near = dist * 0.1;
      camera.far = dist * 10;
      // Slightly above center, like a product shot looking marginally down.
      camera.position.set(0, dist * 0.02, dist);
      camera.lookAt(0, 0, 0);
      camera.updateProjectionMatrix();
    };

    let lastAspect = 0;
    let lastPixelRatio = 0;
    // The artboard scales elements with CSS transforms (zoom / display scale
    // factor), which don't change clientWidth. Derive the true on-screen scale
    // so the canvas backing store matches what the user actually sees.
    const effectivePixelRatio = () => {
      const rect = mount.getBoundingClientRect();
      const cssScale = mount.clientWidth > 0 ? rect.width / mount.clientWidth : 1;
      // Floor of 2 supersamples even on low-DPI displays / software WebGL (where
      // MSAA may be unavailable), so near-horizontal edges get downsampled smooth
      // instead of showing stair-stepping on the top edge and chin.
      return Math.min(Math.max((window.devicePixelRatio || 1) * Math.max(cssScale, 1), 2), 3);
    };
    const handleResize = () => {
      const cw = mount.clientWidth;
      const ch = mount.clientHeight;
      if (cw < 2 || ch < 2) return;
      const pr = effectivePixelRatio();
      if (pr !== lastPixelRatio) {
        lastPixelRatio = pr;
        renderer.setPixelRatio(pr);
      }
      renderer.setSize(cw, ch, false);
      layoutCamera(cw, ch);
      const aspect = ch / cw;
      // Rebuild geometry only when the element's proportions actually change.
      if (Math.abs(aspect - lastAspect) > 0.005) {
        lastAspect = aspect;
        buildDevice(aspect);
      }
      requestRender();
    };

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(mount);
    handleResize();
    // ResizeObserver can't see ancestor transform changes (artboard zoom), so
    // cheaply poll the effective scale and re-render sharper when it changes.
    const scaleWatch = window.setInterval(() => {
      if (Math.abs(effectivePixelRatio() - lastPixelRatio) > 0.1) handleResize();
    }, 800);

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
        requestRender();
      };
      img.src = screenshotSrc;
    }

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      window.clearInterval(scaleWatch);
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
      mount.removeChild(canvas);
    };
  }, [deviceType, side, screenshotSrc, objectFit]);

  return <div ref={mountRef} style={{ width: '100%', height: '100%', pointerEvents: 'none' }} />;
}
