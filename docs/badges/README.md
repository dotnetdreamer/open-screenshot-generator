# Download badges

The badges at the top of the repository's README. The website shows the three
download badges from `website/assets/img/badges/`, so a change to one of them
needs the same change to the other set. `web-editor.svg` is only in the README:
the website opens the editor with its own button.

| File | Where it came from | Rules for using it |
| --- | --- | --- |
| `mac-app-store.svg` | Apple's own badge, downloaded on 19 November 2026 from developer.apple.com/app-store/marketing/guidelines/images/badge-download-on-the-mac-app-store.svg | [Apple's marketing guidelines](https://developer.apple.com/app-store/marketing/guidelines/) |
| `microsoft-store.svg` | Microsoft's own badge, downloaded on 19 November 2026 from get.microsoft.com/images/en-us%20dark.svg | [Microsoft's badge page](https://apps.microsoft.com/badge) |
| `github.svg` | Made for this repository to sit beside Apple's badge: the same 40px height, black with a grey edge, GitHub's mark, and "Download from GitHub" in Inter (OFL), turned into outlines so it looks the same in every browser | [GitHub's logo guidelines](https://brand.github.com/foundations/logo) |
| `web-editor.svg` | Made for this repository to sit beside `github.svg`, with the same size, edge and type: a globe drawn for it, and "Edit now in your Web Browser" in Inter (OFL), turned into outlines. It links to the web editor | Ours, so no outside rules |

Apple's and Microsoft's badges are used as they come: don't recolour, crop or
animate them. Apple also asks for a gap around its badge of at least a quarter
of the badge's height, a height of at least 40px on screen, and the App Store
badge first in a row of badges. The homepage and the repository's README keep to all three,
which is why the web editor's badge comes last in the README.

To make another badge like `github.svg` and `web-editor.svg`, use Inter 4.1
Medium (the static `Inter-Medium.ttf`, optical size 14) and turn the text into
outlines. The top line is 8.205px with 0.082px letter spacing on a baseline at
y 14.69, the name is 17.067px with -0.336px letter spacing on a baseline at
y 30.5, both lines start their ink at x 36.3, and the badge ends 10.16px after
the longer line. The mark fills the 21px square at x 8.6, y 9.5. These numbers
rebuild `github.svg` to within 0.02px.

The links go to the app's listings: Apple ID 6822657542 and Microsoft Store ID
9NT28Z42QKCD.
