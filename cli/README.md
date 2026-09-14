# open-screenshot-generator

[![npm version](https://img.shields.io/npm/v/open-screenshot-generator)](https://www.npmjs.com/package/open-screenshot-generator)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue)](https://github.com/dotnetdreamer/open-screenshot-generator/blob/main/cli/LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D20.12-informational)](https://nodejs.org)

App Store and Play Store screenshots, preview videos and 49 design tools, run from your terminal or your coding agent.

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

Each file comes out at the size the store asks for. `ios-6-9` is 1290 x 2796, which App Store Connect requires for iPhone. `ipad-13` is 2064 x 2752, required if your app runs on iPad. `play-phone` is 1080 x 1920 and `play-feature-graphic` is 1024 x 500. An App Store preview video is 886 x 1920 at 30 fps in H.264, 15 to 30 seconds long, which is what App Review accepts.

<p align="center">
  <img src="https://raw.githubusercontent.com/dotnetdreamer/open-screenshot-generator/main/docs/demo.gif" alt="Placing device mockups on artboards and exporting store-ready screenshots" width="900">
</p>

## What this is

[Open Screenshot Generator](https://openscrgen.app) is a free, open source editor for store graphics. You lay out artboards on a canvas, put device mockups on them, drop your screenshots into the frames, add text and shapes, and export at the sizes both stores ask for.

This package is the same editor without a window. It starts a local HTTP server, opens the real editor bundle in a headless Chrome or Edge, and drives it through `window.__osg`. Nothing is reimplemented, so a PNG from the CLI matches the app's export byte for byte, and a project built with the CLI opens in the app with nothing missing.

Your coding agent gets the whole product, not a subset: the same 49 design tools as the desktop MCP server, the same 101 templates, the same 57 languages and the same video encoder.

## Before you start

- **Node 20.12 or newer.** Run `node --version` to check.
- **Chrome, Edge or Chromium.** The CLI finds the one you have. If there is none, `osg doctor --install-browser` downloads one.
- **Chrome or Edge for MP4 export.** Chromium builds do not include an H.264 encoder, so `osg video` does not work with them. PNG export, the 49 tools and the AI agent work in all three. `osg doctor` tells you which one you have.
- **Your app screenshots** in a folder, in the order you want them. Or run `osg import` to pull the name, icon and screenshots from your current App Store listing.

You do not need an account, and there is no watermark or export limit. An API key is needed only for `osg design`.

## Install

Run it without installing:

```sh
npx -y open-screenshot-generator@0 doctor
```

Or install it globally to put `osg` on your PATH:

```sh
npm i -g open-screenshot-generator
osg doctor
```

`osg` and `open-screenshot-generator` are two names for the same command.

## Quick start

```sh
mkdir store-assets && cd store-assets

npx -y open-screenshot-generator@0 init                          # writes osg/osg.config.ts
npx -y open-screenshot-generator@0 fill --screenshots ./shots    # picks a template, places your screenshots, fits the text
npx -y open-screenshot-generator@0 render                        # exports PNGs at store sizes
```

`fill` needs no AI and gives the same result every time. It looks at the shape and content of your screenshots, ranks the bundled templates against them, puts each screenshot in a device frame in your order, and resizes the headlines so none of them get cut off. It needs no API key, and it goes online only to download artwork the first time.

To describe the design in your own words instead:

```sh
npx -y open-screenshot-generator@0 design ./shots "clean dark theme, the app is a running tracker, headline the streaks"
```

Once the project exists, `osg all` runs the whole pipeline: doctor, build, render, video, manifest and verify.

## Commands

| Command | What it does |
| --- | --- |
| `osg init` | Create `osg/osg.config.ts` and `osg/.gitignore`, then print the next steps |
| `osg doctor` | Check that this machine has everything it needs: Node, a browser, H.264, the cache and the editor bundle. `--json`, `--install-browser` |
| `osg templates` | List and search the 101 bundled templates. Fast, and opens no browser |
| `osg new` | Create a project from a template, place your screenshots and save the project file |
| `osg import` | Pull an app's current App Store listing: name, icon and screenshots |
| `osg fill` | Pick the best template for your screenshots, place them and fit the text. No AI |
| `osg design` | The AI agent: your screenshots and one instruction become a finished project |
| `osg edit` | Run design tool calls on the open project. `--tool`/`--args`, `--script`, `--stdin` |
| `osg call` | Run one tool call and print the raw JSON result on stdout |
| `osg render` | Export the store PNGs for each format and language |
| `osg video` | Export the App Store preview video |
| `osg localize` | Add languages, machine translate the text, and round trip it through CSV |
| `osg verify` | Check the exported files against the store rules. Exits 3 when a file fails |
| `osg manifest` | Write `osg.manifest.json`, a record of everything the project has produced |
| `osg studio` | Open the editor in a visible browser window on the current project |
| `osg upload` | Upload the exported set to App Store Connect or Google Play |
| `osg mcp` | Run an MCP server with all 49 design tools. `--stdio` or `--http` |
| `osg install` | Add the MCP server to a coding agent config it finds on this machine |
| `osg cache` | Manage the artwork and font caches: `warm`, `info`, `prune` |
| `osg editor` | Manage which editor bundle the CLI uses: `status`, `use <dir>`, `reset` |
| `osg all` | Run doctor, then build, render, video, manifest and verify |

These flags work on every command: `--config` `--project` `--out` `--editor-url` `--browser` `--headed` `--offline` `--json` `--verbose` `--quiet` `--assets-base-url` `--timeout`.

Every command that reports something can report it as JSON:

```sh
npx -y open-screenshot-generator@0 templates --search dark --json | jq '.templates[].id'
```

With `--json`, stdout carries one JSON object and nothing else. Progress, warnings and errors go to stderr, so you can pipe the output safely.

Exit codes stay stable, because agents and CI scripts depend on them. `0` means success. `1` means a usage or config error. `2` means the browser or the export failed and no files were produced. `3` means the files exist, but a store rule rejects at least one of them.

## Use it from your coding agent

### MCP server

The CLI serves the same 49 tools as the desktop app, so no app window has to stay open.

**Claude Code**

```sh
claude mcp add open-screenshot-generator -- npx -y open-screenshot-generator@0 mcp --stdio
```

**Cursor** (`~/.cursor/mcp.json`) and **Claude Desktop** (`claude_desktop_config.json`):

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

Or let the CLI add the entry for you:

```sh
npx -y open-screenshot-generator@0 install
```

`osg install` finds Claude Code, Claude Desktop, Cursor and VS Code, shows the entry it will add, and writes it.

### Skills

The package includes agent skills that teach a model how to design with these tools, not only what the tools are called. For example: start from a template, measure text before trusting it, export at `scale: 0.25` while iterating, and never stack two layers in one spot and swap them over time. Install them one of three ways:

```sh
npx -y open-screenshot-generator@0 install --skills     # copies them into the agent it finds
npx skills add dotnetdreamer/open-screenshot-generator  # from the skills registry
cp -r node_modules/open-screenshot-generator/skills/* .claude/skills/   # by hand
```

## The config file

Every choice that changes how the screenshots look lives in one file you commit. "Make it darker" becomes a one line edit and a quick render, not a full rerun. Use a flag to try something once. Put it in the config when you decide to keep it.

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

The config can be TypeScript, JavaScript, JSON, or an `osg` key in `package.json`. You can also skip it. Every field has a default, so `osg all` works in an empty folder. Every field is described in [the reference](https://github.com/dotnetdreamer/open-screenshot-generator/blob/main/docs/CLI.md#the-config-file).

## What it does on your machine

The CLI launches a browser, so here is everything it touches.

- **Opens a local port.** The server listens on `127.0.0.1` on a free port and serves the editor to the browser the CLI launched. It is never reachable from other machines, and it stops when the run ends. It uses `127.0.0.1` instead of `file://` because browsers give `crypto.subtle`, IndexedDB and `VideoEncoder` only to secure origins, and `127.0.0.1` counts as one.
- **Launches a browser.** Your own if you have one, otherwise the one `--install-browser` downloaded, with a temporary profile. It runs headless unless you pass `--headed`.
- **Writes files** only to `osg/out` and the project file, both of which you choose, plus the cache below.
- **Downloads artwork once.** The package holds the program, the 101 template files and the AI catalog, but no artwork. The first time a template needs a photo or device image, the CLI downloads it from the project's own website, the same request your browser makes when you visit. Each file is checked against a sha256 in the package and cached under your OS cache folder. Files are cached by content, so a new version of the CLI does not download them again.
- **Caches fonts.** Google Fonts responses are cached the same way, so a machine that has run before can render fonts such as Noto Nastaliq Urdu offline. `osg cache warm` downloads everything up front, `osg cache info` shows the cache size, and `osg cache prune` clears it.
- **Sends no analytics.** No telemetry and no usage pings, from this package or from the editor it runs. Before loading the editor, the CLI turns off its analytics, cloud auto save, the Discover feed and live collaboration.
- **Contacts an AI provider only in `osg design`**, with your key or your endpoint, directly from this machine.

`--offline` blocks every request except to the local server. The run uses the cache or stops with an error, so an export never goes out with missing artwork.

## Full documentation

[docs/CLI.md](https://github.com/dotnetdreamer/open-screenshot-generator/blob/main/docs/CLI.md) covers every command and flag, the config fields one by one, where the cache lives on each OS, how the CLI picks an editor bundle, how its MCP server differs from the desktop and relay servers, offline use, CI, Windows notes and troubleshooting.

The editor, the desktop app and the AI agent are documented in the [main repository](https://github.com/dotnetdreamer/open-screenshot-generator).

## License

The code in this package is MIT licensed. See [cli/LICENSE](https://github.com/dotnetdreamer/open-screenshot-generator/blob/main/cli/LICENSE).

The artwork in the templates has its own licenses and is **not** covered by MIT. No artwork is included in this package or offered as a downloadable archive. Read [THIRD-PARTY-ASSETS.md](https://github.com/dotnetdreamer/open-screenshot-generator/blob/main/THIRD-PARTY-ASSETS.md) before you fork, mirror or repackage anything.
