# SEO

SEO checks your app's website and tells you what keeps it from showing up on Google and in AI answers like ChatGPT, Claude and Perplexity, and what to do about each thing. It's free, and it changes nothing on your site.

Click **SEO** (the magnifying glass with a tick) on the left edge of the window, under Website.

The checks come from [claude-seo](https://github.com/dotnetdreamer/claude-seo), an open source SEO toolkit. Its notes about SEO, which the AI reads before it answers you, come from the same place: the app gets the newest ones from GitHub when you open SEO and keeps them on your computer, so they stay up to date without an app update.

## Check your site

Type your site's address, like `myapp.com`, and press **Check my site**. A site you made in the [Website](WEBSITE.md) view shows up on its own. If it isn't online yet, press **Check before publishing**: the app checks the pages the Website view would put online, before anyone sees them.

The check reads your home page, robots.txt and your sitemap, then up to 30 of your site's pages, and takes about a minute. It says how many more it left out. Press **Check now** at the top right to check again after you change something.

- In the desktop app, any public site whose address starts with `https://` can be checked.
- In the browser, a site can only be checked when it lets other sites read it. Sites on GitHub Pages do, but only for pages that exist. So anything your browser can't read is listed as not read, never as missing or broken, and the desktop app reads it all.
- A file only counts as missing when the site answers that it isn't there (a 404 or a 410). If a place where your sitemap or llms.txt could be didn't answer, answered with an error, or couldn't be read, the check doesn't say the file is missing.
- Your sitemap is read the way claude-seo reads it: an XML sitemap or sitemap index with or without a namespace prefix, gzipped or not, a text file of addresses, or an RSS or Atom feed. If a sitemap is there but claude-seo can't read it (broken XML, an undeclared prefix, an empty file), the check says it can't be read and why, not that there's no sitemap. A web page where `sitemap.xml` would be counts as no sitemap there; where robots.txt points, it's a sitemap that can't be read. Two rare kinds aren't fully read yet: a sitemap saved as windows-1252 text, and links in an Atom feed that use `xml:base`. The check doesn't guess at those. When they're all it has, it says it can't tell whether you have a sitemap.
- If your browser can't read `www.myapp.com`, the check reads `myapp.com` instead and says so.
- On a shared address, like a GitHub Pages site at `name.github.io/app/`, only the pages in your site's folder count. The sitemap at `name.github.io` belongs to another site.
- A page of your site that redirects to another site isn't counted, and two addresses that end at the same page count once.

## The score

The score at the top goes from 0 to 100. Below it, each area has its own score:

- **Basics**: whether Google can open, read and trust each page.
- **Titles and links**: what people see in Google and when someone shares a link.
- **Words**: whether the pages say enough, in words a person wrote.
- **Pictures**: descriptions and sizes.
- **App details**: the facts about your app that Google reads from the page's code.
- **AI search**: whether AI tools can read the site.
- **Speed**: how fast a page loads on a phone, once you test it under **Speed**.

The areas count the way claude-seo counts a site check: basics and words count most, pictures least. Something on every page costs more than something on one page.

## Site check

Every thing the check found, with how urgent it is: **Fix now**, **Important**, **Worth fixing** or **Nice to have**. Open one to see why it matters, what to do and which pages have it. **Details** shows the check's own words and what it saw on each page.

- For a title or a description, **Write new words** asks the AI for a new title and description for that page, with how many characters each one has.
- **Ask AI about this** asks the AI how to fix it on your site.
- **By page** lists every page with its title, description, words and pictures. With Search Console connected, **Is it on Google?** asks Google whether the page is in its search results, and if not, why.

## AI search

Which AI tools your robots.txt lets in: the ones that put pages into AI answers (like ChatGPT search and Perplexity), the ones that collect pages to train AI, and the ones that open a page when someone asks them to. Each one is checked against your home page and every page the check read, so a tool kept out of one folder shows **Kept from 2 pages** rather than **Can read it**. If robots.txt couldn't be read, the table says **Unknown**.

It also checks **llms.txt**, a short guide to your site for AI tools. It's a proposal, not a rule, and Google doesn't use it. **Write one with AI** writes one from your pages, checks it the way Lighthouse does, and lets you copy or save it.

## Words

How each page's words read: filler, phrases common in AI-written copy, words that repeat, and how many facts there are. It never says an AI wrote a page. It points at what a reader would notice. The phrase lists are English, so other languages only get the repetition score.

## Ask AI and your fix plan

On the Overview, **Make my fix plan** turns the check into a few clear steps, the one that helps most first. In **Ask AI** you can ask anything about your site.

The AI is the one you picked for Growth and Store compliance: Claude Code or Codex on your own plan, or the AI you set up in the AI panel. It reads the latest check, Google's numbers when they're connected, and claude-seo's notes. The check itself is made by code, and a plan step can only point at things the check found.

## Google's numbers

Three sections show what Google knows about your site:

- **Search**, from Google Search Console: how often your site comes up on Google, how many people click, what they searched for, and the searches you're close to page one on. Dashed lines on the chart mark days Google changed how it ranks pages.
- **Visitors**, from Google Analytics: how many people visit, where they come from and which pages they read.
- **Speed**, from Google's PageSpeed Insights: the scores Google's PageSpeed tool gives, and what real visitors get.

Search and Visitors need a Google key and the desktop app. The key is a service account key from Google Cloud. It's free, it only reads, and it stays on your computer. Speed needs a free Google API key instead, and then works in the browser too.

Search and Visitors are read separately, and each shows as soon as it arrives. If Analytics is turned off, your Search numbers still show, and each section says what went wrong with its own. When you pick another property in Setup, its numbers are read straight away, and the old ones never show under the new name.

Speed tests a page of the site you have open, and its result stays with that site. PageSpeed says which page it really tested: if your page redirects to another site, or the answer doesn't say which page it tested, the result isn't kept or counted in your score. Chrome counts real visitors for a whole address, so for a site in a folder, like `name.github.io/app/`, the app doesn't show Chrome's site-wide numbers or the six-month history: they'd include the other sites at that address.

When a Website view site moves to another address, it keeps its last check, and the Overview says that check read the old address. Until you check again, the old check doesn't decide where the site is: Speed results for the old address aren't shown, and Chrome's numbers are for the new one.

### Set up with Ask AI

In the desktop app, press **Set up with Ask AI** (on the Overview, under Search, or in Setup). Growth's Ask AI opens with Google Cloud in a browser next to the chat and walks you through it: the key, the Google APIs it needs, and adding the key's email to Search Console and Analytics. If the app is still looking for Claude Code or Codex, your request waits on screen and goes as soon as it finds one.

You sign in yourself. In this setup, Ask AI asks you before it presses any button, except Close, Cancel, Back, Previous and buttons that only open a menu, a search box or help. A link that says Done, Continue, Next or Finish asks too. It can't change your App Store or Google Play setup here.

A key file it makes is saved for SEO, even if you start a new chat before the download ends, and never replaces your Google Play key. If the app can't tell which setup a download was for, Google's or Apple's, it keeps it nowhere and asks you to make the key again. Apple lets you download a key only once, so for an App Store key that means revoking it in App Store Connect and making a new one.

If you already set up Google Play in Growth, Ask AI offers to use that key for SEO too.

### Set it up yourself

Open **Setup** and pick one:

- **Use the key from Growth**: if you set up Google Play in Growth.
- **Add a key file**: if you already made a service account key in Google Cloud. Pick its .json file.

Then give the key's email access. Setup shows the email and these steps:

1. In Search Console, open your site, then **Settings**, **Users and permissions**, **Add user**. Paste the email and pick **Full**.
2. In Google Analytics, open **Admin**, **Property access management**, then the plus button. Paste the email and pick **Viewer**.
3. Turn on the Google APIs Setup lists, in the key's Google Cloud project.

Come back to SEO: it finds your site in Search Console and Analytics by itself. If it picks the wrong one, choose another in Setup.

**Speed** needs a **Google API key**: Google's PageSpeed doesn't answer without one. The key also shows real visitors over the last six months. Make one in Google Cloud under **APIs and Services**, **Credentials**, **Create credentials**, **API key**, and paste it in Setup. Ask AI can make it with you.

## Good to know

- The check only reads your site. It never changes it, never signs in and never sends anything to your site.
- In the desktop app, the check never follows a redirect to your own computer or your home network.
- Your site's pages go to the AI you picked only when you ask it something or make a plan.
- SEO keeps the last five checks of each site on this computer. Remove a site in Setup to remove what's kept about it.
- A Website view site that isn't online yet stays on the list when you open another project, and **Check before publishing** still checks it from its own project.
- A GitHub Pages site at `name.github.io/app` can't have its own robots.txt, because Google only looks for one at `name.github.io/robots.txt`. That's fine: everything is open to Google. Send your sitemap to Google in Search Console instead.
