// The waits a capture makes for its fonts (src/lib/fontEmbed.ts): how long a
// font that is not coming may hold a picture up, what is remembered from one
// capture to the next so an export of many artboards pays for it once, and
// what happens when it arrives after all.
//
// There is no page here. The few things the module asks a page for are stood
// in below: the styles of one text node, `document.fonts.load`, the page's
// stylesheets and `fetch`. Time is node's mocked clock, so ten seconds pass in
// no time and exactly when the test says.

import { test, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { resolveFontEmbedCss, takeFontsLeftOut, whenNodeFontsLoaded } from '@/lib/fontEmbed';

// --- a page, as far as fontEmbed.ts looks at one -----------------------------

interface Deferred {
  promise: Promise<unknown[]>;
  arrive: () => void;
  fail: () => void;
}

/** One pending `document.fonts.load` per family, settled by the test. */
const loads = new Map<string, Deferred>();
/** Families the page already has. */
const loaded = new Set<string>();
/** Every `fetch` the module made, and how it was answered. */
const fetched: string[] = [];
let answer: (url: string, signal: AbortSignal | undefined) => Promise<Response>;
let sheets: unknown[] = [];

function familyOf(spec: string): string {
  return spec.slice(spec.indexOf('px ') + 3).split(',')[0].trim().replace(/["']/g, '');
}

const page = globalThis as unknown as Record<string, unknown>;
page.window = { getComputedStyle: (element: { style: unknown }) => element.style };
page.Node = { TEXT_NODE: 3 };
page.HTMLInputElement = class {};
page.HTMLTextAreaElement = class {};
page.CSSRule = { FONT_FACE_RULE: 5 };
page.requestAnimationFrame = (callback: () => void) => setTimeout(callback, 16);
page.FileReader = class {
  result = '';
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  readAsDataURL() {
    this.result = 'data:font/woff2;base64,AAAA';
    queueMicrotask(() => this.onload?.());
  }
};
page.document = {
  baseURI: 'http://localhost/',
  get styleSheets() {
    return sheets;
  },
  fonts: {
    load(spec: string) {
      const family = familyOf(spec);
      if (loaded.has(family)) return Promise.resolve([]);
      let pending = loads.get(family);
      if (!pending) {
        let arrive!: () => void;
        let fail!: () => void;
        const promise = new Promise<unknown[]>((resolve, reject) => {
          arrive = () => {
            loaded.add(family);
            resolve([]);
          };
          fail = () => reject(new Error('network error'));
        });
        pending = { promise, arrive, fail };
        loads.set(family, pending);
      }
      return pending.promise;
    },
  },
};
page.fetch = (url: string, init?: { signal?: AbortSignal }) => {
  fetched.push(url);
  return answer(url, init?.signal);
};

/** A request that neither answers nor fails, until it is aborted. */
function stalled(_url: string, signal: AbortSignal | undefined): Promise<Response> {
  return new Promise((_resolve, reject) => {
    signal?.addEventListener('abort', () => reject(new Error('aborted')));
  });
}

/** An artboard with one line of text set in `family`. */
function boardSetIn(family: string): HTMLElement {
  const style = { fontFamily: `"${family}", sans-serif`, fontStyle: 'normal', fontWeight: '700' };
  const node = {
    style,
    textContent: 'Calm mornings',
    childNodes: [{ nodeType: 3, textContent: 'Calm mornings' }],
    querySelectorAll: () => [],
  };
  return node as unknown as HTMLElement;
}

/** A same-origin stylesheet that declares `family` with one file. */
function declares(family: string, url: string): unknown {
  const text = `@font-face { font-family: "${family}"; src: url(${url}) format("woff2"); }`;
  const style = { getPropertyValue: (name: string) => (name === 'font-family' ? `"${family}"` : '') };
  return { href: null, cssRules: [{ type: 5, style, cssText: text }] };
}

/** Lets what is already due run: the promise jobs queued so far, a few rounds deep. */
async function settle(): Promise<void> {
  for (let i = 0; i < 12; i += 1) await new Promise<void>((resolve) => setImmediate(resolve));
}

/** How a promise stands right now, without waiting for it. */
async function stateOf<T>(promise: Promise<T>): Promise<T | 'waiting'> {
  await settle();
  return Promise.race([promise, Promise.resolve('waiting' as const)]);
}

/**
 * Lets `ms` go by. What is due first gets to run, so a wait that starts a few
 * promise jobs into a call has its timer set before the clock moves.
 */
async function pass(ms: number): Promise<void> {
  await settle();
  mock.timers.tick(ms);
  await settle();
}

// What a capture waited for in vain is remembered for as long as the page
// lives, which here is the whole file. So each test uses families of its own,
// and starts an hour after the one before: long past any trouble that one left.
let clock = Date.UTC(2026, 10, 25);

beforeEach(() => {
  clock += 3_600_000;
  mock.timers.reset();
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: clock });
  sheets = [];
  answer = stalled;
  fetched.length = 0;
});

test('a face that does not come holds a capture for ten seconds, and the capture names it', async () => {
  takeFontsLeftOut();
  const waiting = whenNodeFontsLoaded(boardSetIn('Slow One'));
  await pass(9_900);
  assert.equal(await stateOf(waiting), 'waiting');
  await pass(100);
  assert.equal(await stateOf(waiting), false, 'given up at ten seconds, and it says the face did not come');
  assert.deepEqual(takeFontsLeftOut(), ['Slow One']);
  assert.deepEqual(takeFontsLeftOut(), [], 'asking empties the list');
});

test('the next capture does not wait for the same face again, however much later', async () => {
  const first = whenNodeFontsLoaded(boardSetIn('Slow Two'));
  await pass(10_000);
  assert.equal(await stateOf(first), false);

  // The next artboard of the same export, straight after.
  assert.equal(await stateOf(whenNodeFontsLoaded(boardSetIn('Slow Two'))), false, 'no second wait');
  // And one a minute on, long after the network stopped counting as the trouble.
  await pass(60_000);
  takeFontsLeftOut();
  assert.equal(await stateOf(whenNodeFontsLoaded(boardSetIn('Slow Two'))), false, 'still no second wait');
  assert.deepEqual(takeFontsLeftOut(), ['Slow Two'], 'and the picture is still reported as taken without it');
});

test('a face met for the first time while the network is the trouble is given a second, not ten', async () => {
  const first = whenNodeFontsLoaded(boardSetIn('Slow Three'));
  await pass(10_000);
  assert.equal(await stateOf(first), false);

  // Another language of the same export, set in another family that is not coming either.
  const second = whenNodeFontsLoaded(boardSetIn('Slow Four'));
  await pass(900);
  assert.equal(await stateOf(second), 'waiting');
  await pass(100);
  assert.equal(await stateOf(second), false);

  // Half a minute after the last wait in vain, a new face gets its ten seconds again.
  await pass(31_000);
  const third = whenNodeFontsLoaded(boardSetIn('Slow Five'));
  await pass(9_000);
  assert.equal(await stateOf(third), 'waiting');
  await pass(1_000);
  assert.equal(await stateOf(third), false);
});

test('a face that arrives after all is in the next picture, and patience is back', async () => {
  const first = whenNodeFontsLoaded(boardSetIn('Late Six'));
  await pass(10_000);
  assert.equal(await stateOf(first), false);

  loads.get('Late Six')!.arrive();
  await settle();
  takeFontsLeftOut();
  assert.equal(await stateOf(whenNodeFontsLoaded(boardSetIn('Late Six'))), true);
  assert.deepEqual(takeFontsLeftOut(), []);

  // The network moved, so a face that is slow now is waited for in full.
  const next = whenNodeFontsLoaded(boardSetIn('Slow Seven'));
  await pass(9_000);
  assert.equal(await stateOf(next), 'waiting');
  await pass(1_000);
  assert.equal(await stateOf(next), false);
});

test('a face that arrives while it is waited for ends the wait there', async () => {
  const waiting = whenNodeFontsLoaded(boardSetIn('Quick Eight'));
  await pass(2_000);
  assert.equal(await stateOf(waiting), 'waiting');
  loads.get('Quick Eight')!.arrive();
  // Two frames for the page to lay the text out in it, one after the other.
  await pass(20);
  await pass(20);
  assert.equal(await stateOf(waiting), true);
});

test('a font file that stalls is given its ten seconds and left out of the picture', async () => {
  // The page has the face. Reading its file into the picture is what stalls.
  loaded.add('Brand Nine');
  sheets = [declares('Brand Nine', 'https://fonts.example/nine.woff2')];
  takeFontsLeftOut();
  const css = resolveFontEmbedCss(boardSetIn('Brand Nine'));
  await pass(9_900);
  assert.equal(await stateOf(css), 'waiting');
  await pass(100);
  assert.equal(await stateOf(css), '', 'the capture goes ahead without the face');
  assert.deepEqual(takeFontsLeftOut(), ['Brand Nine']);
  assert.deepEqual(fetched, ['https://fonts.example/nine.woff2']);

  // The next artboard does not ask for the file again while the trouble lasts.
  assert.equal(await stateOf(resolveFontEmbedCss(boardSetIn('Brand Nine'))), '');
  assert.equal(fetched.length, 1);
});

test('a face that had not come is not waited for a second time through its file', async () => {
  sheets = [declares('Slow Ten', 'https://fonts.example/ten.woff2')];
  const css = resolveFontEmbedCss(boardSetIn('Slow Ten'));
  await pass(10_000);
  // Ten seconds for the face, then a second for what the cache might hold. Not ten more.
  assert.equal(await stateOf(css), 'waiting');
  await pass(1_000);
  assert.equal(await stateOf(css), '');
});

test('a file that could not be read is asked for again by the next capture', async () => {
  loaded.add('Brand Eleven');
  sheets = [declares('Brand Eleven', 'https://fonts.example/eleven.woff2')];
  answer = () => Promise.reject(new Error('network error'));
  assert.equal(await stateOf(resolveFontEmbedCss(boardSetIn('Brand Eleven'))), '');

  // One bad moment on the network. Kept in the cache, it left every later
  // export of the session without the face.
  answer = () => Promise.resolve(new Response(new Blob(['font']), { status: 200 }));
  const css = await stateOf(resolveFontEmbedCss(boardSetIn('Brand Eleven')));
  assert.equal(fetched.length, 2);
  assert.match(String(css), /font-family: "Brand Eleven"; src: url\(data:font\/woff2;base64,AAAA\)/);
});
