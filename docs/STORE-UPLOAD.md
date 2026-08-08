# Upload screenshots straight to the stores

The editor can hand your finished artboards to App Store Connect and Google Play without
downloading a single PNG. It uses **your own developer credentials**, talks to Apple and Google
directly from your machine, and there is no server of ours anywhere in the path.

Desktop app only. Apple's API sends no CORS headers, so a browser tab is physically unable to call
it; the desktop build routes these requests through its native layer instead. The web build shows a
short explanation and a download link in the same dialog.

## Where to find it

The storefront icon in the toolbar, next to the export button. The export dialog also has an
"Upload to the store instead" link.

## What it does

1. Renders the artboards you tick, at the pixel size you choose, exactly as the PNG export does
2. Works out which store slot each image belongs in, from its real dimensions
3. Uploads them into the app, version and language you picked
4. Reports what the store did with them, including anything it rejected

Your project is never modified. Choosing a different size converts the canvas in memory, captures
it, and puts the original back.

## App Store Connect

### Getting a key

1. Open [App Store Connect > Users and Access > Integrations > App Store Connect API](https://appstoreconnect.apple.com/access/integrations/api)
2. Create a **team key** with the **App Manager** or **Developer** role
3. Copy the **Issuer ID** from the top of the page
4. Note the **Key ID** and download the `AuthKey_XXXXXXXXXX.p8` file, which Apple lets you download
   only once

The dialog lists these steps too, so you do not need this page open while you do it. Paste all
three values, or use "Choose file" for the .p8, in which case the key id fills itself in from the
file name.

### What you can upload to

Screenshots live on a specific **version** in a specific **language**. The dialog lists your apps,
then that app's versions (versions that Apple will not let you edit are greyed out), then the
languages that version has. Pick the trio and upload.

### If the app is in review

Apple freezes screenshots the moment a version is submitted. While a version is Waiting for Review
or In Review, only a few fields stay editable (support URL, marketing URL, promotional text), and
screenshots are not among them. So an app sitting in review will **not** have its screenshots
replaced: the version is listed but greyed out, nothing is preselected, the Upload button stays
disabled, and the dialog tells you why.

To change them you either remove the version from review in App Store Connect, which puts it back
in an editable state, or add a new version and upload there. A version that is already live
(Ready for Distribution) is the same story: screenshots belong to a version, so changing them means
a new version.

### Sizes Apple accepts

Every screenshot goes into a set tagged with a display type, and the dimensions have to match that
type exactly. The dialog resolves the display type from the image itself and tells you before you
upload if a board is not an accepted size.

| Display type | Accepted sizes | Notes |
| --- | --- | --- |
| iPhone 6.9-inch and 6.7-inch | 1290x2796, 1320x2868 | Required for every iPhone app |
| iPad 13-inch | 2064x2752, 2048x2732 | Required if the app runs on iPad |
| iPad 11-inch | 1668x2420, 1668x2388 | Optional, Apple scales the 13-inch shots down when empty |
| Mac | 2560x1600, 2880x1800, 1440x900, 1280x800 | What the Mac templates produce |

Smaller iPhone and iPad tiers, Apple Watch, Apple TV and Vision Pro are supported too. Landscape
counts as the same display type for iPhone and iPad, so a rotated board still lands correctly.

If a board is the wrong size, switch the **Size** dropdown to the store size you want. It converts
the canvas and the mockups the same way the Devices menu does.

Apple keeps at most **10 screenshots per display size**. "Replace what is already there" decides
what happens to the ones already on the version:

- **Off** (the default): yours are added alongside them. If the total would pass 10 for a size, the
  upload is refused before anything is sent
- **On**: the screenshots currently on that version are deleted first, for each size you are
  uploading, and yours take their place

It starts off because adding is recoverable and deleting is not.

The dialog spells out both, so the choice does not have to be guessed at.

### After the upload

Apple processes assets asynchronously, and a bad file fails there rather than at upload time, so
the dialog waits for the result and reports any screenshot the App Store dropped. If processing is
still running after 90 seconds it says so instead of pretending it finished.

## Google Play

### Getting a key

Play authenticates a service account, not a person:

1. In [Google Cloud Console](https://console.cloud.google.com/apis/library/androidpublisher.googleapis.com)
   create or pick a project and enable the **Google Play Android Developer API**
2. Still in Google Cloud, open **IAM & Admin > Service Accounts** and create one. This is the step
   people hunt for: service accounts are **not** under APIs & Services, where you just enabled the
   API. Direct link: [console.cloud.google.com/iam-admin/serviceaccounts](https://console.cloud.google.com/iam-admin/serviceaccounts)
3. Open the new account, go to its **Keys** tab, then **Add key > Create new key > JSON**. That
   downloads the file this dialog wants. You can skip the optional "grant this service account
   access to the project" step, because Cloud IAM roles are not what grants Play access
4. Copy the account's address, then in Play Console open **Users and permissions**, click
   **Invite new users**, and paste it in. The address is the **Email** field on the account's
   **Details** tab (not the numeric id in the breadcrumb) and looks like
   `name@your-project.iam.gserviceaccount.com`. It is also inside the JSON as `client_email`, and
   once you load that file the dialog shows it with a copy button, so you never have to go back
   to Google Cloud for it
5. Under **App permissions** add the app, tick the **store presence** permissions (that group is
   what covers the listing), then click **Invite user** at the bottom. The invite is not applied
   until you click that button
6. Back in the dialog, load the JSON and enter the package name

Two things that trip people up, both because older guides still describe them:

- **There is no "Setup" menu any more.** API access moved, and the steps above no longer need it.
  Everything you have to do in Play Console happens under **Users and permissions**, which is in the
  left sidebar.
- **You no longer link a Google Cloud project to your developer account.** Google
  [dropped that requirement](https://developers.google.com/android-publisher/getting_started).
  Enabling the API on any Cloud project and inviting the service account is enough.

Then paste the JSON (or pick the file) and type the app's package name. Play has no list-apps API,
which is why the package name is typed rather than chosen.

### Slots and sizes

Play calls the destinations image types. The dialog suggests one from the board size and lets you
change it:

| Slot | Limit |
| --- | --- |
| Phone screenshots | 8, at least 2 required to publish |
| 7-inch tablet, 10-inch tablet, Wear OS, Android TV screenshots | 8 each |
| Feature graphic | 1, exactly 1024x500 |
| App icon | 1, exactly 512x512 |
| Android TV banner | 1, exactly 1280x720 |

Play's screenshot rules are: every side between 320 px and 3840 px, the long side no more than
twice the short side, and 8 MB per image. A 1290x2796 iPhone board is 2.17:1 and Play refuses it,
so switch the **Size** dropdown to "Android phone 1080x1920" first. The dialog flags this on the
board before you upload rather than letting Play reject it later.

The Google Feature Graphic templates already produce 1024x500, so those upload to the feature
graphic slot untouched.

### If the app is in review

Play has no per-version screenshot lock the way Apple does. The store listing is one live document,
editable at any time, and an upload commits an edit against it. The change then goes through Play's
own review before it is visible, so a release already in review does not block the upload; the
listing change queues alongside it.

This is the one real difference between the two stores here: with Apple an in-review version simply
cannot be touched, with Play the upload goes through and waits for review.

### How the upload is applied

Play stages everything in an **edit**, which is a transaction over the listing. The editor opens
one, clears the slot if you asked it to, uploads the images, validates, and commits. Nothing is
visible until the commit, and a failure discards the edit, so a half-finished run leaves your
listing exactly as it was.

Some accounts refuse to have changes sent for review automatically. Play says so in the error and
the editor retries the commit with `changesNotSentForReview`, then tells you the changes are staged
and waiting for you to submit them in Play Console.

## Where the keys are stored

In `localStorage` on that machine, unencrypted, under
`open-screenshot-generator.store-credentials`. The same place and the same honesty as the AI
provider keys and the account session: there is no server to hold them, and a webview has no
keychain. Use "Change" in the dialog to replace them.

An App Store Connect key can create and delete metadata on your apps, and a Play service account
can publish to your listing. Treat both like the credentials they are, and revoke them in App Store
Connect or Google Cloud if a machine is lost.

## Troubleshooting

**"Check the issuer id, the key id, the .p8 file, and that the key has the App Manager or Developer
role"** covers every 401 and 403 from Apple, because a wrong key and a key without permission look
identical from outside. Re-copy the issuer id first, it is the field people mistype.

**Play returns 403** when the service account was never invited in Play Console, or when the Google
Play Android Developer API is not enabled on the Cloud project. Both are one-time setup steps and
both are easy to miss.

**Play returns 404** for a package name typo, and also for an app that has never had a release:
Play refuses API edits until the app has been published at least once.

**A screenshot uploads but the App Store drops it** during processing. The dialog reports Apple's
own reason. It is almost always a size that does not match the display type, which the pre-upload
check catches unless the board was already an accepted size for a different tier.
