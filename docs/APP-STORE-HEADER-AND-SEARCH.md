# App Store header and search art

With iOS 27, Apple added two new pieces of art to every app's page on the App Store.

The **header** is a wide banner across the top of your app's page, above its icon and name.

The **search result** art shows under your app when someone finds it in App Store search, where the first three screenshots used to be.

You can also make one **universal** image that Apple uses in both places.

Both are optional. If you don't add them, the App Store shows your screenshots as before. The new art shows on iPhones and iPads with iOS 27 or iPadOS 27 and later.

## Make the art

1. Open the project with your App Store screenshots.
2. In the toolbar, click the **+** button at the far left (or just rest your mouse on it), then pick **App Store header and search art**. While your project has no header or search art, the store listing preview has a button for it too.
3. Check the **App name** box at the top. It's filled in from your project's name, so change it if your app is called something else on the App Store. If the box is empty, type your app's name.
4. Pick a design for the header and one for the search result. Every design is made from your own project: its colours, fonts, headline and screenshots. Turn on **Show what an iPhone shows** to see how much of each design an iPhone cuts off. To make a single image for both places, click **One universal image** instead.
5. Click **Add 2 artboards** (or **Add 1 artboard** for a universal image).

The art appears at the start of your canvas as new artboards (the frames you design on), already at the size Apple asks for. You can edit them like any other artboard: change the words, move things around, swap a screenshot. Changing the canvas size later changes only your screenshots. The art keeps Apple's size.

Want to test two versions on the App Store? Add the art a second time, or duplicate an artboard and change it. Every version exports, and none replaces another.

### From the sidebar

The **Header** tab in the left sidebar, next to **Previews**, shows all the designs at once, made from your project. Type your app's name at the top of the tab, then:

- click a design to add it at the start of your canvas, or
- drag it onto the canvas to put it right after the artboard you drop it on. On a phone or tablet, hold your finger on a design for a moment, then drag it. Changed your mind? Let go anywhere outside the canvas and nothing is added.

The tab adds one design at a time. To add a header and a search result together, use the toolbar's **+** button instead.

## Keep your words inside the green box

Different iPhones and iPads cut off different parts of the art. Only the middle shows on every device, and an iPhone held upright shows little more than that middle part of the header.

- The **green dashed box** marks the part every device shows. Apple calls it the safe area. Keep your words and logo inside it.
- Everything outside the box is shaded. Some devices show it and some cut it off, so use it for colour and pictures, not for words.
- On the header, two **dashed circles** at the top corners mark where the iPhone puts its back and share buttons. Anything under them is covered.

These guides never show up in the exported art. To hide them, turn off **Show the safe area** in the check list (see below), or in **Settings**.

## Check it before you upload

Next to the name of each header and search artboard is a small label, for example **Header Ready**. It checks the art against Apple's rules while you work.

- **Green, "Ready"**: it found nothing.
- **Amber, "1 to check"**: something that may cause trouble, or may be hard to see on a phone. Take a look.
- **Red, "1 to fix"**: something Apple's rules don't allow. Change it before you upload.

Click the label to see the list. It looks for:

- prices and sales, like "$4.99", "50% off" or "free trial"
- web addresses
- the copyright sign ©
- Apple's own awards, like "Editors' Choice" or "App of the Day"
- other stores and platforms, like Google Play or Android
- claims Apple can't check, like "#1", "the best app", "1M+ users" or star ratings
- words outside the green box, under the iPhone's buttons, too small to read on a phone, or cut off by their own text box
- more than about ten words, since Apple asks for a short phrase
- a language that still shows your original words
- the wrong size

The check only reads words, not pictures, and it can be wrong both ways: it can miss a price written out in words, or flag a harmless word. That's why anything it isn't sure about is amber, not red. It's a helper: Apple's reviewers make the final call.

## See it on the App Store

Click the **Preview** button (the eye), then **Store listing**. You'll see your app's page the way an iPhone with iOS 27 shows it: your header at the top, your icon and name under it, then your screenshots. Click **Search results** to see the search result art, and **Light** or **Dark** to switch the phone's look.

The preview is close, but not exact. Apple doesn't say how much of the art each device cuts off, so the app estimates it. When the preview and the green box disagree, trust the green box.

After you upload, App Store Connect (Apple's site for managing your app) has its own preview, with iPad and landscape too. The preview in this app shows iPhone only.

## More than one language

If your project is in several languages, the header and search art come in all of them.

- The headline uses the translations you already made for your screenshots.
- The screenshots inside the phones change with the language, if you added a screenshot for each language.

Use the language menu in the toolbar to look at each language. The check label always checks the language on screen. If it says "Not translated into German", some words still show in your original language. Translate them the same way you translate your screenshots.

Sometimes a screenshot's headline is made of several pieces of text, for example one word in a different colour. The art joins them into one headline. In a language where only some of the pieces are translated, the art keeps your original headline and the check tells you, so you never end up with half of each language.

## Export

Click **Export**, then **Artboards as images**, then **Export** in the window that opens. The header and search art export with your screenshots, each at its own size, as a PNG without transparency, which is what App Store Connect asks for.

Each file is named for where it goes and has no number, so your screenshots still start at 01:

```
AppStore_Header_3840x1646.png
AppStore_SearchResult_3840x2560.png
01_Home_iPhone_iPhone-6_3-Portrait_1206x2622.png
```

- If you have two headers, the second one's file ends in `_2`, so neither replaces the other.
- If you renamed an artboard, say to "Winter", that name goes in the file name: `AppStore_Header_Winter_3840x1646.png`.
- With several languages, the desktop app makes a folder for each language, named with its code (`de-DE` is German). The web version puts the code at the start of each file name instead: `de-DE_AppStore_Header_3840x1646.png`.

The extra iPhone and iPad sizes in the export window are for screenshots. They don't change the header or search art.

## Upload it

1. Open your app in App Store Connect.
2. On the version page, add the files under **Header and Search Results**. Or add them on their own in the **Asset Library**. Apple reviews them there, and you can change them later without sending a new version of your app.
3. If you made one universal image, tick **Use header asset in search results**.

The desktop app's store upload sends only screenshots and preview videos for now, so add this art in App Store Connect yourself.

## Sizes

The app sets these for you. They're here in case you need them.

| Art | Size in pixels | File type |
| --- | --- | --- |
| Header | 3840 x 1646 | PNG or JPEG |
| Search result | 3840 x 2560, or as small as 1920 x 1280 | PNG or JPEG |
| Universal | 5244 x 2950 | PNG only |

None of them may have transparent parts. Apple also takes a short looping video for the header and the search result, which the app can't make yet.

## AI assistants

If you use an AI assistant with the app, it can make header and search art too, and the app tells it where the green box is.

---

For developers: how this is built, Apple's exact numbers and the research behind it are in the [developer notes](APP-STORE-HEADER-AND-SEARCH-NOTES.md).
