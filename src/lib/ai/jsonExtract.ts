/**
 * Pulls a JSON object out of whatever a chat assistant replied with.
 *
 * Chat UIs wrap answers in prose and markdown fences no matter how firmly the
 * prompt asks for bare JSON, so this accepts: a fenced ```json block, any
 * fenced block, or the first `{` through the last `}` of the raw text.
 */
export function extractJson(raw: string): unknown {
  const text = raw.trim();
  if (!text) {
    throw new Error('Nothing to read. Paste the assistant\'s full reply here.');
  }

  for (const candidate of candidates(text)) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Try the next candidate.
    }
  }

  throw new Error(
    'Could not find valid JSON in that reply. Copy the whole code block from the assistant, including the opening and closing braces.'
  );
}

/**
 * Every distinct JSON value the reply contains, in priority order.
 *
 * `extractJson` returns only the first parseable object, which is wrong when a
 * reply carries more than one: Gemini sometimes answers with two options (two
 * JSON drafts), and a chatty reply can place a small example object before the
 * real plan. Returning all of them lets the caller try each against its schema
 * and keep the first that actually fits. Never throws: an empty array means
 * nothing parseable was found.
 */
export function extractJsonCandidates(raw: string): unknown[] {
  const text = raw.trim();
  if (!text) return [];

  const out: unknown[] = [];
  const seen = new Set<string>();
  for (const candidate of candidates(text)) {
    let value: unknown;
    try {
      value = JSON.parse(candidate);
    } catch {
      continue;
    }
    // The same object surfaces through several strategies (a fenced block and
    // the balanced-object scan both match it); keep only the first of each.
    const key = JSON.stringify(value);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function* candidates(text: string): Generator<string> {
  const fenced = [...text.matchAll(/```(?:json)?\s*\n?([\s\S]*?)```/gi)];
  for (const match of fenced) {
    yield match[1].trim();
  }

  // Each complete top-level {..} object, in order. A scraped reply can carry the
  // plan twice (a <pre> and its <code> both read) or trail reasoning prose, so
  // "first { .. last }" would splice two objects together; taking each balanced
  // object on its own lets the first valid one win.
  yield* balancedObjects(text);

  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first !== -1 && last > first) {
    yield text.slice(first, last + 1);
  }

  yield text;
}

/** Yields each brace-balanced top-level `{..}` span, ignoring braces in strings. */
function* balancedObjects(text: string): Generator<string> {
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
    } else if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}' && depth > 0) {
      depth--;
      if (depth === 0 && start !== -1) {
        yield text.slice(start, i + 1);
        start = -1;
      }
    }
  }
}
