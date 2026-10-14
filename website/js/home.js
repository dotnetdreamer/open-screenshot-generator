(function () {
  "use strict";

  const preview = document.getElementById("hero-preview");
  const previewStage = document.getElementById("hero-stage");
  const motionButton = document.getElementById("hero-motion-toggle");
  const motionPreference = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  );
  let previewWanted = !motionPreference.matches;
  let previewInView = false;

  function attachVideo(video) {
    if (!video.src && video.dataset.src) {
      video.src = video.dataset.src;
      video.load();
    }
  }

  function updatePreviewButton() {
    if (!preview || !motionButton) return;
    const playing = !preview.paused && !preview.ended;
    motionButton.setAttribute("aria-pressed", String(playing));
    motionButton.querySelector("span").textContent = playing
      ? "Pause preview"
      : "Play preview";
    motionButton
      .querySelector("path")
      .setAttribute(
        "d",
        playing ? "M4 3h3v10H4zm5 0h3v10H9z" : "m5 3 8 5-8 5z",
      );
  }

  async function syncPreview() {
    if (!preview) return;
    const filmOpen = document.getElementById("promo-dialog")?.open;
    if (!previewWanted || !previewInView || document.hidden || filmOpen) {
      preview.pause();
      updatePreviewButton();
      return;
    }
    attachVideo(preview);
    try {
      await preview.play();
    } catch {
      updatePreviewButton();
    }
  }

  if (preview && previewStage && motionButton) {
    motionButton.hidden = false;
    updatePreviewButton();
    motionButton.addEventListener("click", function () {
      previewWanted = preview.paused;
      syncPreview();
    });
    preview.addEventListener("playing", function () {
      previewStage.classList.add("is-playing");
      updatePreviewButton();
    });
    preview.addEventListener("pause", updatePreviewButton);
    preview.addEventListener("error", function () {
      previewStage.classList.remove("is-playing");
      previewWanted = false;
      motionButton.hidden = true;
    });
    document.addEventListener("visibilitychange", syncPreview);
    motionPreference.addEventListener("change", function () {
      previewWanted = !motionPreference.matches;
      syncPreview();
    });
    if ("IntersectionObserver" in window) {
      const observer = new IntersectionObserver(
        function (entries) {
          previewInView = entries[0].isIntersecting;
          syncPreview();
        },
        { threshold: 0.15 },
      );
      observer.observe(previewStage);
    } else {
      previewInView = true;
      syncPreview();
    }
  }

  const promoDialog = document.getElementById("promo-dialog");
  const promoVideo = document.getElementById("launch-promo");
  const closePromo = document.querySelector(".promo-close");
  if (promoDialog && promoVideo && closePromo) {
    document.querySelectorAll("[data-promo-open]").forEach(function (link) {
      link.addEventListener("click", function (event) {
        if (typeof promoDialog.showModal !== "function") return;
        event.preventDefault();
        promoDialog.showModal();
        syncPreview();
        attachVideo(promoVideo);
        promoVideo.play().catch(function () {});
      });
    });
    closePromo.addEventListener("click", function () {
      promoDialog.close();
    });
    promoDialog.addEventListener("close", function () {
      promoVideo.pause();
      syncPreview();
    });
    promoDialog.addEventListener("click", function (event) {
      const bounds = promoDialog.getBoundingClientRect();
      if (
        event.target === promoDialog &&
        (event.clientX < bounds.left ||
          event.clientX > bounds.right ||
          event.clientY < bounds.top ||
          event.clientY > bounds.bottom)
      ) {
        promoDialog.close();
      }
    });
  }

  const examples = {
    finance: {
      name: "Kassa",
      image: "assets/img/showcase-kassa-money.png",
      alt: "Five Kassa finance app screenshots with blue typography, device frames, and a shared cream background",
      template: "kassa-money",
    },
    journal: {
      name: "Scrappi",
      image: "assets/img/showcase-scrappi-journal.png",
      alt: "Five Scrappi journaling app screenshots with paper textures, taped phone frames, and stickers",
      template: "scrappi-journal",
    },
    photo: {
      name: "Pixara",
      image: "assets/img/showcase-pixara-ai.png",
      alt: "Five Pixara photo editing app screenshots with dark backgrounds, pink headlines, and device frames",
      template: "pixara-ai",
    },
  };
  const image = document.getElementById("showcase-image");
  const exampleButtons = document.querySelectorAll("[data-showcase]");
  exampleButtons.forEach(function (button) {
    button.addEventListener("click", function () {
      const example = examples[button.dataset.showcase];
      if (!example || !image) return;
      image.src = example.image;
      image.alt = example.alt;
      document.getElementById("showcase-name").textContent = example.name;
      document.getElementById("showcase-link").href =
        "https://editor.openscrgen.app/?template=" + example.template;
      document.getElementById("showcase-caption").textContent =
        example.name + ": a complete screenshot set";
      exampleButtons.forEach(function (item) {
        item.setAttribute("aria-pressed", String(item === button));
      });
    });
  });

  const languages = {
    en: {
      headline: "Every cent\naccounted",
      code: "en-US",
      direction: "ltr",
      index: "01",
    },
    de: {
      headline: "Jeder Cent\nim Blick",
      code: "de-DE",
      direction: "ltr",
      index: "02",
    },
    ja: {
      headline: "すべての支出を\nひと目で",
      code: "ja",
      direction: "ltr",
      index: "03",
    },
    ar: {
      headline: "كل قرش\nفي الحسبان",
      code: "ar-SA",
      direction: "rtl",
      index: "04",
    },
  };
  const languageButtons = document.querySelectorAll("[data-locale]");
  const headline = document.getElementById("locale-headline");
  languageButtons.forEach(function (button) {
    button.addEventListener("click", function () {
      const language = languages[button.dataset.locale];
      if (!language || !headline) return;
      headline.replaceChildren();
      language.headline.split("\n").forEach(function (line, index) {
        if (index) headline.appendChild(document.createElement("br"));
        headline.appendChild(document.createTextNode(line));
      });
      headline.lang = button.dataset.locale;
      headline.dir = language.direction;
      document.querySelector(".locale-code").textContent = language.code;
      document.querySelector(".locale-counter").textContent =
        language.index + " / 04";
      languageButtons.forEach(function (item) {
        item.setAttribute("aria-pressed", String(item === button));
      });
    });
  });

  const toggle = document.querySelector(".menu-toggle");
  const navigation = document.getElementById("mobile-nav");
  function closeMenu() {
    if (!toggle || !navigation) return;
    navigation.hidden = true;
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-label", "Open navigation");
  }
  if (toggle && navigation) {
    toggle.addEventListener("click", function () {
      const open = toggle.getAttribute("aria-expanded") !== "true";
      toggle.setAttribute("aria-expanded", String(open));
      toggle.setAttribute(
        "aria-label",
        open ? "Close navigation" : "Open navigation",
      );
      navigation.hidden = !open;
    });
    navigation.querySelectorAll("a").forEach(function (link) {
      link.addEventListener("click", closeMenu);
    });
    document.addEventListener("keydown", function (event) {
      if (event.key === "Escape" && !navigation.hidden) {
        closeMenu();
        toggle.focus();
      }
    });
    window
      .matchMedia("(min-width: 801px)")
      .addEventListener("change", closeMenu);
  }
})();
