// What GET /v1/models answers.
//
// The Claude CLI has no endpoint that lists what it can run, so this table is
// written by hand and every id here is passed through to the CLI untouched.
// Anything the CLI accepts works even if it is missing below: the editor's
// "Use my API key" tab lets you type a model id instead of picking one, and a
// bad id comes back as a 400 naming the id rather than a silent fallback.
//
// Every full id contains "claude", which is what the editor's own
// looksLikeVisionModel() heuristic keys on (src/lib/ai/freeProviders.ts), so
// they sort above the bare aliases in the picker. That ordering is right here
// for once: the design agent sends screenshots, and the aliases resolve to
// whatever the CLI currently maps them to, which is a worse thing to pin a run
// to than a name you can read.

export const MODELS = [
  'claude-opus-5',
  'claude-opus-5[1m]',
  'claude-sonnet-5',
  'claude-sonnet-5[1m]',
  'claude-haiku-4-5',
  'claude-opus-4-8',
  // The CLI's own aliases. "opusplan" plans with Opus and executes with Sonnet,
  // which for a single-shot completion just means Opus.
  'opus',
  'sonnet',
  'haiku',
  'opusplan',
];

export const DEFAULT_MODEL = 'claude-sonnet-5';

/** The OpenAI /v1/models body. `owned_by` is decoration; nothing reads it. */
export function modelListBody() {
  return {
    object: 'list',
    data: MODELS.map((id) => ({
      id,
      object: 'model',
      created: 0,
      owned_by: 'anthropic',
    })),
  };
}
