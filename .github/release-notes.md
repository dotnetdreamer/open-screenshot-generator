<!-- The version job in .github/workflows/desktop.yml fills in the version, the repository and the version before it, so every file name and link below is exact. -->

### Download for your computer

Pick the line for your computer. That one file is all you need.

| Your computer | Download |
| --- | --- |
| Windows 10 or 11 | [`Open.Screenshot.Generator_<version>_x64-setup.exe`][windows] |
| Windows, without installing | [`Open.Screenshot.Generator_<version>_x64_portable.zip`][windows-portable] |
| Windows, for IT teams that need an MSI | [`Open.Screenshot.Generator_<version>_x64_en-US.msi`][windows-msi] |
| Mac, Apple chip or Intel (macOS 10.15 or newer) | [`Open.Screenshot.Generator_<version>_universal.dmg`][macos] |
| Linux: Ubuntu, Debian, Mint | [`Open.Screenshot.Generator_<version>_amd64.deb`][linux-deb] |
| Linux: any other | [`Open.Screenshot.Generator_<version>_amd64.AppImage`][linux-appimage] |

- **Updates:** the installed app updates itself and shows **Restart to update** when a new version is ready. The portable copy only tells you a new version is out.
- **Windows without installing:** unzip anywhere and run `Open Screenshot Generator.exe`. It needs the Microsoft Edge WebView2 Runtime, which Windows 11 and most Windows 10 PCs already have.
- **Linux** runs on 64-bit Intel and AMD computers only, for now.
- **Your projects** stay on your computer, unless you save them to the cloud, Google Drive or GitHub.
- **You can skip** the `.sig` files and the `.app.tar.gz`. The app uses them to update itself.

### Other ways to get it

| You want | Where to go |
| --- | --- |
| Nothing to install | The [web editor](https://editor.openscrgen.app), in your browser. Video export needs Chrome or Edge |
| A Mac app that opens straight away, updated by Apple | The [Mac App Store](https://apps.apple.com/app/id6822657542). This version can't run Claude Code or Codex |
| A Windows app that opens straight away, updated by Microsoft | The [Microsoft Store](https://apps.microsoft.com/detail/9nt28z42qkcd) |
| Store images from a terminal or a script | `npx open-screenshot-generator`. Read the [command line guide](https://github.com/<repo>/blob/v<version>/cli/README.md) |

### Windows: if it won't open the first time

The app isn't signed with a paid certificate yet, so Windows may show **Windows protected your PC**. Click **More info**, then **Run anyway**.

### Mac: if it won't open the first time

macOS blocks apps that Apple has not checked (that needs a paid developer account). Allow this one once:

1. Open the `.dmg` and drag the app into **Applications**.
2. Open **Terminal**, paste this and press Return:

   ```
   xattr -dr com.apple.quarantine "/Applications/Open Screenshot Generator.app"
   ```

3. Open the app as usual.

Rather skip Terminal? The [Mac App Store](https://apps.apple.com/app/id6822657542) version opens without this step, but it can't run Claude Code or Codex.

### Linux

Open a terminal in the folder you saved the file to, and run the commands for your system.

**Ubuntu, Debian, Mint**

```
sudo apt install ./Open.Screenshot.Generator_<version>_amd64.deb
```

**Any other Linux**

```
chmod +x Open.Screenshot.Generator_<version>_amd64.AppImage
./Open.Screenshot.Generator_<version>_amd64.AppImage
```

**Window stays white?** The AppImage uses your system's WebKitGTK if it has a complete one, and its own copy if not. To choose, put `OSG_APPIMAGE_STACK=bundled` (its own copy) or `OSG_APPIMAGE_STACK=host` (your system's) in front:

```
OSG_APPIMAGE_STACK=bundled ./Open.Screenshot.Generator_<version>_amd64.AppImage
```

[windows]: https://github.com/<repo>/releases/download/v<version>/Open.Screenshot.Generator_<version>_x64-setup.exe
[windows-portable]: https://github.com/<repo>/releases/download/v<version>/Open.Screenshot.Generator_<version>_x64_portable.zip
[windows-msi]: https://github.com/<repo>/releases/download/v<version>/Open.Screenshot.Generator_<version>_x64_en-US.msi
[macos]: https://github.com/<repo>/releases/download/v<version>/Open.Screenshot.Generator_<version>_universal.dmg
[linux-deb]: https://github.com/<repo>/releases/download/v<version>/Open.Screenshot.Generator_<version>_amd64.deb
[linux-appimage]: https://github.com/<repo>/releases/download/v<version>/Open.Screenshot.Generator_<version>_amd64.AppImage

**Full Changelog**: https://github.com/<repo>/compare/v<previous>...v<version>
