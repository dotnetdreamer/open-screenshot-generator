# App Store header and search art: developer notes

The technical side of the feature: Apple's numbers, the research and why it works the way it does. The guide for people using it is [APP-STORE-HEADER-AND-SEARCH.md](APP-STORE-HEADER-AND-SEARCH.md), written for readers who don't code. Keep that guide in plain words and put technical detail here.

Apple launched header and search art on 5 October 2026. It was requested in [issue #46](https://github.com/dotnetdreamer/open-screenshot-generator/issues/46).

## Apple's numbers

From the "Creative assets specifications" page in the App Store Connect help, checked 31 October 2026:

| Placement | Image | Video |
| --- | --- | --- |
| Product page header | 21:9, exactly 3840 x 1646, JPEG or PNG; or the 16:9 universal | 21:9, 3840 x 1646, 30 or 60 fps, 5 to 30 s, MOV, M4V or MP4 |
| Search results | 3:2, 1920 x 1280 to 3840 x 2560, JPEG or PNG; or the 16:9 universal | 3:2, same sizes, 30 or 60 fps, 5 to 30 s |
| Universal | 16:9, exactly 5244 x 2950, PNG only | none |

No image may carry an alpha channel. Videos loop. They start muted on the product page, where people can unmute them, and in search results they cannot be unmuted.

The art safe areas come from Apple's own templates (the Sketch file and all three Photoshop files agree to the pixel), in canvas pixels:

| Canvas | Art safe area |
| --- | --- |
| Header, 3840 x 1646 | x 1097, y 493, 1646 x 661, centred |
| Search, 3840 x 2560 | x 836, y 765, 2168 x 1030, centred |
| Universal, 5244 x 2950 | x 1921, y 660, 1402 x 962, above the middle |

Apple publishes no crop numbers per device. The iPhone crops in [specs.ts](../src/lib/creative/specs.ts) were measured by matching the device renders on Apple's asset best practices page against the template art, and confirmed against the horizon line in the same art. On an iPhone 16 Pro the header takes 393 x 254pt and shows about the safe area's width, a little above the middle. The search card is 3:2 like the art, but Apple's renders show it zoomed in to about the safe area's width. The back and share buttons are 44pt circles at 16pt from each side, 60pt from the top. Treat all of this as approximate. It draws the preview and keeps the generated copy clear of the buttons. Whether a design is safe is decided by the template safe area.

App Review guideline 2.3.14 covers the art: it must be about the app's content, function or brand, suit all ages, and include no misleading references to other apps, no unverifiable claims and no specific or discounted prices. The asset best practices page adds no URLs, no copyright symbols, no other platforms, no Apple recognitions, a 4+ rating whatever the app's own, short phrases, and localized text.

## What other tools do

Checked the week of 31 October 2026.

| Tool | Header and search | Safe area | Preview in context | Built from your screenshots | Every language | Rule check | Video |
| --- | --- | --- | --- | --- | --- | --- | --- |
| AppScreens | Output sizes you tick | Apple's | No, App Store Connect is the check | Reuses your screens and captions, you lay them out | Carries over | No | Not stated |
| storeheader.com | Web editor and templates | Safe area previews, in every language | Product page and search result mockups, showing the full image rather than a device crop | Your uploads, or fetched from an App Store link | Yes | No, a guide to what is allowed | No, a guide only |
| AppLaunchFlow | Free generator, editor presets | No (says so) | No, it says to use Apple's placement preview | No | Not in the generator | A separate checker for size, encoding, extension and alpha; no text rules | No |
| Storeboard | Planned for 1.2 | Planned | No | Planned, three layouts | Planned | Planned | No |
| ScreenshotBro | Sizes | Not stated | Not stated | Not stated | Not stated | No | No |
| Apple templates | Figma, Photoshop, Pixelmator, Sketch | Yes | No | No | No | No | No |
| App Store Connect preview | Only after upload | n/a | Yes, iPhone and iPad | n/a | Yes | Review does it | Yes |
| This editor | One click, three placements | Apple's, plus the header buttons | iOS 27 product page and search with an estimated iPhone crop, light and dark, live while you edit | Yes, eight looks | Yes, translations carried over | Yes, the text rules, per language, on the canvas | Not yet |

storeheader already shows the art in context, from your own screenshots, in every language, and AppLaunchFlow checks the file itself. What this editor adds is that the art is made in the screenshot project, so the listing preview shows it above the real screenshots while you edit, and that it checks the copy against the App Review rules in every language. None of the tools above does that on its public pages. Checked against each tool's own site; storeheader's editor may do more than its home page says.

## Decisions

**The art lives in the screenshots project.** The header is judged next to the icon and the screenshots under it, which only works if the preview has both. One project also means one translation table and one export folder per language with everything App Store Connect needs. The cost is that a few places assume every artboard is a screenshot, and they now skip `creativeAsset` boards: the Canvas Size handler, the device format conversion and detection, the export's extra sizes and numbering, the store upload dialog, the shared background picture and elements crossing artboard edges.

**Generated, not authored.** Like the social graphics in `src/lib/graphics/`, the looks are recipes computed from the project, so they wear the user's own brand and need no files at startup.

**No filters of its own.** The generator adds no blur, glow or drop shadow. On these boards WebKit (the desktop app) filters a layer at its full size, and a soft shadow under each phone froze the add dialog there long enough to fail a test. A glow also left visible rings on light grounds. The phones still carry the small drop shadow every flat device frame gets from `.device-container` in globals.css (0 2px 5px). WebKit got through that one in the e2e runs.

**Copy the check would flag is never carried over.** A template's "App of the day" badge or a price is skipped when the design builder picks a headline and a tagline, and so is copy the check would only warn about, such as "The #1 app", "3M+ Reviews", a sale or a sentence longer than a short phrase. The next copy on the screenshot is used instead, so a fresh design starts with nothing to fix.

**The app name keeps its own type.** A screenshot that sets the app name as a wordmark gives the art that wordmark's face, colour and weight, even when the headline uses another face, and even when the name is the only text there is.

**A headline split across layers is joined.** 28 of the 101 bundled templates set their headline as several layers, often one accent word in its own colour. A language gets the joined headline only when every part has its own translation there; otherwise it shows as untranslated rather than half and half.

**Two ways in: the dialog and the palette's Header tab.** The dialog, under the toolbar's + (CreateMenu.tsx), adds a header and a search result as a pair. The Header tab (fifth in the palette) adds one design at a time, by click, mouse drag or finger drag, the way the Previews tab adds a preview board. Both build the artboard with `buildCreativeBoard` and land through `handleAddCreativeBoards`, so translations and the history entry are the same either way. A click goes to the start of the canvas, like the dialog; a drop goes after the artboard it landed on, or to the start when it landed between boards. A finger lifted anywhere but the canvas adds nothing (`isOverCanvas` in the layout, which the Previews and element tiles go through too); a mouse drag needs no such check, since only the canvas answers its drop. A drag carries only `{ kind, lookId, appName }` (`CREATIVE_LOOK_DRAG_TYPE` in [paletteDrag.ts](../src/lib/creative/paletteDrag.ts)), and the board is built when it lands. The tab reads the project from `StoreArtSourceContext`, never through palette props: the palette is memoized because rebuilding its tiles on every edit made canvas drags stutter, and an inactive tab's content is unmounted, so the eight designs only cost anything while the tab is open. It builds them at low priority (`useDeferredValue`), so typing on the canvas does not wait for them.

## For agents and the MCP server

`create_artboard` takes the presets `appstore-header`, `appstore-search` and `appstore-universal`. The result and `list_artboards` carry `creativeAsset` and `safeArea`, so an agent that cannot see the canvas still knows where the copy has to go.

`export_all` names the art the way the export dialog does: no screenshot number, `AppStore_Header_3840x1646.png`, and `_2` on a second design of the same kind (both use `creativeFileStems` in [specs.ts](../src/lib/creative/specs.ts)).

## Where it lives

- [src/lib/creative/specs.ts](../src/lib/creative/specs.ts): the only registration site. Sizes, formats, safe areas, iPhone crops, header buttons, file names, presets.
- [src/lib/creative/layouts.ts](../src/lib/creative/layouts.ts): reads the project's look and composes each look.
- [src/lib/creative/check.ts](../src/lib/creative/check.ts): the store rules, per language.
- [src/lib/creative/paletteDrag.ts](../src/lib/creative/paletteDrag.ts): what a drag from the Header tab carries to the canvas.
- [creative/](../src/components/open-screenshot-generator/creative/): the add dialog, the palette's Header tab (`StoreArtPaletteTab.tsx`), the design thumbnail both draw with, the canvas guide and the check chip.
- [StoreListingPreview.tsx](../src/components/open-screenshot-generator/StoreListingPreview.tsx): the iOS 27 product page and search card.
- Tests: [tests/unit/creativeAssets.test.ts](../tests/unit/creativeAssets.test.ts) and [tests/e2e/specs/creative-assets.spec.ts](../tests/e2e/specs/creative-assets.spec.ts).

## Not done yet

- **Video.** Header and search video is 5 to 30 seconds and loops. The App Preview exporter already leads with H.264 High 5.1 for frames this big, a level that holds 3840 x 1646 at 30 fps; whether each machine's encoder accepts it is untested. An animated creative artboard exports as a still for now.
- **Upload.** The App Store Connect API takes this art through `appAssetLibraryImages` and `appAssetLibraryPlacements` with the placement types `PRODUCT_PAGE_HEADER_ASSET` and `APP_STORE_SEARCH_RESULTS_ASSET`. The desktop store upload could send it next to the screenshots.
- **iPad.** The preview is iPhone only. iPad shows more of the header, and the safe area is what holds for both.
- **In-App Event art** (16:9 card, 9:16 details page) would be two more entries in `CREATIVE_ASSETS`.
