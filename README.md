# Artboard Studio

A browser-based editor for designing app store screenshots. You lay out artboards on a canvas, place device mockups on them, load your app screenshots into the frames, add text and shapes around them, and export PNGs at the exact sizes Google Play and the Apple App Store ask for.

Everything runs client-side. Projects are saved to your browser's IndexedDB, so there is no account, no backend, and nothing leaves your machine.

<p align="center">
  <a href="docs/promo-fast.mp4">
    <img src="docs/promo-poster.png" alt="Artboard Studio promo video, click to play" width="900">
  </a>
</p>
<p align="center">
  <em>A 36 second tour. Click the image to play the video.</em>
</p>

## What it does

- Multiple artboards on one canvas: add, duplicate, rename, and drag them around, with undo/redo across the whole project
- Device frames for iPhone (X through 15 Pro), Android (bar, notch, punch-hole), tablet, and desktop, plus custom frames from your own mockup images
- Screenshots dropped into a frame stay clipped to the device screen; frames can be rotated, scaled, and tilted using perspective presets or a raw CSS `matrix3d` if you need full control
- Text, shapes (rectangles, circles, stars, speech bubbles, custom SVG paths, and more), and plain images as freely placed elements
- A curated set of Google Fonts, including Arabic and Urdu families like Cairo, Amiri, and Noto Nastaliq Urdu, alongside the usual system fonts
- Layers panel for ordering and a properties panel for fine-tuning whatever is selected
- Copy and paste elements within and across artboards
- An export flow that asks which store (Google Play or App Store) and which device classes you're targeting, then renders each artboard to PNG at the store's required dimensions
- Bundled example projects to start from instead of a blank canvas
- An AI agent that builds the project for you from your app screenshots (see below)

## Download the desktop app

Grab the latest installer from the [Releases page](https://github.com/dotnetdreamer/artboard-studio/releases/latest):

| Platform | File |
| --- | --- |
| Windows 10/11 | `Artboard.Studio_<version>_x64-setup.exe` (or the `.msi`) |
| macOS 10.15+, Intel and Apple silicon | `Artboard.Studio_<version>_universal.dmg` |
| Linux | `.AppImage` (portable) or `.deb` |

The builds are not code-signed yet, so the first launch takes one extra click: on Windows, SmartScreen shows "Windows protected your PC", so choose More info, then Run anyway. On macOS, right-click the app and choose Open to get past Gatekeeper. On Linux, `chmod +x` the AppImage first.

Prefer the browser? The same app runs at [dotnetdreamer.github.io/artboard-studio](https://dotnetdreamer.github.io/artboard-studio/). See [docs/DESKTOP.md](docs/DESKTOP.md) for how the desktop build differs.

## Running it locally

You'll need Node 18.18 or newer (that's Next.js 15's minimum).

```bash
git clone https://github.com/<your-username>/artboard-studio.git
cd artboard-studio
npm install
npm run dev
```

The dev server runs on http://localhost:9002 with Turbopack. When the app opens, pick one of the bundled templates or start blank, and you're in the editor.

<p align="center">
  <img src="docs/screenshot-home.png" alt="The start screen: a grid of bundled template cards and a Start Blank button" width="700">
</p>
<p align="center">
  <em>The start screen — pick a template or start with a blank canvas.</em>
</p>

Other scripts:

- `npm run build` makes a production build
- `npm run lint` runs ESLint via Next
- `npm run typecheck` runs `tsc --noEmit`

One thing to watch: `npm start` currently re-runs the dev server rather than serving a build. For a production build, run `npm run build` and then `npx next start`.

## How the code is organized

The app is a single Next.js page ([src/app/page.tsx](src/app/page.tsx)) that mounts the editor. The interesting parts live under [src/components/artboard-studio/](src/components/artboard-studio/):

- [ArtboardStudioLayout.tsx](src/components/artboard-studio/ArtboardStudioLayout.tsx) is the top-level component holding most of the state (artboards, selection, undo history, project save/load) and doing the PNG export with `html-to-image`
- [CanvasArea.tsx](src/components/artboard-studio/CanvasArea.tsx) and [Artboard.tsx](src/components/artboard-studio/Artboard.tsx) render the pannable, zoomable canvas and the individual artboards on it
- [elements/](src/components/artboard-studio/elements/) holds the renderers for the four element types (text, shape, image, and device frame)
- The panels and dialogs around the canvas: [ElementPalette.tsx](src/components/artboard-studio/ElementPalette.tsx), [LayersPanel.tsx](src/components/artboard-studio/LayersPanel.tsx), [PropertiesPanel.tsx](src/components/artboard-studio/PropertiesPanel.tsx), toolbars, and the export/preview dialogs

Around that:

- [src/types/artboard.ts](src/types/artboard.ts) defines the whole data model: artboards, the four element types, and projects. If you read one file before touching anything, make it this one; the rest of the codebase is mostly functions that manipulate these types.
- [src/components/ui/](src/components/ui/) has the shadcn/ui-style primitives built on Radix
- [src/services/](src/services/) covers template loading and the Google Fonts helpers
- [src/database.ts](src/database.ts) is the Dexie (IndexedDB) setup, a single `projects` table
- [src/lib/elementLibrary.ts](src/lib/elementLibrary.ts) supplies default props for newly added elements

## The AI agent

The start dialog opens on three choices: start with the AI agent, pick a template, or start blank.
The agent takes your app screenshots plus a sentence about what you want ("put these in a clean dark
template", "use Breathora", "design something new") and produces a finished project: template chosen,
screenshots placed in the device mockups, copy rewritten for your app.

However it runs, it always produces the same thing: an `AgentPlan`, a small
zod-validated JSON document that [buildProjectFromPlan.ts](src/lib/ai/buildProjectFromPlan.ts) turns
into a project deterministically. The model only fills slots (which template, which screenshot goes in
which frame, what the text says, or a constrained new-design spec). It never emits coordinates or
element trees, so a bad plan produces an odd project rather than a broken canvas.

**Use my API key.** Calls go straight from your browser to Anthropic, OpenAI or Google through the
Vercel AI SDK ([providers.ts](src/lib/ai/providers.ts)). The app is a static export with no server, so
there is nowhere else for them to go: your key stays on your machine, and it is only written to
localStorage if you tick "remember on this device".

**Free, use my account.** Uses whatever Claude, ChatGPT, Gemini (and beta: Copilot, DeepSeek, Qwen,
Perplexity) session you are already signed into. In the desktop app this drives the provider in an
embedded window with no extension needed (see [docs/DESKTOP.md](docs/DESKTOP.md)). In the browser it
runs through the small companion extension in [extension/](extension/README.md), and without the
extension the panel falls back to a manual relay (copy the prompt, paste it into the chat, paste the
answer back), so the mode works everywhere.

**Free, built in.** Desktop only: keyless providers (Pollinations, or a local Ollama / LM Studio),
also covered in [docs/DESKTOP.md](docs/DESKTOP.md).

**How the templates reach the model.** The catalog of all templates is too big to paste into a chat
(ChatGPT's free tier rejects the message outright). So "use my account" runs are URL-first: the
message carries only a link to [public/data/ai/catalog.txt](public/data/ai/catalog.txt), the full
catalog hosted by this repo's Pages deployment, and the model must echo the file's verification
token to prove it actually fetched it. If it can't, the app falls back to an inline catalog that is
prefiltered, id-aliased, and shrunk to the provider's message cap. The whole scheme, its fallbacks,
and the tuning knobs are documented in [docs/AI-AGENT.md](docs/AI-AGENT.md).

The prompts, the catalog builders, and the plan schema all live in [src/lib/ai/](src/lib/ai/).

## Storage and templates

Saved projects live in IndexedDB under a database called `ProjectDatabase`. Clearing site data deletes them, so treat exported PNGs as your real output and the browser store as a working copy.

Templates are plain JSON files in [public/data/projects/](public/data/projects/), fetched at runtime. The file list is hardcoded in [projectService.ts](src/services/projectService.ts), so adding your own template means dropping a JSON file in that folder and adding its filename to the array. A template is essentially a saved array of artboard states. The practical way to make one is to design it in the app and copy the shape of an existing template file.

After adding or editing templates, regenerate the AI agent's hosted catalog with `npm run gen:ai-catalog` (a normal `npm run build` also does it) so [public/data/ai/catalog.txt](public/data/ai/catalog.txt) stays in sync; see [docs/AI-AGENT.md](docs/AI-AGENT.md).

## Loose ends worth knowing about

- `next build` is configured to ignore TypeScript and ESLint errors ([next.config.ts](next.config.ts)), so a passing build doesn't mean the types are clean. Run `npm run typecheck` yourself before opening a PR.
- [src/ai/](src/ai/) contains Genkit scaffolding (Google AI plugin, plus the `genkit:dev` and `genkit:watch` scripts), but no flows are wired up yet. The app runs fine without it. The AI agent does not use it; that lives in [src/lib/ai/](src/lib/ai/) and runs entirely client side.
- The companion extension's site adapters are CSS selectors ([extension/src/adapters/](extension/src/adapters/)). When Claude, ChatGPT or Gemini redesign, a selector list needs updating; the manual relay keeps working in the meantime.
- There's no test suite at the moment; `typecheck` and `lint` are the safety net.

## Contributing

Issues and pull requests are welcome. If you're planning something bigger than a bug fix, open an issue first so we can talk it through before you spend time on it.

There's no license file in the repo yet. If that's blocking you from using or contributing to the project, open an issue.
