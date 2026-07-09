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

function* candidates(text: string): Generator<string> {
  const fenced = [...text.matchAll(/```(?:json)?\s*\n?([\s\S]*?)```/gi)];
  for (const match of fenced) {
    yield match[1].trim();
  }

  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first !== -1 && last > first) {
    yield text.slice(first, last + 1);
  }

  yield text;
}
