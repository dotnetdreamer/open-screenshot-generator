# Open Screenshot Generator marketing website

The marketing site for [openscrgen.app](https://openscrgen.app/). Pure static files: no build step, no bundler, nothing to install.

- `index.html` is the landing page: three.js scroll scene (template strips, the three step flow, the template wall) driven by GSAP ScrollTrigger.
- `privacy.html` and `terms.html` are the legal pages.
- `assets/img/` holds real exports and screenshots from the app itself (converted to WebP from `promo/public/`).
- `robots.txt`, `sitemap.xml`, `llms.txt`, and the JSON-LD in `index.html` cover SEO and LLM readability.
- `vercel.json` sets the caching and security headers.

three.js and GSAP load from jsDelivr; fonts from Google Fonts. Everything degrades gracefully: without JavaScript, without WebGL, or with reduced motion enabled, the page falls back to the static images already present in the markup.

## Copy rules

Two conventions apply to every visible string on these pages, so keep them when editing:

- No dash characters inside a sentence. No em dash, no en dash, and no hyphenated compounds. Write "store ready", not the hyphenated form. Hyphens inside URLs, file names, and code are fine.
- No trailing period at the end of a block of copy. Sentences inside a paragraph still take their periods, but the last one is dropped. Headings, list items, and buttons never end with a dot.

## Preview locally

Any static file server works:

```bash
npx serve website
# or
python -m http.server 8080 -d website
```

Do not open `index.html` via `file://` because ES modules and the import map need HTTP.

## Deploying to Vercel

The website lives on Vercel; the editor stays on GitHub Pages at `editor.openscrgen.app` (that deploy is driven by [.github/workflows/deploy.yml](../.github/workflows/deploy.yml) and `public/CNAME`). The two are independent, so a website deploy never touches the app.

Import this repository in Vercel and set:

| Setting | Value |
| --- | --- |
| Framework preset | Other |
| Root directory | `website` |
| Build command | leave empty |
| Output directory | leave empty (Vercel serves the root directory as static) |
| Install command | leave empty |

Then add `openscrgen.app` (and `www.openscrgen.app` if you want it) as a domain on the Vercel project, and point the apex DNS at Vercel. Leave the `editor` subdomain alone, because it still resolves to GitHub Pages.

From the CLI it is the same two steps:

```bash
npm i -g vercel
cd website
vercel        # preview deploy
vercel --prod # production deploy
```

Vercel redeploys on every push to `main` once the project is linked.

## Updating imagery

All page imagery comes from the app. To refresh it, re-export from `promo/public/` (see the ffmpeg conversion commands in git history) or capture new shots with the `app-screenshots` skill, then drop WebP files into `assets/img/` with the same names.
