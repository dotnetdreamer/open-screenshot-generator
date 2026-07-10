import type {
  AdapterMessage,
  ErrorCode,
  PageMessage,
  RunResponse,
  WebProviderId,
} from './protocol';
import { WEB_ADAPTERS, WEB_PROVIDER_IDS } from '../../src/lib/ai/webAdapters';

/**
 * Routes one generate request: find (or open) the assistant's tab in the
 * background, inject its adapter, hand over the prompt and images, and relay
 * progress and the final answer back to the Artboard Studio tab.
 *
 * The assistant tab is opened inactive so the studio stays on top.
 */

interface SiteRoute {
  url: string;
  match: string[];
  script: string;
}

// Derived from the shared registry so the provider set stays in one place.
const SITES = Object.fromEntries(
  WEB_PROVIDER_IDS.map((id) => {
    const adapter = WEB_ADAPTERS[id];
    return [
      id,
      {
        url: adapter.url,
        match: adapter.hosts.map((host) => `https://${host}/*`),
        script: `dist/adapters/${id}.js`,
      },
    ];
  })
) as Record<WebProviderId, SiteRoute>;

/** requestId -> the studio tab waiting on it, so progress can be routed back. */
const pending = new Map<string, { pageTabId: number; siteTabId?: number }>();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Progress hops from the adapter back to whichever studio tab asked.
  if (isAdapterMessage(message)) {
    const entry = pending.get(message.requestId);
    if (entry && message.type === 'abs-progress') {
      void chrome.tabs.sendMessage(entry.pageTabId, {
        type: 'abs-forward',
        requestId: message.requestId,
        stage: message.stage,
      });
    }
    return;
  }

  if (!isPageMessage(message)) return;
  const pageTabId = sender.tab?.id;
  if (pageTabId === undefined) return;

  if (message.type === 'ping') {
    sendResponse({ ok: true, version: chrome.runtime.getManifest().version });
    return;
  }

  if (message.type === 'cancel') {
    const entry = pending.get(message.requestId);
    if (entry?.siteTabId !== undefined) {
      void chrome.tabs.sendMessage(entry.siteTabId, {
        type: 'abs-cancel',
        requestId: message.requestId,
      });
    }
    pending.delete(message.requestId);
    return;
  }

  if (message.type === 'generate') {
    pending.set(message.requestId, { pageTabId });
    void handleGenerate(message, pageTabId)
      .then((text) => sendResponse({ ok: true, text } satisfies RunResponse))
      .catch((error: unknown) => {
        const { code, msg } = normalize(error);
        sendResponse({ ok: false, code, message: msg } satisfies RunResponse);
      })
      .finally(() => pending.delete(message.requestId));
    return true; // async response
  }
});

async function handleGenerate(
  message: Extract<PageMessage, { type: 'generate' }>,
  pageTabId: number
): Promise<string> {
  const site = SITES[message.payload.provider];
  if (!site) throw new Error(`Unknown provider ${message.payload.provider}`);

  forward(pageTabId, message.requestId, 'opening');

  const tabId = await openSiteTab(site);
  const entry = pending.get(message.requestId);
  if (entry) entry.siteTabId = tabId;

  await chrome.scripting.executeScript({ target: { tabId }, files: [site.script] });

  const response = await chrome.tabs.sendMessage<unknown, RunResponse>(tabId, {
    type: 'abs-run',
    requestId: message.requestId,
    prompt: message.payload.prompt,
    images: message.payload.images,
  });

  if (!response?.ok) {
    const failure = response ?? { code: 'unknown' as ErrorCode, message: 'No response.' };
    const error = new Error(failure.message);
    (error as Error & { code?: ErrorCode }).code = failure.code;
    throw error;
  }
  return response.text;
}

/** Reuses an already open tab for that site; otherwise opens one in the background. */
async function openSiteTab(site: SiteRoute): Promise<number> {
  const existing = await chrome.tabs.query({ url: site.match });
  const tab = existing[0] ?? (await chrome.tabs.create({ url: site.url, active: false }));
  if (tab.id === undefined) throw new Error('Could not open the assistant tab.');
  await waitForLoad(tab.id);
  return tab.id;
}

function waitForLoad(tabId: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error('The assistant tab took too long to load.'));
    }, 30_000);

    function finish() {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      // Single-page apps finish loading well after `complete`.
      setTimeout(resolve, 1200);
    }

    function listener(updatedTabId: number, changeInfo: { status?: string }) {
      if (updatedTabId === tabId && changeInfo.status === 'complete') finish();
    }

    chrome.tabs.onUpdated.addListener(listener);
    void chrome.tabs.get(tabId).then((tab) => {
      if (tab.status === 'complete') finish();
    });
  });
}

function forward(pageTabId: number, requestId: string, stage: string) {
  void chrome.tabs.sendMessage(pageTabId, { type: 'abs-forward', requestId, stage });
}

function normalize(error: unknown): { code: ErrorCode; msg: string } {
  const code = (error as { code?: ErrorCode })?.code;
  const msg = error instanceof Error ? error.message : 'The extension could not complete the request.';
  return { code: code ?? 'unknown', msg };
}

function isPageMessage(value: unknown): value is PageMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { source?: unknown }).source === 'artboard-studio'
  );
}

function isAdapterMessage(value: unknown): value is AdapterMessage {
  const type = (value as { type?: unknown })?.type;
  return type === 'abs-progress' || type === 'abs-result' || type === 'abs-error';
}
