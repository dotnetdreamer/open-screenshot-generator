/// <reference path="../pb-data/types.d.ts" />

/**
 * The two doors, and the profile behind them.
 *
 *   POST   /api/openscreengen/auth/google   { accessToken }        -> { token, record }
 *   POST   /api/openscreengen/auth/github   { accessToken }        -> { token, record }
 *   GET    /api/openscreengen/auth/methods                         -> which doors are open
 *   GET    /api/openscreengen/me                                   -> the viewer's profile
 *   PATCH  /api/openscreengen/me            { handle?, name?, bio? }
 *   DELETE /api/openscreengen/account                              -> { ok }
 *
 * ## Why these two and no others
 *
 * The editor already signs people in to Google and to GitHub, because that is
 * where "save to your own storage" puts their projects. Asking the same person
 * for a second, feed-only email and password would be a worse product and a
 * worse security story: one more password to lose, one more mailbox this box
 * would have to be able to send to, and a reset flow on a box with no SMTP.
 *
 * So both routes take the access token the app is **already holding** and
 * exchange it for a PocketBase one. There is no password door at all — see the
 * note in `1786000000_openscreengen_accounts.js` for what that shuts.
 *
 * ## Neither route reads an identity the client claimed
 *
 * That is the rule they share, and it is the whole of the security argument. A
 * `sub`, a `login` or an `id` in the body would be a request to be believed, and
 * is never accepted. Both routes take an opaque token, ask the provider who it
 * belongs to, and use the answer.
 *
 * Asking "who is this" is not sufficient on its own, though, and this is the
 * part that is easy to get wrong: a token minted for **somebody else's** app
 * also answers that question correctly. Without a further check, any site that
 * can talk a user into an OAuth consent screen could take the resulting token,
 * post it here, and act as that person in this feed forever. So each route also
 * establishes that the token was issued to THIS app:
 *
 *   - **Google** returns `aud`, the client id the token was minted for, from
 *     `tokeninfo`. It has to be in the `google_client_ids` allowlist.
 *   - **GitHub** has no tokeninfo, but it stamps `X-OAuth-Client-Id` on its own
 *     API responses for OAuth-app tokens. That header is written by GitHub, not
 *     by the caller, and has to be in `github_client_ids`.
 *
 * A GitHub **personal access token** carries no client id at all, so it can only
 * ever prove "somebody holds a GitHub token". The editor offers a pasted token
 * when its sign-in Worker is not configured, so that path is supported — behind
 * `github_allow_pat`, which defaults to off and has to be turned on
 * deliberately.
 *
 * Both allowlists start empty. An empty one answers 503 rather than waving
 * everything through: a box that has not been told which app it belongs to must
 * not mint accounts for whoever asks first.
 */

// ---------- Google ----------

routerAdd('POST', '/api/openscreengen/auth/google', (e) => {
  // First statement, always. Each handler runs in its own isolated VM and
  // cannot see this file's outer scope — see lib/openscreengen.js.
  const openscreengen = require(`${__hooks}/lib/openscreengen.js`);

  const config = openscreengen.settings($app);
  if (!config.enabled) return e.json(503, { error: 'the community feed is switched off' });
  if (!config.signin_enabled) return e.json(503, { error: 'sign-in is switched off' });

  const body = openscreengen.readBody(e);
  if (!body) return e.json(400, { error: 'unreadable body' });

  const accessToken = String(body.accessToken || '');
  // Not a shape check for its own sake: it keeps a junk value from being pasted
  // into an outbound HTTPS request to Google.
  if (!/^[A-Za-z0-9._\-/]{20,2048}$/.test(accessToken)) {
    return e.json(401, { error: 'bad access token' });
  }

  const audiences = openscreengen.idList(config.google_client_ids);
  if (!audiences.length) return e.json(503, { error: 'the Google door is not configured' });

  // 1. Who is this, and who was the token minted for.
  let info = null;
  try {
    const res = $http.send({
      url: openscreengen.GOOGLE_TOKENINFO_URL + encodeURIComponent(accessToken),
      method: 'GET',
      timeout: 10,
    });
    if (res.statusCode === 200) info = res.json;
  } catch (err) {
    console.warn('openscreengen: tokeninfo call failed —', err);
    // Google being unreachable is our problem, not the visitor's: 502 so the
    // client can tell "try again" from "your account is not welcome".
    return e.json(502, { error: 'could not reach Google' });
  }
  if (!info || typeof info !== 'object') return e.json(401, { error: 'bad access token' });

  const sub = String(info.sub || '');
  const audience = String(info.aud || '');
  // tokeninfo answers with strings, not JSON booleans. Both are accepted so a
  // future change of heart at Google's end does not lock everybody out.
  const emailVerified = info.email_verified === true || info.email_verified === 'true';
  const expiresIn = Number(info.expires_in);

  if (!sub) return e.json(401, { error: 'bad access token' });
  if (audiences.indexOf(audience) === -1) return e.json(401, { error: 'wrong audience' });
  if (isFinite(expiresIn) && expiresIn <= 0) return e.json(401, { error: 'expired access token' });

  const email = openscreengen.clampText(info.email, 128);
  if (!email) return e.json(401, { error: 'that token carries no email' });
  if (!emailVerified) return e.json(403, { error: 'that Google email is not verified' });

  // 2. The display name and the picture, which tokeninfo does not carry.
  //    A failure here is not fatal: an account with no name falls back to the
  //    email's local part and the UI draws initials.
  let profile = {};
  try {
    const res = $http.send({
      url: openscreengen.GOOGLE_USERINFO_URL,
      method: 'GET',
      headers: { Authorization: `Bearer ${accessToken}` },
      timeout: 10,
    });
    if (res.statusCode === 200 && res.json && typeof res.json === 'object') profile = res.json;
  } catch (err) {
    console.warn('openscreengen: userinfo call failed —', err);
  }
  /*
   * And the answer has to be about the SAME person.
   *
   * Two calls with one token should not be able to disagree, so this can only
   * fire if something between here and Google is not what it claims. Cheap, and
   * the alternative is taking a display name and an avatar from an answer that
   * was never tied to the `sub` this account is keyed on.
   */
  if (profile.sub && String(profile.sub) !== sub) {
    return e.json(401, { error: 'bad access token' });
  }

  const googleName = openscreengen.clampText(
    profile.name || profile.given_name || email.split('@')[0],
    openscreengen.MAX_DISPLAY_NAME
  );

  return openscreengen.upsertAccount($app, e, {
    field: 'google_sub',
    key: sub,
    email: email,
    name: googleName,
    handleSeed: profile.given_name || profile.name || email.split('@')[0],
    pictureUrl: config.avatar_fetch_enabled ? profile.picture : '',
  });
});

// ---------- GitHub ----------

routerAdd('POST', '/api/openscreengen/auth/github', (e) => {
  const openscreengen = require(`${__hooks}/lib/openscreengen.js`);

  const config = openscreengen.settings($app);
  if (!config.enabled) return e.json(503, { error: 'the community feed is switched off' });
  if (!config.signin_enabled) return e.json(503, { error: 'sign-in is switched off' });

  const body = openscreengen.readBody(e);
  if (!body) return e.json(400, { error: 'unreadable body' });

  const accessToken = String(body.accessToken || '');
  if (!/^[A-Za-z0-9._\-]{20,512}$/.test(accessToken)) {
    return e.json(401, { error: 'bad access token' });
  }

  const clientIds = openscreengen.idList(config.github_client_ids);
  // The allowlist is required even when PATs are allowed. `github_allow_pat`
  // widens WHICH tokens are accepted; it does not mean the box is configured.
  if (!clientIds.length) return e.json(503, { error: 'the GitHub door is not configured' });

  let res = null;
  try {
    res = $http.send({
      url: openscreengen.GITHUB_USER_URL,
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        // GitHub answers 403 to an API request with no User-Agent, with a body
        // that does not mention the header. Worth an hour to somebody.
        'User-Agent': 'open-screenshot-generator',
      },
      timeout: 10,
    });
  } catch (err) {
    console.warn('openscreengen: github user call failed —', err);
    return e.json(502, { error: 'could not reach GitHub' });
  }

  if (res.statusCode === 401) return e.json(401, { error: 'that GitHub token was rejected' });
  if (res.statusCode !== 200) {
    console.warn('openscreengen: github user call answered', res.statusCode);
    return e.json(502, { error: 'could not reach GitHub' });
  }

  /*
   * Which OAuth app this token belongs to, according to GitHub.
   *
   * Present on every response to an OAuth-app token and absent for a personal
   * access token, which is exactly the distinction the settings row is about.
   * Read from the RESPONSE, so the caller has no say in it.
   */
  const rawHeader = res.headers['X-Oauth-Client-Id'] || res.headers['x-oauth-client-id'] || '';
  const clientId = String(Array.isArray(rawHeader) ? rawHeader[0] : rawHeader).trim();

  if (clientId) {
    if (clientIds.indexOf(clientId) === -1) return e.json(401, { error: 'wrong GitHub app' });
  } else if (!config.github_allow_pat) {
    return e.json(403, {
      error: 'personal access tokens are not accepted here',
    });
  }

  const user = res.json;
  if (!user || typeof user !== 'object') return e.json(401, { error: 'bad access token' });

  const githubId = String(user.id || '');
  const login = openscreengen.clampText(user.login, 40);
  if (!githubId || !login) return e.json(401, { error: 'bad access token' });

  /*
   * The email.
   *
   * PocketBase requires one on an auth record and GitHub does not always have a
   * public one, so an account with a private address gets GitHub's own noreply
   * form. It is a real address in a namespace GitHub owns, it is stable for the
   * life of the account, and it is unique — which is all the column needs.
   * `emailVisibility` stays false either way, so it is never in an answer.
   */
  const email =
    openscreengen.clampText(user.email, 128) || `${githubId}+${login}@users.noreply.github.com`;

  return openscreengen.upsertAccount($app, e, {
    field: 'github_id',
    key: githubId,
    email: email,
    name: openscreengen.clampText(user.name || login, openscreengen.MAX_DISPLAY_NAME),
    handleSeed: login,
    pictureUrl: config.avatar_fetch_enabled ? user.avatar_url : '',
  });
});

/*
 * There is no `upsert` helper in this file, and that is not an omission.
 *
 * **PocketBase runs every hook handler in its own isolated VM**, so a function
 * declared at this file's top level is simply not defined inside a handler
 * below it — it fails at runtime, on the first sign-in, as a bare 400 with
 * nothing in the container log. Everything both doors share is
 * `openscreengen.upsertAccount` in lib/openscreengen.js, reached through the `require` that opens
 * each handler.
 */

// ---------- which doors are open ----------

/**
 * Unauthenticated on purpose, and it names no secret.
 *
 * The app asks this once when Discover opens, so it can show the right sign-in
 * button rather than offering a door that answers 503. Every field is a boolean
 * derived from whether a settings row is filled in — never the client ids
 * themselves, which are public but are still not this endpoint's business.
 */
routerAdd('GET', '/api/openscreengen/auth/methods', (e) => {
  const openscreengen = require(`${__hooks}/lib/openscreengen.js`);
  const config = openscreengen.settings($app);

  return e.json(200, {
    enabled: config.enabled,
    writes: config.enabled && config.writes_enabled,
    signin: config.enabled && config.signin_enabled,
    google: config.signin_enabled && openscreengen.idList(config.google_client_ids).length > 0,
    github: config.signin_enabled && openscreengen.idList(config.github_client_ids).length > 0,
    githubPat: config.github_allow_pat,
    /*
     * Whether this box will store editable projects (pb-hooks/060_projects.pb.js).
     *
     * Its own switch rather than a facet of `enabled`, because they are separate
     * features: a box can host the feed and not the projects, or the reverse.
     * `enabled` still bounds it, and not because the routes read that row — they
     * do not — but because signing in does, and nothing here is reachable
     * without an account.
     */
    cloudProjects: config.enabled && config.cloud_projects_enabled,
    note: config.moderation_note || undefined,
  });
});

// ---------- the profile ----------

routerAdd('GET', '/api/openscreengen/me', (e) => {
  const openscreengen = require(`${__hooks}/lib/openscreengen.js`);
  const config = openscreengen.settings($app);
  if (!config.enabled) return e.json(503, { error: 'the community feed is switched off' });

  const auth = openscreengen.authUser($app, e);
  if (auth.fail) return e.json(auth.fail.status, { error: auth.fail.error });

  return e.json(200, { record: openscreengen.authorOf($app, auth.user, auth.user.id) });
});

/**
 * The three fields a person may write about themselves, and nothing else.
 *
 * This is the shape the locked collection buys: the route names the fields, so
 * `banned`, `verified_badge`, `followers` and the two provider keys are not
 * "fields with a rule that had better be right", they are fields no request can
 * reach.
 */
routerAdd('PATCH', '/api/openscreengen/me', (e) => {
  const openscreengen = require(`${__hooks}/lib/openscreengen.js`);
  const config = openscreengen.settings($app);
  if (!config.enabled) return e.json(503, { error: 'the community feed is switched off' });
  if (!config.writes_enabled) return e.json(503, { error: 'the feed is read only right now' });

  const auth = openscreengen.authUser($app, e);
  if (auth.fail) return e.json(auth.fail.status, { error: auth.fail.error });

  const body = openscreengen.readBody(e);
  if (!body) return e.json(400, { error: 'unreadable body' });

  const user = auth.user;

  if (typeof body.name === 'string') {
    const name = openscreengen.clampText(body.name, openscreengen.MAX_DISPLAY_NAME);
    if (name) user.set('display_name', name);
  }
  if (typeof body.bio === 'string') {
    user.set('bio', openscreengen.clampText(body.bio, openscreengen.MAX_BIO));
  }
  if (typeof body.handle === 'string') {
    const wanted = String(body.handle).toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, openscreengen.MAX_HANDLE);
    if (wanted.length < 2) return e.json(400, { error: 'that handle is too short' });
    if (wanted !== user.getString('handle')) {
      let taken = null;
      try {
        taken = $app.findFirstRecordByFilter('users', 'handle = {:h}', { h: wanted });
      } catch {
        taken = null;
      }
      // 409 rather than silently renaming to `wanted2`: the person typed a
      // specific handle and deserves to be told it is gone.
      if (taken) return e.json(409, { error: 'that handle is taken' });
      user.set('handle', wanted);
    }
  }

  try {
    $app.save(user);
  } catch (err) {
    console.warn('openscreengen: could not save a profile —', err);
    return e.json(500, { error: 'could not save your profile' });
  }

  return e.json(200, { record: openscreengen.authorOf($app, user, user.id) });
});

/**
 * Delete the account, and everything hanging off it.
 *
 * One `app.delete`, because every relation pointing at `users` was declared
 * `cascadeDelete: true` in the migrations: the posts go, their images go with
 * the records, the comments go, and every like, save and follow in either
 * direction goes. That is the promise this route makes, and it is enforced by
 * the schema rather than by remembering to write six deletes here.
 *
 * The follower counts on other people's accounts are the one thing a cascade
 * cannot fix, so they are walked by hand first.
 */
routerAdd('DELETE', '/api/openscreengen/account', (e) => {
  const openscreengen = require(`${__hooks}/lib/openscreengen.js`);
  const config = openscreengen.settings($app);
  if (!config.enabled) return e.json(503, { error: 'the community feed is switched off' });

  const auth = openscreengen.authUser($app, e);
  if (auth.fail) return e.json(auth.fail.status, { error: auth.fail.error });

  const user = auth.user;

  try {
    const following = $app.findRecordsByFilter('follows', 'follower = {:u}', '', 500, 0, { u: user.id });
    for (const row of following) {
      const author = openscreengen.findRecord($app, 'users', row.getString('author'));
      if (!author) continue;
      openscreengen.bump(author, 'followers', -1);
      try {
        $app.save(author);
      } catch (err) {
        console.warn('openscreengen: could not decrement a follower count —', err);
      }
    }
  } catch (err) {
    // A follower count that is one too high is cosmetic. It must not stop
    // somebody deleting their account.
    console.warn('openscreengen: could not walk follows on delete —', err);
  }

  try {
    $app.delete(user);
  } catch (err) {
    console.warn('openscreengen: could not delete an account —', err);
    return e.json(500, { error: 'could not delete your account' });
  }

  return e.json(200, { ok: true });
});
