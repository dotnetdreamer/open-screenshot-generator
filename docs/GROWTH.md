# Growth: your app's numbers, reviews and store page

Growth shows how your app is doing in the App Store and on Google Play, in the same app where you make your screenshots. Growth helps you answer questions like these:

- Did my new screenshots bring more downloads?
- In which countries do people download my app?
- What do people write in their reviews, and how is my star rating moving?
- What do people like and dislike about my app, and about my competitors' apps?
- What on my store page costs me downloads?
- What do my competitors show in each country, and when do my competitors change their screenshots?
- Where does my app show up when people search the App Store, and for which words?

To open Growth, click **Growth** on the bar at the left of the window. After you upload screenshots to App Store Connect, you can also click **See results in Growth**. **Editor**, at the top of the same bar, takes you back to the editor, just as you left it.

Growth works in the desktop app only, except **Competitors** and **Keywords**. Competitors and Keywords need no key, so both also work in the web version. Growth opens on **Ask AI**. In the web version, and in the desktop app before you add a key, every other screen of Growth is empty. Buttons that need your app are turned off. Point at a button to see why the button is off.

At the top of Growth, pick the app. With both keys, the list shows your App Store apps and your Google Play app in two groups.

## Set up Growth with Ask AI

The quickest way to set up Growth is to let the assistant in **Ask AI** do it for you.

1. Pick where your app is: **App Store**, **Google Play** or **Both**.
2. A browser opens next to the chat, on App Store Connect or Google Cloud. Sign in there yourself with your email, your password and the code sent to your phone. Passkeys don't work in this browser.
3. The assistant goes through the pages for you. It makes the API key or the service account key, and it finds your vendor number and your report files. Before anything changes in your account, like making a key or inviting the service account, the chat asks **Can I press...?**, or **Can I choose...?** for an option in a list. Click **Yes, press it**, or click **I'll press it myself** and press it in the browser.
4. When the key file downloads, Growth saves it for you. The key file stays on your computer, and the AI never sees the key, not even when a page shows it.

The assistant only opens App Store Connect, Google Cloud and Play Console. It never deletes, removes or turns anything off, and it doesn't touch payments or agreements. On a sign-in page it doesn't type or click anything, and it never reads your password or the codes you type. If you'd rather do it yourself, click **I'd rather set it up myself**, or use **Setup** as described below.

The card at the top of the chat shows what's connected and what's left. Click a part that's left, like **Vendor number**, and the assistant sets up that part. Already have a key file? Click **Add a key file** under the chat, or drop the file on the chat.

After setup, ask about your numbers in the same chat. Ask AI uses the same AI as the rest of Growth (see Which AI Growth uses).

## Set up Growth for the App Store

Growth uses the same App Store Connect API key as the screenshot upload. If you already upload screenshots from Open Screenshot Generator, Growth may work right away.

1. Open Growth and go to **Setup**.
2. If Setup shows no API key, click **Add your key** and follow the steps. An API key with the **Admin** role loads all the data. An API key with another role loads only part of the data. The list under **Data from Apple** says which role each part needs.
3. Enter your **vendor number**. You find the vendor number in App Store Connect, at the top of **Payments and Financial Reports**. Growth needs the vendor number for downloads, in-app purchases and earnings.
4. Growth refreshes your numbers on its own when the numbers are older than 6 hours. To change the 6 hours, use **Refresh when the numbers are older than** under Setup. To get the latest numbers now, click **Refresh**.

When the numbers arrive:

- **Store page, reviews and ratings:** in a few seconds.
- **Downloads, purchases and earnings** (Apple's Sales and Trends): in a few minutes, for up to a year back. Apple adds each day's numbers the next morning, Pacific time.
- **Times seen, page visits and download rate** (Apple's App Analytics): Apple first has to turn on App Analytics for your app. Apple turns on App Analytics when an API key with the Admin role asks, and Growth asks the first time you refresh with an Admin key. The first numbers take a day or two. After the first numbers, each day's numbers arrive a day or two later. Apple keeps each App Analytics file for 35 days, so after a longer break between refreshes some days can be missing. Setup then says how many, and Growth asks Apple for those days again with an Admin key, at most once a month. Until those days arrive, their downloads come from Sales and Trends, and times seen and page visits leave them out.

Apple does not accept an API key when your computer's clock is more than about two minutes ahead. Growth and the screenshot upload use Apple's time instead, so a wrong clock on your computer does not stop Growth or the upload.

## Set up Growth for Google Play

Growth uses the same Google Play service account key as the screenshot upload. Growth shows the app with the package name of the key. To see another app, change the package name of the key.

1. Open Growth and go to **Setup**.
2. If Setup shows no Google Play key, add the key under **Google Play service account key**: choose the key file (JSON) you downloaded from Google Cloud, and type the package name of your app, such as `com.example.app`.
3. Your store page and your reviews load right away. To load and answer reviews, the service account needs the **Reply to reviews** permission in Play Console.
4. Downloads, page visits and ratings come from monthly report files that Google keeps for your account. In Play Console, open **Manage account**, then **Play apps reports**, then **Statistics**. Click **Copy Cloud Storage URI**. Paste the URI under **Google Play report files** in Setup, and click **Save**.
5. In Play Console, under **Users and permissions**, give the service account the **View app information** permission for the whole account. In Play Console, the whole-account setting is called Global. The permission can take a day or more to work.
6. Crashes and freezes come from Android vitals, through the **Google Play Developer Reporting API**. Google Cloud keeps that API turned off until you turn it on for the project of your service account. Under **Crashes and freezes** in Setup, click **Turn on the API**, then click **Enable** on the page that opens. The next refresh loads the numbers. The same **View app information** permission is enough.

When the numbers arrive:

- **Store page and reviews:** in a few seconds. Google sends only the reviews written or changed in the last 7 days. Growth keeps every review Growth has loaded, and the monthly review files bring the older reviews.
- **Downloads, page visits, download rate and ratings** (Google's report files): Google adds each day's numbers 3 to 7 days later.
- **Crashes and freezes:** Google adds each day's numbers a day or two later.
- **Times seen and earnings:** Google Play does not send times seen or earnings to Growth.

Google gives a rating average without the number of ratings, and Google's average can differ a little from the stars in Play Console.

## Your data

Your keys and your numbers stay on your computer. Growth gets your numbers from Apple and Google directly.

The one exception is AI. When you ask the AI to write a reply, store page text or a report summary, or you ask a question, Growth sends the reviews, the store page text or the numbers to the AI you chose. The AI is Claude Code or Codex on your own plan, or the AI you set up in the AI panel.

When you ask the Claude Code or Codex agent instead, the agent reads your numbers itself and sends the numbers to Anthropic or OpenAI with the rest of the chat.

Competitors asks Apple's public App Store lookup about the apps you follow and about your own app, by their App Store ids, in the countries you check. The lookup needs no key and no account. In the desktop app, Competitors also opens the public Google Play page of each Google Play app you follow, and of your own Google Play app, in the countries you check, the way a web browser opens the pages. Opening the pages needs no key and no account.

For the stars of your ratings on Google Play, the desktop app opens your app's public Google Play page, the page anyone sees in a web browser. For **Competitor reviews**, Growth reads the public reviews of the apps you follow: the App Store's list of reviews, which needs no key, and the reviews on each Google Play page. When you add a Slack webhook, Growth posts the stars, the title and the start of each new review to your Slack channel, and nothing else.

To read your Google Play store page, Growth opens a draft of the store page in Play Console, reads the draft and deletes the draft again. The draft changes nothing on Google Play. Google allows one open draft per service account, so Growth waits while a screenshot upload to Google Play is running.

## Which AI Growth uses

Go to **Setup** and pick an AI under **AI to use**. **Automatic** uses the first AI that is ready on your computer: Claude Code on your plan, then Codex, then the AI from the AI panel. If a request fails, Growth shows why and does not try the next AI.

Claude Code and Codex must be installed and signed in on your computer. Each request runs once on your plan, with no tools, and the chat is not saved. Codex still updates its own cache and database files in the app's Codex folder.

The AI buttons work in every editor window, also in a tab that you moved into a window of its own. **Stop** ends a request. Closing or reloading a window also ends the AI requests the window started. A report summary or a store page translation keeps running while you look at another section of Growth, and the result is waiting when you come back. The AI buttons stay off, with the reason, until an AI is ready.

## Checking while you work

While the desktop app is open, Growth keeps checking your apps, also while you work in the editor. Growth refreshes each app you refreshed in Growth before, one app at a time, when the numbers are older than your setting. When Growth finds a change, such as a lower download rate, a falling rating or a new record, a message tells you, and the Growth button shows the number of new insights. New reviews get a message too (see Replies under [Ratings and reviews](#ratings-and-reviews)).

Growth starts its record of your ratings the first time it reads them, so keep the desktop app open now and then: each day Growth refreshes adds a day to the record.

To turn the checking off, go to **Setup** and turn off **Keep refreshing while you edit**. Growth cannot check while the app is closed.

Competitors checks the apps you follow twice a day while the editor is open, in the desktop app and in the web version (see [Competitors](#competitors)).

## The sections of Growth

**Overview.** Your main numbers for the time you pick, compared with the same number of days before. A chart shows any of the numbers, with your new versions and screenshot uploads marked on the chart. At the top, **Did the new screenshots work?** compares your newest screenshots with your previous screenshots (see below). For a Google Play app, the main numbers are page visits, download rate, new downloads and updates.

**Insights.** Cards about what changed and what to do next. For example: your app was seen more or less often, Apple probably featured your app, a country where your store page is not in the main language, complaints that come up again and again in reviews, a lower rating after a new version, or problems on your store page. Each card has a button for the next step. Hide a card when you are done with the card. If the same change still shows the next week, a new card appears.

**Ratings and reviews.** Five sections of their own, under **Ratings and reviews** on the left. See [Ratings and reviews](#ratings-and-reviews) below.

**Keywords.** Where your app shows up when people search the App Store, for the words you pick, in each country, every day. See [Keywords](#keywords) below.

**Store page.** Your app's name, subtitle, keywords, promotional text, description and what's new, in every language, with Apple's character limits. The checks on the right find wasted keyword space (spaces after commas, repeated words, and words already in your name or subtitle), a subtitle that repeats the name, text that is not translated, and languages without their own screenshots. Many checks have a **Fix** button.

Every edit, fix and AI suggestion goes to **Changes to apply**. Nothing changes in App Store Connect until you click **Apply in App Store Connect**. Your changes stay until you click **Apply in App Store Connect** or **Discard all**, also when you open another section, close Growth or restart the app. You can change the promotional text at any time. You can change the other fields only while a new version is being prepared.

A Google Play store page has a title (30 characters), a short description (80 characters) and a full description (4,000 characters). You can change every field at any time. **Apply in Play Console** sends all your changes together. Google checks the changes before people see the changes, which can take up to a week. When Google does not send the changes for review on its own, send the changes for review in Play Console. The checks for Google Play include words that Google's rules do not allow in a title, such as best, #1 or free, and a missing short description.

**Competitors.** Apps you follow on the App Store, and in the desktop app on Google Play, with their screenshots, rating, version and price in each country, next to your own screenshots. See [Competitors](#competitors) below.

**Countries.** Every country with its times seen, page visits, download rate, downloads and earnings, and the main language of the App Store in that country. For a Google Play app, the table has no times seen and no earnings. Growth takes the main language from its own list, not from Apple. People whose phone is set to another App Store language see the App Store in their phone's language instead. When your store page does not have the main language of a country, **Translate screenshots** opens your project's languages with the missing language ticked.

**Timeline.** Everything that happened to your app, on one chart: new versions and screenshot uploads, which Growth adds by itself, store page changes, and events you add yourself, such as an ad campaign or a price change. A screenshot upload shows the project the screenshots came from. Each event shows what your numbers did around the event.

**Reports.** A weekly, monthly or yearly report. The report compares your numbers with the period before, and shows your top countries, how people found your app, your reviews and your events. The newest yearly report covers the year so far, next to the same days of the year before. Reports for older years come after the newest yearly report. Growth only compares a number when Growth has the number for the whole period before, and the report names the numbers Growth could not compare. With an AI set up, **Write summary** adds a few sentences about what changed and what to do next. Save the report as PDF, Markdown or text, or copy the report.

**Ask AI.** Where Growth opens. The assistant sets Growth up for you (see Set up Growth with Ask AI), and answers questions about your numbers. The AI you chose answers from the data on your computer. If you use the Claude Code or Codex agent, **Ask the agent** sends the question to the agent instead. The agent can then change your screenshots in the same chat.

## Ratings and reviews

### Ratings

Your star rating over time, your new ratings, and the rating in every country. Pick a country at the top, or click a country in the table.

- **All ratings** shows your average rating and how many ratings you have, day by day. Click **Compare with** to draw the apps you follow on Competitors beside yours, up to 3 at a time.
- **New ratings** shows the ratings people gave each day, week or month, split by stars. A grey part is new ratings whose stars Growth can't tell.
- **Written reviews** shows the reviews with text, split by stars. The stores send every written review, so this chart goes back to your first review.

The App Store and Google Play don't keep a history of your rating. They only say what your rating is now. So Growth keeps its own record, from the first day it reads your ratings, and each refresh adds a day. New ratings are the difference between two days. Growth needs two days to show new ratings, and a day Growth didn't refresh adds its new ratings to the next day it did.

Where the numbers come from:

- **App Store:** Apple says how many ratings your app has in each country and their average, but not how many ratings have each number of stars. Growth works out the average of the new ratings from the two averages, except when an app has many ratings and only a few new ones: Apple rounds the average, and the rounding is then bigger than the change. **Ratings by stars** shows the stars of your written reviews instead.
- **Google Play:** your monthly report files give your average rating for every day, and the average of the ratings people gave that day. The files don't say how many ratings there are. The desktop app reads your Google Play page in your 3 busiest countries twice a day, for the number of ratings and how many have each number of stars. With those, Growth knows the stars of each new rating.

#### App health

Under the ratings chart, on the same days, Growth shows how often your app crashes and freezes, and how many written reviews mention crashing or freezing. Point at a day on either chart to see both. Each store's numbers keep their own meaning:

- **App Store:** crashes for every 1,000 sessions, from App Analytics. Apple counts only people who share analytics with developers, and sends crash numbers only for days when at least five of them had a crash. So a small app can have no crash numbers at all, and a day without numbers isn't a day without crashes. When Apple sent crash numbers for only some of a version's days, Growth says so ("on 6 of 15 days"), and doesn't compare that version with others. Freezes are Xcode's hang rate for your newest versions: how long the app froze for each hour it was used, on a typical iPhone.
- **Google Play:** the share of people who had a crash, or a freeze of the app, while they used it, from Android vitals. Google's lines are 1.09% for crashes and 0.47% for freezes. Above them, Google Play can show your app to fewer people. The chart draws the lines when your numbers come near them.

The numbers cover every country, even when you pick one country at the top.

When a version crashes or freezes clearly more or less than the version before it, a sentence above the chart says so, with the rates of both versions, the reviews that mention crashes since that version came out, and how your rating changed since then. **Show on the charts** shades the version's days on every chart, and **Read the reviews** opens those reviews. Growth says a version came with more crashes only when both versions have enough sessions or users to compare: 200 sessions on the App Store, 200 people across the days on Google Play.

**Versions** lists every version, newest first: its dates, its new ratings (App Store) or written reviews (Google Play), its crash rate and how it compares with the version before, its freezes, and how many reviews mention crashes. Newest means the highest version number on the App Store, and the highest build number on Google Play. Click a version to shade its days on the charts.

- **Dates:** **Released** is the day the App Store put the version out, for versions Growth saw come out. **Seen** is the first and the last day the store counted people using a version. Google Play doesn't say when a build came out, so its versions show **Seen**.
- **Google Play names:** Android vitals count builds, not versions. Each written review says both its build and its version, so Growth names a build after its reviews, and a build nobody reviewed shows as **Build 205**. When you gave the release its own name in Play Console, such as "New help form", that name shows under the version.

If Ratings has no ratings yet, it still says where the crash numbers stand, with the button that fixes their setup.

### Reviews

Every written review, with the ones that still need you first.

- **To do** has the reviews without a reply. **Replied** has the ones you answered, also replies Apple is still checking. **Done** has the reviews you marked done because they need no answer. **All reviews** has every review.
- With more than one app, click **Every app** to see the reviews of all your apps in one list, from the App Store and Google Play. Each reply goes to the right store.
- Filter the reviews by stars, country (or language on Google Play), version, tag, topic and date, or search the text of the reviews and your replies. **Stars changed** shows only the reviews whose stars changed.
- Click **Tag** on a review to add your own labels, such as Bug or Feature request. Tags are the same for all your apps.
- Click **Done** on a review that needs no answer. It leaves To do. **Back to To do** puts it back.
- Tick reviews to tag them, mark them done or export them together.
- **Export CSV** saves the reviews on the list as a spreadsheet file, with the stars, the text, your reply, the tags and the topics.

To answer a review, click **Reply**. With an AI set up, **Suggest a reply** writes a draft in the reviewer's language, from the review, your app's description and the style of your earlier replies. Pick how the reply sounds: friendly, formal or short. **Templates** fills in a reply you saved before. Growth sends nothing until you click **Send reply**. Apple checks every reply before the reply shows under the review.

People can change their stars at any time, and many do after a reply. When a refresh finds new stars on a review, the review says so, for example **Changed from 2 to 4 stars after your reply**.

Keys: **J** and **K** move between reviews. **R** opens the reply box. **E** marks a review done. **X** ticks a review. **/** jumps to the search.

On Google Play, a review shows the reviewer's language instead of the country, and you filter the reviews by language. A reply can have up to 350 characters, and Google Play shows the reply right away. Google lets you delete a reply only in Play Console, so Growth has no **Delete** button for Google Play replies. To change a reply, click **Edit**.

### Review summary

What people like, what they dislike and what they ask for, in your app or in an app you follow on Competitors. Pick the app, the country, how far back and which stars, then click **Write summary**. The summary needs an AI (see Which AI Growth uses).

The AI reads the newest reviews, up to 200, and sorts them into themes. Growth then counts the reviews in each theme and shows two of them in the reviewers' own words, so every count is a count of real reviews. Which reviews fit a theme is the AI's call: open a theme to read the reviews behind it. For your own app, **Open the reviews in Reviews** shows them in the inbox.

For your app, the summary also suggests **Lines for your screenshots** from what people like. For an app you follow, it lists **What people miss** in that app, which your screenshots could show if your app has it. Growth keeps your last 12 summaries for each app, so you can compare a new summary with the one before.

To get a summary without asking each time, pick **Every week** or **Every month** under **Write a summary on its own**. While the desktop app is open, Growth then writes a summary of the last 7 days (or 30 days) of reviews when the last one is a week (or a month) old, and a message tells you it's ready. Each summary is one request to the AI you picked under Setup.

### Competitor reviews

What people say about the apps you follow on Competitors, in each country you check. The screen shows the app's rating, its ratings by stars, and what people complain about in the 1 and 2 star reviews, next to your own app's complaints. **Summarize with AI** opens the review summary for that app.

- **App Store:** Apple shows anyone the newest 500 reviews of an app in each country. Growth reads 50 at a time, and **Show more** reads 50 more. The stars on the screen are those of the reviews Growth read.
- **Google Play:** Google doesn't let programs read all the reviews of other apps. An app's Google Play page shows 20 reviews that Google picks, some of them old. Growth keeps those 20 each time it checks your competitors.

### Replies

How you answer reviews, in the time you pick at the top: how many reviews got a reply, how long a reply took, how many reviews are waiting, and how many people changed their stars after your reply. Below are your **Reply templates** and your **Tags**, and the alerts for new reviews.

In a template, write `{name}` for the reviewer's name and `{app}` for your app's name. Growth fills them in when you use the template.

**Alerts for new reviews:** Growth looks for new reviews each time it refreshes your numbers, also while you work in the editor. A message tells you about every new review, or only about 1 and 2 star reviews, or about none. In the desktop app, Growth can also post new reviews to a Slack channel. In Slack, add the app Incoming Webhooks to your workspace, pick the channel, copy the Webhook URL and paste the URL under **Also post them to Slack**. **Send a test message** checks that the URL works.

## Keywords

Where your app shows up when people search the App Store on an iPhone, for the words you pick, in up to 5 countries, every day. Keywords is for App Store apps. Keywords works in the desktop app and in the web version. In the web version, and without a key, find your app under **Which app is yours?** first. Your app is the same app you named under **Your app** on Competitors.

**Add keywords.** The first time, Growth offers the words on your store page, or the words in your app's name. Pick the words, or type your own words with commas between them, and click **Track**. You can track 50 keywords.

**Your rank.** Growth searches the App Store for each keyword in each country once a day while the app's main window is open, and keeps your rank for each day it checks. Rank 1 is the first app people see. **Not found** means your app isn't among the apps the search lists. Click **Check now** to search again right away.

- At the top, Growth counts your keywords in the top 10, in the top 50, found anywhere and not found, and compares each count with a week ago.
- The table shows each keyword's rank, how far the rank moved, the last 30 days as a small line, the app people see first, and the rank of each app you follow on Competitors.
- **Day**, **Week** and **Month** compare with a check from 1 to 3 days, 7 to 10 days, or 30 to 37 days before the latest one. Point at a change to see the day it compares with. Without a check in that time, there's no change to show.
- Show only the keywords in the **Top 10**, the keywords that **Moved**, the keywords **Not found**, or the keywords **Not on your store page**.
- With more than one country, pick the country above the summary.

**How popular a keyword is.** In the desktop app, connect Apple Ads to see the popularity of each keyword. Apple Ads gives each keyword a score from 1 to 100 in each country, and 100 is the word people search most in that country. The score compares words with each other. It isn't a number of searches. Apple Ads gives a new score each week, for the week from Sunday to Saturday. Growth only reads the scores. Growth never makes ads and never spends money.

- To connect, click **Connect Apple Ads** on Keywords or under Setup, then click **Make a key** and **Copy public key**. In Apple Ads, go to Account Settings, then API, paste the public key and click Save. Apple Ads then shows a clientId, a teamId and a keyId. Paste the three lines in Growth and click **Connect**. The private half of the key stays on your computer. If you made a key with OpenSSL before, click **I have a key already** instead.
- Apple Ads shows API only to a user with an API role. An admin of your Apple Ads account can invite you, or another Apple Account of yours, under Account Settings, then User Management. The API Account Read Only role is enough for Growth.
- The table gets a **Popularity** column with the score and five bars. Click **Popularity** to put the most searched keywords first. **No score** means Apple Ads doesn't list the keyword. Apple Ads only lists words with at least 500 searches in the week, so no score doesn't mean nobody searches the keyword.
- Click a keyword to see its score, and how much the score moved in about a month. **Popularity** shows the score week by week.
- **Map** puts your keywords on one chart. Higher up, the keyword is searched more. Further left, the app with the fewest ratings in the top 10 has fewer ratings. The dashed line is your app's number of ratings, so for a keyword left of the line, an app with no more ratings than yours made the top 10. The color of each dot is your rank now. Popular keywords left of the line are your best chances. Click a dot to see the keyword up close. A keyword goes on the map once it has a score and every other app in its top 10 shows its ratings. The keywords that aren't on the map are listed under it, with the reason.
- Growth asks Apple Ads again only for scores more than a day old, normally with one request for all your keywords in a country. The ideas on screen are asked about the same way. When Apple Ads gives no answer for a country, the table says why, and **Check now** asks again.

**One keyword up close.** Click a keyword. **Rank over time** draws one point for each day Growth checked, with the apps you follow beside yours, and marks your new versions, new screenshots and store page changes. **Search results** shows the first 10 apps people see for the keyword, with the first three screenshots of the first three apps. Click **Follow** to follow one of the apps on Competitors. When every app in the top 10 shows its ratings, Growth also says how many ratings the app with the fewest has, next to the number of ratings your app has.

**Your store page.** The App Store finds your app by the words in its name, subtitle and keywords, and puts single words from the three fields together. For each keyword, Growth says if the words are on the store page that people in that country read. When a word is missing, **Add to keywords** adds the word at the end of your keywords as a change on **Store page**. Nothing changes in App Store Connect until you apply the change on Store page.

On **Store page**, each keyword under your keywords that you track shows its rank in one country whose shoppers read that language. A keyword you don't track yet has a dashed line around it, and **Track** tracks it. Two checks on Store page come from Keywords:

- Keywords you track that aren't on your store page. **Fix** adds the missing words to your keywords, as many words as fit in 100 characters.
- Keywords on your store page that search didn't find your app for in any of Growth's last 7 checks, when the last check is recent. **Find other keywords** opens Keywords.

**Ideas.** Words worth a look, in four lists:

- **Top apps**: the words the first apps for your keywords put in their names, and how many of those apps use each word.
- **Your store page**: the words on your store page that you don't track yet.
- **Competitors**: the words in the names of the apps you follow.
- **AI**: words the AI you set up thinks people search for. The AI only suggests words. Growth never shows a number the AI wrote.

You can click **Check** to search the App Store for an idea and see where your app is for that word before you track it, or **Check all** to check every idea in the list that isn't checked yet. **Within reach** means an app with no more ratings than your app is in the top 10 for that word. **Crowded** means the top 10 is full and every app there has more ratings than your app. A word with fewer than 10 apps, or with an app that doesn't show its ratings, gets neither.

With Apple Ads connected, each idea shows its popularity, and the ideas come best chance first: first the words your app can rank for (your app is in the top 10 already, or the word is within reach), then the words Growth can't judge yet, such as the ones you haven't checked, then the crowded words. In each group, the words people search most come first.

**How Growth reads your rank.** Growth reads Apple's public App Store search, which needs no key. That is not the App Store app on an iPhone, and the App Store app can put apps in a different order. On 15 November 2026 we compared Apple's public search with the search on the App Store website, for 18 searches in 8 countries. The first app was the same in all 18 searches. Of the first 10 apps on the website (180 places in all), 108 were at the same place in Apple's public search, 170 were within two places, and one was 30 places off. The App Store app itself wasn't compared. Ads aren't counted. Apple's servers can answer with a copy from up to a day earlier, so a change can show up a day late.

Growth checks only while the app's main window is open, so a day without a check has no rank, and Growth never counts that day as a miss. Apple asks for about 20 searches a minute. 50 keywords in 5 countries take about 13 minutes, and Growth searches in the background while you work.

Google Play's published rules ask programs not to search Google Play, so Keywords is for App Store apps only. **Remove the data** under Setup keeps your keywords and their past ranks: no store keeps past ranks.

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

The Claude Code and Codex agents in the desktop app can read the same numbers, for the App Store and for Google Play, with seven tools: `get_store_overview`, `get_store_metrics`, `list_store_reviews`, `list_store_insights`, `get_store_listing`, `list_store_events` and `list_store_keywords`. `list_store_keywords` gives the ranks from Keywords, and the popularity from Apple Ads when you connected Apple Ads. `get_store_overview` and **Ask AI** see your best ranks and biggest moves in each country too. The agents can only read, and they never ask the App Store or Apple Ads themselves: they read what Growth's own checks saved. You always send replies and store page changes yourself, from Growth, and you choose the keywords to track.

Other AI tools connected to the app cannot see your store numbers, because the numbers include your sales. To let other AI tools see your numbers, go to **Setup** and turn on **Let external AI tools see your store numbers**.
