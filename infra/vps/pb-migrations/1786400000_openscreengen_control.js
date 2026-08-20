/// <reference path="../pb-data/types.d.ts" />

/**
 * Everything the control dashboard needs from the schema, which is four things
 * none of the feature migrations had a reason to do.
 *
 *  1. **`mod_log`**, the moderation audit table the write routes in
 *     `pb-hooks/100_dash.pb.js` append to.
 *  2. **A reverse index on each of the three join tables.** `post_likes`,
 *     `comment_likes` and `post_saves` are indexed by (user, thing), which is
 *     the direction the like button reads. The dashboard reads the other
 *     direction and had nothing to stand on.
 *  3. **The `96x96` thumb on `users.avatar`**, which the accounts migration
 *     declared, never applied, and nobody noticed until every avatar in the
 *     dashboard turned out to be pulling the full upload.
 *  4. **`settings.updated`**, so "when did this value last change" has an
 *     answer.
 *
 * ## This file was called 1786400000_openscreengen_mod_log.js first
 *
 * Renamed when it stopped being only the log. **PocketBase keys applied
 * migrations by file name**, so any box that ran the old name will run this one
 * once more, meet its own `mod_log` and its own indexes, and has to survive
 * that. Every step below is therefore idempotent by lookup rather than by
 * catch, which is a distinction worth keeping: "already there" is survivable
 * and "would not save" is not, and a bare try/catch cannot tell them apart. The
 * old name never left a throwaway test box, so no deployed box is actually in
 * that state; the shape is here because it is the only shape that is safe.
 *
 * ## The safety pattern, which is not decoration
 *
 * **Migrations run at boot inside a transaction.** One that throws rolls back,
 * PocketBase exits, docker restarts it, and it throws again: a restart loop
 * with the whole backend off the air, not a missing table. The neighbouring
 * migrations all carry this warning and the sibling project took its box down
 * exactly this way on 8 Aug 2026 over a `description` four characters too long.
 *
 * So there is exactly ONE uncaught statement in this file, the creation of
 * `mod_log`, because the dashboard's write routes need somewhere to log to.
 * Everything else is wrapped individually and the worst any of it can cost is
 * what that step was buying: a query plan, a thumbnail, a timestamp column. A
 * warning in `docker compose logs` and a box that is up beats a perfect schema
 * on a box that is not.
 */
migrate(
  (app) => {
    // ---------- 1. the moderation log ----------

    /*
     * One row per thing an operator did from the dashboard.
     *
     * ## Why it exists at all
     *
     * Everything the dashboard writes, it writes with a `_superusers` token,
     * and a superuser token leaves no trace anywhere in this database. Hiding a
     * post, banning an account, revoking a share link and deleting somebody's
     * work all look identical afterwards to a box that never recorded them: a
     * row that is gone, or a boolean that is now true. Six weeks later the only
     * question anybody ever asks is "who did this, and when", and until this
     * collection existed there was no answer on the box at all.
     *
     * It is deliberately NOT a permission system. Nothing here stops anything:
     * a superuser can still PATCH any row through the record API and can delete
     * these rows too. What it buys is a record of the actions that went through
     * the dashboard, which is where they all actually go.
     *
     * ## Why a label and a note rather than a foreign key
     *
     * The obvious shape is `target` as a relation to `posts` or `users`. It is
     * wrong for the one case this table exists to cover: **the row has to still
     * make sense after the thing it describes has been deleted.** A relation
     * with `cascadeDelete` takes the audit line with the post, and a relation
     * without it leaves a dangling id that resolves to nothing. Either way,
     * deleting an account quietly erases the record of deleting an account.
     *
     * So `target_id` is plain text, `label` is what the thing was CALLED at the
     * moment it happened, and `note` is what the route decided in words. A
     * deleted post reads as `post 3f2c1a8b7d4e9f0 "Fitness app screens" deleted
     * with 4 comments` forever, with nothing left to join to.
     *
     * ## Why every rule is null
     *
     * The same reason every other collection on this box has all five rules
     * null, set out at length in `1786000000_openscreengen_accounts.js`: this
     * repository is public, a filter expression has to stay correct as fields
     * are added, and a locked collection plus an explicit route cannot leak a
     * field that did not exist when the rule was written. It matters more here
     * than most, because `actor` is an operator's email address and `note`
     * frequently names a person's content.
     */
    let logs = null;
    try {
      logs = app.findCollectionByNameOrId('mod_log');
    } catch {
      logs = null;
    }

    if (!logs) {
      const created = new Collection({
        type: 'base',
        name: 'mod_log',
        listRule: null,
        viewRule: null,
        createRule: null,
        updateRule: null,
        deleteRule: null,
        fields: [
          /*
           * Not implicit since v0.23. Every index below reads `created` and the
           * dashboard's only ordering of this table is newest first, so leaving
           * it out fails the migration at index creation with `no such column:
           * created` - which on this box is an outage rather than a typo. The
           * discover migration carries the same note for the same reason.
           *
           * `onUpdate` is deliberately absent: these rows are never edited. A
           * row that could be rewritten is not a log.
           */
          { type: 'autodate', name: 'created', onCreate: true },
          /*
           * The superuser's email, best effort.
           *
           * `dash.actor()` reads it off the auth record and returns an empty
           * string when the shape of that record has moved between PocketBase
           * versions, so blank is a legal value here and means "could not be
           * read", never "nobody sent it": the route has already refused a
           * request with no superuser auth on it by the time this row is built.
           * 128 rather than 255 because it is an address, and a longer one is a
           * mistake worth truncating rather than storing.
           */
          { type: 'text', name: 'actor', max: 128 },
          /*
           * What kind of thing this was done to.
           *
           * A select rather than free text, because this is the column the
           * dashboard filters and groups on, and a typo in a route would
           * otherwise quietly create a sixth category nobody ever looks at.
           *
           * `settings` and `recount` are in the list even though no route in
           * `100_dash.pb.js` writes a `settings` row today: settings edits go
           * through the record API from the browser, and the day they stop
           * doing that the value has to already exist. A select that refuses a
           * value costs the whole audit line, because `writeLog` is wrapped and
           * a refused save is a warning in the log and nothing else.
           */
          {
            type: 'select',
            name: 'target',
            maxSelect: 1,
            values: ['post', 'comment', 'account', 'project', 'settings', 'recount'],
          },
          // The record id, as plain text. See above: a relation here would
          // erase the row that records a deletion. 40 leaves room for the 15
          // character ids PocketBase mints plus anything a future route wants
          // to key on, such as a settings key.
          { type: 'text', name: 'target_id', max: 40 },
          // `hide`, `unhide`, `feature`, `unfeature`, `delete`, `ban`, `unban`,
          // `verify`, `unverify`, `unshare`, `recount`. Free text on purpose:
          // the allowed set per target lives in the moderate route, which is
          // the only place that can enforce it correctly, and duplicating it
          // here as a select would mean a migration every time an action is
          // added.
          { type: 'text', name: 'action', max: 40 },
          // What the thing was called when this happened: a post title, a
          // comment body, an account's display name, a project name. The half
          // of the row that makes it readable a year later.
          { type: 'text', name: 'label', max: 160 },
          // What the route decided, in the same words it answered the browser
          // with. This is where "deleted with 4 comments and 2 projects,
          // follower counts elsewhere may now be stale" is written down.
          { type: 'text', name: 'note', max: 512 },
          /*
           * The client's idempotency key, echoed.
           *
           * `POST /dash/moderate` accepts a `ref` of the shape
           * `dash_<6 to 40 lower case alnum>`, minted once in the browser and
           * reused verbatim when the operator retries. The route validates it
           * and, without this column, threw it away: two identical audit lines
           * a second apart could be one action logged twice by a retry, or two
           * genuine clicks, and nothing on the box could tell them apart. With
           * the ref written down the answer is one string comparison.
           *
           * Nothing is keyed ON it and no unique index guards it, deliberately:
           * none of these actions is a payment, hiding an already hidden post
           * is harmless, and a unique index would turn a duplicate line into a
           * refused audit row - losing the record rather than the duplicate,
           * which is the wrong thing to lose. 48 is the validated maximum, 45,
           * plus room.
           *
           * Appended last so that a box which grew this column and a box which
           * created the table with it end up with the same column order.
           */
          { type: 'text', name: 'ref', max: 48 },
        ],
        indexes: [
          // The only ordering the dashboard uses, and the one a `LIMIT 50` on a
          // growing table needs to stay cheap.
          'CREATE INDEX `idx_mod_log_created` ON `mod_log` (`created`)',
          // "What has been done to this post" from the post drawer, which is
          // the second question anybody asks after "what happened here".
          'CREATE INDEX `idx_mod_log_target` ON `mod_log` (`target`, `target_id`)',
        ],
      });

      // Uncaught, and the only uncaught statement in the file. Without this
      // table every moderation action still works and every one of them goes
      // unrecorded, which is precisely the state this migration exists to end.
      app.save(created);
    } else {
      /*
       * The table is already here, from the version of this file that only made
       * the table. Add the one column it did not have.
       *
       * Wrapped, unlike the creation above, and the difference is what each
       * failure costs: a box with no `mod_log` has nowhere to write an audit
       * line at all, while a box with a `mod_log` and no `ref` still records
       * every action and merely cannot recognise a retry. The second is not
       * worth a restart loop.
       */
      try {
        let ref = null;
        try {
          ref = logs.fields.getByName('ref');
        } catch {
          ref = null;
        }
        if (!ref) {
          logs.fields.add(new TextField({ name: 'ref', max: 48 }));
          app.save(logs);
        }
      } catch (err) {
        console.warn('openscreengen: could not add mod_log.ref, retries will not be recognisable:', err);
      }
    }

    // ---------- 2. the reverse indexes on the three join tables ----------

    /**
     * Add one index, only if it is missing, and never at the cost of the boot.
     *
     * Each addition is wrapped on its own so that a table a future migration
     * renames costs its own index and not the two beside it, and so that the
     * worst case of this whole section is a slower dashboard rather than a box
     * that will not start. An index is a query plan: losing one is a
     * performance regression, and there is no such thing as a performance
     * regression worth an outage.
     *
     * Idempotent by scanning the existing definitions for the index NAME rather
     * than by comparing the SQL, because PocketBase normalises what it stores
     * (quoting, whitespace, the `IF NOT EXISTS` it strips) and a string compare
     * against what was written here would report "missing" on every boot and
     * try to add a duplicate every time.
     */
    const addIndex = (collectionName, indexName, sql) => {
      try {
        const collection = app.findCollectionByNameOrId(collectionName);

        // A plain index walk rather than `.some`: `collection.indexes` is a Go
        // slice handed across the JS boundary, and length plus subscript is the
        // part of the array contract that is certain to be there.
        for (let i = 0; i < collection.indexes.length; i++) {
          if (String(collection.indexes[i]).indexOf(indexName) !== -1) return;
        }

        collection.indexes = collection.indexes.concat([sql]);
        app.save(collection);
      } catch (err) {
        console.warn(`openscreengen: could not add ${indexName}, those queries will scan instead:`, err);
      }
    };

    /*
     * Why these three, and why they were never here.
     *
     * The join tables carry a unique index across the pair: `post_likes` on
     * (user, post), `comment_likes` on (user, comment), `post_saves` on
     * (user, post). That is the right index for the like button, which asks
     * "has THIS person liked this", and the feature migration needed nothing
     * else because the counters are denormalized precisely so that nobody has
     * to count rows on a feed read.
     *
     * The dashboard is the first thing on this box that reads the other
     * direction, and a leading `user` column cannot serve `WHERE l.post =
     * p.id`. So the Integrity page's drift checks, which are five queries of
     * the shape `(SELECT COUNT(*) FROM post_likes l WHERE l.post = p.id)` over
     * every post, were a full scan of the join table PER POST: posts times
     * likes, quadratic, on the page whose whole job is to be safe to open.
     *
     * Recount is worse, because it runs that same probe twice per scope inside
     * `$app.runInTransaction` to measure the drift before and after. On SQLite
     * a write transaction holds the single write connection, so the quadratic
     * scan happens with every feed read on the box queued behind it. The LIMIT
     * in the UPDATE bounds how many rows are WRITTEN and does nothing at all
     * about how many are read.
     *
     * The precedent is already in `1786100000_openscreengen_discover.js`, which
     * adds `idx_follows_author` with the comment "for counting an author's
     * followers when the denormalized column has to be rebuilt". These three
     * are that same index, for that same reason, on the three tables where
     * nobody had needed it yet.
     *
     * One column each rather than (post, user), matching `idx_follows_author`:
     * the counting queries never look at the second column, and a narrower
     * index is less to write on every like.
     */
    addIndex(
      'post_likes',
      'idx_post_likes_post',
      'CREATE INDEX `idx_post_likes_post` ON `post_likes` (`post`)'
    );
    addIndex(
      'comment_likes',
      'idx_comment_likes_comment',
      'CREATE INDEX `idx_comment_likes_comment` ON `comment_likes` (`comment`)'
    );
    addIndex(
      'post_saves',
      'idx_post_saves_post',
      'CREATE INDEX `idx_post_saves_post` ON `post_saves` (`post`)'
    );

    // ---------- 3. the avatar thumbnail that was declared and never applied ----------

    /*
     * `users.avatar` has no thumbs, and the migration that "added" it says it
     * does.
     *
     * `1786000000_openscreengen_accounts.js` declares the field with
     * `thumbs: ['96x96']` and adds it through an `addField` helper that only
     * adds a field WHEN IT IS MISSING. That guard is right and has to stay: it
     * is what makes the migration safe to meet a half-applied box. But the
     * stock PocketBase `users` collection already ships an `avatar` file field,
     * so the field was never missing, so the declaration never applied, and the
     * live column reads `thumbs: null` on a box whose migration file says
     * otherwise. Nothing failed and nothing warned.
     *
     * The cost is paid on every page of the dashboard. `avatar()` in
     * `dash/ui.js` asks for `?thumb=96x96`, PocketBase has no such thumb
     * declared, and it serves the ORIGINAL: up to 512KB of provider avatar for
     * a 32 pixel chip, twenty five times over on the accounts table.
     *
     * Fixed by appending rather than by replacing, so that a size somebody adds
     * later survives this running again, and skipped entirely when `96x96` is
     * already in the list. PocketBase generates thumbs lazily on first request,
     * so this makes no files by itself: each avatar's thumbnail is cut the
     * first time the dashboard asks for it and cached next to the original.
     *
     * The same declaration also carried `maxSize` and a `mimeTypes` list that
     * never applied either, and they are deliberately NOT set here. Both are
     * checks on an UPLOAD, the only writer is this box's own avatar fetch which
     * already enforces its own ceiling, and narrowing `mimeTypes` on a live
     * collection would make every existing record whose file falls outside the
     * new list fail validation on its next save, for no gain at all.
     */
    try {
      const users = app.findCollectionByNameOrId('users');

      let avatar = null;
      try {
        avatar = users.fields.getByName('avatar');
      } catch {
        avatar = null;
      }

      if (avatar) {
        const sizes = [];
        let has96 = false;
        // Defensive around a null slice: a field that has never had thumbs
        // comes across as null rather than as an empty array.
        if (avatar.thumbs) {
          for (let i = 0; i < avatar.thumbs.length; i++) {
            const size = String(avatar.thumbs[i]);
            sizes.push(size);
            if (size === '96x96') has96 = true;
          }
        }
        if (!has96) {
          avatar.thumbs = sizes.concat(['96x96']);
          app.save(users);
        }
      }
    } catch (err) {
      console.warn('openscreengen: could not add the avatar thumb, avatars will serve full size:', err);
    }

    // ---------- 4. when a setting last changed ----------

    /*
     * `settings` has `key`, `value` and `description`, and nothing else.
     *
     * It is the one collection in this stack that was created without the
     * autodate pair, which is easy to see why: it is a switchboard of 28 rows
     * that a person edits by hand, not a table with a history. The dashboard is
     * what turns that into a gap. Settings and Tables both want to show when a
     * value last moved, and "somebody raised max_posts_per_day at some point"
     * is not an answer anybody can act on. The `mod_log` line the Settings view
     * writes records the edits made THROUGH the dashboard; this column records
     * every edit, including the one made in the PocketBase admin at 3am.
     *
     * Existing rows get an empty value until the next time they are edited, and
     * the view says exactly that rather than inventing a date. Honest, and
     * unavoidable: the information was never recorded and cannot be recovered.
     *
     * `created` is deliberately NOT added alongside it. An autodate with
     * `onCreate` only fills on an INSERT, so every one of the 28 seeded rows
     * would keep an empty `created` too, and the temptation to backfill it with
     * the migration's own timestamp is exactly the wrong move: it would put
     * today's date on rows that were seeded months ago and read as fact.
     * A blank cell says "not recorded". A wrong date says something false, and
     * nobody looking at it would know.
     */
    try {
      const settings = app.findCollectionByNameOrId('settings');

      let updated = null;
      try {
        updated = settings.fields.getByName('updated');
      } catch {
        updated = null;
      }

      if (!updated) {
        settings.fields.add(new AutodateField({ name: 'updated', onCreate: true, onUpdate: true }));
        app.save(settings);
      }
    } catch (err) {
      console.warn('openscreengen: could not add settings.updated, edit times stay unknown:', err);
    }
  },
  (app) => {
    /*
     * Down, and it undoes two of the four things.
     *
     * `mod_log` goes, and with it every record of what was done. Nothing else
     * in the schema points at that table, which is the whole point of it
     * holding text rather than relations, so it can go on its own.
     *
     * The three indexes go too. An index holds no information: dropping one
     * costs a query plan and cannot lose a row, and re-running `up` rebuilds
     * them exactly.
     *
     * What deliberately STAYS is the avatar thumb and `settings.updated`.
     * Removing the thumb would orphan every thumbnail PocketBase has already
     * cut and send the dashboard back to serving 512KB avatars; dropping
     * `updated` would throw away the only record of when a value changed, which
     * is data rather than schema. Neither blocks anything: `up` is idempotent
     * and finds both already done. A down migration is for undoing a schema
     * change, not for throwing away what has been collected since, which is the
     * same argument the accounts migration makes for keeping its columns on
     * `users`.
     *
     * Every step is wrapped, because a down migration that throws on a box
     * where the thing was never created is the same restart loop an up one is.
     */
    try {
      app.delete(app.findCollectionByNameOrId('mod_log'));
    } catch {
      // never created, or already gone
    }

    const dropIndex = (collectionName, indexName) => {
      try {
        const collection = app.findCollectionByNameOrId(collectionName);
        const kept = [];
        for (let i = 0; i < collection.indexes.length; i++) {
          const sql = String(collection.indexes[i]);
          if (sql.indexOf(indexName) === -1) kept.push(sql);
        }
        if (kept.length === collection.indexes.length) return;
        collection.indexes = kept;
        app.save(collection);
      } catch {
        // never added, or the collection is already gone
      }
    };

    dropIndex('post_likes', 'idx_post_likes_post');
    dropIndex('comment_likes', 'idx_comment_likes_comment');
    dropIndex('post_saves', 'idx_post_saves_post');
  }
);
