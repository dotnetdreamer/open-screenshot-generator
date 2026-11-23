// The image pipeline: the scene rendered at several moments inside the shutter
// and averaged (camera motion blur), then bloom on the brightest points, then
// the grade (vignette, grain, a little halation), then tone mapping to sRGB.
import * as THREE from "../vendor/three.bundle.js";

class AccumPass extends THREE.Pass {
  constructor(width, height, renderSample) {
    super();
    this.renderSample = renderSample; // (k, n, target) => renders sample k of n into target
    this.samples = 1;
    this.rt = new THREE.WebGLRenderTarget(width, height, { type: THREE.HalfFloatType, samples: 4 });
    // the last sample's depth, for the depth of field on the wide shot and the end card
    this.rt.depthTexture = new THREE.DepthTexture(width, height);
    this.rt.depthTexture.type = THREE.UnsignedIntType;
    this.quad = new THREE.FullScreenQuad(
      new THREE.ShaderMaterial({
        uniforms: { tSample: { value: null }, weight: { value: 1 } },
        vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }",
        fragmentShader:
          "uniform sampler2D tSample; uniform float weight; varying vec2 vUv; void main(){ gl_FragColor = vec4(texture2D(tSample, vUv).rgb * weight, 1.0); }",
        blending: THREE.AdditiveBlending,
        depthTest: false,
        depthWrite: false,
      }),
    );
    this.needsSwap = true;
  }
  setSize(w, h) {
    this.rt.setSize(w, h);
  }
  render(renderer, writeBuffer) {
    // Every sample goes through the multisampled target, so edges are smooth even when n is 1.
    const n = Math.max(1, this.samples | 0);
    renderer.setRenderTarget(writeBuffer);
    renderer.setClearColor(0x000000, 1);
    renderer.clear();
    for (let k = 0; k < n; k++) {
      this.renderSample(k, n, this.rt);
      this.quad.material.uniforms.tSample.value = this.rt.texture;
      this.quad.material.uniforms.weight.value = 1 / n;
      renderer.setRenderTarget(writeBuffer);
      const ac = renderer.autoClear;
      renderer.autoClear = false;
      this.quad.render(renderer);
      renderer.autoClear = ac;
    }
  }
}

const GRADE = {
  uniforms: {
    tDiffuse: { value: null },
    frame: { value: 0 },
    vignette: { value: 0.34 },
    grain: { value: 0.035 },
    resolution: { value: new THREE.Vector2(1440, 1800) },
    lift: { value: new THREE.Vector3(0.006, 0.004, 0.003) },
  },
  vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float frame;
    uniform float vignette;
    uniform float grain;
    uniform vec2 resolution;
    uniform vec3 lift;
    varying vec2 vUv;
    float hash(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.yzx + 33.33); return fract((p.x + p.y) * p.z); }
    void main() {
      // A hair of lateral colour fringing towards the edges, like a real lens.
      vec2 d = vUv - 0.5;
      float r2 = dot(d, d);
      vec2 off = d * r2 * 0.006;
      vec3 c;
      c.r = texture2D(tDiffuse, vUv + off).r;
      c.g = texture2D(tDiffuse, vUv).g;
      c.b = texture2D(tDiffuse, vUv - off).b;
      c += lift;
      float v = 1.0 - vignette * smoothstep(0.12, 0.62, r2 * 1.9);
      c *= v;
      float n = hash(vec3(gl_FragCoord.xy, frame)) - 0.5;
      float lum = dot(c, vec3(0.299, 0.587, 0.114));
      c += n * grain * (0.35 + 0.65 * smoothstep(0.0, 0.6, lum));
      gl_FragColor = vec4(max(c, 0.0), 1.0);
    }`,
};

/**
 * Depth of field by gathering: each pixel takes the taps whose own blur circle
 * reaches it, so a sharp slate does not smear into the soft screens behind it.
 */
const DOF = {
  uniforms: {
    tDiffuse: { value: null },
    tDepth: { value: null },
    near: { value: 0.05 },
    far: { value: 90 },
    focus: { value: 3 },
    aperture: { value: 0 },
    maxBlur: { value: 18 },
    texel: { value: new THREE.Vector2(1 / 1440, 1 / 1800) },
  },
  vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
  fragmentShader: /* glsl */ `
    #include <packing>
    uniform sampler2D tDiffuse;
    uniform sampler2D tDepth;
    uniform float near, far, focus, aperture, maxBlur;
    uniform vec2 texel;
    varying vec2 vUv;
    float coc(vec2 uv) {
      float z = -perspectiveDepthToViewZ(texture2D(tDepth, uv).x, near, far);
      return clamp(abs(z - focus) / max(z, 0.001) * aperture, 0.0, 1.0) * maxBlur;
    }
    void main() {
      vec3 c0 = texture2D(tDiffuse, vUv).rgb;
      if (aperture <= 0.0) { gl_FragColor = vec4(c0, 1.0); return; }
      float r0 = coc(vUv);
      vec3 acc = c0;
      float ws = 1.0;
      const int TAPS = 40;
      for (int i = 0; i < TAPS; i++) {
        float fi = float(i) + 0.5;
        float d = sqrt(fi / float(TAPS)) * maxBlur;
        float an = fi * 2.39996;
        vec2 uv = vUv + vec2(cos(an), sin(an)) * d * texel;
        float rs = coc(uv);
        float w = clamp(min(rs, r0 + 2.0) - d + 1.0, 0.0, 1.0);
        acc += texture2D(tDiffuse, uv).rgb * w;
        ws += w;
      }
      gl_FragColor = vec4(acc / ws, 1.0);
    }`,
};

export function buildPost(renderer, width, height, renderSample) {
  const target = new THREE.WebGLRenderTarget(width, height, { type: THREE.HalfFloatType, samples: 0 });
  const composer = new THREE.EffectComposer(renderer, target);
  composer.setPixelRatio(1);
  composer.setSize(width, height);
  const accum = new AccumPass(width, height, renderSample);
  composer.addPass(accum);
  // One NaN pixel turns the whole frame black through the bloom's blur: scrub them first.
  const sanitize = new THREE.ShaderPass({
    uniforms: { tDiffuse: { value: null } },
    vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader:
      "uniform sampler2D tDiffuse; varying vec2 vUv; void main(){ vec3 c = texture2D(tDiffuse, vUv).rgb; if (!(c.r == c.r) || !(c.g == c.g) || !(c.b == c.b)) c = vec3(0.0); gl_FragColor = vec4(clamp(c, 0.0, 48.0), 1.0); }",
  });
  composer.addPass(sanitize);
  const dof = new THREE.ShaderPass(DOF);
  dof.uniforms.tDepth.value = accum.rt.depthTexture;
  dof.uniforms.texel.value.set(1 / width, 1 / height);
  dof.uniforms.maxBlur.value = 18 * (width / 1440);
  composer.addPass(dof);
  // Only the bulbs and the hottest highlights go over the threshold; screen text never does.
  const bloom = new THREE.UnrealBloomPass(new THREE.Vector2(width, height), 0.62, 0.55, 1.35);
  composer.addPass(bloom);
  const grade = new THREE.ShaderPass(GRADE);
  grade.uniforms.resolution.value.set(width, height);
  composer.addPass(grade);
  composer.addPass(new THREE.OutputPass());
  return { composer, accum, bloom, grade, dof };
}
