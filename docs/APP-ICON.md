# App icon

Your app icon is the first thing people see on their phone and in the stores. Here you design the icon once, on the same canvas as your screenshots. You can see how the icon looks on an iPhone, an Android phone and a Mac, and then save every size Apple and Google need in one go.

## Make the icon

1. Open your project.
2. Click the **+** button at the far left of the toolbar, then click **App icon**.
3. Check the **App name**. If you leave it empty, your project's name is used, shown in grey. The name appears under the icon in the previews, and each project keeps its own.
4. Pick a starting design. Each one uses your project's colours and fonts:
   - **Letter**: the first letter of your app name, on your colours.
   - **Ring**: your letter with a soft ring behind it.
   - **Badge**: your letter on a rounded square. In dark mode, iPhone shows just the letter.
   - **Light**: your colour on a white background.
   - **Initials**: two letters, or the whole name if the name is short.
   - **Your logo**: click it and pick a picture of your logo (PNG, JPEG, WebP or SVG). A logo with a see-through background goes in the middle of the icon. A square picture with no see-through parts is used as the whole icon.
5. Click **Add icon**.

The icon appears at the start of your canvas as a new square artboard called **App icon**. You can change it like any other artboard: the colours, the letter, the font, or add shapes and pictures. If you change the canvas size later, only your screenshots change. The icon stays the same size.

## The lines on the icon

Two lines sit on top of the icon artboard. They're never saved into your icon files.

- The **blue line** shows the rounded corners iPhone cuts every icon to. Anything in the shaded corners won't show on an iPhone.
- The **green dashed circle** shows the part every Android phone keeps. Some phones show icons as circles, so keep your letter or logo inside the circle.

To hide the lines, turn off **Guides** on the small preview, or turn off **Show the guides on the app icon** in Settings.

## Front and back

Every icon has a front and a back. Android moves the front a little when someone touches the icon. In dark mode, iPhone shows only the front, on a dark background of its own.

- The **back** is the artboard's colour or picture, plus anything you put in the back.
- The **front** is everything else, like your letter or logo.

To move something to the back, select it and pick **Back** under **Icon layer** in the Properties panel. Anything in the back is always drawn behind the front, so the canvas shows the icon the way it will look.

## See how it looks

While the icon artboard is selected, a small preview in the bottom right corner shows the icon on a phone: in light, dark and tinted mode, and on Android. The preview changes as you edit.

Click **Preview and export** on the small preview, or the **App icon** label under the artboard, to open the icon window:

- **iPhone**: a home screen with your icon, in **Light**, **Dark** or **Tinted**, with a choice of colours and wallpapers.
- **Android**: a home screen in **Light**, **Dark** or **Themed**, with the icon shapes different phones use: **Circle**, **Soft square**, **Rounded square** and **Teardrop**. Turn on **Show the part no phone cuts off** to see the circle.
- **Mac**: your icon on a Mac desktop and in the Dock.
- **Stores**: your icon in the App Store and on Google Play.

**Actual size** shows the icon as small as the phone shows it, from the home screen down to notifications, so you can tell if it's still clear. The other icons in these previews are blank on purpose.

Your icon also shows in the store page preview (the eye button in the toolbar).

## Before you export

The icon window checks your icon and tells you what to look at:

- **See-through parts.** The App Store doesn't accept see-through icons. **Fill with white** gives the icon a white background.
- **Nothing in front, or the front fills the whole icon.** Then the dark, tinted and Android themed icons would be empty or just a square. The button moves the picture that fills the icon to the back.
- **Android may cut off part of your icon.** Some Android phones show icons as circles. **Show me** opens the Android preview with the circle drawn on it.
- **Hard to see in dark mode.** If your icon is dark, it disappears on iPhone's dark background. **Make the icon white in dark mode** fixes that. If your letter sits on a big shape, you can also move the shape to the back and make the letter white. Each button shows a small picture of how the dark icon will look, so pick the one that looks right. You can also choose **Your colours** or **White** under **Dark and tinted icons**.
- **Small words and thin lines.** Words and lines that are tiny on a phone are hard to see. **Select the words** or **Select the shape** takes you to it on the canvas.

## Export

Tick what you need:

- **iPhone and iPad**: the icon files for your iPhone and iPad app, with the dark and tinted icons.
- **Android**: the icon files for your Android app, in every size Android phones need, including the one-colour icon for themed home screens.
- **Google Play**: the picture for your Google Play store page.
- **Mac**: the icon files for your Mac app.
- **Front and back as two pictures**: for Apple's Icon Composer app, which makes the new glass look in iOS 26 and later.

Then:

- **On the web**, click **Download a zip**. The zip has one folder with every file, and a README file that says where each file goes.
- **In the desktop app**, click **Export icons** and pick one:
  - **Put the icon in my app**: pick the folder with your app's code. The app looks for your iPhone and Android icons inside and lists them. Your app's main icon is ticked when there's no doubt which one it is. If the folder has more than one app, or some folders couldn't be opened, nothing is ticked and the list says why. Tick the places you want, then click **Replace the icon**. The old icon files there are replaced, so keep your project in git if you want the old files back. Old Android icon files in another format, like the .webp files Android Studio makes, are removed too, because Android won't build with two of each. If anything goes wrong, every file is put back the way it was, and the message says if one couldn't be.
  - **Save to a folder**: pick a folder, and every file goes into a new folder named after your app.
  - **Save as a zip**: pick where to save one file, the same zip as on the web.

  Either way, the files are saved all at once or not at all: if something goes wrong, what was there before stays as it was. If an old file couldn't be removed afterwards, the app tells you which one to delete.

While the files are being made, the bottom of the side panel shows how far it's got. Click **Stop** there and nothing is saved. Once the files are made, saving them takes a moment and can't be stopped halfway, so it says **Saving the files** until the app tells you how it went.

If you save into the same folder from two windows, or from two copies of the app (like the Mac App Store app and the one you download), the second save waits for the first to finish. It waits at most 30 seconds, then tells you to try again in a moment.

Some drives can't lock a folder, like some network drives. The app doesn't put the icon into a folder there, or save a folder of icons there, because it couldn't keep another save out of it, and the message says so. Save into a folder on your computer instead, then copy the files over.

**Save as a zip** needs no lock: the app writes the whole new zip first, then swaps it in for the old one in one step, so nobody ever opens half a zip. If the app can't swap a zip in somewhere, it tells you and saves nothing, and the old zip stays as it was.

### Where the files go

- **iPhone and iPad**: in Xcode, replace **AppIcon** in your project's **Assets.xcassets** with the **AppIcon.appiconset** folder.
- **Android**: copy the **mipmap** folders into your app's **res** folder, usually **app/src/main/res**. The themed icon needs Android 13 (compileSdk 33) or later.
- **Google Play**: in Play Console, upload **icon-512.png** as the app icon on your main store listing.
- **Icon Composer**: open Icon Composer and drop in **1-background.png** and then **2-front.png** as two groups.
