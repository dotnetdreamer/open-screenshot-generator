// The half that talks OpenAI.
//
// Everything here is shape conversion. Chat-completions messages go in and one
// Anthropic user turn comes out; a finished run goes in and a chat-completions
// body comes out. The rules it follows are the ones the Vercel AI SDK enforces
// on the way back, because that is what the editor calls this endpoint with,
// and its response parser is stricter than the OpenAI docs suggest:
//
//   choices[].index    required, and must be a number. "0" fails the parse.
//   choices[].message  required, an object.
//   message.role       optional, but if present it must be exactly "assistant".
//   usage numbers      optional, but must be numbers if present.
//   choices: []        parses and then throws a TypeError one line later, so an
//                      answerless success has to be an error instead.
//
// A response that misses any of those comes back to the user as "Invalid JSON
// response", which is not retried and says nothing about the real cause.

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);

export class RequestError extends Error {
  constructor(message, status = 400, code = 'invalid_request_error') {
    super(message);
    this.name = 'RequestError';
    this.status = status;
    this.code = code;
  }
}

/**
 * Chat-completions messages to one Claude turn.
 *
 * System and developer messages are joined into the system prompt. Everything
 * else is flattened into a single user turn, because the SDK's streaming input
 * carries user messages only and an assistant turn cannot be replayed as one.
 * A conversation of more than one message is therefore labelled by speaker, so
 * Claude can still read who said what; a single user message, which is what the
 * design agent sends, is passed through with no labelling at all.
 */
export function toClaudeTurn(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new RequestError('"messages" must be a non-empty array.');
  }

  const system = [];
  const turns = [];

  for (const message of messages) {
    const role = message?.role;
    if (role === 'system' || role === 'developer') {
      const text = plainText(message.content);
      if (text) system.push(text);
      continue;
    }
    if (role === 'user' || role === 'assistant' || role === 'tool' || role === 'function') {
      turns.push(message);
      continue;
    }
    throw new RequestError(`Unknown message role "${String(role)}".`);
  }

  if (turns.length === 0) {
    throw new RequestError('"messages" holds no user or assistant message.');
  }

  const label = turns.length > 1;
  const content = [];
  for (const message of turns) {
    if (label) {
      content.push({ type: 'text', text: `${speaker(message.role)}:` });
    }
    // Appended one at a time rather than spread. `push(...blocks)` passes every
    // block as an argument, and a message carrying more than about 120k parts
    // overflows the call stack: a RangeError from a line that looks incapable
    // of throwing, on a request that is merely large.
    for (const block of blocksFor(message)) content.push(block);
  }

  if (content.length === 0) {
    throw new RequestError('"messages" holds no readable content.');
  }

  return { system: system.join('\n\n'), content };
}

function speaker(role) {
  if (role === 'assistant') return 'Assistant';
  if (role === 'tool' || role === 'function') return 'Tool result';
  return 'User';
}

/** The content blocks of one message, images kept as images. */
function blocksFor(message) {
  const content = message?.content;
  if (typeof content === 'string') {
    return content ? [{ type: 'text', text: content }] : [];
  }
  if (!Array.isArray(content)) {
    // null content is what OpenAI sends on an assistant turn that only called a
    // tool. Nothing to read, and not an error.
    return [];
  }

  const blocks = [];
  for (const part of content) {
    if (typeof part === 'string') {
      if (part) blocks.push({ type: 'text', text: part });
      continue;
    }
    const type = part?.type;
    if (type === 'text' || type === 'input_text') {
      if (part.text) blocks.push({ type: 'text', text: part.text });
      continue;
    }
    if (type === 'image_url' || type === 'input_image') {
      const url = typeof part.image_url === 'string' ? part.image_url : part.image_url?.url;
      blocks.push(imageBlock(url ?? part.image ?? ''));
      continue;
    }
    // Audio, files and anything a newer client invents. Saying so beats
    // dropping it and letting the caller wonder why the answer ignored it.
    throw new RequestError(`Content parts of type "${String(type)}" are not supported.`);
  }
  return blocks;
}

function imageBlock(url) {
  if (typeof url !== 'string' || !url) {
    throw new RequestError('An image part carried no url.');
  }
  if (/^https?:\/\//i.test(url)) {
    return { type: 'image', source: { type: 'url', url } };
  }

  const match = /^data:([^;,]+)(;[^,]*)?,(.*)$/s.exec(url);
  if (!match) {
    throw new RequestError('An image url was neither http(s) nor a data url.');
  }
  const [, rawType, params, payload] = match;
  if (!/;base64/i.test(params ?? '')) {
    throw new RequestError('Only base64 data urls are supported for images.');
  }

  // image/jpg is not a real media type but browsers and clients emit it.
  const mediaType = rawType.toLowerCase() === 'image/jpg' ? 'image/jpeg' : rawType.toLowerCase();
  if (!IMAGE_TYPES.has(mediaType)) {
    throw new RequestError(
      `Images must be jpeg, png, gif or webp. This one was "${rawType}".`
    );
  }

  const data = payload.trim();
  const bytes = Math.floor((data.length * 3) / 4);
  if (bytes > MAX_IMAGE_BYTES) {
    throw new RequestError(
      `An image is about ${Math.round(bytes / 1024 / 1024)} MB. The limit is 5 MB.`
    );
  }

  return { type: 'image', source: { type: 'base64', media_type: mediaType, data } };
}

function plainText(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => {
      if (typeof part === 'string') return part;
      // `input_text` is the same thing under the name the Responses API gives
      // it, and clients mix the two. Reading only `text` drops a whole system
      // message written in that dialect without saying so.
      return part?.type === 'text' || part?.type === 'input_text' ? part.text : '';
    })
    .filter(Boolean)
    .join('\n');
}

// --- reply format -----------------------------------------------------------

/**
 * What response_format asks for, as { schema, jsonOnly }.
 *
 * The `$schema` key is dropped on the way through. It comes from the Vercel AI
 * SDK, whose zod-to-JSON-Schema conversion stamps draft-07 on every schema it
 * emits, and the validator on the other side has no use for a keyword that
 * describes the dialect rather than the data.
 */
export function replyFormat(responseFormat) {
  if (!responseFormat || typeof responseFormat !== 'object') return { schema: null, jsonOnly: false };
  const type = responseFormat.type;
  if (type === 'text' || type === undefined) return { schema: null, jsonOnly: false };
  if (type === 'json_object') return { schema: null, jsonOnly: true };
  if (type !== 'json_schema') {
    throw new RequestError(`response_format "${String(type)}" is not supported.`);
  }
  const schema = responseFormat.json_schema?.schema;
  if (!schema || typeof schema !== 'object') {
    throw new RequestError('response_format.json_schema.schema is missing.');
  }
  const { $schema, ...rest } = schema;
  return { schema: rest, jsonOnly: true };
}

/** The instruction that stands in for a schema when the caller wants only JSON. */
export function jsonOnlyInstruction(schema) {
  const lines = [
    'Reply with one JSON value and nothing else.',
    'No prose before or after it, and no markdown code fence.',
  ];
  if (schema) {
    lines.push('', 'It must satisfy this JSON Schema:', JSON.stringify(schema));
  }
  return lines.join('\n');
}

/**
 * The first JSON value in a reply that was supposed to hold nothing else.
 *
 * Models fence their JSON, and reasoning models lead with a sentence about what
 * they are about to write. Both are recoverable, and the alternative is failing
 * a run over punctuation.
 */
export function extractJson(text) {
  const trimmed = (text ?? '').trim();
  if (!trimmed) return null;

  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  const candidates = [trimmed];
  if (fenced) candidates.unshift(fenced[1].trim());

  for (const candidate of candidates) {
    const parsed = tryParse(candidate);
    if (parsed !== undefined) return parsed;
    const carved = carve(candidate);
    if (carved !== undefined) return carved;
  }
  return null;
}

function tryParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * The JSON value embedded in a string that also holds prose.
 *
 * Anchoring on the first bracket in the reply is not enough: a model that opens
 * with "Here is the plan (see {details} below)" puts a brace in the prose, and
 * a span starting there parses as nothing. So each opening bracket gets a turn,
 * outermost first, and the first span that parses wins. Bounded to the first
 * few, because a reply with more than that is prose with punctuation in it
 * rather than JSON with a preamble.
 */
const MAX_CARVE_STARTS = 8;

function carve(text) {
  let from = 0;
  for (let attempt = 0; attempt < MAX_CARVE_STARTS; attempt++) {
    const open = text.slice(from).search(/[{[]/);
    if (open < 0) return undefined;
    const start = from + open;
    const closer = text[start] === '{' ? '}' : ']';
    const close = text.lastIndexOf(closer);
    if (close > start) {
      const parsed = tryParse(text.slice(start, close + 1));
      if (parsed !== undefined) return parsed;
    }
    from = start + 1;
  }
  return undefined;
}

// --- response bodies --------------------------------------------------------

export function completionId() {
  return `chatcmpl-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

export function chatCompletionBody({ id, created, model, content, usage, finishReason }) {
  return {
    id,
    object: 'chat.completion',
    created,
    model,
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content },
        logprobs: null,
        finish_reason: finishReason,
      },
    ],
    usage,
  };
}

export function chunkBody({ id, created, model, delta, finishReason = null, usage }) {
  const body = {
    id,
    object: 'chat.completion.chunk',
    created,
    model,
    choices: [{ index: 0, delta, logprobs: null, finish_reason: finishReason }],
  };
  if (usage) body.usage = usage;
  return body;
}

/** A usage-only trailer, which is what stream_options.include_usage asks for. */
export function usageChunkBody({ id, created, model, usage }) {
  return {
    id,
    object: 'chat.completion.chunk',
    created,
    model,
    choices: [],
    usage,
  };
}

/**
 * Claude's stop reason in OpenAI's vocabulary. Anything unfamiliar is reported
 * as "stop" rather than invented: a caller branching on this needs a value from
 * the enum more than it needs the detail.
 */
export function finishReasonFor(stopReason) {
  if (stopReason === 'max_tokens') return 'length';
  if (stopReason === 'tool_use') return 'tool_calls';
  return 'stop';
}
