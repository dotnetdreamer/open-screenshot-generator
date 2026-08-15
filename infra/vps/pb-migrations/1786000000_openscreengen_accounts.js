/// <reference path="../pb-data/types.d.ts" />

/**
 * Accounts and the operator's switchboard.
 *
 * Two things: the fields an Open Screenshot Generator account needs on top of
 * PocketBase's own `users` collection, and the `settings` collection every hook
 * reads its tunables out of.
 *
 * ## Every API rule is null, on every collection in this stack
 *
 * Not "tight rules". **No rules at all**, in every direction, which is what
 * PocketBase reads as "superuser only". Every read and every write in this
 * product goes through an explicit route in `pb-hooks/`, and that is a
 * deliberate trade rather than an oversight:
 *
 *  - **This repository is public.** A rule is a filter expression that has to
 *    stay correct as fields are added; a locked collection plus a route that
 *    names the exact fields it returns cannot leak a field that did not exist
 *    when it was written. `banned`, `google_sub`, `github_id` and the email are
 *    all on this collection and none of them is anybody's business.
 *  - A narrowed `updateRule` silently stops being right the day somebody adds a
 *    field and forgets to add a clause. A route that can only write
 *    `display_name` cannot be talked into writing anything else.
 *
 * What is deliberately NOT locked by this is `/api/files/...`. PocketBase serves
 * a record's files publicly regardless of the collection's rules, unless the
 * collection is marked "protected" — verified against 0.39.9, not assumed. That
 * is exactly what this feature wants: the record API answers 403 to the world
 * while the posted screenshots load in an `<img>` for a signed-out visitor,
 * which is what "read only for guests" means in practice.
 *
 * ## There is no password door
 *
 * Both sign-in routes take a token the app already holds from Google or GitHub
 * and exchange it for a PocketBase one (`pb-hooks/040_auth.pb.js`). PocketBase
 * requires an auth collection to keep at least one auth method enabled, so
 * password auth stays on and every account is created with a 40 character random
 * password that is generated, used to satisfy the field, and never stored or
 * shown anywhere. Nobody — including the account's owner — ever learns it, so
 * `auth-with-password` has nothing to guess at.
 */
migrate(
  (app) => {
    // ---------- users ----------

    const users = app.findCollectionByNameOrId('users');

    /**
     * Add a field only when it is missing.
     *
     * `up` has to be safe to meet a collection that already has the field, or a
     * half-applied deploy can never be finished — and on this box a migration
     * that throws is not a missing row, it is a restart loop with the whole
     * backend off the air. See README.md.
     */
    const addField = (field, name) => {
      let existing = null;
      try {
        existing = users.fields.getByName(name);
      } catch {
        existing = null;
      }
      if (!existing) users.fields.add(field);
    };

    /*
     * The two provider keys.
     *
     * `google_sub`, never the email: an email address can change hands, a Google
     * `sub` cannot. GitHub's numeric `id` for the same reason — a login can be
     * renamed and the next person can take the old one.
     *
     * A person who signs in through both doors gets two accounts. There is no
     * linking flow, and matching them on email would be wrong in the one case it
     * matters: a GitHub account with a private email has no address to match on
     * at all, which is precisely what its owner asked for. Known limit, written
     * down so it is not rediscovered as a bug.
     */
    addField(new TextField({ name: 'google_sub', max: 64 }), 'google_sub');
    addField(new TextField({ name: 'github_id', max: 64 }), 'github_id');

    // The @handle, lower case, unique. Derived from the provider login at first
    // sign-in and never rewritten by a later one.
    addField(new TextField({ name: 'handle', max: 30 }), 'handle');
    addField(new TextField({ name: 'display_name', max: 40 }), 'display_name');
    addField(new TextField({ name: 'bio', max: 160 }), 'bio');

    /*
     * The avatar, FETCHED rather than linked.
     *
     * A `picture` URL from Google or GitHub would mean every card in a public
     * feed pulling an image from googleusercontent.com or avatars.
     * githubusercontent.com, which hands those two a view of who is reading the
     * feed and when. The editor already refuses to fetch anything from a third
     * party at render time — see the avatar gradients in
     * src/lib/discover/format.ts — and the feed should not be the one place that
     * does.
     *
     * So sign-in downloads it once, server side, into this field. PocketBase
     * then serves it (and a thumbnail) off this box like any other upload. A
     * fetch that fails costs nothing: the UI falls back to the initials chip it
     * already draws for everybody without a picture.
     */
    addField(
      new FileField({
        name: 'avatar',
        maxSelect: 1,
        maxSize: 512 * 1024,
        mimeTypes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
        thumbs: ['96x96'],
      }),
      'avatar'
    );

    // Cosmetic only. Set by hand in the dashboard, and by the seeder on the one
    // official account, so a showcase post is never mistaken for a stranger's.
    addField(new BoolField({ name: 'verified_badge' }), 'verified_badge');
    // Checked on every authenticated request rather than only at sign-in, so a
    // token minted before the flag was set stops working the moment it is set.
    addField(new BoolField({ name: 'banned' }), 'banned');
    /*
     * Denormalized counters.
     *
     * Kept on the record rather than counted per request because the feed shows
     * a follower count on every author of every card, and a COUNT per card per
     * page is the query that makes a feed slow long before anything else does.
     * `follow` and `unfollow` are the only writers.
     */
    addField(new NumberField({ name: 'followers', onlyInt: true, min: 0 }), 'followers');
    addField(new NumberField({ name: 'post_count', onlyInt: true, min: 0 }), 'post_count');

    /*
     * Locked in every direction. The routes in pb-hooks are the only way an
     * account is created, read or changed — which is what stops somebody
     * clearing their own `banned` flag with one curl.
     */
    users.listRule = null;
    users.viewRule = null;
    users.createRule = null;
    users.updateRule = null;
    users.deleteRule = null;

    /*
     * And no built-in authentication either.
     *
     * `authRule = null` shuts every framework auth endpoint on this collection:
     * auth-with-password, auth-with-oauth2, auth-refresh, the OTP flow and the
     * password-reset mail. None of them is part of this design — tokens are
     * minted by `newAuthToken()` inside the two exchange routes — and each one
     * left open is a login form on the public internet with a rate limit in
     * front of it and nothing else.
     *
     * It does NOT affect the tokens this stack issues: `newAuthToken()` mints
     * against the collection's own duration and `findAuthRecordByToken()`
     * validates the signature, neither of which consults this rule. Verified
     * against 0.39.9 rather than assumed, because getting it wrong the other way
     * would lock every account out of a feature that looks fine until somebody
     * tries to like a post.
     */
    users.authRule = null;
    // Nothing here ever sends mail, and a box with no SMTP that tries to is a
    // route that fails at the last step. Manage-rule null means only a superuser
    // can change an email or a password at all.
    users.manageRule = null;

    /*
     * Uniqueness, as partial indexes.
     *
     * `WHERE ... != ''` on all three, because an account created through the
     * GitHub door has an empty `google_sub` and the other way round — and a
     * plain unique index treats every one of those empty strings as the same
     * value, so the SECOND account ever created through either door fails to
     * save. The failure looks like "sign-in is broken", weeks after the index
     * looked correct with one account in the table.
     */
    users.indexes = [
      'CREATE UNIQUE INDEX `idx_users_google_sub` ON `users` (`google_sub`) WHERE `google_sub` != \'\'',
      'CREATE UNIQUE INDEX `idx_users_github_id` ON `users` (`github_id`) WHERE `github_id` != \'\'',
      'CREATE UNIQUE INDEX `idx_users_handle` ON `users` (`handle`) WHERE `handle` != \'\'',
    ];

    app.save(users);

    // ---------- settings ----------

    /*
     * The operator's switchboard: one row per tunable, each carrying its own
     * description, so the dashboard IS the documentation for what a number does
     * and what breaks when it is wrong.
     *
     * Every hook carries its own default for every key independently (see
     * `DEFAULTS` in lib/openscreengen.js), so a deleted or mistyped row falls back to
     * working behaviour with a warning in the log rather than to zero. That
     * duplication is deliberate: the rows are what an operator can change, and
     * the code is what the box does when nobody has.
     */
    const settings = new Collection({
      type: 'base',
      name: 'settings',
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        { type: 'text', name: 'key', max: 64, required: true },
        // Required, so a row cannot be created blank — which is why the
        // placeholder below is the word `unset` rather than an empty string.
        { type: 'text', name: 'value', max: 2048, required: true },
        // 512 is the cap, and a seed that exceeds it does not warn, it throws.
        // Clamped to 500 below for that reason.
        { type: 'text', name: 'description', max: 512 },
      ],
      indexes: ['CREATE UNIQUE INDEX `idx_settings_key` ON `settings` (`key`)'],
    });
    app.save(settings);

    const seed = [
      [
        'enabled',
        'true',
        'The master switch for the whole community feed. Off makes every /api/osg route answer 503 and the editor hides Discover entirely; the editor itself is unaffected, because nothing about designing or exporting touches this box. Anything that is not the literal word "false" is on.',
      ],
      [
        'writes_enabled',
        'true',
        'Posting, commenting, liking, saving and following. Off leaves the feed fully readable and refuses every write with 503, which is the setting to reach for while moderating or migrating rather than switching the whole feature off.',
      ],
      [
        'signin_enabled',
        'true',
        'The two token-exchange routes. Off stops new sessions being minted; tokens already issued keep working until they expire, so this closes the door without signing anybody out.',
      ],
      [
        'google_client_ids',
        'unset',
        'Which Google OAuth clients this box accepts an access token from, comma separated. The web client id and, if the desktop build signs in, the desktop one. Leave it at unset and the Google door answers 503: an empty allowlist means nobody has told this box which project it belongs to, and accepting any audience would let anybody\'s Google app mint accounts here.',
      ],
      [
        'github_client_ids',
        'unset',
        'Which GitHub OAuth apps this box accepts a token from, comma separated. Read from the X-OAuth-Client-Id header GitHub puts on its own API responses, so it cannot be claimed by the caller. Leave at unset and the GitHub door answers 503.',
      ],
      [
        'github_allow_pat',
        'false',
        'Accept a personal access token, which carries no client id and so proves only that somebody holds A GitHub token, not that they got it from this app. The editor offers a pasted token when its sign-in Worker is not configured, so turning this on is what makes that path work. Only the literal word true turns it on.',
      ],
      [
        'avatar_fetch_enabled',
        'true',
        'Download the provider avatar into this box at sign-in, so the feed never asks Google or GitHub for a picture and never shows them who is reading it. Off leaves accounts with the initials chip, which is what everybody without a picture already gets.',
      ],
      [
        'feed_page_size',
        '12',
        'How many posts one page of the feed answers with when the client does not ask for a size.',
      ],
      [
        'feed_max_page_size',
        '48',
        'The largest page a client can ask for. It is the bound on how much one request can cost, so raising it a lot is how a feed read becomes a way to make this box work hard.',
      ],
      [
        'feed_rank_window',
        '400',
        'How many recent posts the For you and Trending tabs rank over. Those two orders are computed in the hook rather than by the database, because both decay engagement by age and neither is a column SQLite can sort by. This is the bound on that work: posts older than the newest N are not ranked, they are simply not in those two tabs. Newest, Top, Saved and Yours are ordered by the database and see everything.',
      ],
      [
        'feed_max_following',
        '200',
        'How many followed accounts the Following tab reads posts from. Past this the oldest follows drop out of that tab; the follow itself is unaffected.',
      ],
      [
        'max_posts_per_day',
        '10',
        'How many posts one account may publish in 24 hours. The real bound on flooding the feed, and the one to lower first if somebody does.',
      ],
      [
        'max_comments_per_hour',
        '30',
        'How many comments one account may write in an hour.',
      ],
      [
        'max_images_per_post',
        '6',
        'Screens per post, cover strip included. The share form sends at most five boards plus one strip, so this is that plus nothing.',
      ],
      [
        'max_image_bytes',
        '4194304',
        'The cap on one uploaded screen, in bytes. The collection carries the same cap independently, so lowering this alone tightens it and raising it alone does not loosen it.',
      ],
      [
        'official_handle',
        'openscreenshot',
        'The handle the showcase seeder posts under. Its posts are the ones that carry the verified check, and it is the one account in the feed that is not a person.',
      ],
      [
        'moderation_note',
        'unset',
        'Free text shown under an empty feed, for saying that posts are reviewed or that the feed is new. The word unset hides the line.',
      ],
    ];

    for (const [key, value, description] of seed) {
      /*
       * Idempotent, and every save caught.
       *
       * A settings seed is never worth an outage. Migrations run at boot inside
       * a transaction: one that throws rolls back, PocketBase exits, docker
       * restarts it and it throws again — a restart loop with the whole feed
       * down. The neighbouring project took the box off the air exactly this way
       * on 8 Aug 2026 over a description that was four characters too long.
       *
       * Losing a seed row here is cheap, because lib/openscreengen.js carries a default
       * for every key: an unseeded setting behaves exactly as the seeded one
       * would and can be typed into the dashboard afterwards. The COLLECTIONS
       * and the COLUMNS are the parts that have to land, and they are the parts
       * left un-caught above.
       */
      try {
        let existing = [];
        try {
          existing = app.findRecordsByFilter('settings', 'key = {:key}', '', 1, 0, { key: key });
        } catch {
          existing = [];
        }
        if (existing.length) continue;
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
     * Down. The settings collection goes; the fields on `users` stay.
     *
     * Dropping a column drops what is in it, and `google_sub` plus `handle` are
     * the only things tying a row in this database to a person. Re-running `up`
     * would create the columns empty and every account on the box would be a
     * stranger to its owner on their next sign-in — a new account, with their
     * posts still attached to the old row. A down migration is for undoing a
     * schema change, not for throwing away identities.
     */
    try {
      app.delete(app.findCollectionByNameOrId('settings'));
    } catch {
      // never created, or already gone
    }
  }
);
