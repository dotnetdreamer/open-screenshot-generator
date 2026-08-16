# The MCP relay

Lets Claude Code, Claude Desktop, Cursor or VS Code drive the **web** editor,
the same way they already drive the desktop app.

The desktop app hosts its own MCP server: Rust opens a socket on `127.0.0.1`
and passes each JSON-RPC request to the webview, which runs the design tools
against the live artboards. A browser tab cannot open a socket, so on the web
the two halves need somewhere to meet:

```
  Claude Code ──POST /mcp/<code>──►   relay   ──SSE /tab/<code>──►  editor tab
              ◄─────── JSON ────────         ◄── POST .../reply ───
```

That is all this container is. It holds no design state, parses no tool call,
and stores nothing on disk. Every one of the 42 tools still runs in the browser
tab, in exactly the code the desktop app runs.

## Turning it on

Deploy it (see the parent [README](../README.md)), then point the editor build at it:

```
NEXT_PUBLIC_MCP_RELAY_URL=https://mcp.openscrgen.app
```

Unset, the whole feature disappears from the web build: no pill, no dialog, no
connection. Same as `NEXT_PUBLIC_DISCOVER_URL`.

In the editor, click the **MCP** pill at the bottom right of the canvas and
press Connect. It shows a URL with a random code in it. Paste that into your
client:

```
claude mcp add --transport http open-screenshot-generator https://mcp.openscrgen.app/mcp/<code>
```

## The security model, in one paragraph

The code in the URL is the entire credential. The tab generates 128 random bits,
keeps them in `localStorage` so the URL survives a reload, and never sends them
anywhere but here. Someone who does not have a code can reach no tab, and codes
are not enumerable from this service. What a code grants is narrow by
construction: it drives one browser tab that is already open, doing only what
the person at that tab could do by clicking, and it stops working the moment
they disconnect or close the tab. There is no account, no token to rotate and
nothing stored to leak. If a code does get out, press Disconnect: the next
Connect mints a new one.

The relay itself holds no secret, which is why it needs no `.env` and why
restarting it costs nothing but a reconnect.

## Operating it

| | |
| --- | --- |
| Health | `curl https://mcp.openscrgen.app/healthz` → `{"ok":true,"tabs":N}` |
| Logs | `docker compose logs -f openscreengen-mcp-relay` |
| Restart | `docker compose restart openscreengen-mcp-relay` (drops every stream; tabs reconnect on their own) |
| State | None. It is safe to redeploy at any time |

Two knobs, both with sane defaults and neither normally set:
`MCP_CALL_TIMEOUT_MS` (190s) and `MCP_MAX_TABS` (500).

## Why SSE and not WebSocket

Server-sent events plus a POST for the reply is the same shape as a WebSocket
here, and it needs nothing that `node:` does not already ship. That is what
makes the image `FROM node` + `COPY`, with no dependency to audit and no
registry access during a build. The one thing it asks of the proxy is that the
stream is not buffered, which the Caddy block already handles
(`flush_interval -1`), exactly as PocketBase's own realtime route does.
