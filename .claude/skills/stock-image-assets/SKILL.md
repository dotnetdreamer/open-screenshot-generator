---
name: stock-image-assets
description: Add properly licensed Adobe Stock photos to the Images palette library (e.g. the Touch hand group) via the Adobe MCP — search free-tier Stock, license through the user's account, remove backgrounds, install as trimmed PNGs, update imageLibrary.ts and the license record. Use when asked to add more stock images/photos to the image library, expand the Touch group, or add a new photographic asset group.
---

# Licensed Stock Images for the Images Palette

Adds photographic assets to the app's **Images** tab (`src/lib/imageLibrary.ts` +
`public/elements/images/<group>/`) using Adobe Stock, licensed through the
user's connected Adobe account so there is a real license record on file.

**Hard rules (user requirement — copyright):**
- NEVER crop assets out of reference screenshots the user shares — those only
  define what *kind* of asset to find.
- NEVER download artwork from the web (Wikimedia, official brand SVGs, etc.).
- Openverse/Wikimedia CC0+CC-BY were verified to have NO usable isolated studio
  photos — don't retry that route.
- Every shipped asset must trace to an Adobe Stock license; keep
  `docs/image-asset-licenses.md` up to date in the same change.

## Pipeline

1. **Init Adobe MCP** — call `adobe_mandatory_init` once, then load schemas via
   ToolSearch: `asset_search`, `asset_license_and_download_stock`,
   `image_remove_background` (+ `asset_inline_preview` if needed).

2. **Search free-tier Stock** —
   `asset_search({entityScope: "StockAsset", query: "...", filters: {pricing: "free", contentType: "Photo"}, limit: 30})`.
   - Queries like "hand pointing index finger isolated on white background"
     work well; "isolated on white" is the key phrase for cutout-friendly shots.
   - Combining `pricing` + `contentType` + `orientation` can return 0 hits —
     drop `orientation` if that happens.
   - `renditionURL` is a public CDN thumbnail (t3/t4.ftcdn.net) — safe to
     download with curl for curation; never ship it.

3. **Curate visually** — download rendition thumbnails, build a labeled contact
   sheet (`scripts/contact-sheet.js`), and pick a consistent set (varied poses
   and skin tones; avoid busy clothing/backgrounds, gimmick shots, and
   `isGenTech: true` results if real photos are wanted).

4. **License** — `asset_license_and_download_stock({assetId})` per asset.
   - Free-tier assets license without consuming paid credits
     (`state: "just_purchased"`).
   - Returned `downloadUrl` is a presigned S3 URL valid **1 hour**; re-calling
     refreshes the URL without consuming another license.
   - **Download the originals immediately after licensing.** The Adobe MCP
     session token can expire mid-batch ("Your session token is about to
     expire") and only the user can re-authenticate (claude.ai connector
     settings). Licenses are permanent, but locally saved originals let work
     continue (e.g. local keying) while Adobe is unavailable.

5. **Remove backgrounds** — `image_remove_background({imageURI: downloadUrl})`
   (default transparent-PNG cutout mode; no options needed). Output keeps full
   resolution up to 8192px (larger inputs are downscaled — fine). Download each
   `outputUrl` with `curl -L`. Occasional `HTTP 504` — retry once.
   - Fallback for crisp objects on plain white (food, products — NOT hair/people):
     local keying with `scripts/white-key.js <inDir> <outDir> <ids>`.

6. **Trim + install** — `node .claude/skills/stock-image-assets/scripts/trim-install.js <cutoutDir> <publicGroupDir>`
   trims transparent borders (alpha > 8, 6px pad), caps the longest side at
   1000px, and writes `<group>-as<StockID>.png`. The Stock ID in the filename
   is the provenance link — keep that convention.

7. **Update `src/lib/imageLibrary.ts`** — add items with:
   - `id`: filename without extension (`touch-as453449839`)
   - `label`: short human label ("Pointing up", "Side point · deep tone")
   - `defaultSize`: scale so the longest side ≈ 430 canvas units, preserving
     the PNG's aspect ratio.
   A new group only needs a new entry in `IMAGE_CATEGORIES`; the palette
   (`ElementPalette.tsx` Images tab) renders groups generically.

8. **Update the license record** — append rows to
   `docs/image-asset-licenses.md` (file, Stock ID, exact Stock title, license
   date). The user's full history lives at stock.adobe.com/license-history.

9. **Verify** — use the `app-screenshots` skill: Images tab → Browse <Group> →
   screenshot the grid → click a tile (`button[title="Add <label>"]`) → confirm
   `[data-element-id]` count increments and the photo renders on the artboard.

## Store badges: use OFFICIAL vendor artwork only

Hand-drawn lookalike badges were rejected by the user ("knockoff"). The Badges
group uses each vendor's official badge program artwork (this is the
copyright-correct route — the badges exist for exactly this promotional use):

- Apple: `https://developer.apple.com/assets/elements/badges/download-on-the-app-store.svg`
- Google Play: `https://play.google.com/intl/en_us/badges/static/images/badges/en_badge_web_generic.png`
- Microsoft Store: `https://get.microsoft.com/images/en-us%20dark.svg`
- Amazon Appstore: `https://images-na.ssl-images-amazon.com/images/G/01/mobile-apps/devportal2/res/images/amazon-appstore-badge-english-black.png`
- F-Droid: `https://f-droid.org/badge/get-it-on.png`
- Samsung Galaxy Store badge URL (img.samsungapps.com) returns an HTML error — no known direct link.

Keep badges unmodified per vendor guidelines; record source + terms links in
`docs/image-asset-licenses.md`.

## Existing wiring (don't rebuild)

- Palette: `ElementPalette.tsx` has the Images tab; tiles pass
  `{imageSrc, imageAlt, name, defaultSize}` styleProps with type `'image'`.
- Canvas: `Artboard.tsx`'s image branch consumes those styleProps and sets
  `objectFit: 'contain'` for library assets.
- `next.config.ts` has `images.unoptimized: true`, so plain public paths work.

## License scope (documented in docs/image-asset-licenses.md)

Adobe Stock standard license covers commercial use in composited exports.
Bundled palette assets are for composing exports — fine. If the app is ever
marketed as a general asset marketplace/stock service, revisit the bundling
question before adding more.
