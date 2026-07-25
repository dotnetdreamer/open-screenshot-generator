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

## Configuration

Both values are **public client ids**, safe to commit to a build. There is no
client secret anywhere in this feature, by design: a static export cannot keep
one.

Create `.env.local` (already gitignored) for local work, and set the same values
as repository secrets / build env for the deployed site.

```bash
# Google, web build (editor.openscrgen.app and localhost dev)
NEXT_PUBLIC_GOOGLE_CLIENT_ID=xxxxxxxx.apps.googleusercontent.com

# Google, desktop build. Optional: falls back to the web id when unset,
# but a dedicated Desktop-type client is the correct setup.
NEXT_PUBLIC_GOOGLE_DESKTOP_CLIENT_ID=yyyyyyyy.apps.googleusercontent.com

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
     for installed apps, so nothing needs registering per port.

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
  types.ts              CloudProvider interface, session + bundle types
  store.ts              the signed-in session (localStorage) + useAccount()
  transport.ts          CORS-free fetch, PKCE, the desktop loopback call
  projectBundle.ts      project row + media blobs <-> portable bundle
  providers/
    googleDrive.ts      GIS (web) / loopback PKCE (desktop) + Drive REST
    github.ts           token (web) / device flow (desktop) + Gist REST
  index.ts              registry + save/load/list/delete
src/components/artboard-studio/account/AccountDialog.tsx
src-tauri/src/oauth.rs  the one-shot loopback listener
workers/github-oauth/   Cloudflare Worker: the GitHub token exchange, nothing else
```

## Token storage

The session (including the access token) is kept in `localStorage` under
`artboard-studio.account`, unencrypted, matching how AI provider keys are
already stored. On a shared machine, sign out when done. Drive access is
limited to files this app created, so a leaked token cannot read the rest of
someone's Drive.

## Media travels with the project

Screen recordings live in a separate IndexedDB table and elements reference them
by id, so saving the project row alone leaves video elements dead on another
machine. Both the cloud save and the local JSON export now carry the blobs:
Drive stores one file per recording, and the local `.json` export inlines them
as base64. Files exported before this change still import fine.
