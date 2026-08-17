/// <reference path="../pb-data/types.d.ts" />

/**
 * Cloud projects: saving the editable document to this box, and reading it back.
 *
 * Eleven routes. Eight of them require a bearer token and then check that the row
 * belongs to that account; three read a project the owner has explicitly switched
 * to link sharing, by its slug. There is no anonymous save, no anonymous listing,
 * and no route that takes an owner id from the request.
 *
 *   GET    /api/openscreengen/projects                        auth    the account's projects
 *   POST   /api/openscreengen/projects                        auth    save (multipart)
 *   GET    /api/openscreengen/projects/{id}                   auth    one, with its asset index
 *   DELETE /api/openscreengen/projects/{id}                   auth    delete it and its blobs
 *   PUT    /api/openscreengen/projects/{id}/share             auth    turn the link on or off
 *   GET    /api/openscreengen/projects/{id}/doc               auth    stream project.json
 *   POST   /api/openscreengen/projects/{id}/assets            auth    upload one blob (multipart)
 *   GET    /api/openscreengen/projects/{id}/assets/{assetId}  auth    stream one blob
 *   GET    /api/openscreengen/shared/{slug}                   public  a link-shared project
 *   GET    /api/openscreengen/shared/{slug}/doc               public  its document
 *   GET    /api/openscreengen/shared/{slug}/assets/{assetId}  public  one of its blobs
 *
 * ## Saving is two phases, and why
 *
 * The document is small and changes on every save; a screen recording is up to
 * 96MB and changes almost never. So `POST /projects` carries only the document,
 * plus the list of asset ids the finished project needs. It answers with the ids
 * this box does not have yet, and the client uploads those one request each.
 *
 * The cost is a window: between the document landing and the last blob arriving,
 * the stored project references blobs that are not there. A load during that
 * window restores the project with those elements blank — the same thing that
 * happens on Drive when a blob upload fails, and the same repair: save again, and
 * the missing list comes back with exactly what is still needed. The alternative,
 * one request carrying everything, would mean re-uploading a 96MB recording every
 * time somebody moved a headline.
 *
 * ## The isolated VM
 *
 * PocketBase runs every hook handler in its own VM, so a `const` at the top of
 * this file is NOT visible inside these handlers. Every one of them opens with
 * the require below as its first statement. See lib/openscreengen.js.
 */

// ---------- the account's own projects ----------

routerAdd('GET', '/api/openscreengen/projects', (e) => {
  const openscreengen = require(`${__hooks}/lib/openscreengen.js`);
  const config = openscreengen.settings($app);
  if (!config.cloud_projects_enabled) return e.json(503, { error: 'cloud projects are switched off' });

  const auth = openscreengen.authUser($app, e);
  if (auth.fail) return e.json(auth.fail.status, { error: auth.fail.error });

  let rows = [];
  try {
    rows = $app.findRecordsByFilter(
      'cloud_projects',
      'owner = {:u}',
      '-updated',
      200,
      0,
      { u: auth.user.id }
    );
  } catch (err) {
    console.warn('openscreengen: could not list cloud projects —', err);
    return e.json(500, { error: 'those could not be listed' });
  }

  // The asset index is left off the list on purpose: it is one query per project
  // and the list only shows a size, which `asset_bytes` already carries. The
  // detail route is what a load reads.
  return e.json(200, {
    projects: rows.map((row) => openscreengen.cloudProjectOf(row, null, { owner: true })),
    limit: config.max_cloud_projects,
  });
});

/**
 * Save. Multipart, because it carries project.json.
 *
 * The identity comes from the token and nothing else. `project_id` decides
 * whether this is an update — it is unique per owner at the database, so two
 * saves racing land on one row or on a constraint error, never on two rows.
 */
routerAdd(
  'POST',
  '/api/openscreengen/projects',
  (e) => {
    const openscreengen = require(`${__hooks}/lib/openscreengen.js`);
    const config = openscreengen.settings($app);
    if (!config.cloud_projects_enabled) return e.json(503, { error: 'cloud projects are switched off' });
    if (!config.writes_enabled) return e.json(503, { error: 'this box is read only right now' });

    const auth = openscreengen.authUser($app, e);
    if (auth.fail) return e.json(auth.fail.status, { error: auth.fail.error });
    const user = auth.user;

    const projectId = openscreengen.clampText(openscreengen.formValue(e, 'project_id'), 120);
    if (!projectId) return e.json(400, { error: 'that save named no project' });

    const files = e.findUploadedFiles('doc');
    if (!files || !files.length) return e.json(400, { error: 'that save carried no project data' });
    const doc = files[0];
    if (doc.size > config.max_cloud_doc_bytes) {
      return e.json(413, { error: 'that project document is too large to store here' });
    }

    /*
     * Every asset the finished project needs, as `[{ id, kind }]`.
     *
     * The client sends the whole list rather than a diff, so this route can both
     * tell it what is missing and drop what the project no longer references. A
     * body that omits the key entirely is read as "no assets", which is right:
     * that is what a project with no recordings and no imported fonts sends.
     */
    let wanted = [];
    try {
      const parsed = JSON.parse(openscreengen.formValue(e, 'manifest_assets') || '[]');
      if (Array.isArray(parsed)) wanted = parsed;
    } catch {
      wanted = [];
    }
    const wantedIds = {};
    let counted = 0;
    for (const entry of wanted) {
      // Bounded, because the rest of this handler walks the list and
      // `projectAssets` reads at most 500 rows anyway. A body claiming a
      // hundred thousand assets is not a project.
      if (counted >= 200) break;
      const id = openscreengen.clampText(entry && entry.id, 120);
      if (!id || wantedIds[id]) continue;
      wantedIds[id] = entry && entry.kind === 'font' ? 'font' : 'media';
      counted += 1;
    }

    let row = null;
    try {
      row = $app.findFirstRecordByFilter('cloud_projects', 'owner = {:u} && project_id = {:p}', {
        u: user.id,
        p: projectId,
      });
    } catch {
      row = null;
    }

    if (!row) {
      // Counted only when a row would be created. Overwriting one of the
      // existing projects always works, so reaching the cap never locks somebody
      // out of the project they have open.
      let projectCount = 0;
      try {
        projectCount = $app.findRecordsByFilter('cloud_projects', 'owner = {:u}', '', 500, 0, {
          u: user.id,
        }).length;
      } catch {
        projectCount = 0;
      }
      if (projectCount >= config.max_cloud_projects) {
        return e.json(409, {
          error: `that is ${config.max_cloud_projects} projects in the cloud, which is the limit. Delete one to save another`,
        });
      }
      row = new Record($app.findCollectionByNameOrId('cloud_projects'));
      row.set('owner', user.id);
      row.set('project_id', projectId);
      // Private until somebody deliberately shares it. Set explicitly rather
      // than left to the field default, so a client posting `visibility=link`
      // in the form gets private like everybody else — sharing is its own route.
      row.set('visibility', 'private');
      row.set('share_slug', '');
      row.set('hidden', false);
    }

    row.set('name', openscreengen.clampText(openscreengen.formValue(e, 'name'), 120) || 'Untitled project');
    row.set('doc', doc);
    row.set('doc_bytes', doc.size);
    row.set('doc_encoding', openscreengen.formValue(e, 'doc_encoding') === 'gzip' ? 'gzip' : 'none');
    row.set('boards', Math.max(0, Math.min(500, Number(openscreengen.formValue(e, 'boards')) || 0)));
    row.set('format_version', Math.max(1, Math.min(99, Number(openscreengen.formValue(e, 'format_version')) || 1)));

    try {
      $app.save(row);
    } catch (err) {
      console.warn('openscreengen: could not save a cloud project —', err);
      return e.json(500, { error: 'that project could not be saved' });
    }

    /*
     * Reconcile the blobs against the list that just arrived.
     *
     * Deleting first, then reporting what is missing, is the order that keeps the
     * quota honest: a project that dropped a 90MB recording and gained an 80MB
     * one must not have to fit both at once to be saved.
     */
    const held = openscreengen.projectAssets($app, row.id);
    const have = {};
    for (const asset of held) {
      const id = asset.getString('asset_id');
      if (wantedIds[id]) {
        have[id] = true;
        continue;
      }
      try {
        $app.delete(asset);
      } catch (err) {
        console.warn('openscreengen: could not drop an unreferenced asset —', err);
      }
    }

    const missing = [];
    for (const id in wantedIds) {
      if (!have[id]) missing.push({ id: id, kind: wantedIds[id] });
    }

    const assets = openscreengen.projectAssets($app, row.id);
    let assetBytes = 0;
    for (const asset of assets) assetBytes += asset.getInt('size') || 0;
    if (assetBytes !== row.getInt('asset_bytes')) {
      try {
        row.set('asset_bytes', assetBytes);
        $app.save(row);
      } catch (err) {
        console.warn('openscreengen: could not restate asset_bytes —', err);
      }
    }

    return e.json(200, {
      project: openscreengen.cloudProjectOf(row, assets, { owner: true, assets: true }),
      missing: missing,
    });
  },
  // The document cap plus room for the form. An order of magnitude below what an
  // unbounded handler would take, and the per-file check above runs inside it.
  $apis.bodyLimit(20 * 1024 * 1024)
);

routerAdd('GET', '/api/openscreengen/projects/{id}', (e) => {
  const openscreengen = require(`${__hooks}/lib/openscreengen.js`);
  const config = openscreengen.settings($app);
  if (!config.cloud_projects_enabled) return e.json(503, { error: 'cloud projects are switched off' });

  const auth = openscreengen.authUser($app, e);
  if (auth.fail) return e.json(auth.fail.status, { error: auth.fail.error });

  const row = openscreengen.ownedProject($app, e.request.pathValue('id'), auth.user.id);
  if (!row) return e.json(404, { error: 'no such project' });

  return e.json(200, {
    project: openscreengen.cloudProjectOf(row, openscreengen.projectAssets($app, row.id), {
      owner: true,
      assets: true,
    }),
  });
});

routerAdd('DELETE', '/api/openscreengen/projects/{id}', (e) => {
  const openscreengen = require(`${__hooks}/lib/openscreengen.js`);
  const config = openscreengen.settings($app);
  if (!config.cloud_projects_enabled) return e.json(503, { error: 'cloud projects are switched off' });

  const auth = openscreengen.authUser($app, e);
  if (auth.fail) return e.json(auth.fail.status, { error: auth.fail.error });

  const row = openscreengen.ownedProject($app, e.request.pathValue('id'), auth.user.id);
  if (!row) return e.json(404, { error: 'no such project' });

  try {
    // The assets cascade from the project relation, which is what takes their
    // files off the disk with them.
    $app.delete(row);
  } catch (err) {
    console.warn('openscreengen: could not delete a cloud project —', err);
    return e.json(500, { error: 'that project could not be deleted' });
  }

  return e.json(200, { ok: true });
});

/**
 * Turn link sharing on or off.
 *
 * On mints a NEW slug every time, including when the project is already shared.
 * That is deliberate: "stop sharing" has to be final, and the only way to
 * guarantee an old URL stays dead is never to reissue it.
 */
routerAdd('PUT', '/api/openscreengen/projects/{id}/share', (e) => {
  const openscreengen = require(`${__hooks}/lib/openscreengen.js`);
  const config = openscreengen.settings($app);
  if (!config.cloud_projects_enabled) return e.json(503, { error: 'cloud projects are switched off' });
  if (!config.writes_enabled) return e.json(503, { error: 'this box is read only right now' });

  const auth = openscreengen.authUser($app, e);
  if (auth.fail) return e.json(auth.fail.status, { error: auth.fail.error });

  const row = openscreengen.ownedProject($app, e.request.pathValue('id'), auth.user.id);
  if (!row) return e.json(404, { error: 'no such project' });

  const body = openscreengen.readBody(e) || {};
  const on = body.on === true || body.on === 'true';

  if (on) {
    row.set('visibility', 'link');
    row.set('share_slug', openscreengen.newShareSlug());
  } else {
    row.set('visibility', 'private');
    row.set('share_slug', '');
  }

  try {
    $app.save(row);
  } catch (err) {
    console.warn('openscreengen: could not change project sharing —', err);
    return e.json(500, { error: 'that could not be changed' });
  }

  return e.json(200, {
    visibility: on ? 'link' : 'private',
    shareSlug: on ? row.getString('share_slug') : '',
    // Same reason the asset route returns it: this save moved the autodate, and
    // a client still holding the previous stamp would read its own next save as
    // somebody else's.
    updated: row.getDateTime('updated').string(),
  });
});

routerAdd('GET', '/api/openscreengen/projects/{id}/doc', (e) => {
  const openscreengen = require(`${__hooks}/lib/openscreengen.js`);
  const config = openscreengen.settings($app);
  if (!config.cloud_projects_enabled) return e.json(503, { error: 'cloud projects are switched off' });

  const auth = openscreengen.authUser($app, e);
  if (auth.fail) return e.json(auth.fail.status, { error: auth.fail.error });

  const row = openscreengen.ownedProject($app, e.request.pathValue('id'), auth.user.id);
  if (!row) return e.json(404, { error: 'no such project' });

  return openscreengen.serveStoredFile($app, e, row, 'doc', 'project.json');
});

/**
 * One blob. Multipart, one request each.
 *
 * Per request rather than per save, so a 96MB recording gets its own body limit
 * and its own progress bar, and a connection that drops in the middle of a
 * five-video project costs one video rather than the save.
 */
routerAdd(
  'POST',
  '/api/openscreengen/projects/{id}/assets',
  (e) => {
    const openscreengen = require(`${__hooks}/lib/openscreengen.js`);
    const config = openscreengen.settings($app);
    if (!config.cloud_projects_enabled) return e.json(503, { error: 'cloud projects are switched off' });
    if (!config.writes_enabled) return e.json(503, { error: 'this box is read only right now' });

    const auth = openscreengen.authUser($app, e);
    if (auth.fail) return e.json(auth.fail.status, { error: auth.fail.error });
    const user = auth.user;

    const project = openscreengen.ownedProject($app, e.request.pathValue('id'), user.id);
    if (!project) return e.json(404, { error: 'no such project' });

    const assetId = openscreengen.clampText(openscreengen.formValue(e, 'asset_id'), 120);
    if (!assetId) return e.json(400, { error: 'that upload named no asset' });

    const files = e.findUploadedFiles('file');
    if (!files || !files.length) return e.json(400, { error: 'that upload carried no file' });
    const file = files[0];
    if (file.size > config.max_cloud_asset_bytes) {
      return e.json(413, { error: 'that file is too large to store here' });
    }

    /*
     * Two ceilings, checked in this order because they say different things.
     *
     * The per-project one is about this project being unreasonable; the
     * per-account one is about the disk. Both are computed from the rows rather
     * than from a stored total, so a delete that half failed cannot leave
     * somebody permanently over their limit.
     */
    const held = openscreengen.projectAssets($app, project.id);
    let projectBytes = project.getInt('doc_bytes') || 0;
    let existing = null;
    for (const row of held) {
      if (row.getString('asset_id') === assetId) {
        existing = row;
        continue; // replaced, so its bytes are not part of the new total
      }
      projectBytes += row.getInt('size') || 0;
    }
    if (projectBytes + file.size > config.max_cloud_project_bytes) {
      return e.json(413, { error: 'this project has reached the size limit for cloud storage' });
    }

    const userBytes = openscreengen.cloudBytesForUser($app, user.id) - (existing ? existing.getInt('size') || 0 : 0);
    if (userBytes + file.size > config.max_cloud_user_bytes) {
      return e.json(413, {
        error: 'your cloud storage is full. Delete a project to free some space',
      });
    }

    let meta = {};
    try {
      const parsed = JSON.parse(openscreengen.formValue(e, 'meta') || '{}');
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) meta = parsed;
    } catch {
      meta = {};
    }

    const record = existing || new Record($app.findCollectionByNameOrId('cloud_project_assets'));
    record.set('project', project.id);
    // From the token, never from the body, exactly as the post route does it.
    record.set('owner', user.id);
    record.set('asset_id', assetId);
    record.set('kind', openscreengen.formValue(e, 'kind') === 'font' ? 'font' : 'media');
    record.set('file', file);
    record.set('size', file.size);
    record.set('meta', meta);

    try {
      $app.save(record);
    } catch (err) {
      console.warn('openscreengen: could not store a project asset —', err);
      return e.json(500, { error: 'that file could not be stored' });
    }

    const assets = openscreengen.projectAssets($app, project.id);
    let assetBytes = 0;
    for (const row of assets) assetBytes += row.getInt('size') || 0;
    try {
      project.set('asset_bytes', assetBytes);
      $app.save(project);
    } catch (err) {
      console.warn('openscreengen: could not restate asset_bytes —', err);
    }

    /*
     * `updated` goes back with every upload, and the client keeps the last one.
     *
     * Saving the project row again to restate `asset_bytes` moves its autodate,
     * so the stamp the save route handed out is stale the moment the first blob
     * lands. Without this the client's next save compares a stamp from before
     * the uploads against the row as it is now, decides another device wrote it,
     * and puts an overwrite prompt in front of somebody saving their own work
     * for the second time.
     */
    return e.json(200, {
      assetId: assetId,
      size: file.size,
      assetBytes: assetBytes,
      updated: project.getDateTime('updated').string(),
    });
  },
  // One asset at its ceiling, plus the form.
  $apis.bodyLimit(100 * 1024 * 1024)
);

routerAdd('GET', '/api/openscreengen/projects/{id}/assets/{assetId}', (e) => {
  const openscreengen = require(`${__hooks}/lib/openscreengen.js`);
  const config = openscreengen.settings($app);
  if (!config.cloud_projects_enabled) return e.json(503, { error: 'cloud projects are switched off' });

  const auth = openscreengen.authUser($app, e);
  if (auth.fail) return e.json(auth.fail.status, { error: auth.fail.error });

  const project = openscreengen.ownedProject($app, e.request.pathValue('id'), auth.user.id);
  if (!project) return e.json(404, { error: 'no such project' });

  const wanted = String(e.request.pathValue('assetId') || '');
  for (const row of openscreengen.projectAssets($app, project.id)) {
    if (row.getString('asset_id') === wanted) {
      return openscreengen.serveStoredFile($app, e, row, 'file', 'asset.bin');
    }
  }
  return e.json(404, { error: 'no such file' });
});

// ---------- a project shared by link ----------

/*
 * Three routes, no token, and the slug is the whole permission.
 *
 * Everything they can reach is something the owner switched on deliberately:
 * `projectBySlug` refuses a row whose visibility is not `link`, so revoking
 * sharing takes effect on the next request rather than on the next deploy. They
 * never return `shareSlug` or anything about the owner — a shared link is a copy
 * of a design, not an introduction to whoever made it.
 */

routerAdd('GET', '/api/openscreengen/shared/{slug}', (e) => {
  const openscreengen = require(`${__hooks}/lib/openscreengen.js`);
  const config = openscreengen.settings($app);
  if (!config.cloud_projects_enabled) return e.json(503, { error: 'cloud projects are switched off' });

  const row = openscreengen.projectBySlug($app, e.request.pathValue('slug'));
  if (!row) return e.json(404, { error: 'that link is not valid any more' });

  return e.json(200, {
    project: openscreengen.cloudProjectOf(row, openscreengen.projectAssets($app, row.id), { assets: true }),
  });
});

routerAdd('GET', '/api/openscreengen/shared/{slug}/doc', (e) => {
  const openscreengen = require(`${__hooks}/lib/openscreengen.js`);
  const config = openscreengen.settings($app);
  if (!config.cloud_projects_enabled) return e.json(503, { error: 'cloud projects are switched off' });

  const row = openscreengen.projectBySlug($app, e.request.pathValue('slug'));
  if (!row) return e.json(404, { error: 'that link is not valid any more' });

  return openscreengen.serveStoredFile($app, e, row, 'doc', 'project.json');
});

routerAdd('GET', '/api/openscreengen/shared/{slug}/assets/{assetId}', (e) => {
  const openscreengen = require(`${__hooks}/lib/openscreengen.js`);
  const config = openscreengen.settings($app);
  if (!config.cloud_projects_enabled) return e.json(503, { error: 'cloud projects are switched off' });

  const row = openscreengen.projectBySlug($app, e.request.pathValue('slug'));
  if (!row) return e.json(404, { error: 'that link is not valid any more' });

  const wanted = String(e.request.pathValue('assetId') || '');
  for (const asset of openscreengen.projectAssets($app, row.id)) {
    if (asset.getString('asset_id') === wanted) {
      return openscreengen.serveStoredFile($app, e, asset, 'file', 'asset.bin');
    }
  }
  return e.json(404, { error: 'no such file' });
});
