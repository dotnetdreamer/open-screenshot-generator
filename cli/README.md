# open-screenshot-generator

[![npm version](https://img.shields.io/npm/v/open-screenshot-generator)](https://www.npmjs.com/package/open-screenshot-generator)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](https://github.com/dotnetdreamer/open-screenshot-generator/blob/main/cli/LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20.12-informational)](https://nodejs.org)

App Store and Play Store screenshots, preview videos and 49 design tools, driven from your terminal or from your coding agent.

```
$ npx -y open-screenshot-generator@0 all

> doctor
ok node 20.12.2, Chrome 141.0.7390.66 (H.264 available), cache 0 B
> editor: bundled with this package
> fill: ranked 101 templates, picked "aurora-dark" for 5 screenshots
> render: 5 boards, 2 formats, 3 locales

ok osg/out/appstore/en-US/ios-6-9/01-track-every-run.png     1290 x 2796   418 KB
ok osg/out/appstore/en-US/ios-6-9/02-your-week-at-a-glance.png 1290 x 2796  392 KB
ok osg/out/appstore/en-US/ios-6-9/03-beat-your-best.png       1290 x 2796   441 KB
ok osg/out/appstore/en-US/ios-6-9/04-share-the-route.png      1290 x 2796   377 KB
ok osg/out/appstore/en-US/ios-6-9/05-start-free.png           1290 x 2796   402 KB
ok osg/out/appstore/en-US/ipad-13/01-track-every-run.png      2064 x 2752   731 KB
ok osg/out/appstore/de-DE/ios-6-9/01-jeden-lauf-aufzeichnen.png 1290 x 2796 421 KB
ok osg/out/appstore/ja-JP/ios-6-9/01-subete-no-ran.png        1290 x 2796   409 KB
ok osg/out/appstore/en-US/preview-iphone/preview.mp4          886 x 1920    18.0 s, 30 fps, H.264
ok osg/manifest.json                                          36 files, 14.7 MB

ok verify: 36 files, 0 problems
```

Those are the real sizes. `ios-6-9` is 1290 x 2796, the tier App Store Connect requires for iPhone. `ipad-13` is 2064 x 2752, required if your app runs on iPad. `play-phone` is 1080 x 1920, `play-feature-graphic` is exactly 1024 x 500, and an App Store preview video is 886 x 1920 at 30 fps H.264, between 15 and 30 seconds, which is what App Review accepts.

<p align="center">
  <img src="https://raw.githubusercontent.com/dotnetdreamer/open-screenshot-generator/main/docs/demo.gif" alt="Placing device mockups on artboards and exporting store-ready screenshots" width="900">
</p>

## What this is

[Open Screenshot Generator](https://openscrgen.app) is a free, open source editor for store graphics: artboards on a canvas, device mockups on the artboards, your screenshots inside the frames, text and shapes around them, exported at the sizes both stores ask for.

This package is that editor with no window. It starts a loopback HTTP server, loads the real editor bundle in a headless Chrome or Edge, and drives it through `window.__osg`. There is no second renderer in here and no reimplementation of the layout engine, so a PNG the CLI writes is byte for byte the PNG the app writes, and a project the CLI builds opens in the app with nothing missing.

That is also why an agent gets the whole product and not a subset: the same 49 design tools the desktop MCP server exposes, the same 101 templates, the same 57 languages, the same video encoder.

## Before you start

- **Node 20.12 or newer.** `node --version` to check.
- **A Chrome, Edge or Chromium on this machine.** The CLI finds it. `osg doctor --install-browser` fetches one if there is none.
- **A branded Chrome or Edge for MP4 export.** Open Chromium builds ship no H.264 encoder, so `osg video` cannot run on them. PNG export, the 49 tools and the AI agent work on any of them. `osg doctor` tells you which you have.
- **Your app screenshots**, in a folder, in the order you want them. Or run `osg import` and it pulls the name, the icon and the screenshots off your current App Store listing.

Nothing else. No account, no API key unless you use `osg design`, no watermark, no export cap.

## Install

Run it without installing:

```sh
npx -y open-screenshot-generator@0 doctor
```

Or put `osg` on your PATH:

```sh
npm i -g open-screenshot-generator
osg doctor
```

Both bins are the same program: `osg` and `open-screenshot-generator`.

## Sixty seconds

```sh
mkdir store-assets && cd store-assets

npx -y open-screenshot-generator@0 init                          # writes osg/osg.config.ts
npx -y open-screenshot-generator@0 fill --screenshots ./shots    # ranks 101 templates, places, fits the copy
npx -y open-screenshot-generator@0 render                        # PNGs at store sizes
```

`fill` is deterministic and model free. It reads the aspect ratio and content of your screenshots, ranks the bundled templates against them, places each shot in a device frame in the order you gave, and re-fits the headline boxes so nothing clips. No key, no network beyond the first artwork fetch.

When you would rather describe it than pick it:

```sh
npx -y open-screenshot-generator@0 design ./shots "clean dark theme, the app is a running tracker, headline the streaks"
```

And once the project exists, `osg all` is the whole pipeline: doctor, build, render, video, manifest, verify.

## Commands

| Command | What it does |
| --- | --- |
| `osg init` | Scaffold `osg/osg.config.ts` and `osg/.gitignore`, print the next steps |
| `osg doctor` | Preflight the machine: node, browser, H.264, cache, editor bundle. `--json`, `--install-browser` |
| `osg templates` | List and search the 101 bundled templates. Browser free, instant |
| `osg new` | Create a project from a template, place screenshots, write the project file |
| `osg import` | Pull an app's existing App Store listing: name, icon, current screenshots |
| `osg fill` | Deterministic auto fill: rank templates, place shots, fit copy. No model |
| `osg design` | The AI agent: screenshots plus one instruction become a finished project |
| `osg edit` | Run design tool calls against the open project. `--tool`/`--args`, `--script`, `--stdin` |
| `osg call` | One tool call, raw JSON result on stdout |
| `osg render` | The store PNG run, per format and per locale |
| `osg video` | The MP4 app preview run |
| `osg localize` | Add languages, machine translate, CSV round trip |
| `osg verify` | Audit the produced files against store rules. Exits 3 on failure |
| `osg manifest` | Write `osg.manifest.json` describing everything that exists |
| `osg studio` | Open the real editor, headed, on the current project |
| `osg upload` | Push the rendered set to App Store Connect or Google Play |
| `osg mcp` | Run an MCP server exposing all 49 design tools. `--stdio` or `--http` |
| `osg install` | Write the MCP entry into a detected agent config |
| `osg cache` | `warm`, `info`, `prune` the artwork and font caches |
| `osg editor` | `status`, `use <dir>`, `reset` |
| `osg all` | doctor, then build, render, video, manifest, verify |

Global flags, on every command: `--config` `--project` `--out` `--editor-url` `--browser` `--headed` `--offline` `--json` `--verbose` `--quiet` `--assets-base-url` `--timeout`.

Every command that answers a question answers it as JSON too:

```sh
npx -y open-screenshot-generator@0 templates --search dark --json | jq '.templates[].id'
```

In `--json` mode stdout carries one object and nothing else. Progress, warnings and errors go to stderr, so a pipe stays clean.

Exit codes are contractual, because agents and CI read them: `0` ok, `1` usage or config, `2` driver or render failure, `3` verify failure. A `3` means the files exist and a store rule rejects them. A `2` means nothing was produced.

## Give it to your coding agent

### MCP, one line

The same 49 tools the desktop app exposes, hosted by the CLI, with no app window to keep open.

**Claude Code**

```sh
claude mcp add open-screenshot-generator -- npx -y open-screenshot-generator@0 mcp --stdio
```

**Cursor** (`~/.cursor/mcp.json`), **Claude Desktop** (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "open-screenshot-generator": {
      "command": "npx",
      "args": ["-y", "open-screenshot-generator@0", "mcp", "--stdio"]
    }
  }
}
```

**VS Code** (`.vscode/mcp.json`):

```json
{
  "servers": {
    "open-screenshot-generator": {
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "open-screenshot-generator@0", "mcp", "--stdio"]
    }
  }
}
```

Or let the CLI find the config for you:

```sh
npx -y open-screenshot-generator@0 install
```

It detects Claude Code, Claude Desktop, Cursor and VS Code, shows what it will write, and writes it.

### Skills

The package ships agent skills that teach a model the doctrine, not just the tool names: start from a template, measure text before you trust it, export at `scale: 0.25` while iterating, never let two layers share a position and take turns in time. Three ways in:

```sh
npx -y open-screenshot-generator@0 install --skills     # copies them into the agent it detects
npx skills add dotnetdreamer/open-screenshot-generator  # the skills registry
cp -r node_modules/open-screenshot-generator/skills/* .claude/skills/   # by hand
```

## The config file

One committed file is the source of truth for every visible choice, so "make it darker" is a one line edit and one cheap re-render rather than a re-run of the pipeline. A one run flag is a try. A config edit is a decision.

```ts
// osg/osg.config.ts
export default {
  name: 'Trailmark',
  screenshots: 'shots',
  template: 'auto',

  formats: ['ios-6-9', 'ipad-13', 'play-phone'],
  locales: ['en-US', 'de-DE', 'ja-JP'],
  store: 'appstore',

  design: {
    background: 'linear-gradient(160deg, #0b1120, #1e293b)',
    headlineFont: 'Inter',
    headlineColor: '#f8fafc',
    device: 'iphone-16-pro-max',
    layout: 'alternating',
  },

  video: { mode: 'store-text', fps: 30, duration: 18, recording: 'capture.mov' },
};
```

TypeScript, JavaScript, JSON, or an `osg` key in `package.json`. A missing config is not an error: every field has a default, so `osg all` works in a bare directory. Full schema in [the reference](https://github.com/dotnetdreamer/open-screenshot-generator/blob/main/docs/CLI.md#the-config-file).

## What it does on your machine

Worth stating plainly, because it launches a browser.

- **Opens a loopback HTTP port.** `127.0.0.1` on an OS assigned port, serving the editor bundle to the page it just launched. Loopback rather than `file://` because the editor needs a secure context for `crypto.subtle`, IndexedDB and the `VideoEncoder`, and loopback http is the one plain-http origin browsers treat as trustworthy. It is bound to loopback, never to an interface, and it dies with the run.
- **Launches a browser.** Yours if you have one, otherwise the one `--install-browser` fetched, in a scratch profile. Headless unless you pass `--headed`.
- **Writes files.** Into `osg/out` and the project file, both of which you name. Nowhere else, except the cache below.
- **Fetches artwork on first use, then never again.** The tarball carries the program, not the artwork: the shell, the 101 template JSONs and the AI catalog. The photographs, device art and template imagery are fetched from the project's own deployment the first time a template asks for one, which is exactly the request a browser visiting the site makes, checked against a sha256 in the packaged manifest, and cached per machine under your OS cache directory. Content addressed, so a file downloaded by one version is still the right file for the next and nobody pays for it twice. Google Fonts responses are cached the same way, which is what lets a warm machine render Noto Nastaliq Urdu with no network at all. `osg cache warm` does the whole set up front, `osg cache info` shows the size, `osg cache prune` clears it.
- **Sends no analytics.** No telemetry, no phone home, no usage ping, in this package or in the bundle it drives. The editor's own analytics are switched off before navigation, along with cloud auto save, the Discover feed and the collab session, because a machine driven run should be a machine driven run.
- **Talks to an AI provider only if you ask it to**, in `osg design`, with your key or your endpoint, direct from this machine.

`--offline` refuses every request that is not to the local origin, so a run either works from cache or fails loudly. It never silently ships a design with a hole in it.

## Full documentation

[docs/CLI.md](https://github.com/dotnetdreamer/open-screenshot-generator/blob/main/docs/CLI.md) is the complete reference: every command, every flag, the config schema field by field, the cache model and its path on each OS, the editor resolution order, how the MCP server differs from the desktop and relay transports, offline use, CI, Windows notes, and troubleshooting.

The editor itself, the desktop app and the AI agent are documented in the [main repository](https://github.com/dotnetdreamer/open-screenshot-generator).

## Licence

The code in this package is MIT. See [cli/LICENSE](https://github.com/dotnetdreamer/open-screenshot-generator/blob/main/cli/LICENSE).

The artwork the editor paints is licensed separately and is **not** covered by the MIT licence. No artwork is published in this tarball or as a downloadable archive. See [THIRD-PARTY-ASSETS.md](https://github.com/dotnetdreamer/open-screenshot-generator/blob/main/THIRD-PARTY-ASSETS.md) before you fork, mirror or repackage anything.
