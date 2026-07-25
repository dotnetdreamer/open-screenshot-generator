# GitHub sign-in Worker

The smallest possible backend for "Sign in with GitHub" in the editor. It holds
the GitHub client secret and swaps an authorization code for a token. That is
the whole job.

It stores nothing, has no database, and never sees a project. Files stay in the
user's own gists, so the zero-storage-cost design is unchanged.

## Why this exists

GitHub's token exchange requires a client secret, and its OAuth endpoints send
no CORS headers. The editor is a static export with nowhere to keep a secret, so
a browser cannot complete the flow on its own. Embedding the secret in public
JavaScript would let anyone impersonate the app.

Desktop (Tauri) does **not** use this Worker. It uses GitHub's device flow,
which needs no secret, over the Tauri HTTP bridge.

## Cost

Cloudflare's free plan covers 100,000 requests per day. A token exchange happens
once per sign-in, so this stays free at any realistic scale. It was picked over
Vercel because Vercel's free plan is personal/non-commercial only and hard-stops
when it hits its cap.

## Setup

1. **Create a GitHub OAuth App** at <https://github.com/settings/developers>.
   - Homepage URL: `https://openscrgen.app`
   - Authorization callback URL: `https://<your-worker>.workers.dev/callback`

   The callback points at the **Worker**, not the app. That is deliberate: one
   OAuth App then serves local dev and production, because the app's own origin
   travels in `state` and is checked against `ALLOWED_ORIGINS`.

   Enable **Device flow** on the same app while you are here, so the desktop
   build can use it.

2. **Configure and deploy:**

   ```bash
   cd workers/github-oauth
   # put your client id in wrangler.toml under [vars]
   npx wrangler secret put GITHUB_CLIENT_SECRET
   npx wrangler deploy
   ```

3. **Point the editor at it** (repo root `.env.local`, and the deploy env):

   ```bash
   NEXT_PUBLIC_GITHUB_OAUTH_PROXY=https://<your-worker>.workers.dev
   NEXT_PUBLIC_GITHUB_CLIENT_ID=Ov23lixxxxxxxxxxxxxx   # desktop device flow only
   ```

   With `NEXT_PUBLIC_GITHUB_OAUTH_PROXY` unset, the editor falls back to asking
   for a personal access token. Nothing breaks, the UX is just clunkier.

4. **Check it:** `curl https://<your-worker>.workers.dev/health` should report
   `{"ok":true,"configured":true}`.

## Local development

```bash
npx wrangler dev          # serves on http://localhost:8787
```

Then set `NEXT_PUBLIC_GITHUB_OAUTH_PROXY=http://localhost:8787`. For the round
trip to work locally, add `http://localhost:8787/callback` as the callback URL
on a second, dev-only OAuth App.

## Endpoints

| Route | Purpose |
|---|---|
| `GET /start?state=` | Validates the app origin, redirects to GitHub |
| `GET /callback` | Exchanges the code, postMessages the token to the opener |
| `GET /health` | Reports whether the secret and client id are set |

`state` is base64url JSON `{ n: nonce, o: appOrigin }`. The nonce ties the
response to the request the app started; the origin decides where the token may
be posted and is honoured only when it appears in `ALLOWED_ORIGINS`.

## Security notes

- The token is delivered by `postMessage` to one exact origin, never in a URL,
  so it does not land in browser history or referrer headers.
- Responses carrying a token are `Cache-Control: no-store`.
- The result page embeds its payload in a JSON script tag rather than
  interpolating into JavaScript, so a value cannot become code.
- Only the `gist` scope is ever requested.
- The app never calls this Worker with `fetch`, so it exposes no CORS surface.
