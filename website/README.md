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
- `privacy.html` and `terms.html` are the legal pages
- `assets/img/` holds real exports and screenshots from the app. The homepage adds
  PNG copies from `docs/` and `public/` alongside the existing WebP imagery
- `robots.txt`, `sitemap.xml`, `llms.txt`, and the structured data in `index.html`
  describe the site for search engines and other readers
- `vercel.json` sets the caching and security headers

The homepage uses native scrolling and the normal cursor. Its hero shows the
current editor and Agent dock. The silent 10 second preview pauses outside the
viewport and stays still when reduced motion is requested. A visitor starts the
32 second film through a native dialog with playback controls and captions

Headings, feature copy, images, template links and FAQs are present in the HTML
without JavaScript; the template and language examples show their initial state,
and the film link opens the MP4. Fonts load from Google Fonts

## Product footage

`assets/video/launch-promo.mp4` is the 32 second film; `hero-editor-loop.mp4`
is the silent 1920 by 840 preview. Their JPG posters keep the editor visible
before playback, and `launch-promo.vtt` supplies the film captions

The visuals use current product captures from `promo/public/launch/`. The Agent
dock uses an isolated example conversation, labelled on screen, with no live
provider requests. The hero image is a rendered frame from that capture

Rebuild instructions, the original score and the Remotion compositions are
listed in [promo/launch-README.md](../promo/launch-README.md)

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

To refresh imagery, export from the app or capture new shots with the
`app-screenshots` skill, then update the matching files in `assets/img/`.
Existing WebP exports also come from `promo/public/`; the ffmpeg conversion
commands are in git history
