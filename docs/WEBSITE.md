# Website

Apple and Google ask every app for two web addresses: a support page and a privacy policy. Website makes both for you, plus a home page with your screenshots, in every language of your project. Then it puts the site online on your own GitHub account, for free.

Click **Website** on the left edge of the window, under Discover.

## Make your website

1. Open the project with your app's screenshots. The site takes its screenshots, colors, headline font and languages from that project.
2. Click **Website**. You see a preview of the site right away, made from your screenshots.
3. Click **Make my website** and answer three short steps:
   - **Your app**: the app's name, one line about it, your App Store and Google Play links, your support email and your name or your company's. Paste your App Store link and click **Fill in**, and the app fills in the name, the maker and the icon for you. If Growth knows your apps, click one of them instead.
   - **Privacy**: tick what your app collects, such as usage numbers, crash reports or ads, and name the services you use for each one. If your app collects nothing, tick **Nothing**. The privacy policy is written from these answers.
   - **Look and languages**: the colors come from your screenshots. Change them if you like, and choose the languages of the site.
4. Click **Make my website**. If Claude Code, Codex or another AI is set up, the AI writes the home page and the support page from your screenshots. Without an AI, the site uses your screenshots' own words and simple sentences you can change.

## Change your website

The sections on the left change one part of the site. The preview on the right shows every change as you make it.

- **Ask AI**: tell the AI what to change, in your own words. For example: "Make the headline shorter", "Add a question about restoring purchases" or "We use Firebase Analytics". If the AI needs something it doesn't know, like your email address, it asks you first. **Undo** takes back the last change the AI made.
- **Your app**: the name, the icon, the store links and your support email.
- **Look**: the colors, the headline font, and whether the screenshots show.
- **Home page**: the headline, the features next to your screenshots and the closing lines.
- **Support page**: the opening, the note next to the email button, and the questions and answers.
- **Privacy policy**: what your app collects, and anything else you want the policy to say.
- **Languages**: the languages of the site, and how much of each one is translated.

Use the buttons above the preview to see each page, each language, a computer or a phone, and the light or dark look. Links inside the preview work too.

## Languages

The site is in every language of your project. Your screenshots show in their own language, and a headline that comes from a screenshot uses the project's own translation. Everything else is translated by your AI: Claude Code, Codex or the AI in the AI panel. If you have none of those, the app's own translator does it.

Click **Translate** under **Languages** to translate what's missing. Publishing translates anything still missing first. Text that isn't translated yet shows in your base language.

## Put it online

1. Click **Publish**.
2. Click **Sign in with GitHub**. If you saved projects with GitHub before, Website uses that sign-in. GitHub asks once more, to let the app make public repositories: the site lives in one of them. Your private repositories stay out of reach.
3. Check the repository name. It's the last part of your site's address, like `https://your-name.github.io/your-app/`.
4. Click **Publish the website**. The first time takes a minute or two, while GitHub puts the site online.

When the site is online, Website shows its links. Paste them into the stores:

- **App Store Connect**: the privacy policy link goes under App Privacy, in Privacy Policy URL. The support link goes on each version's page, in Support URL.
- **Google Play Console**: the privacy policy link goes under Policy and programs, App content, Privacy policy. The home page and your email go under Store presence, Store settings.

Each language has its own links, under **Links in the other languages**.

### If GitHub asks you to switch on Pages

Sometimes GitHub doesn't let the app switch on GitHub Pages. Then Website shows **Open the Pages settings**. On that page, under Build and deployment, choose **Deploy from a branch**, then the branch Website names and **/ (root)**, and click **Save**. Website keeps checking and tells you when the site is online.

### Change the site later

Change anything, then click **Publish the changes**. The header says **Changes not online yet** until you do.

### Take the site down

Delete the repository on GitHub. The site goes offline a few minutes later.

## Save the site as a ZIP

To put the site on a server of your own instead of GitHub, click **Save the site as a ZIP** under **Publish**. The ZIP has the whole site in one folder.

## Good to know

- The privacy policy is a starting point, not legal advice. Read it and make sure it matches what your app really does. It says you don't sell anyone's data. If you do, don't use it.
- The site has no cookies and no tracking. Its headline font is part of the site, so visitors' browsers don't ask Google Fonts for it.
- The site is saved with your project on this computer. Your screenshots are taken from the project each time, so the site never shows an old design.
- In the web version, if GitHub's sign-in window doesn't ask for public repositories, paste a GitHub token with the `public_repo` permission instead.
