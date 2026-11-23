// Everything the film imports from three, as one local ES module (renders never fetch).
// Built by scripts/build-vendor.mjs into assets/vendor/three.bundle.js.
export * from "three";
export { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
export { Reflector } from "three/addons/objects/Reflector.js";
export { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
export { RenderPass } from "three/addons/postprocessing/RenderPass.js";
export { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
export { OutputPass } from "three/addons/postprocessing/OutputPass.js";
export { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
export { Pass, FullScreenQuad } from "three/addons/postprocessing/Pass.js";
export { RectAreaLightUniformsLib } from "three/addons/lights/RectAreaLightUniformsLib.js";
export { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
export { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
