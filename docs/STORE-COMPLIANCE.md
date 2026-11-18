# Store compliance

Apple and Google turn apps down for the same few reasons again and again: a demo account that doesn't work, a privacy form that doesn't match the app, screenshots that promise things the app doesn't do. Store compliance lists those reasons with the fix for each one, gives you a checklist to go through before you send your app for review, and shows the dates new laws and store rules start.

Click **Store compliance** (the shield) on the left edge of the window, under Growth.

The rules come from the [App Store Compliance Playbook](https://github.com/dotnetdreamer/app-store-compliance), an open list kept on GitHub. They aren't built into the app: the first time you open Store compliance, the app gets the newest rules from GitHub and keeps them on your computer. So when the playbook changes, you see the change the next time you open Store compliance after starting the app, and everything still works when you're offline.

## Plain words

The playbook is written for developers and lawyers. Where it has a plain-words version of a rule, a deadline, a checklist box or a checklist heading, that's what you see. The exact wording is always one click away:

- On a rule, open it and look under **For your developer**.
- On a deadline, open it to see the law's full name and the playbook's words.
- On a checklist box, click the **(i)** after it.

When the playbook changes a rule's words, you see its own words for that rule until the plain version is updated too, so the plain words never say something the playbook no longer does.

## Pick your stores

At the top right, pick **App Store**, **Google Play** or both. The checklist, the rules, the deadlines and the AI only show what's about the stores you pick.

## Overview

- **Ready for review?** shows how much of the checklist is done for the project that's open in the editor. Tick the two checks under it first: they stop most rejections.
- **Let AI check your app** opens Ask AI with the check ready to run.
- The numbers below go straight to why apps get rejected, the deadlines in the next 90 days and the guides.
- After the playbook gets new rules or deadlines, a note says what's new. Click **See the new rules** to see only those.

## Ask AI

Ask AI uses the same AI as Growth: Claude Code or Codex on your own plan, or the AI you set up in the AI panel. Pick one at the top. The choice counts for Growth too.

- **Check my app**: tick what your app has (people sign in, it sells things, it has AI features, and so on), say what it does in a line if you like, and click **Run the check**. The AI reads the words on every artboard of the open project, in every language, plus your store page from Growth (or the store page text you paste in). It tells you which rules your app might break, with the exact words on the screenshot that cause the problem and the fix from the playbook. If your project has more text than one check can read, the form tells you which artboards the AI skips.
- **I got rejected**: paste the message Apple or Google sent. The AI says what the reviewer wants, which rule it is and what to change, and writes a reply you can paste into App Store Connect or the Play Console. Click **Copy the reply**.
- Or ask anything: "Can I link to my website so people pay there?", "Do I have to let people delete their account?"

A rule the AI names shows as a chip. Click it to read the rule and its fix. The AI can only name rules that are in the playbook, and a quote has to be on your screenshots: anything else the AI makes up is left out. The AI only reads words, so it can't see things like a broken demo account. Go through the checklist too.

### Let Claude Code read your app's code

In the desktop app, click **Add your app's code** above the message box and pick the top folder of your app's code. From then on Claude Code looks in your code when it answers a question, works out a rejection or checks your app. Each project keeps its own folder.

- Only the folder's location goes to Claude Code. It opens the files it needs itself, the same way it does in your terminal, and it can't change a file or run anything.
- It can't open files that hold passwords or keys, such as `.env` files and signing files, or anything outside the folder.
- A problem it finds in your code shows the file, the line and the code itself. The app checks that those words really are in that file, and leaves the finding out when they aren't.
- Only Claude Code reads code. With Codex or the AI panel picked, the folder stays but isn't read.
- What Claude Code finds in your code goes only to Claude Code. If you switch to Codex or the AI panel later in the chat, they get the chat without those answers.
- If macOS asks whether Open Screenshot Generator can open the folder, click **Allow**. If macOS blocks the folder, the folder says so and Ask AI answers without your code. Allow it in System Settings > Privacy & Security > Files & Folders, then come back to the app or click **Check again**.
- Reading code uses your Claude plan, and a check can take a few minutes.
- To stop Claude Code reading the folder, click the **x** on it.

## Checklist

The playbook's checklist, box by box, for the project that's open in the editor. Your ticks stay with that project, so each app's project has its own checklist.

- Tick a box when it's done.
- If a box doesn't fit your app, click **Doesn't apply** and say why in a few words, for example "No login, so no demo account". The box then counts as done.
- Boxes marked **Every app** can't be skipped: every app needs a privacy declaration that matches what it collects, and a privacy policy people can open from the app.
- Point at a box and click the sparkle to ask the AI what the box means and how to check it.
- **Start over** unticks every box, for your app's next version.

## Why apps get rejected

Every rule in the playbook, the most serious first: **Critical**, then **High risk**, **Medium risk** and **Low risk**. Search by word or by guideline number, like "delete account" or "5.1.1", or press **/** to jump to the search. Click a rule to see what gets an app rejected, how to fix it, and, for your developer, the playbook's exact words and the words to look for in the app's code.

## Deadlines

The dates new laws and store rules start, month by month, soonest first. Pick a region to see only its deadlines. Click a deadline to see all its dates, the law's full name, read the law itself, or ask the AI what it means for your app. **Already started** lists the ones that have begun.

## Guides

The playbook's guides: Apple's and Google's rejection maps, how to appeal a rejection, the rules by kind of app, and the laws in the EU, the USA and other countries. A guide downloads the first time you open it and then opens offline too. Links inside a guide open the other guide right there. The guides are in the playbook's own words.

## Updates

The dot at the top right says where the rules stand:

- **Up to date**: the app checked GitHub and has the newest rules.
- **Offline** or **Couldn't check for updates**: GitHub couldn't be reached. You see the rules saved on your computer, and the app checks again the next time you open Store compliance. Click the round arrow to check now.
- **Couldn't use the update**: the newest version on GitHub has a file the app can't read. You keep the rules that worked until the playbook is fixed.

The app checks GitHub when you first open Store compliance after starting the app, and again when you open it six hours later. It never checks in the background.

## Credits

The rules, the checklist and the guides are the work of the App Store Compliance Playbook's author, Mirza Iqbal (mjmirza), under the OpenRoots Agent License 2.3. The copy the app keeps on your computer always includes the playbook's NOTICE file, with its copyright line and its license.
