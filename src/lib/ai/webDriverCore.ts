/**
 * The site-agnostic half of "drive a chat window", with no transport baked in.
 *
 * All the assistants are the same machine: a composer to type into, a hidden
 * file input to attach to, a send button, a streaming indicator, and a list of
 * assistant turns. This module runs that machine given a WebAdapter's selectors.
 * It knows nothing about how it was loaded: the companion extension wraps it
 * with chrome.runtime messaging, the desktop app wraps it with Tauri events.
 *
 * Ported from the original extension driver so the two share exactly one copy
 * of the fragile DOM logic.
 */

import type { WebAdapter } from './webAdapters';

export type Stage = 'attaching' | 'sending' | 'waiting' | 'reading';

export type DriverErrorCode =
  | 'not-logged-in'
  | 'timeout'
  | 'site-changed'
  | 'cancelled'
  | 'unknown';

export class DriverError extends Error {
  code: DriverErrorCode;
  constructor(code: DriverErrorCode, message: string) {
    super(message);
    this.name = 'DriverError';
    this.code = code;
  }
}

export interface DriverImage {
  fileName: string;
  dataUrl: string;
}

export interface DriverCommand {
  prompt: string;
  images: DriverImage[];
}

export interface DriverHooks {
  progress: (stage: Stage) => void;
  isCancelled: () => boolean;
}

const SETTLE_MS = 1200; // reply text unchanged this long means the stream ended
const REPLY_TIMEOUT_MS = 4 * 60_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pick<T extends Element = HTMLElement>(selectors: string[]): T | null {
  for (const selector of selectors) {
    try {
      const found = document.querySelector<T>(selector);
      if (found) return found;
    } catch {
      // A selector a browser rejects (e.g. :has on an old engine) just skips.
    }
  }
  return null;
}

/**
 * Like pick, but only accepts an element the user could actually see. Used for
 * the logged-out markers: sites keep hidden sign-in affordances in the DOM
 * while signed in (menus, dialogs, server-rendered shells), and treating one
 * of those as "signed out" locks a logged-in user out of the run. A marker
 * that is not visible is not a sign-out.
 */
function pickVisible(selectors: string[]): HTMLElement | null {
  for (const selector of selectors) {
    try {
      for (const el of Array.from(document.querySelectorAll<HTMLElement>(selector))) {
        if (el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden') {
          return el;
        }
      }
    } catch {
      // A selector a browser rejects (e.g. :has on an old engine) just skips.
    }
  }
  return null;
}

function pickAll(selectors: string[]): Element[] {
  for (const selector of selectors) {
    try {
      const found = document.querySelectorAll(selector);
      if (found.length > 0) return Array.from(found);
    } catch {
      // ignore an unsupported selector and try the next
    }
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
  throw new DriverError('site-changed', message);
}

function dataUrlToFile(image: DriverImage): File {
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
async function attachFiles(config: WebAdapter, images: DriverImage[]): Promise<void> {
  if (images.length === 0 || config.fileInput.length === 0) return;

  if (config.attachMenu) {
    pick<HTMLElement>(config.attachMenu)?.click();
    await sleep(400);
  }

  // Attachment is best-effort: a site that has no reachable file input on the
  // free tier should still get the text prompt rather than failing the run.
  let input: HTMLInputElement | null = null;
  try {
    input = await waitFor<HTMLInputElement>(config.fileInput, 5000, 'no file input');
  } catch {
    return;
  }

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

async function clickSend(config: WebAdapter, composer: HTMLElement): Promise<void> {
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

function lastAssistantText(config: WebAdapter): string {
  const turns = pickAll(config.assistantMessage);
  const last = turns[turns.length - 1];
  if (!last) return '';
  // Prefer a code block: that is where the plan JSON lives, and innerText on the
  // whole turn can mangle it with copy-button labels. Take each <pre>'s inner
  // <code>, whose innerText is just the code, without the language label and
  // Copy/Edit buttons that live in the <pre> chrome (ChatGPT renders both).
  // Selecting "pre code, pre" together matched the <pre> AND its nested <code>
  // as two separate elements, emitting the JSON twice; the duplicate then broke
  // the "first { .. last }" extractor by joining two objects into one string.
  const pres = Array.from(last.querySelectorAll('pre'));
  if (pres.length > 0) {
    return pres
      .map((pre) => ((pre.querySelector('code') ?? pre) as HTMLElement).innerText)
      .join('\n');
  }
  return (last as HTMLElement).innerText ?? '';
}

/**
 * Waits for the answer. A "stop generating" control is the reliable start
 * signal; once it disappears (or never appeared, on a fast reply) we fall back
 * to waiting for the text to stop changing.
 */
async function waitForReply(
  config: WebAdapter,
  before: number,
  isCancelled: () => boolean
): Promise<string> {
  const deadline = Date.now() + REPLY_TIMEOUT_MS;
  let lastText = '';
  let stableSince = 0;

  while (Date.now() < deadline) {
    // This is where a run spends minutes; without a checkpoint here a cancel
    // would only take effect after the reply finished streaming.
    if (isCancelled()) throw new DriverError('cancelled', 'Cancelled.');
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
  throw new DriverError('timeout', 'The assistant did not answer in time.');
}

/**
 * Whether the user is signed in on this page right now, as three states:
 *   - 'out'     the site's logged-out marker is present (definitely signed out)
 *   - 'in'      the composer is present (the user can type: signed in)
 *   - 'unknown' neither settled within the budget, most likely a slow SPA boot
 *
 * The logged-out marker is checked first on purpose: some sites (claude.ai's
 * /logout decoy) render a composer AND a sign-in link while signed out.
 */
export type LoginState = 'in' | 'out' | 'unknown';

/**
 * Tri-state login probe. Waits a bounded time for a definite signal, then gives
 * up as 'unknown' rather than guessing.
 *
 * Distinguishing 'out' from 'unknown' is the whole point: a hidden background
 * run must reveal its window on a real sign-out, but stay hidden through a
 * slow-but-signed-in boot. Collapsing the two into a boolean is what made a
 * background run flash its window open then closed on a cold start.
 */
export async function detectLoginState(config: WebAdapter, timeoutMs = 8000): Promise<LoginState> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    // An authoritative in-page auth signal (ChatGPT's bootstrap JSON) wins
    // over any DOM heuristics: it does not race the render order.
    const probed = config.probeAuth?.() ?? null;
    if (probed) return probed;
    if (config.loggedOut && pickVisible(config.loggedOut)) return 'out';
    if (pick(config.composer)) {
      // A composer alone is not proof of a signed-in session: several providers
      // (ChatGPT most notably) show one in an anonymous, logged-out state, and
      // their sign-in controls render a beat AFTER the composer. Committing to
      // 'in' on the first tick a composer appears therefore mistakes an
      // anonymous page for a signed-in one and types the prompt into a throwaway
      // chat. Give the logged-out markers a short grace to catch up before
      // trusting the composer; a genuinely signed-in page never grows one, so
      // this only adds a small settle to the signed-in path.
      if (config.loggedOut) {
        const settleBy = Date.now() + 1500;
        while (Date.now() < settleBy) {
          const late = config.probeAuth?.() ?? null;
          if (late) return late;
          if (pickVisible(config.loggedOut)) return 'out';
          await sleep(150);
        }
      }
      return 'in';
    }
    if (Date.now() >= deadline) return 'unknown';
    await sleep(200);
  }
}

/** Type the prompt, attach the images, wait for the reply, return its text. */
export async function runSession(
  config: WebAdapter,
  command: DriverCommand,
  hooks: DriverHooks
): Promise<string> {
  const bail = () => {
    if (hooks.isCancelled()) throw new DriverError('cancelled', 'Cancelled.');
  };

  // Full tri-state probe, not a one-shot marker check: runSession is also
  // entered straight from a dispatch (the desktop shell evals into an existing
  // window; the extension calls it directly), and on an anonymous-capable site
  // whose sign-in controls render after the composer, an instantaneous check
  // here is the race that typed prompts into a throwaway anonymous chat.
  if ((await detectLoginState(config, 8000)) === 'out') {
    throw new DriverError('not-logged-in', 'Sign in on this site first.');
  }
  bail();

  hooks.progress('attaching');
  let composer: HTMLElement;
  try {
    composer = await waitFor<HTMLElement>(
      config.composer,
      20_000,
      'Could not find the message box. You may not be signed in.'
    );
  } catch (err) {
    // No composer, but sign-in markers on screen: the page turned into a login
    // wall while we waited (session expired mid-run, SPA redirect). Report the
    // real cause so the shell reveals the window and keeps the job queued for
    // after the sign-in, instead of failing as a hidden "site changed".
    if (config.loggedOut && pickVisible(config.loggedOut)) {
      throw new DriverError('not-logged-in', 'Sign in on this site first.');
    }
    throw err;
  }
  bail();

  await attachFiles(config, command.images);
  bail();

  hooks.progress('sending');
  typeInto(composer, command.prompt);
  await sleep(400);
  bail();

  const before = pickAll(config.assistantMessage).length;
  await clickSend(config, composer);
  bail();

  hooks.progress('waiting');
  const text = await waitForReply(config, before, hooks.isCancelled);
  bail();

  hooks.progress('reading');
  return text;
}
