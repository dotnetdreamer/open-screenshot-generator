/// <reference path="../pb-data/types.d.ts" />

/**
 * Cloud projects: the editable document, in this database, owned by one account.
 *
 * This is NOT the Discover feed. A post is a set of finished PNGs that everybody
 * can see; a cloud project is the working file, private by default, and the thing
 * the editor reopens to keep editing. The two share an account and nothing else.
 *
 * It is also not the bring-your-own-storage layer (src/lib/account). That one
 * writes to storage the *user* owns and this box never sees. This is the hosted
 * option for somebody who does not want to connect Drive or GitHub, and it is why
 * both `max_cloud_*` limits below exist: every byte here is a byte on our disk.
 *
 * ## Nothing here is reachable without an account
 *
 * Every route that lists, saves, reads or deletes a project requires a bearer
 * token, and every one of them then checks that the row's `owner` is the account
 * that token belongs to. There is no anonymous save and no anonymous listing.
 *
 * The single exception is a project the owner has explicitly switched to `link`
 * visibility, which is then readable by its 22-character slug and by nothing
 * else. That is the whole point of the feature and it is opt in, off by default,
 * and revocable: see `share_slug` below.
 *
 * ## Two collections, not one
 *
 * The document is small and is rewritten on every save. A screen recording is up
 * to 96MB and is written once and then referenced for the rest of the project's
 * life. Putting both on one row would mean either re-uploading every recording on
 * every save, or the parallel-array bookkeeping that `posts.image_meta` gets away
 * with only because a post is written once and never edited.
 *
 * So each blob is its own record in `cloud_project_assets`, keyed by the id the
 * editor already uses for it in IndexedDB (`asset_id`). A save uploads the ones
 * the server does not have, keeps the ones it does, and deletes the rest. Nothing
 * has to line up by index.
 *
 * ## Why both file fields are `protected`
 *
 * PocketBase serves a record's files at /api/files/<collection>/<id>/<file>
 * regardless of the collection's rules. For the Discover feed that is exactly
 * right: the screenshots are public by intention and the record API still answers
 * 403. For somebody's unfinished work it is not — an unguessable URL is not a
 * permission, and a project shared with one person by link would stay reachable
 * after the link was revoked.
 *
 * `protected: true` shuts that door: PocketBase then demands a file token, and a
 * file token is only honoured if its auth record satisfies the collection's View
 * rule, which is null here as it is on all eight of the other collections. So
 * nobody but a superuser can reach a byte through the built-in route, and every
 * read goes through `pb-hooks/060_projects.pb.js`, which checks the owner or the
 * share slug and streams the file itself.
 */
migrate(
  (app) => {
    const users = app.findCollectionByNameOrId('users');

    // ---------- cloud_projects ----------

    const projects = new Collection({
      type: 'base',
      name: 'cloud_projects',
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        // Not implicit since v0.23, and the indexes below read `updated`. See the
        // long note in 1786100000_openscreengen_discover.js: a migration that throws at
        // boot is a restart loop, not a typo.
        { type: 'autodate', name: 'created', onCreate: true },
        { type: 'autodate', name: 'updated', onCreate: true, onUpdate: true },
        {
          type: 'relation',
          name: 'owner',
          required: true,
          maxSelect: 1,
          // DELETE /api/openscreengen/account promises the account and its contents go
          // together. Assets cascade from the project, and again from the owner,
          // so neither route out leaves an orphaned blob on the disk.
          cascadeDelete: true,
          collectionId: users.id,
        },
        /*
         * The id the editor uses for this project in IndexedDB.
         *
         * Unique per owner, which is what makes a re-save an update rather than a
         * second copy. Free text rather than a format: the editor mints
         * `1786…` timestamps, `imported_…`, `template_…` and `<ts>_<rand>`, and a
         * pattern here would have to be edited every time that list grows.
         */
        { type: 'text', name: 'project_id', max: 120, required: true },
        { type: 'text', name: 'name', max: 120 },
        /*
         * project.json, as a file.
         *
         * A column would work at today's sizes and stop working at a 40-board
         * localized project. A file also keeps the document opaque to this box:
         * nothing here parses it, so a new element type needs no migration.
         */
        {
          type: 'file',
          name: 'doc',
          maxSelect: 1,
          maxSize: 16 * 1024 * 1024,
          protected: true,
        },
        /*
         * `none` or `gzip`. The editor compresses when the browser has
         * CompressionStream and says so here; a build or a browser without it
         * uploads plain JSON and this stays `none`. The server never looks
         * inside either way.
         */
        {
          type: 'select',
          name: 'doc_encoding',
          maxSelect: 1,
          values: ['none', 'gzip'],
        },
        { type: 'number', name: 'doc_bytes', onlyInt: true, min: 0 },
        { type: 'number', name: 'asset_bytes', onlyInt: true, min: 0 },
        // Shown in the list so somebody can tell two projects apart without
        // opening either. Written by the client and clamped, never derived: the
        // server does not read the document.
        { type: 'number', name: 'boards', onlyInt: true, min: 0 },
        { type: 'number', name: 'format_version', onlyInt: true, min: 0 },
        /*
         * Link sharing.
         *
         * `visibility` is the switch and `share_slug` is the key. Default is
         * `private`: a project saved here is readable by its owner and by nobody
         * else until somebody deliberately turns the link on.
         *
         * The slug is regenerated whenever sharing is turned back on, so revoking
         * a link is final rather than pausing it: an old URL cannot start working
         * again because somebody re-shared the project.
         *
         * Long enough not to be guessable (22 chars of base36 is ~113 bits), and
         * it is the whole credential for a read, so it is never logged and never
         * put in a response the owner did not ask for.
         */
        { type: 'select', name: 'visibility', maxSelect: 1, values: ['private', 'link'] },
        { type: 'text', name: 'share_slug', max: 32 },
        // Moderation, same shape and same reasoning as posts.hidden: a hidden
        // project stops resolving by link but the owner still has it.
        { type: 'bool', name: 'hidden' },
      ],
      indexes: [
        /*
         * The one that makes save-is-update work.
         *
         * Without it two clicks on Save to cloud in quick succession, or the same
         * account saving from a phone and a laptop at once, write two rows for
         * one project and the list grows a duplicate that neither device can
         * reconcile. The route looks the row up first; this is what makes the
         * lookup a guarantee rather than a race.
         */
        'CREATE UNIQUE INDEX `idx_cloud_projects_owner_pid` ON `cloud_projects` (`owner`, `project_id`)',
        'CREATE INDEX `idx_cloud_projects_owner` ON `cloud_projects` (`owner`, `updated` DESC)',
        // Partial, for the same reason users.handle is: every private project
        // carries an empty slug and a plain unique index would allow exactly one
        // of them to exist.
        "CREATE UNIQUE INDEX `idx_cloud_projects_slug` ON `cloud_projects` (`share_slug`) WHERE `share_slug` != ''",
      ],
    });
    app.save(projects);

    // ---------- cloud_project_assets ----------

    const assets = new Collection({
      type: 'base',
      name: 'cloud_project_assets',
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        { type: 'autodate', name: 'created', onCreate: true },
        { type: 'autodate', name: 'updated', onCreate: true, onUpdate: true },
        {
          type: 'relation',
          name: 'project',
          required: true,
          maxSelect: 1,
          cascadeDelete: true,
          collectionId: projects.id,
        },
        /*
         * The owner again, denormalized off the project.
         *
         * Two things need it. The per-account byte total is one query rather than
         * one per project, and it runs on every upload. And a blob is the one
         * thing here that costs real money, so it gets a second, independent
         * route to being deleted with its account rather than depending on the
         * project cascade having fired first.
         */
        {
          type: 'relation',
          name: 'owner',
          required: true,
          maxSelect: 1,
          cascadeDelete: true,
          collectionId: users.id,
        },
        // The Dexie row id (`media_…`) or the font row id, exactly as the
        // document references it. Restoring puts the blob back under this id, so
        // the elements pointing at it resolve without rewriting the document.
        { type: 'text', name: 'asset_id', max: 120, required: true },
        { type: 'select', name: 'kind', maxSelect: 1, required: true, values: ['media', 'font'] },
        /*
         * No `mimeTypes` allowlist, deliberately, and it is safe because of how
         * the route serves these rather than because of what they are.
         *
         * The editor stores mp4, webm, mov, png, jpeg, webp, woff2, woff, ttf and
         * otf, and PocketBase decides the stored type by sniffing content. Font
         * sniffing is inconsistent enough that an allowlist would reject real
         * files, so instead every read is streamed by the hook as
         * `application/octet-stream` with `nosniff` and an attachment
         * disposition. Nothing uploaded here can ever be served as a document on
         * this origin.
         */
        {
          type: 'file',
          name: 'file',
          maxSelect: 1,
          maxSize: 96 * 1024 * 1024,
          protected: true,
        },
        // Everything needed to rebuild the Dexie row: mimeType, name, width,
        // height, duration for media; family, fileName, format for a font.
        { type: 'json', name: 'meta', maxSize: 4096 },
        { type: 'number', name: 'size', onlyInt: true, min: 0 },
      ],
      indexes: [
        // "Do I already have this blob for this project" on every save, and the
        // guarantee that the answer cannot be "twice".
        'CREATE UNIQUE INDEX `idx_cloud_assets_pair` ON `cloud_project_assets` (`project`, `asset_id`)',
        // The per-account total, summed on every upload.
        'CREATE INDEX `idx_cloud_assets_owner` ON `cloud_project_assets` (`owner`)',
      ],
    });
    app.save(assets);

    // ---------- settings ----------

    const settings = app.findCollectionByNameOrId('settings');

    const seed = [
      [
        'cloud_projects_enabled',
        'true',
        'Whether projects can be saved to this box at all. false answers 503 on every /api/openscreengen/projects route and the editor hides the option; the Discover feed and every existing save are untouched. This is the switch to reach for if the disk fills.',
      ],
      [
        'max_cloud_projects',
        '30',
        'How many projects one account may keep here. A save that would create the thirty-first is refused with a message naming the number; overwriting one of the thirty always works, so nobody is locked out of the project they are in.',
      ],
      [
        'max_cloud_doc_bytes',
        '12582912',
        'Largest project.json, in bytes (12MB). The editor gzips it when the browser can, so this is the compressed size in practice and a project would have to be enormous to reach it.',
      ],
      [
        'max_cloud_asset_bytes',
        '100663296',
        'Largest single asset, in bytes (96MB). One screen recording. Must stay at or under the maxSize on cloud_project_assets.file, which is the backstop the collection itself enforces.',
      ],
      [
        'max_cloud_project_bytes',
        '268435456',
        'Largest one project may grow to including every asset, in bytes (256MB). Checked before each asset upload, so a project stops accepting new recordings rather than failing the save it is halfway through.',
      ],
      [
        'max_cloud_user_bytes',
        '1073741824',
        'Total bytes one account may hold across every cloud project (1GB). The real disk limit. Reached, it refuses new assets and asks the user to delete a project.',
      ],
    ];

    for (const [key, value, description] of seed) {
      /*
       * Idempotent, and every save caught, exactly as the accounts and freshness
       * migrations do it. lib/openscreengen.js carries a default for all six keys, so a
       * row that fails to land leaves the box behaving as though it had, and a
       * settings seed is never worth a restart loop.
       */
      try {
        let rows = [];
        try {
          rows = app.findRecordsByFilter('settings', 'key = {:key}', '', 1, 0, { key: key });
        } catch {
          rows = [];
        }
        if (rows.length) continue;
        const record = new Record(settings);
        record.set('key', key);
        record.set('value', value);
        record.set('description', String(description).slice(0, 500));
        app.save(record);
      } catch (err) {
        console.warn(`openscreengen: could not seed settings.${key}, using the hook default —`, err);
      }
    }
  },
  (app) => {
    // Children first: cloud_projects cannot be deleted while the assets hold a
    // relation to it.
    for (const name of ['cloud_project_assets', 'cloud_projects']) {
      try {
        app.delete(app.findCollectionByNameOrId(name));
      } catch {
        // never created, or already gone
      }
    }

    for (const key of [
      'cloud_projects_enabled',
      'max_cloud_projects',
      'max_cloud_doc_bytes',
      'max_cloud_asset_bytes',
      'max_cloud_project_bytes',
      'max_cloud_user_bytes',
    ]) {
      try {
        for (const row of app.findRecordsByFilter('settings', 'key = {:key}', '', 1, 0, { key: key })) {
          app.delete(row);
        }
      } catch {
        // never seeded, or already gone
      }
    }
  }
);
