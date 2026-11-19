# Remove background

Remove background takes the background out of a photo, so a person or a product can sit on your screenshot's own background. Your photos stay on your computer. Nothing gets uploaded.

Every picture you add goes into **Your pictures**. You'll find the same pictures in the **Custom** tab of the editor, ready for any project.

To start, click **Remove background** on the bar at the left. Remove background is in the desktop app on Mac, Windows and Linux, and in the web app.

## Take the background out of a photo

1. Click **Remove background** on the bar at the left.
2. Click **Add photos**, or drop photos onto the window. You can add lots at once. The app does them one after another.
3. Each photo shows up in **Your pictures** while the app works on it. Click a picture to see it big.
4. Click **Add to artboard** to put the picture on the artboard you picked in the editor.

The first time, the app needs a one-time download: 118 MB, or 94 MB on some computers. You'll see how far the download got on the left, with a **Stop** button. After that, everything works without internet.

A logo or a product on a plain color doesn't wait for the download. The app takes the plain color out straight away.

### On a Mac

On macOS 14 or newer, your Mac removes the background in a moment, with nothing to download. Do the one-time download too, and hair and small details come out cleaner a few seconds later.

## Fix the edges

Most pictures come out right the first time. When one doesn't:

- **Erase** and **Bring back**: paint over the parts you want gone, or the parts you want back. Press **X** to switch between the two, and **[** or **]** to make the brush smaller or bigger.
- To move around the picture, hold **Alt** and drag, or use two fingers on a trackpad. To zoom, hold **Ctrl** or **Cmd** and scroll.
- **Shrink or grow**: drag left to trim off a thin line of the old background. Drag right if the edge cuts into the person or product.
- **Soften** makes the edges a little blurry. A little helps with hair and fur.
- **Fix colored edges** takes leftover color from the old background out of the edges, so hair doesn't look outlined. It's on unless you turn it off.
- **Cut off empty space** crops the picture close around what's left, so the picture is easier to place.
- **Undo** and **Redo** work too, with **Cmd+Z** and **Shift+Cmd+Z** (**Ctrl** on Windows and Linux).
- Hold **Before** to see the photo as it was.
- **Try on a background** shows the picture on a checkerboard, white, black or a color you pick, so you can check the edges.

The app saves every change by itself a moment later. There's no Save button.

**Start over** has two choices: **Remove the background again** does the whole photo afresh, and **Keep the whole photo** puts everything back.

A picture you already put on an artboard doesn't change when you fix the edges later. Click **Add to artboard** again to use the fixed picture.

## In the editor

Select a picture on an artboard, then click **Remove background** in Properties, under **Change Image**. The background goes, and the picture stays the same size in the same place. **Undo** brings the background back. To fix the edges, click **Fix edges** in the message that pops up.

The **Custom** tab at the top of the editor's left panel shows Your pictures:

- Click a picture, or drag it onto an artboard, to use it.
- **Add pictures** keeps pictures just as they are, background and all. Handy for logos and photos you use a lot.
- The scissors on a picture takes its background out. **Remove background** opens the Remove background screen.

## Keep a copy online

Your pictures are kept on this computer. To keep a copy in your own Google Drive or GitHub account, sign in under **Account**, then click **Back up to Google Drive** (or **Back up to GitHub**) at the top of Remove background.

- **Google Drive** gets a folder called **Open Screenshot Generator images**. Your pictures are normal PNG files you can open in Drive. The original photos go too, so you can still fix the edges on another computer.
- **GitHub** gets one private gist with the finished pictures only. A gist holds up to 298 pictures, each up to 7.5 MB.

The same button brings your pictures back on a new computer. When you delete a picture, the copy online goes too the next time you back up. Nothing gets backed up until you click the button.

## With the AI assistant

The Claude Code and Codex assistants in the desktop app can use your pictures too. Ask something like "use my product photo" or "take the person out of this photo and put them on the second artboard". In Remove background, **Ask AI to use the picture** gives the picture to the assistant to place in your design.

For people who connect their own AI tools: the tools are called `remove_background`, `list_my_images`, `save_to_my_images` and `delete_my_image`.

## What it can't do yet

- The app takes out everything behind the person or product. To keep just one of two people, erase the other one with the brush.
- A soft shadow under a product on a plain color stays until the one-time download is done, or until you erase the shadow.
- Pictures are worked on at up to 3072 pixels on their long side. That's bigger than any store screenshot.
