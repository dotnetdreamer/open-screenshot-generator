# Upload screenshots straight to the stores

The desktop app can export your designs and upload them to App Store Connect or Google Play in one step. It uses your own developer credentials. In the web editor, export the PNG files and upload them through the store's website instead.

## Where to find it

Open the storefront icon beside **Export**, or choose **Upload to the store instead** in the export dialog.

## What it does

Pick the artboards, app, language, and store size before you upload. The editor checks the image sizes and reports any files the store rejects. Your project stays as it was.

## App Store Connect

### Getting a key

1. Open [App Store Connect API settings](https://appstoreconnect.apple.com/access/integrations/api).
2. Create a team key with the **App Manager** or **Developer** role.
3. Copy the **Issuer ID** and **Key ID**.
4. Download the `.p8` key file. Apple only lets you download it once.
5. Enter those details in the upload dialog. If you choose the file, the editor can read the key ID from its filename.

### What you can upload to

Choose the app, an editable version, and a language. Screenshots belong to a particular version and language.

### If the app is in review

If that version is in review or already live, you must use an editable version before you can change its screenshots.

### Sizes Apple accepts

The dialog matches each image to an Apple display size and warns you if its dimensions do not fit. You can change an artboard's **Size** in the dialog before uploading.

| Display size | Accepted image dimensions |
| --- | --- |
| iPhone 6.9-inch or 6.7-inch | 1290x2796 or 1320x2868 |
| iPad 13-inch | 2064x2752 or 2048x2732 |
| iPad 11-inch | 1668x2420 or 1668x2388 |
| Mac | 2560x1600, 2880x1800, 1440x900, or 1280x800 |

The editor also supports smaller iPhone and iPad sizes, Apple Watch, Apple TV, and Vision Pro. Landscape images use the same display types as portrait images.

Apple allows up to 10 screenshots per display size. With **Replace what is already there** off, the editor adds your images and stops if the result would exceed 10. With it on, the editor deletes the existing screenshots for each size you upload, then adds yours. Check this setting before uploading.

### After the upload

Apple may take time to process the files. The dialog waits for a result and reports any image Apple rejects. If processing is still running after 90 seconds, check App Store Connect later.

## Google Play

### Getting a key

1. In [Google Cloud Console](https://console.cloud.google.com/apis/library/androidpublisher.googleapis.com), create or select a project and enable the **Google Play Android Developer API**.
2. Open [IAM & Admin > Service Accounts](https://console.cloud.google.com/iam-admin/serviceaccounts) and create a service account.
3. On that account's **Keys** tab, choose **Add key > Create new key > JSON**. Keep the downloaded file.
4. Copy the account email address. You can find it on its **Details** tab or as `client_email` in the JSON file.
5. In Play Console, open **Users and permissions > Invite new users**. Invite that email address, give it access to your app and its store presence, then click **Invite user**.
6. In the upload dialog, choose the JSON file and enter your app's package name.

Play Console access is granted through **Users and permissions**. You do not need to link the Cloud project to the developer account.

### Slots and sizes

The dialog suggests a destination from each artboard's size. Check it before uploading.

| Image type | Limit |
| --- | --- |
| Phone screenshots | Up to 8; at least 2 to publish |
| 7-inch tablet, 10-inch tablet, Wear OS, or Android TV screenshots | Up to 8 each |
| Feature graphic | One, exactly 1024x500 |
| App icon | One, exactly 512x512 |
| Android TV banner | One, exactly 1280x720 |

For Play screenshots, each side must be 320 to 3840 pixels, the long side can be at most twice the short side, and each image must be at most 8 MB. An iPhone image at 1290x2796 is too tall for Play. Choose **Android phone 1080x1920** in the **Size** menu instead.

### If the app is in review

Play lets you change the listing while an app version is in review. The change still goes through Play's review before it becomes visible.

### How the upload is applied

Play stages the upload, checks it, and commits the change. If the account does not submit changes for review automatically, the dialog tells you to finish that step in Play Console.

## Where the keys are stored

The desktop app saves these credentials unencrypted in local storage on your machine under `open-screenshot-generator.store-credentials`. Use **Change** in the dialog to replace them. If you lose access to the machine, revoke the key in App Store Connect or Google Cloud.

## Troubleshooting

| Message or problem | What to check |
| --- | --- |
| Apple returns 401 or 403 | Check the Issuer ID, Key ID, `.p8` file, and the key's role. |
| Play returns 403 | Check that the API is enabled and the service account was invited in Play Console. |
| Play returns 404 | Check the package name. Play also requires the app to have had a release. |
| Apple accepts a file, then rejects it | Read the reason in the dialog and check that its size matches the selected display type. |
