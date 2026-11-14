// Key material the Ask AI assistant never passes to a model, wherever it
// turns up: on a page the browser reads, in what a page copies, or in a
// message the user writes. The driver (driver.ts) hides it before page text
// leaves the browser, and prompt.ts checks every prompt again.
//
// The driver bundles this file too, so it imports nothing.

/** A whole PEM private key, however its lines were joined. */
const PEM_BLOCK = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g;

/**
 * The start of a key the page cut short: the rest of its line, and the lines
 * after it that hold nothing but key text.
 */
const PEM_START = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[A-Za-z0-9+/= \t\\…]*(?:\r?\n[ \t]*[A-Za-z0-9+/=]{16,}[ \t…]*)*/g;

/** The key inside a service account JSON shown on a page. */
const JSON_KEY = /("private_key"\s*:\s*")(?:[^"\\]|\\.)*"/g;

/** Key text without its first line: a key's DER in base64 starts with MI. */
const KEY_BODY = /\bMI[A-Za-z0-9+/]{60,}={0,2}/g;

/** A line of nothing but base64, as a key's middle lines are. */
const BASE64_LINE = /^[ \t]*[A-Za-z0-9+/]{40,}={0,2}[ \t]*$/gm;

export const HIDDEN_KEY = '[a private key, hidden]';

/** `text` with every private key in it replaced by HIDDEN_KEY. */
export function redactSecrets(text: string): string {
  if (!text) return text;
  return text
    .replace(PEM_BLOCK, HIDDEN_KEY)
    .replace(PEM_START, HIDDEN_KEY)
    .replace(JSON_KEY, `$1${HIDDEN_KEY}"`)
    .replace(KEY_BODY, HIDDEN_KEY)
    .replace(BASE64_LINE, HIDDEN_KEY);
}

export function hasSecret(text: string): boolean {
  return redactSecrets(text) !== text;
}
