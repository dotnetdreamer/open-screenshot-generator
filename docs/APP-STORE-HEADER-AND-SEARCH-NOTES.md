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

## What an iPhone shows

The safe area is not what an iPhone shows. It is what survives on every device and orientation, and an iPhone shows far more. Apple publishes no crop numbers per device, so the iPhone windows in [specs.ts](../src/lib/creative/specs.ts) (`IPHONE_WINDOW_ASPECT`) were measured off App Store Connect's own iPhone preview, in the two screenshots a developer posted to [issue #46](https://github.com/dotnetdreamer/open-screenshot-generator/issues/46) on 8 November 2026.

| Placement | Window on an iPhone | What it shows of the art |
| --- | --- | --- |
| Header, 3840 x 1646 | about 1.95 : 1, under the status bar | the full height, the middle 84% of the width (about x 315 to 3525) |
| Search, 3840 x 2560 | about 1.79 : 1, 296 x 165 on screen | the full width, the top 84% of the height (down to about y 2145) |
| Universal, 5244 x 2950 | both of the above | the full width in both, down to about y 2689 as a header |

How the numbers were found:

- **Search.** The art in the screenshot looks like this editor's "Headline and screen" design. The project was not available, and the comment does not say whether any layer had been moved, so the design was rebuilt and its layers taken to be where the generator puts them. Read that way, five of them (the left edge of the copy, the three lines of the headline, the top of the phone) land within a pixel or two of where a crop that keeps the full width and the top of the art puts them, and a crop centred on the art misses by 16 pixels. Five positions agreeing with one simple crop is the evidence. It does not prove that no layer was moved. The unit test keeps two of those measurements.
- **Header.** The page gives the header a 3:2 frame as wide as the phone. The strip under the status bar, about 60pt, is filled with the colour of the art's top edge, softly, and the art fills what is left, which is why it shows top to bottom and loses its sides. Two other developers who measured the same preview report the same crop: "about 8 percent on the left and 8 percent on the right" ([TeroxAI](https://teroxai.com/blog/app-store-creative-assets-sizes-api/)) and "roughly the middle 3200 pixels" ([apppage.co](https://apppage.co/app-store-creative-asset-generator)). Where the art starts under the strip is soft in the screenshot, so the width is good to about 1.5%.
- **Buttons.** The back and share buttons are circles about 49pt across, 14pt in from each side, at the top of the art. Both are well clear of the safe area.
- **Universal.** Nobody has posted a preview of one. It is taken to be cropped the way the others are: as wide as either window, so it keeps its width, and its top.

Apple calls its preview a reference, and three things do not agree with it:

- The device renders on Apple's asset best practices page crop the art to about the width of the safe area (1646 px of a header, about 1960 px of search art) and run the header up under the status bar. The first version of this feature took its crop from those renders, so its preview showed a design about twice the size App Store Connect does, and its designs were drawn to fit the safe area alone. On a phone they sat small in the middle with bare space around them, which is what issue #46 reports.
- Those renders and the web App Store (apps.apple.com) show search art whole, in a 3:2 card. The strip App Store Connect's preview cuts off the bottom may show elsewhere, so nothing is built to hide there.
- The store's own data calls the search art an "aligned region" and both placements `UI1_3x2`, which would fit a 3:2 frame with the art aligned inside it, the way the preview draws the header.

All of this is close, not exact. It draws the preview and the blue guide, sizes the type and places the screens. Whether copy is safe is still decided by the template safe area.

What is not known:

- **Other devices.** Only the iPhone preview has been measured. Apple says to "design key elements with a safe area in mind to accommodate different devices and orientations" and to keep "key aspects of your art within the safe area defined in each template" ([asset best practices](https://developer.apple.com/app-store/asset-best-practices/)). So the crop changes with the device and the orientation, and nothing here says an iPad shows less than an iPhone, or more.
- **A universal image.** How one 16:9 image is cut for the header and for the search card has not been measured either. It is taken to follow the two windows above.
- **The strip above a header.** The preview fills it with the top row of the art, stretched, drawn from the layers that reach that row ([topEdge.ts](../src/lib/creative/topEdge.ts)). That matches a plain or graded edge. Above a photo, Apple's own screenshot of the Device Preview sheet shows the top of the art carried on upward and blurred, so the stretched row is only close there. A 3D device or a video that reaches the top edge is left out of the strip, because drawing one a second time costs a WebGL context or a decoder.

### Looked for on 12 November 2026, and not found

Nobody has published the iPad, landscape or universal crops, and nothing public shows them:

- Apple's templates (Sketch, checked layer by layer) hold one "Art Safe Area" per canvas and no device or orientation guides.
- Apple's pages show iPhones only: the asset best practices page, the news post, and the "Manage your App Store assets" help page. The transcript of the WWDC26 session "Enhance your presence on the App Store" says the preview covers "both iPhone and iPad, across different orientations and languages" and gives no numbers.
- Six write-ups by other developers and tools (TeroxAI, apppage.co, ObjectGraph, storeheader, Storeboard, Ecranify) give the template safe areas and, at most, the iPhone header crop. TeroxAI says of the iPad option "I have not measured that yet". Storeboard's universal figures are worked out from the aspect ratios with a centred crop taken for granted, and it says so.
- The App Store's own page data for an app that has this art names the header `uber` with `style: "above"` and the search art `alignedRegionArtwork`. Each carries a size, a background colour and a resize code, and no crop region. On a desktop browser the web App Store (apps.apple.com) does not draw the header at all.

Two things did turn up. Apple's help page has a screenshot of the Device Preview sheet on an iPhone, with a photo for a header. The header sits in a frame 1.54 times as wide as it is tall, which is the 3:2 frame the measurement above found, and the band under the status bar is the top of the art carried on upward and blurred. And TeroxAI reports the search art "shown whole" at 3:2, where the screenshot in issue #46 shows a card of 1.79:1 with the bottom cut. Apple's own device renders show 3:2 as well. So the bottom strip is treated as something that may or may not show, which is why nothing is built to hide there.

### Measuring another device

It takes App Store Connect and an app with a header and search art in it, approved or not. In the version page click **Preview**, pick the device and the orientation, and take a screenshot of the sheet at full size for the product page and for search results. With the art that was uploaded and the screenshot side by side, three things settle a window: the size of the frame the art sits in, where two or three points of the art land in it, and whether the frame holds the art's top, its middle or its bottom. Wanted: iPad in portrait and in landscape, and a universal image on an iPhone in both placements. The numbers go into `IPHONE_WINDOW_ASPECT` in [specs.ts](../src/lib/creative/specs.ts), or a table beside it, and the unit test keeps the points they were measured from.

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
| This editor | One click, three placements | Apple's, plus what an iPhone shows and the header buttons | iOS 27 product page and search, cropped as App Store Connect's iPhone preview crops them, light and dark, live while you edit | Yes, eight looks | Yes, translations carried over | Yes, the text rules, per language, on the canvas | Not yet |

storeheader already shows the art in context, from your own screenshots, in every language, and AppLaunchFlow checks the file itself. What this editor adds is that the art is made in the screenshot project, so the listing preview shows it above the real screenshots while you edit, and that it checks the copy against the App Review rules in every language. None of the tools above does that on its public pages. Checked against each tool's own site; storeheader's editor may do more than its home page says.

## Decisions

**The art lives in the screenshots project.** The header is judged next to the icon and the screenshots under it, which only works if the preview has both. One project also means one translation table and one export folder per language with everything App Store Connect needs. The cost is that a few places assume every artboard is a screenshot, and they now skip `creativeAsset` boards: the Canvas Size handler, the device format conversion and detection, the export's extra sizes and numbering, the store upload dialog, the shared background picture and elements crossing artboard edges.

**Generated, not authored.** Like the social graphics in `src/lib/graphics/`, the looks are recipes computed from the project, so they wear the user's own brand and need no files at startup.

**Copy in the safe area, screens beside it.** The copy stays inside Apple's safe area, because that is the only part every device shows, and it is set as large as fits. The screens are sized for what an iPhone shows and stand in the strips beside the safe area, which gives the copy the whole safe area and fills the phone. A device that shows only the safe area sees the copy on its own. A universal image has too little room beside its name, so its screen rises underneath, where the art is otherwise bare.

**11pt where there is room for it.** Type is sized for the phone that shows the art smallest: 90 px on a header, 120 px on search art and 163 px on a universal image are 11pt on an iPhone. The two lines a design can do without, the tagline under a name and the line under a headline, are left out when they have no room at that size, and the app name takes the space. The app name and the headline are never left out and never cut. A name is tried on one line, two and three, and more lines win only when they set it at least 15% bigger. With no room at 11pt it wraps over as many lines as its part of the safe area holds, and after that it goes smaller, down to half. The check reports type under 10pt. In a sweep of 11,904 designs (31 faces, 12 names, 4 sets of copy) that last step was taken only on the universal image, whose safe area is 94pt wide on a phone, for names such as one 20-letter word. Search art carries no app name over its headline, because a search result prints the name right above the art.

**Existing art is laid out again, not replaced.** Art made before the designs were sized for an iPhone sits inside the safe area, and the check now says so: "Looks small on an iPhone" when every screen is inside the safe area, next to the older "Too small to read on an iPhone". The chip offers **Rebuild design** (`rebuildCreativeBoard` in [layouts.ts](../src/lib/creative/layouts.ts)). It reads the design back off the artboard, by the part in each layer's id (`cr-<seed>-<kind>-<part>`) or by the layer's name on a duplicated artboard, tells the look from the number of screens, and builds that look from the artboard's own words, translations, screens, type and colours at the artboard's own size. Layers keep their ids, so translations and the selection stay put, and layers the user added stay where they were. A line under the name or the headline is kept whenever it can be set at 11pt, with the name or headline giving up size for it, which a new design does not do. Rebuilding art that is already right changes nothing: in a sweep of 11,904 designs in each of Chromium and WebKit, none changed, and every design squeezed to half size inside its safe area came back identical to a fresh build. Nothing is rebuilt on its own when a project opens, because the layout is the user's to keep.

**A font that arrives late.** A design waits up to three seconds for its faces before it is fitted. One that goes in without them is fitted in the fallback, so the editor keeps it, with its layers as they went in, and lays it out again when the face arrives, as one history entry ("Fit App Store art to its font"). If anything on the artboard has changed by then it is left alone, and its chip says if it needs a look.

**Hearing that a font arrived.** [fontsSettled.ts](../src/lib/fontsSettled.ts) is the one way to hear it, for this feature and for the locale font fit and the check. `loadingdone` is the event browsers have for it, and WebKit, which the desktop app runs in, never fires it. WebKit fires `loading` again and again with nothing loading, and `document.fonts.ready` then settles at once, so a listener that measures again on it loops: more than 200 renders in 8 seconds on a blank project. And `document.fonts.check` answers "there" about three seconds into a load that is still going. What both engines keep is `document.fonts.load` for a named face, which settles when that face arrives. So the probe in `textFit.ts` names each face it measures in, `fontsSettled.ts` asks for it once, and whether a face is still on its way is read from that record.

**Type is fitted by measuring it.** A design sets its type at the largest size that fits, so the line count has to be the canvas's own. [typeFit.ts](../src/lib/creative/typeFit.ts) measures with the probe from `textFit.ts`, the one the check reads, so a design that fits passes the check. The first version counted lines from one average letter width. "MOMMY MORNINGS" in bold is 9.7 ems wide in Arial, 13 in Unbounded and 5.7 in Bebas Neue, and the average made it 8.7, so in Arial the name broke onto a line its box had no room for and the box cut it off. In the same sweep, run in Chromium, 19% of designs had text cut off by its box that way, and 25% did with the smaller type of the version before it. None do now, in Chromium or in WebKit. Three things follow from measuring. The cards in the add dialog and the Header tab are built again when a font arrives (`useFontsLoaded`). A design that is going into the project waits for its faces first (`lookFacesPending`, three seconds at most), because type measured in a fallback face wraps somewhere else once the real one loads, and one that goes in without them is fitted again when they arrive. And the probe quotes the family the way `TextElement` does: a bare `Baloo 2` is not legal CSS, so the probe used to go on measuring in whatever face it had last. Without a page (a unit test) the lines are estimated from widths by kind of character, which is what keeps capitals from being counted as lower case.

**No filters of its own.** The generator adds no blur, glow or drop shadow. On these boards WebKit (the desktop app) filters a layer at its full size, and a soft shadow under each phone froze the add dialog there long enough to fail a test. A glow also left visible rings on light grounds. The phones still carry the small drop shadow every flat device frame gets from `.device-container` in globals.css (0 2px 5px). WebKit got through that one in the e2e runs.

**Copy the check would flag is never carried over.** A template's "App of the day" badge or a price is skipped when the design builder picks a headline and a tagline, and so is copy the check would only warn about, such as "The #1 app", "3M+ Reviews", a sale or a sentence longer than a short phrase. The next copy on the screenshot is used instead, so a fresh design starts with nothing to fix.

**The app name keeps its own type.** A screenshot that sets the app name as a wordmark gives the art that wordmark's face, colour and weight, even when the headline uses another face, and even when the name is the only text there is.

**A headline split across layers is joined.** 28 of the 101 bundled templates set their headline as several layers, often one accent word in its own colour. A language gets the joined headline only when every part has its own translation there; otherwise it shows as untranslated rather than half and half.

**Two ways in: the dialog and the palette's Header tab.** The dialog, under the toolbar's + (CreateMenu.tsx), adds a header and a search result as a pair. The Header tab (fifth in the palette) adds one design at a time, by click, mouse drag or finger drag, the way the Previews tab adds a preview board. Both build the artboard with `buildCreativeBoard` and land through `handleAddCreativeBoards`, so translations and the history entry are the same either way. A click goes to the start of the canvas, like the dialog; a drop goes after the artboard it landed on, or to the start when it landed between boards. A finger lifted anywhere but the canvas adds nothing (`isOverCanvas` in the layout, which the Previews and element tiles go through too); a mouse drag needs no such check, since only the canvas answers its drop. A drag carries only `{ kind, lookId, appName }` (`CREATIVE_LOOK_DRAG_TYPE` in [paletteDrag.ts](../src/lib/creative/paletteDrag.ts)), and the board is built when it lands. The tab reads the project from `StoreArtSourceContext`, never through palette props: the palette is memoized because rebuilding its tiles on every edit made canvas drags stutter, and an inactive tab's content is unmounted, so the eight designs only cost anything while the tab is open. It builds them at low priority (`useDeferredValue`), so typing on the canvas does not wait for them.

## For agents and the MCP server

`create_artboard` takes the presets `appstore-header`, `appstore-search` and `appstore-universal`. The result and `list_artboards` carry `creativeAsset`, `safeArea` and `iphoneArea`, so an agent that cannot see the canvas still knows where the copy has to go and how much of the art a phone shows.

`export_all` names the art the way the export dialog does: no screenshot number, `AppStore_Header_3840x1646.png`, and `_2` on a second design of the same kind (both use `creativeFileStems` in [specs.ts](../src/lib/creative/specs.ts)).

## Where it lives

- [src/lib/creative/specs.ts](../src/lib/creative/specs.ts): the only registration site. Sizes, formats, safe areas, the iPhone windows, header buttons, file names, presets.
- [src/lib/creative/layouts.ts](../src/lib/creative/layouts.ts): reads the project's look and composes each look.
- [src/lib/creative/typeFit.ts](../src/lib/creative/typeFit.ts): how many lines copy sets in, measured or estimated, and the largest size that fits a box.
- [src/lib/fontsSettled.ts](../src/lib/fontsSettled.ts): when a font that text was measured without has arrived, in WebKit as well.
- [src/lib/creative/topEdge.ts](../src/lib/creative/topEdge.ts): the layers at a header's top edge, for the strip the preview draws above it.
- [src/lib/creative/check.ts](../src/lib/creative/check.ts): the store rules, per language.
- [src/lib/creative/paletteDrag.ts](../src/lib/creative/paletteDrag.ts): what a drag from the Header tab carries to the canvas.
- [creative/](../src/components/open-screenshot-generator/creative/): the add dialog, the palette's Header tab (`StoreArtPaletteTab.tsx`), the design thumbnail both draw with, the canvas guide and the check chip.
- [StoreListingPreview.tsx](../src/components/open-screenshot-generator/StoreListingPreview.tsx): the iOS 27 product page and search card.
- Tests: [tests/unit/creativeAssets.test.ts](../tests/unit/creativeAssets.test.ts) and [tests/e2e/specs/creative-assets.spec.ts](../tests/e2e/specs/creative-assets.spec.ts).

## Not done yet

- **Video.** Header and search video is 5 to 30 seconds and loops. The App Preview exporter already leads with H.264 High 5.1 for frames this big, a level that holds 3840 x 1646 at 30 fps; whether each machine's encoder accepts it is untested. An animated creative artboard exports as a still for now.
- **Upload.** The App Store Connect API takes this art through `appAssetLibraryImages` and `appAssetLibraryPlacements` with the placement types `PRODUCT_PAGE_HEADER_ASSET` and `APP_STORE_SEARCH_RESULTS_ASSET`. The desktop store upload could send it next to the screenshots.
- **iPad.** The preview is iPhone only. App Store Connect's preview has an iPad option nobody has measured yet, and the safe area is what holds for both.
- **In-App Event art** (16:9 card, 9:16 details page) would be two more entries in `CREATIVE_ASSETS`.
