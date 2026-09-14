# claude-openai-endpoint

An OpenAI-compatible API on `127.0.0.1`, answered by the Claude subscription
this machine is already logged in to. No API key anywhere.

The editor's "Use my API key" tab will point at any endpoint that speaks
chat-completions. That is how it reaches MiniMax, or a local Ollama, and it is
how it reaches this. The difference is that there is no key to paste: the Claude
Code CLI signs each call with the OAuth login it keeps in the Keychain, so a Max
or Pro plan is the credential.

It exists so the AI design agent can be driven end to end without buying API
credit, which is what reproducing [issue #35](https://github.com/dotnetdreamer/open-screenshot-generator/issues/35)
needs.

## Setup

```sh
cd claude-openai-endpoint
npm install
npm start
```

`npm install` pulls `@anthropic-ai/claude-agent-sdk`, which ships the Claude
Code CLI as a platform binary. You do not need `claude` on your PATH, but you do
need to have logged in once, from Claude Code or the desktop app. Check with:

```sh
curl http://127.0.0.1:8787/healthz
```

## Pointing the editor at it

1. Run the editor (`npm run dev` in the repo root, or the desktop app).
2. Open the AI agent screen, then the "Use my API key" tab.
3. Provider: **OpenAI compatible (any endpoint)**. Service: **Other, I will
   paste the URL**.
4. Base URL: `http://127.0.0.1:8787/v1`
5. Leave the API key blank. The editor knows a loopback endpoint needs none.
6. Press **Load models**, or type a model id such as `claude-sonnet-5`.

The `/v1` is not optional. The editor appends `/models` and `/chat/completions`
itself, so a base URL without it asks for `http://127.0.0.1:8787/models`. This
server answers both spellings anyway, but every other endpoint you try will not.

## What it serves

| Route | What it does |
| --- | --- |
| `GET /v1/models` | The model ids in [src/models.js](src/models.js). Any id the CLI accepts works whether or not it is listed |
| `POST /v1/chat/completions` | Text, vision and JSON replies. `stream: true` is supported |
| `GET /healthz` | Is it up |

Environment: `PORT` (8787), `HOST` (127.0.0.1), `MAX_BODY` (32 MB), `ALLOW_ORIGINS`
(the browser origins allowed to call it, comma separated).

**Supported:** system and developer messages, multi-turn history, image parts as
`data:` URLs or `http(s)` URLs, `response_format` of `json_object` or
`json_schema`, `stream` with `stream_options.include_usage`.

**Not supported:** function and tool calling, which returns a 400 rather than
pretending. `temperature`, `top_p`, `max_tokens` and the other sampling knobs
are accepted and ignored, because the CLI exposes none of them.

### JSON replies

A `json_schema` request is handed to the CLI as a real structured-output
constraint, so the reply is validated against the schema before it comes back
rather than parsed hopefully afterwards. When the CLI cannot satisfy the schema,
the run is repeated once in prose with the schema written into the prompt and
the reply mined for JSON. That second path is the same contract by other means,
and it is why a design run rarely fails outright.

The `$schema` key the Vercel AI SDK stamps on every schema it emits is stripped
on the way through. It describes the dialect, not the data, and validators
reject unknown keywords at that position.

## Checking it

```sh
npm run check
```

This asks the server the way the editor asks: the Vercel AI SDK's
`generateObject` and `generateText`, over `@ai-sdk/openai`'s chat model, resolved
out of the repo's root `node_modules`. That client's response parser is the
strict one. It requires a numeric `choices[].index`, an `"assistant"` role if
any role is present, and numeric usage fields, and it turns a missing one into
"Invalid JSON response" with nothing pointing at the cause. Seven checks cover
the CORS preflight, the model list, text, vision, a nested `json_schema`,
streaming, and that a bad request is a 400.

Thirteen checks cover the CORS preflight, a refused origin, the desktop app's
origin, that no project memory reaches the model, the model list, text, vision,
a nested `json_schema`, streaming, streaming a JSON reply, an oversized body, a
`null` body, and that a bad request is a 400.

Point it at a server you are already running with
`ENDPOINT=http://127.0.0.1:8787/v1 npm run check`.

## Security

Anyone who can reach this port can spend the subscription behind it, and there
is no key to check, because not having one is the point. Two things stand in for
that key.

It binds to `127.0.0.1`, so nothing off this machine can connect. `HOST` will
move it, and the server says so loudly at startup when you do. Do not put it
behind a tunnel.

Browser requests have to come from a named origin: the dev server on port 9002,
`editor.openscrgen.app`, and the two the desktop app uses. Everything else gets
a 403 with no CORS headers. That second check is the one that matters, because
loopback alone protects nothing here: any page you have open in another tab is
already running on this machine and can POST to `127.0.0.1`. Set `ALLOW_ORIGINS`
to name different origins, or to `*` to turn the check off on purpose.

Tools are off, so the CLI cannot read a file, run a command or reach the web.
Your `settings.json` and `CLAUDE.md` are not loaded either.

Runs happen in an empty scratch directory rather than wherever you started the
server. The CLI writes an environment preamble into every turn holding the
working directory and the auto-memory kept for it, so started from a checkout it
would send your private notes about that project along with a request to write
three headlines. `settingSources: []` does not cover this and
`excludeDynamicSections` only works with the preset system prompt. What still
reaches the model is your platform, the date and your account's email address,
which the CLI supplies with no way to withhold. None of it leaves your own
Claude account, but it is worth knowing it is there.

The server deletes `ANTHROPIC_API_KEY` and its relatives from the environment it
hands the CLI. One of those set is enough to move the bill quietly from your
plan to API credit, and in non-interactive mode the CLI takes the key without
asking. If a key still reaches it, the first run prints a warning naming the
source.

## Reaching it from the browser

A named origin gets CORS headers on every response, not only the preflight,
because the web build calls the endpoint straight from the page. `user-agent` is
in the allow list on purpose: the Vercel AI SDK sets one on every request,
Chromium drops it as a forbidden header and WebKit sends it, so leaving it out
works in Chrome and fails in Safari complaining about a header nobody wrote. A
request with no `Origin` at all is not a browser and is never blocked, which is
what keeps `curl` working.

Two things this cannot fix:

- **Safari cannot reach a local http server from an https page.** WebKit does
  not implement the loopback exemption to mixed content, so
  `https://editor.openscrgen.app` fetching `http://127.0.0.1:8787` fails with
  "Load failed" no matter what headers come back. Chrome, Edge and Firefox do
  allow it. Use `http://localhost:9002` or the desktop app instead.
- On desktop the editor routes these calls through `tauri-plugin-http`, where
  CORS does not apply at all. `src-tauri/capabilities/default.json` already
  allows `http://127.0.0.1:*`, so no capability edit is needed for any port.

## Speed and cost

A run spawns a CLI process, so expect two to four seconds of overhead on top of
the model's own time. Nothing is pooled or kept warm. A full design run against
the template catalog takes roughly twenty to forty seconds, most of it the model
reading the catalog.

Calls come out of your plan's usage. The server logs the token count of each
run, and `total_cost_usd` from the CLI is what a metered API would have charged
for the same call, not what your plan is billed.
