import { runSession, DriverError, type Stage } from '../../../src/lib/ai/webDriverCore';
import { WEB_ADAPTERS, type WebProviderId } from '../../../src/lib/ai/webAdapters';
import type { RunCommand, RunResponse } from '../protocol';

/**
 * The extension half of "drive a chat window". The fragile DOM logic and the
 * per-site selectors live once in the app source (webDriverCore + webAdapters)
 * and are shared with the desktop embedded-webview agent; this file only wires
 * that core to the extension's chrome.runtime messaging.
 */
export function registerAdapter(id: WebProviderId): void {
  const config = WEB_ADAPTERS[id];

  // executeScript can inject the same file twice into one tab.
  const flag = `__artboardStudioAdapter_${id}`;
  if ((window as unknown as Record<string, boolean>)[flag]) return;
  (window as unknown as Record<string, boolean>)[flag] = true;

  let cancelled = false;

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'abs-cancel') {
      cancelled = true;
      return;
    }
    if (message?.type !== 'abs-run') return;

    const command = message as RunCommand;
    cancelled = false;

    const progress = (stage: Stage) =>
      void chrome.runtime.sendMessage({ type: 'abs-progress', requestId: command.requestId, stage });

    void runSession(
      config,
      { prompt: command.prompt, images: command.images },
      { progress, isCancelled: () => cancelled }
    )
      .then((text) => sendResponse({ ok: true, text } satisfies RunResponse))
      .catch((error: unknown) => {
        const code = error instanceof DriverError ? error.code : 'unknown';
        sendResponse({
          ok: false,
          code,
          message: error instanceof Error ? error.message : 'The adapter failed.',
        } satisfies RunResponse);
      });

    return true; // keep the message channel open for the async response
  });
}
