---
name: store-localization
description: >-
  Ships one screenshot design in many App Store and Play Store languages using the
  open-screenshot-generator CLI (`osg localize`): it adds store locales to an existing project, writes
  per language copy, overrides the screenshot, font, box or position where a translation needs it,
  runs a CSV round trip with a human translation agency, and renders a fastlane style
  screenshots/<locale>/ folder per language. Use this whenever someone asks to localize store
  screenshots, translate their listing images, add German or Japanese or Arabic screenshots, ship a
  multi language App Store listing, or says things like "make these in Spanish too", "we are
  launching in Japan", "translate the screenshots" or "send the strings to a translator". Also use it
  for follow ups: a new language, a reworded translation, text that overflows in German, or a
  localized in app screenshot.
license: MIT
metadata:
  package: open-screenshot-generator
  homepage: https://openscrgen.app
---

# One design, up to 57 languages

**The end state**: one project, one layout, several store languages, rendered into a
`screenshots/<locale>/` folder per language under `osg/out/` that fastlane's `deliver` can upload as
is, with `osg verify` exiting 0 for every locale.

## The model, which is the thing everyone gets wrong

A language is an **overlay**, not a copy. The project keeps one set of artboards and one layout. Only
these can differ per language:

- the text content
- the screenshot inside a device frame
- the font, the font size, the line height, the box, the position of an individual element
- whether an element is shown at all

Everything else is shared. There is no per language artboard, no duplicated project, and no second
design to keep in sync. That is the whole point: a layout fix lands in every language at once.

Two consequences that will otherwise cost you an hour:

1. **Every editing tool writes the base document**, the one all languages share. `update_element`
   changes the copy every language starts from. Only `set_localized_text`, `set_localized_texts` and
   `set_locale_override` write one language.
2. **Rendering follows the canvas.** To export a language you switch to it and then export. `osg
   render` does that per locale for you; if you are driving tools by hand, `set_locale` then
   `export_all`.

## Step 1: name the base language before anything else

The base language is the language the design is written in. It labels the source that every
translation is tracked against, and it names the base folder in both store uploads.

It is **locked the moment the project has any export language**, because every override is hashed
against a base string and re-basing would silently re-point all of them. So set it first.

```json
[{ "tool": "add_locales", "args": { "locales": ["de-DE"], "baseLocale": "en-US" } }]
```

`baseLocale` is accepted only on that first call. After that, `set_base_locale` refuses.

## Step 2: add the store locales

Codes are **store locales**, not two letter languages: `en-US` and `en-GB` are different listings, and
so are `zh-Hans` and `zh-Hant`. `pt` alone is ambiguous and is refused.

```bash
npx -y open-screenshot-generator@0 edit --script osg/locales.json
```

```json
[
  { "tool": "list_supported_locales", "args": { "query": "chinese" } },
  { "tool": "add_locales", "args": { "locales": ["de-DE", "ja", "pt-BR", "zh-Hans"], "autoFont": true, "autoFit": true } },
  { "tool": "list_locales", "args": {} }
]
```

`list_supported_locales` is the catalog of all 57, with the code to add by, whether a machine engine
can draft it, what App Store Connect and Google Play each call it, and which font has to be
substituted for its script. Call it before `add_locales` rather than guessing a code.

- `autoFont` (default true) substitutes a family that can actually draw the script. Turn it off only
  if you have checked the design font covers Japanese, Arabic or Thai. It does not.
- `autoFit` (default true) shrinks a translation that overruns its box instead of clipping it.
- `machineTranslate` (default false) drafts every new language with the engine right away. Leave it
  off, see the next step.

Mirror the same list into `locales` in `osg/osg.config.ts` so a fresh clone renders the same set.

**Two vocabularies, and they resolve against different lists.** `add_locales` and `set_base_locale`
resolve against the catalog, because a language being added is by definition not in the project yet.
Every other language tool resolves against the project's own list. Using the wrong one either invents
a locale with no override map or refuses a language that does exist.

## Step 3: write the copy, because you are the better translator

Store copy is exactly what a machine translator is worst at: it is short, idiomatic, brand
specific and load bearing. An agent that reads the app writes better German headlines than the
engine does. So the preferred path is read, translate, write back, in two calls.

```json
[{ "tool": "list_translations", "args": { "filter": "untranslated", "limit": 200 } }]
```

Each cell says where its string came from, which is what tells you what you may overwrite:

| Origin | Meaning | Safe to overwrite |
| --- | --- | --- |
| `inherited` | nothing written yet, the base copy is showing | yes |
| `manual` | a person or an agent wrote it | ask first |
| `auto` | the machine engine drafted it | yes, and improving it is the job |
| `stale-*` | the base copy changed after this was translated | yes, it is a translation of copy that no longer exists |

Then write them all in one call. One round trip, one undo step, one save:

```json
[
  { "tool": "set_localized_texts", "args": { "writes": [
    { "elementId": "headline", "locale": "de-DE", "text": "Schlaf endlich durch" },
    { "elementId": "sub", "locale": "de-DE", "text": "Jede Nacht, automatisch" },
    { "elementId": "headline", "locale": "ja", "text": "ぐっすり眠れる夜へ" }
  ] } }
]
```

An empty string, or a string identical to the base copy, clears the translation and the element falls
back to the base. Everything written this way is marked as human written, so a later engine run will
not overwrite it.

Translation notes that are not optional:

- Translate the **benefit**, not the words. A literal German headline is usually 40 percent longer and
  says less.
- Keep product names, feature names and units in the source language unless the app itself localizes
  them.
- German, Finnish and Russian run long. Dutch and French run long. Japanese, Korean and Chinese run
  short and want a larger size, not a smaller one.
- Arabic, Hebrew, Farsi and Urdu align to the correct edge automatically. The **composition is not
  mirrored**: nothing flips element positions across the board. If a right to left layout needs the
  badge on the other side, that is a per locale position override, Step 5.

The machine engine is the fallback, for a language you do not read and for refreshing its own earlier
drafts:

```json
[{ "tool": "translate_locales", "args": { "locales": ["th"], "only": "empty", "guidance": "informal, second person, keep product names in English" } }]
```

`only: "stale"` refreshes drafts whose base copy has since changed. Strings a person wrote are skipped
unless `includeManual` is set, and leaving it off is what protects reviewed copy. If no engine is
configured, the tool says so and tells you to write the strings yourself, which was the better path
anyway.

## Step 4: the CSV round trip, for a human translation agency

```json
[{ "tool": "export_translations_csv", "args": {} }]
```

The result is a JSON document, not a file: `{ csv, locales, rows }`, where `csv` is RFC 4180 text with
one row per string, the ids first, then the base language, then a column per language. Write the
`csv` field to a file yourself and send that file. It is the format an agency takes.

```bash
npx -y open-screenshot-generator@0 call export_translations_csv | jq -r .csv > osg/translations.csv
```

```powershell
(npx -y open-screenshot-generator@0 call export_translations_csv | ConvertFrom-Json).csv |
  Set-Content -Encoding utf8 osg/translations.csv
```

When it comes back, read the file and send its contents as the `csv` argument. Build the call
programmatically rather than pasting a spreadsheet into a prompt:

```json
[
  { "tool": "import_translations_csv", "args": { "csv": "<the file contents>", "dryRun": true } },
  { "tool": "import_translations_csv", "args": { "csv": "<the file contents>" } }
]
```

- Rows match on `artboardId` plus `elementId`, falling back to the base string when the ids do not
  line up and exactly one element has that string. So do not let the agency reorder or renumber.
- **An empty cell means "I did not translate this one" and never clears an existing translation.**
  That is deliberate: a sheet that came back with three columns filled will not wipe the fourth.
- Only languages the project already has are written. Run `add_locales` first.
- Always run `dryRun` first and report what it says it will change.

## Step 5: fix what one language needs, without touching the others

```json
[
  { "tool": "set_locale_override", "args": { "elementId": "headline", "locale": "de-DE", "fontSize": 40, "size": { "width": 900, "height": 260 } } },
  { "tool": "set_locale_override", "args": { "elementId": "phone-1", "locale": "ja", "screenshotSrc": "asset:<id>" } },
  { "tool": "set_locale_override", "args": { "elementId": "award-badge", "locale": "pt-BR", "hidden": true } }
]
```

What each one is for:

- `screenshotSrc` is the big one. A German headline over an English app screen is not localized. Take
  the app's own screenshots per language, `upload_asset` each once, and override the device slot.
- `fontFamily` when a script needs a face the design font cannot draw. Setting it also turns **off**
  the automatic script substitution for that element, so only set it when you mean to.
- `fontSize` when a translation is long. Setting it turns off auto shrink for that element, so the box
  will clip if the string grows again.
- `position`, `size`, `rotation`, `scale`, `textAlign` for a real layout difference.
- `hidden: true` to drop a badge or an award from the markets that never earned it. Store review does
  read those.

**Overriding is what pulls a property apart.** `content`, `screenshotSrc`, `imageSrc` and `mediaId`
are always per language. Everything else is shared until you override it, and `update_element`
remains the way to change something for every language at once.

To undo: `reset_locale_overrides` with `scope` of `element`, `artboard` or `project`. With `fields`
it drops only those properties and keeps the copy. Without `fields` it drops everything that language
holds, translations included, which is what to do before re-translating from scratch.

## Step 6: render one folder per language

```bash
npx -y open-screenshot-generator@0 localize
npx -y open-screenshot-generator@0 render
npx -y open-screenshot-generator@0 manifest
npx -y open-screenshot-generator@0 verify
```

`osg localize` is the convenience wrapper over Steps 2 to 4 driven from `osg/osg.config.ts`. Run
`osg localize --help` for the exact subcommand and flag names in the release you have; when the
wrapper and this page disagree, the tool calls above are the contract.

`osg render` switches the canvas to each locale, exports, and writes:

```
osg/out/
  screenshots/
    en-US/    01_Hero.png  02_Search.png  ...
    de-DE/    01_Hero.png  02_Search.png  ...
    ja/       01_Hero.png  02_Search.png  ...
```

That is the fastlane `deliver` layout, so a repo that already uses fastlane can point at it directly.
Read `osg/osg.manifest.json` for the authoritative list rather than globbing.

The upload maps the codes for you: this project's key is `zh-Hans`, App Store Connect says `zh-Hans`,
Google Play says `zh-CN`. Nothing derives one from the other, so a locale the store does not have is
reported rather than guessed.

## Follow up dispatch

| The user asks for | Edit | Then run |
| --- | --- | --- |
| One more language | `osg.config.ts` `locales`, then `add_locales` | `localize`, `render` |
| Better wording in one language | `set_localized_texts` | `render` |
| "The German headline is cut off" | `set_locale_override` `fontSize` or `size` for `de-DE` | `render` |
| Localized app screenshots | `upload_asset`, then `set_locale_override` `screenshotSrc` | `render` |
| A badge removed in one market | `set_locale_override` `hidden: true` | `render` |
| Send strings to a translator | `export_translations_csv` | write the file |
| Strings came back | `import_translations_csv` with `dryRun` first | `render` |
| Drop a language | `remove_locales`, and `osg.config.ts` `locales` | `render` |
| Start one language over | `reset_locale_overrides` `scope: "project"` | `localize`, `render` |
| A layout change in every language | `update_element` on the base document | `render` |

## Troubleshooting

**"This project has no language X."** You used a code the project does not have. `list_locales` is the
project's list, `list_supported_locales` is the catalog. Add before you write.

**A tool refused the base language.** Correct. The base language is the design. Use `update_element`
to change the copy every language starts from.

**Boxes of squares instead of Japanese, Arabic or Thai text.** That is tofu: the family cannot draw
the script. Either `autoFont` was turned off, or a `fontFamily` override pinned a Latin face. Check
`list_fonts --script cjk` (also `arabic`, `urdu`, `hebrew`, `thai`, `devanagari`, `bengali`) and
override with a family from that list. An unknown family is rejected outright rather than substituted,
so a serif in the export means the family never reached the element.

**A translation is there in `list_translations` but not in the render.** The canvas is on another
language, or the export ran before the switch. `osg render` handles this; a hand driven export needs
`set_locale` first.

**Text clips even though `autoFit` is on.** Something set a `fontSize` override on that element, which
turns auto shrink off for it. Clear it with `reset_locale_overrides` and `fields: ["fontSize"]`.

**An override "did nothing".** A property other than `content`, `screenshotSrc`, `imageSrc` or
`mediaId` only takes effect once it is detached, which is what writing it through
`set_locale_override` does. Writing it through `update_element` changed the shared design instead.

**The base language cannot be changed.** By design, once export languages exist. Start a new project
if the design really was written in the wrong language.

**A CSV import wiped nothing and reported nothing.** The ids did not match. The sheet was reordered,
renumbered, or saved from a different project.

## Related skills

- **store-screenshots** for building the design the languages sit on top of
- **store-compliance** for the per locale caps and for `osg upload`
- **editor-tools** for the full locale tool surface and its asymmetries
