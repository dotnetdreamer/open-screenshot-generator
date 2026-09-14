// A browser-injectable Tauri v2 IPC runtime.
//
// The desktop build is the SAME static bundle as the web build; the only thing
// that tells them apart is `isTauri()`, which is
// `'__TAURI_INTERNALS__' in window` (src/lib/desktop.ts). So a desktop E2E run
// is a normal browser run with this object installed before any app script,
// plus a WebKit engine to stand in for the macOS WKWebView.
//
// Why not tauri-driver: the official WebDriver bridge supports Linux and
// Windows only, so it cannot run on macOS at all, and even where it does run it
// cannot assert on what the app asked the OS to do. Mocking the IPC boundary
// tests the thing that actually differs between the two platforms: which
// commands the app sends, with which arguments.
//
// The contract below is copied from @tauri-apps/api (core.js `invoke`,
// mocks.js `mockIPC`), so the real, unmodified plugin packages the app imports
// talk to it without knowing.

/** A single IPC call the app made, as recorded by the mock. */
export interface TauriCall {
  cmd: string;
  /** Structured-clone-safe view of the arguments (binary bodies are summarised). */
  args: Record<string, unknown>;
  /** invoke()'s third parameter, where the fs plugin hides the target path. */
  options: Record<string, unknown> | null;
}

/** A file the app asked the desktop shell to write. */
export interface TauriWrittenFile {
  path: string;
  bytes: number;
  /** Which command wrote it: the fs plugin, or the app's own Rust command. */
  via: 'plugin:fs|write_file' | 'plugin:fs|write_text_file' | 'abs_write_export_png' | 'abs_mcp_write_png';
}

export interface TauriMockConfig {
  /** Reported by the path plugin's separator handling and dialog defaults. */
  os: 'macos' | 'windows' | 'linux';
  /** The window label this document believes it is. 'main' is the editor. */
  windowLabel: string;
  /**
   * What the native save dialog returns.
   * A value ending in a separator is treated as a folder and the app's own
   * suggested file name is appended, which is what makes export tests able to
   * assert on the file name the app chose.
   * `null` simulates the user cancelling the dialog.
   */
  savePath: string | null;
  /** What the native folder picker returns. `null` simulates a cancel. */
  openPath: string | null;
  /** Canned results per command. Overrides every default below. */
  responses: Record<string, unknown>;
  /** Commands that must reject, mapped to the rejection message. */
  errors: Record<string, string>;
}

export const DEFAULT_TAURI_CONFIG: TauriMockConfig = {
  os: 'macos',
  windowLabel: 'main',
  savePath: '/tmp/osg-e2e/',
  openPath: '/tmp/osg-e2e',
  responses: {},
  errors: {},
};

/**
 * The script installed via `context.addInitScript`, so it is in place before
 * the app's first module evaluates in every document of the context, the
 * detached panel windows included.
 *
 * It is a string rather than a serialised function on purpose: it has to run
 * verbatim in the page, and a transpiled closure would drag helpers in with it.
 */
export function tauriInitScript(config: TauriMockConfig): string {
  return `(() => {
  const config = ${JSON.stringify(config)};
  const sep = config.os === 'windows' ? '\\\\' : '/';

  const state = {
    config,
    calls: [],
    files: [],
    openedUrls: [],
    /** Commands with no default and no configured response. */
    unhandled: [],
    /** Events the app emitted, so a test can assert on cross-window traffic. */
    emitted: [],
  };
  window.__E2E_TAURI__ = state;

  // ---- callback registry (mocks.js contract) -----------------------------
  const callbacks = new Map();
  function transformCallback(callback, once) {
    const id = window.crypto.getRandomValues(new Uint32Array(1))[0];
    callbacks.set(id, (data) => {
      if (once) callbacks.delete(id);
      return callback && callback(data);
    });
    return id;
  }
  function unregisterCallback(id) { callbacks.delete(id); }
  function runCallback(id, data) {
    const cb = callbacks.get(id);
    if (cb) cb(data);
  }

  // ---- event plugin ------------------------------------------------------
  //
  // Tauri's emit reaches EVERY window of the app, not just the one that sent
  // it, and this app leans on that: a detached panel window is a second
  // document that talks to the editor over the 'abs-panels-bus' event
  // (src/lib/panels/bus.ts). A per-document listener map would make the two
  // windows deaf to each other and quietly reduce that whole feature to
  // untestable on desktop. BroadcastChannel is the browser's equivalent, and
  // it is what the app's own web driver already uses, so the mocked bus and
  // the real web one behave the same way.
  const listeners = new Map();
  let bus = null;
  try {
    bus = new BroadcastChannel('__e2e_tauri_event_bus__');
  } catch {
    bus = null;
  }

  function handleListen(args) {
    const list = listeners.get(args.event) || [];
    list.push(args.handler);
    listeners.set(args.event, list);
    return args.handler;
  }

  function deliverLocally(event, payload) {
    for (const handler of listeners.get(event) || []) {
      runCallback(handler, { event, id: handler, payload });
    }
  }

  function broadcast(event, payload) {
    if (!bus) return;
    try {
      bus.postMessage({ event, payload });
    } catch {
      // A payload that will not structured-clone is the app's problem to fix,
      // not a reason to lose the local delivery that already happened.
    }
  }

  if (bus) {
    bus.onmessage = (message) => {
      const data = message && message.data;
      if (!data || typeof data.event !== 'string') return;
      // Deliver only. Re-broadcasting here would loop between windows.
      deliverLocally(data.event, data.payload);
    };
  }

  function handleEmit(args) {
    state.emitted.push({ event: args.event, payload: args.payload ?? null });
    deliverLocally(args.event, args.payload);
    broadcast(args.event, args.payload ?? null);
    return null;
  }
  function handleUnlisten(args) {
    const list = listeners.get(args.event);
    if (!list) return null;
    const i = list.indexOf(args.eventId ?? args.id);
    if (i !== -1) list.splice(i, 1);
    return null;
  }

  /**
   * Deliver an event to this document as though Rust had emitted it.
   * Used by tests to drive desktop-only push updates (MCP status, panel
   * intents) without a Rust side.
   */
  state.emitFromBackend = (event, payload) => {
    // Not recorded in state.emitted: that list is what the APP sent, and
    // conflating the two would make an assertion about the app's own traffic
    // pass on a message the test itself injected.
    deliverLocally(event, payload);
    broadcast(event, payload);
    return null;
  };

  // ---- argument sanitising ----------------------------------------------
  // page.evaluate() has to be able to return the call log, so nothing that
  // fails structured clone may enter it. Binary bodies become a byte count.
  function safe(value, depth) {
    if (value == null) return value;
    if (value instanceof ArrayBuffer) return { __binary: value.byteLength };
    if (ArrayBuffer.isView(value)) return { __binary: value.byteLength };
    if (typeof value === 'function') return { __function: true };
    if (Array.isArray(value)) {
      return depth > 4 ? { __deep: value.length } : value.map((v) => safe(v, depth + 1));
    }
    if (typeof value === 'object') {
      if (depth > 4) return { __deep: true };
      const out = {};
      for (const [k, v] of Object.entries(value)) out[k] = safe(v, depth + 1);
      return out;
    }
    return value;
  }

  function byteLength(value) {
    if (value instanceof ArrayBuffer) return value.byteLength;
    if (ArrayBuffer.isView(value)) return value.byteLength;
    if (typeof value === 'string') return value.length;
    return 0;
  }

  function joinPath(dir, name) {
    if (!dir) return name;
    return dir.endsWith(sep) ? dir + name : dir + sep + name;
  }

  // ---- the IPC itself ----------------------------------------------------
  async function invoke(cmd, args, options) {
    args = args ?? {};
    state.calls.push({ cmd, args: safe(args, 0), options: options ? safe(options, 0) : null });

    if (Object.prototype.hasOwnProperty.call(state.config.errors, cmd)) {
      throw new Error(state.config.errors[cmd]);
    }
    if (Object.prototype.hasOwnProperty.call(state.config.responses, cmd)) {
      return state.config.responses[cmd];
    }

    switch (cmd) {
      // -- the app's own Rust commands (src-tauri/src/lib.rs) --------------
      case 'abs_app_ready':
        return null;
      case 'abs_get_settings':
        return { show_assistant_window: false, mcp_server_enabled: false, devtools_open: false };
      case 'abs_webview_crash_info':
        return null;
      case 'abs_mcp_status':
        return { running: false, port: null, url: null };
      case 'abs_mcp_respond':
        return null;
      case 'abs_mcp_write_png':
      case 'abs_write_export_png': {
        const dir = args.directory ?? '';
        const name = args.fileName ?? 'untitled.png';
        const path = args.subdirectory ? joinPath(joinPath(dir, args.subdirectory), name) : joinPath(dir, name);
        state.files.push({
          path,
          bytes: typeof args.dataBase64 === 'string' ? args.dataBase64.length : 0,
          via: cmd,
        });
        return path;
      }
      case 'abs_oauth_start':
        return { url: 'http://127.0.0.1:0/callback', state: 'e2e' };
      case 'abs_oauth_await':
        return null;
      case 'abs_oauth_cancel':
        return null;
      case 'abs_web_start':
      case 'abs_web_cancel':
      case 'abs_web_login':
      case 'abs_web_close':
      case 'abs_web_clear_sessions':
        return null;
      case 'abs_web_capture':
        return null;

      // -- dialog plugin ---------------------------------------------------
      case 'plugin:dialog|save': {
        const chosen = state.config.savePath;
        if (chosen === null) return null;
        const suggested = (args.options && args.options.defaultPath) || 'untitled';
        return chosen.endsWith(sep) ? chosen + suggested : chosen;
      }
      case 'plugin:dialog|open':
        return state.config.openPath;
      case 'plugin:dialog|message':
      case 'plugin:dialog|ask':
      case 'plugin:dialog|confirm':
        return true;

      // -- fs plugin -------------------------------------------------------
      case 'plugin:fs|write_file':
      case 'plugin:fs|write_text_file': {
        const header = options && options.headers ? options.headers.path : undefined;
        state.files.push({
          path: header ? decodeURIComponent(header) : '<unknown>',
          bytes: byteLength(args),
          via: cmd,
        });
        return null;
      }
      case 'plugin:fs|mkdir':
      case 'plugin:fs|remove':
      case 'plugin:fs|rename':
        return null;
      case 'plugin:fs|exists':
        return false;
      case 'plugin:fs|read_file':
        return [];
      case 'plugin:fs|read_text_file':
        return '';

      // -- path plugin -----------------------------------------------------
      case 'plugin:path|join':
        return (args.paths || []).filter(Boolean).join(sep);
      case 'plugin:path|normalize':
      case 'plugin:path|resolve':
        return (args.paths || [args.path]).filter(Boolean).join(sep);
      case 'plugin:path|basename':
        return String(args.path || '').split(sep).pop();
      case 'plugin:path|dirname':
        return String(args.path || '').split(sep).slice(0, -1).join(sep);
      case 'plugin:path|extname': {
        const base = String(args.path || '').split(sep).pop() || '';
        const dot = base.lastIndexOf('.');
        return dot > 0 ? base.slice(dot + 1) : '';
      }
      case 'plugin:path|resolve_directory':
        return '/tmp/osg-e2e';
      case 'plugin:path|is_absolute':
        return String(args.path || '').startsWith(sep);

      // -- opener plugin ---------------------------------------------------
      case 'plugin:opener|open_url':
        state.openedUrls.push(args.url);
        return null;
      case 'plugin:opener|open_path':
      case 'plugin:opener|reveal_item_in_dir':
        return null;

      // -- event plugin ----------------------------------------------------
      case 'plugin:event|listen':
        return handleListen(args);
      case 'plugin:event|emit':
      case 'plugin:event|emit_to':
        return handleEmit(args);
      case 'plugin:event|unlisten':
        return handleUnlisten(args);

      // -- window / webview ------------------------------------------------
      // core:window:default is read only in this app's capabilities, so the
      // realistic mock answers the getters and no-ops the setters.
      case 'plugin:window|available_monitors':
        return [];
      case 'plugin:window|primary_monitor':
      case 'plugin:window|current_monitor':
      case 'plugin:window|monitor_from_point':
        return null;
      case 'plugin:window|outer_position':
      case 'plugin:window|inner_position':
      case 'plugin:window|cursor_position':
        return { x: 0, y: 0 };
      case 'plugin:window|outer_size':
      case 'plugin:window|inner_size':
        return { width: window.innerWidth, height: window.innerHeight };
      case 'plugin:window|scale_factor':
        return 1;
      case 'plugin:window|is_visible':
      case 'plugin:window|is_focused':
        return true;
      case 'plugin:window|is_minimized':
      case 'plugin:window|is_maximized':
      case 'plugin:window|is_fullscreen':
        return false;
      case 'plugin:window|get_all_windows':
        return [state.config.windowLabel];
      case 'plugin:webview|get_all_webviews':
        return [{ windowLabel: state.config.windowLabel, label: state.config.windowLabel }];

      // Opening a detached panel window on desktop goes through
      // new WebviewWindow(label, { url, ... }), which invokes
      // plugin:webview|create_webview_window and then emits tauri://created
      // from the JS side itself, so nothing here has to play the shell's part.
      //
      // No second document appears: a real OS window is the one thing a browser
      // cannot be talked into. What a test can assert is the request itself,
      // which is where the URL, the label and the geometry are decided. It
      // falls through to the plugin:webview default below, and is recorded.


      default:
        if (cmd.startsWith('plugin:window|') || cmd.startsWith('plugin:webview|')) return null;
        state.unhandled.push(cmd);
        return null;
    }
  }

  window.__TAURI_INTERNALS__ = {
    invoke,
    transformCallback,
    unregisterCallback,
    runCallback,
    callbacks,
    convertFileSrc: (filePath, protocol) =>
      config.os === 'windows'
        ? \`http://\${protocol || 'asset'}.localhost/\${encodeURIComponent(filePath)}\`
        : \`\${protocol || 'asset'}://localhost/\${encodeURIComponent(filePath)}\`,
    metadata: {
      currentWindow: { label: config.windowLabel },
      currentWebview: { windowLabel: config.windowLabel, label: config.windowLabel },
    },
    plugins: {},
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
    unregisterListener: (_event, id) => unregisterCallback(id),
  };
})();`;
}
