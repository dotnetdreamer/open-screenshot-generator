/* ============================================================
   Promo film panel.

   Two cuts of the same 58s edit ship with the site: a 16:9 one and a 9:16 one.
   Only one of them is ever fetched, and not until the panel is close to the
   viewport, because either file is ~17MB and the hero above it must not wait
   on that. Autoplay is muted and silent by default (browsers block anything
   else), with a sound toggle once it is running.
   ============================================================ */
(function () {
  const video = document.getElementById("promo-film");
  const frame = document.querySelector(".film-frame");
  const play = document.getElementById("film-play");
  const sound = document.getElementById("film-sound");
  if (!video || !frame || !play || !sound) return;

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  // Portrait cut for anything taller than it is wide, which is where the 16:9
  // one would shrink to a letterboxed sliver.
  const tall = window.matchMedia("(max-width: 780px) and (orientation: portrait)").matches;

  let attached = false;
  const attach = () => {
    if (attached) return;
    attached = true;
    if (tall) {
      frame.classList.add("is-tall");
      video.poster = video.dataset.posterTall;
      video.src = video.dataset.srcTall;
    } else {
      video.poster = video.dataset.posterWide;
      video.src = video.dataset.srcWide;
    }
    video.load();
  };

  const start = () => {
    attach();
    const p = video.play();
    if (p && typeof p.catch === "function") {
      // A blocked play leaves the poster and the button in place, which is a
      // fine resting state rather than an error to report.
      p.catch(() => {});
    }
  };

  // Set the aspect ratio immediately so the panel never reflows once the file
  // arrives, but hold the download itself until the panel is nearly on screen.
  if (tall) frame.classList.add("is-tall");
  video.poster = tall ? video.dataset.posterTall : video.dataset.posterWide;

  play.addEventListener("click", start);
  video.addEventListener("playing", () => {
    play.hidden = true;
    frame.classList.add("is-playing");
  });
  video.addEventListener("pause", () => {
    play.hidden = false;
  });

  sound.addEventListener("click", () => {
    video.muted = !video.muted;
    sound.textContent = video.muted ? "Sound off" : "Sound on";
    sound.setAttribute("aria-pressed", String(!video.muted));
    if (!video.muted && video.paused) start();
  });

  if (reduced) {
    // Poster plus an explicit play button, and nothing preloaded.
    play.querySelector(".film-play-label").textContent = "Play the film";
    return;
  }

  if (!("IntersectionObserver" in window)) {
    start();
    return;
  }

  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          start();
        } else if (attached && !video.paused) {
          // Offscreen playback is wasted decode; resume when it comes back.
          video.pause();
          play.hidden = true;
        }
      }
    },
    { rootMargin: "200px 0px", threshold: 0.25 }
  );
  io.observe(frame);
})();
