# Artboard Studio companion extension

Lets the Artboard Studio AI agent run on the Claude, ChatGPT or Gemini account you are already
signed into, so you do not need an API key.

## Why an extension is needed

A web page cannot read or use a session that belongs to another site. That is the browser's
same-origin rule, and it is not something a page can work around. An extension can, because you
install it deliberately and grant it access to those three sites.

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

Every adapter is a list of CSS selectors in `src/adapters/<site>.ts`; the logic that uses them lives
once in `src/adapters/driver.ts`. Each field takes a list and the first match wins, so a redesign
usually needs one new selector rather than new code. The symptom is a "that site's layout changed"
error, and the manual relay keeps working in the meantime.
