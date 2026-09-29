# Save to your own storage (accounts)

You can connect your own account from the editor's **Account** button. This is optional. You can still make and export designs without signing in.

Google Drive keeps each project in an `Open Screenshot Generator` folder. GitHub keeps each project in a secret gist. You control those files in your own account. The app's separate cloud saving feature uses the optional community backend.

## What each provider stores

| What you save | Google Drive | GitHub |
| --- | --- | --- |
| Project design and text | Yes | Yes |
| Screenshots, images, and imported fonts | Yes | Yes |
| Screen recordings | Yes | No |
| Where it goes | A folder for each project | A secret gist for each project |

Choose Google Drive if your project has a video. The editor will stop a GitHub save if it would leave a recording behind.

### Why images fit in a gist and video does not

GitHub stores images as text files in the gist. A gist file over 10 MB cannot be read back through its API, so each image has its own file. The raw image limit is about 7.5 MB per file, and GitHub allows up to 300 files per gist. Recordings are usually too large for this method.

## Keeping a project up to date, on its own

Turn on **Settings > Your own storage > Keep saved projects up to date** if you want the app to save later edits automatically. This setting is off by default.

It only updates a project that you have already saved to that account or opened from it. It does not create a new Drive folder or gist for every template you try. Automatic saving pauses during a live editing session.

The app checks the remote copy before writing. If it changed on another device, the app stops and asks what to do. It also stops if the current device is missing project files or if a GitHub project contains a recording. Automatic saves never remove old remote images; you can clean those up with a manual save.

Drive waits about 8 seconds after you stop editing, with a limit during continuous editing. GitHub waits about 15 seconds and writes at most once a minute because gist changes count against GitHub's request limit. A manual save also counts toward that wait. The status beside the project name shows when a save is queued or when you need to reconnect.

On the web, Google may ask you to reconnect after an access token expires. The desktop app can refresh its token. If the Google OAuth consent screen is still in Testing, its refresh tokens expire after 7 days.

## Configuration

You only need the setup below if you are running your own build of the editor.

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
