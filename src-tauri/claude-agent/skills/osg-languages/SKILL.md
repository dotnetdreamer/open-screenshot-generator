---
name: osg-languages
description: >-
  How languages work in an Open Screenshot Generator project: adding store languages, writing
  translations with set_localized_texts, per-language font and size overrides, and exporting a
  language. Load it when the user asks to translate, localize, add or remove a language, or fix
  text that does not fit in one language.
---
# Languages in depth

## The model

A project holds one set of artboards and one layout, and a language is an overlay on it. Per
language, an element can have its own text, screenshot, image or recording, and its own
fontFamily, fontSize, lineHeight, letterSpacing, fontWeight, textAlign, color, rotation, scale,
position and size, or be hidden. Everything else is shared, so a layout fix lands in every
language at once. There is never a per language artboard or a copied project.

## Setting up

- list_supported_locales (query "chinese", "portuguese") is the catalog: the code to add a
  language by, whether a machine engine can draft it, what App Store Connect and Google Play call
  it, and the font its script needs.
- Codes are store locales. en-US and en-GB are different listings, so are zh-Hans and zh-Hant,
  and pt alone is refused: use pt-BR or pt-PT.
- add_locales takes locales, plus baseLocale (only while the project has no languages yet),
  autoFont (default true, substitutes a family that can draw Japanese, Arabic, Thai and so on),
  autoFit (default true, shrinks a translation that overruns its box) and machineTranslate
  (default false; leave it off and write the strings yourself).
- set_base_locale labels the language the design is written in. It is refused once the project
  has languages.
- remove_locales deletes every translation stored under those languages. Confirm with the user
  first.
- add_locales and set_base_locale look codes up in the catalog. Every other language tool looks
  them up in the project's own list, which list_locales returns.

## Writing translations

1. list_translations with filter "untranslated" (or all, translated, stale, machine), limit up to
   500 (default 100) and offset for paging. Each row has the element id, the base string and a
   cell per language.
2. Cell origins: inherited means nothing is written and the base copy shows, so write it. manual
   means a person or an agent wrote it, so ask before overwriting. auto means the machine engine
   drafted it, so improve it freely. stale-manual and stale-auto mean the base copy changed after
   it was translated, so rewrite it.
3. One set_localized_texts call carries every write: elementId, locale and text, plus artboardId
   only when the same element id is on two boards. That is one round trip and one undo step. An
   empty string, or a string identical to the base copy, clears the translation. Everything
   written this way counts as manual, so a later engine run leaves it alone.

set_localized_text writes a single string.

Translation notes:
- Translate the benefit, not the words. A literal German headline runs about 40 percent longer and
  says less.
- Keep product names, feature names and units as the app shows them.
- German, Finnish, Russian, Dutch and French run long. Japanese, Korean and Chinese run short and
  can take a larger size.
- Arabic, Hebrew, Farsi and Urdu align to the right edge on their own, but nothing mirrors the
  composition. Move a badge for them with a position override.
- The copy rules still apply: no em or en dashes, and no period at the end of a headline.

## Fixing one language

set_locale_override takes elementId, locale and any of: content, screenshotSrc (a localized
screenshot, as an asset ref), imageSrc, mediaId, fontFamily (this also turns off the automatic
script substitution for that element), fontSize (this also turns off auto shrink, so the box can
clip if the string grows), lineHeight, letterSpacing, fontWeight, textAlign, color, rotation,
scale, position {x, y}, size {width, height} and hidden (true drops the element in that language
only). null hands one property back to the shared design.

reset_locale_overrides takes locale and a scope: element (needs elementId), artboard (needs
artboardId) or project. With fields, for example ["fontSize"] or ["position", "size"], it drops
only those properties and keeps the copy. Without fields it drops everything, translations
included.

## Showing and exporting

- set_locale switches the canvas to a language; with no locale it returns to the base.
- export_png and export_all take locale: they switch, capture and switch back.
- export_all with a locale names its files <locale>_01_<name>.png. Export only when the user
  asks.

## The machine engine and spreadsheets

- translate_locales takes locales, only ("empty" by default, "stale" or "all"), includeManual
  (off protects reviewed copy), guidance (a brief for the AI engine), artboardIds and elementIds.
  When no engine is configured it says so; write the strings yourself.
- export_translations_csv returns CSV text: ids, the base language, then a column per language.
  import_translations_csv reads CSV text back. Run it with dryRun true first and report what would
  change. An empty cell never clears a translation. You can read a file only in the user's app
  folder, when they attached one, so this helps when the user pastes a sheet into the chat or the
  sheet is in that folder.
- When the user's app folder is attached, the app's own localized strings (lproj, values-<lang>,
  .arb or locales files, or a String Catalog, an .xcstrings file holding every language) are
  the best source of real translations: use the app's own words for its features and screens in
  each language, and write the rest in the same voice. Grep a String Catalog for the keys you
  need instead of reading it whole; knownRegions in project.pbxproj lists the app's languages.

## Troubleshooting

- "This project has no language X": add it with add_locales first. list_locales is the project's
  list.
- A tool refused the base language: the base language is the design itself. Use update_element.
- Boxes of squares instead of Japanese, Arabic or Thai: the font cannot draw the script. Use
  list_fonts with script cjk, arabic, urdu, hebrew, thai, devanagari or bengali, and override
  fontFamily for that language.
- Text clips although autoFit is on: a fontSize override turned auto shrink off for that element.
  Clear it with reset_locale_overrides and fields ["fontSize"].
- A translation shows in list_translations but not on the canvas: the canvas is on another
  language. Use set_locale.
