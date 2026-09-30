/**
 * `text` cut to at most `max` UTF-16 units, with `ellipsis` after the cut,
 * never through the middle of a surrogate pair.
 *
 * `slice` counts UTF-16 units, so a cut can keep the first half of an emoji
 * and drop the second. A lone surrogate is harmless in the DOM, but Rust's JSON
 * parser refuses one, and on the desktop app a string that crosses the IPC
 * bridge with one (a dock snapshot for a detached window, a message for Claude
 * Code) takes the whole call down with it.
 */
export function clipText(text: string, max: number, ellipsis = '…'): string {
  if (text.length <= max) return text;
  let end = Math.max(0, max);
  const last = text.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return `${text.slice(0, end)}${ellipsis}`;
}
