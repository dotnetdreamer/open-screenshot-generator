---
name: editor-tools
description: >-
  Drives the live Open Screenshot Generator editor tool by tool over MCP, using `osg mcp` to expose
  all 49 design tools (artboards, elements, backgrounds, fonts, the asset libraries, templates, App
  Preview timelines, 57 locales and PNG export) to any MCP client, plus `osg install` to write the
  server entry into a detected agent config. Use this whenever someone wants to edit an existing
  screenshot project rather than regenerate it, asks to connect the design tools to Claude Code,
  Cursor, Claude Desktop or VS Code, or says things like "move that headline", "make the phone
  bigger", "add an MCP server for my screenshots", "let me edit the design from here" or "what tools
  do I have". Read it before making any direct tool call, because the element, locale and export
  tools have asymmetries that silently do nothing if you guess.
license: MIT
metadata:
  package: open-screenshot-generator
  homepage: https://openscrgen.app
---

# Driving the editor: 49 tools, and the rules that keep them honest

**The end state**: an MCP client holding a live connection to the real editor, with the user's project
open, making precise edits that land as real undo steps in a project file the user can open in the
app afterwards.

Nothing here is a reimplementation. Every call lands in the same function a click in the UI lands in,
inside the real editor page. That is why an edit you make is indistinguishable from an edit the user
made by hand.

## Starting the server

```bash
npx -y open-screenshot-generator@0 install
```

`install` detects the agent configs on this machine and writes the server entry. Prefer it over
hand editing, especially on Windows where several clients need the command wrapped.

The manual form, for a config it did not know about:

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

`--stdio` is the default and the right choice: no port, no firewall prompt, no shared secret. Use
`--http --port 8722` only when the client cannot spawn a process, and it then speaks Streamable HTTP
at `http://127.0.0.1:8722/mcp`.

Two behaviours worth knowing so the server does not feel broken:

- `initialize`, `ping` and `tools/list` are answered from a manifest generated at build time, with no
  browser at all. Every client calls `tools/list` at session start and paying a browser boot for a
  handshake would be unacceptable.
- The browser starts on the **first `tools/call`** and stays warm for the life of the connection. So
  the first real call is slow and every one after it is not.

One capability exists here that no other transport has: `export_png` and `export_all` with
`save: true` actually write files. In a browser tab that throws, because a tab cannot write to disk.

For one off calls without a client, the CLI is the same surface:

```bash
npx -y open-screenshot-generator@0 call list_artboards
npx -y open-screenshot-generator@0 edit --script osg/edits.json
```

`osg call` prints the raw JSON result on stdout, so it pipes into `jq`. `osg edit --script` runs a
list of calls in order, which is the quoting proof form on Windows.

## The mutation rules

These are not style preferences. Each one is a way to make a call that returns success and changes
nothing.

**1. One call in flight, always.** The tool api closes over the artboards of the render that produced
it. Two mutations dispatched in the same tick both read the pre change state and the second silently
clobbers the first. The CLI serializes every bridge call for exactly this reason. If you are driving
the page yourself, await each response fully before sending the next.

**2. There is one door, and it is the same door the UI uses.** Every mutating tool commits through
the app's single update path, which repositions the boards, writes the project, and pushes one undo
entry. That is why one tool call is one Ctrl+Z, and why `add_elements` is strictly better than a
loop of `add_element`: one round trip, one undo step, and nothing is added at all if any entry is
rejected, so you never end up with a half built board.

**3. An artboard's `position` is derived.** It is recomputed and overwritten on every update.
Authoring it does nothing. Move a board along the canvas with `update_artboard` `index` instead, 0
being leftmost.

**4. `x`/`y` and `width`/`height` are not symmetric.** `position` is written if **either** `x` or `y`
is present, filling the missing one with 0, so `update_element` with only `x` also slams the element
to y=0. `size` is written only when **both** `width` and `height` are present, so a lone `width` is
dropped with no error at all. Always pass the pairs together.

**5. An explicit `null` clears a property.** Omitting it leaves it alone. `null` is the only way to
remove a `shadow`, a `fillGradient`, an animation `enter` or `exit`, or a preview duration override.

**6. An unknown `fontFamily` is rejected, not substituted.** The error names the closest available
families. This is deliberate: a browser silently falls back to a default serif, which looks like the
design changed for no reason. `list_fonts` is the allowlist, filterable by script (`latin`, `arabic`,
`urdu`, `hebrew`, `cjk`, `thai`, `devanagari`, `bengali`, `multilingual`).

**7. Text does not measure the way you expect.** Glyphs render at roughly 3.3x the stored `fontSize`
and wrap inside the element box, which clips. So ~48 is a phone headline, not 96, and the real ink
bounds cannot be predicted from the props. `measure_element` returns what the element actually
occupies on the rendered canvas. Use it before aligning anything to a headline's edge.

**8. Elements paint in list order**, first at the back, and adding one always puts it on top. Use
`reorder_element` to slide a background behind work you already placed, rather than rebuilding the
board.

**9. `export_png`, `export_all` and `measure_element` read the live DOM.** They fail if the project is
not open on screen. `open_project` waits two animation frames before returning for exactly this
reason.

**10. Upload an image once.** `upload_asset` returns an `asset:<id>` reference you can pass to
`imageSrc` or `screenshotSrc` as many times as you like, instead of repeating a data URL in every
call. The reference is expanded to bytes when the element is built, so the saved project never
carries a dangling ref.

**11. A recording is not an asset.** `upload_asset` probes bytes as an image and refuses a video.
Screen recordings go through `upload_recording` and elements carry only the `mediaId` it returns.
Prefer an http(s) URL over base64 for anything large: a request body is capped at 32 MiB.

**12. Every language tool except two writes the base document.** Only `set_locale` and the `locale`
arguments read a per language projection. See the **store-localization** skill.

**13. Adding a `video-device`, `video` or `gesture` element, or any animation, switches the whole
project to the video export path.** Never put one on a screenshot board.

**14. `delete_artboard` refuses the last board.** A project with zero artboards leaves the canvas
stuck loading.

**15. Errors come back as data.** An unknown tool is a JSON-RPC `-32602`. A tool that rejected your
arguments is a normal result with `isError` and a sentence saying what to do. Read the sentence, it
usually names the tool to call instead.

**16. Slow tools get a longer budget.** `export_png`, `export_all`, `create_project_from_template`,
`open_project`, `translate_locales`, `add_locales`, `upload_asset` and `upload_recording` are allowed
minutes. Everything else answers in seconds, and a hang means a dialog is open in the page.

## The 49 tools, by job

### Find out what is there (start every session here)

| Tool | Reach for it when |
| --- | --- |
| `list_artboards` | always first. ids, names, sizes, backgrounds, element counts |
| `get_artboard` | you need the element ids and every property on one board |
| `measure_element` | you need the true rendered bounds of text, or to check for clipping |
| `list_projects` | the user means a different project than the open one |
| `open_project` | switching to it. slow, and it waits for the canvas |

### Boards

`create_artboard` (width and height, or a `preset` id like `ios-6-9`), `duplicate_artboard`,
`update_artboard` (rename, resize, reorder), `delete_artboard`, `set_active_artboard`,
`set_background` (solid or a two stop gradient, and a half filled gradient is refused rather than
stored).

The fastest way to build a store set: build one board properly, `duplicate_artboard` per screen, then
change only the headline and the screenshot. Rename every board, because the name becomes the
exported file name and a board left as "Blank Artboard" exports as one.

### Elements

| Tool | Reach for it when |
| --- | --- |
| `add_elements` | adding anything. batch, atomic, one undo step, back to front |
| `add_element` | a single element, usually inside a larger flow |
| `update_element` | changing anything on an existing layer |
| `delete_element` | removing one |
| `reorder_element` | fixing stacking. `front`, `back`, `forward`, `backward`, or an index |
| `transform_elements` | moving or scaling several layers as one arrangement |
| `group_elements` | tagging layers so `transform_elements` can target them later by `groupId` |

Types are `text`, `shape`, `device`, `image`, `video-device`, `video`, `gesture`. Instead of
`type`/`subType` you can pass a `libraryId` from `list_library` to drop a ready made palette asset:
vector shapes, arrows, blobs, waves, patterns, photos of people holding phones, store badges, flat
device mockups, 3D posed devices and coloured frames. Prefixes are `element:`, `image:`, `device:`,
`device3d:` and `devicecolor:`.

### Templates and projects

`list_templates` (101 of them, categories `screenshots`, `apple-watch`, `mac`,
`play-feature-graphic`), `get_template` (its fillable slots, with stable element ids),
`create_project_from_template` (copy it, open it, and optionally fill text and screenshots in the
same call), `list_projects`, `open_project`.

`list_templates` deliberately hides the app-preview category, because those boards play a recording.
Preview work goes through `list_preview_scenes` and `add_preview_scene`.

### App Preview video

`list_preview_scenes`, `add_preview_scene`, `set_animation`, `set_preview_duration`,
`get_preview_timeline`, `upload_recording`, `list_recordings`. The full doctrine, including Apple
Review Guideline 2.3.4, is in the **app-preview-video** skill. Two traps worth repeating here:
`set_animation` refuses recordings and gestures (a recording starts the board, a gesture is timed by
`triggerTime`), and an exit with no `exitStart` never fires.

### Assets and fonts

`list_library`, `list_fonts`, `upload_asset`, `list_assets`, `delete_asset`.

### Languages

Config: `list_supported_locales`, `list_locales`, `add_locales`, `remove_locales`, `set_base_locale`,
`set_locale`.
Copy: `list_translations`, `set_localized_text`, `set_localized_texts`, `translate_locales`,
`export_translations_csv`, `import_translations_csv`.
Design: `set_locale_override`, `reset_locale_overrides`.

### Export

`export_png` for one board, `export_all` for the project in canvas order. Both take an optional
`locale`, which switches the canvas, captures, and switches back.

**While iterating, always pass `scale: 0.25`.** A full size board is megabytes of base64 in the
response and there is nothing in it your eye needs at proof time. Switch to `save: true` for the
final delivery and get paths back instead of a wall of data.

## A session that works

1. `list_artboards` to get ids.
2. `get_artboard` on the one you are changing, to get element ids and current values.
3. Make the change with the batched tool: `add_elements` for new layers, `update_element` for edits.
4. `measure_element` if text moved or grew.
5. `export_png` with `scale: 0.25` and look at it.
6. Iterate on 3 to 5.
7. `export_all` with `save: true` when it is right.

Do not skip step 5. You cannot see the canvas, and a design that reads correctly as JSON regularly
looks wrong as an image.

## Troubleshooting

**A tool returned `ok` and nothing changed.** Almost always rule 4 (a lone `width`), rule 12 (a
locale edit that went to the base document), or a locale override on a property that is shared until
detached.

**"No such element."** The id came from a different artboard. Element ids are unique per board, and
several tools accept an `artboardId` precisely to disambiguate.

**Everything hangs after one call.** A modal is open in the page, or two mutations went out in one
tick. Re-run with `--verbose` to see the page console.

**`measure_element` says the element is not on screen.** The project is not open. Call `open_project`.

**The first tool call takes 20 seconds.** That is the browser boot. Every later call is fast.

**The export is a white board.** A gradient background was written half filled somewhere. Set it
again through `set_background` with all three of `color1`, `color2` and `angle`.

**A layer exports but does not show in the preview dialog, or the reverse.** That is an app level
renderer gap, not a tool problem. Report it rather than working around it in the design.

## Related skills

- **store-screenshots** for the end to end pipeline these tools sit under
- **app-preview-video** for the timeline and recording tools in context
- **store-localization** for the 14 language tools and the overlay model
- **store-compliance** for what has to be true before any of this ships
