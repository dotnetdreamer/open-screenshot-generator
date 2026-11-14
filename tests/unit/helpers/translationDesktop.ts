// A stand-in for the desktop app around the translation engines, in node: the
// IPC Rust answers for Claude Code and Codex, our translation server behind
// fetch, and localStorage. Imported FIRST by a test file, because the server
// address is read when src/services/translation.ts loads.

process.env.NEXT_PUBLIC_TRANSLATION_PRIMARY_URL = 'https://libre.test';

export type Answer = (args: Record<string, any>) => unknown;

export const invokes: Array<{ cmd: string; args: Record<string, any> }> = [];
/** What each command answers now. Tests set the ones they use. */
export const answers: Record<string, Answer> = {};
export const storage = new Map<string, string>();
/** Every request our server got: the path and the body. */
export const serverCalls: Array<{ path: string; body: any }> = [];
/** Requests to the AI panel's provider, and the most that were in flight at once. */
export const aiCalls = { count: 0, inFlight: 0, most: 0 };

const AI_SETTINGS_KEY = 'open-screenshot-generator.ai-settings';

/** An OpenRouter key in the AI panel, which answers through fetch below. */
export function useAiPanel(): void {
  storage.set(
    AI_SETTINGS_KEY,
    JSON.stringify({
      provider: 'openrouter',
      keys: { openrouter: 'sk-or-test' },
      models: { openrouter: 'test/model' },
      baseUrls: {},
      compatibleKeys: {},
    })
  );
}

Object.assign(globalThis, {
  window: globalThis,
  localStorage: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => void storage.set(key, String(value)),
    removeItem: (key: string) => void storage.delete(key),
  },
  __TAURI_INTERNALS__: {
    invoke: async (cmd: string, args: Record<string, any> = {}) => {
      invokes.push({ cmd, args });
      const answer = answers[cmd];
      if (!answer) throw new Error(`The stand-in does not model ${cmd}`);
      return answer(args);
    },
  },
  fetch: async (input: string | URL | Request, init?: { body?: string }) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const path = url.pathname;
    const body = init?.body ? JSON.parse(init.body) : undefined;
    if (path.endsWith('/chat/completions')) {
      // The AI panel's provider: every string tagged <language>, after a moment.
      aiCalls.count++;
      aiCalls.inFlight++;
      aiCalls.most = Math.max(aiCalls.most, aiCalls.inFlight);
      await wait(20);
      aiCalls.inFlight--;
      const text = (body.messages as Array<{ content: unknown }>)
        .map(({ content }) =>
          typeof content === 'string'
            ? content
            : Array.isArray(content)
              ? content.map((part: { text?: string }) => part.text ?? '').join('')
              : ''
        )
        .join('\n');
      const target = targetOf(text);
      const answer = Object.fromEntries(askedFor(text).map(({ id, text: source }) => [id, `<${target}> ${source}`]));
      return Response.json({
        id: 'chatcmpl-test',
        object: 'chat.completion',
        created: 1,
        model: 'test/model',
        choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify(answer) }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      });
    }
    serverCalls.push({ path, body });
    if (path === '/health') return new Response('ok', { status: 200 });
    if (path === '/translate') {
      const tag = (text: string) => `{${body.target}} ${text}`;
      const translatedText = Array.isArray(body.q) ? body.q.map(tag) : tag(body.q);
      return new Response(JSON.stringify({ translatedText }), { status: 200 });
    }
    return new Response('not found', { status: 404 });
  },
});

export const callsTo = (cmd: string) => invokes.filter((entry) => entry.cmd === cmd);

export function resetDesktop(): void {
  invokes.length = 0;
  serverCalls.length = 0;
  Object.assign(aiCalls, { count: 0, inFlight: 0, most: 0 });
  storage.delete(AI_SETTINGS_KEY);
  for (const cmd of Object.keys(answers)) delete answers[cmd];
}

/** Detection answers: each CLI found and signed in, or not installed. */
export function cliReady(claude: boolean, codex: boolean): void {
  answers.abs_claude_detect = () =>
    claude ? { found: true, loggedIn: true, subscriptionType: 'max' } : { found: false };
  answers.abs_codex_detect = () => (codex ? { found: true, loggedIn: true, planType: 'plus' } : { found: false });
}

/** The ids and strings a translation prompt asks for. */
export function askedFor(prompt: string): Array<{ id: string; text: string }> {
  return [...prompt.matchAll(/^"(s\d+)": (".*?"),?$/gm)].map((match) => ({ id: match[1], text: JSON.parse(match[2]) }));
}

/** The language code the instructions translate into, from "... into German (Deutsch, de-DE)." */
export function targetOf(system: string): string {
  return /into [^\n]*?, ([A-Za-z-]+)\)/.exec(system)?.[1] ?? '??';
}

/** A model's answer to a translation prompt: every string tagged with its language, in a fence. */
export function reply(args: Record<string, any>, drop: string[] = []): string {
  const target = targetOf(String(args.system));
  const out: Record<string, string> = {};
  for (const { id, text } of askedFor(String(args.prompt))) {
    if (!drop.includes(id)) out[id] = `[${target}] ${text}`;
  }
  return '```json\n' + JSON.stringify(out) + '\n```';
}

export const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
