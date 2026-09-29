# Open Screenshot Generator companion extension

This extension lets the web editor use a Claude, ChatGPT, Gemini, Copilot, DeepSeek, Qwen, or Perplexity account you are signed into. It passes the editor's prompt and screenshots to the assistant and returns the reply.

The desktop app has this built in. You only need the extension for the web editor.

## Why an extension is needed (on the web)

A web page cannot use your session on another site. The extension can do that after you grant it access. Without it, you can still use your account by copying the prompt into a chat and pasting the reply back into the editor.

## What it does, and what it does not

The extension opens the assistant in a background tab, sends the prompt and screenshots, and returns the reply text. It does not read your cookies, API tokens, or other conversations.

## Install (unpacked)

1. From the repository root, run:

   ```bash
   npm install
   npm run build:extension
   ```

2. Open `chrome://extensions` or `edge://extensions`.
3. Turn on **Developer mode**.
4. Click **Load unpacked** and choose this `extension/` folder.
5. Sign in to the assistant you want to use, then reload the Open Screenshot Generator tab.

The **Free, use my account** tab should say **Companion extension connected**.

## Running against your own deployment

`manifest.json` lists the editor sites the extension works with: `localhost:9002`, `localhost:3000`, and `*.github.io`. If you host the editor elsewhere, add your site's origin to `content_scripts[0].matches`, then reload the extension.

## When a site redesigns

The extension finds controls on each assistant site with selectors in [webAdapters.ts](../src/lib/ai/webAdapters.ts). A site redesign can break those selectors. Until they are updated, use the manual copy and paste option in the editor. Claude, ChatGPT, and Gemini are the tested adapters; the others may need adjustments.
