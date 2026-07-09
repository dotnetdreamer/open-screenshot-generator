import type { BridgeImage, ErrorCode, RunCommand, RunResponse, Stage } from '../protocol';

/**
 * The site-agnostic half of "drive a chat window".
 *
 * All three assistants are the same machine: a composer to type into, a hidden
 * file input to attach to, a send button, a streaming indicator, and a list of
 * assistant turns. Each adapter supplies selectors; everything below is shared.
 *
 * Selectors are the one part guaranteed to rot. Each field takes a list, tried
 * in order, so a redesign usually only needs a new entry rather than new logic.
 */

export interface SiteConfig {
  id: string;
  /** Composer element: a textarea or a contenteditable. */
  composer: string[];
  /** Hidden <input type="file">. */
  fileInput: string[];
  /** Optional: clicked before looking for the file input (attachment menus). */
  attachMenu?: string[];
  /** Send button. */
  send: string[];
  /** Visible only while the assistant is generating. */
  streaming: string[];
  /** Every assistant turn; the last one is the answer. */
  assistantMessage: string[];
  /** Shown when signed out. Presence means "not logged in". */
  loggedOut?: string[];
}

export class AdapterError extends Error {
  code: ErrorCode;
  constructor(code: ErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

const SETTLE_MS = 1200; // reply text unchanged this long means the stream ended
const REPLY_TIMEOUT_MS = 4 * 60_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pick<T extends Element = HTMLElement>(selectors: string[]): T | null {
  for (const selector of selectors) {
    const found = document.querySelector<T>(selector);
    if (found) return found;
  }
  return null;
}

function pickAll(selectors: string[]): Element[] {
  for (const selector of selectors) {
    const found = document.querySelectorAll(selector);
    if (found.length > 0) return Array.from(found);
  }
  return [];
}

async function waitFor<T extends Element = HTMLElement>(
  selectors: string[],
  timeoutMs: number,
  message: string
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const found = pick<T>(selectors);
    if (found) return found;
    await sleep(150);
  }
  throw new AdapterError('site-changed', message);
}

function dataUrlToFile(image: BridgeImage): File {
  const [header, body] = image.dataUrl.split(',', 2);
  const mime = /:(.*?);/.exec(header)?.[1] ?? 'image/jpeg';
  const bytes = atob(body);
  const buffer = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) buffer[i] = bytes.charCodeAt(i);
  return new File([buffer], image.fileName || `screenshot.${mime.split('/')[1]}`, { type: mime });
}

/**
 * React and friends listen for a real `change` from the input, and they read
 * `input.files`, which is read-only except through a DataTransfer.
 */
async function attachFiles(config: SiteConfig, images: BridgeImage[]): Promise<void> {
  if (images.length === 0) return;

  if (config.attachMenu) {
    pick<HTMLElement>(config.attachMenu)?.click();
    await sleep(400);
  }

  const input = await waitFor<HTMLInputElement>(
    config.fileInput,
    5000,
    'Could not find the file attachment control.'
  );

  const transfer = new DataTransfer();
  for (const image of images) transfer.items.add(dataUrlToFile(image));
  input.files = transfer.files;
  input.dispatchEvent(new Event('change', { bubbles: true }));

  // Uploads are async and the send button stays disabled while they run.
  await sleep(1500 + images.length * 600);
}

/**
 * `execCommand('insertText')` is deprecated but it is still the only way to put
 * text into a rich editor (ProseMirror, Quill, Lexical) such that the editor's
 * own input handling runs. A synthetic paste is the fallback.
 */
function typeInto(element: HTMLElement, text: string): void {
  element.focus();
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLInputElement) {
    const setter = Object.getOwnPropertyDescriptor(
      element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype,
      'value'
    )?.set;
    setter?.call(element, text);
    element.dispatchEvent(new Event('input', { bubbles: true }));
    return;
  }

  const inserted = document.execCommand('insertText', false, text);
  if (inserted && element.textContent?.includes(text.slice(0, 40))) return;

  const transfer = new DataTransfer();
  transfer.setData('text/plain', text);
  element.dispatchEvent(
    new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true })
  );
}

async function clickSend(config: SiteConfig, composer: HTMLElement): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const button = pick<HTMLButtonElement>(config.send);
    if (button && !button.disabled && button.getAttribute('aria-disabled') !== 'true') {
      button.click();
      return;
    }
    await sleep(200);
  }
  // Some builds hide the button until the composer is focused; Enter still works.
  composer.focus();
  composer.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true })
  );
}

function lastAssistantText(config: SiteConfig): string {
  const turns = pickAll(config.assistantMessage);
  const last = turns[turns.length - 1];
  if (!last) return '';
  // Prefer a code block: that is where the plan JSON lives, and innerText on the
  // whole turn can mangle it with copy-button labels.
  const blocks = last.querySelectorAll('pre code, pre');
  if (blocks.length > 0) {
    return Array.from(blocks)
      .map((block) => (block as HTMLElement).innerText)
      .join('\n');
  }
  return (last as HTMLElement).innerText ?? '';
}

/**
 * Waits for the answer. A "stop generating" control is the reliable start
 * signal; once it disappears (or never appeared, on a fast reply) we fall back
 * to waiting for the text to stop changing.
 */
async function waitForReply(config: SiteConfig, before: number): Promise<string> {
  const deadline = Date.now() + REPLY_TIMEOUT_MS;
  let lastText = '';
  let stableSince = 0;

  while (Date.now() < deadline) {
    const streaming = pick(config.streaming) !== null;
    const turns = pickAll(config.assistantMessage);
    const grew = turns.length > before;
    const text = grew ? lastAssistantText(config) : '';

    if (!streaming && grew && text.length > 0) {
      if (text === lastText) {
        if (stableSince && Date.now() - stableSince >= SETTLE_MS) return text;
        if (!stableSince) stableSince = Date.now();
      } else {
        lastText = text;
        stableSince = Date.now();
      }
    } else {
      stableSince = 0;
      lastText = text;
    }

    await sleep(300);
  }

  if (lastText) return lastText; // Timed out mid-stream; return what we have.
  throw new AdapterError('timeout', 'The assistant did not answer in time.');
}

export function registerAdapter(config: SiteConfig): void {
  // executeScript can inject the same file twice into one tab.
  const flag = `__artboardStudioAdapter_${config.id}`;
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

    void run(config, command, progress, () => cancelled)
      .then((text) => sendResponse({ ok: true, text } satisfies RunResponse))
      .catch((error: unknown) => {
        const adapterError =
          error instanceof AdapterError
            ? error
            : new AdapterError(
                'unknown',
                error instanceof Error ? error.message : 'The adapter failed.'
              );
        sendResponse({
          ok: false,
          code: adapterError.code,
          message: adapterError.message,
        } satisfies RunResponse);
      });

    return true; // keep the message channel open for the async response
  });
}

async function run(
  config: SiteConfig,
  command: RunCommand,
  progress: (stage: Stage) => void,
  isCancelled: () => boolean
): Promise<string> {
  const bail = () => {
    if (isCancelled()) throw new AdapterError('cancelled', 'Cancelled.');
  };

  if (config.loggedOut && pick(config.loggedOut)) {
    throw new AdapterError('not-logged-in', 'Sign in on this site first.');
  }

  progress('attaching');
  const composer = await waitFor<HTMLElement>(
    config.composer,
    20_000,
    'Could not find the message box. You may not be signed in.'
  );
  bail();

  await attachFiles(config, command.images);
  bail();

  progress('sending');
  typeInto(composer, command.prompt);
  await sleep(400);
  bail();

  const before = pickAll(config.assistantMessage).length;
  await clickSend(config, composer);
  bail();

  progress('waiting');
  const text = await waitForReply(config, before);
  bail();

  progress('reading');
  return text;
}
