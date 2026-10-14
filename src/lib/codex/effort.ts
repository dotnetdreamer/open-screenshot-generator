// Which effort level a Codex turn goes out with. Codex refuses a level its
// model does not take, and the models differ, so the one the user picked is
// lowered to the highest the model has below it. The store sends that and the
// panel shows it, so both read it from here.

import type { CodexEffortChoice } from './types';

/** Weakest first. */
const ORDER: CodexEffortChoice[] = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

/**
 * `picked`, or the strongest of `efforts` below it. With no list (a model
 * nobody has detected yet), `picked` as it is, and with nothing below it the
 * weakest the model has.
 */
export function clampCodexEffort(picked: CodexEffortChoice, efforts: readonly string[]): CodexEffortChoice {
  if (!efforts.length) return picked;
  const ceiling = ORDER.indexOf(picked);
  const offered = ORDER.filter((level) => efforts.includes(level));
  const below = offered.filter((level) => ORDER.indexOf(level) <= ceiling);
  return below[below.length - 1] ?? offered[0] ?? picked;
}
