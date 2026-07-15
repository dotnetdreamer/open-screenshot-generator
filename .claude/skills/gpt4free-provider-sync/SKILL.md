---
name: gpt4free-provider-sync
description: Check the latest xtekky/gpt4free releases for provider additions/changes and decide whether Open Screenshot Generator's AI providers need the same. Use when asked to "check gpt4free", "see what providers gpt4free added/changed", sync/compare our providers against gpt4free, or add a new web AI provider. Also holds the full checklist for wiring a new browser (webview) provider end to end.
---

# gpt4free provider sync

Our AI providers are "inspired by" xtekky/gpt4free. Periodically the user wants to know what gpt4free changed provider-wise in its recent releases, and whether we should mirror it. This skill is the repeatable procedure plus the wiring checklist for adding a provider.

**Standing rule from the user: present the analysis and get their confirmation BEFORE changing any code.** They confirm the analysis first, then decide what (if anything) to build.

## 1. Get the real changelog (the release notes are empty)

gpt4free's GitHub Releases carry no prose, just a "Full Changelog" link. Do NOT trust a WebFetch of the releases page for provider detail, and the HTML compare page often answers "This comparison is taking too long to generate." Use the **compare API** instead.

1. Last N release tags (newest first):
   `https://api.github.com/repos/xtekky/gpt4free/releases?per_page=6` -> read each `tag_name`.
2. To cover the **last 3 releases**, diff the release just before them against the newest:
   base = `tags[3]`, head = `tags[0]`, so
   `https://api.github.com/repos/xtekky/gpt4free/compare/<tags[3]>...<tags[0]>`
   (e.g. `v7.8.1...v7.8.4` covers v7.8.2, v7.8.3, v7.8.4).
3. From that JSON read:
   - `files[]`: each `{ filename, status }`. **Filter to paths containing `Provider`** (`g4f/Provider/...`). `status` is `added` / `removed` / `renamed` / `modified`. `added`/`removed` provider files are the signal that a provider was introduced or dropped; `renamed` (e.g. a single `Foo.py` becoming a `foo/` package) is usually just a refactor of the same service.
   - `commits[].commit.message`: quote provider-naming messages ("Delete old GLM", "Add X", etc.).
   - If `files` looks truncated (GitHub caps compare at ~300 files, and `total_commits` is large), fall back to per-file history under `g4f/Provider/`.
4. Cross-check the live registry for what class each model uses:
   `https://raw.githubusercontent.com/xtekky/gpt4free/main/g4f/models.py`.

## 2. Map it against OUR two provider surfaces

We only have two, and most gpt4free churn touches neither.

- **Browser (webview) adapters** in [webAdapters.ts](../../../src/lib/ai/webAdapters.ts) (`WEB_ADAPTERS` + the `WebProviderId` union). These drive a **logged-in site's chat UI** in a hidden Tauri window. This is gpt4free's `needs_auth` / nodriver "chromium" equivalent. Current set: claude, chatgpt, gemini, copilot, deepseek, qwen, perplexity, glm.
- **Keyless free endpoints** in [freeProviders.ts](../../../src/lib/ai/freeProviders.ts) (pollinations, ollama, lmstudio). OpenAI-compatible HTTP, **free on purpose** only.

## 3. The relevance filter (why most changes are "do nothing")

gpt4free ships dozens of providers; the majority are reverse-engineered free HTTP endpoints that break the moment a vendor patches their site. We **deliberately do not mirror those** (see the freeProviders.ts header comment). Only act on:

- (a) a change to a site **we already drive** (selector/host/auth shifts, usually the `needs_auth` providers), or
- (b) a **genuinely new browser-drivable chat site** with a real free tier, worth adding as a new webview adapter, or
- (c) a new **keyless-by-design, OpenAI-compatible** endpoint (candidate for freeProviders.ts).

Ignore, and say so explicitly in the analysis: router/loader refactors, disk-cache/`FileStorage` infra, captcha-bypass tweaks, lazy-loading, build/test fixes, and the constant churn of throwaway free-API providers (Blackbox, DeepInfra, PuterJS, etc.).

Write the verdict per surface: "none of the changed files touch a site we drive; nothing to port" is the common and correct outcome. A provider gpt4free merely *reorganized* (like GLM's file->package move in v7.8.x) is not new; call it out but do not treat it as a keep-up item.

## 4. Adding a browser provider (wire ALL of these)

Learned adding GLM (chat.z.ai). Miss one and it half-breaks silently.

1. **[webAdapters.ts](../../../src/lib/ai/webAdapters.ts)** - add the id to the `WebProviderId` union AND an entry to `WEB_ADAPTERS`. This one file is the source of truth: the UI picker, host routing (`adapterForHost`), `WEB_PROVIDERS`, and `extensionMatchPatterns()` all derive from it. Selectors always rot, so provide layered lists and mark `tested: false`. For `loggedOut`, prefer a stable sign-in testid/anchor; avoid a generic `a[href*="login"]` (false-positives lock signed-in users out). Note whether the site allows anonymous/guest use.
2. **[web_session.rs](../../../src-tauri/src/web_session.rs)** - add `("<id>", "<fresh-chat-url>")` to the `PROVIDERS` array. **The desktop window opens from THIS map, not from webAdapters.** Omitting it makes the window fail with "unknown provider".
3. **`extension/src/adapters/<id>.ts`** - one line: `registerAdapter('<id>');` (copy any sibling).
4. **[extension/manifest.json](../../../extension/manifest.json)** - add `https://<host>/*` to BOTH `host_permissions` and `web_accessible_resources[0].matches` (and the `description` provider list).
5. **[package.json](../../../package.json) `build:extension`** - append `extension/src/adapters/<id>.ts`. The esbuild input list is **explicit, not a glob**, so a new adapter file is otherwise never built.
6. **[src-tauri/capabilities/assistant.json](../../../src-tauri/capabilities/assistant.json)** - add `https://<host>/*` to `remote.urls`. **This is the one that fails SILENTLY.** The injected agent reports back over Tauri events (`core:event:allow-emit`), and Tauri only allows `emit` from remote origins on this whitelist. Miss it and the agent installs, boots, and drives the page but every event is dropped by the ACL (the agent's `send()` swallows the emit error), so the shell sees NOTHING: no `ready`, so the queued job never dispatches, and the run just hangs. Symptom when testing: `agentInstalled: true` on the page but zero abs-web-event. Capabilities are compiled into the exe by tauri-build, so this needs a rebuild.

Nothing else in the UI needs touching: [WebSessionModePanel.tsx](../../../src/components/artboard-studio/start/WebSessionModePanel.tsx) renders straight from `WEB_PROVIDER_IDS` (a new provider shows with a "not tested" badge automatically), and `PROMPT_BUDGETS` in [AgentStartScreen.tsx](../../../src/components/artboard-studio/start/AgentStartScreen.tsx) is a `Partial` map (only ChatGPT has a hard cap; an absent provider falls back to the full prompt, which is fine).

## 5. Build + verify

```
npm run build:assistant-agent   # rebundles the injected agent (webAssistantAgent.ts). It is include_str!'d into the exe at COMPILE time, so a running tauri:dev never picks up selector edits until a rebuild.
npm run build:extension         # confirms the new adapter file compiles into dist/adapters/<id>.js
npm run typecheck               # 3 pre-existing errors are known/unrelated: CanvasArea.tsx:296, TextElement.tsx:91, TextElement.tsx:117. Your change must add zero new ones.
```

New adapters are best-effort until selectors are verified against the live site. Live-testing recipe (scratch Tauri instance, copied profile, CDP harness, op-log forensics) is in the `tauri-desktop-integration` memory; the embedded-webview architecture and the hard-won login/iframe correctness rules are in `embedded-webview-account-mode`.

## Reasoning-model providers (GLM, DeepSeek R1, Qwen QwQ)

A reasoning model shows a "thinking" placeholder for many seconds before its answer. `waitForReply`'s only guard against returning early is the `streaming` (stop-button) selector — if it's dead/guessed, the text-settle heuristic (1.2s) returns the stable "thinking" placeholder as the answer and the plan parser rejects it. Since these sites often have no stable CSS stop button, add a per-adapter **`isGenerating?: () => boolean`** hook (reads the live "Thinking…/Skip"-style control by text; CSS can't match text) — it's OR'd into `waitForReply`'s streaming check. Capture the in-progress control live (CDP button-dump while it generates) rather than guessing. Also: these models can't fetch the hosted catalog (reply CANNOT_FETCH), and some (GLM) emit a junk JSON skeleton alongside the sentinel — the AgentStartScreen URL branch caches 'fail' on the sentinel regardless of junk JSON and uses `extractJsonCandidates` + token-match (not first-only `extractJson`), so verify a new reasoning provider's can't-fetch verdict actually caches (else every run re-pays the URL round-trip).
