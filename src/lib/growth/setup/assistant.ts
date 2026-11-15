// The Ask AI assistant: one conversation per editor window, kept here rather
// than in the screen, so it carries on while the user looks at another
// section (each section mounts a fresh screen) and is still there when they
// come back.
//
// A turn goes like this. The page reads the browser (driver.ts), builds one
// prompt with the setup status, what happened since the last answer, the page
// and the conversation (prompt.ts), and sends it to whichever AI writes for
// Growth. The answer names actions. The page runs them one by one under the
// rules in policy.ts: a click or a choice that changes the account waits for
// the user's yes, one that removes something is refused, a value is saved
// only if it was really on a page. When the answer asks to carry on, the next
// prompt shows the result, up to MAX_STEPS prompts before the user has to do
// something: write, answer a question, add a key file or say they're done.
//
// Key files never reach a model. The browser's downloads (growth_browser.rs),
// a file the user picks and a key pasted into the chat all land in
// `addKeyFile`, which saves the key itself when it has everything it needs
// and otherwise tells the model only the file's name.

import { useSyncExternalStore } from 'react';
import { parseServiceAccount } from '@/lib/publish/googlePlay';
import type { AppStoreCredentials, PlayCredentials } from '@/lib/publish/types';
import type { GrowthStore } from '../stores';
import { growthBrowser, onKeyFile, type BrowserPort, type CaughtKeyFile } from './browser';
import {
  isBareAnswer,
  issuerIdOnPage,
  judgeClick,
  judgePick,
  judgeTyping,
  keyIdFromFileName,
  keyInText,
  mayOpen,
  seenIn,
  valid,
  type ClickVerdict,
} from './policy';
import { readReply, systemPrompt, turnPrompt, type AssistantAction } from './prompt';
import type { ControlDescription, Expected, PageSnapshot } from './protocol';
import { redactSecrets } from './secrets';

/**
 * The most prompts between two things the user does. A refresh that ends or
 * a key file the browser catches wakes the assistant too, and those count
 * against the same allowance, so no chain of them runs on by itself.
 */
export const MAX_STEPS = 24;

export type StepKind = 'open' | 'click' | 'type' | 'pick' | 'scroll' | 'point' | 'read';

export type ChatItem =
  | { id: string; kind: 'user'; text: string }
  | { id: string; kind: 'assistant'; text: string; choices: string[] }
  | { id: string; kind: 'step'; step: StepKind; text: string; state: 'running' | 'done' | 'failed'; detail?: string }
  | {
      id: string;
      kind: 'approval';
      /** The control's name, or the option to choose. */
      action: string;
      /** Press a control, or choose an option in a list. */
      verb: 'press' | 'choose';
      /** The list the option is in, or the dialog the control is in. */
      where: string | null;
      site: string;
      state: 'asking' | 'allowed' | 'declined';
    }
  | { id: string; kind: 'waiting'; text: string; state: 'waiting' | 'done' }
  | { id: string; kind: 'saved'; title: string; detail: string }
  | { id: string; kind: 'key-file'; fileName: string; detail: string }
  | { id: string; kind: 'key-request'; fileKind: 'apple' | 'play'; state: 'asking' | 'done' }
  | { id: string; kind: 'refresh'; state: 'running' | 'done' | 'failed'; lines: string[] }
  | { id: string; kind: 'notice'; tone: 'info' | 'error'; text: string };

export type AssistantPhase = 'idle' | 'reading' | 'thinking' | 'acting' | 'approval' | 'waiting';

export interface RefreshResult {
  appName: string;
  /** One line per part, such as "Reviews and replies: up to date". */
  lines: string[];
}

/** What the setup looks like now, for the model and for the saves the app makes itself. */
export interface SetupFacts {
  appleKey: { keyId: string; issuerId: string } | null;
  appleApps: { names: string[]; error: string | null; loading: boolean };
  vendorNumber: string | null;
  playKey: { email: string | null; packageName: string } | null;
  reportsUri: string | null;
  /** The stores the developer said their app is on, null until asked. */
  stores: GrowthStore[] | null;
  /** How each part of the app on screen did in its last refresh. */
  lastRefresh: RefreshResult | null;
  refreshing: boolean;
}

/** What the assistant needs from Growth, handed over by the screen on every render. */
export interface AssistantEnv {
  /** Why the assistant cannot answer now, null when it can. */
  reason: string | null;
  facts(): SetupFacts;
  /** The numbers of the app on screen, when it has any. */
  numbers(): { digest: unknown; appName: string } | null;
  ask(system: string, user: string, signal: AbortSignal): Promise<string>;
  saveAppleKey(value: AppStoreCredentials): void;
  saveVendorNumber(value: string): void;
  savePlayKey(value: PlayCredentials): void;
  /** Point the saved Google Play key at another app. */
  setPlayPackage(packageName: string): void;
  saveReportsUri(value: string): void;
  setStores(stores: GrowthStore[]): void;
  /** Refresh the app on screen and resolve when it ends. */
  refresh(): Promise<RefreshResult>;
}

export interface AssistantSnapshot {
  items: ChatItem[];
  phase: AssistantPhase;
  running: boolean;
}

// --- the store -------------------------------------------------------------------------

let snapshot: AssistantSnapshot = { items: [], phase: 'idle', running: false };
const listeners = new Set<() => void>();
let env: AssistantEnv | null = null;
let serial = 0;

const transcript: Array<{ role: 'user' | 'assistant'; text: string }> = [];
let events: string[] = [];
/** Pages, copies, messages and file names: where a value has to appear to be saved. */
let seen: string[] = [];
let lastPage: PageSnapshot | null = null;
const keyFiles: { apple: CaughtKeyFile[]; play: CaughtKeyFile[] } = { apple: [], play: [] };
let controller: AbortController | null = null;
let approval: { id: string; resolve: (allowed: boolean) => void } | null = null;
let waiting: { id: string; resolve: (what: string) => void; fileKind?: 'apple' | 'play' } | null = null;
let wakeAfter = false;
/** The user wrote while a turn was under way, so the loop owes an answer. */
let unanswered = false;
/** New chat was pressed during a turn: the conversation empties once the turn has stopped. */
let resetAfter = false;
/** Prompts left before the user has to do something (MAX_STEPS). */
let budget = MAX_STEPS;

/** The user did something: the assistant may take MAX_STEPS more prompts. */
function userActed(): void {
  budget = MAX_STEPS;
}

function publish(patch: Partial<AssistantSnapshot>): void {
  snapshot = { ...snapshot, ...patch };
  listeners.forEach((listener) => listener());
}

function nextId(): string {
  serial += 1;
  return `a${serial}`;
}

/** A chat item before it has an id: Omit spread over each kind of item. */
type NewItem = ChatItem extends infer Item ? (Item extends ChatItem ? Omit<Item, 'id'> : never) : never;

function add(item: NewItem): string {
  const id = nextId();
  publish({ items: [...snapshot.items, { ...item, id } as ChatItem] });
  return id;
}

function change(id: string, patch: Partial<ChatItem>): void {
  publish({ items: snapshot.items.map((item) => (item.id === id ? ({ ...item, ...patch } as ChatItem) : item)) });
}

function remember(text: string): void {
  if (!text) return;
  seen = [...seen.slice(-11), text];
}

export function subscribeAssistant(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function assistantSnapshot(): AssistantSnapshot {
  return snapshot;
}

const SERVER_SNAPSHOT: AssistantSnapshot = { items: [], phase: 'idle', running: false };

export function useAssistant(): AssistantSnapshot {
  return useSyncExternalStore(subscribeAssistant, assistantSnapshot, () => SERVER_SNAPSHOT);
}

/** Whether the assistant waits for the user, without a render for every message. */
export function useAssistantNeedsYou(): boolean {
  return useSyncExternalStore(
    subscribeAssistant,
    () => snapshot.phase === 'approval' || snapshot.phase === 'waiting',
    () => false
  );
}

let hearingKeyFiles = false;

/** The Growth browser, or a stand-in a test hands over. */
let browser: BrowserPort = growthBrowser;

export function setAssistantBrowser(port: BrowserPort): void {
  browser = port;
}

/** Growth hands over what it knows and can do, on every render. */
export function configureAssistant(next: AssistantEnv): void {
  env = next;
  if (!hearingKeyFiles) {
    hearingKeyFiles = true;
    onKeyFile(addKeyFile);
  }
}

function stopped(): DOMException {
  return new DOMException('Stopped', 'AbortError');
}

function isAbort(error: unknown): boolean {
  return (error as { name?: string })?.name === 'AbortError';
}

// --- the status the model reads ---------------------------------------------------------

const STORE_NAMES: Record<GrowthStore, string> = { appstore: 'App Store', playstore: 'Google Play' };

export function statusText(facts: SetupFacts, files: typeof keyFiles = keyFiles): string {
  const lines: string[] = [];
  lines.push(
    facts.stores
      ? `The app is on: ${facts.stores.map((store) => STORE_NAMES[store]).join(' and ')}.`
      : 'Which stores the app is on: not asked yet.'
  );
  if (facts.appleKey) {
    const apps = facts.appleApps.loading
      ? 'Its apps are loading.'
      : facts.appleApps.error
        ? `Apple refused the key: ${facts.appleApps.error}.`
        : facts.appleApps.names.length
          ? `Apps it can see: ${facts.appleApps.names.join(', ')}.`
          : 'It sees no apps yet.';
    lines.push(`App Store Connect API key: saved (Key ID ${facts.appleKey.keyId}, Issuer ID ${facts.appleKey.issuerId}). ${apps}`);
  } else {
    lines.push('App Store Connect API key: not saved.');
  }
  lines.push(facts.vendorNumber ? `Vendor number: saved (${facts.vendorNumber}).` : 'Vendor number: not saved.');
  lines.push(
    facts.playKey
      ? `Google Play service account key: saved for the app ${facts.playKey.packageName}${facts.playKey.email ? `, as ${facts.playKey.email}` : ''}.`
      : 'Google Play service account key: not saved.'
  );
  lines.push(facts.reportsUri ? `Google Play report files: saved (${facts.reportsUri}).` : 'Google Play report files: not saved.');
  if (facts.refreshing) lines.push('A refresh is running now.');
  if (facts.lastRefresh) lines.push(`Last refresh of ${facts.lastRefresh.appName}: ${facts.lastRefresh.lines.join('; ')}.`);
  const waitingFiles = [
    ...files.apple.map((file) => {
      const keyId = keyIdFromFileName(file.fileName);
      return `${file.fileName}${keyId ? ` (Key ID ${keyId})` : ''}, not saved yet`;
    }),
    ...files.play.map((file) => `${file.fileName} (a service account key), not saved yet`),
  ];
  if (waitingFiles.length) lines.push(`Key files the app holds: ${waitingFiles.join('; ')}.`);
  return lines.join('\n');
}

// --- key files ----------------------------------------------------------------------

function playEmail(content: string): string | null {
  try {
    return parseServiceAccount(content).client_email;
  } catch {
    return null;
  }
}

function saveApple(keyId: string, issuerId: string): boolean {
  const file = keyFiles.apple.find((entry) => keyIdFromFileName(entry.fileName) === keyId) ?? (keyFiles.apple.length === 1 ? keyFiles.apple[0] : null);
  if (!file || !env) return false;
  env.saveAppleKey({ issuerId, keyId, privateKey: file.content });
  keyFiles.apple = keyFiles.apple.filter((entry) => entry !== file);
  add({ kind: 'saved', title: 'App Store Connect API key saved', detail: `Key ID ${keyId}. The key file stays on this computer` });
  return true;
}

function savePlay(packageName: string): boolean {
  const file = keyFiles.play[keyFiles.play.length - 1];
  if (!file || !env) return false;
  env.savePlayKey({ serviceAccountJson: file.content, packageName });
  keyFiles.play = [];
  const email = playEmail(file.content);
  add({
    kind: 'saved',
    title: 'Google Play key saved',
    detail: `${email ? `${packageName}, as ${email}` : packageName}. The key file stays on this computer`,
  });
  return true;
}

/**
 * A key file from the browser, from the user's own disk (`from` "user"), or
 * pasted into the chat. Saved at once when the app has everything else it
 * needs.
 */
export function addKeyFile(file: CaughtKeyFile, from: 'browser' | 'user' = 'browser'): void {
  if (from === 'user') userActed();
  if (file.kind === 'apple-key') {
    if (!/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(file.content)) {
      add({ kind: 'notice', tone: 'error', text: `${file.fileName} has no private key in it` });
      return;
    }
    keyFiles.apple = [...keyFiles.apple.filter((entry) => entry.fileName !== file.fileName), file].slice(-3);
    const keyId = keyIdFromFileName(file.fileName);
    remember(file.fileName);
    // The Key ID on its own, so it counts as read (seenIn wants it whole).
    if (keyId) remember(`Key ID ${keyId}`);
    const issuerId = issuerIdOnPage(lastPage?.text ?? '') ?? env?.facts().appleKey?.issuerId ?? null;
    if (keyId && issuerId && saveApple(keyId, issuerId)) {
      events.push(`The app saved the App Store Connect API key from ${file.fileName}, with Issuer ID ${issuerId}.`);
    } else {
      add({ kind: 'key-file', fileName: file.fileName, detail: keyId ? `Key ID ${keyId}` : 'App Store Connect key' });
      events.push(
        `The key file ${file.fileName} arrived${keyId ? ` (Key ID ${keyId})` : ''}. Save it with save_apple_key once you have the Issuer ID${keyId ? '' : ' and the Key ID'}.`
      );
    }
  } else {
    const email = playEmail(file.content);
    if (!email) {
      add({ kind: 'notice', tone: 'error', text: `${file.fileName} is not a service account key` });
      return;
    }
    keyFiles.play = [file];
    remember(email);
    const packageName = env?.facts().playKey?.packageName ?? null;
    if (packageName && savePlay(packageName)) {
      events.push(`The app saved the service account key ${email} for ${packageName}.`);
    } else {
      add({ kind: 'key-file', fileName: file.fileName, detail: email });
      events.push(`A service account key file arrived for ${email}. Save it with save_play_key and the app's package name.`);
    }
  }
  wake('added a key file', file.kind === 'apple-key' ? 'apple' : 'play');
}

// --- waiting for the user ------------------------------------------------------------

function wake(what: string, fileKind?: 'apple' | 'play'): void {
  if (waiting && (!waiting.fileKind || !fileKind || waiting.fileKind === fileKind)) {
    const resolve = waiting.resolve;
    waiting = null;
    resolve(what);
    return;
  }
  if (snapshot.running) {
    wakeAfter = true;
    return;
  }
  // Without an AI the app still saves key files; nobody is there to answer.
  if (env && !env.reason && snapshot.items.length > 0) void run();
}

/** Wait for a sign-in, a click or a key file, until the page moves on or the user says so. */
function waitForUser(id: string, signal: AbortSignal, fileKind?: 'apple' | 'play'): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let wasLoading = browser.state().loading;
    let checking = false;
    const finish = (what: string) => {
      unsubscribe();
      signal.removeEventListener('abort', onAbort);
      if (waiting?.id === id) waiting = null;
      resolve(what);
    };
    // A page that finished loading and is no longer a sign-in page means the
    // user did what was asked, or went somewhere else. The model reads it.
    const unsubscribe = browser.subscribe(() => {
      const state = browser.state();
      const finished = wasLoading && !state.loading;
      wasLoading = state.loading;
      if (!finished || checking || fileKind) return;
      checking = true;
      void browser.settle({ signal, limitMs: 6000 })
        .then(() => browser.driver.snapshot(4000))
        .then((page) => {
          checking = false;
          if (page && !page.signIn) finish('moved on in the browser');
        })
        .catch(() => {
          checking = false;
        });
    });
    const onAbort = () => {
      unsubscribe();
      if (waiting?.id === id) waiting = null;
      reject(stopped());
    };
    signal.addEventListener('abort', onAbort, { once: true });
    waiting = { id, fileKind, resolve: finish };
  });
}

/** The user pressed Done on a waiting card. */
export function finishWaiting(id: string): void {
  if (waiting?.id !== id) return;
  userActed();
  const resolve = waiting.resolve;
  waiting = null;
  resolve('said they are done');
}

/** The user's answer to a click or a choice that changes their account. */
export function answerApproval(id: string, allowed: boolean): void {
  if (approval?.id !== id) return;
  userActed();
  const resolve = approval.resolve;
  approval = null;
  resolve(allowed);
}

function askApproval(action: string, signal: AbortSignal, verb: 'press' | 'choose', where: string | null): Promise<boolean> {
  const site = (() => {
    try {
      return new URL(browser.state().url ?? '').hostname;
    } catch {
      return '';
    }
  })();
  const id = add({ kind: 'approval', action, verb, where, site, state: 'asking' });
  publish({ phase: 'approval' });
  return new Promise<boolean>((resolve, reject) => {
    const onAbort = () => {
      if (approval?.id === id) approval = null;
      change(id, { state: 'declined' });
      reject(stopped());
    };
    signal.addEventListener('abort', onAbort, { once: true });
    approval = {
      id,
      resolve: (allowed) => {
        signal.removeEventListener('abort', onAbort);
        change(id, { state: allowed ? 'allowed' : 'declined' });
        resolve(allowed);
      },
    };
  });
}

// --- running actions -------------------------------------------------------------------

function host(address: string | null): string {
  try {
    return new URL(address ?? '').hostname;
  } catch {
    return '';
  }
}

/** Run one answer's actions. True when the model should see the result and go on. */
async function perform(actions: AssistantAction[], signal: AbortSignal): Promise<boolean> {
  let goOn = false;
  for (const action of actions) {
    if (signal.aborted) throw stopped();
    const result = await performOne(action, signal);
    if (result === 'continue') goOn = true;
    if (result === 'stop') return true;
  }
  return goOn;
}

type Outcome = 'done' | 'continue' | 'stop';

function failed(message: string): Outcome {
  events.push(message);
  return 'stop';
}

/**
 * The control as `describe` saw it, which the driver checks again as it
 * acts: everything the policy read to judge it, on the same page.
 */
function expectation(control: ControlDescription): Expected {
  return {
    name: control.name ?? '',
    role: control.role ?? '',
    href: control.href ?? null,
    dialog: control.dialog ?? null,
    doc: control.doc,
    url: control.url,
  };
}

/**
 * What the policy's verdict means for the action `what`: nothing when it may
 * go ahead, or the outcome when it is refused or the user keeps it for
 * themselves. An action that needs a yes waits for it here.
 */
async function allowed(
  verdict: ClickVerdict,
  what: string,
  signal: AbortSignal,
  verb: 'press' | 'choose',
  where: string | null
): Promise<Outcome | null> {
  if (verdict.kind === 'never') {
    add({ kind: 'notice', tone: 'info', text: verdict.reason });
    return failed(`${what}: refused. The app never does that. The developer can do it themselves if they want it.`);
  }
  if (verdict.kind === 'ask' && !(await askApproval(verdict.reason, signal, verb, where))) {
    return failed(`${what}: the developer chose to ${verb} it themselves. Point at it if that helps, then wait.`);
  }
  return null;
}

async function step(
  kind: StepKind,
  text: string,
  work: () => Promise<{ ok: boolean; error?: string } | null>
): Promise<{ ok: boolean; error?: string }> {
  publish({ phase: 'acting' });
  const id = add({ kind: 'step', step: kind, text, state: 'running' });
  try {
    const answer = await work();
    const ok = !!answer?.ok;
    const error = ok ? undefined : answer?.error ?? 'The page did not answer';
    change(id, { state: ok ? 'done' : 'failed', detail: error });
    return { ok, error };
  } catch (error) {
    change(id, { state: 'failed', detail: error instanceof Error ? error.message : 'The page did not answer' });
    throw error;
  }
}

async function performOne(action: AssistantAction, signal: AbortSignal): Promise<Outcome> {
  const current = env;
  if (!current) return 'stop';
  switch (action.do) {
    case 'open': {
      if (!mayOpen(action.url)) return failed(`open ${action.url}: not allowed. Only the App Store Connect, Google Cloud and Play Console sites open here.`);
      const done = await step('open', `Opened ${host(action.url)}`, async () => {
        if (browser.state().open) await browser.go(action.url);
        else await browser.open(action.url);
        await browser.settle({ signal });
        return { ok: true };
      });
      events.push(`open ${action.url}: ${done.ok ? `done, the browser is at ${browser.state().url ?? action.url}` : 'failed'}`);
      return 'continue';
    }
    case 'click': {
      if (!browser.state().open) return failed(`click [${action.ref}]: the browser is closed`);
      const control = await browser.driver.describe(action.ref);
      if (!control?.ok) return failed(`click [${action.ref}]: ${control?.error ?? 'that control is no longer on the page'}. Read the page again.`);
      const name = control.name || `control ${action.ref}`;
      const dialog = control.dialog || null;
      const verdict = judgeClick(name, action.changes, { dialog });
      // "OK" says nothing by itself, so the question names its dialog.
      const refusal = await allowed(verdict, `click [${action.ref}] "${name}"`, signal, 'press', dialog && isBareAnswer(name) ? dialog : null);
      if (refusal) return refusal;
      // The driver presses it only if it is still the control judged above.
      const done = await step('click', `Clicked "${name}"`, async () => {
        const answer = await browser.driver.click(action.ref, expectation(control));
        if (answer?.ok) await browser.settle({ signal });
        return answer;
      });
      events.push(`click [${action.ref}] "${name}": ${done.ok ? 'done' : `failed: ${done.error}`}`);
      return done.ok ? 'continue' : 'stop';
    }
    case 'type': {
      if (!browser.state().open) return failed(`type [${action.ref}]: the browser is closed`);
      const problem = judgeTyping(action.text);
      if (problem) return failed(`type [${action.ref}]: ${problem}`);
      if (lastPage?.signIn) return failed(`type [${action.ref}]: refused on a sign-in page. The developer signs in themselves.`);
      const control = await browser.driver.describe(action.ref);
      if (!control?.ok) return failed(`type [${action.ref}]: ${control?.error ?? 'that box is no longer on the page'}`);
      const name = control.name || 'the box';
      // The driver looks for a sign-in form again as it types: a click
      // earlier in this answer may have brought one up.
      const done = await step('type', `Typed in "${name}"`, async () => {
        const answer = await browser.driver.type(action.ref, action.text, expectation(control));
        if (answer?.ok) await browser.settle({ signal, limitMs: 3000, quietMs: 300 });
        return answer;
      });
      events.push(`type "${action.text}" in [${action.ref}] "${name}": ${done.ok ? 'done' : `failed: ${done.error}`}`);
      return done.ok ? 'continue' : 'stop';
    }
    case 'pick': {
      if (!browser.state().open) return failed(`pick in [${action.ref}]: the browser is closed`);
      const control = await browser.driver.describe(action.ref);
      if (!control?.ok) return failed(`pick in [${action.ref}]: ${control?.error ?? 'that list is no longer on the page'}. Read the page again.`);
      const name = control.name || 'the list';
      // A page can act on a choice at once, so the option is judged before
      // it is chosen, by the text the list really has.
      const preview = await browser.driver.pick(action.ref, action.option, { preview: true });
      if (!preview?.ok || !preview.picked) {
        return failed(`pick "${action.option}" in [${action.ref}] "${name}": failed: ${preview?.error ?? 'no answer'}`);
      }
      const option = preview.picked;
      const dialog = control.dialog || null;
      const verdict = judgePick(name, option, action.changes, { dialog });
      const refusal = await allowed(verdict, `pick "${option}" in [${action.ref}] "${name}"`, signal, 'choose', name);
      if (refusal) return refusal;
      const done = await step('pick', `Chose "${option}" in "${name}"`, async () => {
        // The option the user said yes to: the same text, setting the same value.
        const answer = await browser.driver.pick(action.ref, option, { exact: true, value: preview.value, expect: expectation(control) });
        if (answer?.ok) await browser.settle({ signal, limitMs: 3000, quietMs: 300 });
        return answer;
      });
      events.push(`pick "${option}" in [${action.ref}] "${name}": ${done.ok ? `chose ${option}` : `failed: ${done.error}`}`);
      return done.ok ? 'continue' : 'stop';
    }
    case 'scroll': {
      if (!browser.state().open) return failed('scroll: the browser is closed');
      const answer = await browser.driver.scroll(action.to);
      await browser.settle({ signal, limitMs: 2000, quietMs: 300 });
      events.push(`scroll ${action.to}: ${answer?.ok ? 'done' : answer?.error ?? 'failed'}`);
      return 'continue';
    }
    case 'point': {
      if (!browser.state().open) return failed('point: the browser is closed');
      const answer = await browser.driver.point(action.ref, action.note);
      events.push(`point at [${action.ref}]: ${answer?.ok ? 'shown to the developer' : answer?.error ?? 'failed'}`);
      return 'done';
    }
    case 'wait': {
      const lastSay = [...snapshot.items].reverse().find((item) => item.kind === 'assistant') as Extract<ChatItem, { kind: 'assistant' }> | undefined;
      const id = add({ kind: 'waiting', text: action.for || lastSay?.text || 'Your turn in the browser', state: 'waiting' });
      publish({ phase: 'waiting' });
      try {
        const what = await waitForUser(id, signal);
        events.push(`wait: the developer ${what}`);
      } finally {
        change(id, { state: 'done' });
      }
      return 'continue';
    }
    case 'ask_for_key_file': {
      const id = add({ kind: 'key-request', fileKind: action.kind, state: 'asking' });
      publish({ phase: 'waiting' });
      try {
        const what = await waitForUser(id, signal, action.kind);
        events.push(`ask_for_key_file: the developer ${what}`);
      } finally {
        change(id, { state: 'done' });
      }
      return 'continue';
    }
    case 'save_apple_key': {
      const issuerId = action.issuerId.trim().toLowerCase();
      const keyId = action.keyId.trim().toUpperCase();
      if (!valid.issuerId(issuerId)) return failed(`save_apple_key: "${action.issuerId}" is not an Issuer ID. It looks like 69a6de70-03db-47e3-e053-5b8c7c11a4d1.`);
      if (!valid.keyId(keyId)) return failed(`save_apple_key: "${action.keyId}" is not a Key ID. It has 10 letters and digits.`);
      if (!seenIn(issuerId, seen)) return failed('save_apple_key: that Issuer ID is not on any page you read. Copy it from the page.');
      if (!seenIn(keyId, seen)) return failed('save_apple_key: that Key ID is not on any page you read or in a key file name.');
      if (!keyFiles.apple.length) return failed('save_apple_key: the app has no .p8 key file yet. Download it from App Store Connect, or ask the developer with ask_for_key_file.');
      if (!saveApple(keyId, issuerId)) return failed(`save_apple_key: no key file matches Key ID ${keyId}.`);
      events.push(`save_apple_key: saved Key ID ${keyId}. Apple's list of apps loads now.`);
      return 'continue';
    }
    case 'save_vendor_number': {
      if (!valid.vendorNumber(action.value)) return failed(`save_vendor_number: "${action.value}" is not a vendor number, which is all digits.`);
      if (!seenIn(action.value, seen)) return failed('save_vendor_number: that number is not on any page you read. Copy it from the page.');
      current.saveVendorNumber(action.value);
      add({ kind: 'saved', title: 'Vendor number saved', detail: action.value });
      events.push(`save_vendor_number: saved ${action.value}`);
      return 'continue';
    }
    case 'save_play_key': {
      const packageName = action.packageName.trim();
      if (!valid.packageName(packageName)) return failed(`save_play_key: "${packageName}" is not a package name like com.example.app.`);
      if (!seenIn(packageName, seen)) return failed('save_play_key: that package name is not on any page you read or in the developer\'s messages.');
      if (!keyFiles.play.length) {
        const saved = current.facts().playKey;
        if (!saved) return failed('save_play_key: the app has no service account key file yet. Create it in Google Cloud, or ask the developer with ask_for_key_file.');
        // The key is saved already: this moves it to another app.
        current.setPlayPackage(packageName);
        add({ kind: 'saved', title: 'Google Play app changed', detail: packageName });
        events.push(`save_play_key: Growth now reads ${packageName} with the saved key`);
        return 'continue';
      }
      savePlay(packageName);
      events.push(`save_play_key: saved the key for ${packageName}`);
      return 'continue';
    }
    case 'save_reports_uri': {
      const value = action.value.trim();
      if (!valid.reportsUri(value)) return failed(`save_reports_uri: "${value}" is not the report files' Cloud Storage URI, which starts with gs://pubsite_prod_.`);
      if (!seenIn(value, seen)) return failed('save_reports_uri: that URI is not on any page you read or in what the page copied.');
      current.saveReportsUri(value);
      add({ kind: 'saved', title: 'Report files saved', detail: value });
      events.push(`save_reports_uri: saved ${value}`);
      return 'continue';
    }
    case 'set_stores':
      current.setStores(action.stores);
      events.push(`set_stores: ${action.stores.map((store) => STORE_NAMES[store]).join(' and ')}`);
      return 'done';
    case 'refresh': {
      const id = add({ kind: 'refresh', state: 'running', lines: [] });
      events.push('refresh: started. You hear how it went when it ends.');
      void current
        .refresh()
        .then((result) => {
          change(id, { state: 'done', lines: result.lines });
          events.push(`The refresh of ${result.appName} ended: ${result.lines.join('; ')}`);
        })
        .catch((error) => {
          change(id, { state: 'failed', lines: [error instanceof Error ? error.message : 'The refresh stopped'] });
          events.push(`The refresh failed: ${error instanceof Error ? error.message : 'it stopped'}`);
        })
        .finally(() => wake('saw a refresh end'));
      return 'done';
    }
    case 'close_browser':
      await browser.close();
      events.push('close_browser: closed');
      return 'done';
  }
}

// --- the loop ---------------------------------------------------------------------

async function readBrowser(): Promise<string | null> {
  if (!browser.state().open) {
    lastPage = null;
    return null;
  }
  publish({ phase: 'reading' });
  let page: PageSnapshot | null = null;
  try {
    page = await browser.driver.snapshot();
  } catch {
    page = null;
  }
  if (!page) return `Address: ${browser.state().url ?? 'unknown'}\n(The page is still loading.)`;
  // The driver hides keys already; this holds if a page slips one past it.
  page = { ...page, text: redactSecrets(page.text) };
  lastPage = page;
  remember(page.text);
  try {
    const copied = await browser.driver.copied();
    for (const text of copied?.texts ?? []) {
      if (!seen.includes(text)) {
        remember(text);
        events.push(`The page copied: ${text}`);
      }
    }
  } catch {
    // Copies are only a convenience.
  }
  return page.text;
}

async function run(): Promise<void> {
  if (snapshot.running || !env) return;
  if (env.reason) {
    add({ kind: 'notice', tone: 'error', text: env.reason });
    return;
  }
  // Used up: what woke it waits in `events` until the user does something.
  if (budget <= 0) return;
  const stop = new AbortController();
  controller = stop;
  publish({ running: true });
  let emptyRounds = 0;
  try {
    while (budget > 0) {
      const current = env;
      if (!current || current.reason) break;
      const page = await readBrowser();
      publish({ phase: 'thinking' });
      const numbers = current.numbers();
      const prompt = turnPrompt({
        status: statusText(current.facts()),
        events,
        page,
        transcript,
      });
      events = [];
      unanswered = false;
      budget -= 1;
      const raw = await current.ask(systemPrompt(numbers?.digest ?? null, numbers?.appName ?? null), prompt, stop.signal);
      if (stop.signal.aborted) throw stopped();
      const reply = readReply(raw);
      if (reply.say || reply.choices.length) add({ kind: 'assistant', text: reply.say, choices: reply.choices });
      const did = reply.actions.map((action) => (action.do === 'open' ? `open ${action.url}` : 'ref' in action ? `${action.do} [${action.ref}]` : action.do));
      transcript.push({ role: 'assistant', text: [reply.say, did.length ? `(actions: ${did.join(', ')})` : ''].filter(Boolean).join(' ') });
      const goOn = await perform(reply.actions, stop.signal);
      if (reply.next !== 'continue' && !goOn && !unanswered) break;
      if (reply.actions.length === 0) {
        emptyRounds += 1;
        if (emptyRounds > 1) break;
      } else {
        emptyRounds = 0;
      }
      if (budget <= 0) {
        add({ kind: 'notice', tone: 'info', text: 'That was a lot of steps in one go. Say "keep going" to carry on' });
      }
    }
  } catch (error) {
    if (isAbort(error) || stop.signal.aborted) {
      add({ kind: 'notice', tone: 'info', text: 'Stopped' });
    } else {
      console.error('The Growth assistant failed', error);
      add({ kind: 'notice', tone: 'error', text: error instanceof Error ? error.message : 'No answer came back. Try again' });
    }
  } finally {
    if (controller === stop) controller = null;
    approval = null;
    waiting = null;
    publish({ running: false, phase: 'idle' });
    if (resetAfter) {
      resetAfter = false;
      wakeAfter = false;
      reset();
    } else if (wakeAfter && !stop.signal.aborted) {
      wakeAfter = false;
      queueMicrotask(() => void run());
    }
    wakeAfter = false;
  }
}

/** A message from the user. A key pasted into it is taken out and saved, never sent. */
export function sendMessage(text: string): void {
  const message = text.trim();
  if (!message) return;
  userActed();
  const pasted = keyInText(message);
  if (pasted) {
    add({ kind: 'user', text: 'A private key (kept out of the chat)' });
    // As pasted: a key file ends in a line break.
    addKeyFile({ kind: pasted, fileName: pasted === 'apple-key' ? 'Pasted key' : 'Pasted service account key', content: text }, 'user');
    return;
  }
  add({ kind: 'user', text: message });
  transcript.push({ role: 'user', text: message });
  remember(message);
  if (approval) {
    answerApproval(approval.id, false);
    return;
  }
  if (waiting) {
    const resolve = waiting.resolve;
    waiting = null;
    resolve('wrote a message');
    return;
  }
  if (snapshot.running) {
    unanswered = true;
    return;
  }
  void run();
}

export function stopAssistant(): void {
  controller?.abort();
}

function reset(): void {
  transcript.length = 0;
  events = [];
  seen = [];
  lastPage = null;
  keyFiles.apple = [];
  keyFiles.play = [];
  unanswered = false;
  budget = MAX_STEPS;
  publish({ items: [], phase: 'idle' });
}

/**
 * Start again with an empty conversation. A turn under way stops first, so
 * nothing it was still writing lands in the new one. The browser stays as it is.
 */
export function newConversation(): void {
  if (snapshot.running) {
    resetAfter = true;
    controller?.abort();
    return;
  }
  reset();
}
