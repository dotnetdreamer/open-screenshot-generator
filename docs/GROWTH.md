# Growth: your app's numbers, reviews and store page

Growth shows how your app is doing in the App Store and on Google Play, in the same app where you make your screenshots. Growth helps you answer questions like these:

- Did my new screenshots bring more downloads?
- In which countries do people download my app?
- What do people write in their reviews?
- What on my store page costs me downloads?
- What do my competitors show in each country, and when do my competitors change their screenshots?

To open Growth, click the Growth button (an arrow going up) on the bar at the left of the window. After you upload screenshots to App Store Connect, you can also click **See results in Growth**. The pen button above the Growth button takes you back to the editor, just as you left the editor.

Growth works in the desktop app only, except **Competitors**. Competitors needs no key, so Competitors also works in the web version. In the web version, and in the desktop app before you add a key, Growth opens on Competitors, and every other screen of Growth is empty. Buttons that need your app are turned off. Point at a button to see why the button is off.

At the top of Growth, pick the app. With both keys, the list shows your App Store apps and your Google Play app in two groups.

## Set up Growth for the App Store

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

## Set up Growth for Google Play

Growth uses the same Google Play service account key as the screenshot upload. Growth shows the app with the package name of the key. To see another app, change the package name of the key.

1. Open Growth and go to **Setup**.
2. If Setup shows no Google Play key, add the key under **Google Play service account key**: choose the key file (JSON) you downloaded from Google Cloud, and type the package name of your app, such as `com.example.app`.
3. Your store page and your reviews load right away. To load and answer reviews, the service account needs the **Reply to reviews** permission in Play Console.
4. Downloads, page visits and ratings come from monthly report files that Google keeps for your account. In Play Console, open **Manage account**, then **Play apps reports**, then **Statistics**. Click **Copy Cloud Storage URI**. Paste the URI under **Google Play report files** in Setup, and click **Save**.
5. In Play Console, under **Users and permissions**, give the service account the **View app information** permission for the whole account. In Play Console, the whole-account setting is called Global. The permission can take a day or more to work.

When the numbers arrive:

- **Store page and reviews:** in a few seconds. Google sends only the reviews written or changed in the last 7 days. Growth keeps every review Growth has loaded, and the monthly review files bring the older reviews.
- **Downloads, page visits, download rate and ratings** (Google's report files): Google adds each day's numbers 3 to 7 days later.
- **Times seen and earnings:** Google Play does not send times seen or earnings to Growth.

Google gives a rating average without the number of ratings, and Google's average can differ a little from the stars in Play Console.

## Your data

Your keys and your numbers stay on your computer. Growth gets your numbers from Apple and Google directly.

The one exception is AI. When you ask the AI to write a reply, store page text or a report summary, or you ask a question, Growth sends the reviews, the store page text or the numbers to the AI you chose. The AI is Claude Code or Codex on your own plan, or the AI you set up in the AI panel.

When you ask the Claude Code or Codex agent instead, the agent reads your numbers itself and sends the numbers to Anthropic or OpenAI with the rest of the chat.

Competitors asks Apple's public App Store lookup about the apps you follow and about your own app, by their App Store ids, in the countries you check. The lookup needs no key and no account. In the desktop app, Competitors also opens the public Google Play page of each Google Play app you follow, and of your own Google Play app, in the countries you check, the way a web browser opens the pages. Opening the pages needs no key and no account.

To read your Google Play store page, Growth opens a draft of the store page in Play Console, reads the draft and deletes the draft again. The draft changes nothing on Google Play. Google allows one open draft per service account, so Growth waits while a screenshot upload to Google Play is running.

## Which AI Growth uses

Go to **Setup** and pick an AI under **AI to use**. **Automatic** uses the first AI that is ready on your computer: Claude Code on your plan, then Codex, then the AI from the AI panel. If a request fails, Growth shows why and does not try the next AI.

Claude Code and Codex must be installed and signed in on your computer. Each request runs once on your plan, with no tools, and the chat is not saved. Codex still updates its own cache and database files in the app's Codex folder.

The AI buttons work in every editor window, also in a tab that you moved into a window of its own. **Stop** ends a request. Closing or reloading a window also ends the AI requests the window started. A report summary or a store page translation keeps running while you look at another section of Growth, and the result is waiting when you come back. The AI buttons stay off, with the reason, until an AI is ready.

## Checking while you work

While the desktop app is open, Growth keeps checking your apps, also while you work in the editor. Growth refreshes each app you refreshed in Growth before, one app at a time, when the numbers are older than your setting. When Growth finds a change, such as a lower download rate, a falling rating or a new record, a message tells you, and the Growth button shows the number of new insights.

To turn the checking off, go to **Setup** and turn off **Keep refreshing while you edit**. Growth cannot check while the app is closed.

Competitors checks the apps you follow twice a day while the editor is open, in the desktop app and in the web version (see [Competitors](#competitors)).

## The sections of Growth

**Overview.** Your main numbers for the time you pick, compared with the same number of days before. A chart shows any of the numbers, with your new versions and screenshot uploads marked on the chart. At the top, **Did the new screenshots work?** compares your newest screenshots with your previous screenshots (see below). For a Google Play app, the main numbers are page visits, download rate, new downloads and updates.

**Insights.** Cards about what changed and what to do next. For example: your app was seen more or less often, Apple probably featured your app, a country where your store page is not in the main language, complaints that come up again and again in reviews, a lower rating after a new version, or problems on your store page. Each card has a button for the next step. Hide a card when you are done with the card. If the same change still shows the next week, a new card appears.

**Reviews.** All written reviews. Filter the reviews by stars, country, topic, or by whether you replied. To answer a review, click **Reply**. With an AI set up, **Suggest a reply** writes a draft in the reviewer's language, from the review, your app's description and the style of your earlier replies. Growth sends nothing until you click **Send reply**. Apple checks every reply before the reply shows under the review.

On Google Play, a review shows the reviewer's language instead of the country, and you filter the reviews by language. A reply can have up to 350 characters, and Google Play shows the reply right away. Google lets you delete a reply only in Play Console, so Growth has no **Delete** button for Google Play replies. To change a reply, click **Edit**.

**Store page.** Your app's name, subtitle, keywords, promotional text, description and what's new, in every language, with Apple's character limits. The checks on the right find wasted keyword space (spaces after commas, repeated words, and words already in your name or subtitle), a subtitle that repeats the name, text that is not translated, and languages without their own screenshots. Many checks have a **Fix** button.

Every edit, fix and AI suggestion goes to **Changes to apply**. Nothing changes in App Store Connect until you click **Apply in App Store Connect**. Your changes stay until you click **Apply in App Store Connect** or **Discard all**, also when you open another section, close Growth or restart the app. You can change the promotional text at any time. You can change the other fields only while a new version is being prepared.

A Google Play store page has a title (30 characters), a short description (80 characters) and a full description (4,000 characters). You can change every field at any time. **Apply in Play Console** sends all your changes together. Google checks the changes before people see the changes, which can take up to a week. When Google does not send the changes for review on its own, send the changes for review in Play Console. The checks for Google Play include words that Google's rules do not allow in a title, such as best, #1 or free, and a missing short description.

**Competitors.** Apps you follow on the App Store, and in the desktop app on Google Play, with their screenshots, rating, version and price in each country, next to your own screenshots. See [Competitors](#competitors) below.

**Countries.** Every country with its times seen, page visits, download rate, downloads and earnings, and the main language of the App Store in that country. For a Google Play app, the table has no times seen and no earnings. Growth takes the main language from its own list, not from Apple. People whose phone is set to another App Store language see the App Store in their phone's language instead. When your store page does not have the main language of a country, **Translate screenshots** opens your project's languages with the missing language ticked.

**Timeline.** Everything that happened to your app, on one chart: new versions and screenshot uploads, which Growth adds by itself, store page changes, and events you add yourself, such as an ad campaign or a price change. A screenshot upload shows the project the screenshots came from. Each event shows what your numbers did around the event.

**Reports.** A weekly, monthly or yearly report. The report compares your numbers with the period before, and shows your top countries, how people found your app, your reviews and your events. The newest yearly report covers the year so far, next to the same days of the year before. Reports for older years come after the newest yearly report. Growth only compares a number when Growth has the number for the whole period before, and the report names the numbers Growth could not compare. With an AI set up, **Write summary** adds a few sentences about what changed and what to do next. Save the report as PDF, Markdown or text, or copy the report.

**Ask AI.** Ask questions about your numbers. The AI you chose answers from the data on your computer. If you use the Claude Code or Codex agent, **Ask the agent** sends the question to the agent instead. The agent can then change your screenshots in the same chat.

## Competitors

Follow up to 10 apps on the App Store, and in the desktop app on Google Play too. Under **Follow an app**, type the name of an App Store app, or paste the link of an app on the App Store or on Google Play, then click **Follow**. To stop following an app, click the cross on the app.

Growth reads App Store apps from Apple's public App Store lookup, the same lookup the screenshot import uses. The lookup needs no key and no account, so Competitors works in the web version too. Growth reads a Google Play app from the app's public page on Google Play, the page anyone sees in a web browser. Google does not let programs search Google Play, so a Google Play app needs its link. Only the desktop app can read Google Play pages, so in the web version Competitors follows App Store apps only.

**Screenshots in a country.** Pick a country at the top. **Search results** shows the first three screenshots of every app, the way store search shows the apps. **All screenshots** shows every screenshot. Switch between **iPhone** and **iPad** at the top. With a Google Play app in the list, the switch says **Phone** and **Tablet**. Google Play shows the screenshots for every device in one list, so a Google Play app shows all its screenshots under **Phone**. Your own screenshots come first:

- With an App Store app in Growth, Growth looks up your app together with the apps you follow.
- With a Google Play app in Growth, Growth reads your app's Google Play page together with the apps you follow. Until the first check, your phone screenshots come from your Google Play key.
- In the web version, and without a key, name your app under **Your app**. In the desktop app, your app can be on the App Store or on Google Play.
- The project open in the editor shows as **Open project**, in the language on screen in the editor. So you can see your new screenshots next to the competitors' screenshots before you upload the new screenshots. Growth draws up to 6 3D frames in 3D, as the store preview in the editor does, and draws the rest flat.

**In each country.** A table with every country you check and every app: the rating and the number of ratings, the price, the version, or the number of screenshots. Some Google Play pages show no version number, so for those apps Growth shows the day of the last update instead. Google Play gives each country its own rating. **Own set** marks a country where an app shows other screenshots than in the first country of your list. Click a country to see the screenshots in that country.

**Countries to check.** A new list starts with your busiest countries, then the big App Store countries. You can check up to 20 countries. Each country is one look at the App Store, and Apple allows about 20 looks a minute. So a check of 8 countries takes about half a minute. Each Google Play app adds one look at Google Play in each country, and Growth waits 2 seconds between two Google Play pages. When you follow an app on a list that Growth checked in the last 12 hours, Growth looks up only the new app.

**What changed.** Growth checks the apps you follow twice a day while the editor is open, in the desktop app and in the web version. Growth compares each check with the check before. Growth lists new screenshots, new versions with what is new in each version, new names, new icons and new prices. For a Google Play app whose page shows no version number, Growth lists a new update day with what is new in the update. When an app you follow changes its screenshots, a message tells you, and the Growth button shows the number of new screenshot changes. Click **Compare** in the message, or **Show before and after** on the change, to see the old and the new screenshots. **Compare with yours** shows the new screenshots next to your screenshots. Click **Check now** to check right away.

Apple's servers can answer with a copy from up to a day earlier, so Growth can see a change up to a day late. A copy from before a change can also answer after the change. So Growth skips an answer about an older version, and counts a new price only after two checks show the new price. Growth cannot check while the app or the web page is closed.

When the App Store or Google Play does not answer in some countries, Competitors says so, and Growth asks that store again about an hour later.

Google has no public service for Google Play pages, so Growth reads the pages the way a web browser does. If Google changes how the pages are built, Growth may not find the screenshots, the name or the icon. Then Growth says that Growth could not read the Google Play pages, and still checks the App Store apps. Other changes to the pages can leave a detail such as the rating empty without a message. A developer can test other screenshots with a store listing experiment on Google Play. Growth may then see one set in one check and the other set in the next check, and report a change each time.

## How Growth checks if new screenshots worked

When you upload screenshots to App Store Connect from Open Screenshot Generator, Growth saves the day, the version the screenshots went to and the project the screenshots came from.

New screenshots are not in the App Store until the version with the new screenshots is released. So Growth waits for the release. Then Growth compares your **download rate** (how many of the people who saw your app downloaded your app) in the 14 days before the release with the 14 days after the release. Growth leaves out the release day itself, because half of the release day is before the release and half is after.

With only a few hundred visitors, the download rate goes up and down by chance. So Growth checks if a change is real or just luck. Growth gives no result in the first 7 days after the release. Until all 14 days are in, Growth only says up or down when Growth is at least 99% sure, because Growth checks again every day, and a lucky day could otherwise look like a real change. After 14 days, 90% sure is enough. Until Growth is sure, Growth says how many days are left. Without App Analytics, Growth compares downloads per day instead.

Growth compares the weeks before and after the release. Growth does not run a controlled test. An App Store feature, a sale, a holiday or a store page change in the same weeks can change the same numbers. So Growth lists all other events on the timeline from the same weeks next to the result, and never says the screenshots caused the change. For a controlled test, use product page optimization in App Store Connect. Product page optimization shows two sets of screenshots to different people at the same time.

### On Google Play

When you upload screenshots to Google Play from Open Screenshot Generator, Growth saves the day and the project the screenshots came from. On Google Play, new screenshots do not wait for a new version of the app: Google checks the new screenshots, often in a few days and sometimes in a week, and then shows the new screenshots. Google does not tell apps when the new screenshots went live. So Growth counts from the upload day. If Google took longer, set **Day the new screenshots went live** on the Overview, and Growth counts from that day instead.

Sometimes Google Play does not send new screenshots for review on its own, for example after Google rejected an earlier change. Then the new screenshots wait in Play Console until you send the changes for review. The Overview says **Not on Google Play yet**, and Growth waits until you set the day the new screenshots went live. With managed publishing in Play Console, set the day you published the changes.

On Google Play, the download rate is how many of the people who opened your store page then installed your app. Google calls the download rate the store listing conversion rate. For a controlled test on Google Play, use a store listing experiment in Play Console.

## The AI agents

The Claude Code and Codex agents in the desktop app can read the same numbers, for the App Store and for Google Play, with six tools: `get_store_overview`, `get_store_metrics`, `list_store_reviews`, `list_store_insights`, `get_store_listing` and `list_store_events`. The agents can only read. You always send replies and store page changes yourself, from Growth.

Other AI tools connected to the app cannot see your store numbers, because the numbers include your sales. To let other AI tools see your numbers, go to **Setup** and turn on **Let external AI tools see your store numbers**.
