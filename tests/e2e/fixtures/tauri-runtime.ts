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

/** A folder of the user's app code, as Rust's own picker hands it back. */
export interface TauriCodeFolder {
  name: string;
  /** Absolute and canonical, the way Rust's grant book stores it. */
  path: string;
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
  /**
   * What Rust's code folder dialog (abs_claude_pick_folder) returns. `null`
   * simulates a cancel. Rust refuses a folder by rejecting with the sentence
   * the user reads, so a refusal is an `errors` entry for that command.
   */
  codeFolder: TauriCodeFolder | null;
  /** Canned results per command. Overrides every default below. */
  responses: Record<string, unknown>;
  /**
   * Commands whose answer from `responses` waits until the test calls
   * `window.__E2E_TAURI__.releaseCommands()`, to do something while one is in
   * flight. A held abs_claude_prompt or abs_codex_prompt is ended by its stop
   * command with the same id, as Rust ends it.
   */
  held: string[];
  /** Commands that must reject, mapped to the rejection message. */
  errors: Record<string, string>;
  /**
   * Canned answers for tauri-plugin-http, the app's way out to App Store
   * Connect, Google Play and the AI providers. The first rule whose `match`
   * (a regular expression source) finds "METHOD url" answers; anything else
   * gets a 404 with a JSON error list, which is how those APIs say they have
   * nothing. Nothing leaves the browser, so the offline guard never sees it.
   * Every request is kept in `window.__E2E_TAURI__.httpRequests`.
   */
  http: TauriHttpRule[];
}

export interface TauriHttpRule {
  match: string;
  status?: number;
  headers?: Record<string, string>;
  /** Text body. */
  body?: string;
  /** Binary body, such as a gzip report. Wins over `body`. */
  bodyBase64?: string;
  /**
   * Keep the answer until the test calls `window.__E2E_TAURI__.releaseHttp()`,
   * to do something while the request is still in flight.
   */
  hold?: boolean;
}

export const DEFAULT_TAURI_CONFIG: TauriMockConfig = {
  os: 'macos',
  windowLabel: 'main',
  savePath: '/tmp/osg-e2e/',
  openPath: '/tmp/osg-e2e',
  codeFolder: { name: 'marbly', path: '/Users/e2e/code/marbly' },
  responses: {},
  held: [],
  errors: {},
  http: [],
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
    /**
     * The Claude Code processes started and not stopped, by spawn id, with
     * the code folders each can read. What abs_claude_list reports. Rust
     * keeps its processes when the editor reloads, so this outlives a reload
     * too: it is kept in sessionStorage, which lasts as long as the tab.
     */
    claudeProcesses: loadClaudeProcesses(),
    /** The Codex processes started and not stopped, by spawn id, with their thread. Kept like claudeProcesses. */
    codexProcesses: loadCodexProcesses(),
    /** tauri-plugin-http traffic: every request, and the ones in flight by resource id. */
    httpRequests: [],
    httpNext: 1,
    httpPending: {},
    httpBodies: {},
    /** Answers of rules with \`hold\`, waiting for releaseHttp(). */
    httpHeld: [],
    /** Send every held answer. Returns how many there were. */
    releaseHttp() {
      const held = state.httpHeld.splice(0);
      held.forEach((release) => release());
      return held.length;
    },
    /** Answers of commands in config.held, waiting for releaseCommands(). */
    commandsHeld: [],
    /** Send every held command answer. Returns how many there were. */
    releaseCommands() {
      const held = state.commandsHeld.splice(0);
      held.forEach((entry) => entry.release());
      return held.length;
    },
  };
  window.__E2E_TAURI__ = state;

  function httpSend(rid) {
    const request = state.httpPending[rid];
    delete state.httpPending[rid];
    const key = (request.method || 'GET') + ' ' + request.url;
    const rule = (state.config.http || []).find((candidate) => new RegExp(candidate.match).test(key));
    const answer = () => {
      const status = rule ? (rule.status ?? 200) : 404;
      let bytes;
      if (rule && rule.bodyBase64) {
        bytes = Uint8Array.from(atob(rule.bodyBase64), (char) => char.charCodeAt(0));
      } else {
        bytes = new TextEncoder().encode(
          rule
            ? rule.body ?? ''
            : JSON.stringify({ errors: [{ status: '404', code: 'NOT_FOUND', title: 'Not found', detail: 'No canned response for ' + key }] })
        );
      }
      const responseRid = state.httpNext++;
      state.httpBodies[responseRid] = { bytes, sent: false };
      const headers = rule && rule.headers ? rule.headers : { 'content-type': 'application/json' };
      return { status, statusText: String(status), url: request.url, headers: Object.entries(headers), rid: responseRid };
    };
    if (rule && rule.hold) return new Promise((resolve) => state.httpHeld.push(() => resolve(answer())));
    return answer();
  }

  // The plugin reads a body in chunks whose last byte says what the chunk is:
  // 0 for data, 1 for the end of the body.
  function httpReadBody(rid) {
    const body = state.httpBodies[rid];
    if (!body || body.sent) {
      delete state.httpBodies[rid];
      return [1];
    }
    body.sent = true;
    const chunk = new Uint8Array(body.bytes.length + 1);
    chunk.set(body.bytes);
    chunk[body.bytes.length] = 0;
    return Array.from(chunk);
  }

  function loadClaudeProcesses() {
    try {
      const saved = JSON.parse(sessionStorage.getItem('__e2e_tauri_claude_processes__') || '{}');
      return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
    } catch {
      return {};
    }
  }
  function loadCodexProcesses() {
    try {
      const saved = JSON.parse(sessionStorage.getItem('__e2e_tauri_codex_processes__') || '{}');
      return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
    } catch {
      return {};
    }
  }
  function saveCodexProcesses() {
    try {
      sessionStorage.setItem('__e2e_tauri_codex_processes__', JSON.stringify(state.codexProcesses));
    } catch {
      // As for the Claude Code processes.
    }
  }
  function saveClaudeProcesses() {
    try {
      sessionStorage.setItem('__e2e_tauri_claude_processes__', JSON.stringify(state.claudeProcesses));
    } catch {
      // A document with no storage of its own keeps them for its own life only.
    }
  }

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

  // ---- code folders (claude_code.rs, code_folders.rs) --------------------
  // Forward slashes, and no letter case where the OS ignores it, which is
  // how Rust compares a path with a folder.
  function folderKey(path) {
    const forward = String(path).split('\\\\').join('/').replace(/\\/+$/, '');
    return config.os === 'linux' ? forward : forward.toLowerCase();
  }

  function liveFolders() {
    const all = [];
    for (const folders of Object.values(state.claudeProcesses)) all.push(...folders);
    return all;
  }

  // A 1x1 PNG, and a square SVG that states its own size.
  const PNG_1X1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
  const SVG_ICON =
    '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">' +
    '<rect width="96" height="96" rx="21" fill="#7C5CFF"/></svg>';

  /** The picture Rust would read, with its refusals in the order Rust checks them. */
  function readProjectImage(path) {
    const folders = liveFolders();
    if (!folders.length) throw new Error('No code folder is attached to this chat');
    const file = folderKey(path);
    if (!folders.some((folder) => file.startsWith(folderKey(folder) + '/'))) {
      throw new Error('That file is not in a code folder attached to this chat');
    }
    const extension = (file.split('/').pop() || '').split('.').pop();
    if (!['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'].includes(extension)) {
      throw new Error('Only PNG, JPEG, WebP, GIF and SVG files can be imported');
    }
    if (extension === 'svg') return new TextEncoder().encode(SVG_ICON).buffer;
    return Uint8Array.from(atob(PNG_1X1), (c) => c.charCodeAt(0)).buffer;
  }

  /**
   * Why Rust would refuse an MCP export's folder (mcp_export_problem in
   * mcp_server.rs), or null. No folder means the default one, which needs no
   * check. The user's own Export dialog (abs_write_export_png) is never
   * checked.
   */
  function mcpExportProblem(directory) {
    if (typeof directory !== 'string' || !directory.trim()) return null;
    const forward = directory.split('\\\\').join('/');
    const absolute = forward.startsWith('/') || /^[a-zA-Z]:\\//.test(forward);
    if (!absolute || forward.split('/').some((part) => part === '.' || part === '..')) {
      return 'directory must be a full folder path without . or .. in it. Leave it out to use the default folder';
    }
    const folders = liveFolders();
    if (!folders.length) return null;
    if (forward.startsWith('//')) {
      return 'Exports cannot be saved to a network folder while the agent is reading a code folder. Leave directory out to use the default folder';
    }
    const dir = folderKey(directory);
    if (folders.some((folder) => dir === folderKey(folder) || dir.startsWith(folderKey(folder) + '/'))) {
      return 'Exports cannot be saved inside the code folder the agent is reading. Leave directory out to use the default folder';
    }
    return null;
  }

  // ---- the IPC itself ----------------------------------------------------
  async function invoke(cmd, args, options) {
    args = args ?? {};
    state.calls.push({ cmd, args: safe(args, 0), options: options ? safe(options, 0) : null });

    if (Object.prototype.hasOwnProperty.call(state.config.errors, cmd)) {
      throw new Error(state.config.errors[cmd]);
    }
    if (Object.prototype.hasOwnProperty.call(state.config.responses, cmd)) {
      const answer = state.config.responses[cmd];
      if ((state.config.held || []).includes(cmd)) {
        return new Promise((resolve, reject) => {
          state.commandsHeld.push({ cmd, id: args.id, release: () => resolve(answer), stop: (message) => reject(new Error(message)) });
        });
      }
      return answer;
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
      // The bridge ignores an 'abs-mcp-request' whose payload does not carry
      // this value as its nonce, so a spec that emits one has to include it.
      case 'abs_mcp_bridge_nonce':
        return 'e2e-bridge-nonce';
      case 'abs_mcp_write_png':
      case 'abs_write_export_png': {
        if (cmd === 'abs_mcp_write_png') {
          // Rust rejects with the sentence the agent reads.
          const problem = mcpExportProblem(args.directory);
          if (problem) throw new Error(problem);
        }
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
      // Claude Code (claude_code.rs). By default none is installed, which is
      // what the agent screen's first tab finds on mount. A spec that drives
      // the agent answers detect/start through config.responses and plays the
      // process's output with emitFromBackend('abs-claude-event', ...).
      case 'abs_claude_detect':
        return { found: false };
      case 'abs_claude_start': {
        // Rust grants a requested code folder only when its dialog picked it
        // and it still passes the checks. Here every one does, so the process
        // can read them all and none is missing. A spec that wants a missing
        // folder answers this command through config.responses.
        const start = args.args || {};
        const folders = Array.isArray(start.folders) ? start.folders.slice().sort() : [];
        if (typeof start.spawnId === 'string') {
          state.claudeProcesses[start.spawnId] = folders;
          saveClaudeProcesses();
        }
        return { pid: 4242, workspace: '/agent/session', mcpUrl: 'http://127.0.0.1:8722/mcp', missingFolders: [] };
      }
      case 'abs_claude_stop':
        delete state.claudeProcesses[args.spawnId];
        saveClaudeProcesses();
        return null;
      case 'abs_claude_send':
      case 'abs_claude_close_input':
        return null;
      case 'abs_claude_list':
        return Object.entries(state.claudeProcesses).map(([spawnId, folders]) => ({ spawnId, busy: false, folders }));
      case 'abs_claude_page_epoch':
        return 1;
      case 'abs_claude_pick_folder':
        return state.config.codeFolder;
      case 'abs_claude_forget_folder':
        return null;
      // A tauri::ipc::Response in Rust, so the page gets an ArrayBuffer.
      case 'abs_claude_read_project_image':
        return readProjectImage(args.path);
      // Codex (codex.rs), modelled the same way: none is installed by
      // default, and a spec that drives it answers detect through
      // config.responses and plays notifications with
      // emitFromBackend('abs-codex-event', ...).
      case 'abs_codex_detect':
        return { found: false, models: [] };
      // One prompt through either CLI (abs_claude_prompt, abs_codex_prompt),
      // for Growth's writing jobs. The app sends one only after a detect says
      // the CLI is ready, so a spec answers both through config.responses.
      case 'abs_claude_prompt':
      case 'abs_codex_prompt':
        throw new Error('Not installed in the test harness');
      // Stop for one of those: a prompt held under the same id ends the way
      // Rust ends it, and a stop for anything else does nothing, as in Rust.
      case 'abs_claude_prompt_stop':
      case 'abs_codex_prompt_stop': {
        const prompt = cmd === 'abs_claude_prompt_stop' ? 'abs_claude_prompt' : 'abs_codex_prompt';
        const stopped = state.commandsHeld.filter((entry) => entry.cmd === prompt && entry.id === args.id);
        for (const entry of stopped) {
          state.commandsHeld.splice(state.commandsHeld.indexOf(entry), 1);
          entry.stop((prompt === 'abs_claude_prompt' ? 'Claude Code' : 'Codex') + ' was stopped');
        }
        return null;
      }
      case 'abs_codex_start': {
        const start = args.args || {};
        const threadId = typeof start.resume === 'string' ? start.resume : '01a13963-abeb-7f92-b6ea-64f6cb531353';
        if (typeof start.spawnId === 'string') {
          state.codexProcesses[start.spawnId] = threadId;
          saveCodexProcesses();
        }
        return { pid: 5151, threadId, resumed: typeof start.resume === 'string', model: 'gpt-6.1-sol', mcpUrl: 'http://127.0.0.1:8722/mcp' };
      }
      case 'abs_codex_stop':
        delete state.codexProcesses[args.spawnId];
        saveCodexProcesses();
        return null;
      case 'abs_codex_send':
      case 'abs_codex_interrupt':
        return null;
      case 'abs_codex_list':
        return Object.entries(state.codexProcesses).map(([spawnId, threadId]) => ({ spawnId, busy: false, threadId }));
      case 'abs_codex_page_epoch':
        return 1;
      // In-app updates (updater.rs). By default this build has no update
      // server, which is what a local build reports, so the app never checks.
      // A spec that drives updates answers abs_update_state and
      // abs_update_check through config.responses and plays the shell's
      // state changes with emitFromBackend('abs-update-state', ...).
      case 'abs_update_state':
      case 'abs_update_check':
        return { mode: 'off', reason: 'unconfigured', currentVersion: '1.0.0', phase: { phase: 'idle' }, checkedAt: null };
      case 'abs_update_install':
      case 'abs_update_flushed':
        return null;

      // -- Capture (src-tauri/src/device_capture.rs) ----------------------
      // No simulator, emulator or phone until a spec lists some through
      // config.responses. A screenshot is drawn here, at the size a spec puts
      // in config.responses.__captureSize (an iPhone 17 Pro Max's 1320 x 2868
      // when unset), in a colour and with a number that change per call, so
      // a spec can tell two screenshots apart. With responses.__captureHold
      // set, a full screenshot waits for releaseCommands(), so a spec can edit
      // while one is being taken. A recording comes out as a short WebM drawn
      // here when responses.__recordMovie is set, and as an error otherwise.
      case 'abs_capture_devices':
        return { ios: { devices: [], models: [] }, android: { devices: [], models: [] } };
      case 'abs_capture_apps':
        return [];
      case 'abs_capture_start_device':
      case 'abs_capture_tidy_status_bar':
      case 'abs_capture_appearance':
      case 'abs_capture_launch':
      case 'abs_capture_record_start':
        return null;
      case 'abs_capture_create_simulator':
        return '00000000-0000-4000-8000-000000000000';
      case 'abs_capture_screenshot': {
        if (!args.preview && state.config.responses.__captureHold) {
          await new Promise((resolve) => state.commandsHeld.push({ cmd, id: args.id, release: resolve, stop: resolve }));
        }
        const size = state.config.responses.__captureSize || { width: 1320, height: 2868 };
        const scale = args.preview ? 0.25 : 1;
        state.captures = (state.captures || 0) + (args.preview ? 0 : 1);
        const canvas = new OffscreenCanvas(Math.round(size.width * scale), Math.round(size.height * scale));
        const context = canvas.getContext('2d');
        context.fillStyle = 'hsl(' + ((state.captures * 67) % 360) + ', 70%, 55%)';
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.fillStyle = '#ffffff';
        context.font = Math.round(160 * scale) + 'px sans-serif';
        context.fillText('Capture ' + state.captures, 80 * scale, 400 * scale);
        const blob = await canvas.convertToBlob({ type: args.preview ? 'image/jpeg' : 'image/png' });
        return await blob.arrayBuffer();
      }
      case 'abs_capture_record_stop': {
        if (!state.config.responses.__recordMovie) throw new Error('The test runtime records nothing');
        const canvas = document.createElement('canvas');
        canvas.width = 132;
        canvas.height = 286;
        const context = canvas.getContext('2d');
        const recorder = new MediaRecorder(canvas.captureStream(15), { mimeType: 'video/webm' });
        const chunks = [];
        recorder.ondataavailable = (event) => {
          if (event.data.size) chunks.push(event.data);
        };
        const stopped = new Promise((resolve) => {
          recorder.onstop = resolve;
        });
        recorder.start();
        for (let frame = 0; frame < 8; frame += 1) {
          context.fillStyle = 'hsl(' + frame * 40 + ', 70%, 55%)';
          context.fillRect(0, 0, canvas.width, canvas.height);
          await new Promise((resolve) => setTimeout(resolve, 60));
        }
        recorder.stop();
        await stopped;
        return await new Blob(chunks, { type: 'video/webm' }).arrayBuffer();
      }

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


      // -- tauri-plugin-http, answered from config.http ---------------------
      case 'plugin:http|fetch': {
        const clientConfig = args.clientConfig || {};
        const rid = state.httpNext++;
        const request = {
          method: clientConfig.method || 'GET',
          url: clientConfig.url,
          headers: Object.fromEntries((clientConfig.headers || []).map(([name, value]) => [String(name).toLowerCase(), value])),
          body: clientConfig.data ? new TextDecoder().decode(new Uint8Array(clientConfig.data)) : null,
        };
        state.httpRequests.push(request);
        state.httpPending[rid] = request;
        return rid;
      }
      case 'plugin:http|fetch_send':
        return httpSend(args.rid);
      case 'plugin:http|fetch_read_body':
        return httpReadBody(args.rid);
      case 'plugin:http|fetch_cancel':
      case 'plugin:http|fetch_cancel_body':
        return null;

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
