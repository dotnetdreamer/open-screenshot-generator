# E2E tests

End to end tests for the two places this app ships: the browser, and the Tauri
desktop shell. Both run the **same bundle**, so the suite runs the same specs
twice rather than maintaining two of them.

```
npm run test:e2e            # web + desktop, the two that run on every push
npm run test:e2e:web        # Chromium, no Tauri
npm run test:e2e:desktop    # WebKit + the Tauri IPC runtime
npm run test:e2e:matrix     # everything, including Safari and iPad
npm run test:e2e:ui         # Playwright's UI mode
npm run test:e2e:report     # open the last HTML report
```

A dev server on `:9002` is started automatically, and an existing one is reused
(`reuseExistingServer` is on everywhere except CI), so `npm run dev` in another
terminal makes the suite start instantly.

## Projects

| Project | Engine | Tauri | Why it exists |
| --- | --- | --- | --- |
| `web` | Chromium | no | What a browser user gets. The default. |
| `desktop` | WebKit | injected | macOS ships WKWebView. Half of `src/lib/desktop.ts` exists because WKWebView ignores `<a download>`, so this is where that code is actually exercised. |
| `desktop-chromium` | Chromium | injected | Windows ships WebView2, which is Chromium. |
| `web-webkit` | WebKit | no | Safari users. |
| `web-mobile` | iPad landscape | no | The coarse pointer path: a finger fires no `mousedown`, never hovers and never right clicks. |

`web` and `desktop` run on every push, and they are what `npm run test:e2e`
runs. The other three are opt in, either with `--project` or through
`npm run test:e2e:matrix`, which runs all five. Note that a bare
`npx playwright test` with no `--project` runs all five too.

## How the desktop build is tested

`isTauri()` is one line:

```ts
return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
```

That is the entire difference between the two builds at runtime. So the desktop
projects install a complete Tauri v2 IPC runtime
(`fixtures/tauri-runtime.ts`) with `context.addInitScript`, before any app
script evaluates. The real, unmodified `@tauri-apps/*` packages the app imports
then talk to it without knowing, because the runtime implements the same
contract their own `mocks.js` does: `invoke`, `transformCallback`,
`unregisterCallback`, `runCallback`, `convertFileSrc` and `metadata`.

Every command the app can send is answered: its own Rust commands
(`abs_app_ready`, `abs_write_export_png`, `abs_mcp_status`, the `abs_web_*`
session commands, the `abs_oauth_*` ones) and the plugin commands
(`plugin:dialog|save`, `plugin:fs|write_file`, `plugin:path|join`,
`plugin:opener|open_url`, `plugin:event|*`, `plugin:window|*`). Anything with no
answer is recorded in `tauri.unhandled()` instead of failing silently, and
`smoke.spec.ts` asserts that list is empty, so a newly added Tauri command
cannot slip past this suite unnoticed.

The event bus is deliberately **cross document**. Tauri's `emit` reaches every
window of the app, and this app leans on that: a detached panel window is a
second document talking to the editor over `abs-panels-bus`
(`src/lib/panels/bus.ts`). The runtime carries events between documents with a
`BroadcastChannel`, which is the same driver the app's own web path uses, so the
mocked bus and the real web one behave alike.

What the mock cannot do is conjure an OS window. On the web, "Open all panels in
a window" is a popup a test can drive directly, and `panels.spec.ts` does. On
desktop the app builds a real `WebviewWindow`, so the test asserts the request
instead: the `plugin:webview|create_webview_window` call carrying the `?panel=`
URL and the host id, then `plugin:window|show` under the `panel-dock` label.

That boundary is also the point of the exercise. A desktop save is not a browser
download: the assertion is that the app sent `plugin:dialog|save` and then wrote
the bytes, with the file name it chose. `tauri.files()` records exactly that.

### Why not tauri-driver

The official WebDriver bridge, `tauri-driver`, supports **Linux and Windows
only**. It cannot run on macOS at all, which is where this app's most
platform-specific code path lives. It also drives the real shell as a black box,
so it can watch a native save dialog open but cannot tell you which command the
app sent or with what arguments.

The tradeoff is honest: these tests prove the app *asks the desktop shell for
the right thing*. They do not prove Rust does the right thing with it. The Rust
side (`src-tauri/src/`) needs its own tests, and packaging is covered by
`.github/workflows/desktop.yml`.

## Layout

```
tests/e2e/
  fixtures/
    test.ts            the base test: platform, tauri, app, hermetic fixtures
    tauri-runtime.ts   the injectable Tauri v2 IPC runtime
    tauri.ts           test-side handle on it (calls, files, emit, setError, ...)
    db.ts              read and seed the Dexie ProjectDatabase directly
  helpers/
    editor.ts          the Editor page object, and the locator policy
    canvas.ts          artboard geometry, pointer gestures, wheel-vs-trackpad
  specs/               the tests
  tools/
    inspect.mjs        dump the live DOM while writing a selector
    static-server.mjs  serve `out/` for the static-export run
```

## Writing a test

```ts
import { test, expect } from '../fixtures/test';

test('a blank project keeps its board across a reload', async ({ app, page }) => {
  await app.startBlankProject();
  await page.reload();
  await app.waitForBoot();
  await expect(app.artboards).toHaveCount(1);
});
```

Fixtures on the callback:

- **`app`** an `Editor`, already navigated and booted. If a test needs to seed
  IndexedDB or localStorage *before* the first load, take `page` instead and
  construct `new Editor(page)` yourself.
- **`platform`** / **`isDesktop`** which build this project is.
- **`tauri`** the IPC handle. On the web projects every read returns empty, so a
  shared spec can assert "this did not touch the desktop shell" without
  branching.
- **`hermetic`** on by default: every request that leaves the origin is aborted.
  A design tool has to open with its community feed, analytics and font CDN all
  unreachable, and a test must not pass or fail because someone else's server
  was up. Turn it off per file with `test.use({ hermetic: false })`.
- **`tauriConfig`** per file overrides for the runtime, e.g.
  `test.use({ tauriConfig: { savePath: null } })` makes the native save dialog
  cancel.

Playwright gives every test its own browser context, so IndexedDB and
localStorage start empty and nothing needs cleaning up between tests.

## Locator policy

The app has almost no `data-testid` of its own, so locators were chosen against
the real DOM rather than by convention:

- **Toolbar buttons carry `title`, not `aria-label`.** They are icon only, so
  `title` is their accessible name, but that stops being true the moment one
  grows a visible label. `getByTitle` is the stable choice.
- **Palette category tiles** carry `title="Browse <Label>"` *and* a visible
  label, so their accessible name is the label text and `getByTitle` is the only
  unambiguous handle.
- **Palette item tiles** carry `aria-label="Add <Label> (<libraryId>)"`, which is
  unique because the library id is in it.
- **Artboards and elements** expose real data attributes, `data-artboard-dom-id`
  and `data-element-id`, and those are what the canvas assertions hang off.
- **Properties controls have ids**: `#textContent`, `#fontSize`, `#lineHeight`,
  `#fontColor`, `#fontFamily`.

## Traps this suite already accounts for

These come from `.agents/AGENTS.md` and from watching the app run. They are the
reasons a naive test here goes wrong.

- **The start dialog is modal.** On an empty database the app opens "Start a new
  project", and Radix marks everything outside an open modal `aria-hidden`. A
  `getByRole` locator cannot see the editor behind it. Go through it
  (`startBlankProject()`) or close it (`dismissStartDialog()`) first.
- **Closing the start dialog sometimes creates a blank project.** `onOpenChange`
  calls `handleSelectTemplate(createBlankProject(...))`, but only when
  `artboards.length === 0 && availableProjects.length > 0`. On the empty
  database a test starts from, closing leaves the canvas bare; once a project
  exists on disk, closing lands on a fresh blank one. `dismissStartDialog()` is
  "give me the chrome, I do not care what is on the canvas";
  `startBlankProject()` is "the project is the point".
- **`title` is the LAST fallback in the accessible name calculation.** Any
  visible text or `sr-only` span inside the element beats it, which is why
  `getByTitle` and `getByRole` disagree on several controls here. The
  `SidebarTrigger` is the clearest case: it carries
  `title="Open elements palette"` and an `sr-only` "Toggle Sidebar", so its
  accessible name is "Toggle Sidebar" and only `getByTitle` finds it by the
  label a human would name.
- **Every Radix `DialogContent` ships an `sr-only` "Close" button**, so
  `getByRole('button', { name: 'Close' })` is ambiguous whenever a dialog is
  open. Scope it, or use the specific control.
- **`locator.dragTo()` does not work on the screenshot strip or the dock
  divider.** Both use `setPointerCapture`, which the high level helper does not
  drive. Use `pointerDrag()`.
- **The environment decides which surfaces exist.** `NEXT_PUBLIC_DISCOVER_URL`
  turns the Community tab on, and `NEXT_PUBLIC_MCP_RELAY_URL` is what makes the
  MCP pill render on the web at all. A local `.env.local` with those set is not
  what CI sees, so a test must not assume either is present.
- **Booting has two stages.** Hydration paints the toolbar; the app then reads
  Dexie and decides between the start dialog and the last project.
  `waitForBoot()` waits for that decision, which is what stops a fast machine
  and a slow one disagreeing about whether a modal is on screen.
- **Inactive tab panels stay mounted.** Scope panel queries to
  `[role="tabpanel"][data-state="active"]`, and remember the left palette is a
  tab panel too, so two are active at once.
- **Boards are laid out at full store resolution and shrunk by a CSS
  transform.** An element's `style.left` is in artboard pixels; its bounding
  rect is in screen pixels. Convert with `boardGeometry()` and `toPagePoint()`,
  and derive the scale from the board's rect rather than its
  `data-display-scale`, because canvas zoom multiplies one and not the other.
- **Canvas interactions are pointer events, never mouse events.** A drag needs a
  real move, down, move, move, up sequence; `pointerDrag()` and
  `dragElementBy()` do that.
- **A wheel is not a trackpad.** The canvas zooms on a mouse wheel and scrolls on
  two fingers, told apart by `deltaMode`. `mouseWheelZoom()` sends a line mode
  wheel, which is the mouse.
- **Text renders at `fontSize / 0.3` px and ignores `element.scale`.** A
  `fontSize` of 48 is `font-size: 160px` on screen.
- **Elements render in two places**, `Artboard.tsx` and `StaticArtboard` inside
  `PreviewDialog.tsx`, so an unscoped `getByText` is ambiguous while a preview
  is open. Always scope to a board or to the dialog.
- **The tips carousel** opens over the editor on a first run and swallows clicks.
  The fixtures set the app's own "show tips at startup" preference to off. A
  test about tips has to turn it back on deliberately.
- **The start dialog is not ready when it is visible.** The app fetches all 101
  template JSON files on boot just to fill in the per-category tab counts, and
  until they land the tabs read an ellipsis and the deck renders skeletons. With
  several browser contexts booting at once they saturate the dev server, and a
  click that goes in before the catalogue arrives simply queues behind it.
  `waitForBoot()` waits for a numeric tab count, which is why it is centralised
  there rather than left to each spec. This was the single largest source of
  flake while the suite was being written.
- **Playwright's WebKit cannot put a `Blob` in IndexedDB.** The write
  transaction fails, where Chromium succeeds. Project versions are stored as
  gzipped Blobs (`src/lib/versions/store.ts`) and so is recorded media, so the
  version round-trip test skips on the `desktop` project behind a capability
  check rather than a browser name. This is very likely a limitation of
  Playwright's WebKit build rather than of real Safari or WKWebView, but it has
  not been confirmed against a real desktop build, and if WKWebView shares it
  then Versions and media are broken on macOS.

## Known defects this suite records

`responsive.spec.ts` documents one, with a `test.fail()` so it reports loudly
the moment it is fixed rather than sitting in a tracker:

**The canvas tool bar and the zoom pill overlap below about 1280px.** They are
positioned independently, one centred and one pinned bottom right, so whether
they collide is purely a function of canvas width. The app already anticipates
this: the tool bar carries `max-md:left-3 max-md:translate-x-0` under a comment
saying it is "pushed to the left edge on a phone so it and the zoom pill share
the bottom row instead of sitting on top of each other". The escape hatch is
right, its breakpoint is not. `md` is 768px and the collision starts just under
1280px, so every tablet and small laptop falls in the gap. At 1080px, an iPad in
landscape, Undo is completely buried and cannot be tapped: Playwright reports
the Zoom Out button intercepting the pointer. Moving the escape hatch to `lg` or
`xl` is the fix.

Three tests elsewhere drive controls in those bars and skip when they overlap,
pointing here, so the defect produces one clear signal instead of four
scattered ones.

## Adding a spec

1. Find the real selector first: `npm run test:e2e:inspect -- --click 'Close,Start with a blank canvas'`
   prints the live buttons, tabs, inputs and artboard geometry.
2. Put shared plumbing in `helpers/`, not in the spec.
3. Assert something a regression would actually break. "The button exists" is
   close to worthless; click it and assert what changed, in the DOM, in the
   database, or in the Tauri IPC.
4. `npx tsc --noEmit` covers `tests/**` as well, and it is the project's real
   gate. Eight pre-existing errors under `promo/` are expected; nothing else is.
