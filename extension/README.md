# Artboard Studio companion extension

Lets the Artboard Studio AI agent run on the Claude, ChatGPT, Gemini, Copilot, DeepSeek, Qwen or
Perplexity account you are already signed into, so you do not need an API key.

> Using the **desktop app**? You do not need this extension. The desktop app opens the assistant in
> its own in-app window, you sign in once, and it drives it there. This extension is only for the
> **web** version, where a page cannot reach another site's session.

## Why an extension is needed (on the web)

A web page cannot read or use a session that belongs to another site. That is the browser's
same-origin rule, and it is not something a page can work around. An extension can, because you
install it deliberately and grant it access to those sites.

Without the extension the agent still works. Artboard Studio falls back to a manual relay: it copies
a prompt to your clipboard, you paste it into the chat with your screenshots attached, and you paste
the reply back. The extension just removes those three steps.

## What it does, and what it does not

It does: open the assistant in a background tab, attach your screenshots, paste the prompt, wait for
the reply, and hand the reply text back to Artboard Studio.

It does not: read your cookies, your API tokens, or any conversation other than the one it started.
The only thing that crosses the boundary is `{prompt, images}` going out and the reply text coming
back.

## Install (unpacked)

1. Build it once from the repo root:

   ```sh
   npm install
   npm run build:extension
   ```

2. Open `chrome://extensions` (or `edge://extensions`).
3. Turn on **Developer mode**.
4. Click **Load unpacked** and select this `extension/` folder.
5. Sign in to whichever of claude.ai, chatgpt.com or gemini.google.com you want to use.

Reload the Artboard Studio tab. The agent's "Free, use my account" tab should now say
"Companion extension connected".

## Running against your own deployment

`manifest.json` lists the origins the bridge is injected into: `localhost:9002`, `localhost:3000`
and `*.github.io`. If you host Artboard Studio somewhere else, add that origin to
`content_scripts[0].matches` and reload the extension.

## When a site redesigns

Every adapter is a list of CSS selectors in `src/lib/ai/webAdapters.ts` (shared with the desktop
app), and the logic that uses them lives once in `src/lib/ai/webDriverCore.ts`. The files under
`extension/src/adapters/` are one-line registrations that pick an adapter by id. Each selector field
takes a list and the first match wins, so a redesign usually needs one new selector rather than new
code, and the fix lands for both the extension and the desktop app at once. The symptom is a "that
site's layout changed" error, and the manual relay keeps working in the meantime.

The first three (Claude, ChatGPT, Gemini) are the exercised adapters; Copilot, DeepSeek, Qwen and
Perplexity are best-effort scaffolding and will likely need selector tuning.
