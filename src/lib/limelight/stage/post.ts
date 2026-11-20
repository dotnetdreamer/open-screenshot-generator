/**
 * The last pass of a Limelight frame: depth of field, a vignette, film grain,
 * and the step from linear light to the sRGB the screen shows.
 *
 * The scene is drawn first into a half float target with four samples per
 * pixel and a depth texture. That target is flagged `isXRRenderTarget`, which
 * is how three.js tells a material it is drawing the final picture: each
 * material then applies its own tone mapping into it, as it would on the
 * screen, so a device's screen (toneMapped false) keeps its exact colours
 * while metal and glass are tone mapped. Its colour space is linear, so
 * nothing is encoded yet and the blur below mixes light, not gamma values,
 * which is what makes a bright highlight bloom into a disc the way it does
 * through a real lens. three.js itself sets the same flag on the targets it
 * renders for WebXR, and only reads it to pick tone mapping, the output colour
 * space and the target's format.
 *
 * The blur is a gather in one pass, after Dennis Gustafsson's "Bokeh depth of
 * field in a single pass": each pixel looks at points on a golden angle spiral
 * and takes the ones whose own blur reaches it. How far a point blurs is the
 * thin lens circle of confusion:
 *
 *   c = (f^2 / N) * |d - s| / (d * (s - f))
 *
 * with focal length f, f-number N, focus distance s and the point's distance
 * d, measured on the film and scaled to pixels by the film's height. So a
 * 70 mm lens at f/2.8 focused 40 cm away blurs the backdrop the way that lens
 * would, and the same scene drawn bigger blurs by the same share of the
 * picture.
 */

import * as THREE from 'three';

const VERTEX = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
precision highp float;
uniform sampler2D colorMap;
uniform sampler2D depthMap;
uniform vec2 resolution;
uniform float cameraNear;
uniform float cameraFar;
uniform float focusDistance;
uniform float focalLength;
uniform float fNumber;
uniform float filmHeight;
uniform float maxRadius;
uniform float radiusStep;
uniform float depthOfField;
uniform float vignette;
uniform float grain;
uniform float seed;
varying vec2 vUv;

const float GOLDEN_ANGLE = 2.39996323;

float viewDepth(vec2 uv) {
  float z = texture2D(depthMap, uv).r * 2.0 - 1.0;
  return (2.0 * cameraNear * cameraFar) / (cameraFar + cameraNear - z * (cameraFar - cameraNear));
}

// Radius of the circle of confusion in pixels, at most maxRadius.
float blurRadius(float d) {
  float s = max(focusDistance, focalLength * 1.01);
  float c = (focalLength * focalLength / fNumber) * abs(d - s) / (d * (s - focalLength));
  return min(0.5 * c / filmHeight * resolution.y, maxRadius);
}

vec3 toSrgb(vec3 c) {
  c = max(c, 0.0);
  vec3 low = c * 12.92;
  vec3 high = 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055;
  return mix(low, high, step(vec3(0.0031308), c));
}

float noise(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

// A NaN or an infinity in a pixel (a highlight a software renderer
// overflowed, as Chromium's does without a GPU) would spread over the whole
// circle of the blur as a black disc: such a sample counts as nothing.
bool usable(vec3 c) {
  return !(any(isnan(c)) || any(isinf(c)));
}

// Without a blur, an unusable pixel takes the colour of the nearest usable
// one round it; a patch wider than that stays black.
vec3 nearestUsable(vec2 uv, vec2 pixel) {
  for (int r = 1; r <= 3; r++) {
    for (int k = 0; k < 8; k++) {
      float a = float(k) * 0.78539816;
      vec3 c = texture2D(colorMap, uv + vec2(cos(a), sin(a)) * pixel * float(r)).rgb;
      if (usable(c)) return c;
    }
  }
  return vec3(0.0);
}

void main() {
  vec2 pixel = 1.0 / resolution;
  vec3 color = texture2D(colorMap, vUv).rgb;
  bool own = usable(color);
  if (!own) color = nearestUsable(vUv, pixel);
  if (depthOfField > 0.5) {
    float centerDepth = viewDepth(vUv);
    float centerRadius = blurRadius(centerDepth);
    // The blur is made of usable samples only.
    vec3 sum = own ? color : vec3(0.0);
    float count = own ? 1.0 : 0.0;
    float radius = radiusStep;
    float angle = 0.0;
    for (int i = 0; i < 400; i++) {
      if (radius >= maxRadius) break;
      vec2 uv = vUv + vec2(cos(angle), sin(angle)) * pixel * radius;
      vec3 sampleColor = texture2D(colorMap, uv).rgb;
      if (!usable(sampleColor)) {
        radius += radiusStep / radius;
        angle += GOLDEN_ANGLE;
        continue;
      }
      float sampleDepth = viewDepth(uv);
      float sampleRadius = blurRadius(sampleDepth);
      // Something behind this pixel can't blur over it by more than this pixel's own blur.
      if (sampleDepth > centerDepth) sampleRadius = clamp(sampleRadius, 0.0, centerRadius * 2.0);
      float weight = smoothstep(radius - 0.5, radius + 0.5, sampleRadius);
      sum += count > 0.0 ? mix(sum / count, sampleColor, weight) : sampleColor;
      count += 1.0;
      radius += radiusStep / radius;
      angle += GOLDEN_ANGLE;
    }
    if (count > 0.0) color = sum / count;
  }
  if (vignette > 0.0) {
    vec2 p = vUv - 0.5;
    p.x *= resolution.x / resolution.y;
    float fall = smoothstep(0.25, 0.95, length(p) * 1.25);
    color *= 1.0 - vignette * 0.55 * fall;
  }
  vec3 srgb = toSrgb(color);
  if (grain > 0.0) {
    float n = noise(gl_FragCoord.xy + seed * 97.0) - 0.5;
    srgb += grain * 0.09 * n;
  }
  // Half a step of noise hides banding in dark gradients.
  srgb += (noise(gl_FragCoord.xy * 1.37 + 11.0) - 0.5) / 255.0;
  gl_FragColor = vec4(srgb, 1.0);
}
`;

export interface PostSettings {
  depthOfField: boolean;
  /** Centimetres. */
  focusDistance: number;
  /** Millimetres, as on the camera state. */
  lens: number;
  fNumber: number;
  /** The film's height in millimetres for this picture's shape. */
  filmHeight: number;
  vignette: number;
  grain: number;
  /** Changes the grain from frame to frame. */
  seed: number;
  /** More points per pixel for a final frame; fewer while something moves. */
  quality: 'draft' | 'final';
}

/** The largest blur, as a share of the picture's height. */
const MAX_RADIUS_SHARE = 0.02;

export class PostPass {
  private target: THREE.WebGLRenderTarget | null = null;
  private readonly material: THREE.ShaderMaterial;
  private readonly quad: THREE.Mesh;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  constructor() {
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        colorMap: { value: null },
        depthMap: { value: null },
        resolution: { value: new THREE.Vector2(1, 1) },
        cameraNear: { value: 1 },
        cameraFar: { value: 1000 },
        focusDistance: { value: 40 },
        focalLength: { value: 7 },
        fNumber: { value: 2.8 },
        filmHeight: { value: 2.4 },
        maxRadius: { value: 20 },
        radiusStep: { value: 1 },
        depthOfField: { value: 1 },
        vignette: { value: 0 },
        grain: { value: 0 },
        seed: { value: 0 },
      },
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    this.quad = new THREE.Mesh(geometry, this.material);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
  }

  /** Whether this browser can draw into a half float target, which the pass needs. */
  static supported(renderer: THREE.WebGLRenderer): boolean {
    return renderer.capabilities.isWebGL2 !== false && renderer.extensions.has('EXT_color_buffer_float');
  }

  private targetFor(width: number, height: number): THREE.WebGLRenderTarget {
    if (this.target && this.target.width === width && this.target.height === height) return this.target;
    this.target?.dispose();
    const depthTexture = new THREE.DepthTexture(width, height);
    depthTexture.type = THREE.UnsignedIntType;
    const target = new THREE.WebGLRenderTarget(width, height, {
      type: THREE.HalfFloatType,
      samples: 4,
      depthBuffer: true,
      depthTexture,
    });
    target.texture.colorSpace = THREE.LinearSRGBColorSpace;
    // See the header: makes materials tone map into this target as onto the screen.
    (target as THREE.WebGLRenderTarget & { isXRRenderTarget: boolean }).isXRRenderTarget = true;
    this.target = target;
    return target;
  }

  /**
   * Draws `scene` through `camera` into the pass's target, then the finished
   * picture into `output` (null for the canvas). Sizes are in pixels.
   */
  render(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    width: number,
    height: number,
    settings: PostSettings,
    output: THREE.WebGLRenderTarget | null
  ) {
    const target = this.targetFor(width, height);
    renderer.setRenderTarget(target);
    renderer.clear();
    renderer.render(scene, camera);

    const u = this.material.uniforms;
    u.colorMap.value = target.texture;
    u.depthMap.value = target.depthTexture;
    (u.resolution.value as THREE.Vector2).set(width, height);
    u.cameraNear.value = camera.near;
    u.cameraFar.value = camera.far;
    u.focusDistance.value = settings.focusDistance;
    u.focalLength.value = settings.lens / 10;
    u.fNumber.value = settings.fNumber;
    u.filmHeight.value = settings.filmHeight / 10;
    const maxRadius = Math.max(2, MAX_RADIUS_SHARE * height);
    u.maxRadius.value = maxRadius;
    // About radius^2 / (2 step) points: 40 while something moves, 150 for a finished frame.
    const points = settings.quality === 'final' ? 150 : 40;
    u.radiusStep.value = Math.max(0.5, (maxRadius * maxRadius) / (2 * points));
    u.depthOfField.value = settings.depthOfField ? 1 : 0;
    u.vignette.value = settings.vignette;
    u.grain.value = settings.grain;
    u.seed.value = settings.seed;
    renderer.setRenderTarget(output);
    renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.target?.dispose();
    this.target = null;
    this.material.dispose();
    this.quad.geometry.dispose();
  }
}
