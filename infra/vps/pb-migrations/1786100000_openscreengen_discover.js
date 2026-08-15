/// <reference path="../pb-data/types.d.ts" />

/**
 * The feed itself: posts, their comments, and the four join tables behind the
 * like, save and follow buttons.
 *
 * Every collection here is locked in every direction, for the reasons set out at
 * the top of `1786000000_openscreengen_accounts.js`. `pb-hooks/050_discover.pb.js` is the
 * only way in.
 *
 * ## Why counters are stored rather than counted
 *
 * `posts.likes` could be `SELECT count(*) FROM post_likes WHERE post = ?`, and
 * for one post it would be free. The feed is the problem: a page is twelve
 * posts, each card shows likes and comments, and every sort order except
 * "newest" ranks BY those numbers — so counting them means a subquery per card
 * for display and a full scan for the ordering, on every scroll, for signed-out
 * readers who are the majority of the traffic. A stored counter is one column
 * read and one index walk.
 *
 * The cost of that choice is that the counter and the join table can drift, so
 * the join table stays the source of truth: `post_likes` carries a unique index
 * on (user, post), the like route writes the row FIRST and only bumps the
 * counter when the row was genuinely new, and a double tap therefore cannot
 * inflate anything. A counter that drifts anyway is cosmetic and rebuildable;
 * a duplicate row is not possible.
 */
migrate(
  (app) => {
    const users = app.findCollectionByNameOrId('users');

    // ---------- posts ----------

    const posts = new Collection({
      type: 'base',
      name: 'posts',
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        /*
         * `created` and `updated` are NOT implicit.
         *
         * PocketBase used to add both to every base collection on its own, and
         * stopped: since v0.23 they are ordinary `autodate` fields that a
         * collection only has if it declares them. Every index and every sort in
         * this file reads `created`, so leaving them out fails the migration at
         * index creation with `no such column: created` — which, on a box where
         * a failed migration is a restart loop, is an outage rather than a typo.
         */
        { type: 'autodate', name: 'created', onCreate: true },
        { type: 'autodate', name: 'updated', onCreate: true, onUpdate: true },
        {
          type: 'relation',
          name: 'author',
          required: true,
          maxSelect: 1,
          // Deleting an account takes its posts with it, which is what
          // DELETE /api/openscreengen/account promises. A post left behind would keep a
          // deleted person's name and screenshots in a public feed.
          cascadeDelete: true,
          collectionId: users.id,
        },
        // The caps match the share form's own maxLength attributes, so the
        // client and the server agree on what is too long and nobody types 200
        // characters into a box that will refuse them on submit.
        { type: 'text', name: 'title', max: 90, required: true },
        { type: 'text', name: 'caption', max: 600 },
        /*
         * Tags, as a JSON array of lower case strings.
         *
         * A JSON column rather than a `tags` collection with a join table: the
         * only queries are "posts carrying this tag" and "every tag with a
         * count", both of which the feed route answers over a page it has
         * already loaded. A relation would buy referential integrity for a
         * value that is a free text label with no identity of its own.
         */
        { type: 'json', name: 'tags', maxSize: 512 },
        /*
         * The same tags again, as `|fitness|gradient|bold|`.
         *
         * SQLite cannot index inside a JSON column, and PocketBase's filter
         * language has no "array contains" that reaches into one. So filtering
         * by tag off `tags` alone means either a LIKE against its serialized
         * text — where `#app` would also match `#apple` — or reading every post
         * into the hook and filtering in JavaScript, which stops being viable at
         * exactly the point the feed starts mattering.
         *
         * The pipes are what make the LIKE exact: a tag is written surrounded by
         * them, so `tags_text ~ '|app|'` cannot match `|apple|`. Both columns are
         * written together in one place (`writeTagColumns` in
         * pb-hooks/050_discover.pb.js), so they cannot drift.
         */
        { type: 'text', name: 'tags_text', max: 256 },
        /*
         * Title, caption, app name, tags and the author's name and handle,
         * lower cased and run together, for the search box.
         *
         * Denormalized for the same reason: search has to reach the author's
         * handle, which lives on another table, and a join per keystroke against
         * a column nothing can index is the wrong shape. Rewritten when the post
         * changes and when its author renames themselves — see `reindexAuthor`.
         */
        { type: 'text', name: 'search_text', max: 1200 },
        {
          type: 'select',
          name: 'surface',
          maxSelect: 1,
          required: true,
          // Mirrors DiscoverSurface in src/types/discover.ts. A value that is
          // not in this list is refused by the collection itself, which is the
          // backstop behind the route's own check.
          values: ['screenshots', 'apple-watch', 'mac', 'app-preview', 'play-feature-graphic'],
        },
        { type: 'text', name: 'app_name', max: 60 },
        { type: 'number', name: 'screens', onlyInt: true, min: 0 },
        // `template_<file>` when the design started from a bundled template, so
        // "Use as template" can open the real thing. Free text on purpose: the
        // catalog ships in the app, not in this database, and a relation to a
        // table this box does not have would be a lie.
        { type: 'text', name: 'template_project_id', max: 120 },
        /*
         * The screens themselves.
         *
         * Ordered, and the order is load bearing: `image_meta` below is a
         * parallel array and index 0 of one describes index 0 of the other. The
         * route writes both together and refuses a post whose two lengths
         * disagree.
         *
         * `thumbs` is what keeps the grid cheap — a card shows a 3:1 strip about
         * 640px wide, and serving the full 1290px capture into it would be most
         * of the bytes on the page. PocketBase generates these lazily on first
         * request and caches them next to the original.
         */
        {
          type: 'file',
          name: 'images',
          maxSelect: 6,
          maxSize: 4 * 1024 * 1024,
          mimeTypes: ['image/png', 'image/jpeg', 'image/webp'],
          thumbs: ['640x0', '1280x0'],
        },
        // [{ aspect: '1290 / 2796', fit: 'contain', label: 'Home' }, ...]
        { type: 'json', name: 'image_meta', maxSize: 4096 },
        // See the note at the top on why these are columns.
        { type: 'number', name: 'likes', onlyInt: true, min: 0 },
        { type: 'number', name: 'comments', onlyInt: true, min: 0 },
        { type: 'number', name: 'views', onlyInt: true, min: 0 },
        { type: 'number', name: 'remixes', onlyInt: true, min: 0 },
        /*
         * Moderation, and the reason it is a flag rather than a delete.
         *
         * Hiding a post takes it out of every feed, every tag count and every
         * author's page, but leaves the row and the images in place — so a
         * mistake is one checkbox to undo, and a genuine abuse report still has
         * its evidence attached when somebody asks a week later. `deletePost`
         * from the app is a real delete, because that is the author asking.
         */
        { type: 'bool', name: 'hidden' },
      ],
      indexes: [
        // "Newest", and the author's own tab.
        'CREATE INDEX `idx_posts_created` ON `posts` (`created` DESC)',
        'CREATE INDEX `idx_posts_author` ON `posts` (`author`, `created` DESC)',
        // "Top", and the surface filter that sits in front of every tab.
        'CREATE INDEX `idx_posts_likes` ON `posts` (`likes` DESC)',
        'CREATE INDEX `idx_posts_surface` ON `posts` (`surface`, `created` DESC)',
        // Not an index SQLite can use for a leading-wildcard LIKE, and that is
        // understood: it is here for the `hidden = false` half of every feed
        // query, which every one of them carries.
        'CREATE INDEX `idx_posts_visible` ON `posts` (`hidden`, `created` DESC)',
      ],
    });
    app.save(posts);

    // ---------- comments ----------

    const comments = new Collection({
      type: 'base',
      name: 'comments',
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
          name: 'post',
          required: true,
          maxSelect: 1,
          cascadeDelete: true,
          collectionId: posts.id,
        },
        {
          type: 'relation',
          name: 'author',
          required: true,
          maxSelect: 1,
          cascadeDelete: true,
          collectionId: users.id,
        },
        { type: 'text', name: 'body', max: 500, required: true },
        { type: 'number', name: 'likes', onlyInt: true, min: 0 },
        { type: 'bool', name: 'hidden' },
      ],
      // Oldest first, which is how a thread reads.
      indexes: ['CREATE INDEX `idx_comments_post` ON `comments` (`post`, `created`)'],
    });
    app.save(comments);

    // ---------- the join tables ----------

    /*
     * Four tables, one shape: who, what, and a unique index across the pair.
     *
     * The unique index is the whole point of each of them. It is what makes
     * every one of these buttons idempotent at the DATABASE, rather than in a
     * handler that has to remember to check first — two taps in the same
     * hundred milliseconds, a retried request on a flaky connection, or the same
     * account in two tabs all land on one row or a constraint error, never on
     * two rows and a count of 2.
     */
    const join = (name, fields, index) =>
      app.save(
        new Collection({
          type: 'base',
          name: name,
          listRule: null,
          viewRule: null,
          createRule: null,
          updateRule: null,
          deleteRule: null,
          // `created` on all four, and it earns its place on more than
          // debuggability: the comment rate limit counts rows by age, and a
          // "recently liked" or "recently followed" question has no answer at
          // all without it. Same reason as the note in `posts`: it is not
          // implicit since v0.23.
          fields: [{ type: 'autodate', name: 'created', onCreate: true }].concat(fields),
          indexes: [index],
        })
      );

    const userRel = (fieldName) => ({
      type: 'relation',
      name: fieldName,
      required: true,
      maxSelect: 1,
      cascadeDelete: true,
      collectionId: users.id,
    });

    join(
      'post_likes',
      [
        userRel('user'),
        {
          type: 'relation',
          name: 'post',
          required: true,
          maxSelect: 1,
          cascadeDelete: true,
          collectionId: posts.id,
        },
      ],
      'CREATE UNIQUE INDEX `idx_post_likes_pair` ON `post_likes` (`user`, `post`)'
    );

    join(
      'post_saves',
      [
        userRel('user'),
        {
          type: 'relation',
          name: 'post',
          required: true,
          maxSelect: 1,
          cascadeDelete: true,
          collectionId: posts.id,
        },
      ],
      'CREATE UNIQUE INDEX `idx_post_saves_pair` ON `post_saves` (`user`, `post`)'
    );

    join(
      'comment_likes',
      [
        userRel('user'),
        {
          type: 'relation',
          name: 'comment',
          required: true,
          maxSelect: 1,
          cascadeDelete: true,
          collectionId: comments.id,
        },
      ],
      'CREATE UNIQUE INDEX `idx_comment_likes_pair` ON `comment_likes` (`user`, `comment`)'
    );

    /*
     * Follows. Two relations to the SAME collection, which is why the field
     * names have to say which end is which: `follower` is doing the following,
     * `author` is being followed. Getting them the wrong way round builds a
     * "Following" tab that shows the viewer their own followers' posts, and
     * nothing about the data looks wrong.
     */
    join(
      'follows',
      [userRel('follower'), userRel('author')],
      'CREATE UNIQUE INDEX `idx_follows_pair` ON `follows` (`follower`, `author`)'
    );

    // A second index on the reverse direction: "whose posts do I follow" is the
    // Following tab and reads by `follower`, which the unique index above
    // already covers as a prefix. This one is for counting an author's
    // followers when the denormalized column has to be rebuilt.
    const follows = app.findCollectionByNameOrId('follows');
    follows.indexes = follows.indexes.concat([
      'CREATE INDEX `idx_follows_author` ON `follows` (`author`)',
    ]);
    app.save(follows);
  },
  (app) => {
    /*
     * Down, children first: a collection cannot be deleted while another one
     * holds a relation to it, so the join tables and the comments have to go
     * before `posts` does.
     */
    for (const name of ['post_likes', 'post_saves', 'comment_likes', 'follows', 'comments', 'posts']) {
      try {
        app.delete(app.findCollectionByNameOrId(name));
      } catch {
        // never created, or already gone
      }
    }
  }
);
