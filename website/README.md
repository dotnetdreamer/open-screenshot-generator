# Open Screenshot Generator marketing website

The marketing site for [openscrgen.app](https://openscrgen.app/). Static HTML,
CSS and JavaScript, with no build step or bundler

- `index.html` is the homepage, styled by `css/home.css`, `css/hero.css` and
  `css/agent-connections.css`, with interactions in `js/home.js`
- `js/home.js` switches between three exported template sets, updates a headline
  example in four languages, opens the mobile navigation, and controls the
  hero preview and film dialog
- `css/main.css` serves the other landing and legal pages. The homepage no longer
  loads `js/main.js` or `js/film.js`
- `app-ratings-and-reviews.html` is the page for Growth's ratings and reviews in
  the desktop app. It uses the homepage's `css/home.css`, `css/hero.css` and
  `js/home.js`, plus `css/ratings-reviews.css` for its screenshot frames and
  close-up cards
- `compare.html` (URL `/compare`, linked from the homepage menu) puts Open
  Screenshot Generator next to other screenshot tools: a price chart, one big
  table, a card for each tool and the pages every answer came from. It uses the
  homepage's `css/home.css`, `css/hero.css` and `js/home.js`, plus
  `css/compare.css` and `js/compare.js`, which fades the tools that can't do
  what a visitor picks and can show one tool next to ours. The table holds every
  answer as a `data-v` value on its cell, and the script only reads them. When
  a price or a feature changes, update the table, the tool's card, the price
  chart and the date checked together
- `privacy.html` and `terms.html` are the legal pages
- `assets/img/` holds real exports and screenshots from the app. The homepage adds
  PNG copies from `docs/` and `public/` alongside the existing WebP imagery
- `robots.txt`, `sitemap.xml`, `llms.txt`, and the structured data in `index.html`
  describe the site for search engines and other readers
- `vercel.json` sets the caching and security headers

The homepage uses native scrolling and the normal cursor. Its hero plays the
92 second product film without sound. The preview pauses outside the viewport
and stays still when reduced motion is requested. Watch with sound opens the
same film in a native dialog with playback controls and captions

Headings, feature copy, images, template links and FAQs are present in the HTML
without JavaScript; the template and language examples show their initial state,
and the film link opens the MP4. Fonts load from Google Fonts

## Product footage

`assets/video/feature-reel.mp4` is the 92 second film with its music, and
`feature-reel-preview.mp4` is the same film without sound at a lower bitrate,
for the hero. `feature-reel-poster.jpg` is the film's title frame, shown before
playback, and `feature-reel.vtt` has the captions, which are the film's own
on-screen words with its scene timings

The film is the `PromoFeatures` composition. It follows a made up app, Juniper,
and every screen in it is the real app. How it is filmed, cut to its music and
rendered is in [promo/README.md](../promo/README.md), under the feature reel.
The two MP4s are encoded from its render at CRF 23 (with sound) and CRF 29
(without), converted to standard range H.264 with fast start

`launch-promo.mp4` and `hero-editor-loop.mp4`, the earlier 32 second film and
the editor loop, are still in the folder but no page uses them. Their rebuild
instructions are in [promo/launch-README.md](../promo/launch-README.md)

## Copy rules

Two conventions apply to every visible string on these pages, so keep them when editing

- No dash characters inside a sentence. No em dash, no en dash, and no hyphenated
  compounds. Write "store ready", not the hyphenated form. Hyphens inside URLs,
  file names, and code are fine
- No trailing period at the end of a block of copy. Sentences inside a paragraph
  still take their periods, but the last one is dropped. Headings, list items,
  and buttons never end with a dot

## Preview locally

Any static file server works

```bash
npx serve website
# or
python -m http.server 8080 -d website
```

Use HTTP for the local preview

## Deploying to Vercel

The website lives on Vercel; the editor stays on GitHub Pages at
`editor.openscrgen.app` (that deploy is driven by
[.github/workflows/deploy.yml](../.github/workflows/deploy.yml) and
`public/CNAME`). The two are independent, so a website deploy never touches the app

Import this repository in Vercel and set

| Setting | Value |
| --- | --- |
| Framework preset | Other |
| Root directory | `website` |
| Build command | leave empty |
| Output directory | leave empty (Vercel serves the root directory as static) |
| Install command | leave empty |

Then add `openscrgen.app` (and `www.openscrgen.app` if you want it) as a domain
on the Vercel project, and point the apex DNS at Vercel. Leave the `editor`
subdomain alone, because it still resolves to GitHub Pages

From the CLI it is the same two steps

```bash
npm i -g vercel
cd website
vercel        # preview deploy
vercel --prod # production deploy
```

Vercel redeploys on every push to `main` once the project is linked

## Updating imagery

All page imagery comes from the app. The homepage's `product-editor.png`,
`product-video.png`, `product-export.png` and `product-listing.png` are copies
of the corresponding screenshots in `docs/`. Its three `showcase-*.png` files
copy the Kassa, Scrappi and Pixara exports from `public/data/projects/previews/`;
`example-finance-screen.png` comes from the Kassa template's app screens in
`public/data/projects/`

The ratings and reviews page uses `reviews-*.webp` and `og-ratings-reviews.png`.
They are captures of Growth in the desktop build (WebKit, dark theme, with the
e2e Tauri mock) showing the made up Juniper app from
`tests/fixtures/growthSample.ts`, an invented competitor and reply drafts
written for the capture. The page labels every one of them as an example. Each
full window image comes in a 1x and a 2x width for `srcset`

The download badges in `assets/img/badges/` are copies of the ones in
[docs/badges/](../docs/badges/README.md), where their sources and rules are.
The homepage shows them under the hero's button and the closing call to action,
styled by `.store-intro` and `.store-badges` in `css/home.css`

To refresh imagery, export from the app or capture new shots with the
`app-screenshots` skill, then update the matching files in `assets/img/`.
Existing WebP exports also come from `promo/public/`; the ffmpeg conversion
commands are in git history
