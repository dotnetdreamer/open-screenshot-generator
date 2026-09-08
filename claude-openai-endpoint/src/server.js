// An OpenAI-compatible endpoint on this machine, answered by the Claude
// subscription this machine is already logged in to.
//
// Open Screenshot Generator's "Use my API key" tab will point at any endpoint
// that speaks chat-completions. That is how you reach MiniMax or a local Ollama
// and it is how you reach this, except that there is no key: the Claude Code
// CLI signs the call with the OAuth login in the Keychain, so a Max or Pro plan
// is the credential and nothing here ever sees a token.
//
//     editor ──POST /v1/chat/completions──►  this  ──stdio──►  claude ──►  API
//            ◄──── chat.completion ────────       ◄───────────
//
// Two routes and a health check, which is all the editor's agent uses:
//
//     GET  /v1/models             what to offer in the model picker
//     POST /v1/chat/completions   text, vision and json_schema replies
//     GET  /healthz               is it up
//
// Anyone who can reach this port can spend the subscription behind it, and
// there is no key to check, because not having one is the point. Two things
// stand in for that key. It binds to 127.0.0.1 unless HOST says otherwise, so
// nothing off this machine can connect; and a browser request has to come from
// one of the named origins below, so a page the user has open in another tab
// cannot quietly drive it either. Do not put it behind a tunnel.
//
// This is a development tool. It exists so the design agent can be exercised
// end to end without an API key, which is what issue #35 needs to reproduce.

import http from 'node:http';
import { ClaudeError, runClaude } from './claude.js';
import { DEFAULT_MODEL, modelListBody } from './models.js';
import {
  RequestError,
  chatCompletionBody,
  chunkBody,
  completionId,
  extractJson,
  finishReasonFor,
  jsonOnlyInstruction,
  replyFormat,
  toClaudeTurn,
  usageChunkBody,
} from './translate.js';

const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '127.0.0.1';

// Three 1024px screenshots as base64 JPEG plus the template catalog is around
// 1 MB. The ceiling is generous rather than tight because the failure it
// produces, a 413 with no body, reads like a network fault from the browser.
const MAX_BODY = Number(process.env.MAX_BODY || 32 * 1024 * 1024);

/**
 * Which web pages may call this.
 *
 * Answering every origin with `*` is the usual shortcut for a local server, and
 * it is wrong here because there is no key to stop anyone. A page on any site
 * the user has open can POST to 127.0.0.1, and `*` waves the preflight through:
 * a stranger's tab spending the subscription, reading the replies, and leaving
 * nothing behind to notice it by. Binding to loopback does not help, because
 * the browser making the request is already on this machine.
 *
 * So the editor's own origins are named instead. `tauri://localhost` is the
 * desktop app on macOS and Linux, `http://tauri.localhost` the same on Windows.
 * ALLOW_ORIGINS replaces the list (comma separated), and `*` in it goes back to
 * answering everyone, deliberately. A request carrying no Origin at all is not
 * a browser and is never blocked, which is what keeps curl working.
 */
const DEFAULT_ORIGINS = [
  'http://localhost:9002',
  'http://127.0.0.1:9002',
  'https://editor.openscrgen.app',
  'tauri://localhost',
  'http://tauri.localhost',
];

const CONFIGURED = (process.env.ALLOW_ORIGINS || '')
  .split(',')
  .map((entry) => entry.trim())
  .filter(Boolean);

const ORIGINS = CONFIGURED.length ? CONFIGURED : DEFAULT_ORIGINS;
const ANY_ORIGIN = ORIGINS.includes('*');

/**
 * The CORS headers for one request, or null when that page may not call us.
 *
 * user-agent has to be in the allow list even though it looks like a header no
 * caller would set. The Vercel AI SDK sets one on every request; Chromium drops
 * it as a forbidden header, WebKit sends it. Leave it out and this works in
 * Chrome and fails in Safari with a message about a header nobody wrote.
 */
function corsFor(req) {
  const origin = req.headers.origin;
  if (!origin) return {};
  if (!ANY_ORIGIN && !ORIGINS.includes(origin)) return null;
  return {
    'Access-Control-Allow-Origin': ANY_ORIGIN ? '*' : origin,
    // The answer depends on the Origin, so a cache keyed on the URL alone would
    // hand one site's verdict to another.
    Vary: 'Origin',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, user-agent',
    'Access-Control-Max-Age': '600',
    // Chrome shelved the preflight that reads this, and its replacement asks the
    // user instead. Free insurance for the browsers still on the old rule.
    'Access-Control-Allow-Private-Network': 'true',
  };
}

// Set once per request and echoed on every response, not just the preflight. A
// server that decorates only its OPTIONS handler passes the preflight and then
// fails the real request with an opaque "Failed to fetch".
function send(res, status, body, extraHeaders = {}) {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    ...(res.corsHeaders ?? {}),
    ...extraHeaders,
  });
  res.end(payload);
}

function sendError(res, status, message, code) {
  log(`${status} ${message}`);
  send(res, status, { error: { message, type: errorType(status), code: code || null } });
}

function errorType(status) {
  if (status === 401 || status === 403) return 'authentication_error';
  if (status === 404) return 'invalid_request_error';
  if (status === 429) return 'rate_limit_error';
  return status >= 500 ? 'api_error' : 'invalid_request_error';
}

function log(line) {
  process.stdout.write(`[claude-endpoint] ${line}\n`);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        // Paused, not destroyed. Destroying here tears the socket down in the
        // same tick, before the 413 the caller is about to write can leave, and
        // the client sees a reset connection instead of a status. The caller
        // destroys it once the response is out.
        req.pause();
        reject(new RequestError(`Request body is over ${Math.round(MAX_BODY / 1024 / 1024)} MB.`, 413));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/**
 * The path with an optional /v1 removed.
 *
 * Pasting the base URL without its /v1 is the one input that silently produces
 * the wrong paths (the editor appends /models and /chat/completions itself), so
 * both spellings are served and neither is a 404 nobody can explain.
 */
function route(url) {
  const path = (url || '/').split('?')[0].replace(/\/+$/, '') || '/';
  return path.startsWith('/v1/') ? path.slice(3) : path;
}

const server = http.createServer(async (req, res) => {
  const cors = corsFor(req);
  if (cors === null) {
    // Named origins only, and this is not one. Answered without any
    // Access-Control header, which is what makes the browser block it.
    log(`refused origin ${req.headers.origin}`);
    res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: { message: 'This origin is not allowed.', type: 'invalid_request_error' } }));
    return;
  }
  // Stashed rather than passed down, because every writer below is several
  // calls away from the request that decided them.
  res.corsHeaders = cors;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors);
    res.end();
    return;
  }

  const path = route(req.url);

  if (req.method === 'GET' && (path === '/healthz' || path === '/')) {
    send(res, 200, { status: 'ok', endpoint: `http://${HOST}:${PORT}/v1` });
    return;
  }

  if (req.method === 'GET' && path === '/models') {
    send(res, 200, modelListBody());
    return;
  }

  if (req.method === 'POST' && path === '/chat/completions') {
    // Awaited inside a listener nobody awaits in turn, so anything that escapes
    // handleCompletion is an unhandled rejection, and an unhandled rejection
    // ends the process. One bad request must not take every other run with it.
    try {
      await handleCompletion(req, res);
    } catch (error) {
      log(`unhandled: ${messageOf(error)}`);
      if (!res.headersSent) sendError(res, 500, messageOf(error));
      else res.end();
    }
    return;
  }

  sendError(res, 404, `No route for ${req.method} ${req.url}. Try GET /v1/models.`);
});

async function handleCompletion(req, res) {
  const started = Date.now();
  const controller = new AbortController();
  // A browser that navigates away mid-run should take the CLI with it, or a
  // cancelled design keeps spending the subscription for another minute.
  res.on('close', () => {
    if (!res.writableEnded) controller.abort();
  });

  let request;
  try {
    const raw = await readBody(req);
    request = JSON.parse(raw || '{}');
  } catch (error) {
    const status = error instanceof RequestError ? error.status : 400;
    sendError(res, status, error instanceof RequestError ? error.message : 'The request body was not JSON.');
    // Nothing read the rest of an oversized body, so the socket has to go once
    // the response is out or the client waits on a request nobody is draining.
    if (status === 413) res.on('finish', () => req.destroy());
    return;
  }

  // `null`, `[]` and `"hi"` are all valid JSON, and every one of them would
  // reach the property reads below. A bare `null` used to take the whole
  // process down: the TypeError is not a RequestError, so it was rethrown into
  // an async listener nobody awaits, which Node treats as fatal.
  if (!request || typeof request !== 'object' || Array.isArray(request)) {
    sendError(res, 400, 'The request body must be a JSON object.');
    return;
  }

  let turn;
  let format;
  try {
    if (Array.isArray(request.tools) && request.tools.length > 0) {
      throw new RequestError('Function calling is not implemented by this endpoint.');
    }
    turn = toClaudeTurn(request.messages);
    format = replyFormat(request.response_format);
  } catch (error) {
    if (error instanceof RequestError) {
      sendError(res, error.status, error.message, error.code);
      return;
    }
    throw error;
  }

  const model = typeof request.model === 'string' && request.model.trim() ? request.model.trim() : DEFAULT_MODEL;
  const streaming = request.stream === true;
  const images = turn.content.filter((block) => block.type === 'image').length;
  log(
    `POST /v1/chat/completions model=${model}${format.schema ? ' schema' : format.jsonOnly ? ' json' : ''}` +
      `${images ? ` images=${images}` : ''}${streaming ? ' stream' : ''}`
  );

  try {
    const run = streaming
      ? await streamRun({ res, request, turn, format, model, controller })
      : await plainRun({ res, turn, format, model, controller });

    log(`done in ${Math.round((Date.now() - started) / 1000)}s, ${run.usage.total_tokens} tokens`);
  } catch (error) {
    // The client is gone. The SDK rejects the message iterator with its own
    // AbortError rather than anything this code threw, so the signal is the
    // only reliable way to tell a cancelled run from a failed one. Writing a
    // status to a closed socket would only put a misleading 500 in the log.
    if (controller.signal.aborted) {
      log('client went away, run cancelled');
      res.destroy();
      return;
    }
    if (res.headersSent) {
      // Mid-stream. There is no status left to set, so the failure goes down
      // the wire as a chunk the client can read before [DONE] never arrives.
      res.end(`data: ${JSON.stringify({ error: { message: messageOf(error) } })}\n\n`);
      return;
    }
    const status = error instanceof ClaudeError || error instanceof RequestError ? error.status : 500;
    sendError(res, status, messageOf(error), error?.code);
  }
}

/** The whole answer at once, which is what the design agent asks for. */
async function plainRun({ res, turn, format, model, controller }) {
  const run = await withJson({ turn, format, model, controller });
  // An empty reply has to be an error. `choices: []` would parse and then die a
  // line later inside the Vercel AI SDK as a bare TypeError, which the editor
  // reports to the user as an ad blocker or a dead connection.
  if (!run.body || !run.body.trim()) {
    throw new ClaudeError('Claude replied with nothing.', 502, 'empty_reply');
  }
  send(
    res,
    200,
    chatCompletionBody({
      id: completionId(),
      created: Math.floor(Date.now() / 1000),
      model: run.model || model,
      content: run.body,
      usage: run.usage,
      finishReason: finishReasonFor(run.stopReason),
    })
  );
  return run;
}

async function streamRun({ res, request, turn, format, model, controller }) {
  const id = completionId();
  const created = Math.floor(Date.now() / 1000);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    ...(res.corsHeaders ?? {}),
  });
  // Nothing is buffered ahead of the first token: an idle proxy or a browser
  // waiting on a full chunk would otherwise hold the whole stream.
  res.flushHeaders?.();

  const write = (body) => res.write(`data: ${JSON.stringify(body)}\n\n`);
  write(chunkBody({ id, created, model, delta: { role: 'assistant', content: '' } }));

  // A JSON reply cannot be streamed token by token: with a schema the CLI is
  // still validating the value, and without one the reply has to be mined for
  // JSON once it is whole. It goes out as a single content chunk instead. That
  // is a legal stream, and the client's event-source parser needs one either
  // way. Answering it with a plain JSON body, which is what this used to do,
  // dispatches no events at all and the caller ends up with empty text and no
  // error naming the cause.
  const run = format.jsonOnly
    ? await withJson({ turn, format, model, controller })
    : await runClaude({
        model,
        system: turn.system,
        content: turn.content,
        signal: controller.signal,
        onText: (piece) => write(chunkBody({ id, created, model, delta: { content: piece } })),
      });

  if (format.jsonOnly && run.body) {
    write(chunkBody({ id, created, model, delta: { content: run.body } }));
  }

  write(chunkBody({ id, created, model, delta: {}, finishReason: finishReasonFor(run.stopReason) }));
  if (request.stream_options?.include_usage) {
    write(usageChunkBody({ id, created, model, usage: run.usage }));
  }
  res.write('data: [DONE]\n\n');
  res.end();
  return run;
}

/**
 * A run, plus the two things that make a JSON reply come out as JSON.
 *
 * With a schema the CLI validates the answer itself and hands back a parsed
 * object. When it cannot, the run is repeated in prose with the schema spelled
 * out in the prompt and the reply mined for JSON, which is the same contract by
 * other means and usually succeeds. Without a schema, `json_object` gets that
 * prose path directly.
 */
async function withJson({ turn, format, model, controller }) {
  if (!format.jsonOnly) {
    return finish(
      await runClaude({
        model,
        system: turn.system,
        content: turn.content,
        signal: controller.signal,
      }),
      null
    );
  }

  if (format.schema) {
    try {
      const run = await runClaude({
        model,
        system: turn.system,
        content: turn.content,
        schema: format.schema,
        signal: controller.signal,
      });
      if (run.object !== null && run.object !== undefined) {
        return finish(run, JSON.stringify(run.object));
      }
      log('the schema run returned no object; asking again in prose');
    } catch (error) {
      if (!(error instanceof ClaudeError) || error.status !== 400) throw error;
      log(`schema run failed (${error.message}); asking again in prose`);
    }
  }

  const run = await runClaude({
    model,
    system: [turn.system, jsonOnlyInstruction(format.schema)].filter(Boolean).join('\n\n'),
    content: turn.content,
    signal: controller.signal,
  });
  const parsed = extractJson(run.text);
  if (parsed === null) {
    throw new ClaudeError('Claude did not reply with JSON.', 502, 'not_json');
  }
  return finish(run, JSON.stringify(parsed));
}

function finish(run, content) {
  return { ...run, body: content ?? run.text };
}

function messageOf(error) {
  if (error instanceof Error) return error.message;
  // The SDK rejects with the serialized error on some paths, so a plain string
  // arrives where an Error was expected and .message reads as undefined.
  return typeof error === 'string' && error ? error : 'Something went wrong.';
}

// These bound how long the REQUEST takes to arrive, never how long the handler
// takes to answer, so a design run that thinks for two minutes was never at
// risk from them and zeroing them bought nothing. What zeroing them did cost is
// the only thing that reaps a client which sends headers and then goes quiet:
// readBody's promise never settles, the handler awaits it forever, and the
// socket is held for the life of the process. Generous, not absent.
server.requestTimeout = 10 * 60 * 1000;
server.headersTimeout = 60_000;
server.keepAliveTimeout = 120_000;

server.listen(PORT, HOST, () => {
  log(`listening on http://${HOST}:${PORT}`);
  log(`paste this into the editor: http://${HOST}:${PORT}/v1`);
  if (ANY_ORIGIN) log('warning: ALLOW_ORIGINS is "*", so any web page you visit can spend the subscription');
  // HOST exists for the odd case of a VM or a second machine, but the default
  // is loopback for a reason and leaving it is not a quiet choice.
  if (!/^(127\.|localhost$|::1$|\[::1\]$)/.test(HOST)) {
    log(`warning: bound to ${HOST}, not loopback. Anyone who can reach this port can spend the subscription`);
  }
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    log('shutting down');
    server.close(() => process.exit(0));
    // A stream in flight would otherwise hold the process open indefinitely.
    setTimeout(() => process.exit(0), 2_000).unref();
  });
}
