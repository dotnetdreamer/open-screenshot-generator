/// <reference path="../pb-data/types.d.ts" />

/**
 * Live editing: the one thing the signalling server needs from this box.
 *
 * Two people editing a project together talk to each other, not to us. The
 * document travels over WebRTC data channels, encrypted with a key that exists
 * only in the invite link, and the signalling server in the relay container
 * (infra/vps/mcp-relay/src/collab.js) sees nothing but opaque room ids. Nothing
 * about a session is stored here, which is why this file has one route.
 *
 * That route answers the only question the signalling server cannot answer for
 * itself: **is this token a real account on this box**. Live editing requires a
 * sign-in, and the ticket the client exchanges before opening its socket is
 * minted on the strength of this answer.
 *
 *   GET /api/openscreengen/collab/whoami   auth   { id }
 *
 * It deliberately returns the id and nothing else. The relay needs to know that
 * somebody is real, not who they are: names and avatars reach the other people
 * in the room directly, over the encrypted channel, where they belong.
 *
 * The room itself is reached with the ordinary share link (the `link`
 * visibility on `cloud_projects`), so there is no second permission model here
 * and no per-session row to sweep. Turning a project's link off is what ends
 * new arrivals, exactly as it does for a read-only share.
 *
 * ## The isolated VM
 *
 * PocketBase runs every hook handler in its own VM, so a `const` at the top of
 * this file is NOT visible inside the handler. It opens with the require, like
 * every other route on this box. See lib/openscreengen.js.
 */

routerAdd('GET', '/api/openscreengen/collab/whoami', (e) => {
  const openscreengen = require(`${__hooks}/lib/openscreengen.js`);
  const config = openscreengen.settings($app);
  // Live editing hangs off cloud projects: the snapshot a person joins with is
  // a shared cloud project, so a box with those switched off cannot host a
  // session either.
  if (!config.enabled) return e.json(503, { error: 'this box is switched off' });
  if (!config.cloud_projects_enabled) {
    return e.json(503, { error: 'cloud projects are switched off' });
  }

  const auth = openscreengen.authUser($app, e);
  if (auth.fail) return e.json(auth.fail.status, { error: auth.fail.error });

  return e.json(200, { id: auth.user.id });
});
