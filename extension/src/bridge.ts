import { EXT_SOURCE, PAGE_SOURCE, type ExtMessage, type PageMessage, type RunResponse } from './protocol';

/**
 * Runs inside the Open Screenshot Generator page. Relays window.postMessage traffic to
 * the background worker and back, which is what lets the app detect the
 * extension without knowing its id (unpacked installs get a random one).
 *
 * Only `{prompt, images} -> replyText` crosses this boundary. The page never
 * sees a cookie, a token, or anything else from the assistant's origin.
 */

const VERSION = chrome.runtime.getManifest().version;

function reply(message: ExtMessage) {
  window.postMessage(message, window.location.origin);
}

window.addEventListener('message', (event: MessageEvent) => {
  if (event.source !== window) return;
  const message = event.data as PageMessage | undefined;
  if (!message || message.source !== PAGE_SOURCE) return;

  if (message.type === 'ping') {
    reply({ source: EXT_SOURCE, type: 'pong', requestId: message.requestId, version: VERSION });
    return;
  }

  if (message.type === 'cancel') {
    void chrome.runtime.sendMessage(message);
    return;
  }

  if (message.type === 'generate') {
    void chrome.runtime
      .sendMessage<PageMessage, RunResponse>(message)
      .then((response) => {
        if (response?.ok) {
          reply({ source: EXT_SOURCE, type: 'result', requestId: message.requestId, text: response.text });
        } else {
          reply({
            source: EXT_SOURCE,
            type: 'error',
            requestId: message.requestId,
            code: response?.code ?? 'unknown',
            message: response?.message ?? 'The extension could not complete the request.',
          });
        }
      })
      .catch((error: unknown) => {
        reply({
          source: EXT_SOURCE,
          type: 'error',
          requestId: message.requestId,
          code: 'unknown',
          message: error instanceof Error ? error.message : 'The extension stopped responding.',
        });
      });
  }
});

// Progress pushed by the background worker while a request is in flight.
chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== 'abs-forward') return;
  reply({
    source: EXT_SOURCE,
    type: 'progress',
    requestId: message.requestId,
    stage: message.stage,
  });
});
