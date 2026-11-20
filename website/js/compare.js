/* The compare page's table controls. Without this script the whole table
   shows and slides sideways on small screens. With it, a visitor can pick
   what they need, and the table fades every tool that can't do all of it,
   or pick one tool to see next to ours.

   Every answer is read from the table itself (each cell's data-v), so the
   picker can never say something the table doesn't */
(function () {
  "use strict";

  const table = document.getElementById("compare-table");
  if (!table) return;

  const heads = Array.from(table.querySelectorAll("thead th[data-tool]"));
  const tools = heads.map(function (th) {
    return { key: th.dataset.tool, name: th.dataset.name };
  });
  const rows = {};
  table.querySelectorAll("tbody tr[data-row]").forEach(function (tr) {
    const values = {};
    tr.querySelectorAll("td").forEach(function (td, index) {
      const tool = tools[index];
      if (!tool) return;
      td.dataset.tool = tool.key;
      values[tool.key] = td.dataset.v || "unknown";
    });
    rows[tr.dataset.row] = values;
  });

  // What each need asks of a tool: every row in the list has to say yes,
  // or say paid when the visitor doesn't mind paying
  const NEEDS = {
    video: ["video"],
    languages: ["translate"],
    upload: ["upload-apple", "upload-google"],
    ai: ["ai"],
    tilt: ["tilt"],
    together: ["together"],
  };

  const picker = document.getElementById("need-picker");
  const chips = picker
    ? Array.from(picker.querySelectorAll("[data-need]"))
    : [];
  const freeChip = picker ? picker.querySelector("[data-free]") : null;
  const result = document.getElementById("need-result");
  const select = document.getElementById("compare-with");
  const controls = document.getElementById("table-controls");
  const hint = document.getElementById("swipe-hint");
  const emptyResult = result ? result.textContent : "";

  function passes(toolKey, rowKey, freeOnly) {
    const value = rows[rowKey] ? rows[rowKey][toolKey] : "unknown";
    if (value === "yes") return "free";
    if (value === "paid" && !freeOnly) return "paid";
    return null;
  }

  // How a tool does on everything picked: "free", "paid" (some of it needs a
  // paid plan) or null (it can't do all of it)
  function fit(toolKey, needs, freeOnly) {
    let paid = false;
    for (const need of needs) {
      for (const rowKey of NEEDS[need]) {
        const answer = passes(toolKey, rowKey, freeOnly);
        if (!answer) return null;
        if (answer === "paid") paid = true;
      }
    }
    if (freeOnly && rows.watermark && rows.watermark[toolKey] !== "yes") {
      return null;
    }
    return paid ? "paid" : "free";
  }

  function joinNames(parts) {
    if (parts.length < 2) return parts.join("");
    return parts.slice(0, -1).join(", ") + " and " + parts[parts.length - 1];
  }

  function writeResult(matches, needs, freeOnly) {
    if (!result) return;
    result.replaceChildren();
    if (!needs.length && !freeOnly) {
      result.textContent = emptyResult;
      return;
    }
    if (!matches.length) {
      result.textContent = freeOnly
        ? "No tool does all of that for free. Try taking one away"
        : "No tool does all of that. Try taking one away";
      return;
    }
    const count = matches.length === 1 ? "1 tool" : matches.length + " tools";
    const lead = document.createElement("strong");
    if (!needs.length) {
      lead.textContent =
        count +
        (matches.length === 1 ? " has" : " have") +
        " a free plan with no watermark";
    } else {
      lead.textContent =
        count +
        (matches.length === 1 ? " does " : " do ") +
        (freeOnly ? "all of that for free" : "all of that");
    }
    result.appendChild(lead);
    const names = matches.map(function (match) {
      return match.fit === "paid" && !freeOnly
        ? match.name + " (on a paid plan)"
        : match.name;
    });
    result.appendChild(document.createTextNode(": " + joinNames(names)));
  }

  function update() {
    const needs = chips
      .filter(function (chip) {
        return chip.getAttribute("aria-pressed") === "true";
      })
      .map(function (chip) {
        return chip.dataset.need;
      });
    const freeOnly =
      freeChip !== null && freeChip.getAttribute("aria-pressed") === "true";
    const picking = needs.length > 0 || freeOnly;
    const matches = [];
    tools.forEach(function (tool) {
      const answer = fit(tool.key, needs, freeOnly);
      if (answer) matches.push({ name: tool.name, fit: answer });
      const dim = picking && !answer ? "true" : "false";
      table
        .querySelectorAll('[data-tool="' + tool.key + '"]')
        .forEach(function (cell) {
          cell.dataset.dim = dim;
        });
    });
    writeResult(matches, needs, freeOnly);
  }

  function showPair() {
    if (!select) return;
    const chosen = select.value;
    tools.forEach(function (tool, index) {
      const hide = chosen !== "all" && index > 0 && tool.key !== chosen;
      table
        .querySelectorAll('[data-tool="' + tool.key + '"]')
        .forEach(function (cell) {
          cell.dataset.hide = hide ? "true" : "false";
        });
    });
    table.classList.toggle("is-pair", chosen !== "all");
    if (hint) hint.hidden = chosen !== "all";
  }

  chips.concat(freeChip ? [freeChip] : []).forEach(function (chip) {
    chip.addEventListener("click", function () {
      const on = chip.getAttribute("aria-pressed") !== "true";
      chip.setAttribute("aria-pressed", String(on));
      update();
    });
  });
  if (select) {
    // A phone shows ours next to one tool at first, so the table fits the
    // screen. The picker above it switches to any other tool, or all of them
    if (window.matchMedia("(max-width: 560px)").matches && tools[1]) {
      select.value = tools[1].key;
    }
    select.addEventListener("change", showPair);
    showPair();
  }
  if (controls) controls.hidden = false;
  update();
})();
