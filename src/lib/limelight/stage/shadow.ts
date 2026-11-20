/**
 * The soft shadow under the actors.
 *
 * A camera under the floor looks straight up and draws every device into a
 * small target, darker the closer each part is to the floor; two blur passes
 * soften it, and a plane on the floor shows the result over the backdrop. The
 * plane draws nothing but the shadow, so there is never a floor edge to see,
 * whatever the camera does.
 *
 * Only the casting layer is drawn (devices put their meshes on it), and the
 * shadow is drawn again only when something that moves it has changed, so a
 * still scene costs nothing per frame. Drawn every frame of a moving scene it
 * is three passes over 512 x 512 pixels.
 */

import * as THREE from 'three';

/** The layer devices cast shadows on. */
export const SHADOW_LAYER = 1;
/** How far above the floor a part can be and still darken it, in centimetres. */
const REACH = 22;
const SIZE = 512;

const DEPTH_VERTEX = /* glsl */ `
void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const DEPTH_FRAGMENT = /* glsl */ `
void main() {
  // An orthographic camera's depth is linear: 0 on the floor, 1 at the top of its reach.
  float near = 1.0 - gl_FragCoord.z;
  gl_FragColor = vec4(0.0, 0.0, 0.0, near * near);
}
`;

const BLUR_VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const BLUR_FRAGMENT = /* glsl */ `
uniform sampler2D source;
uniform vec2 step;
varying vec2 vUv;
void main() {
  vec4 sum = vec4(0.0);
  sum += texture2D(source, vUv - 4.0 * step) * 0.051;
  sum += texture2D(source, vUv - 3.0 * step) * 0.0918;
  sum += texture2D(source, vUv - 2.0 * step) * 0.12245;
  sum += texture2D(source, vUv - 1.0 * step) * 0.1531;
  sum += texture2D(source, vUv) * 0.1633;
  sum += texture2D(source, vUv + 1.0 * step) * 0.1531;
  sum += texture2D(source, vUv + 2.0 * step) * 0.12245;
  sum += texture2D(source, vUv + 3.0 * step) * 0.0918;
  sum += texture2D(source, vUv + 4.0 * step) * 0.051;
  gl_FragColor = sum;
}
`;

export class ContactShadow {
  /** The plane on the floor, for the stage to add to its scene. */
  readonly plane: THREE.Mesh;
  private readonly camera: THREE.OrthographicCamera;
  private readonly target: THREE.WebGLRenderTarget;
  private readonly blurTarget: THREE.WebGLRenderTarget;
  private readonly depthMaterial: THREE.ShaderMaterial;
  private readonly blurMaterial: THREE.ShaderMaterial;
  private readonly blurQuad: THREE.Mesh;
  private readonly blurScene = new THREE.Scene();
  private readonly passScene = new THREE.Scene();
  private readonly blurCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private lastKey = '';

  constructor() {
    const options = { type: THREE.HalfFloatType, depthBuffer: true } as const;
    this.target = new THREE.WebGLRenderTarget(SIZE, SIZE, options);
    this.blurTarget = new THREE.WebGLRenderTarget(SIZE, SIZE, { type: THREE.HalfFloatType, depthBuffer: false });
    this.camera = new THREE.OrthographicCamera(-30, 30, 30, -30, 0, REACH);
    // Looking up from the floor: +x of the stage to the right of the picture
    // and +z at its top. Seen from below the floor is mirrored, so the plane
    // shows the picture upside down (the texture's flip below) to put each
    // shadow under its device.
    this.camera.position.set(0, 0, 0);
    this.camera.up.set(0, 0, 1);
    this.camera.lookAt(0, 1, 0);
    this.camera.layers.set(SHADOW_LAYER);
    this.depthMaterial = new THREE.ShaderMaterial({ vertexShader: DEPTH_VERTEX, fragmentShader: DEPTH_FRAGMENT, side: THREE.DoubleSide });
    this.blurMaterial = new THREE.ShaderMaterial({
      vertexShader: BLUR_VERTEX,
      fragmentShader: BLUR_FRAGMENT,
      uniforms: { source: { value: null }, step: { value: new THREE.Vector2() } },
      depthTest: false,
      depthWrite: false,
    });
    this.blurQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.blurMaterial);
    this.blurQuad.frustumCulled = false;
    this.blurScene.add(this.blurQuad);
    this.passScene.overrideMaterial = this.depthMaterial;
    this.target.texture.repeat.set(1, -1);
    this.target.texture.offset.set(0, 1);
    // Writes the floor's depth, so depth of field blurs the shadow as far as
    // the floor is from the focus, not as far as the backdrop.
    const material = new THREE.MeshBasicMaterial({
      map: this.target.texture,
      transparent: true,
      depthWrite: true,
      toneMapped: false,
      color: 0x000000,
    });
    // The texture holds black with the shadow in its alpha: the plane darkens what is behind it.
    material.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', 'diffuseColor.a *= texture2D( map, vMapUv ).a;');
    };
    this.plane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
    this.plane.rotation.x = -Math.PI / 2;
    this.plane.position.y = 0.02;
    this.plane.renderOrder = -10;
  }

  /** Shows the shadow at this strength; 0 hides it. */
  setStrength(strength: number) {
    const material = this.plane.material as THREE.MeshBasicMaterial;
    material.opacity = Math.min(1, Math.max(0, strength)) * 0.9;
    this.plane.visible = strength > 0.001;
  }

  /**
   * Draws the shadow again if `key` (what moved it) changed. `casters` is
   * the group holding the actors; it is lent to a pass scene for the draw and
   * handed back. `bounds` is the floor area to cover.
   */
  update(renderer: THREE.WebGLRenderer, casters: THREE.Object3D, bounds: { x: number; z: number; half: number }, key: string) {
    if (!this.plane.visible || key === this.lastKey) return;
    this.lastKey = key;
    const half = Math.max(8, bounds.half);
    const camera = this.camera;
    camera.left = -half;
    camera.right = half;
    camera.top = half;
    camera.bottom = -half;
    camera.position.set(bounds.x, 0, bounds.z);
    camera.lookAt(bounds.x, 1, bounds.z);
    camera.updateProjectionMatrix();
    this.plane.position.set(bounds.x, 0.02, bounds.z);
    this.plane.scale.set(2 * half, 2 * half, 1);

    const parent = casters.parent;
    const previousTarget = renderer.getRenderTarget();
    const clearColor = renderer.getClearColor(new THREE.Color());
    const clearAlpha = renderer.getClearAlpha();
    const autoClear = renderer.autoClear;
    try {
      this.passScene.add(casters);
      renderer.setRenderTarget(this.target);
      renderer.setClearColor(0x000000, 0);
      renderer.autoClear = true;
      renderer.clear();
      renderer.render(this.passScene, camera);
    } finally {
      // Always handed back: left in the pass scene, the devices would vanish from the stage.
      if (parent) parent.add(casters);
    }
    try {
      // Wider blur for a shadow that covers a larger floor, so it looks the same at any spread.
      const texel = 1 / SIZE;
      const spread = Math.min(3, 30 / half) * 1.2;
      this.blur(renderer, this.target, this.blurTarget, texel * spread, 0);
      this.blur(renderer, this.blurTarget, this.target, 0, texel * spread);
      this.blur(renderer, this.target, this.blurTarget, texel * spread * 0.45, 0);
      this.blur(renderer, this.blurTarget, this.target, 0, texel * spread * 0.45);
    } finally {
      renderer.setRenderTarget(previousTarget);
      renderer.setClearColor(clearColor, clearAlpha);
      renderer.autoClear = autoClear;
    }
  }

  /** Forgets what was drawn, so the next update draws again. */
  invalidate() {
    this.lastKey = '';
  }

  private blur(renderer: THREE.WebGLRenderer, from: THREE.WebGLRenderTarget, to: THREE.WebGLRenderTarget, x: number, y: number) {
    this.blurMaterial.uniforms.source.value = from.texture;
    (this.blurMaterial.uniforms.step.value as THREE.Vector2).set(x, y);
    renderer.setRenderTarget(to);
    renderer.render(this.blurScene, this.blurCamera);
  }

  dispose() {
    this.target.dispose();
    this.blurTarget.dispose();
    this.depthMaterial.dispose();
    this.blurMaterial.dispose();
    this.blurQuad.geometry.dispose();
    this.plane.geometry.dispose();
    (this.plane.material as THREE.Material).dispose();
  }
}
