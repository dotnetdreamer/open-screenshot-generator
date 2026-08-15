/// <reference path="../pb-data/types.d.ts" />

/**
 * The freshness pass: one column and three settings rows.
 *
 * ## Why this migration exists
 *
 * `scoreOf` in pb-hooks/lib/openscreengen.js ranked "For you" and "Trending" as
 * `engagement / (age + 12)^0.6`. Engagement is likes plus comments plus remixes,
 * so a post that nobody has touched yet scores **exactly zero**, and zero divided
 * by any decay is still zero. A brand new post therefore sorted below every older
 * post that had ever collected a single like, in the tab that is the feed's
 * default sort.
 *
 * On a feed with an audience that is merely unfair. On a feed without one it is
 * fatal: the only posts with any engagement are the seeded showcase ones, so the
 * first stranger who shares a design lands underneath all of them and stays
 * there. They see their work vanish and do not come back, which reads as "nobody
 * liked it" when the truth is that nobody was ever shown it.
 *
 * `feed_fresh_boost` is the fix, and it is a boost rather than a separate
 * ordering because the tab still has to be a ranking: a new post enters near the
 * top, decays out of that position within about two days, and any post with real
 * engagement passes it on the way. Nothing here invents a number that is shown to
 * anybody — the counters on the card stay exactly what people did. Only the
 * ORDER changes.
 *
 * `featured` is the other half. It is set by hand from the dashboard, it is the
 * one editorial lever over the feed, and it is honest in the way a like count
 * would not be: a badge that says the maintainers picked this is a claim about
 * the maintainers, and it is true.
 */
migrate(
  (app) => {
    // ---------- posts.featured ----------

    const posts = app.findCollectionByNameOrId('posts');

    /*
     * Added only when missing, for the reason the accounts migration gives at
     * length: `up` has to survive meeting a collection that already has the
     * field, because on this box a migration that throws at boot is not a missing
     * column, it is docker restarting PocketBase into the same exception with the
     * whole backend off the air.
     */
    let existing = null;
    try {
      existing = posts.fields.getByName('featured');
    } catch {
      existing = null;
    }
    if (!existing) {
      posts.fields.add(new BoolField({ name: 'featured' }));
      app.save(posts);
    }

    // ---------- the three rows ----------

    const settings = app.findCollectionByNameOrId('settings');

    const seed = [
      [
        'feed_fresh_boost',
        '6',
        'How much of a head start a brand new post gets in the For you and Trending tabs, in the same units as engagement (a like is 1, a comment 3, a remix 2). Without it a post nobody has touched scores zero and sorts below every older post that ever collected one like, which on a quiet feed means every new share is invisible. At 6 a new post enters around where a six-like post sits and is passed by anything with real engagement. Zero switches the boost off and restores the original ordering.',
      ],
      [
        'feed_fresh_hours',
        '12',
        'How fast that head start fades, as the time constant of an exponential: the boost is down to a third by this many hours and to a twentieth by three times it. At 12 a post is competing on its own engagement inside two days. Raise it only if posts arrive slower than that, because a long tail here means new posts hold the top of the feed on newness alone.',
      ],
      [
        'feed_featured_boost',
        '2',
        'What the featured checkbox on a post multiplies its rank by. Ordering only: the badge on the card is the visible half and this is what puts the post where the badge will be seen. 1 makes the checkbox cosmetic.',
      ],
    ];

    for (const [key, value, description] of seed) {
      /*
       * Idempotent, and every save caught, exactly as the accounts migration
       * does it. A settings seed is never worth an outage, and lib/openscreengen.js
       * carries a default for all three keys, so a row that fails to land leaves
       * the box behaving as though it had.
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
    /*
     * Down. The column goes, the rows go, and both are caught: a down migration
     * that throws on a box where the field was never added is the same restart
     * loop as an up one.
     */
    try {
      const posts = app.findCollectionByNameOrId('posts');
      posts.fields.removeByName('featured');
      app.save(posts);
    } catch (err) {
      console.warn('openscreengen: could not drop posts.featured —', err);
    }

    for (const key of ['feed_fresh_boost', 'feed_fresh_hours', 'feed_featured_boost']) {
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
