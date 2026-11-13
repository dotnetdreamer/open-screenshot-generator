# Growth: your app's numbers, reviews and store page

Growth shows how your app is doing in the App Store, in the same app where you make your screenshots. Growth helps you answer questions like these:

- Did my new screenshots bring more downloads?
- In which countries do people download my app?
- What do people write in their reviews?
- What on my store page costs me downloads?

To open Growth, click the Growth button (an arrow going up) on the bar at the left of the window. After you upload screenshots to App Store Connect, you can also click **See results in Growth**. The pen button above the Growth button takes you back to the editor, just as you left the editor.

Growth works in the desktop app only. In the web version, and in the desktop app before you add your API key, every screen of Growth is empty. Buttons that need your app are turned off. Point at a button to see why the button is off.

## Set up Growth

Growth uses the same App Store Connect API key as the screenshot upload. If you already upload screenshots from Open Screenshot Generator, Growth may work right away.

1. Open Growth and go to **Setup**.
2. If Setup shows no API key, click **Add your key** and follow the steps. An API key with the **Admin** role loads all the data. An API key with another role loads only part of the data. The list under **Data from Apple** says which role each part needs.
3. Enter your **vendor number**. You find the vendor number in App Store Connect, at the top of **Payments and Financial Reports**. Growth needs the vendor number for downloads, in-app purchases and earnings.
4. Growth refreshes your numbers on its own when the numbers are older than 6 hours. To change the 6 hours, use **Refresh when the numbers are older than** under Setup. To get the latest numbers now, click **Refresh**.

When the numbers arrive:

- **Store page, reviews and ratings:** in a few seconds.
- **Downloads, purchases and earnings** (Apple's Sales and Trends): in a few minutes, for up to a year back. Apple adds each day's numbers the next morning, Pacific time.
- **Times seen, page visits and download rate** (Apple's App Analytics): Apple first has to turn on App Analytics for your app. Apple turns on App Analytics when an API key with the Admin role asks, and Growth asks the first time you refresh with an Admin key. The first numbers take a day or two. After the first numbers, each day's numbers arrive a day or two later.

Apple does not accept an API key when your computer's clock is more than about two minutes ahead. Growth and the screenshot upload use Apple's time instead, so a wrong clock on your computer does not stop Growth or the upload.

## Your data

Your API key and your numbers stay on your computer. Growth gets your numbers from Apple directly.

The one exception is AI. When you ask the AI to write a reply, store page text or a report summary, or you ask a question, Growth sends the reviews, the store page text or the numbers to the AI you chose. The AI is Claude Code or Codex on your own plan, or the AI you set up in the AI panel.

When you ask the Claude Code or Codex agent instead, the agent reads your numbers itself and sends the numbers to Anthropic or OpenAI with the rest of the chat.

## Which AI Growth uses

Go to **Setup** and pick an AI under **AI to use**. **Automatic** uses the first AI that is ready on your computer: Claude Code on your plan, then Codex, then the AI from the AI panel. If a request fails, Growth shows why and does not try the next AI.

Claude Code and Codex must be installed and signed in on your computer. Each request runs once on your plan, with no tools, and the chat is not saved. Codex still updates its own cache and database files in the app's Codex folder.

The AI buttons work in every editor window, also in a tab that you moved into a window of its own. **Stop** ends a request. Closing or reloading a window also ends the AI requests the window started. A report summary or a store page translation keeps running while you look at another section of Growth, and the result is waiting when you come back. The AI buttons stay off, with the reason, until an AI is ready.

## Checking while you work

While the desktop app is open, Growth keeps checking your apps, also while you work in the editor. Growth refreshes each app you refreshed in Growth before, one app at a time, when the numbers are older than your setting. When Growth finds a change, such as a lower download rate, a falling rating or a new record, a message tells you, and the Growth button shows the number of new insights.

To turn the checking off, go to **Setup** and turn off **Keep refreshing while you edit**. Growth cannot check while the app is closed.

## The sections of Growth

**Overview.** Your main numbers for the time you pick, compared with the same number of days before. A chart shows any of the numbers, with your new versions and screenshot uploads marked on the chart. At the top, **Did the new screenshots work?** compares your newest screenshots with your previous screenshots (see below).

**Insights.** Cards about what changed and what to do next. For example: your app was seen more or less often, Apple probably featured your app, a country where your store page is not in the main language, complaints that come up again and again in reviews, a lower rating after a new version, or problems on your store page. Each card has a button for the next step. Hide a card when you are done with the card. If the same change still shows the next week, a new card appears.

**Reviews.** All written reviews. Filter the reviews by stars, country, topic, or by whether you replied. To answer a review, click **Reply**. With an AI set up, **Suggest a reply** writes a draft in the reviewer's language, from the review, your app's description and the style of your earlier replies. Growth sends nothing until you click **Send reply**. Apple checks every reply before the reply shows under the review.

**Store page.** Your app's name, subtitle, keywords, promotional text, description and what's new, in every language, with Apple's character limits. The checks on the right find wasted keyword space (spaces after commas, repeated words, and words already in your name or subtitle), a subtitle that repeats the name, text that is not translated, and languages without their own screenshots. Many checks have a **Fix** button.

Every edit, fix and AI suggestion goes to **Changes to apply**. Nothing changes in App Store Connect until you click **Apply in App Store Connect**. Your changes stay until you click **Apply in App Store Connect** or **Discard all**, also when you open another section, close Growth or restart the app. You can change the promotional text at any time. You can change the other fields only while a new version is being prepared.

**Countries.** Every country with its times seen, page visits, download rate, downloads and earnings, and the main language of the App Store in that country. Growth takes the main language from its own list, not from Apple. People whose phone is set to another App Store language see the App Store in their phone's language instead. When your store page does not have the main language of a country, **Translate screenshots** opens your project's languages with the missing language ticked.

**Timeline.** Everything that happened to your app, on one chart: new versions and screenshot uploads, which Growth adds by itself, store page changes, and events you add yourself, such as an ad campaign or a price change. A screenshot upload shows the project the screenshots came from. Each event shows what your numbers did around the event.

**Reports.** A weekly, monthly or yearly report. The report compares your numbers with the period before, and shows your top countries, how people found your app, your reviews and your events. The newest yearly report covers the year so far, next to the same days of the year before. Reports for older years come after the newest yearly report. Growth only compares a number when Growth has the number for the whole period before, and the report names the numbers Growth could not compare. With an AI set up, **Write summary** adds a few sentences about what changed and what to do next. Save the report as PDF, Markdown or text, or copy the report.

**Ask AI.** Ask questions about your numbers. The AI you chose answers from the data on your computer. If you use the Claude Code or Codex agent, **Ask the agent** sends the question to the agent instead. The agent can then change your screenshots in the same chat.

## How Growth checks if new screenshots worked

When you upload screenshots to App Store Connect from Open Screenshot Generator, Growth saves the day, the version the screenshots went to and the project the screenshots came from.

New screenshots are not in the App Store until the version with the new screenshots is released. So Growth waits for the release. Then Growth compares your **download rate** (how many of the people who saw your app downloaded your app) in the 14 days before the release with the 14 days after the release. Growth leaves out the release day itself, because half of the release day is before the release and half is after.

With only a few hundred visitors, the download rate goes up and down by chance. So Growth checks if a change is real or just luck. Growth gives no result in the first 7 days after the release. Until all 14 days are in, Growth only says up or down when Growth is at least 99% sure, because Growth checks again every day, and a lucky day could otherwise look like a real change. After 14 days, 90% sure is enough. Until Growth is sure, Growth says how many days are left. Without App Analytics, Growth compares downloads per day instead.

Growth compares the weeks before and after the release. Growth does not run a controlled test. An App Store feature, a sale, a holiday or a store page change in the same weeks can change the same numbers. So Growth lists all other events on the timeline from the same weeks next to the result, and never says the screenshots caused the change. For a controlled test, use product page optimization in App Store Connect. Product page optimization shows two sets of screenshots to different people at the same time.

## The AI agents

The Claude Code and Codex agents in the desktop app can read the same numbers with six tools: `get_store_overview`, `get_store_metrics`, `list_store_reviews`, `list_store_insights`, `get_store_listing` and `list_store_events`. The agents can only read. You always send replies and store page changes yourself, from Growth.

Other AI tools connected to the app cannot see your App Store numbers, because the numbers include your sales. To let other AI tools see your numbers, go to **Setup** and turn on **Let external AI tools see your App Store numbers**.
