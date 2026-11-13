# Growth: your app's numbers, reviews and listing

Growth shows how your app is doing on the App Store, in the same app where you make its screenshots. It answers the questions that come after an upload: did the new screenshots sell better, which countries are looking, what are people saying, and what in the listing is costing you downloads.

Open it with the Growth button (an arrow going up) on the bar down the left edge of the window, or with **See how they sell** after an upload to App Store Connect. The pen above it takes you back to the editor, which is as you left it.

Growth needs the desktop app, because App Store Connect does not answer requests from a browser. In the web version, and in the desktop app before you connect, every screen is there but empty, and a button that needs your app is turned off and says why when you point at it.

## Connect your app

Growth uses the same App Store Connect API key as the upload dialog, so if you upload screenshots from this app you may be connected already.

1. Open Growth and go to **Connection**.
2. If no key is there, follow the steps in the form. A key with the **Admin** role reads everything. A key with a smaller role still works for what that role may read, and each line under **What is connected** says what it needs.
3. Enter your **vendor number**: the digits at the top left of **Payments and Financial Reports** in App Store Connect. Growth needs it for downloads, in-app purchases and proceeds.
4. Growth syncs on its own once the numbers are older than the setting under **Connection** (6 hours unless you change it): when you open it, while it stays open, and in the background while the desktop app runs (see below). Click **Sync** to sync now.

What arrives, and when:

- **Listing, reviews and ratings** arrive in seconds.
- **Downloads, purchases and proceeds** (Sales and Trends) arrive in a few minutes, up to a year back. Apple publishes each day the morning after, Pacific time.
- **Impressions, product page views and conversion** (App Analytics) need Apple to make reports for your app. Apple only starts once an Admin key asks, which Growth does on its first sync with such a key. The first reports take a day or two. After that, numbers arrive a day or two after each day ends.

Apple turns a key away when the computer's clock is more than about two minutes ahead of its own. Growth and the screenshot upload take the time from Apple's answers instead, so a clock that has drifted does not stop them.

Your key and your numbers are stored on this computer, and Growth talks to Apple directly. The one exception is AI. When you ask for a reply, a listing field or a report summary, or ask a question, the reviews, listing text or numbers it needs go to the AI that writes: Claude Code or Codex on your own plan, through the CLI on this computer, or the provider you set up in the AI panel. When you ask the Claude Code or Codex agent, it reads them with its store tools, and they go to Anthropic or OpenAI with the rest of the chat.

## Which AI writes

Under **Connection**, **AI that writes** picks it. **Automatic** picks the first of these that is ready on this computer: your Claude Code plan, then Codex, then the provider in the AI panel. If a request to the one it picked fails, it says why and does not try the next. Claude Code and Codex have to be installed and signed in; each request runs once on your plan, with no tools, and the conversation is not saved, though Codex still updates its own caches and databases in the app's Codex folder. They work in every editor window, a tab moved into a window of its own too. **Stop** ends the request, and so does closing or reloading the window that asked. A report summary or a listing translation keeps going while you look at another section, and is there when you come back. Every AI button is turned off, with the reason, until one of them can answer.

## Checking in the background

While the desktop app is open, Growth keeps checking while you work in the editor. Every app you have synced in Growth is synced again once its numbers are older than the setting, one app at a time. When that turns up something new, such as a drop in conversion, a rating falling or a milestone, a message says so and the Growth button shows how many new insights are waiting. Turn this off under **Connection** with **Keep checking while the app is open**. Growth cannot check while the app is closed.

## The screens

**Overview.** The headline numbers for the period you pick, against the same number of days before, and a chart of any of them with your releases and screenshot uploads marked on it. At the top, **Did the new screenshots work?** compares your latest screenshot set with the one before it (see below).

**Insights.** Cards for what changed and what needs doing: impressions or downloads moving, a likely feature on the App Store, storefronts whose main language your listing does not have, complaints that keep coming up in reviews, a rating drop after a release, problems in the listing. Each card has a button for the next step. Dismiss a card to hide it; a trend that is still there the next week comes back as a new card.

**Reviews.** Every written review, filtered by stars, country, topic or whether you replied. Click **Reply** to answer one. With an AI set up, **Suggest a reply** writes a draft in the reviewer's language from what they said, your app's description and the tone of your earlier replies. Nothing is sent until you click **Send reply**, and Apple checks every reply before it shows.

**Listing.** Your name, subtitle, keywords, promotional text, description and what's new, for every language, with Apple's character limits. The checks on the right find wasted keyword characters (spaces after commas, repeated words, words your name or subtitle already has), a subtitle that repeats the name, text left untranslated, and languages without screenshots of their own. Many have a **Fix** button. Every edit, fix and AI suggestion collects under **Suggested changes**, and nothing reaches App Store Connect until you click **Apply in App Store Connect**. Suggested changes are kept until you apply or discard them, also when you move to another section, close Growth or restart the app. Promotional text can change at any time; the other fields only while a version is being prepared.

**Storefronts.** Every country with its impressions, page views, conversion, downloads and proceeds, and the main language of its App Store. Growth knows that language from a built in table, not from Apple's numbers: someone whose phone is set to another language the store supports sees that one instead. A main language your listing does not have comes with a **Translate** button that opens your project's languages with it ticked.

**Timeline.** Everything that happened to the app on one chart: releases (found on their own), screenshot uploads from this app (recorded on their own, with the project they came from), listing changes, and anything you add yourself, such as a campaign or a price change. Each one shows what the numbers did around it.

**Reports.** A weekly, monthly or yearly report with the figures against the period before, the top countries, how people found the app, reviews and events. The newest yearly report is the year so far, beside the same days of the year before; the whole years before it follow. A figure is only compared when Growth has its numbers for all of the period before, and the report names the figures it could not compare. With an AI set up, **Write the summary** adds a few sentences on what changed and what to do next. Save it as PDF, Markdown or text, or copy it.

**Ask AI.** Questions about your numbers, answered by the AI that writes, from the data on this computer. If you use the Claude Code or Codex agent, **Ask the agent** hands the question to it instead, and the agent can then change your screenshots in the same chat.

## How "did the new screenshots work" is measured

When you upload screenshots to App Store Connect from this app, Growth notes the day, the version they went to and the project they came from.

The new screenshots are not on the store until that version is released, so Growth waits for the release and then compares the **conversion rate** (downloads for every unique impression) in the 14 days before it with the 14 days after. The day of the release is left out, since it is half one and half the other.

A rate from a few hundred visitors moves around by itself, so Growth runs a statistical test on the counts. It gives no verdict in the first 7 days after the release. Until all 14 days are in, it calls the rate up or down only when the test is at least 99% sure, because it looks again every day and a fluke would otherwise slip through on one of them. After that, 90% is enough. Until then it says it is still measuring and how many days are left. Without App Analytics it compares downloads per day instead.

This is a before and after comparison, not a controlled test. A feature on the App Store, a sale, a holiday or a listing change in the same weeks moves the same numbers, so Growth names everything else on the timeline in those weeks next to the result, and never says the screenshots caused the change. For a controlled test, use product page optimization in App Store Connect, which shows two sets of screenshots to different visitors at the same time.

## The AI agents

The Claude Code and Codex agents in the desktop app can read the same numbers with six tools: `get_store_overview`, `get_store_metrics`, `list_store_reviews`, `list_store_insights`, `get_store_listing` and `list_store_events`. They can only read. Replies and listing changes are always sent by you, from the Growth window.

Other programs connected to the app's design server cannot read your store numbers unless you turn on **Let other MCP clients read these numbers** under **Connection**, because the numbers include sales.
