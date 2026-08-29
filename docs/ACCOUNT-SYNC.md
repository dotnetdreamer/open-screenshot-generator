# Save to your own storage (accounts)

Users can connect **their own** Google Drive or GitHub account and save projects
there. We host nothing: there is no server in this product, no database, and no
storage bill. A project lives in the user's Drive folder or their own secret
gist, and they can revoke access or delete it without us.

This is optional. With nothing configured, the Account button still appears and
explains what is missing, and everything else in the app works as before.

## What each provider stores

| | Google Drive | GitHub |
|---|---|---|
| Project JSON | yes | yes (one secret gist) |
| Screen recordings (video) | yes | **no**, gists are text only |
| Where | `Open Screenshot Generator/<project name>/` | a secret gist per project |
| Scope requested | `drive.file` (only files this app creates) | `gist` |

Saving a project that contains recordings to GitHub is refused with a message
pointing at Drive, rather than silently dropping the video.

## Keeping a project up to date, on its own

Off until you turn it on: **Settings > Your own storage > Keep saved projects up
to date**. With it on, a project you have already put in your Drive or your
gists is written again shortly after each round of edits, with no clicking.

The rules it follows are worth knowing, because they are the reason it is safe
to leave on:

- **It only ever updates.** It will never create a folder or a gist for you.
  Something is synced only after you saved it there by hand once, or opened it
  from there, and that is recorded in a local table (`accountLinks`). Open fifty
  templates with the switch on and nothing at all reaches your account.
- **It never deletes.** A save you click tidies up files a project has stopped
  using; an automatic one leaves them alone. That decision is made from what
  this device currently has, and a browser that has cleared its site data would
  otherwise take the only copies with it.
- **It checks before it writes.** Every push first asks the provider where the
  copy stands, and stops if it has moved since this device last wrote it. It
  never picks a winner: you get the choice of replacing it, keeping both, or
  stopping syncing for that project. Neither Drive nor gists offer a
  conditional write, so this catches the case that actually happens, a second
  machine that saved hours ago, rather than two saves in the same second.
- **It stops rather than guessing.** A gist cannot hold a screen recording or an
  uploaded screenshot, and a project whose files this device has lost cannot be
  sent whole. Both stop with a message rather than sending something incomplete.
- **It never signs you out.** If the sign-in expires while the app is idle, the
  mark next to the project name says so and one click reconnects.
- **It pauses while you edit together.** During a live session everyone's
  keystrokes land in your document, and none of those people is the one paying
  for your Drive quota. Everything accumulated goes up when the session ends.

How often: Drive settles about 8 seconds after you stop typing, never more than
90 seconds into continuous editing, and never more than once every 20 seconds.

GitHub is slower, and for one specific reason rather than caution: a gist write
counts against GitHub's limit of 500 content-creating requests an hour, and that
budget is yours, shared with everything else you do on github.com. Spending it
on background saves could get your own pushes throttled. So GitHub settles after
15 seconds and writes at most once a minute, which is about 12 per cent of it.
Every write is also a permanent commit, so that rate keeps the gist's own
history readable.

The gap counts from the **last** write, and saving by hand counts as one. So
right after a manual save the first automatic one waits out that gap: on GitHub
that is a minute and a half of no requests at all, which is working as intended
even though it does not look like it. The mark next to the project name is the
thing to watch: three walking dots mean a push is queued.

Two things to know before switching it on:

- **On the web with Google**, the access token lasts about an hour and renewing
  it in the background can need a popup a timer has no permission to open. When
  that happens the mark says reconnect and one click fixes it. The desktop build
  holds a refresh token and does not have the problem.
- **While the Google OAuth consent screen is in Testing**, Google issues refresh
  tokens that expire after 7 days, so desktop syncing will stop every week until
  the app is published (see Audience, step 5 below).

## Configuration

The client ids are **public**, safe to commit to a build. No *confidential*
secret is ever shipped to a client: the web export holds none by design, and
GitHub's belongs to the Worker.

The one exception is the **Google Desktop-app client secret**, which the Tauri
build carries. Google's token endpoint refuses an installed-app code exchange
without it (`client_secret is missing.`) even though the flow uses PKCE, and
Google's own installed-app docs ship it inside the binary for exactly this
reason. It is a client identifier in practice, not a credential; PKCE plus the
loopback redirect is what actually secures that flow. The **Web** client's
secret is a real secret and must never go near the app.

Create `.env.local` (already gitignored) for local work, and set the same values
as repository secrets / build env for the deployed site.

```bash
# Google, web build (editor.openscrgen.app and localhost dev)
NEXT_PUBLIC_GOOGLE_CLIENT_ID=xxxxxxxx.apps.googleusercontent.com

# Google, desktop build. Required for desktop sign-in, and it must be a
# Desktop-type client: the web id cannot stand in, because Google rejects a
# 127.0.0.1 redirect on a Web client.
NEXT_PUBLIC_GOOGLE_DESKTOP_CLIENT_ID=yyyyyyyy.apps.googleusercontent.com
NEXT_PUBLIC_GOOGLE_DESKTOP_CLIENT_SECRET=GOCSPX-zzzzzzzzzzzzzzzz

# GitHub, desktop device flow.
NEXT_PUBLIC_GITHUB_CLIENT_ID=Ov23lixxxxxxxxxxxxxx

# GitHub sign-in Worker, which makes the web GitHub option a real login button.
# Unset = the web build falls back to asking for a personal access token.
NEXT_PUBLIC_GITHUB_OAUTH_PROXY=https://osg-github-oauth.<subdomain>.workers.dev
```

### Google Cloud setup

1. Create a project at <https://console.cloud.google.com>.
2. **APIs & Services > Library**: enable **Google Drive API**.
3. **Google Auth Platform**: run the setup wizard and pick **External** as the
   audience. The single "OAuth consent screen" page of older guides is now split
   into the left-nav sections below, which is worth knowing because the scope
   list is no longer where most tutorials say it is:

   | Older guides call it | Where it is now |
   |---|---|
   | OAuth consent screen > App information | **Branding** |
   | OAuth consent screen > User type / Test users / Publishing | **Audience** |
   | OAuth consent screen > Scopes | **Data Access** |
   | Credentials > OAuth client ID | **Clients** |

4. **Data Access > Add or remove scopes**: add `openid`,
   `.../auth/userinfo.email`, `.../auth/userinfo.profile`, and
   `.../auth/drive.file`.
   `drive.file` only appears here once the Drive API is enabled (step 2); it can
   also be pasted into "Manually add scopes".
   `drive.file` is a **non-sensitive** scope, so this does not require Google's
   sensitive-scope verification or a CASA security assessment. Keep it that way:
   asking for `drive` or `drive.readonly` would. **Verification Center** is only
   for sensitive/restricted scopes and can be ignored.
5. **Audience**: the app starts in *Testing*, where only listed **Test users**
   can sign in, so add your own account before testing. **Publish app** when you
   are ready for real users; with only non-sensitive scopes that is a
   confirmation, not a review.
6. **Clients > Create client**, twice:
   - **Web application**, for the browser build.
     Authorized JavaScript origins: `https://editor.openscrgen.app` and
     `http://localhost:9002` (the dev server port).
     No redirect URI is needed: the web flow uses the Google Identity Services
     token client, which never redirects.
   - **Desktop app**, for the Tauri build. Google allows any `127.0.0.1` port
     for installed apps, so nothing needs registering per port. Copy **both**
     its id and its secret: the code exchange fails with `client_secret is
     missing.` if the secret is left out.

### GitHub setup

Create one OAuth App at <https://github.com/settings/developers> and enable
**Device flow** on it.

- **Authorization callback URL** points at the sign-in Worker, not the app:
  `https://<your-worker>.workers.dev/callback`. Because the app's own origin
  travels in `state`, that single OAuth App serves both local dev and
  production.
- Put its client id in `NEXT_PUBLIC_GITHUB_CLIENT_ID` (used by the desktop
  device flow) and its **secret** into the Worker via
  `npx wrangler secret put GITHUB_CLIENT_SECRET`.

- **Desktop** uses the **device flow**, which needs no secret and no Worker.
- **Web** uses a popup sign-in brokered by `workers/github-oauth`. GitHub's
  token exchange requires a client secret and its OAuth endpoints send no CORS
  headers, so a static site cannot complete the flow alone, and shipping the
  secret in public JavaScript would let anyone impersonate the app. The Worker
  exists only to hold that secret and perform the exchange: it stores nothing
  and never sees a project. See `workers/github-oauth/README.md`.
- **Without the Worker**, the web build falls back to asking for a fine-grained
  token with read+write access to Gists. Everything still works, the UX is just
  clunkier. The token path also stays available as an explicit choice.

## Why desktop signs in differently

The desktop shell is a browser engine, so the difference is not about
rendering. It is about **origin**:

- The packaged app is served from `tauri://localhost` / `http://tauri.localhost`.
  Google will not accept a non-`https` custom scheme as an authorized
  JavaScript origin, and there is no public URL for a provider to redirect back
  to.
- So desktop uses the **installed-app loopback flow**: the app binds an
  ephemeral `127.0.0.1` port (`src-tauri/src/oauth.rs`), opens the consent page
  in the user's real system browser, and catches the redirect there.
- This also returns a **refresh token**, so a desktop sign-in survives app
  restarts. The browser token flow cannot do that; on the web the token is
  re-issued silently while the user's Google session is alive.

Desktop requests go through `tauri-plugin-http`, which is not subject to CORS.
The hosts it may reach are allowlisted in `src-tauri/capabilities/default.json`;
adding a provider means adding its hosts there.

## Where the code lives

```
src/lib/account/
  types.ts              CloudProvider interface, session + bundle types, errors
  store.ts              the signed-in session (localStorage) + useAccount()
  transport.ts          CORS-free fetch, PKCE, the desktop loopback call
  projectBundle.ts      project row + media blobs <-> portable bundle
  links.ts              the Dexie accountLinks table: where a project was saved
  autoSync.ts           the state machine behind the switch (timing, refusals)
  providers/
    googleDrive.ts      GIS (web) / loopback PKCE (desktop) + Drive REST
    github.ts           token (web) / device flow (desktop) + Gist REST
  index.ts              registry + save/load/list/delete + syncProjectToAccount
src/hooks/use-account-auto-sync.ts        binds one syncer to the open project
src/components/open-screenshot-generator/account/AccountDialog.tsx
src/components/open-screenshot-generator/account/AccountSyncChip.tsx
src-tauri/src/oauth.rs  the one-shot loopback listener
workers/github-oauth/   Cloudflare Worker: the GitHub token exchange, nothing else
```

## Token storage

The session (including the access token) is kept in `localStorage` under
`open-screenshot-generator.account`, unencrypted, matching how AI provider keys
are already stored (sessions saved before the rename are moved onto that key on
first read by [src/lib/legacyStorage.ts](../src/lib/legacyStorage.ts)). On a
shared machine,
sign out when done. Drive access is limited to files this app created, so a
leaked token cannot read the rest of someone's Drive.

## Media travels with the project

Screen recordings live in a separate IndexedDB table and elements reference them
by id, so saving the project row alone leaves video elements dead on another
machine. Both the cloud save and the local JSON export now carry the blobs:
Drive stores one file per recording, and the local `.json` export inlines them
as base64. Files exported before this change still import fine.
