# The MCP relay, and the signalling server

One container, two jobs that have nothing to do with each other beyond being
small, stateless and needing a public address:

- **the MCP relay**, which lets an AI client drive the web editor
- **signalling for live editing**, which introduces two browsers to each other
  and then gets out of the way

Both are described below. Neither holds a credential, writes to disk, or is on
the editing path: with this container stopped, the editor works exactly as it
does today, minus those two features.

## The MCP relay

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

### Turning it on

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

### The security model, in one paragraph

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

### Operating it

| | |
| --- | --- |
| Health | `curl https://mcp.openscrgen.app/healthz` → `{"ok":true,"tabs":N,"collab":{...}}` |
| Logs | `docker compose logs -f openscreengen-mcp-relay` |
| Restart | `docker compose restart openscreengen-mcp-relay` (drops every stream; tabs reconnect on their own) |
| State | None. It is safe to redeploy at any time |

Two knobs, both with sane defaults and neither normally set:
`MCP_CALL_TIMEOUT_MS` (190s) and `MCP_MAX_TABS` (500).

### Why SSE and not WebSocket

Server-sent events plus a POST for the reply is the same shape as a WebSocket
here, and it needs nothing that `node:` does not already ship. That is what
makes the image `FROM node` + `COPY`, with no dependency to audit and no
registry access during a build. The one thing it asks of the proxy is that the
stream is not buffered, which the Caddy block already handles
(`flush_interval -1`), exactly as PocketBase's own realtime route does.

---

## Live editing: the signalling server

Two people editing one project talk **to each other**. The document is a Yjs
CRDT replicated over WebRTC data channels, so once a session is up, no design
data passes through this box or any other. What two browsers cannot do on their
own is find each other, and that introduction is all this endpoint is:

```
  browser A ──ws /collab──►  signalling  ◄──ws /collab── browser B
       └────────────── WebRTC data channel ─────────────┘
                    (the document, and the cursors)
```

### What it can and cannot see

| | |
| --- | --- |
| Sees | a room id, which is `sha256(share slug : room key)`, and opaque bytes |
| Never sees | the room key, the project, who owns it, or anything a peer types |

The key that names the room lives in the **fragment** of the invite link
(`…/?collab=<slug>#k=<key>`), and a fragment is never sent in an HTTP request.
y-webrtc derives its cipher from it, so the offers and answers passing through
here are already encrypted when they arrive.

### Sign-in is required, and this is where it is enforced

A session needs an account, which the browser cannot be trusted to check on its
own. So:

1. the editor POSTs `/collab/ticket` with its PocketBase token
2. this container asks the database `GET /api/openscreengen/collab/whoami`, which
   is the one route [070_collab.pb.js](../pb-hooks/070_collab.pb.js) adds
3. a valid answer mints a **single use ticket** that expires in a minute
4. the socket is opened as `wss://…/collab?t=<ticket>`, and the ticket is burned
   on the way in

The ticket rather than the token goes in the URL because a URL ends up in proxy
logs and browser history, so whatever is in it has to be worthless a minute
later.

`POCKETBASE_URL` is what switches this on. **Unset, the check is skipped and
anybody may signal**, which is correct on a laptop and wrong on the internet.
The compose file sets it.

### The protocol, and why the WebSocket is hand rolled

The protocol is y-webrtc's, exactly, so the client is the stock library rather
than a fork: `subscribe`, `unsubscribe`, `publish` and `ping`, with a publish
copied to everybody subscribed to that topic. A socket may only publish to a
topic it has subscribed to, which is the one rule added here.

The WebSocket itself is ~150 lines of RFC 6455 in
[src/collab.js](src/collab.js) rather than the `ws` package, for the same
reason the relay above uses SSE: this image is `FROM node` plus a `COPY`, with
no install step, no lockfile and no registry access during a build. Small JSON
frames are the easy half of that spec.

### Operating it

| | |
| --- | --- |
| In use now | `curl https://mcp.openscrgen.app/healthz` → `collab: {rooms, sockets, auth}` |
| Auth off | `collab.auth` is `false`, meaning `POCKETBASE_URL` is unset |
| Restart | Drops every session. Editors reconnect on their own, and nobody loses work: every peer holds the whole document |

Caps, all far above real use and none normally changed: 64 sockets to a room,
5000 rooms, 512KB a message.

### What the operator still has to provide

- **TURN**, for the pairs whose networks refuse a direct connection. The editor
  fetches expiring credentials from `NEXT_PUBLIC_TURN_ENDPOINT`; any endpoint
  that mints them from a coturn shared secret will do, and unset means STUN only
  (which still connects most pairs).
- **Nothing else.** There is no new hostname, no new certificate and no Caddy
  change: `wss://` upgrades on the existing block, because Caddy proxies a
  WebSocket upgrade without being asked to.
