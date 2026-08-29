---
name: store-compliance
description: >-
  Checks that rendered store assets will actually be accepted, and then ships them, using the
  open-screenshot-generator CLI: `osg verify` audits the produced PNGs and MP4s against App Store and
  Google Play rules (required size tiers, accepted alternatives, per locale caps, transparency, file
  size, aspect ratio, preview duration) and exits 3 on a failure, and `osg upload` pushes the set to
  App Store Connect or Google Play with the user's own developer credentials. Use this whenever
  someone asks whether their screenshots meet the store requirements, what sizes they need, why App
  Store Connect rejected an image, how many screenshots are allowed, or says things like "check these
  are valid", "upload to App Store Connect", "push to Play", "is this ready to submit" or "the store
  rejected my screenshots".
license: MIT
metadata:
  package: open-screenshot-generator
  homepage: https://openscrgen.app
---

# Ship readiness: verify, then upload

**The end state**: `osg verify` exits 0, `osg/osg.manifest.json` describes every file that exists, and
either the set is uploaded to the right listing or the user has an exact list of what to fix.

Run `verify` before every upload, without exception. Both stores accept an upload and then fail it
asynchronously, App Store Connect hours later during asset processing, and a failure at that point
gives you a state code rather than an explanation.

## The exit codes are the contract

| Code | Meaning | What to do |
| --- | --- | --- |
| 0 | everything passed | ship it |
| 1 | usage, config or environment | fix the config or the machine, nothing was produced |
| 2 | the browser, the page or a tool call failed | a render problem, re-run with `--verbose` |
| 3 | the files exist and a store rule rejects them | fix the named rule and re-render |

```bash
npx -y open-screenshot-generator@0 verify
npx -y open-screenshot-generator@0 verify --json
```

`--json` prints one machine readable object with a row per finding, which is what to use in CI and
what to parse when reporting back.

## What verify checks, and what each failure means

| Finding | What it means | Fix |
| --- | --- | --- |
| Missing tier | a format in `formats` produced no file | re-run `render`, or drop the tier from the config |
| Wrong pixel size | the board size is not an accepted size for that tier | set the artboard to the preset, or change `formats` |
| Too many images | more than the store's cap for that slot and locale | drop boards, the first two are what people see anyway |
| Too few images | under the store's floor (Play needs 2 phone shots) | add a board |
| Transparency | the PNG carries an alpha channel | give the board an opaque background, then re-render |
| File too large | over the store's per image limit | reduce visual complexity, or render the smaller accepted size |
| Aspect ratio | Play's long side is more than twice the short side | render the Play tier, not the iPhone tier, see below |
| Locale gap | one language has fewer boards than the base | the missing boards did not render, check the locale list |
| Placeholder copy | a headline still says the template's text, or a board is still named "Blank Artboard" | rename the board and write the copy, the board name becomes the file name |
| Empty device frame | a device slot still holds shipped placeholder art | place the app's real screenshot in it |
| Video duration | outside 15 to 30 seconds | `set_preview_duration`, or `video.duration` |
| Video dimensions | not 886x1920 or 1920x886 | re-render, the size is forced by the mode |
| Video codec | not H.264 | the browser has no H.264, see **app-preview-video** |

Placeholder copy and an empty device frame are not store rules. They are the two failures that
actually get shipped, so `verify` treats them as failures too.

## App Store: required tiers and accepted alternatives

You do not need every size. Apple scales the required tier down to the smaller ones.

| Slot | Required size | Also accepted | Status |
| --- | --- | --- | --- |
| iPhone 6.9 inch | 1290x2796 | 1320x2868 | required for every iPhone app |
| iPad 13 inch | 2064x2752 | 2048x2732 | required if the app runs on iPad |
| Apple Watch | 422x514 | 410x502, 416x496, 396x484, 368x448, 312x390 | required for a watch app |
| Mac | 2560x1600 | 2880x1800, 1440x900, 1280x800, always 16:10 | required for a Mac app |
| Apple TV | 1920x1080 | 3840x2160 | required for a tvOS app |
| Apple Vision Pro | 3840x2160 | | required for a visionOS app |

Older iPhone and iPad slots (6.5 inch, 6.3 inch, 5.5 inch, 4.7 inch, iPad 11 inch, 10.5 inch, 9.7
inch) still exist and are optional. Fill them only if the user asks. Every iPhone and iPad slot also
accepts the rotated size, so a landscape app renders the same tier sideways. Watch, Mac, TV and
Vision are one orientation only.

Caps and formats:

- **10 screenshots** maximum per display type per localization, and at least one is required.
- **3 App Previews** maximum per localization per device family.
- PNG or JPEG, RGB, flattened. No transparency.
- The pixel size has to be exactly one of the sizes that display type accepts. Nothing is resized for
  you, and a size that is close is not accepted.

## Google Play: slots and limits

| Slot | Size rule | Count |
| --- | --- | --- |
| Phone screenshots | 320 to 3840 px per side, long side at most 2x the short side | 2 to 8, at least 2 required |
| 7 inch tablet | same rule, 1200x1920 recommended | up to 8 |
| 10 inch tablet | same rule, 1600x2560 recommended | up to 8 |
| Wear OS, Android TV | same rule | up to 8 each |
| Feature graphic | exactly 1024x500 | 1, required on every listing |
| App icon | exactly 512x512 | 1, required to publish |
| Android TV banner | exactly 1280x720 | 1 |

PNG or JPEG, 8 MB maximum per image.

**Play's aspect rule blocks the iPhone canvas.** 1290x2796 is 2.17:1, and Play needs the long side to
be at most twice the short side. Play rejects it. Use the `play-phone` preset (1080x1920) for the
Play tier rather than re-uploading the App Store files. That rule is Google's, verified in their own
docs, and it is not negotiable.

Play also wants a promo video as a **YouTube URL**, not an uploaded file. The `styled` video mode
produces a good file for that, but you upload it to YouTube and paste the link into Play Console.

## Uploading

```bash
npx -y open-screenshot-generator@0 verify && npx -y open-screenshot-generator@0 upload
```

The upload uses the user's own developer credentials and talks to Apple and Google directly. No
server belonging to this project is involved at any point.

### Credentials, handled safely

Rules, in priority order:

1. **Never put a key in `osg/osg.config.ts`.** That file is committed. There is no credential field in
   it, on purpose.
2. **Never paste a key into a command line.** It lands in shell history and in your transcript.
3. **Point at a file, and gitignore the file.** Apple's key is a `.p8`, Google's is a service account
   JSON. Add both to `.gitignore` before you download them.
4. **Never echo, cat or print a key file**, and never read one into your own context to "check it".
   You do not need to see it to use it.
5. If the user pastes a key into the conversation anyway, tell them to rotate it.

Set the environment variables the CLI documents, then run the command. Confirm the exact names with
`osg upload --help` for the release in use:

```bash
export OSG_ASC_ISSUER_ID=...          # App Store Connect API issuer id, a UUID
export OSG_ASC_KEY_ID=...             # the key id
export OSG_ASC_KEY_FILE=./secrets/AuthKey_XXXX.p8
npx -y open-screenshot-generator@0 upload
```

```powershell
$env:OSG_ASC_ISSUER_ID = '...'
$env:OSG_ASC_KEY_ID    = '...'
$env:OSG_ASC_KEY_FILE  = './secrets/AuthKey_XXXX.p8'
npx -y open-screenshot-generator@0 upload
```

PowerShell has no inline environment prefix, so `VAR=x command` does not work there. Set them on
their own lines, as above.

For Google Play, one variable pointing at the service account JSON:

```bash
export OSG_PLAY_KEY_FILE=./secrets/play-service-account.json
npx -y open-screenshot-generator@0 upload --store play
```

The Apple key needs the **App Manager** role. The Play service account has to be invited in Play
Console **and** the Android Developer API has to be enabled on the project.

### What each store actually does with the upload

**App Store Connect** reserves each asset, uploads it in chunks to pre signed URLs, then commits it
with a checksum. Every one of those calls returns 2xx for a wrong sized image. Apple then processes
the asset asynchronously and it fails minutes to hours later. The upload therefore polls the delivery
state and reports what Apple actually concluded, which is the only reason it can be trusted when it
says the upload worked. Do not treat a fast success message from any other tool as acceptance.

Screenshots hang off a set scoped to (version, localization, display type), so a mixed project is
grouped by resolved display type and each group gets its own set.

**Screenshots are frozen once a version is submitted.** Only a version in an editable state accepts
them, and writing to one in review comes back 409. The version has to leave review first. Nothing is
preselected for you, because arming an upload against a frozen version is worse than asking.

**Google Play** opens a staged edit, uploads into `listings/<language>/<imageType>`, validates, then
commits. Nothing is public until the commit, and a thrown error discards the whole edit, so a failed
run cannot leave a half updated listing. Some accounts refuse automatic review submission and say so
in the commit error; the client retries without sending for review and reports that it did.

## Troubleshooting

**Apple returns 401 or 403.** Either the key is wrong or the key does not have the App Manager role.
The two are indistinguishable in practice, so check both rather than guessing.

**Play returns 403.** Almost always setup, not code: the service account was never invited in Play
Console, or the Android Developer API is not enabled.

**Play returns 404.** A package name typo, or an app that has never been published. Play refuses API
edits before the first release.

**Apple accepted it and then the screenshot disappeared.** The asset delivery state went to FAILED.
That is a size or a format problem, and `osg verify` catches every case of it before the upload.

**"This version cannot be edited."** It is in review or already released. Create the next version in
App Store Connect first.

**Verify passes and the store still complains about content.** The mechanical rules are what `verify`
covers. Review guidelines are not mechanical: do not show a device frame inside the screenshot of a
different device, do not show competing platforms' branding, do not put an award or a rating in the
image that the app did not earn, and do not show UI that is not in the shipped build. Those are
human review calls and they are also the ones that cost a week.

**A screenshot shows content that is not in the build.** That is the most common human review
rejection of all. If the design invented a stat, a chart or a testimonial, change it.

## Related skills

- **store-screenshots** for producing the set in the first place
- **app-preview-video** for the video rules, which are stricter than the image rules
- **store-localization** for per locale caps and folders
- **editor-tools** for fixing what `verify` flagged, one element at a time
