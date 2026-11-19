# Capture: screenshots straight from your app

Capture takes screenshots of your app and puts them straight into the phone frames of your project. It works with three kinds of device:

- a virtual iPhone or iPad on a Mac (the iPhone Simulator that comes with Xcode)
- a virtual Android device on Mac, Windows or Linux (an emulator made in Android Studio)
- a real Android phone, on a USB cable or over Wi-Fi

Capture can also open your app in every language of your project and take each screen in each language for you.

Capture is in the desktop app. Click **Capture screenshots** on the bar at the left.

## What you need

- **iPhone and iPad:** a Mac with Xcode. Xcode comes with virtual iPhones and iPads.
- **Android:** Android Studio, with a virtual device made in it, or an Android phone with USB debugging turned on. Capture reaches both through Android Studio's tools. Android works on Mac, Windows and Linux.
- **Your app on the device:** run your app on the virtual device once from Xcode or Android Studio, or install it on your phone. After that, Capture can open your app by itself.

## Take one screenshot

1. Click **Capture screenshots** on the bar at the left.
2. Choose the device. If the device is off, click **Start**. Capture chooses a virtual device that is on by itself, but a phone only when you choose it.
3. The grid shows every phone frame of your project, with a row for each language. Click the frame and the language the screenshot is for.
4. On the device, go to the screen you want. The screen of the device shows live in Capture.
5. Click **Take screenshot**, or click the live screen.

In any row but the **Main language** row, the screenshot goes into that language only. A screenshot in the **Main language** row also shows in every language that has no screenshot of its own yet. With **Go to the next frame** on, Capture then chooses the next frame in the row, so you can fill a whole row while you go through your app.

In the editor there is a shortcut: select a phone frame and click **Screenshot from device** beside **Upload Screenshot**. With a virtual device of the frame's kind running, or the device you chose in Capture, the screenshot goes straight into the frame. Otherwise Capture opens on the frame. On Windows and Linux the button is off for an iPhone frame: virtual iPhones need a Mac.

Every screenshot you take is under **Recent screenshots** until you close the app. Click one to put the same screenshot in another frame.

## Every screen in every language

1. Start a device. Under **Your app**, choose your app. The list shows the apps on the device, so it stays off until a device is running.
2. Next to each frame's name in the grid, click the small icon and choose which screen goes in the frame:
   - **The first screen of my app**: for what people see right after they open your app. Capture takes it in every language for you.
   - **A screen with a link**: for a screen your app can open from a link, such as `myapp://settings`. Capture takes it in every language for you. Not sure if your app has links? Ask your developer.
   - **Another screen, I'll go there myself**: for any other screen, like one you can only reach by tapping around in your app. You take that frame in each language by hand.
3. Click **Take this screen in all languages** for one frame, or **Take all screens in all languages** for every frame set to the first screen or a screen with a link.

Point at an (i) next to **Your app**, a setting or the screen question to read more about it.

For each screenshot, Capture opens your app from the start in the language, waits until the screen stops moving, and then takes the screenshot. All the screenshots go into the project as one step, so one undo takes them all out again.

On the Mac this was built on, four screenshots (two screens in English and German) took about 11 seconds on a virtual iPhone.

### Links on iPhone and iPad (for developers)

iOS asks "Open in your app?" before it opens a link from outside, and Capture cannot tap **Open** for you. So on iPhone and iPad, Capture gives the link to your app when your app opens, as the launch argument `-OSGLink`. Add a few lines to your app to open that screen:

```swift
// SwiftUI: on your first view
.onAppear {
    if let link = UserDefaults.standard.string(forKey: "OSGLink"), let url = URL(string: link) {
        openScreen(url) // the same code your onOpenURL calls
    }
}
```

On Android, Capture opens the link with an intent, the same way a tap on the link does. Android apps need nothing extra.

### Example content (for developers)

Capture tells your app that it is being captured, so your app can show example content and skip the sign in:

- **iOS:** the launch argument `-OSGScreenshots YES`. Read it with `UserDefaults.standard.bool(forKey: "OSGScreenshots")`.
- **Android:** the intent extra `osg_screenshots` set to `true`. Read it with `intent.getBooleanExtra("osg_screenshots", false)`.

### Languages on Android

Capture sets the language of your app only, not of the whole device. That needs Android 13 or later. On older Android versions, change the language of the device in Settings, then take the screenshots by hand.

## The status bar

With **Clean status bar** on, the status bar shows 9:41 with full signal, full Wi-Fi and a full battery, the way Apple shows a phone. The real status bar comes back when you turn the switch off, and when you quit the app.

The clean status bar is for virtual devices. Many phones draw their own status bar: a Samsung Galaxy keeps its clock and battery, and a Xiaomi phone does not let Capture change it at all, which Capture tells you.

## Light or dark mode

**Light or dark mode** switches the whole device to light or dark mode. **No change** leaves the device as it is.

## Recordings for preview videos

A video frame (in an App Preview project) shows **Record** instead of **Take screenshot**. Click **Record**, use your app on the device, then click **Stop recording**. The recording goes into the frame, in the project where you clicked **Record**, even if you opened another project in the meantime. A recording in any row but the **Main language** row keeps its own length and has no trim, even after the main language's recording changes. After you stop, the device needs a few seconds to save the recording before it can record again.

On Android:

- An Android recording stops by itself after 3 minutes. Capture then shows that it stopped, and **Stop recording** keeps those 3 minutes.
- Android records only while something on the screen moves. A recording ends at the last movement on the screen, so a still moment at the end is not in it, and Capture says how long the recording came out. A recording in which nothing moved is not used.
- A virtual device's encoder can run a few seconds behind the screen. After you click **Stop recording**, Capture waits for it to catch up before it ends the recording, so the end of what you did is in it.

## The right device for the frame

Use a virtual device of the same model as the frame. A frame of an iPhone 17 Pro Max wants a virtual iPhone 17 Pro Max: the screens have the same shape, so nothing is cut off. When your Mac has none of that model, Capture offers to add one. A screenshot of another shape fills the frame and loses a little at the edges, and Capture says so.

## The AI agents

The Claude Code and Codex agents in the desktop app can use Capture too:

- `list_capture_devices` lists the virtual devices and phones, and, given the id of a running one, the apps on it.
- `capture_screenshot` takes a screenshot into a frame, in a language, and can open your app on a screen first. It uses the device you chose in Capture, or a virtual device that is on, and a phone only when the agent passes its id.

For example, ask the agent: "Take the first screen of my app in English, German and Japanese and put the screenshots in the first frame."

## When something does not work

- **No devices in the list:** install Xcode from the Mac App Store, or Android Studio. Capture finds Android's adb in the folder Android Studio installs it to, also when adb is not on your PATH.
- **Not allowed yet:** unlock the Android phone, and tap Allow when it asks about USB debugging.
- **Not responding:** the device stopped answering. For a phone, check the cable or the Wi-Fi. A virtual device that was shut down shows as **Off** a few seconds later, with **Start**.
- **Your app is not on the device:** run your app on the virtual device once from Xcode or Android Studio, or install it on your phone. Capture looks again every few seconds.
- **The screen kept moving:** Capture waits up to 15 seconds for an animation to stop, then takes the screenshot anyway and says so.
