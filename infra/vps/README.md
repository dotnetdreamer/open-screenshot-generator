# The community backend

One PocketBase, two jobs:

- the **Discover** feed — the posts people share, their comments, and the likes,
  saves and follows on them
- **cloud projects** — the editable document itself, owned by one account,
  private by default, and shareable by link

They share a box and an account and nothing else. A post is finished PNGs that
everybody can see; a cloud project is somebody's working file. Each has its own
settings switch, so a box can host either without the other.

Alongside them, one much smaller thing that shares the box and nothing else: the
[MCP relay](mcp-relay/README.md), which lets an AI client drive the editor in a
browser. It has no database, no disk and no credential, and the services never
talk to each other. Everything below is about PocketBase unless it says
otherwise.

**The editor does not need this box.** Templates, elements, fonts, the AI agent,
translation and every export run in the browser, and the working copy of a
project is always the one in IndexedDB — cloud projects are a copy, never the
source of truth. With `NEXT_PUBLIC_DISCOVER_URL` unset the app builds and runs
exactly as before, minus one dialog and three menu items: no rail button, no
Community tab, no Save to cloud. Bring-your-own-storage (Drive, gists) is
untouched by any of it and remains the option for anybody who would rather we
held nothing. That is the design, not a fallback. `NEXT_PUBLIC_MCP_RELAY_URL` is
the same kind of switch for the relay.

This stack is designed to **share a VPS with another project's**, using that
stack's Caddy rather than starting a second one:

```
                    internet
                       │
                   :80 :443
                       ▼
              ┌─────────────────┐
              │  shared caddy   │  already there. One TLS terminator, one cert store
              └───┬─────────┬───┘
        edge net  │         │  edge net   ← openscreengen-pocketbase joins this
                  ▼         ▼
      ┌──────────────────┐ ┌──────────────────┐
      │ neighbour's PB   │ │  openscreengen-pocketbase  │
      │ (another repo)   │ │  pb.openscrgen   │
      └────────┬─────────┘ └────────┬─────────┘
               │                    │
       their pb-data          /opt/openscreengen/pb-data   ← separate databases, always
```

**Two PocketBases, one Caddy.** Sharing the TLS terminator is right; sharing the
database is not. The `settings` collection is keyed by a unique `key` and both
projects want the same words to mean different things, so one instance would mean
one `enabled` row for both.

It also runs perfectly well on a box of its own — see
[Running it locally](#running-it-locally) and the `own-caddy` profile.

> **The neighbour is a private repo, and this one is public.** So this file names
> no hostname, host path, network name or address belonging to it: they appear
> here as `<neighbour ...>` placeholders, and the real values are in that
> project's own deploy notes. The operational lessons below are general and are
> worth keeping; the identifiers are not this repo's to publish.

## THIS REPOSITORY IS PUBLIC

Everything below is written for that. It is the one constraint that shapes the
whole design, so it is worth being explicit about what it rules out:

| Never in this repo | Where it lives instead |
| --- | --- |
| The PocketBase superuser email **and** password | `/opt/openscreengen/.pb-superuser` on the box, chmod 600. Both halves: the address is what the password guards, and the dashboard URL is in this file. `.pb-superuser` is gitignored as a backstop |
| The SSH key for the VPS | Outside this repo entirely. See [Deploying](#deploying) |
| Google / GitHub OAuth client **secrets** | Not needed at all — see [Sign-in](#sign-in) |
| A Caddy `basic_auth` bcrypt hash | On the box, in the Caddyfile there |
| `pb-data/` | The box. It is gitignored, and it is the one thing here that cannot be recreated |

The neighbouring stack keeps its superuser password in its own README, which is
correct *there* because that repository is private. Copying that habit here would
publish the database.

**What IS public and meant to be:** `NEXT_PUBLIC_DISCOVER_URL`, the OAuth client
**ids**, and every route in `pb-hooks/`. None of them is a credential. Reading the
feed needs no credential at all, and writing needs a session the server mints
after checking a token with Google or GitHub directly.

## The security model, in one page

**Every collection is locked in every direction.** Not "tight rules" —
`listRule`, `viewRule`, `createRule`, `updateRule` and `deleteRule` are all
`null` on all ten collections, which PocketBase reads as superuser-only. Prove
it at any time:

```bash
for c in users posts comments post_likes post_saves comment_likes follows settings \
         cloud_projects cloud_project_assets; do
  printf '%-22s ' "$c"
  curl -s -o /dev/null -w '%{http_code}\n' https://pb.openscrgen.app/api/collections/$c/records
done   # 403, ten times
```

So every read and every write goes through an explicit route in `pb-hooks/`, and
each route names the exact fields it returns. That is what keeps `email`,
`google_sub`, `github_id` and `banned` off the wire: not a rule that has to stay
correct as fields are added, but a serializer that lists seven fields and cannot
accidentally grow an eighth.

`users.authRule` is null too, which shuts every built-in auth endpoint —
`auth-with-password`, `auth-with-oauth2`, `auth-refresh`, the OTP flow and the
password-reset mail. None of them is part of this design and each one left open
is a login form on the public internet.

**Feed images are the deliberate exception.** PocketBase serves a record's files
at `/api/files/<collection>/<id>/<file>` regardless of the collection's rules
(verified against 0.39.9, not assumed). That is exactly what the feed wants: the
record API answers 403 to the world while the posted screenshots load in an
`<img>` for a signed-out visitor. Every image in the feed is public by intention.

**A cloud project is the opposite, and that took one more step.** Somebody's
unfinished work must not be reachable by URL, and an unguessable URL is not a
permission: it survives a revoked share link, which is exactly the case that has
to work. So both file fields on `cloud_projects` and `cloud_project_assets` are
`protected: true`. PocketBase then demands a file token, and a file token is only
honoured if its auth record satisfies the collection's View rule — which is
`null` here as it is everywhere else. Nothing but a superuser gets a byte through
the built-in route:

```bash
# a real stored file path, from the dashboard. 403, not 200
curl -s -o /dev/null -w '%{http_code}\n' \
  https://pb.openscrgen.app/api/files/cloud_projects/<id>/<file>
```

Every read instead goes through `pb-hooks/060_projects.pb.js`, which checks the
owner or the share slug and streams the file itself, always as
`application/octet-stream` with `nosniff` and an attachment disposition. That
last part is why those file fields carry no mime allowlist: font sniffing is
inconsistent enough that a list would reject real files, and nothing uploaded
there can be served as a document on this origin anyway.

**Guests read the feed, accounts write.** The four feed read routes work with no
`Authorization` header and answer with fewer fields. Every write route refuses
without a token. The editor disabling those buttons is courtesy — the permission
is here.

Two exceptions, both deliberate:

- `POST /posts/:id/remix` is open. It counts somebody opening a design as a
  starting point, that is the commonest thing a signed-out visitor does, and
  requiring a sign-in would make the number measure sign-ins.
- `GET /shared/:slug` and its two children are open. That is the share link, and
  a link that needed an account would not be one. Nothing else about cloud
  projects is reachable signed out: there is no anonymous save, no anonymous
  listing, and every other route checks the row's `owner` against the token.

### Sign-in

Two doors, and **neither needs a secret on this box**:

```
POST /api/openscreengen/auth/google   { accessToken }   ->  { token, record }
POST /api/openscreengen/auth/github   { accessToken }   ->  { token, record }
```

The editor already signs people in to Google or GitHub for "save to your own
storage". These routes take the access token it is already holding, ask the
provider who it belongs to, and mint a PocketBase token. No second password, no
mailbox for this box to send to, no reset flow.

**Neither route reads an identity the client claimed.** A `sub`, a `login` or an
`id` in the body is never accepted. And asking "who is this" is not enough on its
own — a token minted for *somebody else's* app answers that correctly too — so
each route also proves the token was issued to **this** app:

- **Google**: `tokeninfo` returns `aud`, the client id the token was minted for.
  It must be in `google_client_ids`.
- **GitHub**: no tokeninfo, but GitHub stamps `X-OAuth-Client-Id` on its own API
  responses. That header is written by GitHub, not the caller, and must be in
  `github_client_ids`.

A GitHub **personal access token** carries no client id, so it only ever proves
"somebody holds a GitHub token". Supported, because the editor offers a pasted
token when its sign-in Worker is not configured, but behind `github_allow_pat`
which defaults to off.

Both allowlists start empty and an empty one answers **503**, not "allow
everything": a box that has not been told which app it belongs to must not mint
accounts for whoever asks first.

### Cloud projects

Eleven routes in [`pb-hooks/060_projects.pb.js`](pb-hooks/060_projects.pb.js).
Eight need a bearer token and then check the row's `owner` against it; three take
a share slug and no token.

```
GET    /api/openscreengen/projects                        auth    the account's projects
POST   /api/openscreengen/projects                        auth    save (multipart)
GET    /api/openscreengen/projects/:id                    auth    one, with its asset index
DELETE /api/openscreengen/projects/:id                    auth    delete it and its blobs
PUT    /api/openscreengen/projects/:id/share              auth    turn the link on or off
GET    /api/openscreengen/projects/:id/doc                auth    stream project.json
POST   /api/openscreengen/projects/:id/assets             auth    upload one blob (multipart)
GET    /api/openscreengen/projects/:id/assets/:assetId    auth    stream one blob
GET    /api/openscreengen/shared/:slug                    public  a link-shared project
GET    /api/openscreengen/shared/:slug/doc                public  its document
GET    /api/openscreengen/shared/:slug/assets/:assetId    public  one of its blobs
```

**A row that belongs to somebody else answers 404, not 403.** Probing ids must
not report which of them exist, the same choice `deletePost` already makes.

**Saving is two phases**, and the split is what stops a re-save re-uploading a
90MB recording. `POST /projects` carries only the document plus the list of asset
ids the finished project needs; it answers with the ids this box does not have,
and the client uploads those one request each. The cost is a window in which the
stored project references blobs that have not arrived — a load during it restores
those elements blank, exactly as Drive does when a blob upload fails, and the
repair is to save again.

**The slug is the whole credential** for a link read, so it is never logged,
never returned to anyone but the owner, and regenerated every time sharing is
switched on. `visibility` is checked on every request rather than baked into the
slug, so revoking takes effect immediately.

### The anti-flood limits

All settings rows, all changeable without a deploy: `max_posts_per_day` (10),
`max_comments_per_hour` (30), `max_images_per_post` (6), `max_image_bytes` (4MB),
`feed_max_page_size` (48). The publish route also carries a 28MB body limit, so a
client cannot stream PocketBase's 32MB default at it before the per-file checks
run.

Cloud projects have their own four, because what they bound is disk rather than
noise: `max_cloud_projects` (30 per account), `max_cloud_doc_bytes` (12MB per
document, and the editor gzips it first), `max_cloud_asset_bytes` (96MB per
recording), `max_cloud_project_bytes` (256MB per project) and
`max_cloud_user_bytes` (1GB per account). The two byte totals are summed from the
asset rows on every upload rather than kept as a column, so a delete that half
failed cannot leave somebody permanently over their limit — and unlike the
anti-flood counters, a failed sum **refuses** the upload rather than allowing it.

There is deliberately **no** rate limit on re-saving. A save replaces rather than
creates, so the ceilings above bound what a busy account can occupy but not how
often it rewrites it. If that ever matters, `cloud_projects_enabled` is the
switch, and the per-account byte cap is the thing to lower first.

---

## First run

You need the neighbouring stack already running on the box, one DNS record, and
about twenty minutes.

**1. DNS.** One record on the `openscrgen.app` zone:

| Type | Name | Value | TTL |
| --- | --- | --- | --- |
| A | `pb` | `<BOX_IP>` | 60 |

That zone runs on **Vercel's** nameservers (`ns1.vercel-dns.com`), which serve A
records directly and have no proxy toggle — so unlike a Cloudflare zone there is
no orange/grey cloud to get wrong, and nothing to disable.

**It has to be an explicit record, because the zone carries a wildcard.**
`anything.openscrgen.app` answers with Vercel's edge today. Without an explicit
`pb`, the wildcard answers, the HTTP-01 challenge arrives at Vercel rather than
at this box, and no certificate is ever issued — Caddy just retries on a backoff
forever. An explicit record beats a wildcard, so this needs no change to the
wildcard, to `editor` (a CNAME to GitHub Pages) or to the site.

**CAA has to authorize Let's Encrypt**, which is what Caddy issues from. CAA is
inherited down the tree, so an apex record covers `pb`. This zone already has
`letsencrypt.org`, `pki.goog` and `sectigo.com` — the third also covers Caddy's
ZeroSSL fallback, since ZeroSSL certificates are issued by Sectigo. Had the list
held `pki.goog` alone, issuance would have failed with an error that never
mentions DNS.

```bash
dig +short pb.openscrgen.app        # <BOX_IP>, not a Vercel 64.29.x / 216.198.x
dig +short CAA openscrgen.app       # must include issue "letsencrypt.org"
```

> **If the DNS panel refuses the value** with `should match format "ipv4"` on an
> address that is plainly valid, it is a stray character from the paste — a
> trailing space, or a non-breaking space picked up from copying out of rendered
> markdown. Clear the field and type the address by hand.

**2. Firewall.** Nothing to change. The shared Caddy already holds 80 and 443,
and this stack publishes no port at all.

**3. Copy this directory to the box** as `/opt/openscreengen` (see [Deploying](#deploying)
for the command).

**4. Confirm the network name.**

```bash
docker network ls | grep default     # expect <neighbour>_default
```

If it is called something else, put `OPENSCREENGEN_EDGE_NETWORK=that_name` in
`/opt/openscreengen/.env`.

**5. Up.** Both `-f` flags, every time.

```bash
cd /opt/openscreengen
docker compose -f docker-compose.yml -f docker-compose.shared-caddy.yml up -d --build
docker compose -f docker-compose.yml -f docker-compose.shared-caddy.yml logs -f openscreengen-pocketbase
```

The two files in `pb-migrations/` apply on first boot and create everything. Both
are idempotent, so re-running them is a no-op rather than a duplicate.

**6. Tell the shared Caddy about the hostname — in the neighbour's *repo*, not on
the box.**

The block to add is in [`shared-caddy.Caddyfile`](shared-caddy.Caddyfile), which
is never mounted and never deployed from here. It has to be committed to **the neighbour's**
`infra/vps/Caddyfile` and deployed from there, because `<neighbour>/Caddyfile` is a
bind mount from the neighbour's deploy tree: a block that exists only on the box is
deleted by the next neighbour deploy, Caddy reloads **cleanly**, this backend stops
resolving, and that deploy reports success with nothing to explain it.

That is not hypothetical — it already happened to this project once, with the
`<translate host>` block.

**7. Make the superuser.**

```bash
cd /opt/openscreengen
ADMIN=<superuser address>       # on a domain you control. Nothing is delivered to it
NEW=$(openssl rand -base64 24 | tr -d '/+=' | head -c 24)
docker compose -f docker-compose.yml -f docker-compose.shared-caddy.yml \
  exec -T openscreengen-pocketbase /pb/pocketbase superuser upsert "$ADMIN" "$NEW"
printf 'email=%s\npassword=%s\n' "$ADMIN" "$NEW" > .pb-superuser && chmod 600 .pb-superuser
echo "$NEW"     # write it into your password manager, NOT into this repo
```

**The address is a placeholder here for the same reason the password is.** It is
half of the credential pair for a dashboard whose URL is in this file, so naming
it would leave only the password to guess at — and this repository is public. It
is not a secret in the way the password is, and it is not written down here
either.

There is no mailbox behind it, so "forgot password" cannot deliver anything:
`/opt/openscreengen/.pb-superuser` is the only copy on the box, of both halves.
`.pb-superuser` is gitignored at the repo root as a backstop against a copy
landing in this tree.

**8. Fill in the two settings rows** at `https://pb.openscrgen.app/_/`, in the
`settings` collection. Each row carries its own description explaining what it
does and what breaks when it is wrong — that is the documentation, not this file.

| Row | Set it to |
| --- | --- |
| `google_client_ids` | the **web** OAuth client id from `NEXT_PUBLIC_GOOGLE_CLIENT_ID`, plus the desktop one if the Tauri build should sign in, comma separated |
| `github_client_ids` | the client id of the GitHub OAuth app behind `NEXT_PUBLIC_GITHUB_OAUTH_PROXY` |

Both are **public client ids**, not secrets. Until they are set, that door
answers 503 and the editor hides the button for it.

**9. Seed the showcase posts** (optional, and it is what stops the feed opening
empty on day one):

```bash
OPENSCREENGEN_PB_EMAIL='...' OPENSCREENGEN_PB_PASSWORD='...' \
  node infra/vps/seed/seed-showcase.mjs --url https://pb.openscrgen.app
```

Both halves are the ones from `.pb-superuser` on the box. In the environment
rather than in a flag, because an argument is visible in `ps` to every user on
the machine and lands in your shell history.

Run from a machine with this repo checked out — it uploads the bundled template
previews. See [`seed/seed-showcase.mjs`](seed/seed-showcase.mjs) for what it
posts and, more importantly, what it deliberately does not.

**10. Point the editor at it.** In `.env.local`, then rebuild:

```
NEXT_PUBLIC_DISCOVER_URL=https://pb.openscrgen.app
```

`NEXT_PUBLIC_` values are inlined at **build** time, so this is a rebuild rather
than a setting.

---

## Running it locally

The whole stack, on your own machine, with no VPS and no TLS:

```bash
cd infra/vps
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --build
docker compose exec -T openscreengen-pocketbase /pb/pocketbase superuser upsert admin@openscreengen.local 'LocalDevOnly12345'
OPENSCREENGEN_PB_EMAIL=admin@openscreengen.local OPENSCREENGEN_PB_PASSWORD=LocalDevOnly12345 \
  node seed/seed-showcase.mjs --url http://127.0.0.1:8090 --per-surface 6
```

Then `NEXT_PUBLIC_DISCOVER_URL=http://127.0.0.1:8090` in `.env.local` and
`npm run dev`. The feed, the guest gating and the images all work; signing in
does not, because neither door is configured — which is exactly what a
contributor with no OAuth app should see.

`docker-compose.local.yml` exists only to publish the ports, bound to
`127.0.0.1`. Never use it on the box.

The relay comes up with it. Add `NEXT_PUBLIC_MCP_RELAY_URL=http://127.0.0.1:8722`
to `.env.local` and the dev editor grows an MCP pill you can connect from.

---

## The MCP relay

A second container, ~250 lines, one job: pass MCP requests between an AI client
and an open editor tab.

```
  Claude Code ──POST /mcp/<code>──►   relay   ──SSE /tab/<code>──►  editor tab
              ◄─────── JSON ────────         ◄── POST .../reply ───
```

The desktop app needs none of it — it opens a socket on `127.0.0.1` and hands
requests to its own webview — but a browser tab can open no socket, so the two
halves need somewhere public to meet. Every design tool still runs in the tab, in
the same code the desktop app runs. Full detail in
[mcp-relay/README.md](mcp-relay/README.md).

What it means for this box:

- **Nothing stateful.** No volume, no `.env`, no secret, no database. A restart
  costs a reconnect the tab does by itself, so it can be redeployed at any time
  and it cannot lose anything.
- **Its own hostname**, `mcp.openscrgen.app`, which needs its own explicit
  unproxied A record exactly like `pb` does, and its own site block in the
  neighbour's Caddyfile (both are in `shared-caddy.Caddyfile`).
- **One proxy requirement**: `/tab/*` must not be buffered, which is what
  `flush_interval -1` in that block is for. Get it wrong and the stream is
  silent rather than broken, which reads as a hung AI client.
- **Turn it off** by not deploying it: with `NEXT_PUBLIC_MCP_RELAY_URL` unset the
  web build has no MCP feature at all. Stopping the container is also safe on its
  own; the editor shows the connection as offline and everything else is
  untouched.

---

## Checking it works

```bash
# this stack is up
curl https://pb.openscrgen.app/api/health

# ...and the neighbours are UNAFFECTED. Run these too, every time.
curl https://<neighbour PocketBase host>/api/health
curl -s -o /dev/null -w '%{http_code}\n' https://<translate host>/health

# the feed answers a signed-out reader
curl -s 'https://pb.openscrgen.app/api/openscreengen/discover/feed?limit=1'

# which doors are open ("cloudProjects" says whether projects can be saved here)
curl -s https://pb.openscrgen.app/api/openscreengen/auth/methods

# every write is refused without a token
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://pb.openscrgen.app/api/openscreengen/discover/posts   # 401

# ...and so is every cloud project route, including the reads
curl -s -o /dev/null -w '%{http_code}\n' https://pb.openscrgen.app/api/openscreengen/projects                # 401

# the MCP relay is up, and how many editor tabs are connected right now
curl -s https://mcp.openscrgen.app/healthz        # {"ok":true,"tabs":0}
```

**Every route still registered.** A hook file with a syntax error does not stop
the server, it just does not register its routes, so they answer 404 instead of
401. Ask each one:

```bash
for r in posts/aaaaaaaaaaaaaaa/like posts/aaaaaaaaaaaaaaa/save authors/aaaaaaaaaaaaaaa/follow; do
  printf "%-40s " "$r"
  curl -s -o /dev/null -w "%{http_code}\n" -X PUT https://pb.openscrgen.app/api/openscreengen/discover/$r
done

# the eight authenticated cloud-project routes. 401 on every line
PB=https://pb.openscrgen.app/api/openscreengen
for r in "GET /projects" "POST /projects" "GET /projects/aaaaaaaaaaaaaaa" \
         "DELETE /projects/aaaaaaaaaaaaaaa" "PUT /projects/aaaaaaaaaaaaaaa/share" \
         "GET /projects/aaaaaaaaaaaaaaa/doc" "POST /projects/aaaaaaaaaaaaaaa/assets" \
         "GET /projects/aaaaaaaaaaaaaaa/assets/media_x"; do
  set -- $r; printf "%-8s %-42s " "$1" "$2"
  curl -s -o /dev/null -w "%{http_code}\n" -X "$1" "$PB$2"
done
```

**401 is the pass.** It means the file parsed, the route is there, and auth is
doing its job. 404 means the hook did not load: read the container logs for a
parse error.

The three `/shared/:slug` routes are the exception: they take no token, so a
made-up slug answers **404** and that is their pass. A 405 or an HTML body means
the hook did not register.

**Proving the two databases have not become one** — worth doing once after the
first deploy, because the DNS collision it guards against is intermittent:

```bash
cd <neighbour deploy dir>
docker compose exec caddy nslookup pocketbase        # exactly ONE address
docker compose exec caddy nslookup openscreengen-pocketbase    # exactly ONE, different
```

Two addresses under either name means something is claiming a name it should not.
Nothing in this stack may ever be called `pocketbase`.

---

## Deploying

**The SSH key is not in this repo and must never be**, and `.gitignore` has a
backstop for a copy dropped in by hand. It lives outside this tree, alongside the
neighbouring project's own deploy notes. Every command below assumes `$KEY`
points at your copy:

```bash
KEY=<path to the deploy key, outside this repo>   # adjust to where yours is
BOX=root@<BOX_IP>
```

Use the **Bash** tool for anything with `ssh` in it: PowerShell drops
empty-string arguments and mangles quoting.

### 1. Back up what you are about to replace

```bash
ssh -i "$KEY" "$BOX" 'cd /opt/openscreengen && cp -a pb-hooks pb-hooks.bak-$(date +%Y%m%d-%H%M) && cp -a pb-migrations pb-migrations.bak-$(date +%Y%m%d-%H%M)'
```

`pb-data/` is the one directory that cannot be recreated from this repo, and
nothing in this loop should ever touch it.

### 2. Upload, with tar over ssh

```bash
tar -czf - -C infra/vps pb-hooks pb-migrations | ssh -i "$KEY" "$BOX" 'tar -xzf - -C /opt/openscreengen'
```

**`tar`, not `scp -r`.** `scp -r pb-hooks host:/opt/openscreengen/pb-hooks` onto a path that
already exists nests the directory inside itself (`/opt/openscreengen/pb-hooks/pb-hooks`),
PocketBase then finds no hooks, and every custom route quietly 404s while the
server looks perfectly healthy.

Upload **only the directory you changed**. Never all of `infra/vps`: that would
overwrite `docker-compose.*.yml` and, if you ever add one, any file on the box
with a real secret substituted into it.

### 3. Restart

```bash
ssh -i "$KEY" "$BOX" 'cd /opt/openscreengen && docker compose -f docker-compose.yml -f docker-compose.shared-caddy.yml restart openscreengen-pocketbase && sleep 6 && docker compose -f docker-compose.yml -f docker-compose.shared-caddy.yml logs --tail=40 openscreengen-pocketbase'
```

Hooks are a bind mount, so uploading them and restarting is genuinely all they
need. A **migration** only runs at boot, so it needs the same restart.

PocketBase also watches `pb_hooks` and restarts itself when the files change, so
you may see two "Server started" lines. That is the watcher, not a crash loop.

### 4. Verify

Run the checks above. Then confirm the migrations actually applied — a successful
one usually logs nothing at all, so silence proves nothing:

```bash
ssh -i "$KEY" "$BOX" 'cd /opt/openscreengen && docker compose -f docker-compose.yml -f docker-compose.shared-caddy.yml exec -T openscreengen-pocketbase /pb/pocketbase migrate up --dir=/pb/pb_data --migrationsDir=/pb/pb_migrations'
```

`No new migrations to apply.` is the answer you want. It is idempotent, so it is
safe against the live box.

### The relay is a different loop

Its code is baked into an image rather than bind mounted, so uploading the
directory is not enough — it has to be rebuilt:

```bash
tar -czf - -C infra/vps mcp-relay | ssh -i "$KEY" "$BOX" 'tar -xzf - -C /opt/openscreengen'
ssh -i "$KEY" "$BOX" 'cd /opt/openscreengen && docker compose -f docker-compose.yml -f docker-compose.shared-caddy.yml up -d --build openscreengen-mcp-relay'
curl -s https://mcp.openscrgen.app/healthz
```

Naming the service on that `up` line matters: without it the command rebuilds
PocketBase too, which is a restart of the database nobody asked for.

There is nothing to back up first and nothing to roll back to — the relay holds
no state, so a bad deploy is fixed by deploying again. Connected tabs reconnect
on their own within a few seconds; a call in flight during the restart fails with
a timeout its client can retry.

### Rollback

```bash
ssh -i "$KEY" "$BOX" 'cd /opt/openscreengen && rm -rf pb-hooks && cp -a pb-hooks.bak-<stamp> pb-hooks && docker compose -f docker-compose.yml -f docker-compose.shared-caddy.yml restart openscreengen-pocketbase'
```

Hooks roll back cleanly because they are stateless. **A migration does not.** Once
it has run the schema has moved, and the `down` half is the only way back — so a
migration must be idempotent, and must never be edited after it has run anywhere.
Write a new one instead.

### A migration that throws is an outage, not a missing row

Migrations run at boot, inside a transaction. One that throws rolls back,
PocketBase exits, docker restarts it, and it throws again: a restart loop with
the feed down until somebody intervenes. This exact failure took the neighbouring stack
off the air on 8 Aug 2026 over a settings description four characters too long.

Recovery — restore service first, diagnose after. You cannot `exec` into a
container that is restarting, so do not try:

```bash
ssh -i "$KEY" "$BOX" 'cd /opt/openscreengen && mv pb-migrations/<file>.js /root/<file>.js.held && docker compose -f docker-compose.yml -f docker-compose.shared-caddy.yml restart openscreengen-pocketbase'
curl -s https://pb.openscrgen.app/api/health
```

Writing one so it cannot happen: every `app.save` that seeds a settings row goes
in a try/catch with a `console.warn` (the hooks carry a default for every key, so
a lost seed row behaves exactly as the seeded one would). The **column adds stay
un-caught** — they are the part that has to land, and a hook reading a field that
does not exist is the failure you want loud.

---

## Where the errors are, and where they are not

**Route errors do not appear in `docker compose logs`.** A handler that throws
lands in PocketBase's own `_logs` collection: Dashboard → Logs. Look there FIRST
when a route misbehaves and the container log is clean. `console.warn` from a
hook *does* reach the container log, which is why the hooks use it for anything
worth seeing without logging in.

**The one that will bite you when editing hooks:** PocketBase runs every hook
handler in its own isolated VM. A `const` or a `function` at the top of a
`*.pb.js` file is **not visible inside a handler in that same file** — the
handler sees an undefined variable, at runtime, on the first request, and the
route answers a bare 400 with nothing in the container log. That is why every
handler opens with

```js
const openscreengen = require(`${__hooks}/lib/openscreengen.js`);
```

as its **first statement**, and why every shared helper lives in `lib/openscreengen.js`
even when only one file calls it. `050_discover.pb.js` was written the obvious way
first and every route in it broke exactly that way.

`lib/openscreengen.js` is deliberately **not** named `*.pb.js`: that suffix is what
PocketBase globs for, and a library loaded as a hook is a library that runs twice.

**The `<reference>` line at the top of every hook does not resolve in a fresh
clone, and that is expected.** Each file opens with

```js
/// <reference path="../pb-data/types.d.ts" />
```

which is PocketBase's own generated type definitions for `$app`, `$http`,
`routerAdd` and the rest — a 780KB file it writes into `pb_data` at boot.
`pb-data/` is gitignored (it is the database), so nothing in this repo ships it
and your editor will flag that path as missing until the stack has been up once:

```bash
cd infra/vps
docker compose -f docker-compose.yml -f docker-compose.local.yml up -d --build
```

after which `infra/vps/pb-data/types.d.ts` exists and the completions work. It is
an editor hint and nothing else — PocketBase never reads it, the hooks behave
identically without it, and a broken path here cannot affect the box.

---

## Switching things off

Every one of these is a settings row, so none needs a deploy or an app release:

| To | Set |
| --- | --- |
| stop the whole feed | `enabled` = `false` — every route answers 503, the editor hides Discover, editing is unaffected. It also shuts sign-in, so cloud projects go with it |
| stop cloud projects only | `cloud_projects_enabled` = `false` — the feed is untouched, the editor hides Save to cloud, and every saved project stays on the disk waiting |
| go read only | `writes_enabled` = `false` — the feed and every saved project stay fully readable, every write answers 503 |
| close the doors without signing anybody out | `signin_enabled` = `false` |
| close one door | blank `google_client_ids` or `github_client_ids` |
| accept pasted GitHub tokens | `github_allow_pat` = `true` |
| slow down a flood | `max_posts_per_day`, `max_comments_per_hour` |
| stop the disk filling | `max_cloud_user_bytes`, `max_cloud_projects` |
| say something under an empty feed | `moderation_note` |

**Moderating a post** is `hidden = true` on the record, in the dashboard. It
leaves the feed, the tag counts and every author page, but the row and its images
stay — so a mistake is one checkbox to undo and a real report still has its
evidence. Its author can still see it. `cloud_projects.hidden` works the same way
and is the answer to a reported share link: the link stops resolving, the owner
keeps the project. **Banning** is `banned = true` on the account, checked on every
authenticated request, so a token minted before the flag was set stops working the
moment it is set.

**Revoking a share link** is the owner's own button, and it is final by
construction: turning sharing off blanks the slug, and turning it back on mints a
new one rather than reissuing the old. There is no way to bring a revoked URL
back to life, which is the whole point.

---

## Backups

`pb-data` is the whole database, **every uploaded screenshot and every project
somebody saved to the cloud**, and it is a directory you can see. The projects
are the half that cannot be re-seeded from this repo if it is lost:

```bash
tar czf /root/osg-$(date +%F).tgz -C /opt/openscreengen pb-data
```

PocketBase also has its own scheduled backups in the dashboard under
*Settings → Backups*, which is the one to turn on first because it is consistent
with respect to SQLite's write-ahead log and a naive `tar` of a live database is
not.

---

## Files

| Path | What it is |
| --- | --- |
| `docker-compose.yml` | the stack. Caddy is behind a profile and normally never starts |
| `docker-compose.shared-caddy.yml` | joins the neighbour's network. **The one used on the box** |
| `docker-compose.local.yml` | publishes the ports on 127.0.0.1. **Local only** |
| `shared-caddy.Caddyfile` | the site block to merge into the neighbour's repo. Never mounted |
| `Caddyfile` | only for a box of its own (`--profile own-caddy`) |
| `pocketbase/Dockerfile` | pinned version **and its checksum** — bump them together |
| `mcp-relay/src/server.js` | the whole relay. No dependencies, no state, no secret |
| `mcp-relay/Dockerfile` | node + one file. Nothing is installed at build time |
| `pb-hooks/lib/openscreengen.js` | everything shared. **Not** `*.pb.js`, deliberately |
| `pb-hooks/040_auth.pb.js` | the two sign-in doors, the profile, account deletion |
| `pb-hooks/050_discover.pb.js` | the feed, posts, comments and the buttons |
| `pb-hooks/060_projects.pb.js` | cloud projects: save, open, delete, share by link |
| `pb-migrations/*.js` | the schema. Applied in filename order, idempotent |
| `seed/seed-showcase.mjs` | the official showcase posts |
| `pb-data/types.d.ts` | PocketBase's generated types, written at boot. Gitignored with the rest of `pb-data`, so the `<reference>` at the top of every hook dangles until a first local run |
