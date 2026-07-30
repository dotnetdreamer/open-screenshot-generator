/**
 * Translation service using local LibreTranslate instance.
 */

// Translation servers
const PRIMARY_URL = process.env.NEXT_PUBLIC_TRANSLATION_PRIMARY_URL || '';
const FALLBACK_URL = process.env.NEXT_PUBLIC_TRANSLATION_FALLBACK_URL || '';

export const isTranslationEnabled = !!PRIMARY_URL || !!FALLBACK_URL;
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

export async function translateText(
  text: string,
  targetLanguage: string,
  sourceLanguage: string = 'en'
): Promise<string> {
  if (!text || !text.trim()) return text;

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
    return data.translatedText || text;
  } catch (error) {
    console.error('Translation error:', error);
    throw error;
  }
}
