# Product Hunt Launch Kit

Everything needed to launch Open Screenshot Generator on Product Hunt, built from a July 18, 2026 research pass over PH's current mechanics, this month's actual leaderboards, every comparable launch in the niche, and a live audit of the GitHub repo. Numbers below are from that research; the raw brief lives in the session research output.

## The strategy in one paragraph

Launch on a **Saturday at 12:01 AM Pacific** (12:01 PM in Pakistan) as **"the open source Canva for App Store screenshots."** Saturday's top-5 bar this month is roughly 110 to 270 points against 360+ midweek, and the #1 spot on Saturday July 18 took just 355. The open source angle is the strongest repeatable pattern on PH right now (Twenty, Postiz, Onlook, Kilo Code all hit top-5 with it) and **no screenshot tool has ever claimed it**. Product Hunt is the flag; Hacker News is the real traffic engine (routinely 3 to 10x PH's visitors), so Show HN follows one or two days later with the GitHub repo, not the landing page. GitHub trending is the compounding prize if stars spike inside one window.

**Recommended date: Saturday, August 8, 2026** (three weeks of build-up). Fallback: Saturday, August 1. Do not launch before the license exists.

**Realistic target, honestly:** top-5 of the day (150 to 300 points), 200 to 500 qualified visitors from PH, more from HN, and a shot at GitHub trending. #1 is possible on a soft Saturday but depends on featuring and Wave 1 size.

## The one blocker and the two decisions only you can make

1. **Add a LICENSE file.** The README currently says there is no license. An "open source" launch without one loses the HN thread to its top comment and likely violates r/opensource rules. Recommendation: MIT (maximum adoption, matches "star it and use it" positioning). Apache-2.0 if you want the patent grant. Decide, add `LICENSE`, set `"license"` in package.json, delete the README paragraph saying there is none.
2. **Upload the 36 second landscape promo cut (`promo/out/artboard-studio-promo-fast.mp4`) to YouTube** as its own video. PH only takes YouTube URLs. The 52s cut is the fallback; the walkthrough is too long to lead with.
3. **Write your Wave 1 contact list.** 30 to 50 real people you can message personally on launch morning. This is the single strongest predictor of clearing the Saturday bar. If the list is under 30, spend the extra week growing it before launching.

## Pre-launch checklist

### GitHub repo (from the live audit, priority order)

- [x] LICENSE file (MIT, plus `license` fields in package.json and src-tauri/Cargo.toml) + removed the README "no license yet" paragraph
- [ ] Social preview image, 1280x640, in repo Settings. IMAGE IS READY at `docs/social-preview.png`; still needs the manual upload in Settings, General, Social preview
- [x] Fix the README quickstart clone URL (it says `<your-username>` instead of `dotnetdreamer`)
- [x] Add license and release badges at the top of the README; add a short demo GIF above the YouTube cover (`docs/demo.gif`, 16s cut of the rebranded promo-fast render; `docs/promo-fast.mp4` also replaced with the rebranded render, the old copy still showed Artboard Studio branding)
- [x] Rename package.json `name` from `nextn` to `open-screenshot-generator` (package-lock.json synced too)
- [x] Root hygiene: delete `.modified`; remove `.idx/` and `apphosting.yaml` if truly unused (the Firebase config undercuts the "no backend" pitch when someone browses the repo)
- [ ] CONTRIBUTING.md + a bug report issue template DONE; enabling Discussions still needs a manual click (Settings, General, Features) because the fine-grained PAT lacks repo Administration scope
- [x] Sweep README visible copy for em dashes (house style)
- [x] Update the device list line ("iPhone X through 15 Pro" is now "X through 17 Pro Max" plus iPad 11-inch and Pro 13-inch)

Already launch ready: fresh v0.1.3 release with the full installer matrix, live site, 14 good repo topics, honest README, documented SmartScreen and Gatekeeper steps.

### Product Hunt account and page

- [ ] Create the product page early so the forum thread (`producthunt.com/p/open-screenshot-generator`) exists. "Coming soon" teaser pages were retired in August 2025; the forum thread is the replacement, and its followers get notified at launch. Seed it with one honest "building this in the open" post per week
- [ ] Your PH account should not be brand new and empty. Spend the three weeks commenting genuinely on other launches
- [ ] Schedule the launch as a draft (drafts can be scheduled up to a month ahead) for Saturday 12:01 AM PT
- [ ] Self-hunt. 79 percent of featured posts are self-hunted now; hunters no longer move the needle

### Build in public (T-21 to T-1)

- [ ] 2 to 3 posts per week on X: short clips from the promo cuts, the 3D pose feature, the AI agent doing a full listing, the "no server" architecture. Launch day should not be anyone's first touch
- [ ] Each post links the repo. Star growth before launch matters more than launch day (and raises the GitHub trending baseline you need to beat)
- [ ] Verify live sidebar rules of every target subreddit the day before posting (mod rules churn; third party databases are stale)

### Website

- [ ] Launch day banner or badge slot on openscrgen.app pointing at the PH page (swap in the "live on Product Hunt" badge at 12:01 AM PT, remove after 48h)
- [ ] Add UTM parameters to every link you control (`?utm_source=producthunt` etc.) so GA4 shows which channel actually delivered

## The listing (ready to paste)

**Name:** Open Screenshot Generator

**Tagline (47 chars, limit 60):**
> The open source Canva for App Store screenshots

Alternates if PH editors push back on the brand comparison:
> Free, open source App Store screenshot studio (45)
> App Store screenshots, free and open source (43)

**Description (use the short one if the form caps at 260):**

Short (258 chars):
> A free, open source design studio for App Store and Play Store screenshots and app preview videos. Runs entirely in your browser: no account, no upload, no watermark, no paid tier. Templates, 3D device mockups, store size exports, and an optional AI agent.

Long (up to 500):
> A free, open source design studio for App Store and Play Store screenshots, feature graphics and app preview videos. It runs entirely in your browser: no account, no upload, no watermark, no paid tier, no server at all. Pick a template, drop in your app screens, and export every size both stores accept, including MP4 app previews conformed to exactly what App Store Connect wants. An optional AI agent builds the whole listing from your raw screenshots. Desktop apps for Windows, macOS and Linux.

**Launch tags (max 3):** Open Source, Design Tools, Developer Tools

**Pricing label:** Free

**Link:** https://openscrgen.app (PH gets the landing page; HN gets the repo. Never the same URL on both)

**Thumbnail:** 240x240 PNG of the logo. Optional: a hover GIF (animates on hover only) showing a screenshot snapping into a frame

**Video:** the YouTube URL of the uploaded 36s cut

## Gallery (minimum 2, recommend 7, all 1270x760)

Craft here is what gets you featured; only about 10 percent of launches are. Every slide designed in the app itself, which is its own proof of quality. I can generate these headlessly from the app when you are ready.

1. **Hero.** Editor with a finished template set, caption: "The open source Canva for App Store screenshots"
2. **Templates.** The gallery grid, caption: "Start from templates already sized for both stores"
3. **Drop in and pose.** Screenshot clipped into a tilted 3D iPhone, caption: "Your screens stay clipped to the glass, even in 3D"
4. **Export.** The export dialog with real sizes visible (1290x2796, 2064x2752), caption: "Every size Apple and Google ask for, one click"
5. **Video.** Recording playing inside a frame plus the conform mode, caption: "App preview videos, encoded in your browser"
6. **AI agent.** Upload plus one sentence producing a full project, caption: "Or let the agent build your listing from raw screenshots"
7. **The architecture.** Simple diagram: your browser, IndexedDB, no server. Caption: "No account. No upload. No watermark. Free forever"

## Maker first comment (post at 12:02 AM PT, under 800 chars)

> Hey Product Hunt! Solo maker here.
>
> I built this because App Store screenshots kept costing me either a subscription or an evening of pixel math, and every tool in this niche uploads your unreleased app to someone else's cloud.
>
> So I made the opposite. A real design studio that runs entirely in your browser: no account, no upload, no watermark, no paid tier. Templates, 3D device mockups, exports at every size both stores accept, app preview videos, and an optional AI agent that builds your listing from raw screenshots. The full source is on GitHub, and the desktop app runs on Windows, macOS and Linux.
>
> It is genuinely all free. If it saves you a launch evening, a GitHub star is the whole business model.
>
> What would make you switch from whatever you use today?

## Launch day runbook (all times Pacific; Pakistan time in brackets)

- **12:01 AM (12:01 PM PKT):** launch goes live. Post the maker comment. Swap the website badge on
- **12:05 AM to 4:00 AM (12 PM to 4 PM PKT):** Wave 1. Personal messages to your 30 to 50 contacts, spread across the window, not in one burst (burst votes get discounted, and coordinated patterns get points stripped). Template below. Post the launch X thread with the native video, PH link in the first reply
- **6:00 to 8:00 AM (6 to 8 PM PKT):** Wave 2. Any email list, LinkedIn post, community Slacks and Discords you genuinely belong to
- **Same day:** r/iOSProgramming runs App Saturday and r/webdev runs Showoff Saturday, both purpose-built for this. Post the technical "how I built it" version there, not the ad. r/SideProject allows launch posts any day
- **12:00 to 3:00 PM (12 to 3 AM PKT):** afternoon push. Second X post with a different clip (the AI agent one). Reply to every PH comment; 89 percent of top-5 makers respond to everything, and comments weigh into points
- **All day:** reply, thank, answer. Never ask anyone anywhere to upvote. "Would love your feedback in the comments" is the allowed framing; "please upvote" can kill the launch

## Day 1 to 2: Show HN

- Submit **the GitHub repo**, not the landing page
- Title: `Show HN: Free, open-source app store screenshot maker that runs in the browser`
- First comment: the personal backstory, plain language, technical details welcome (WebCodecs H.264 in the browser, the AgentPlan design where the model fills slots and never emits coordinates, IndexedDB storage). HN loves the zero-signup try-it-now property this app genuinely has
- Never send PH visitors to the HN post or vice versa; solicited HN votes get the post flagged
- Day 1 to 4: r/opensource (license required, hence the blocker), r/androiddev only if live rules allow

## Reply playbook (prepared answers for the questions that will come)

- **"How is this free? What's the catch?"** No catch by architecture: static site, no server, no accounts to monetize. Costs are near zero. Stars and contributors are the payoff
- **"vs AppScreens / Previewed?"** Credit them honestly, then: paid cloud tools; this is free, open source, and your screenshots never leave the machine. The site has an honest comparison page (openscrgen.app/appscreens-alternative)
- **"License?"** MIT, LICENSE file in the repo root
- **"Video export doesn't work in Safari/Firefox."** WebCodecs H.264: Chrome, Edge, or the desktop app. PNG export works everywhere. It stops with a clear message rather than failing silently
- **"Installer shows a Windows/macOS warning."** Builds are not code signed yet; signing certs cost real money for a free tool. The steps are in the README, and the source is public if you would rather build it yourself
- **"Does the AI agent send my screenshots somewhere?"** Only if you use it, only to the provider you pick, and the whole feature is optional. The editor itself has no network calls with your content
- **"Roadmap?"** Audio in video export, 3D poses for recording mockups, more device frames. Issues welcome

## Rules that kill launches (tripwires)

- Any "please upvote" phrasing, anywhere, to anyone
- Incentivized votes, giveaways for votes, vote exchange groups
- A burst of votes from new or dormant accounts (points get stripped, sometimes the listing)
- Same URL on PH and HN, or cross-funneling the audiences
- Mass DMs that look coordinated

## After launch week

- PH badge in the website footer and README (top 5 badge if it lands)
- Convert the launch traffic that searches later: the six SEO pages are already live for exactly the queries PH visitors will Google afterward
- Post-mortem numbers into GA4: PH vs HN vs Reddit by UTM
- Keep the PH forum thread alive with release notes; followers get notified on future launches (v1.0 can launch again)

## Connect with Investors form (optional, private, no effect on ranking)

This section only matters if you would actually take an investor call. It is never shown publicly and PH says it is only used for matching. Skipping it is fine. If you fill it, use these; every claim is true today, and the revenue answer deliberately invents nothing.

**Why are you the right founder/team to work on this?**

> I am a solo developer and I built the entire product end to end: a Canva class canvas editor, a WebCodecs pipeline that encodes MP4 app previews in the browser, desktop apps for Windows, macOS and Linux, an AI agent that assembles a full store listing from raw screenshots, and an MCP server so AI coding tools can drive the editor. I ship apps myself, so I am my own user: every feature exists because the store submission flow made me need it. The proof is public, the whole thing is open source under MIT.

**Why did you pick this idea to work on?**

> Every app developer hits the same wall a few times a year: the stores demand pixel perfect screenshots in a dozen sizes, and every tool for the job is a subscription that uploads your unreleased app to someone else's cloud. A subscription is the wrong price for a task you do four times a year, and an upload is the wrong architecture for software that is not public yet. I wanted the opposite to exist: free, open source, running entirely in the browser with nothing leaving your machine. Nobody had built it, so I did.

**Who are your competitors, and what do you understand about this idea that they don't?**

> AppScreens, AppLaunchpad, Previewed and AppMockUp, all paid cloud SaaS, plus generic mockup tools like Rotato and Mockuuups. Three things they miss. First, this is an episodic job, not a subscription job, which is why the category churns and incumbents keep dying: Smartmockups shut down, Launchmatic and Shotbot are gone, Previewed is visibly neglected. Second, privacy is a real feature here, because users are handling unreleased products, often under NDA. Third, in developer tools the open source entrant tends to take the category, and nobody has run that play in this niche. My distribution compounds through GitHub and search rather than paid acquisition.

**What's your revenue and/or growth rate?**

> Zero revenue today, by design. The core tool is free and open source and stays that way; the current goal is adoption, stars and community. Credible future revenue sits next to the free core rather than inside it: team features, hosted sync, signed enterprise builds, support. I am pre launch on Product Hunt and growth so far is organic.

**Anything else you would like investors to know?**

> The wedge is screenshots, but the product is the whole store listing pipeline: graphics, preview videos, and an AI agent that builds the listing, plus an MCP server that plugs the editor into the AI tools developers already use. The paid incumbents are aging with visible churn, and I am building the distribution moat while they decay: an MIT licensed repo and a growing set of search pages targeting exactly the queries this audience types. Solo and capital efficient, everything shipped so far was built without funding.
