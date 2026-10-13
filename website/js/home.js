(function () {
  "use strict";

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
