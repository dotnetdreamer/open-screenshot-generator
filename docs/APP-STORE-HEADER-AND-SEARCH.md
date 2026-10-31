# App Store header and search art (iOS 27)

On 5 October 2026 Apple gave every App Store listing two new images, for apps and games on iOS 27 and iPadOS 27 and later. A **product page header** runs across the top of the product page, above the icon and name. A **search result** image shows under your app in the Search tab, in place of the three screenshots people saw there before. One **universal** image can stand in for both. All of them are optional, and a listing without them falls back to In-App Events, app previews and screenshots.

This was requested in [issue #46](https://github.com/dotnetdreamer/open-screenshot-generator/issues/46).

## Making them

1. Open your screenshots project and click the **App Store header and search art** button in the toolbar (the window icon next to the social graphics button). The store listing preview has a way in too.
2. Pick a look for the header and one for the search result, or switch to **One universal image**. Every card is built from your own project: its ground, typeface, headline and screens. If the project has more than one language, the art comes with every translation of the headline and every per-language screenshot.
3. Check the app name at the top. It starts from the project name, without the " Copy" a template adds. A template named after a look whose name the check would turn away, such as Editors Choice, leaves it empty for you to fill in.
4. Click **Add 2 artboards**. They land at the front of the canvas at Apple's exact sizes, next to your screenshots.

From there they are ordinary artboards. Edit them, translate them, duplicate one to keep a second version for a product page optimization test.

## What the canvas shows you

The green dashed box is Apple's **art safe area**, the part every device shows. Everything outside it is dimmed, because a device may cut it off. By our measurements an iPhone in portrait shows about the middle 43% of a header's width.

On header art, two dashed circles at the top corners of the safe area mark where iOS 27 floats the back and share buttons on an iPhone. Apple's templates do not show these, and text under them is hidden.

The chip next to the artboard's name shows what the check finds, in the language on screen. Click it for the list. It flags:

- the wrong size,
- prices and discounts, web addresses, copyright symbols, Apple recognitions such as Editors' Choice, and other platforms or stores, which App Review turns away (guideline 2.3.14),
- claims Apple cannot verify, such as "#1", awards, star ratings or press logos,
- text outside the safe area (for turned text, the area its box covers once turned), under a header button, too small to read on an iPhone, cut off by its own text box, or longer than a short phrase,
- a language with no words of its own on the art.

The text rules are patterns, so the check can miss a price written out in words, and it can flag an ordinary word. The softer rules are warnings for that reason. It looks at text only, not at pictures, and App Review has the last word.

## Seeing it in the store

**Preview, Store listing** shows the iOS 27 product page on an iPhone with your header at the top under the status bar and the glass buttons, your icon and name below it, then your screenshots. **Search results** shows the search card with your art. Both crop the art about the way Apple's own iPhone renders do. Apple publishes no crop numbers, so the crop is our measurement (see the notes below), and the safe area is what to design to. Light and dark work, and the language pills switch the whole listing.

App Store Connect's own preview, after upload, also shows iPad and landscape. This one is iPhone only.

## Exporting

**Export, Artboards as images** includes the header and search art. Each goes out once, at its own size, as an RGB PNG with no alpha channel, which App Store Connect requires. They are named for where they go in App Store Connect and do not take a screenshot number, so the screenshots still run 01 to N:

```
de-DE/AppStore_Header_3840x1646.png
de-DE/AppStore_SearchResult_3840x2560.png
de-DE/01_Home_iPhone_iPhone-6_3-Portrait_1206x2622.png
```

That is the desktop app, which gives each language a folder. The web build puts the language at the start of the name instead (`de-DE_AppStore_Header_3840x1646.png`).

A second header you renamed (say "Winter") exports as `AppStore_Header_Winter_3840x1646.png`. Two that keep the same name get a number, so neither replaces the other: the one further right on the canvas exports as `AppStore_Header_3840x1646_2.png`. The MCP `export_all` tool names them the same way.

The extra App Store sizes in the export dialog are screenshot sizes and never apply to this art. The Canvas Size dialog and the device format menu leave it alone too.

## Uploading

Upload in App Store Connect, under **Header and Search Results** on the version page, or submit it on its own from the **Asset Library**, where it is reviewed against your latest version and can be switched in later without a new build. For a universal image, tick **Use header asset in search results**. The store upload dialog in the desktop app sends screenshots and previews only for now.

## For agents and the MCP server

`create_artboard` takes the presets `appstore-header`, `appstore-search` and `appstore-universal`. The result and `list_artboards` carry `creativeAsset` and `safeArea`, so an agent that cannot see the canvas still knows where the copy has to go.

---

# Notes for maintainers

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

## Where it lives

- [src/lib/creative/specs.ts](../src/lib/creative/specs.ts): the only registration site. Sizes, formats, safe areas, iPhone crops, header buttons, file names, presets.
- [src/lib/creative/layouts.ts](../src/lib/creative/layouts.ts): reads the project's look and composes each look.
- [src/lib/creative/check.ts](../src/lib/creative/check.ts): the store rules, per language.
- [creative/](../src/components/open-screenshot-generator/creative/): the add dialog, the canvas guide and the check chip.
- [StoreListingPreview.tsx](../src/components/open-screenshot-generator/StoreListingPreview.tsx): the iOS 27 product page and search card.
- Tests: [tests/unit/creativeAssets.test.ts](../tests/unit/creativeAssets.test.ts) and [tests/e2e/specs/creative-assets.spec.ts](../tests/e2e/specs/creative-assets.spec.ts).

## Not done yet

- **Video.** Header and search video is 5 to 30 seconds and loops. The App Preview exporter already leads with H.264 High 5.1 for frames this big, a level that holds 3840 x 1646 at 30 fps; whether each machine's encoder accepts it is untested. An animated creative artboard exports as a still for now.
- **Upload.** The App Store Connect API takes this art through `appAssetLibraryImages` and `appAssetLibraryPlacements` with the placement types `PRODUCT_PAGE_HEADER_ASSET` and `APP_STORE_SEARCH_RESULTS_ASSET`. The desktop store upload could send it next to the screenshots.
- **iPad.** The preview is iPhone only. iPad shows more of the header, and the safe area is what holds for both.
- **In-App Event art** (16:9 card, 9:16 details page) would be two more entries in `CREATIVE_ASSETS`.
