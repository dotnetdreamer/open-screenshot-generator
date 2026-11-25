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

A few rules and deadlines are too long to say in a few short lines without losing a condition. Those get a plain title, and the playbook's own words under it.

## Pick your stores

At the top right, pick **App Store**, **Google Play** or both. The checklist, the rules, the deadlines and the AI only show what's about the stores you pick.

## Overview

- **Ready for review?** shows how much of the checklist is done for the project that's open in the editor. Tick the two checks under it first: they stop most rejections.
- **Let AI check your app** opens Ask AI with the check ready to run.
- The numbers below go straight to Test like a reviewer, why apps get rejected, the deadlines in the next 90 days and the guides.
- After the playbook gets new rules or deadlines, or corrects a deadline, a note says what's new. Click **See the new rules** to see only the new rules, or **See the deadlines**.
- At the bottom, a line says when the playbook last checked Apple's, Google's and the laws' own pages, and how many deadlines it hasn't checked again for more than 60 days. If even its newest check is older than 60 days, a warning at the top says so: something may have changed since.

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

## Test like a reviewer

Apple and Google try a few things on the version you send that no check of your words or your code can prove. Try them yourself first:

- The reviewer can sign in with your demo account.
- Your live server is up and has test data in it.
- Your review notes say where to find every feature. Click **See what to write** for the playbook's notes template, then **Copy the notes**.
- Your screenshots show this version, in use, on every device you support.
- Deleting an account works on a real phone.
- Your privacy answers match what the app collects. Every app has this one, so it can't be skipped.
- The reviewer can find and buy everything you sell.

Answer each one **Yes**, **No** or **Doesn't apply** with a reason. A **No** means fix it before you send your app. Write the version you tried at the top, like 1.2 (14). The answers stay with the project that's open in the editor.

An answer older than 30 days asks you to try it again, because a test of last month's version says nothing about this one. Click the same answer again to say it still holds today. Click a fresh answer again to take it back. **Start over** clears every answer for your next version.

### For your AI coding tool

If you use Claude Code, Codex or another AI tool with the playbook's guard, it reads these answers from a file called `.app-review-readiness.json` in your app's code folder, and stops an upload while an answer says No. Switch on **Also stop the upload while a check isn't done** to stop it until every check is done too.

- In the desktop app, **Save the file** asks where to save it. Pick your app's code folder. macOS may say names that start with a dot are hidden: keep the dot.
- On the web, **Download the file** saves `app-review-readiness.json`. Browsers drop the dot at the start of a name, so add it back.
- Or click **Copy the file**, paste it to your AI tool and ask it to save the file in your app's folder.

## Checklist

The playbook's checklist, box by box, for the project that's open in the editor. Your ticks stay with that project, so each app's project has its own checklist.

- Tick a box when it's done.
- If a box doesn't fit your app, click **Doesn't apply** and say why in a few words, for example "No login, so no demo account". The box then counts as done.
- Boxes marked **Every app** can't be skipped: every app needs a privacy declaration that matches what it collects, and a privacy policy people can open from the app.
- Point at a box and click the sparkle to ask the AI what the box means and how to check it.
- **Start over** unticks every box, for your app's next version.
- A box about one store only (it starts with Apple or Google Play) hides when you pick only the other store.
- The box about the readiness file has a button that opens Test like a reviewer, where you answer those checks.

## Why apps get rejected

Every rule in the playbook, the most serious first: **Critical**, then **High risk**, **Medium risk** and **Low risk**. Search by word or by guideline number, like "delete account" or "5.1.1", or press **/** to jump to the search. Click a rule to see what gets an app rejected, how to fix it, and, for your developer, the playbook's exact words and the words to look for in the app's code.

## Deadlines

The dates new laws and store rules start, month by month, soonest first. Pick a region to see only its deadlines. Click a deadline to see all its dates, the law's full name, read the law itself, or ask the AI what it means for your app. **Already started** lists the ones that have begun.

When the playbook corrects a deadline, the deadline shows **Changed** for 30 days, and opening it shows **What changed** with the day, in the playbook's words.

## Guides

The playbook's guides: Apple's and Google's rejection maps, how to appeal a rejection, the rules by kind of app, the laws in the EU, the USA and other countries, what a scan can prove and what only you can check, and answers to common questions. A guide downloads the first time you open it and then opens offline too. Links inside a guide open the other guide right there. The guides are in the playbook's own words.

## Updates

The dot at the top right says where the rules stand:

- **Up to date**: the app checked GitHub and has the newest rules.
- **Offline** or **Couldn't check for updates**: GitHub couldn't be reached. You see the rules saved on your computer, and the app checks again the next time you open Store compliance. Click the round arrow to check now.
- **Couldn't use the update**: the newest version on GitHub has a file the app can't read. You keep the rules that worked until the playbook is fixed.

The app checks GitHub when you first open Store compliance after starting the app, and again when you open it six hours later. It never checks in the background.

## Credits

The rules, the checklist and the guides are the work of the App Store Compliance Playbook's author, Mirza Iqbal (mjmirza), under the OpenRoots Agent License 2.3. The copy the app keeps on your computer always includes the playbook's NOTICE file, with its copyright line and its license.
