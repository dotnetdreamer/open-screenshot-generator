---
name: ui-text
description: How a sentence the user reads is written in Open Screenshot Generator - toasts, dialog titles and bodies, buttons, tooltips (`title`), `aria-label`s, placeholders, settings hints, empty states, start-screen and tour copy, and thrown errors that reach a toast. Use before writing or changing ANY of those. Covers the house patterns with real before/after strings from this repo, the rules the copy has to pass, which Playwright specs and screenshot scripts match on UI text so a reword does not break them, and a checker script for the diff.
---

# Sentences the user reads

The people reading this app's copy are making store screenshots, often against a
release deadline. Every string should tell them what state they are in and what to do
next, in the words they would use.

The strings have no dictionary. They are hardcoded in the components, mostly
[OpenScreenshotGeneratorLayout.tsx](../../../src/components/open-screenshot-generator/OpenScreenshotGeneratorLayout.tsx).
`src/lib/i18n/` is a different thing: it translates the text **inside the user's
artboards** into store locales. Do not put editor copy there, and do not treat a
project's locale list as a list of UI languages.

The house style is the newer code, not the older code. The early toasts in the layout
("Loading Error", "Failed to load project. See console for details.") are the
"don't" examples below. The recent ones in the start screens, cloud, account and
panels are the "do" examples.

## 1. Say the state, then the way out

A toast is read in a second. The title says what happened, the description says what to
do about it. If there is nothing to do, drop the description.

- **Don't:** `Delete Failed` / `There was an error deleting the project.`
- **Do:** `Nothing to share yet` / `Create or open a project first.`

## 2. Never point at the console

Desktop users have no console, and web users will not open one. Log the error with
`console.error` and tell the user what they can do.

- **Don't:** `Failed to load project. See console for details.`
- **Do:** `That version could not be read` / `It may have been cleared with the browser
  data.`

## 3. Name the thing, not the category

"Error", "Loading Error" and "Invalid Template" make the user work out what broke.

- **Don't:** `Error`
- **Do:** `Those images could not be read`, `That set is no longer on this device`

## 4. Cut the apology and the passive filler

"Failed to", "There was an error", "has been", "successfully" all come before the fact
and add nothing to it.

- **Don't:** `The project has been removed from your recent projects.`
- **Do:** `Removed from recent projects`

## 5. Sentence case, always

Titles, buttons, tooltips and menu items are sentence case. Product and platform names
keep their capitals (App Store, Google Drive, iPad).

- **Don't:** `Cannot Delete Element`, `Add New Artboard After`
- **Do:** `The editor was reloaded`, `Put back in the editor`

## 6. A hint under a switch is one outcome

Say what the setting changes for the user. How it works goes in a code comment.

- **Don't:** `Keeps the open project in your cloud on its own, shortly after each round
  of edits. Sign in to use it, and watch the corner of the canvas to see where it got to`
- **Do:** `Saves the open project to your cloud a few seconds after you stop editing.
  Needs sign in`

## 7. No bare pronoun, no selling, no hedging

"It" and "they" need something on screen to point at. "Simply", "just", "easily",
"instantly", "seamless" and "powerful" are words the user skips.

- **Don't:** `It ran out of memory and the app recovered it.`
- **Do:** `The editor ran out of memory and reloaded. Your last saved work is intact.`
- **Don't:** `Add screenshots above and every design here fills with them, instantly`
- **Do:** `Add screenshots above to fill every design here`

## Use the app's own words

| Say | Not |
| --- | --- |
| artboard | board, slide, page (the UI says "artboard" about 180 times) |
| project | design, file (except on the quick start deck, where each card is a "design") |
| element, layer | object, item (layer only in the Layers panel) |
| export | download, render |
| language | locale (the code says locale, the user never sees the word) |

## The test before you write it down

Say it out loud to someone sitting next to you. If you would not say it that way, it is
not ready. Then delete every word you can remove without losing a fact.

## Rules that are not a matter of taste

From rule 19 in [.agents/AGENTS.md](../../../.agents/AGENTS.md):

- **No em or en dashes.** Use a comma, a period, a colon, or "to".
- **No trailing period on short copy:** titles, buttons, tooltips, `aria-label`,
  placeholders, menu items, settings hints. A toast description or dialog body made of
  full sentences keeps its periods, as the recent code does.
- **No curly quotes.** Tests match on exact strings, and a curly quote never matches.
- The wider rules live in `.claude/skills/humanizer`, which AGENTS.md makes mandatory
  for everything a user reads.

## Do not rewrite strings for the sake of it

The old toasts in the layout break most of these patterns. Fix one when you are already
changing that code path, or when it is actually wrong. A sweep is churn, and a lot of
these strings are matched by tests.

---

# What reads the strings

UI text is also a locator. A reword that looks harmless can break a test.

| Reader | Where | Matches on |
| --- | --- | --- |
| Playwright specs | [tests/e2e/specs/](../../../tests/e2e/specs/) | `getByTitle`, `getByRole({ name })`, `getByText`, about 250 calls |
| Page object | [tests/e2e/helpers/editor.ts](../../../tests/e2e/helpers/editor.ts) | toolbar `title`s, palette `aria-label` shaped `Add ${label} (${libraryId})`, tab names with `exact: true` |
| Screenshot driver | [.claude/skills/app-screenshots/scripts/](../app-screenshots/scripts/) | CSS selectors like `button[aria-label="Expand right panel"]`, `title^="Step back"` |

```bash
# Before changing a string: who reads it?
node .claude/skills/ui-text/copy.mjs locked "Expand right panel" "Put back in the editor"

# After writing copy: check the lines added since HEAD
node .claude/skills/ui-text/copy.mjs check

# Audit one file whole (expect the old layout toasts to light up)
node .claude/skills/ui-text/copy.mjs check --all src/components/open-screenshot-generator/SettingsDialog.tsx
```

`check` flags dashes, curly quotes, trailing periods on short copy, "see console",
"There was an error", "Failed to ...", selling words and Title Case. Title Case and
selling words can be false alarms (a product name it does not know). The rest are real.

## The traps

1. **A matched string changes with its matcher, in the same commit.** Run `locked` first.
   If it says LOCKED, update the spec or script too, then run that spec
   (`npx playwright test --project web tests/e2e/specs/<file>`).
2. **`aria-label` replaces the visible text as the accessible name.** A button that
   reads "Export" on screen but has `aria-label="Export artboards"` answers to the
   label, so `getByRole('button', { name: 'Export', exact: true })` finds nothing.
3. **Icon-only toolbar buttons are found by `title`.** Adding visible text to one changes
   its accessible name, and adding an `aria-label` changes it again. `editor.ts` explains
   the locator policy at the top.
4. **One label can be a prefix of another.** `getByRole` without `exact: true` matches
   a substring, so a new button whose name contains an existing one ("Export" inside
   "Export all") can make an old locator match two elements and fail. The page object
   passes `exact: true` for that reason; keep new names distinct.
5. **Thrown errors reach the user.** `toast({ description: err.message })` shows
   whatever the lower layer threw, so a message in `src/lib/` that ends up in a toast
   follows these rules too. Keep technical detail in `console.error`.
6. **Translatable text inside artboards is not UI copy.** Template headlines and the
   AI agent's generated marketing copy follow the store's tone, not these rules.

## Where a string is used

```bash
grep -rn "Exact string" src tests/e2e .claude/skills/app-screenshots/scripts --include='*.ts' --include='*.tsx' --include='*.js'
```

A string built with a template literal (`` `Add ${label} (${libraryId})` ``) will not
show up under its final text. Search for a fixed fragment of it.
