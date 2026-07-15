/* ============================================================
   Open Screenshot Generator marketing site
   Three.js scene + GSAP ScrollTrigger choreography.

   Structure:
   - corridor  : hero gallery of real template strips flying past
   - stepCards : pinned three step sequence with real editor shots
   - wall      : pinned horizontal wall of template strips
   - drifters  : transparent 3D device renders floating behind copy

   Everything degrades: no WebGL, no GSAP, or reduced motion all
   fall back to the static DOM images already present in the HTML.
   ============================================================ */

const doc = document.documentElement;
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const STRIPS = [
  "strip-cinevault-stream",
  "strip-breathora-breathing",
  "strip-luxe-glow",
  "strip-coinly-crypto",
  "strip-playverse-games",
  "strip-castique-podcast",
  "strip-connectly-chat",
  "strip-trackio-fitness",
  "strip-nexmind",
  "strip-inquira",
].map((n) => `assets/img/${n}.webp`);

const STEP_SHOTS = [
  "assets/img/step-1-template.webp",
  "assets/img/step-2-upload.webp",
  "assets/img/step-3-export.webp",
];

const DEVICES = [
  { url: "assets/img/device-iphone-floating.webp", x: -0.82, y: 0.1, s: 3.4, sway: 0.10 },
  { url: "assets/img/device-iphone-tilted.webp", x: 0.84, y: -0.25, s: 3.0, sway: -0.08 },
  { url: "assets/img/device-watch.webp", x: 0.78, y: 0.55, s: 1.7, sway: 0.12 },
];

init();

async function init() {
  if (reducedMotion) {
    staticMode();
    return;
  }
  const hasGsap = await waitForGsap(4000);
  if (!hasGsap) {
    staticMode();
    return;
  }
  gsap.registerPlugin(ScrollTrigger);

  let THREE = null;
  try {
    THREE = await import("three");
  } catch (err) {
    console.warn("three.js failed to load, falling back to static images.", err);
  }

  let scene = null;
  if (THREE) {
    try {
      scene = buildScene(THREE);
    } catch (err) {
      console.warn("WebGL unavailable, falling back to static images.", err);
    }
  }

  if (scene) {
    // Remove no-webgl in case the index.html watchdog fired on a slow load.
    doc.classList.remove("no-webgl");
    doc.classList.add("webgl");
  } else {
    doc.classList.add("no-webgl");
  }

  initHeader();
  initHeroIntro();
  initReveals();
  initStepsDomSync(scene);
  if (scene) {
    await scene.ready;
    if (scene.layoutSteps) scene.layoutSteps();
    if (scene.layoutWall) scene.layoutWall();
    initCorridorScroll(scene);
    initStepsScroll(scene);
    initWallScroll(scene);
    initDrifterScroll(scene);
  }
  ScrollTrigger.refresh();
}

function staticMode() {
  doc.classList.add("no-webgl", "static");
}

function waitForGsap(timeoutMs) {
  return new Promise((resolve) => {
    const t0 = performance.now();
    (function poll() {
      if (window.gsap && window.ScrollTrigger) return resolve(true);
      if (performance.now() - t0 > timeoutMs) return resolve(false);
      setTimeout(poll, 60);
    })();
  });
}

/* ============================================================
   Scene
   ============================================================ */

function buildScene(THREE) {
  const canvas = document.getElementById("gl");
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    powerPreference: "high-performance",
  });
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x0a1214, 14, 42);

  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 120);
  camera.position.set(0, 0, 10);

  const maxAniso = renderer.capabilities.getMaxAnisotropy();
  const state = {
    THREE,
    renderer,
    scene,
    camera,
    maxAniso,
    corridor: new THREE.Group(),
    stepCards: new THREE.Group(),
    wall: new THREE.Group(),
    drifters: new THREE.Group(),
    stepMeshes: [],
    wallMeshes: [],
    mouse: { x: 0, y: 0 },
    viewSize(dist) {
      const h = 2 * dist * Math.tan((camera.fov * Math.PI) / 360);
      return { w: h * camera.aspect, h };
    },
  };
  // Hidden or parked offscreen until their scroll triggers take over, so
  // nothing flashes over the hero while textures stream in.
  state.drifters.visible = false;
  state.wall.position.x = 9999;
  // Corridor strips render at base * intro * corridorFade, so the intro
  // reveal and the scroll fade never fight over material.opacity.
  state.corridorFade = 1;
  state.texCache = new Map();
  scene.add(state.corridor, state.stepCards, state.wall, state.drifters);
  window.__ABS_DEBUG = state;

  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    if (state.layoutSteps) state.layoutSteps();
    if (state.layoutWall) state.layoutWall();
    if (state.layoutDrifters) state.layoutDrifters();
  }
  window.addEventListener("resize", resize);
  resize();

  window.addEventListener("pointermove", (e) => {
    state.mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
    state.mouse.y = (e.clientY / window.innerHeight) * 2 - 1;
  });

  gsap.ticker.add(() => {
    camera.rotation.y += (state.mouse.x * -0.028 - camera.rotation.y) * 0.06;
    camera.rotation.x += (state.mouse.y * -0.02 - camera.rotation.x) * 0.06;
    state.corridor.children.forEach((m) => {
      m.material.opacity = m.userData.base * m.userData.intro * state.corridorFade;
    });
    renderer.render(scene, camera);
  });

  // Scroll triggers are wired only after every texture resolved, so no
  // tween ever reads a half-initialized layout value.
  state.ready = Promise.all([
    buildCorridor(state),
    buildStepCards(state),
    buildWall(state),
    buildDrifters(state),
  ]);

  return state;
}

/* Draw an image into a rounded rect canvas so plane corners match the site.
   Cached per url so the corridor and the wall share one decode and upload. */
function roundedTexture(state, url, radiusFrac) {
  const key = `${url}@${radiusFrac}`;
  if (state.texCache.has(key)) return state.texCache.get(key);
  const promise = makeRoundedTexture(state, url, radiusFrac);
  state.texCache.set(key, promise);
  return promise;
}

function makeRoundedTexture(state, url, radiusFrac) {
  const { THREE } = state;
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const x = c.getContext("2d");
      const r = Math.round(Math.min(c.width, c.height) * radiusFrac);
      roundRectPath(x, 0, 0, c.width, c.height, r);
      x.clip();
      x.drawImage(img, 0, 0);
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = state.maxAniso;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.generateMipmaps = true;
      resolve(tex);
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function plainTexture(state, url) {
  const { THREE } = state;
  return new Promise((resolve) => {
    new THREE.TextureLoader().load(
      url,
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = state.maxAniso;
        resolve(tex);
      },
      undefined,
      () => resolve(null)
    );
  });
}

/* ============ Corridor (hero) ============ */

async function buildCorridor(state) {
  const { THREE, corridor } = state;
  const textures = await Promise.all(STRIPS.map((u) => roundedTexture(state, u, 0.06)));
  const rand = mulberry32(7);
  // Pull the corridor in on narrow screens so strips stay in view, and dim
  // it there because the planes inevitably pass behind the hero copy.
  const squeeze = Math.max(0.5, Math.min(1, window.innerWidth / window.innerHeight / 1.6));
  const targetOpacity = window.innerWidth < 700 ? 0.5 : 0.92;

  textures.forEach((tex, i) => {
    if (!tex) return;
    const w = 4.8;
    const h = w / 3;
    const geo = new THREE.PlaneGeometry(w, h);
    // depthWrite stays off for every transparent plane in the scene:
    // an invisible or alpha part of a quad must never occlude what is
    // behind it (this bug hid the wall and half a step card).
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: false });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = 1;
    mesh.userData.base = targetOpacity;
    mesh.userData.intro = 0;
    const side = i % 2 === 0 ? -1 : 1;
    // Two height bands that hug the top and bottom of the viewport so the
    // hero headline in the middle stays readable.
    const y = (i % 4 < 2 ? -1.55 : 0.85) + rand() * 0.65;
    mesh.position.set(side * (3.1 + rand() * 1.3) * squeeze, y, -i * 3.6);
    mesh.rotation.y = side * -(0.42 + rand() * 0.22);
    corridor.add(mesh);

    gsap.to(mesh.userData, { intro: 1, duration: 1.2, delay: 0.25 + i * 0.09, ease: "power2.out" });
    gsap.from(mesh.position, {
      z: mesh.position.z - 7,
      duration: 1.6,
      delay: 0.25 + i * 0.09,
      ease: "power3.out",
    });
    gsap.to(mesh.position, {
      y: mesh.position.y + 0.22 + rand() * 0.18,
      duration: 3 + rand() * 2.5,
      yoyo: true,
      repeat: -1,
      ease: "sine.inOut",
      delay: rand() * 2,
    });
  });
}

function initCorridorScroll(state) {
  gsap.to(state.corridor.position, {
    z: 38,
    ease: "none",
    scrollTrigger: {
      trigger: "#hero",
      start: "top top",
      endTrigger: ".steps-pin",
      end: "top top",
      scrub: 1,
      // The strips dissolve over the back half of the ride, so by the time
      // the group is hidden there is nothing left on screen to pop away.
      onUpdate(self) {
        state.corridorFade = 1 - clamp01((self.progress - 0.55) / 0.35);
      },
      onLeave() { state.corridor.visible = false; },
      onEnterBack() { state.corridor.visible = true; },
    },
  });
}

/* ============ Step cards ============ */

async function buildStepCards(state) {
  const { THREE, stepCards } = state;
  const textures = await Promise.all(STEP_SHOTS.map((u) => roundedTexture(state, u, 0.035)));

  textures.forEach((tex, i) => {
    if (!tex) return;
    const geo = new THREE.PlaneGeometry(1, 0.75);
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: false });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = 4;
    mesh.visible = i === 0;
    state.stepMeshes[i] = mesh;
    stepCards.add(mesh);
  });

  /* Project the .steps-stage DOM rect into world space at depth d.
     The two axes are measured differently on purpose, because layoutSteps
     runs at init/resize while the section still sits far down the document,
     not yet pinned.
       Y: measured relative to the pin container (rect.top - pr.top). That
          cancels the document scroll offset and yields the stage's position
          inside the pin, which is where it lands once the pin fixes the
          container to the top of the viewport during its scroll range.
       X: measured straight from the viewport (no pr.left). There is no
          horizontal scroll, and .steps-pin has a max-width plus margin auto,
          so past that cap the container centers; subtracting its left margin
          would drag the card off the stage and under the copy column (the
          "image slides under the text on wide screens" bug). */
  state.layoutSteps = () => {
    const stage = document.querySelector(".steps-stage");
    const pin = document.querySelector(".steps-pin");
    if (!stage || !pin) return;
    const rect = stage.getBoundingClientRect();
    const pr = pin.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const d = 8;
    const view = state.viewSize(d);
    const pxToWorld = view.h / vh;
    const cxPx = rect.left + rect.width / 2 - vw / 2;
    let cyPx = rect.top - pr.top + rect.height / 2 - vh / 2;
    // Keep the card on screen even when the pinned content overflows small viewports.
    cyPx = Math.max(-vh * 0.18, Math.min(vh * 0.3, cyPx));
    stepCards.position.set(cxPx * pxToWorld, -cyPx * pxToWorld, state.camera.position.z - d);
    const wWorld = Math.min(rect.width * pxToWorld, view.w * 0.92);
    state.stepScale = wWorld;
    state.stepMeshes.forEach((m) => {
      if (m) m.scale.setScalar(wWorld);
    });
  };
  state.layoutSteps();
}

function initStepsScroll(state) {
  ScrollTrigger.create({
    trigger: ".steps-pin",
    start: "top top",
    end: "+=260%",
    pin: true,
    scrub: 0.7,
    anticipatePin: 1,
    onUpdate(self) {
      const idx = Math.min(2, Math.floor(self.progress * 2.9999));
      setActiveStep(idx);
      const fill = document.querySelector(".steps-bar-fill");
      if (fill) fill.style.transform = `scaleX(${self.progress})`;
      choreographStepMeshes(state, self.progress);
    },
    onEnter() { fadeStepCards(state, 1); },
    onEnterBack() { fadeStepCards(state, 1); },
    onLeave() { fadeStepCards(state, 0); },
    onLeaveBack() { fadeStepCards(state, 0); },
  });
}

/* Outside the pinned range the camera never moves, so the cards must
   be hidden outright or they would hover over unrelated sections. */
function fadeStepCards(state, target) {
  state.stepsVisible = target;
  if (target === 0) {
    state.stepMeshes.forEach((m) => {
      if (m) m.visible = false;
    });
  }
}

/* Cards swap with a 3D flip and slide as scroll progresses through thirds. */
function choreographStepMeshes(state, progress) {
  const meshes = state.stepMeshes;
  if (!meshes.length) return;
  const p = progress * 3; // 0..3 across three steps
  meshes.forEach((mesh, i) => {
    if (!mesh) return;
    // Each card owns the window [i, i+1). t is its local life: 0 arriving, 1 leaving.
    const t = p - i;
    const visible = t > -0.4 && t < 1.85 && state.stepsVisible !== 0;
    mesh.visible = visible;
    if (!visible) return;
    const s = state.stepScale || 4;
    if (t < 0) {
      // Arriving from the right, rotated away.
      const k = clamp01(1 + t / 0.4);
      mesh.position.x = (1 - k) * s * 1.1;
      mesh.position.z = (1 - k) * -2.5;
      mesh.rotation.y = (1 - k) * -1.0;
      mesh.material.opacity = k * k;
    } else if (t <= 1) {
      // On stage: settle then start tilting away near the end.
      const leave = clamp01((t - 0.72) / 0.28);
      mesh.position.x = leave * -s * 1.5;
      mesh.position.z = leave * -2.0;
      mesh.rotation.y = leave * 1.05;
      mesh.material.opacity = 1 - leave;
      if (i === 0) {
        // The first card has no arrival window before the pin, so it rises
        // in over the first stretch instead of popping to full opacity.
        const enter = clamp01(t / 0.08);
        mesh.position.z += (1 - enter) * -1.6;
        mesh.material.opacity *= enter * enter;
      }
      if (i === meshes.length - 1) {
        // Last card stays put, then fades just before the pin releases so
        // it never freezes over the next section.
        mesh.position.x = 0;
        mesh.position.z = 0;
        mesh.rotation.y = 0;
        mesh.material.opacity = clamp01((1 - t) / 0.08);
      }
      // Gentle idle tilt while on stage.
      mesh.rotation.y += Math.sin(t * Math.PI) * 0.06;
    } else {
      mesh.material.opacity = 0;
    }
  });
}

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

function setActiveStep(idx) {
  document.querySelectorAll(".step-item").forEach((el) => {
    el.classList.toggle("is-active", Number(el.dataset.step) === idx);
  });
  const counter = document.querySelector(".steps-counter");
  if (counter) counter.textContent = `0${idx + 1}`;
}

function initStepsDomSync(scene) {
  if (!scene) return;
  setActiveStep(0);
}

/* ============ Templates wall ============ */

async function buildWall(state) {
  const { THREE, wall } = state;
  const textures = await Promise.all(STRIPS.map((u) => roundedTexture(state, u, 0.06)));

  const BASE_W = 5.4;
  textures.forEach((tex, i) => {
    if (!tex) return;
    const geo = new THREE.PlaneGeometry(BASE_W, BASE_W / 3);
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = 2;
    mesh.rotation.y = (i % 2 === 0 ? -1 : 1) * 0.07;
    state.wallMeshes.push(mesh);
    wall.add(mesh);
  });

  /* Strip size and spacing adapt to the viewport so portrait screens
     see whole cards rather than a zoomed sliver. */
  state.layoutWall = () => {
    const d = 7.5;
    const view = state.viewSize(d);
    const w = Math.min(BASE_W, view.w * 0.86);
    const k = w / BASE_W;
    const gap = w * 0.13;
    state.wallMeshes.forEach((mesh, i) => {
      mesh.scale.setScalar(k);
      mesh.position.set(i * (w + gap), (i % 2 === 0 ? 1 : -1) * 0.42 * k, 0);
    });
    state.wallSpan = state.wallMeshes.length * (w + gap);
    wall.position.z = state.camera.position.z - d;
    // Sit the row slightly below viewport center so the heading stays clear.
    wall.position.y = -view.h * 0.16;
  };
  state.layoutWall();
}

function initWallScroll(state) {
  const d = 7.5;
  const halfW = () => state.viewSize(d).w / 2;
  const proxy = { x: halfW() + 3 };
  const apply = () => {
    state.wall.position.x = proxy.x;
  };
  apply();

  gsap.fromTo(proxy, {
    x: () => halfW() + 3,
  }, {
    x: () => -(state.wallSpan + halfW()),
    ease: "none",
    onUpdate: apply,
    immediateRender: false,
    scrollTrigger: {
      trigger: ".wall-pin",
      start: "top top",
      end: "+=260%",
      pin: true,
      scrub: 1,
      anticipatePin: 1,
      invalidateOnRefresh: true,
    },
  });
}

/* ============ Drifting devices ============ */

async function buildDrifters(state) {
  const { THREE, drifters } = state;
  for (const spec of DEVICES) {
    const tex = await plainTexture(state, spec.url);
    if (!tex) continue;
    const aspect = tex.image.width / tex.image.height;
    const geo = new THREE.PlaneGeometry(spec.s * aspect, spec.s);
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      opacity: 0,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.renderOrder = 3;
    mesh.userData.spec = spec;
    mesh.userData.base = 0.32;
    drifters.add(mesh);

    gsap.to(mesh.rotation, {
      z: spec.sway,
      duration: 5 + Math.random() * 3,
      yoyo: true,
      repeat: -1,
      ease: "sine.inOut",
    });
  }

  state.layoutDrifters = () => {
    const d = 9.5;
    const view = state.viewSize(d);
    drifters.children.forEach((mesh) => {
      const spec = mesh.userData.spec;
      mesh.position.set(spec.x * (view.w / 2), spec.y * view.h, state.camera.position.z - d);
    });
  };
  state.layoutDrifters();
}

function initDrifterScroll(state) {
  // The devices breathe in and out over a second rather than snapping,
  // and the group only truly hides once the fade has finished.
  const fade = { v: 0 };
  const apply = () => {
    state.drifters.children.forEach((m) => {
      m.material.opacity = m.userData.base * fade.v;
    });
    state.drifters.visible = fade.v > 0.001;
  };
  ScrollTrigger.create({
    trigger: "#features",
    start: "top 80%",
    endTrigger: "#privacy-first",
    end: "bottom top",
    onToggle(self) {
      gsap.to(fade, {
        v: self.isActive ? 1 : 0,
        duration: 1.1,
        ease: "power2.inOut",
        overwrite: true,
        onUpdate: apply,
      });
    },
  });
  gsap.to(state.drifters.position, {
    y: 2.6,
    ease: "none",
    scrollTrigger: {
      trigger: "#features",
      start: "top bottom",
      endTrigger: "#privacy-first",
      end: "bottom top",
      scrub: 1.2,
    },
  });
}

/* ============================================================
   DOM animations
   ============================================================ */

function initHeader() {
  const header = document.querySelector(".site-header");
  if (!header) return;
  ScrollTrigger.create({
    start: "top top",
    end: "max",
    onUpdate(self) {
      if (self.scroll() < 80) {
        header.classList.remove("is-hidden");
        return;
      }
      header.classList.toggle("is-hidden", self.direction === 1);
    },
  });
}

function initHeroIntro() {
  const lines = document.querySelectorAll(".hero-title .line");
  const handles = document.querySelectorAll(".selection .handle");
  const tl = gsap.timeline({ defaults: { ease: "power3.out" } });
  tl.from(lines, { yPercent: 60, opacity: 0, duration: 1.1, stagger: 0.12 }, 0.15)
    .from(handles, { scale: 0, duration: 0.5, stagger: 0.06, ease: "back.out(2.5)" }, 0.7)
    .from(".hero .eyebrow", { y: 18, opacity: 0, duration: 0.7 }, 0.3)
    .from(".hero-sub", { y: 24, opacity: 0, duration: 0.8 }, 0.75)
    .from(".hero-cta", { y: 24, opacity: 0, duration: 0.8 }, 0.9)
    .from(".hero-fineprint", { opacity: 0, duration: 0.8 }, 1.1)
    .from(".scroll-hint", { opacity: 0, duration: 0.8 }, 1.3);
}

function initReveals() {
  document.querySelectorAll("main .reveal").forEach((el) => {
    // Hero reveals are handled by the intro timeline, feature cards below.
    if (el.closest(".hero") || el.classList.contains("feature-card")) return;
    gsap.from(el, {
      y: 34,
      opacity: 0,
      duration: 0.9,
      ease: "power3.out",
      scrollTrigger: { trigger: el, start: "top 86%", once: true },
    });
  });

  document.querySelectorAll(".privacy-line .line").forEach((el, i) => {
    gsap.from(el, {
      yPercent: 105,
      duration: 1.1,
      delay: i * 0.1,
      ease: "power4.out",
      scrollTrigger: { trigger: ".privacy-hero", start: "top 70%", once: true },
    });
  });

  gsap.utils.toArray(".feature-card").forEach((el, i) => {
    gsap.from(el, {
      y: 40,
      opacity: 0,
      rotateX: -8,
      transformPerspective: 800,
      duration: 0.8,
      delay: (i % 3) * 0.1,
      ease: "power3.out",
      scrollTrigger: { trigger: el, start: "top 88%", once: true },
    });
  });
}

/* Deterministic pseudo random so layouts are stable between loads. */
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
