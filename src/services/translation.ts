/**
 * Translation service using local LibreTranslate instance.
 */

// Translation servers
const PRIMARY_URL = process.env.NEXT_PUBLIC_TRANSLATION_PRIMARY_URL || '';
const FALLBACK_URL = process.env.NEXT_PUBLIC_TRANSLATION_FALLBACK_URL || '';

export const isTranslationEnabled = !!PRIMARY_URL || !!FALLBACK_URL;

/**
 * Sentinel LibreTranslate understands as "work out the source yourself".
 * https://docs.libretranslate.com/guides/api_usage/#auto-detection-of-source-language
 */
export const AUTO_DETECT = 'auto';

let cachedUrl: string | null = null;
let cacheTimestamp: number = 0;
const CACHE_DURATION = 60 * 1000; // 1 minute

async function getTranslationUrl(): Promise<string> {
  const now = Date.now();
  if (cachedUrl && now - cacheTimestamp < CACHE_DURATION) {
    return cachedUrl;
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);
    const response = await fetch(`${PRIMARY_URL}/health`, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (response.ok) {
      cachedUrl = PRIMARY_URL;
      cacheTimestamp = now;
      return cachedUrl;
    }
  } catch (err) {
    console.warn('Primary translation server unreachable, falling back...', err);
  }

  cachedUrl = FALLBACK_URL;
  cacheTimestamp = now;
  return cachedUrl;
}

export interface DetectedLanguage {
  language: string;
  confidence: number;
}

/**
 * Ask the server what language a sample of text is in. Returns null instead of
 * throwing so callers can just fall back to per-request auto detection.
 */
export async function detectLanguage(text: string): Promise<DetectedLanguage | null> {
  if (!text || !text.trim()) return null;

  try {
    const url = await getTranslationUrl();
    const response = await fetch(`${url}/detect`, {
      method: 'POST',
      body: JSON.stringify({ q: text }),
      headers: { "Content-Type": "application/json" }
    });

    if (!response.ok) return null;

    const data = await response.json();
    const best = Array.isArray(data) ? data[0] : null;
    if (!best || typeof best.language !== 'string') return null;

    return { language: best.language, confidence: Number(best.confidence) || 0 };
  } catch (error) {
    console.warn('Language detection failed, falling back to auto source', error);
    return null;
  }
}

export interface TranslationResult {
  text: string;
  /** What the server detected, when the request was sent with source 'auto'. */
  detectedLanguage?: string;
}

/**
 * True for the error a 429 raises. The server saying "slow down" is the one
 * failure a caller has to report differently: everything else means a string
 * did not translate, this one means the rest of the run did not even happen.
 */
export function isRateLimitError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { status?: unknown }).status === 429
  );
}

export async function translateText(
  text: string,
  targetLanguage: string,
  sourceLanguage: string = AUTO_DETECT
): Promise<TranslationResult> {
  if (!text || !text.trim()) return { text };

  // There is no same-language model, so this either 400s or echoes the input
  // back. Skipping it also saves a slot in the per-minute rate limit.
  if (sourceLanguage !== AUTO_DETECT && sourceLanguage === targetLanguage) {
    return { text };
  }

  try {
    const url = await getTranslationUrl();
    const response = await fetch(`${url}/translate`, {
      method: 'POST',
      body: JSON.stringify({
        q: text,
        source: sourceLanguage,
        target: targetLanguage,
        format: "text"
      }),
      headers: { "Content-Type": "application/json" }
    });

    if (!response.ok) {
      const error = new Error(`Failed to process translation request (status ${response.status})`);
      if (response.status === 429) {
        (error as any).status = 429;
      }
      throw error;
    }

    const data = await response.json();
    return {
      text: data.translatedText || text,
      detectedLanguage: data.detectedLanguage?.language,
    };
  } catch (error) {
    console.error('Translation error:', error);
    throw error;
  }
}

// --- batch translation -------------------------------------------------------
//
// One POST per string spends the request budget (20 requests / 5000 characters
// a minute on the public instances) long before it spends the character one, so
// a six board project in five languages is rate limited by arithmetic alone.
// LibreTranslate accepts an array `q` and answers with an array in the same
// order, which costs one request per batch instead of one per caption.

/** Both budgets are per minute, so a batch stays under whichever binds first. */
const MAX_BATCH_ITEMS = 20;
const MAX_BATCH_CHARS = 2000;

/** Attempts per request, so a 429 is survived twice before it is reported. */
const MAX_ATTEMPTS = 3;

/**
 * Older builds and some proxies answer an array `q` with a 400. Asking once per
 * session and remembering the answer keeps the fallback from costing a wasted
 * round trip on every batch.
 */
let arrayBatchSupported = true;

export interface BatchTranslationOptions {
  signal?: AbortSignal;
  /** Fires once per batch, so a long run can show real movement. */
  onProgress?: (done: number, total: number) => void;
}

export interface BatchTranslationResult {
  /** One entry per input, in order. null where the string did not translate. */
  texts: Array<string | null>;
  /**
   * The server was still rate limiting after the last retry, so the run stopped
   * early and the remaining nulls were never attempted. Callers report this
   * differently from a failure: waiting a minute actually fixes it.
   */
  rateLimited: boolean;
}

function translationError(message: string, status?: number): Error {
  const error = new Error(message) as Error & { status?: number };
  if (status) error.status = status;
  return error;
}

function abortError(): Error {
  return new DOMException('Cancelled', 'AbortError');
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Jitter is not decoration here: translating four languages in a row fires four
 * runs that hit the same limit at the same moment, and without it they all come
 * back in lockstep and are all rejected again.
 */
function backoffDelay(attempt: number, retryAfterMs: number | null): number {
  if (retryAfterMs !== null) return Math.min(retryAfterMs, 30_000);
  return Math.min(800 * 2 ** (attempt - 1), 8_000) + Math.random() * 400;
}

function retryAfterFrom(response: Response): number | null {
  const header = response.headers?.get?.('Retry-After');
  if (!header) return null;
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : null;
}

interface TranslatePayload {
  q: string | string[];
  source: string;
  target: string;
  format: 'text';
}

/**
 * One /translate POST, retried through a 429 or a gateway hiccup. Rejects with
 * a rate-limit error only once every attempt has been spent, so a single
 * unlucky request never reads as "the server has had enough".
 */
async function postTranslate(payload: TranslatePayload, signal?: AbortSignal): Promise<any> {
  const url = await getTranslationUrl();
  let lastError: Error = translationError('Failed to process translation request');

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (signal?.aborted) throw abortError();

    let response: Response;
    try {
      response = await fetch(`${url}/translate`, {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: { 'Content-Type': 'application/json' },
        signal,
      });
    } catch (error) {
      if (signal?.aborted) throw abortError();
      // A dropped connection is worth one more try; a dead server fails the
      // same way three times and costs a couple of seconds.
      lastError = error instanceof Error ? error : translationError('Translation request failed');
      if (attempt < MAX_ATTEMPTS - 1) await sleep(backoffDelay(attempt + 1, null), signal);
      continue;
    }

    if (response.ok) return response.json();

    const retryable = response.status === 429 || response.status >= 500;
    lastError = translationError(
      `Failed to process translation request (status ${response.status})`,
      response.status
    );
    if (!retryable || attempt === MAX_ATTEMPTS - 1) throw lastError;
    await sleep(backoffDelay(attempt + 1, retryAfterFrom(response)), signal);
  }

  throw lastError;
}

/** Groups of indexes that fit one request, under both budgets. */
function batchIndexes(texts: string[], pending: number[]): number[][] {
  const batches: number[][] = [];
  let current: number[] = [];
  let chars = 0;
  for (const index of pending) {
    const length = texts[index].length;
    if (current.length > 0 && (current.length >= MAX_BATCH_ITEMS || chars + length > MAX_BATCH_CHARS)) {
      batches.push(current);
      current = [];
      chars = 0;
    }
    current.push(index);
    chars += length;
  }
  if (current.length > 0) batches.push(current);
  return batches;
}

/**
 * Translate many strings in as few requests as the server allows. Returns one
 * entry per input in the same order, so callers can count exactly what landed
 * rather than reporting a whole-run success that quietly abandoned half of it.
 *
 * Blank inputs and a source that equals the target come back unchanged without
 * spending a request, matching translateText.
 */
export async function translateTexts(
  texts: string[],
  targetLanguage: string,
  sourceLanguage: string = AUTO_DETECT,
  options: BatchTranslationOptions = {}
): Promise<BatchTranslationResult> {
  const { signal, onProgress } = options;
  const out: Array<string | null> = texts.map(() => null);

  if (texts.length === 0) return { texts: out, rateLimited: false };

  if (sourceLanguage !== AUTO_DETECT && sourceLanguage === targetLanguage) {
    return { texts: texts.slice(), rateLimited: false };
  }

  const pending: number[] = [];
  texts.forEach((text, index) => {
    if (!text || !text.trim()) out[index] = text;
    else pending.push(index);
  });
  if (pending.length === 0) return { texts: out, rateLimited: false };

  const batches = batchIndexes(texts, pending);
  const total = pending.length;
  let done = 0;
  let rateLimited = false;

  for (const batch of batches) {
    if (signal?.aborted) break;

    const values = batch.map((index) => texts[index]);
    let translated: Array<string | null> | null = null;

    if (arrayBatchSupported && values.length > 1) {
      try {
        const data = await postTranslate(
          { q: values, source: sourceLanguage, target: targetLanguage, format: 'text' },
          signal
        );
        const list = data?.translatedText;
        if (Array.isArray(list) && list.length === values.length) {
          translated = list.map((entry: unknown, i: number) =>
            typeof entry === 'string' ? entry : values[i]
          );
        } else {
          // The server answered, but not with the array shape. It is not going
          // to start, so stop asking and finish the run one string at a time.
          arrayBatchSupported = false;
        }
      } catch (error) {
        if (signal?.aborted) break;
        if (isRateLimitError(error)) {
          rateLimited = true;
          break;
        }
        // A 400 on an array `q` is the server rejecting the batch form itself;
        // anything else is this batch's own problem and the serial pass below
        // will surface it per string.
        if ((error as { status?: number })?.status === 400) arrayBatchSupported = false;
        console.warn('Batch translation failed, falling back to single requests', error);
      }
    }

    if (!translated) {
      const serial: Array<string | null> = [];
      for (const value of values) {
        if (signal?.aborted) break;
        try {
          const data = await postTranslate(
            { q: value, source: sourceLanguage, target: targetLanguage, format: 'text' },
            signal
          );
          serial.push(typeof data?.translatedText === 'string' ? data.translatedText : value);
        } catch (error) {
          if (signal?.aborted) break;
          if (isRateLimitError(error)) {
            rateLimited = true;
            break;
          }
          console.error('Translation error:', error);
          serial.push(null);
        }
      }
      translated = serial;
    }

    translated.forEach((value, i) => {
      if (value !== null) out[batch[i]] = value;
    });
    done += batch.length;
    onProgress?.(Math.min(done, total), total);

    // Every remaining request would be refused for the same reason, and the
    // caller has enough to tell the user how far it got.
    if (rateLimited) break;
  }

  return { texts: out, rateLimited };
}
