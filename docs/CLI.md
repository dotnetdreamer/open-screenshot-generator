# The CLI (npm package `open-screenshot-generator`)

Open Screenshot Generator ships as an npm package with a `osg` bin. It produces
store screenshots, App Store preview videos, localized sets and manifests from a
terminal, from a CI job, or from a coding agent, with no window open.

It contains no renderer of its own. It starts a loopback HTTP origin, serves the
same Next.js static export the web and desktop apps run, launches a headless
Chrome or Edge against it, and drives the page through the `window.__osg` bridge
in [src/lib/headless/bridge.ts](../src/lib/headless/bridge.ts). Every entry point
on that bridge lands in the function a click in the UI lands in, so a PNG the CLI
writes is byte for byte the PNG the app writes, and a project it builds is
indistinguishable from a hand made one.

That is the whole design constraint. Anything the CLI can do, the app can do, and
adding a feature to one is adding it to both.

## Layout

| Path | Purpose |
| --- | --- |
| `cli/src/cli.ts` | Argv, config load, dispatch, the top level error printer |
| `cli/src/args.ts` | The dependency free argv parser (`--k v`, `--k=v`, `-k v`, `--no-k`, `--`) |
| `cli/src/config.ts` | `OsgConfig`, the resolution order, `DEFAULTS` |
| `cli/src/context.ts` | `CommandContext`: what every command is handed, including the lazy session |
| `cli/src/errors.ts` | `OsgError` and the four exit codes |
| `cli/src/log.ts` | `info`/`step`/`ok`/`warn`/`fail`/`debug` on stderr, `emit` the only writer of stdout |
| `cli/src/paths.ts` | Where the caches live on each OS |
| `cli/src/driver/session.ts` | The live session: origin, browser, page, bridge, and the one-call-in-flight queue |
| `cli/src/editor/resolve.ts` | Where the editor bundle comes from, in order |
| `cli/src/editor/server.ts` | The loopback origin, artwork hydration, `/__osg/media/` file publishing |
| `cli/src/editor/assets.ts` | The content addressed artwork cache and its sha256 checks |
| `cli/src/browser/find.ts` | Browser discovery, branded builds first, because of H.264 |
| `cli/src/browser/launch.ts` | Launch, the Edge spawn fallback, the font cache, the container flags |
| `cli/src/commands/` | One module per command, each `export async function run(ctx)` |
| `cli/editor/` | The packed editor bundle, written by `npm run pack:editor` at publish time |
| `cli/assets.manifest.json` | Path to sha256 and byte count for every hydratable asset |
| `cli/skills/` | The agent skills the package installs |

## Install and run

```sh
npx -y open-screenshot-generator@0 doctor     # no install
npm i -g open-screenshot-generator            # then: osg doctor
```

Node 20.12 or newer, which is what `engines` in `cli/package.json` states. The
only runtime dependencies are `puppeteer-core`, `@puppeteer/browsers` and `jiti`,
because every dependency is time an agent waits for on an `npx` cold start.
`puppeteer-core` downloads no browser; `@puppeteer/browsers` is used only by
`doctor --install-browser`; `jiti` is what makes an `osg.config.ts` loadable with
no build step.

## The shape of a run

Three paths matter and every command resolves them the same way.

| Thing | Default | Overridden by |
| --- | --- | --- |
| The config | `osg/osg.config.ts` | `--config`, `$OSG_CONFIG` |
| The project file | `osg/project.json` | `--project`, `config.project` |
| The output directory | `osg/out` | `--out`, `config.out` |

Everything relative in the config resolves against the config's **root**, which
is the config's own directory, except for a config under `osg/`, whose root is
the directory above. That is deliberate: `screenshots: 'shots'` in
`osg/osg.config.ts` should mean the repository's `shots` folder, not
`osg/shots`.

A typical tree after a full run:

```
osg/
  osg.config.ts
  .gitignore              # ignores out/ and the project's media
  project.json            # the committed design, the thing you edit
  manifest.json           # what exists, written by `osg manifest`
  out/
    appstore/
      en-US/
        ios-6-9/01-track-every-run.png        1290 x 2796
        ipad-13/01-track-every-run.png        2064 x 2752
        preview-iphone/preview.mp4            886 x 1920, 30 fps, H.264
      de-DE/
        ios-6-9/01-jeden-lauf-aufzeichnen.png 1290 x 2796
```

`project.json` is the artefact worth committing. The PNGs are derived and can be
regenerated from it at any time, on any machine, in any language.

## Global flags

Accepted by every command.

| Flag | Effect |
| --- | --- |
| `--config <path>` | Use this config file. Highest priority, errors if missing |
| `--project <path>` | The project file to read and write |
| `--out <dir>` | Where rendered files land, and where browser downloads are caught |
| `--editor-url <url>` | Drive a running editor instead of the packaged bundle |
| `--browser <path>` | An explicit Chrome, Edge or Chromium executable |
| `--headed` | Show the browser window. The only way to watch a run |
| `--offline` | Refuse every request that is not to the local origin |
| `--json` | One machine readable object on stdout, everything human on stderr |
| `--verbose` | Per request debug lines, page console errors, timings |
| `--quiet` | Suppress the human lines. Warnings and failures still print |
| `--assets-base-url <url>` | Where artwork is hydrated from. Defaults to the project's deployment |
| `--timeout <ms>` | Ceiling for a single bridge call |

The parser takes `--key value`, `--key=value`, `-k value`, bare `--flag`,
`--no-flag` for the negation, and `--` for passthrough. A repeated key collects,
so `--locales en --locales de` and `--locales en,de` are the same thing.

## Environment

| Variable | Effect |
| --- | --- |
| `OSG_CONFIG` | Config path, used when `--config` is absent |
| `OSG_EDITOR_URL` | Same as `--editor-url` |
| `OSG_EDITOR_DIR` | A directory holding an editor build (`index.html` plus `_next/`) |
| `OSG_BROWSER` | Same as `--browser` |
| `OSG_CACHE_DIR` | Move every cache this CLI owns under one root you name |
| `OSG_API_KEY` | The key `osg design` uses, unless `ai.apiKeyEnv` names another variable |
| `CHROME_PATH`, `PUPPETEER_EXECUTABLE_PATH` | Honoured when nothing more specific is set |
| `NO_COLOR` | Turn off the ANSI colours on stderr |
| `CI` | Treated as a container signal on Linux. See [CI](#ci) |

Never put a key in the config file. `ai.apiKeyEnv` names the variable; the value
stays in the environment.

## Exit codes

Contractual, because the CLI is driven by agents and CI at least as much as by
people. An agent that sees `3` knows the render happened and the files are wrong.
One that sees `2` knows nothing was produced.

| Code | Meaning |
| --- | --- |
| `0` | Ok |
| `1` | Usage, config or environment error. Fixable before running again |
| `2` | Driver or render failure: the browser, the page, or a tool call |
| `3` | Verify failure: the files exist and a store rule rejects them |

Every failure is an `OsgError` carrying one actionable `fix` line, printed under
the message. Never a stack trace, unless `--verbose`.

## Commands

Each command is one module exporting `run(ctx): Promise<number>`. None of them
call `process.exit`, and none of them write stdout except through `emit`, which
is what keeps `--json` parseable and lets `osg all` call the others in process.

### `osg init`

Scaffolds `osg/osg.config.ts` and `osg/.gitignore`, then prints the next three
commands. Writes nothing else and never overwrites an existing config.

| Flag | Effect |
| --- | --- |
| `--format ts\|js\|json` | Which config flavour to write. Default `ts` |
| `--name <app name>` | Prefill `name` |
| `--store appstore\|play` | Prefill `store` |
| `--force` | Overwrite an existing config |

### `osg doctor`

The preflight. Runs no design work and is safe to run anywhere.

It reports the node version, the browser it found and its flavour, whether that
browser has a usable H.264 encoder (probed for real in the page, not guessed
from the executable name), where the editor bundle resolves from, the asset cache
size and hit rate, the font cache size, and whether the loopback origin comes up.

| Flag | Effect |
| --- | --- |
| `--install-browser` | Download a browser with `@puppeteer/browsers` into the CLI cache |
| `--json` | The whole report as one object |

Exits `1` if any check fails. On a machine with only an open Chromium build the
H.264 check fails and the message says which commands that costs you (`osg video`
and the video parts of `osg all`) and which it does not (everything else).

`--install-browser` fetches Chrome for Testing, which has **no** H.264. It is the
right answer for a CI container that renders PNGs and the wrong one for a machine
that needs MP4. Install branded Chrome or Edge for that.

### `osg templates`

Lists and searches the 101 bundled templates. Browser free and instant: it reads
the template JSON out of the packaged bundle and never starts a session.

| Flag | Effect |
| --- | --- |
| `--search <text>` | Match name, category and copy |
| `--category <id>` | `app-screenshots`, `apple-watch`, `mac`, `app-preview`, `feature-graphic` |
| `--slots <n>` | Only templates with this many device slots |
| `--limit <n>` | Cap the list |
| `--json` | Ids, names, categories, slot counts, board sizes |

```sh
osg templates --search dark --json | jq -r '.templates[] | "\(.id)\t\(.deviceSlots)"'
```

### `osg new`

Creates a project from a named template, places screenshots into the device
slots in the order they are given, and writes the project file.

| Flag | Effect |
| --- | --- |
| `--template <id>` | Required unless `config.template` is set |
| `--screenshots <dir>` | The folder of app screenshots |
| `--name <app name>` | Written into the project and used in filenames |
| `--formats <ids>` | Size preset ids to build boards for |
| `--locales <codes>` | Languages to add up front |

### `osg import`

Pulls an app's existing App Store listing so you have something to start from:
the app name, the icon, and the screenshots currently live on the product page.

| Flag | Effect |
| --- | --- |
| `--app-id <id>` | The numeric App Store id, or a full product page URL |
| `--country <cc>` | Storefront to read. Default `us` |
| `--into <dir>` | Where to write what it pulls. Default `./imported` |
| `--json` | The listing metadata as one object |

This reads a public product page. It is not App Store Connect and needs no
credentials. `osg upload` is the one that does.

### `osg fill`

The deterministic path. No model, no key, no network beyond artwork hydration.

It reads your screenshots, derives an index from each template's own
`projectData` rather than a hand written tag file, ranks the 101 templates on
device slot count against screenshot count, category inferred from the
screenshots' aspect ratio, and keyword match against `--instruction` if you give
one, then fills the chosen template and re-fits every text box so nothing clips.

| Flag | Effect |
| --- | --- |
| `--screenshots <dir>` | The folder of app screenshots |
| `--template <id\|auto>` | Force a template, or let the ranking pick. Default `auto` |
| `--instruction <text>` | Keywords that bias the ranking. Not a prompt, no model reads it |
| `--top <n>` | Report the top n candidates instead of committing to one |
| `--dry-run` | Rank and report, write nothing |
| `--json` | The ranking, the chosen template, and what was placed where |

Because the ranking is pure, `--dry-run --json` is repeatable and diffable, which
is what makes it useful inside a bigger script.

### `osg design`

The AI agent. Screenshots plus an instruction become a finished project: template
chosen, screenshots placed, copy rewritten for your app.

```sh
osg design ./shots "clean dark theme, running tracker, headline the streaks"
```

| Flag | Effect |
| --- | --- |
| `--screenshots <dir>` | The folder of app screenshots. Also the first positional |
| `--provider <id>` | `anthropic`, `openai`, `google`, `openai-compatible`, or a free provider id |
| `--model <id>` | The model |
| `--base-url <url>` | For `openai-compatible`. Any endpoint that speaks the dialect |
| `--api-key <key>` | Prefer `OSG_API_KEY` or `ai.apiKeyEnv`. A key on a command line ends up in shell history |
| `--locales <codes>` | Ask the agent to produce these languages too |

The model only fills slots. It emits an `AgentPlan`, a small zod validated JSON
document, and [buildProjectFromPlan.ts](../src/lib/ai/buildProjectFromPlan.ts)
turns that into a project deterministically. It never emits coordinates or
element trees, so a bad plan produces an odd project rather than a broken canvas.
The prompt architecture, the catalog modes and their fallbacks are in
[AI-AGENT.md](AI-AGENT.md).

The account modes ("use my Claude/ChatGPT/Gemini login") are **not** available
here. They need an embedded browser signed into the provider, which is the
desktop app's job, see [DESKTOP.md](DESKTOP.md). From the CLI it is your key or
your endpoint, and the call goes straight from this machine to it.

### `osg edit`

Runs design tool calls against the open project. This is the batch door: one
session, one browser, many mutations, in order.

| Flag | Effect |
| --- | --- |
| `--tool <name>` | One tool, repeatable |
| `--args <json>` | Arguments for the preceding `--tool` |
| `--script <file>` | A JSON or JSONL file of `{tool, args}` entries |
| `--stdin` | Read that same shape from stdin |
| `--save` | Write the project file when the batch succeeds. Default on |
| `--json` | Every result, in order |

```sh
osg edit --tool set_background --args '{"artboardId":"a1","color":"#0b1120"}' \
         --tool update_element --args '{"id":"t3","text":"Beat your best"}'

cat plan.jsonl | osg edit --stdin --json
```

Calls are serialized. The app's design api closes over the artboards of the
render that produced it, so two mutations dispatched in the same tick both read
the pre change state and the second silently clobbers the first. The session
queue in `driver/session.ts` is what makes forty element edits land as forty
edits rather than as one. Do not try to parallelise it.

### `osg call`

One tool call, the raw JSON result on stdout, nothing else. The primitive `osg
edit` is built from, and the one to reach for in a shell pipeline.

```sh
osg call list_artboards | jq '.artboards | length'
osg call export_png --args '{"artboardId":"a1","scale":0.25,"save":true}'
```

| Flag | Effect |
| --- | --- |
| `--args <json>` | Arguments object |
| `--tools` | List the 49 tools and their input schemas instead of calling one |

### `osg render`

The store PNG run. Renders every board, once per format and once per locale.

| Flag | Effect |
| --- | --- |
| `--formats <ids>` | Size preset ids. Default `config.formats` |
| `--locales <codes>` | Languages. Default `config.locales`, or just the base |
| `--only <board ids>` | Render a subset |
| `--scale <n>` | 0.1 to 4. A cheap proof while iterating |
| `--json` | Every file written, with its size and dimensions |

The render goes through the app's own export flow (`handleConfirmExport`), which
is what converts a board to a format it was not designed at: the elements are
scaled uniformly to the new canvas and re-centred, and text is scaled by
`fontSize` rather than by transform, because text renders at `fontSize / 0.3` px
and ignores `element.scale`. That is why one canvas covers every size, and why
the numbers come out identical to the desktop export.

### `osg video`

The MP4 app preview run. Needs a branded Chrome or Edge: the encode goes through
WebCodecs `VideoEncoder` with an `avc1` config, which an open Chromium build does
not have.

| Flag | Effect |
| --- | --- |
| `--mode store-raw\|store-text\|styled` | Which of the three renders |
| `--recording <file>` | A screen capture on disk, served to the page over the local origin |
| `--fps <n>` | Default 30 |
| `--duration <s>` | Board length in seconds. Apple accepts 15 to 30 |
| `--locales <codes>` | One MP4 per language |

The three modes, and why:

- `styled` renders the whole artboard: background, text, phone frame, your
  recording playing inside its screen. This is the one for a landing page or the
  Play Store. App Store Connect rejects it.
- `store-text` puts your recording full screen at Apple's size with the
  artboard's text and gesture hints animating over it. Guideline 2.3.4 says a
  preview may only use video screen captures of the app, which rules out the
  frame and the designed background, and also says you may add textual overlays.
  This mode is the intersection.
- `store-raw` is the capture alone, conformed to 886 x 1920, 30 fps, H.264. A
  recording straight off an iPhone is 1290 x 2796 at 60 fps and is rejected on
  upload, so this saves a round trip through a video editor.

A recording is never inlined. `serveFile` publishes it at
`http://127.0.0.1:<port>/__osg/media/<name>` and the page fetches it from there,
with byte range support, because Chrome will not seek a `200` response and a
large capture through a JSON-RPC body would blow the message cap.

### `osg localize`

Languages are an overlay, not a copy: one set of artboards and one layout, with
per language overrides on top, so a design fix reaches every language at once.

| Subcommand | Effect |
| --- | --- |
| `osg localize add <codes>` | Add languages to the project |
| `osg localize remove <codes>` | Remove them |
| `osg localize translate` | Machine translate the untranslated strings |
| `osg localize export <file.csv>` | The round trip out, for a human translator |
| `osg localize import <file.csv>` | The round trip back |
| `osg localize list` | The translation table as data |

| Flag | Effect |
| --- | --- |
| `--base <code>` | The language the others derive from |
| `--filter untranslated\|stale\|all` | Which rows `list` and `translate` touch |
| `--json` | The table, including where each string came from |

`list --json` reports the origin of every string (`inherited`, `manual`, `auto`,
and a `stale-` prefix once the base copy has been edited under it). That pairing
is the point when an agent is driving: the agent is itself a translator, its copy
beats the built in engine's, and it needs to know which rows are its problem.

### `osg verify`

Audits what is on disk against the store rules before anybody uploads: exact
dimensions per format, the required tiers present, aspect ratio limits, the
Play feature graphic being exactly 1024 x 500 with no transparency, colour type
and bit depth, file size, video length inside 15 to 30 seconds, video codec and
frame rate, and the per locale set being complete.

| Flag | Effect |
| --- | --- |
| `--store appstore\|play` | Which rule set. Default `config.store` |
| `--strict` | Treat warnings as failures |
| `--json` | Every check, with the file it ran against |

Exits `3` on a failure, `0` on a pass. It is the last step of `osg all` for that
reason: a green pipeline means the files would survive review, not merely that
they were written.

### `osg manifest`

Writes `osg.manifest.json` next to the output: every file produced, its format,
locale, board, dimensions, byte size and sha256, plus the config that produced it
and the versions of the CLI and the editor bundle. This is the file a CI job
publishes as its artefact and an agent reads instead of walking the tree.

### `osg studio`

Opens the real editor, headed, on the current project, and keeps the session
alive until you close the window. The escape hatch when a run produced something
you would rather fix by hand than describe. On exit the project file is written
back if it changed.

Equivalent to `--headed` on a command that idles, and useful with
`--editor-url http://localhost:9002` when you are developing the app itself.

### `osg upload`

Pushes the rendered set to App Store Connect or Google Play with your own
developer credentials. Reads `osg.manifest.json` so it uploads exactly what
`verify` passed.

| Flag | Effect |
| --- | --- |
| `--store appstore\|play` | Which store |
| `--app-id <id>` | The app record to update |
| `--locales <codes>` | Upload a subset |
| `--dry-run` | Resolve every target slot and report, upload nothing |

Credentials come from the environment, never the config. The store slot mapping
is the same [storeTargets.ts](../src/lib/publish/storeTargets.ts) the desktop app
uses, so a set that uploads from one uploads from the other. See
[STORE-UPLOAD.md](STORE-UPLOAD.md) for what each store wants.

### `osg mcp`

Runs an MCP server exposing all 49 design tools. See
[The MCP server](#the-mcp-server) below.

| Flag | Effect |
| --- | --- |
| `--stdio` | Speak MCP over stdin and stdout. The default, and what agents use |
| `--http` | Streamable HTTP instead |
| `--port <n>` | With `--http`. Default 8722, scanning upward if busy |
| `--headed` | Show the window so a person can watch the agent work |

### `osg install`

Detects the coding agents on this machine and writes the MCP entry into the right
config file for each. Shows the diff before writing.

| Flag | Effect |
| --- | --- |
| `--client <id>` | `claude-code`, `claude-desktop`, `cursor`, `vscode`. Repeatable |
| `--skills` | Also copy the bundled skills into the agent's skills directory |
| `--global` | Write the user level config rather than the project level one |
| `--print` | Print what it would write and exit |

### `osg cache`

| Subcommand | Effect |
| --- | --- |
| `osg cache warm` | Fetch every manifest asset now, so later runs need no network |
| `osg cache info` | What is cached, how much of the manifest, how many bytes |
| `osg cache prune` | Delete cached artwork and fonts |

| Flag | Effect |
| --- | --- |
| `--tier <name>` | Warm one tier of the manifest rather than all of it |
| `--from <dir>` | Seed from a local `public/` checkout instead of the network |
| `--fonts` | Include (or, with `--no-fonts`, exclude) the Google Fonts cache |
| `--json` | Counts and byte totals |

`--from ./public` in a repository checkout copies the files straight in, with the
same sha256 check, so an air gapped machine can be prepared from a git clone and
never fetch anything.

### `osg editor`

| Subcommand | Effect |
| --- | --- |
| `osg editor status` | Which bundle would be used, and why |
| `osg editor use <dir>` | Pin a directory holding an editor build |
| `osg editor reset` | Drop the pin and go back to the packaged bundle |

The pin is stored in `editor-dir.json` at the cache root, so it survives package
upgrades. A directory qualifies if it has `index.html` and `_next/` in it, which
is what `npm run build` produces in `out/`.

### `osg all`

`doctor`, then build, render, video, manifest, verify. Stops at the first
non zero exit code and returns it, so a CI job needs one line.

| Flag | Effect |
| --- | --- |
| `--skip <steps>` | Comma separated step names to leave out, e.g. `--skip video` |
| `--json` | One object summarising every step |

`--skip video` is the flag a CI container wants, because the browser it can
install has no H.264.

## The config file

`osg.config.ts` is the committed source of truth for every visible choice. That
matters more than it sounds. It is what makes "make it darker" a one line edit
and one cheap re-render instead of a re-run of the whole pipeline, and it is what
lets somebody pick the project up in six months and know what was intended.

The doctrine the skills teach with it: **a one run flag is a try, a config edit
is a decision.** Every flag that changes how the design looks has a config field.

### Resolution order

First hit wins.

1. `--config <path>`
2. `$OSG_CONFIG`
3. `./osg/osg.config.{ts,mts,mjs,js,json}`
4. `./osg.config.{ts,mts,mjs,js,json}`
5. The `osg` key in `./package.json`

A missing config is not an error. Every field has a default, so
`npx open-screenshot-generator all` works in a bare directory.

A `.ts` config is loaded with `jiti`, so there is no build step. `export default
{...}`, a bare object, or a `defineConfig({...})` wrapper all unwrap the same.

### Fields

| Field | Type | Default | What it does |
| --- | --- | --- | --- |
| `name` | string | the directory name | App name. Used in filenames and in the manifest |
| `project` | string | `osg/project.json` | The committed project file the store assets are built from |
| `out` | string | `osg/out` | Where rendered files land |
| `screenshots` | string | none | Directory of the app screenshots placed into the device frames |
| `template` | string | `auto` | Template slug to start from, or `auto` to rank and pick |
| `formats` | string[] | `['ios-6-9']` | Size preset ids to render |
| `locales` | string[] | the base only | Locale codes. The first is the base unless `baseLocale` says otherwise |
| `baseLocale` | string | the first locale | The language the others derive from |
| `store` | `appstore` \| `play` | `appstore` | Which rule set `verify` and `upload` use |
| `assetsBaseUrl` | string | `https://editor.openscrgen.app` | Where artwork is hydrated from |
| `editorUrl` | string | none | Drive a running editor instead of the packaged bundle |
| `browser` | string | discovered | Absolute path to a Chrome, Edge or Chromium |

`design`, applied across the whole set:

| Field | Type | What it does |
| --- | --- | --- |
| `design.background` | string | Solid colour or gradient css on every board |
| `design.headlineFont` | string | One of the app's 61 families, or one you imported |
| `design.headlineColor` | string | Headline colour |
| `design.subheadColor` | string | Subhead colour |
| `design.device` | string | Device type id, e.g. `iphone-16-pro-max`. Swaps every frame |
| `design.layout` | string | Named layout rhythm across the set, e.g. `alternating` |

`video`:

| Field | Type | What it does |
| --- | --- | --- |
| `video.mode` | `store-raw` \| `store-text` \| `styled` | Which render |
| `video.fps` | number | Frame rate. 30 for App Store Connect |
| `video.duration` | number | Seconds. Apple accepts 15 to 30 |
| `video.recording` | string | A screen recording on disk, served to the page over the local origin |

`ai`, used only by `osg design`:

| Field | Type | What it does |
| --- | --- | --- |
| `ai.provider` | string | `anthropic`, `openai`, `google`, `openai-compatible`, or a free provider id |
| `ai.model` | string | The model |
| `ai.baseUrl` | string | For `openai-compatible`, the endpoint |
| `ai.apiKeyEnv` | string | The **name** of the env var holding the key. Never the key |

### Size preset ids

`formats` takes the ids from [sizePresets.ts](../src/lib/sizePresets.ts). The
ones most runs use:

| Id | Size | Note |
| --- | --- | --- |
| `ios-6-9` | 1290 x 2796 | Required App Store iPhone baseline. The store scales it down to smaller iPhones |
| `ios-6-9-promax` | 1320 x 2868 | iPhone 16/17 Pro Max native. An accepted alternative for the same slot |
| `ios-6-5` | 1242 x 2688 | Legacy 6.5 inch class. Optional |
| `ipad-13` | 2064 x 2752 | Required if the app runs on iPad |
| `ipad-11` | 1668 x 2420 | Optional, auto scaled from 13 inch when absent |
| `play-phone` | 1080 x 1920 | Play phone. Minimum two shots to publish |
| `play-10` | 1600 x 2560 | Play 10 inch tablet |
| `play-feature-graphic` | 1024 x 500 | Required on every Play listing. Exactly this size, no transparency |
| `mac-2560` | 2560 x 1600 | Mac App Store. All Mac screenshots must be 16:10 |
| `watch-ultra-3` | 422 x 514 | Required Apple Watch baseline |
| `preview-iphone` | 886 x 1920 | App Store preview **video** size for every modern iPhone |
| `preview-ipad` | 1200 x 1600 | App Store preview video size for every iPad tier |

`osg templates --json` and `osg doctor --json` both report the full list, so an
agent never has to hard code them.

## Assets and the cache

The published tarball carries the **program** and none of the artwork: the Next
shell, the 101 template JSONs and the AI catalog, a few megabytes. The artwork
those templates paint is an order of magnitude larger (about 176 MB of `public/`)
and, for the image library, licensed to this project rather than owned by it. See
[THIRD-PARTY-ASSETS.md](../THIRD-PARTY-ASSETS.md).

So hydration works like this, in `editor/server.ts` and `editor/assets.ts`:

1. The page requests, say, `/elements/images/touch/touch-as110599965.png`.
2. It is not on disk in the bundle, so the server looks it up in the packaged
   `assets.manifest.json`, which holds a byte count and a sha256 per path.
3. Not in the manifest at all means a genuine 404.
4. In the manifest, the content addressed cache is checked first. A hit is served
   straight from disk with no network.
5. A miss is fetched from `assetsBaseUrl`, which is exactly the request a browser
   visiting the site makes, then checked against the manifest's sha256, then
   written to the cache with a write-then-rename so a killed run never leaves a
   half file that would fail its digest forever.
6. A digest mismatch is a hard error. Serving it anyway would render a design
   nobody authored. It means the deployment has moved on from your packaged
   manifest: upgrade the CLI.

Any given file is downloaded **once per machine, ever**, across every CLI version,
because the cache is keyed by sha256 and not by version.

### Where the cache lives

| OS | Path |
| --- | --- |
| Windows | `%LOCALAPPDATA%\open-screenshot-generator\Cache` |
| macOS | `~/Library/Caches/open-screenshot-generator` |
| Linux | `$XDG_CACHE_HOME/open-screenshot-generator`, or `~/.cache/open-screenshot-generator` |

`OSG_CACHE_DIR` overrides all three. Underneath:

| Subdirectory | Holds |
| --- | --- |
| `assets/` | Content addressed artwork, two hex characters of fan out per digest |
| `fonts/` | Google Fonts CSS and woff2 responses, keyed by request URL |
| `editor/` | Editor bundles for a version other than the packaged one |
| `browsers/` | Browsers fetched by `osg doctor --install-browser` |
| `sessions/` | Session lockfiles, so `osg studio` and `osg mcp` can share one window |
| `editor-dir.json` | The `osg editor use` pin |

The cache lives under a short, absolute, OS owned root rather than beside your
project on purpose. `%LOCALAPPDATA%` routinely contains spaces, and a
`<sha[0:2]>/<sha>` layout under a deep project path can cross the Windows 260
character limit.

### The font cache

The editor asks Google Fonts for a stylesheet at boot and then for woff2 files.
`browser/launch.ts` intercepts both, caches the responses to disk, and replays
them on later runs. That is what lets a warm machine render with no network at
all, and it is what stops a locale that needs Noto Nastaliq Urdu from silently
falling back to a face with none of the glyphs.

Google serves a different stylesheet per user agent, so the cache forwards the
page's own user agent and stores what that browser would actually have received.

## Offline

`--offline` is a real boundary, not a hint.

- Every request from the page to a host that is not `127.0.0.1` or `localhost` is
  aborted, except hosts on the allow list, which is the assets host and the
  editor origin when one is remote.
- An asset miss is a **hard error** with exit `2`, not a silent gap. The app
  warns and drops a template it cannot load, and a store screenshot with a hole
  in it is worse than a failed run.
- A font miss is aborted the same way, for the same reason.

The preparation for an offline machine is one command with a network:

```sh
osg cache warm            # everything from the deployment
osg cache warm --from ./public   # or from a repository checkout, no network at all
```

After that, `osg all --offline` runs with the network unplugged. `osg design` is
the exception: a model call needs an endpoint, and a local Ollama or LM Studio on
`127.0.0.1` is the offline answer there.

## The editor bundle

Resolution order, first hit wins, from `editor/resolve.ts`:

1. `--editor-url` or `$OSG_EDITOR_URL`. A running `npm run dev` on 9002, or any
   deployment.
2. `$OSG_EDITOR_DIR`, if it holds `index.html` and `_next/`.
3. The `osg editor use <dir>` pin.
4. The bundle inside this package, `cli/editor/`. Present in the published
   tarball. This is the normal case.
5. A repository checkout the CLI appears to be sitting inside, up to eight levels
   up, with a build in `out/`. For contributors.
6. The project's own deployment, driven directly. This keeps `npx
   open-screenshot-generator` working from a bare directory on a machine that has
   never seen the repository, at the cost of needing a network.

`osg editor status` prints which one won and why.

**Protocol pinning.** The bridge carries a `protocol` number and the CLI refuses
to drive a bundle it does not understand, naming both versions, because
`--editor-url` lets a new CLI point at an old deployment. Two distinct failures:

- No bridge at all: that deployment predates the CLI entirely. Upgrade the
  deployment or drop `--editor-url`.
- A bridge with the wrong number: the message says which side is older and what
  to do about it.

A local file cannot be handed to a remote editor. `serveFile` throws with that
message, because `/__osg/media/` only exists on the local origin. Drop
`--editor-url` when a command needs to publish a recording or a screenshot.

## The MCP server

`osg mcp` exposes the same 49 design tools as the desktop app: canvas, elements,
measuring, fonts, images, export, templates and projects, palette assets, App
Preview scenes, and the three tiers of localization. The tool list and the
doctrine for using them are in [DESKTOP.md](DESKTOP.md#mcp-server-for-external-ai-tools-desktop-only),
and they are identical here, because both transports terminate in the same
`runMcpRequest(message, mcpApi)` seam.

```sh
claude mcp add open-screenshot-generator -- npx -y open-screenshot-generator@0 mcp --stdio
```

### How it differs from the other two transports

| | Desktop | Web relay | This CLI |
| --- | --- | --- | --- |
| Transport | Rust `tiny_http` on `127.0.0.1:8722` | An SSE relay the tab connects out to | stdio, or Streamable HTTP |
| Needs the app open | Yes, in a window you are watching | Yes, a browser tab | No |
| Needs a server of ours | No | Yes, `NEXT_PUBLIC_MCP_RELAY_URL` | No |
| Who runs the tools | The frontend, over a Tauri event bridge | The frontend, over the relay | The frontend, in a headless page |
| Where `export_png --save` writes | `Downloads/Open Screenshot Generator` | Nowhere, it returns bytes | `--out`, the run's download directory |
| Lifetime | The app's | The tab's | The client's connection |

The practical difference for an agent is that the CLI transport needs nothing
running. There is no window to open first, no toggle in a Settings menu, no relay
to deploy. The trade is that nobody is watching the canvas, so `--headed` exists
for when somebody wants to.

The trade in the other direction: the desktop server drives the project the user
has open, which is what you want when a person and an agent are working on the
same design at once. The CLI drives the project file on disk.

### Timeouts and serialization

The same two rules as the desktop server, for the same reasons.

Calls are strictly one in flight. The design api closes over the artboards of the
render that produced it, so two mutations in one tick both start from the pre
change state and the second wins. `driver/session.ts` chains every bridge call
onto the previous one, and keeps the chain alive after a rejection so one failed
call does not poison the rest of the run.

Budgets are 30 seconds for an ordinary call and 180 seconds for the handful that
render, write a file or rebuild the project (`export_png`, `export_all`,
`create_project_from_template`, `open_project`, `translate_locales`,
`add_locales`, `upload_asset`, `upload_recording`). The CLI's own watchdog fires
15 seconds later than the page's, on purpose, so the app's own error message wins
the race and you learn "waiting on a dialog" rather than "the CLI gave up". A PNG
export gets 20 minutes end to end and a video export 45.

## CI

```yaml
- uses: actions/setup-node@v4
  with: { node-version: 20 }

- run: npx -y open-screenshot-generator@0 doctor --install-browser --json

- uses: actions/cache@v4
  with:
    path: ~/.cache/open-screenshot-generator
    key: osg-assets-${{ hashFiles('osg/project.json') }}

- run: npx -y open-screenshot-generator@0 all --skip video --json > osg-run.json

- uses: actions/upload-artifact@v4
  with: { name: store-assets, path: osg/out }
```

Two things to know.

**The container flags are set for you.** `browser/launch.ts` detects a container
(Linux, and either running as uid 0, or `/.dockerenv` exists, or `CI` is set) and
adds `--no-sandbox --disable-setuid-sandbox --disable-dev-shm-usage`. Chrome
refuses to start as root without the first, and the default 64 MB `/dev/shm`
crashes the renderer part way through a large export. Both are the normal state
of a CI runner, so they are detected rather than documented as something you must
remember.

**Skip the video step unless the runner has branded Chrome.**
`doctor --install-browser` fetches Chrome for Testing, which has no H.264, so
`osg video` fails there. `--skip video` is the honest answer for most runners.
If you need MP4 in CI, install `google-chrome-stable` in the job and let
discovery find it.

Cache `~/.cache/open-screenshot-generator` between runs. It is content addressed,
so a stale key still gets hits on every unchanged asset, and a cold run only pays
the difference.

## Windows notes

- Paths with spaces are the normal case. Quote them:
  `osg render --out "C:\Users\me\My App\out"`.
- In PowerShell, a JSON argument needs single quotes around it and doubled inner
  quotes, or a here string. `osg call add_element --args '{"type":"text"}'` works
  in `pwsh`; in `cmd.exe` it does not, use a `--script` file instead.
- The cache is deliberately under `%LOCALAPPDATA%` and not beside the project,
  because a `<sha[0:2]>/<sha>` path under a deep project directory can cross the
  260 character limit. If you move it with `OSG_CACHE_DIR`, keep the new root
  short.
- **Edge 150 broke `puppeteer.launch`.** The process it starts hands off to a
  child and exits `0`, and puppeteer reports "Failed to launch the browser
  process: Code: 0". The CLI spawns the browser itself with a debug port and
  connects to it when that happens. It is a fallback rather than the only path,
  so it keeps working if Edge fixes it. With `--verbose` you will see
  `launch failed, falling back to spawn+connect`, which is not an error.
- Both branded Chrome and branded Edge have H.264, so MP4 export works on a
  normal Windows machine with no extra install.

## Troubleshooting

**"The editor loaded but never installed its headless bridge."**
You passed `--editor-url` at a deployment older than this CLI. Upgrade the
deployment, drop the flag to use the bundled editor, or downgrade the CLI.

**"Editor bridge protocol N, this CLI speaks M."**
Same cause, opposite direction. The message says which side is older.

**"No Chrome, Edge or Chromium found."**
Install one, pass `--browser <path>`, set `CHROME_PATH`, or run
`osg doctor --install-browser`. On Linux, `apt install google-chrome-stable`
gets you the branded build that can also do MP4.

**`osg video` fails on a browser that renders PNGs fine.**
That browser has no H.264 encoder. `osg doctor` reports this per browser. Chrome
for Testing and most distribution Chromium builds are affected; branded Chrome
and Edge are not.

**"Asset digest mismatch for /elements/...".**
The asset host is a different version than your CLI. `npm i -g
open-screenshot-generator@latest`. This check is not negotiable: a mismatched
asset renders a design nobody authored.

**"Missing asset in offline mode: /data/projects/...".**
The cache does not have it. Run `osg cache warm` once with a network, or
`osg cache warm --from ./public` from a checkout.

**"<tool> did not return within 45s."**
The page is waiting on something, usually a dialog the tool opened. Re-run with
`--verbose` to see the page console, or with `--headed` to see the window.

**A locale renders in the wrong typeface.**
The font cache is cold and the run was offline, so the woff2 never arrived. Run
once online, or `osg cache warm --fonts`.

**`--json` output will not parse.**
It should. Only `emit()` writes stdout, and it writes exactly one object. If
something else appears there it is a bug in a command module, not in your shell.
Check that you are not also seeing stderr, which `2>&1` would merge in.

**Nothing appears for ten seconds on the first run.**
That is the first artwork hydration. It happens once per machine. `osg cache
warm` moves it somewhere you do not mind waiting.

## Adding a command

One module in `cli/src/commands/`, exporting exactly:

```ts
export async function run(ctx: CommandContext): Promise<number>;
```

The rules the rest of the package depends on:

- Return an exit code. Never call `process.exit`.
- Never write stdout except through `emit`. One object, in `--json` mode only.
- Every human line goes through `info` / `step` / `ok` / `warn` / `fail` /
  `debug`, which write stderr.
- Throw `OsgError` with a `fix` line the user can act on. The top level prints
  it.
- Take the session from `ctx.session()`, which is lazy and shared, so a command
  that needs the browser twice pays for it once and `osg all` pays once for the
  whole pipeline.
- Relative imports carry the `.js` extension. The build targets node ESM.
- No em dashes and no en dashes in anything a user reads, output included.
- A flag that changes how the design looks gets a field in `OsgConfig` too.
