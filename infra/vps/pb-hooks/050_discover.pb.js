/// <reference path="../pb-data/types.d.ts" />

/**
 * The feed. Everything the Discover UI does, and nothing it does not.
 *
 * READ, all unauthenticated:
 *   GET    /api/openscreengen/discover/feed?sort&scope&surface&tag&q&cursor&limit
 *   GET    /api/openscreengen/discover/posts/{id}
 *   GET    /api/openscreengen/discover/tags
 *   GET    /api/openscreengen/discover/posts/{id}/comments
 *
 * WRITE, all requiring a token:
 *   POST   /api/openscreengen/discover/posts              (multipart: the screens)
 *   DELETE /api/openscreengen/discover/posts/{id}
 *   POST   /api/openscreengen/discover/posts/{id}/comments
 *   DELETE /api/openscreengen/discover/comments/{id}
 *   PUT    /api/openscreengen/discover/posts/{id}/like      { on: bool }
 *   PUT    /api/openscreengen/discover/posts/{id}/save      { on: bool }
 *   PUT    /api/openscreengen/discover/comments/{id}/like   { on: bool }
 *   PUT    /api/openscreengen/discover/authors/{id}/follow  { on: bool }
 *   POST   /api/openscreengen/discover/posts/{id}/remix
 *
 * ## Read only for guests is enforced here, not in the app
 *
 * The split above IS the feature. Every read route works with no Authorization
 * header and simply answers with fewer fields — no `likedByViewer`, no `isMine`
 * — and every write route starts by refusing a request without a token. The
 * editor hides the buttons a signed-out visitor cannot use, but that is
 * courtesy: hiding a button is not a permission, and the only thing that makes
 * this true is that the collections are locked and these handlers are the only
 * doors.
 *
 * `POST .../remix` is the one write that is not one. It bumps a counter when
 * somebody opens a design as a starting point, it is the single most common
 * thing a signed-out visitor does, and requiring a sign-in for it would make the
 * number measure sign-ins instead of remixes. It carries no identity and cannot
 * be read back per person, which is what makes it safe to leave open.
 *
 * ## Three orders come from the database and two do not
 *
 * `newest` and `top` are a column and an index. `for-you` and `trending` decay
 * engagement by age, which is not a column and changes every hour, so they rank
 * the most recent `feed_rank_window` posts inside the hook. That bound is a real
 * limit and it is a settings row rather than a constant so it can be raised.
 */

/**
 * ## Nothing shared lives in this file
 *
 * Every helper these handlers use is in `lib/openscreengen.js`, including the ones only
 * this file calls — `openscreengen.decorate`, `openscreengen.toggle`, `openscreengen.VISIBLE`. That is not
 * organisation, it is the only thing that works: **PocketBase runs each handler
 * in its own isolated VM**, so a `const` or a `function` at this file's top
 * level is simply not defined inside a handler below it.
 *
 * It fails at runtime, on the first request, as a bare 400 with nothing in the
 * container log — `VISIBLE is not defined`, in a route that reads fine. This
 * file was written the obvious way first and every route in it broke exactly
 * that way.
 */

// ---------- reading ----------

routerAdd('GET', '/api/openscreengen/discover/feed', (e) => {
  const openscreengen = require(`${__hooks}/lib/openscreengen.js`);
  const config = openscreengen.settings($app);
  if (!config.enabled) return e.json(503, { error: 'the community feed is switched off' });

  // Signed out is normal here, not an error: this is the guests' view.
  const viewer = openscreengen.optionalUser($app, e);

  const query = openscreengen.queryOf(e);
  const sort = openscreengen.queryValue(query, 'sort', 'for-you');
  const scope = openscreengen.queryValue(query, 'scope', 'all');
  const surface = openscreengen.queryValue(query, 'surface', 'all');
  const tag = openscreengen.queryValue(query, 'tag').toLowerCase();
  const search = openscreengen.queryValue(query, 'q').trim().toLowerCase().slice(0, 80);

  const limit = Math.max(
    1,
    Math.min(Number(openscreengen.queryValue(query, 'limit')) || config.feed_page_size, config.feed_max_page_size)
  );
  const offset = Math.max(0, Number(openscreengen.queryValue(query, 'cursor')) || 0);

  // Three of the four scopes are about the viewer, so they need one.
  if ((scope === 'following' || scope === 'saved' || scope === 'mine') && !viewer) {
    return e.json(401, { error: 'sign in required' });
  }

  // ---- the WHERE, built once ----

  const clauses = [openscreengen.VISIBLE];
  const params = {};

  if (surface && surface !== 'all') {
    if (openscreengen.SURFACES.indexOf(surface) === -1) return e.json(400, { error: 'unknown surface' });
    clauses.push('surface = {:surface}');
    params.surface = surface;
  }

  if (tag) {
    const clean = openscreengen.normalizeTags([tag])[0];
    if (!clean) return e.json(400, { error: 'bad tag' });
    // The pipes are the exactness: `|app|` cannot match `|apple|`. See the note
    // on `tags_text` in the migration.
    clauses.push('tags_text ~ {:tag}');
    params.tag = `|${clean}|`;
  }

  if (search) {
    clauses.push('search_text ~ {:search}');
    // PocketBase wraps a `~` value in % itself, so this is the term and not a
    // pattern. A `%` or `_` a person typed is escaped by the driver.
    params.search = search;
  }

  if (scope === 'mine') {
    clauses.push('author = {:viewer}');
    params.viewer = viewer.id;
  }

  if (scope === 'following') {
    const followed = [];
    try {
      const rows = $app.findRecordsByFilter(
        'follows',
        'follower = {:u}',
        '-created',
        config.feed_max_following,
        0,
        { u: viewer.id }
      );
      for (const row of rows) followed.push(row.getString('author'));
    } catch (err) {
      console.warn('openscreengen: could not read follows —', err);
    }
    if (!followed.length) return e.json(200, { posts: [], nextCursor: null, total: 0 });

    // An OR chain rather than one `IN`: PocketBase's filter language has no
    // list literal, and a named parameter per id is what keeps this away from
    // string concatenation with values in it.
    const ors = [];
    followed.forEach((id, index) => {
      ors.push(`author = {:f${index}}`);
      params[`f${index}`] = id;
    });
    clauses.push(`(${ors.join(' || ')})`);
  }

  if (scope === 'saved') {
    const savedIds = [];
    try {
      const rows = $app.findRecordsByFilter('post_saves', 'user = {:u}', '-created', 500, 0, {
        u: viewer.id,
      });
      for (const row of rows) savedIds.push(row.getString('post'));
    } catch (err) {
      console.warn('openscreengen: could not read saves —', err);
    }
    if (!savedIds.length) return e.json(200, { posts: [], nextCursor: null, total: 0 });

    const ors = [];
    savedIds.forEach((id, index) => {
      ors.push(`id = {:s${index}}`);
      params[`s${index}`] = id;
    });
    clauses.push(`(${ors.join(' || ')})`);
  }

  const filter = clauses.join(' && ');

  /*
   * ---- the ORDER, and the page ----
   *
   * ## There is no COUNT query, on purpose
   *
   * The obvious shape is `countRecords` for the total and `findRecordsByFilter`
   * for the page. It does not work here, and the reason is worth writing down
   * because it looks like it should: `countRecords` takes a **dbx expression**,
   * which is raw SQL, while `findRecordsByFilter` takes **PocketBase's filter
   * language**. They are not the same language. Handing the filter above to
   * `$dbx.exp` produces `SQL logic error: near "&"` — `&&`, `||` and `~` mean
   * nothing to SQLite. Building the same conditions twice, once in each
   * language, is two things to keep in step and one of them will drift.
   *
   * So the page is fetched with ONE extra row. `rows.length > limit` is an exact
   * answer to "is there another page", which is the only thing the cursor
   * needs, and `total` becomes the number known so far rather than a promise
   * about rows nobody has asked for. That is exact at the only moment the UI
   * says a number out loud: "that is all N posts for this filter" renders when
   * there is no next page, and by then N is everything there is.
   */

  let page = [];
  let hasMore = false;

  const ranked = sort === 'for-you' || sort === 'trending';
  // The viewer's own tab always reads newest first, whatever tab it was reached
  // from: somebody looking at their own posts is looking for the last one.
  const dbSort = scope === 'mine' || sort === 'newest' ? '-created' : sort === 'top' ? '-likes' : '-created';

  try {
    if (ranked && scope !== 'mine') {
      /*
       * Ranked in the hook, over a bounded window of the newest posts.
       *
       * `findRecordsByFilter` with a limit is the window; everything older is
       * out of these two tabs by construction. That is a real limit rather than
       * a rounding error, which is why it is a settings row and why it is
       * written down in that row's own description.
       */
      const windowRows = $app.findRecordsByFilter(
        'posts',
        filter,
        '-created',
        config.feed_rank_window,
        0,
        params
      );

      // What this viewer tends to like, so "For you" means something the moment
      // somebody follows one account or likes one post.
      const affinity = {};
      const followed = {};
      if (viewer) {
        try {
          const likedRows = $app.findRecordsByFilter('post_likes', 'user = {:u}', '-created', 60, 0, {
            u: viewer.id,
          });
          for (const row of likedRows) {
            const liked = openscreengen.findRecord($app, 'posts', row.getString('post'));
            if (!liked) continue;
            for (const t of openscreengen.jsonArray(liked, 'tags')) affinity[String(t)] = true;
          }
          const followRows = $app.findRecordsByFilter('follows', 'follower = {:u}', '', 200, 0, {
            u: viewer.id,
          });
          for (const row of followRows) followed[row.getString('author')] = true;
        } catch (err) {
          console.warn('openscreengen: could not read affinity —', err);
        }
      }

      const now = Date.now();
      const scored = [];
      for (const post of windowRows) {
        scored.push({
          post: post,
          score: openscreengen.scoreOf(post, now, sort, affinity, followed, viewer, config),
        });
      }
      scored.sort((a, b) => b.score - a.score);

      // The whole window is already in memory here, so the count IS exact and
      // the extra row is unnecessary.
      hasMore = offset + limit < scored.length;
      page = scored.slice(offset, offset + limit).map((entry) => entry.post);
    } else {
      const rows = $app.findRecordsByFilter('posts', filter, dbSort, limit + 1, offset, params);
      hasMore = rows.length > limit;
      page = hasMore ? rows.slice(0, limit) : rows;
    }
  } catch (err) {
    console.warn('openscreengen: feed query failed —', err);
    return e.json(500, { error: 'the feed could not be read' });
  }

  return e.json(200, {
    posts: openscreengen.decorate($app, page, viewer),
    nextCursor: hasMore ? String(offset + limit) : null,
    // Exact when this is the last page, which is the only time it is shown.
    total: offset + page.length,
  });
});



routerAdd('GET', '/api/openscreengen/discover/posts/{id}', (e) => {
  const openscreengen = require(`${__hooks}/lib/openscreengen.js`);
  const config = openscreengen.settings($app);
  if (!config.enabled) return e.json(503, { error: 'the community feed is switched off' });

  const viewer = openscreengen.optionalUser($app, e);
  const post = openscreengen.findRecord($app, 'posts', e.request.pathValue('id'));
  if (!post) return e.json(404, { error: 'no such post' });
  // A hidden post is gone as far as everybody except its author is concerned,
  // so a link to one from before it was hidden reads as deleted rather than as
  // a moderation notice.
  if (post.getBool('hidden') && (!viewer || post.getString('author') !== viewer.id)) {
    return e.json(404, { error: 'no such post' });
  }

  /*
   * The view counter, bumped on the way past.
   *
   * Deliberately not de-duplicated per person. Doing that honestly needs an
   * identity for signed-out readers, which means a cookie or a fingerprint, and
   * this is a vanity number on a card. It is worth neither.
   */
  try {
    openscreengen.bump(post, 'views', 1);
    $app.save(post);
  } catch (err) {
    console.warn('openscreengen: could not bump views —', err);
  }

  return e.json(200, { post: openscreengen.decorate($app, [post], viewer)[0] });
});

/**
 * Every tag in the feed with a count, for the filter chips.
 *
 * Counted over the same recent window the ranked tabs use rather than the whole
 * table: the chips are a way in to what people are posting now, and a tag that
 * was busy last spring is not that. Cheap either way — one column of one query.
 */
routerAdd('GET', '/api/openscreengen/discover/tags', (e) => {
  const openscreengen = require(`${__hooks}/lib/openscreengen.js`);
  const config = openscreengen.settings($app);
  if (!config.enabled) return e.json(503, { error: 'the community feed is switched off' });

  const counts = {};
  try {
    const rows = $app.findRecordsByFilter('posts', openscreengen.VISIBLE, '-created', config.feed_rank_window, 0);
    for (const row of rows) {
      for (const raw of openscreengen.jsonArray(row, 'tags')) {
        const tag = String(raw);
        counts[tag] = (counts[tag] || 0) + 1;
      }
    }
  } catch (err) {
    console.warn('openscreengen: could not count tags —', err);
    return e.json(200, { tags: [] });
  }

  const out = Object.keys(counts).map((tag) => ({ tag: tag, count: counts[tag] }));
  out.sort((a, b) => b.count - a.count || (a.tag < b.tag ? -1 : 1));
  return e.json(200, { tags: out.slice(0, 40) });
});

routerAdd('GET', '/api/openscreengen/discover/posts/{id}/comments', (e) => {
  const openscreengen = require(`${__hooks}/lib/openscreengen.js`);
  const config = openscreengen.settings($app);
  if (!config.enabled) return e.json(503, { error: 'the community feed is switched off' });

  const viewer = openscreengen.optionalUser($app, e);
  const postId = String(e.request.pathValue('id') || '');
  if (!openscreengen.RECORD_ID_RE.test(postId)) return e.json(404, { error: 'no such post' });

  let rows = [];
  try {
    rows = $app.findRecordsByFilter(
      'comments',
      `post = {:p} && ${openscreengen.VISIBLE}`,
      'created',
      200,
      0,
      { p: postId }
    );
  } catch (err) {
    console.warn('openscreengen: could not read comments —', err);
    return e.json(200, { comments: [] });
  }

  const authors = {};
  for (const row of rows) {
    const id = row.getString('author');
    if (id && !(id in authors)) authors[id] = openscreengen.findRecord($app, 'users', id);
  }

  return e.json(200, {
    comments: rows.map((row) => openscreengen.commentOf($app, row, viewer, authors[row.getString('author')])),
  });
});

// ---------- publishing ----------

/**
 * Share the open project to the feed.
 *
 * Multipart, because it carries the screens. The text fields arrive as form
 * values beside them, which is why this one route reads `formValue` rather than
 * a JSON body.
 *
 * `$apis.bodyLimit` is what bounds the whole request: `max_images_per_post`
 * files at `max_image_bytes` each, plus room for the form. Without it a client
 * could stream PocketBase's 32MB default into this handler before any of the
 * per-file checks below ever run.
 */
routerAdd(
  'POST',
  '/api/openscreengen/discover/posts',
  (e) => {
    const openscreengen = require(`${__hooks}/lib/openscreengen.js`);
    const config = openscreengen.settings($app);
    if (!config.enabled) return e.json(503, { error: 'the community feed is switched off' });
    if (!config.writes_enabled) return e.json(503, { error: 'the feed is read only right now' });

    const auth = openscreengen.authUser($app, e);
    if (auth.fail) return e.json(auth.fail.status, { error: auth.fail.error });
    const user = auth.user;

    // Anti-flood, counted rather than stored. See countSince in lib/openscreengen.js.
    const today = openscreengen.countSince($app, 'posts', 'author', user.id, openscreengen.DAY);
    if (today >= config.max_posts_per_day) {
      return e.json(429, {
        error: `that is ${config.max_posts_per_day} posts today, which is the daily limit`,
      });
    }

    const title = openscreengen.clampText(openscreengen.formValue(e, 'title'), openscreengen.MAX_TITLE);
    if (!title) return e.json(400, { error: 'a post needs a title' });

    const surface = openscreengen.formValue(e, 'surface');
    if (openscreengen.SURFACES.indexOf(surface) === -1) return e.json(400, { error: 'unknown surface' });

    const files = e.findUploadedFiles('images');
    if (!files || !files.length) return e.json(400, { error: 'a post needs at least one screen' });
    if (files.length > config.max_images_per_post) {
      return e.json(400, { error: `a post carries at most ${config.max_images_per_post} screens` });
    }
    for (const file of files) {
      if (file && file.size > config.max_image_bytes) {
        return e.json(413, { error: 'one of those screens is too large' });
      }
    }

    /*
     * The per-image metadata, and why its length is checked rather than
     * trusted.
     *
     * `image_meta` is a parallel array: entry N describes file N. A body with
     * three files and two entries would leave the third screen rendering at
     * whatever aspect ratio the fallback picks, in a feed, forever. Cheap to
     * check, and impossible to notice later.
     */
    let meta = [];
    try {
      const parsed = JSON.parse(openscreengen.formValue(e, 'image_meta') || '[]');
      if (Array.isArray(parsed)) meta = parsed;
    } catch {
      meta = [];
    }
    if (meta.length !== files.length) {
      return e.json(400, { error: 'the screens and their metadata do not match' });
    }
    const cleanMeta = meta.map((entry) => ({
      aspect: /^\s*\d+(\.\d+)?\s*\/\s*\d+(\.\d+)?\s*$/.test(String(entry && entry.aspect))
        ? String(entry.aspect)
        : '3 / 1',
      fit: entry && entry.fit === 'cover' ? 'cover' : 'contain',
      label: openscreengen.clampText(entry && entry.label, 60) || undefined,
    }));

    const tags = openscreengen.normalizeTags(openscreengen.formValue(e, 'tags'));

    const post = new Record($app.findCollectionByNameOrId('posts'));
    // Never from the body. The one identity in this handler comes from the
    // token, which is the whole reason a post can be attributed at all.
    post.set('author', user.id);
    post.set('title', title);
    post.set('caption', openscreengen.clampMultiline(openscreengen.formValue(e, 'caption'), openscreengen.MAX_CAPTION));
    post.set('surface', surface);
    post.set('app_name', openscreengen.clampText(openscreengen.formValue(e, 'app_name'), openscreengen.MAX_APP_NAME));
    post.set('template_project_id', openscreengen.clampText(openscreengen.formValue(e, 'template_project_id'), 120));
    post.set('screens', Math.max(0, Math.min(50, Number(openscreengen.formValue(e, 'screens')) || files.length)));
    post.set('images', files);
    post.set('image_meta', cleanMeta);
    post.set('hidden', false);
    // Zeroed explicitly rather than left to the field default, so a client that
    // posts `likes=9999` in the form gets zero like everybody else.
    post.set('likes', 0);
    post.set('comments', 0);
    post.set('views', 0);
    post.set('remixes', 0);
    openscreengen.writeTagColumns(post, tags, user);

    try {
      $app.save(post);
    } catch (err) {
      console.warn('openscreengen: could not save a post —', err);
      return e.json(500, { error: 'the post could not be saved' });
    }

    try {
      openscreengen.bump(user, 'post_count', 1);
      $app.save(user);
    } catch (err) {
      console.warn('openscreengen: could not bump post_count —', err);
    }

    return e.json(200, { post: openscreengen.decorate($app, [post], user)[0] });
  },
  // 6 images at 4MB, plus the form. Generous, and still an order of magnitude
  // below what an unbounded handler would accept.
  $apis.bodyLimit(28 * 1024 * 1024)
);


routerAdd('DELETE', '/api/openscreengen/discover/posts/{id}', (e) => {
  const openscreengen = require(`${__hooks}/lib/openscreengen.js`);
  const config = openscreengen.settings($app);
  if (!config.enabled) return e.json(503, { error: 'the community feed is switched off' });

  const auth = openscreengen.authUser($app, e);
  if (auth.fail) return e.json(auth.fail.status, { error: auth.fail.error });

  const post = openscreengen.findRecord($app, 'posts', e.request.pathValue('id'));
  if (!post) return e.json(404, { error: 'no such post' });
  // 404 rather than 403: somebody probing other people's post ids learns
  // nothing about which ones exist.
  if (post.getString('author') !== auth.user.id) return e.json(404, { error: 'no such post' });

  try {
    $app.delete(post);
  } catch (err) {
    console.warn('openscreengen: could not delete a post —', err);
    return e.json(500, { error: 'the post could not be deleted' });
  }

  try {
    openscreengen.bump(auth.user, 'post_count', -1);
    $app.save(auth.user);
  } catch (err) {
    console.warn('openscreengen: could not decrement post_count —', err);
  }

  return e.json(200, { ok: true });
});

// ---------- comments ----------

routerAdd('POST', '/api/openscreengen/discover/posts/{id}/comments', (e) => {
  const openscreengen = require(`${__hooks}/lib/openscreengen.js`);
  const config = openscreengen.settings($app);
  if (!config.enabled) return e.json(503, { error: 'the community feed is switched off' });
  if (!config.writes_enabled) return e.json(503, { error: 'the feed is read only right now' });

  const auth = openscreengen.authUser($app, e);
  if (auth.fail) return e.json(auth.fail.status, { error: auth.fail.error });

  const post = openscreengen.findRecord($app, 'posts', e.request.pathValue('id'));
  if (!post || post.getBool('hidden')) return e.json(404, { error: 'no such post' });

  const body = openscreengen.readBody(e);
  if (!body) return e.json(400, { error: 'unreadable body' });
  const text = openscreengen.clampMultiline(body.body, openscreengen.MAX_COMMENT);
  if (!text) return e.json(400, { error: 'a comment needs something in it' });

  const recent = openscreengen.countSince($app, 'comments', 'author', auth.user.id, openscreengen.HOUR);
  if (recent >= config.max_comments_per_hour) {
    return e.json(429, { error: 'that is a lot of comments in an hour. Try again shortly' });
  }

  const comment = new Record($app.findCollectionByNameOrId('comments'));
  comment.set('post', post.id);
  comment.set('author', auth.user.id);
  comment.set('body', text);
  comment.set('likes', 0);
  comment.set('hidden', false);

  try {
    $app.save(comment);
  } catch (err) {
    console.warn('openscreengen: could not save a comment —', err);
    return e.json(500, { error: 'the comment could not be saved' });
  }

  try {
    openscreengen.bump(post, 'comments', 1);
    $app.save(post);
  } catch (err) {
    console.warn('openscreengen: could not bump the comment count —', err);
  }

  return e.json(200, { comment: openscreengen.commentOf($app, comment, auth.user, auth.user) });
});

/**
 * Delete a comment.
 *
 * Two people may: whoever wrote it, and whoever owns the post it is on. The
 * second is what gives an author any control at all over what appears under
 * their own work, on a box with no moderation queue.
 */
routerAdd('DELETE', '/api/openscreengen/discover/comments/{id}', (e) => {
  const openscreengen = require(`${__hooks}/lib/openscreengen.js`);
  const config = openscreengen.settings($app);
  if (!config.enabled) return e.json(503, { error: 'the community feed is switched off' });

  const auth = openscreengen.authUser($app, e);
  if (auth.fail) return e.json(auth.fail.status, { error: auth.fail.error });

  const comment = openscreengen.findRecord($app, 'comments', e.request.pathValue('id'));
  if (!comment) return e.json(404, { error: 'no such comment' });

  const post = openscreengen.findRecord($app, 'posts', comment.getString('post'));
  const isAuthor = comment.getString('author') === auth.user.id;
  const ownsPost = post && post.getString('author') === auth.user.id;
  if (!isAuthor && !ownsPost) return e.json(404, { error: 'no such comment' });

  try {
    $app.delete(comment);
  } catch (err) {
    console.warn('openscreengen: could not delete a comment —', err);
    return e.json(500, { error: 'the comment could not be deleted' });
  }

  if (post) {
    try {
      openscreengen.bump(post, 'comments', -1);
      $app.save(post);
    } catch (err) {
      console.warn('openscreengen: could not decrement the comment count —', err);
    }
  }

  return e.json(200, { ok: true });
});

// ---------- the buttons ----------
//
// Three routes, one function, three sets of column names. `openscreengen.toggle` is in the
// library rather than here for the reason at the top of this file, and each of
// these is its own `require` because each runs in its own VM.

routerAdd('PUT', '/api/openscreengen/discover/posts/{id}/like', (e) =>
  require(`${__hooks}/lib/openscreengen.js`).toggle($app, e, {
    targetCollection: 'posts',
    joinCollection: 'post_likes',
    targetField: 'post',
    counter: 'likes',
    missing: 'no such post',
  })
);

routerAdd('PUT', '/api/openscreengen/discover/posts/{id}/save', (e) =>
  require(`${__hooks}/lib/openscreengen.js`).toggle($app, e, {
    targetCollection: 'posts',
    joinCollection: 'post_saves',
    targetField: 'post',
    // No counter. How many people saved a post is nobody's business but theirs,
    // and a public "saved 40 times" would make a private bookmark a signal.
    counter: null,
    missing: 'no such post',
  })
);

routerAdd('PUT', '/api/openscreengen/discover/comments/{id}/like', (e) =>
  require(`${__hooks}/lib/openscreengen.js`).toggle($app, e, {
    targetCollection: 'comments',
    joinCollection: 'comment_likes',
    targetField: 'comment',
    counter: 'likes',
    missing: 'no such comment',
  })
);

/**
 * Follow, which is the same shape with different column names and one extra
 * rule: nobody follows themselves.
 */
routerAdd('PUT', '/api/openscreengen/discover/authors/{id}/follow', (e) => {
  const openscreengen = require(`${__hooks}/lib/openscreengen.js`);
  const config = openscreengen.settings($app);
  if (!config.enabled) return e.json(503, { error: 'the community feed is switched off' });
  if (!config.writes_enabled) return e.json(503, { error: 'the feed is read only right now' });

  const auth = openscreengen.authUser($app, e);
  if (auth.fail) return e.json(auth.fail.status, { error: auth.fail.error });

  const author = openscreengen.findRecord($app, 'users', e.request.pathValue('id'));
  if (!author) return e.json(404, { error: 'no such account' });
  if (author.id === auth.user.id) return e.json(400, { error: 'you already follow yourself' });

  const body = openscreengen.readBody(e) || {};
  const on = body.on !== false;

  let existing = null;
  try {
    existing = $app.findFirstRecordByFilter('follows', 'follower = {:f} && author = {:a}', {
      f: auth.user.id,
      a: author.id,
    });
  } catch {
    existing = null;
  }

  let changed = false;
  if (on && !existing) {
    const row = new Record($app.findCollectionByNameOrId('follows'));
    row.set('follower', auth.user.id);
    row.set('author', author.id);
    try {
      $app.save(row);
      changed = true;
    } catch (err) {
      console.warn('openscreengen: could not write a follow —', err);
    }
  } else if (!on && existing) {
    try {
      $app.delete(existing);
      changed = true;
    } catch (err) {
      console.warn('openscreengen: could not remove a follow —', err);
    }
  }

  if (changed) {
    try {
      openscreengen.bump(author, 'followers', on ? 1 : -1);
      $app.save(author);
    } catch (err) {
      console.warn('openscreengen: could not bump a follower count —', err);
    }
  }

  return e.json(200, { on: on, followers: author.getInt('followers') || 0 });
});

/**
 * Somebody opened this design as a starting point for their own.
 *
 * Unauthenticated, on purpose — see the note at the top of this file.
 */
routerAdd('POST', '/api/openscreengen/discover/posts/{id}/remix', (e) => {
  const openscreengen = require(`${__hooks}/lib/openscreengen.js`);
  const config = openscreengen.settings($app);
  if (!config.enabled) return e.json(503, { error: 'the community feed is switched off' });

  const post = openscreengen.findRecord($app, 'posts', e.request.pathValue('id'));
  if (!post || post.getBool('hidden')) return e.json(404, { error: 'no such post' });

  try {
    openscreengen.bump(post, 'remixes', 1);
    $app.save(post);
  } catch (err) {
    console.warn('openscreengen: could not bump remixes —', err);
  }

  return e.json(200, { remixes: post.getInt('remixes') || 0 });
});

/**
 * Keep `search_text` true after somebody renames themselves.
 *
 * `search_text` carries the author's display name and handle so that searching
 * for a person finds their posts without a join. That copy goes stale the moment
 * they edit their profile, and a stale one is worse than no copy: their old name
 * keeps finding them and their new one does not.
 *
 * A model hook rather than something PATCH /api/openscreengen/me remembers to call, so it
 * also covers a rename made from the dashboard.
 */
onRecordAfterUpdateSuccess((e) => {
  const openscreengen = require(`${__hooks}/lib/openscreengen.js`);
  try {
    const before = e.record.original();
    if (
      before.getString('display_name') === e.record.getString('display_name') &&
      before.getString('handle') === e.record.getString('handle')
    ) {
      return e.next();
    }

    const posts = e.app.findRecordsByFilter('posts', 'author = {:u}', '-created', 200, 0, {
      u: e.record.id,
    });
    for (const post of posts) {
      // The same writer the publish route uses, so the two can never disagree
      // about what goes in these three columns.
      openscreengen.writeTagColumns(post, openscreengen.jsonArray(post, 'tags').map((tag) => String(tag)), e.record);
      e.app.save(post);
    }
  } catch (err) {
    // A stale search row is not worth failing the profile save that caused it.
    console.warn('openscreengen: could not reindex posts after a rename —', err);
  }
  return e.next();
}, 'users');
