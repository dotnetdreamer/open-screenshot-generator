# Capture: screenshots straight from your app

Capture takes screenshots of your app on the iPhone Simulator, an Android emulator or an Android phone, and puts the screenshots straight into the phone frames of your project. Capture can also open your app in every language of your project and take each screen in each language for you.

Capture is in the desktop app. Click the camera on the bar at the left.

## What you need

- **iPhone and iPad:** a Mac with Xcode. Xcode comes with the iPhone Simulator.
- **Android:** Android Studio with an emulator, or an Android phone with USB debugging turned on. Android works on Mac, Windows and Linux.
- **Your app on the device:** run your app on the simulator or emulator once from Xcode or Android Studio. After that, Capture can open your app by itself.

## Take one screenshot

1. Click **Capture** on the bar at the left.
2. Choose the device. If the device is off, click **Start**.
3. The grid shows every phone frame of your project, with a row for each language. Click the frame and the language the screenshot is for.
4. On the device, go to the screen you want. The screen of the device shows live in Capture.
5. Click **Take screenshot**, or click the live screen.

In any row but **Base**, the screenshot goes into that language only. A screenshot in the **Base** row also shows in every language that has no screenshot of its own yet. With **Next frame after each screenshot** on, Capture then chooses the next frame in the row, so you can fill a whole row while you go through your app.

In the editor there is a shortcut: select a phone frame and click **From Simulator** (or **From emulator**) beside **Upload Screenshot**. With a device running, the screenshot goes straight into the frame.

Every screenshot you take this session is under **Taken this session**. Click one to put the same screenshot in another frame.

## Every screen in every language

1. Under **Your app**, choose your app.
2. Above each frame in the grid, click the route button and choose how Capture gets to the screen of the frame: **The first screen of the app**, or **A link that opens the screen**, such as `myapp://settings`.
3. Click **This screen in every language** for one frame, or **Every screen in every language** for all frames with a route.

For each screenshot, Capture opens your app from the start in the language, waits until the screen stops moving, and then takes the screenshot. All the screenshots go into the project as one step, so one undo takes them all out again.

On the Mac this was built on, four screenshots (two screens in English and German) took about 11 seconds on the iPhone Simulator.

### Links on iPhone and iPad

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

### Sample content

Capture tells your app that it is being captured, so your app can show sample content and skip the sign in:

- **iOS:** the launch argument `-OSGScreenshots YES`. Read it with `UserDefaults.standard.bool(forKey: "OSGScreenshots")`.
- **Android:** the intent extra `osg_screenshots` set to `true`. Read it with `intent.getBooleanExtra("osg_screenshots", false)`.

### Languages on Android

Capture sets the language of your app only, not of the whole phone. That needs Android 13 or later. On older Android versions, change the language of the phone in Settings, then take the screenshots by hand.

## The status bar

With **Tidy status bar** on, the status bar shows 9:41 with full signal, full Wi-Fi and a full battery, the way Apple shows a phone. The real status bar comes back when you turn the switch off, and when you quit the app.

## Light or dark

**Light or dark** switches the whole device to light or dark mode. **As is** leaves the device as it is.

## Recordings for preview videos

A video frame (in an App Preview project) shows **Record** instead of **Take screenshot**. Click **Record**, use your app on the device, then click **Stop and use the recording**. The recording goes into the frame, in the project where you clicked **Record**, even if you opened another project in the meantime. A recording in any row but **Base** keeps its own length and has no trim, even after the **Base** recording changes. An Android recording stops by itself after 3 minutes. After you stop, the device needs a few seconds to save the recording before it can record again.

## The right device for the frame

Use a simulator of the same model as the frame. A frame of an iPhone 17 Pro Max wants the iPhone 17 Pro Max simulator: the screens have the same shape, so nothing is cut off. When your Mac has no simulator of that model, Capture offers to make one. A screenshot of another shape fills the frame and loses a little at the edges, and Capture says so.

## The AI agents

The Claude Code and Codex agents in the desktop app can use Capture too:

- `list_capture_devices` lists the simulators, emulators and phones, and the apps on a running one.
- `capture_screenshot` takes a screenshot into a frame, in a language, and can open your app on a screen first.

For example, ask the agent: "Take the first screen of my app in English, German and Japanese and put the screenshots in the first frame."

## When something does not work

- **No devices in the list:** install Xcode from the Mac App Store, or Android Studio. Capture finds Android's adb in the folder Android Studio installs it to, also when adb is not on your PATH.
- **Waiting for your OK on the phone:** unlock the Android phone and allow USB debugging for this computer.
- **None of your apps is on the device:** run your app on the device once from Xcode or Android Studio. Capture looks again every few seconds.
- **The screen kept moving:** Capture waits up to 15 seconds for an animation to stop, then takes the screenshot anyway and says so.
