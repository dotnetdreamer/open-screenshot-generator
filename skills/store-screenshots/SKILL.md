---
name: store-screenshots
description: >-
  Makes App Store and Google Play screenshots for the app in the current repository using the
  open-screenshot-generator CLI (`osg`): it finds or imports the app's raw screenshots, picks or
  generates a design from 101 built in templates, writes the copy, renders every required size tier,
  verifies the files against the stores' own rules, and leaves a committed osg/osg.config.ts plus a
  project file that the next prompt edits instead of rebuilding. Use this whenever someone asks for
  store screenshots, App Store assets, Play Store graphics, listing images or marketing screenshots,
  including bare phrasings like "make screenshots for the store", "I need App Store assets for this
  app", "generate Play Store screenshots", "design my listing images" or "make a screenshot set from
  these PNGs". Also use it for follow ups on assets it already made: a new headline, a darker
  background, a different font or device frame, another template, a reordered set, an extra size
  tier, or another language.
license: MIT
metadata:
  package: open-screenshot-generator
  homepage: https://openscrgen.app
---

# Store screenshots for the app in this repository

`osg` drives the real Open Screenshot Generator editor headlessly in a browser it finds on this
machine. There is no second renderer anywhere in the package, so a PNG it writes is byte for byte the
PNG the app writes. Your job is the part a CLI cannot do: choose which screens sell the app, write
copy in the product's voice, pick a design that fits, and drive the pipeline.

**The end state**: 3 to 5 finished store screenshots per required size tier under `osg/out/`,
`osg verify` exiting 0, and two committed files, `osg/osg.config.ts` and `osg/project.json`, that
hold every visible choice so the next prompt is a one line edit and one cheap re-render.

## Before anything: is this a follow up?

Everything the tool decided lives in files the user can re-prompt against. If they exist, this is an
edit, not a build. Read them in full and jump to the dispatch table at the bottom.

```bash
ls osg/osg.config.ts osg/project.json osg/out 2>/dev/null
```

```powershell
Get-ChildItem osg/osg.config.ts, osg/project.json, osg/out -ErrorAction SilentlyContinue
```

`osg/osg.config.ts` is the source of truth for the background, the fonts, the device frame, the size
tiers, the locales and the template. `osg/project.json` is the design itself: artboards, elements and
the copy on them. Nothing lives only in your head, and nothing lives only in the browser. A user who
says "make it darker" is asking for a change to one of those two files.

## Step 0: make sure it runs

```bash
npx -y open-screenshot-generator@0 doctor
```

Every command below is `npx -y open-screenshot-generator@0 <cmd>`, called `osg` from here on. It needs
Node 20.12+ and a Chrome, Edge, Brave or Chromium on the machine. `doctor` reports what it found,
per check, and exits 1 if anything would fail later. Add `--json` when you want to parse it.

- No browser: `osg doctor --install-browser` fetches one into the CLI's own cache. That build has no
  H.264, which only matters for `osg video`, see the **app-preview-video** skill.
- Behind a proxy or on a locked down runner: the first run hydrates artwork from the project's
  deployment into a machine wide cache. `osg cache warm` does it up front, `osg cache info` shows the
  size, and `--offline` afterwards refuses any network at all.

## Step 1: get the app's screenshots

`osg` does not boot a simulator. That is deliberate: your agent harness already drives the app better
than a screenshot tool could, and the raw captures usually already exist. In order of preference:

1. **Already in the repo.** Look for `fastlane/screenshots/`, `screenshots/`, `docs/screenshots/`,
   `ios/fastlane/screenshots/`, `metadata/`, or a `*.png` set beside the README. Prefer the largest
   ones, 1290x2796 or better for iPhone.
2. **Already on the store.** If the app is published, pull the live listing:
   ```bash
   npx -y open-screenshot-generator@0 import
   ```
   That fetches the app's name, icon and current store screenshots so a redesign starts from what
   users see today, and so you can tell the user what is changing.
3. **Capture them.** Use the platform's own tooling (`xcrun simctl io booted screenshot`, `adb exec-out
   screencap -p`, or the repo's existing UI test target) and drop the PNGs in one directory. Capture a
   Release build: a Debug build paints dev banners into the marketing asset.

Set `screenshots` in the config to that directory. Names matter only for ordering, so `01-home.png`,
`02-search.png` is the friendliest convention.

**Choose 3 to 5 screens, not 10.** The first two are the only ones most people see. Lead with the
screen that shows the app doing its job with real looking content, then the differentiator, then
proof (ratings, results, a chart), then the breadth screen.

## Step 2: scaffold, then choose a design

```bash
npx -y open-screenshot-generator@0 init
```

That writes `osg/osg.config.ts` and `osg/.gitignore` (which ignores `osg/out/`) and prints the next
steps. Then pick one of three routes, cheapest first.

**A. A template you chose.** Browse browser free, it is a local index:

```bash
npx -y open-screenshot-generator@0 templates --json
npx -y open-screenshot-generator@0 templates dark minimal
npx -y open-screenshot-generator@0 templates --category screenshots
```

101 templates in the categories `screenshots`, `apple-watch`, `mac` and `play-feature-graphic`. Each
entry says how many artboards and how many device slots it has, so pick one whose slot count matches
the number of screenshots you chose. Then:

```bash
npx -y open-screenshot-generator@0 new --template somnia-sleep
```

**B. Model free auto fill.** Ranks every template against the screenshots you actually have,
places them, and fits the copy. No API key, no model, deterministic, a few seconds:

```bash
npx -y open-screenshot-generator@0 fill
```

**C. The AI agent.** A design brief plus the screenshots, in one shot. Needs a key:

```bash
OSG_API_KEY=... npx -y open-screenshot-generator@0 design "warm, confident, sleep tracking app, dark background, one benefit per screen"
```

```powershell
$env:OSG_API_KEY = '...'
npx -y open-screenshot-generator@0 design "warm, confident, sleep tracking app, dark background, one benefit per screen"
```

Set `ai.provider` and `ai.model` in the config. Never put a key in the config file, it is committed.

Route B is the right default when the user gave you screenshots and no strong opinion. Route C is
right when they described a look. Route A is right when they named a style you can see in the list.

## Step 3: write the copy yourself

The template ships placeholder headlines. Replace every one of them. This is the highest leverage
thing in the whole run and no template can do it for you.

- One benefit per board, in the product's voice, 2 to 6 words for a headline.
- Say what the user gets, not what the screen is called. "Sleep through the night" beats "Sleep tab".
- A subhead is optional, and one long line always beats two cramped ones.
- Text renders at roughly 3.3x the stored `fontSize` and the box clips, so a headline that grew needs
  `measure_element` rather than a guess. See the **editor-tools** skill.

Apply the copy with one batched edit rather than a click path:

```bash
npx -y open-screenshot-generator@0 edit --script osg/edits.json
```

where `osg/edits.json` is a list of tool calls. That form is quoting proof, which matters because
this project's own author is on Windows and PowerShell mangles inline JSON:

```json
[
  { "tool": "list_artboards", "args": {} },
  { "tool": "update_element", "args": { "elementId": "headline", "content": "Sleep through the night" } }
]
```

For a single call, `osg edit --tool update_element --args '{"elementId":"headline","content":"..."}'`
works in bash; on Windows prefer the script file. `osg call` is the same thing with the raw JSON
result on stdout, for piping into `jq`.

## Step 4: render every required tier

Set `formats` in the config, then:

```bash
npx -y open-screenshot-generator@0 render
```

| Store | Tier | Preset id | Pixels | Status |
| --- | --- | --- | --- | --- |
| App Store | iPhone 6.9 inch | `ios-6-9` | 1290x2796 | required for every iPhone app |
| App Store | iPhone 6.9 inch Pro Max | `ios-6-9-promax` | 1320x2868 | accepted alternative for the same slot |
| App Store | iPad 13 inch | `ipad-13` | 2064x2752 | required if the app runs on iPad |
| App Store | Apple Watch Ultra 3 | `watch-ultra-3` | 422x514 | required for a watch app |
| App Store | Mac | `mac-2560` | 2560x1600 | required for a Mac app |
| Play | Phone | `play-phone` | 1080x1920 | required, minimum 2 shots |
| Play | Feature graphic | `play-feature-graphic` | 1024x500 | required on every Play listing |

Apple scales the required tier down to the smaller ones, so `formats: ['ios-6-9']` is a complete
iPhone submission. Add `ipad-13` only if the app actually runs on iPad, and never ship an iPad tier
that is a stretched iPhone screenshot.

Rendered files land under `osg/out/`. Do not guess a path: `osg manifest` writes
`osg/osg.manifest.json` naming every file that exists, with its tier, locale, board and pixel size.
Read that.

## Step 5: verify, then report

```bash
npx -y open-screenshot-generator@0 verify
```

Exit 0 means the files satisfy the store rules. Exit 3 means they exist and a rule rejects them, with
the failing file and rule named. Exit 1 is your config or environment, exit 2 is the browser or a
tool call. Fix what it names, re-render, and run it again. The rules and every failure message are in
the **store-compliance** skill.

The whole pipeline in one command, for CI or a fresh clone:

```bash
npx -y open-screenshot-generator@0 all
```

That runs doctor, build, render, video, manifest and verify in order and stops at the first failure.

Finish by telling the user: how many boards, which tiers, where the files are, what `verify` said,
and which two files to edit for the next change. If they want to look at it, `osg studio` opens the
real editor headed on the current project, and anything they change there is a change to the same
project file.

## What is committed

```
<app-repo>/
  osg/
    osg.config.ts        commit. every visible choice
    project.json         commit. the design itself
    .gitignore           commit. ignores out/
    out/                 do not commit. rendered PNGs, MP4s and the manifest
  screenshots/           commit if the app's raw captures belong in the repo
```

A one run flag is a try. A config edit is a decision. If a flag produced something the user wants to
keep, write it into `osg/osg.config.ts` before you move on, or the next run loses it.

## Follow up dispatch

A follow up prompt is a small edit plus the cheapest command that reflects it. Do not re-run the
pipeline, do not re-pick the template, and do not touch boards the user did not mention. Say which
file and field you changed so the next prompt can build on it.

| The user asks for | Edit this file and field | Then run |
| --- | --- | --- |
| Darker, lighter, a different background | `osg.config.ts` `design.background` | `render` |
| A different background on one board only | `project.json` via `edit --tool set_background` | `render` |
| A different headline or subhead | `project.json` via `edit --tool update_element` `content` | `render` |
| A different font | `osg.config.ts` `design.headlineFont` | `render` |
| Different text colors | `osg.config.ts` `design.headlineColor` / `design.subheadColor` | `render` |
| A different phone, or an Android frame | `osg.config.ts` `design.device` | `render` |
| A different rhythm across the set | `osg.config.ts` `design.layout` | `render` |
| A different template | `osg.config.ts` `template` | `new`, then `render` |
| Reorder, drop or add a screenshot | the files in `screenshots/` | `fill`, then `render` |
| New screenshots from a new build | replace the files in `screenshots/` | `fill`, then `render` |
| Another size tier (iPad, Watch, Mac, Play) | `osg.config.ts` `formats` | `render` |
| Another language | `osg.config.ts` `locales` | `localize`, then `render` |
| A preview video | `osg.config.ts` `video.*` | `video` |
| Move one element, restyle one layer | `project.json` via `edit --tool update_element` | `render` |
| Push it to the store | nothing | `verify`, then `upload` |
| "Just show me" | nothing | `studio` |

`render` takes tens of seconds, `fill` a few, `new` rebuilds the project and throws away hand edits.
Prefer the row that changes the least.

## Troubleshooting

**"No Chrome, Edge or Chromium found."** Install a branded browser or run `osg doctor
--install-browser`. Pass `--browser <absolute path>` or set `OSG_BROWSER` to pin a specific build.

**The editor loaded but never installed its headless bridge.** You passed `--editor-url` at a
deployment older than this CLI. Drop the flag to use the bundled editor.

**Bridge protocol mismatch.** The message names both versions. Upgrade whichever side is behind.

**A render finished but a board is empty or wrong.** The design placed screenshots into device slots
by order. Check that `screenshots` points at the right directory and that the file count matches the
template's device slot count (`osg templates --json` reports it per template).

**A font came out as a serif.** An unknown family is rejected by the tools rather than substituted,
so a serif means the family never reached the element. `osg call list_fonts` is the allowlist.

**The run is slow the first time and fast afterwards.** That is artwork hydration into the machine
wide cache. `osg cache warm` moves the cost up front, `osg cache prune` reclaims it.

**Everything is fine but the user is on a plane.** `--offline` blocks the network and fails loudly on
a cache miss rather than rendering a screenshot with a hole in it.

## Related skills

- **store-compliance** for what `osg verify` checks, the required tiers, and `osg upload`
- **app-preview-video** for the MP4 App Preview, which has different rules from screenshots
- **store-localization** for one design in up to 57 languages
- **editor-tools** for driving the live editor tool by tool over MCP
