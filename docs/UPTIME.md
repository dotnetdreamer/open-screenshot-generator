# Uptime: know when your website or server goes down

Uptime checks your website, your app's server and your app's store listing from your own computer, and tells you the moment one stops working. It also tells you when it's working again, and how long it was down.

There's no account to make and nothing to set up on a server. The checks run inside the desktop app.

Uptime is in the desktop app. Click **Uptime** on the bar at the left.

## What Uptime can check

- **Website**: a page or an API that should open, such as your app's website, its privacy policy or your server's health page. Uptime can also look for words on the page, read a value in a JSON answer, and warn you before the site's security certificate runs out.
- **Server port**: a server that should take connections, such as a database, a mail server or a game server.
- **Ping**: a computer or a router that should answer a ping.
- **Domain record**: a DNS record of your domain that should be there, or keep a value, such as the address your domain points to or your mail servers.
- **Store listing**: your app on the App Store or Google Play, in the country you choose. On the App Store, Uptime looks the app up by its number in that country's store. On Google Play, it reads the app's page for that country and looks for the **Install** button (or the price, for a paid app). You hear at once if the app stops being offered there, and when a new version goes live on the App Store. For an app that isn't out yet but is open for pre-registration, set **Counts as up when** to **Its page is there**. You see a **Pre-register** button on its page when you're signed in to Google Play, but Uptime reads the page signed out, and then Google Play often shows no button at all, the same as for an app that isn't offered in that country. Left at **People in that country can install it**, a page that only takes pre-registrations counts as down.

## Add your first monitor

1. Click **Uptime** on the bar at the left.
2. Paste an address into the box, such as `https://myapp.com`, `db.myapp.com:5432` or a link to your app on the App Store, and click **Start watching**. Uptime reads what you pasted and fills the form.
3. Check the fields, and pick **How often** Uptime checks. Every minute is a good start.
4. Click **Test it now**. Uptime runs the check once from your computer and shows the answer, so you see what it will see.
5. Click **Start watching**.

If you don't type a name, Uptime names the monitor, and that name follows it: point a store listing at another app and the name becomes that app's. A name you type stays, and so does the name of a copy.

Uptime also suggests monitors from what the app already knows: the website you published from **Website** (its home, support and privacy pages, which Apple and Google check), and the apps you connected in **Growth**. Click **Watch** beside one to add it. The rest stay under **More to watch** on the overview and at the top of **Add a monitor**; click the cross beside one you don't want.

## When something goes down

A check fails when the page doesn't answer in time, answers with an error, the server refuses the connection, the words you asked for aren't on the page, and so on. Uptime says which, in plain words.

So that a moment's hiccup doesn't wake you up, Uptime checks again before it calls anything down. **Call it down after** sets how many failed checks in a row that takes. While it's checking again, the monitor shows **Checking again**.

Some checks can't tell either way: the store answered with an error of its own, its page couldn't be read, the answer came from another page on the way (such as a consent page), or this computer wouldn't let the check run. Such a check counts as neither up nor down and sends no alert. The overview says Uptime couldn't check the monitor, and the monitor's page says why.

When a monitor goes down:

- the app shows a notification, and on a Mac the Dock icon shows how many monitors are down
- the **Uptime** button on the bar shows a red number
- each place you added under **Alerts** gets a message

When it comes back, you get one more alert that says how long it was down.

## Where alerts go

Click **Alerts** at the bottom of the monitor list.

- **On this computer**: a notification, with or without a sound. You can also ask for a reminder while a monitor stays down.
- **Other places**: Slack, Discord, Telegram, ntfy, or an address of your own that receives a JSON message for each alert. Click **Send a test** to make sure it arrives.

Each place can get alerts for things going down, coming back, certificates about to run out, and new versions of your app, always in the order they happened. A monitor can leave a place out: open the monitor, click **Edit**, and untick the place under **Send alerts to**.

When you remove or change a place, or clear or delete a monitor, the alerts still waiting to go out aren't sent. One that is already being sent finishes first, so nothing arrives once the change is done.

## Reading a monitor's page

- **Last checks**: the last 100 checks, the newest on the right, even if the last ones were days ago. The taller and redder the bar, the worse the check went: a short green bar is up, a taller yellow one failed and was checked again, the tallest red one is down. A low grey bar is a check that doesn't count: this computer was offline, or the check couldn't tell.
- **Uptime**: the share of the time it was up over exactly the last 24 hours, 7 days and 30 days. While Uptime is open, these numbers are worked out again every 15 seconds, and when you open a monitor's page.
- **Answer time**: how long the checks took. **Last hour** and **24 hours** show each check; **7 days** and **30 days** show the average of each hour. Red shading shows time it was down.
- **Last 90 days**: one bar for each day. The more time down, the taller the bar, and the colour goes from green to yellow, orange and red.
- **Outages**: each time it went down, how long it lasted, and why. If you point a monitor at something else, such as another address or another app, while it's down, that outage ends there, and the monitor starts over with the new one.
- **Last answer**: what the last check found, such as the address that answered, the security certificate and when it runs out, the DNS records, or the app's version.

You can **Pause** a monitor for an hour, four hours, a day or until you resume it, for example while you work on your server. A paused monitor isn't checked and sends no alerts.

## What happens when the app is closed

Uptime checks while the app is open, also when its window is in the background. When the app is closed, stops unexpectedly, or your computer is asleep, nothing is checked, and that time counts as neither up nor down. An outage that went on while the app was closed says so.

That works because each check only counts for the time until the next one was due: its interval, the time the check may take, and 15 seconds. A longer gap is left out, and so is any time the computer spent asleep, however short. A check that was still waiting when the computer went to sleep is thrown away, however short the sleep, since its answer would be about the sleep.

If your computer has no network at all, for example with Wi-Fi off, Uptime notices, and the checks that fail because of it don't count against your monitors. If the network is there but the internet behind it is down, the checks fail and count, the same as for anyone else on that network.

## Moving your monitors

Under **Alerts**, **Your monitors** saves every monitor to a file, and adds monitors from such a file on another computer. The places for alerts aren't in the file, since they hold your keys.

## Where the history is kept

Everything stays on your computer, in the app's own folder: each check for 30 days, and the hourly totals for 400 days. **Clear the history** on a monitor's page deletes its history, and **Delete** deletes the monitor and its history.

## Good to know

- Uptime runs from your computer, so it sees what someone on your network sees. If only your network can't reach a site, Uptime reports it down too.
- A website check reads at most the first 256 KB of a page, unless it looks for words or a JSON value, then the first 4 MB. A large file isn't downloaded every minute.
- The Google Play check reads the app's public page for the country, so a big change to that page could stop it working. Uptime then says the page couldn't be read and calls nothing down. Google Play doesn't show the version there, so new versions are only reported for the App Store.
- On a Mac, the notifications come from macOS. Allow notifications for the app when macOS asks. They show whether the app is in front or not. While your screen is shared or mirrored, macOS holds them back unless you turn on **When mirroring or sharing the display** in System Settings, Notifications. On Windows and Linux, allow them when the app asks.
