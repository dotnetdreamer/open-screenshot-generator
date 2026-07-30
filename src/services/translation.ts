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
