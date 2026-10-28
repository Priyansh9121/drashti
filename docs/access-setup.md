# Setting up Drashti's access list in your Google account

From version 1.0.0-alpha.13, Drashti opens only for a Gmail that is on its **access list**. The list is a Google Sheet in **your approver Gmail** (the account that approves requests), with a small program behind it (a Google Apps Script "web app") that answers each Drashti, sends the emails from that account, and takes the **Approve** and **Reject** links. Everything is free and stays in your account.

This guide is for you, the owner. It takes about 30 minutes, once. You do every step yourself: Claude never signs in to any Google account. Nothing here needs any programming; you copy and paste five files.

You need:

- a computer with a web browser (Chrome works best with Google's pages);
- the five files in Drashti's repository, in the folder `access-list`: `appsscript.json`, `Code.js`, `core.js`, `Setup.html` and `Link.html` (open each on GitHub and use the copy button, or open them in a text editor);
- your approver Gmail's password (and its phone, if it asks for 2-step verification).

**Your approver Gmail's address is never written in Drashti's repository** (the code is public). It goes in one place only: the script's settings in your account (step 6).

---

## 1. Sign in as your approver Gmail, and only that

Open the browser and sign in to your approver Gmail. Use a browser window where **no other Google account is signed in** (a new Chrome profile, or a private window): Google's script pages can mix up accounts when several are signed in at once.

## 2. Make the Sheet

1. Go to **sheets.google.com** and click **Blank spreadsheet** (the big +).
2. Click **Untitled spreadsheet** at the top left and name it `Drashti Access List`.

Leave it empty: Drashti fills it in step 8.

## 3. Open Apps Script

1. In the Sheet's menus, choose **Extensions › Apps Script**. A new browser tab opens with a project and one file, `Code.gs`.
2. Click **Untitled project** at the top left and name it `Drashti access list`.

## 4. Show the manifest file

1. On the left, click **Project Settings** (the gear).
2. Tick **Show "appsscript.json" manifest file in editor**.
3. On the left, click **Editor** (the `< >` symbol) to go back to the files.

## 5. Paste the five files

For each file, the text must be **exactly** the file's text: select everything that is there first (**Command-A** on a Mac, **Ctrl+A** on Windows), then paste.

1. **appsscript.json**: click it in the list of files on the left, select everything, paste the text of `access-list/appsscript.json`.
2. **Code.gs**: click it, select everything, paste the text of `access-list/Code.js`. (It keeps the name `Code.gs`; that is fine.)
3. **core**: next to **Files**, click **+**, choose **Script**, type `core` and press Enter (Apps Script adds `.gs`). Select everything in it and paste the text of `access-list/core.js`.
4. **Setup**: click **+**, choose **HTML**, type `Setup` (exactly, with a capital S) and press Enter. Select everything and paste `access-list/Setup.html`.
5. **Link**: click **+**, choose **HTML**, type `Link` (with a capital L) and press Enter. Select everything and paste `access-list/Link.html`.
6. Save: **Command-S** (Mac) or **Ctrl+S** (Windows), or the disk symbol above the text.

You should now have five files: `appsscript.json`, `Code.gs`, `core.gs`, `Setup.html` and `Link.html`.

## 6. Type your approver Gmail in the script's settings

This is where your approver's address lives, and the only place.

1. On the left, click **Project Settings** (the gear).
2. Scroll down to **Script Properties** and click **Add script property**.
3. **Property:** `APPROVER_EMAIL` (in capitals, with the underscore).
4. **Value:** your approver Gmail's address, the one you are signed in with.
5. Click **Save script properties**.

## 7. Deploy it as a web app (the one and only time you click New deployment)

1. At the top right, click **Deploy › New deployment**.
2. Next to **Select type**, click the gear and choose **Web app**.
3. **Description:** `Drashti access list`.
4. **Execute as:** **Me** (your approver Gmail).
5. **Who has access:** **Anyone**.
6. Click **Deploy**.
7. Google asks you to authorize the script. Click **Authorize access** and choose your approver Gmail. Google then says **Google hasn't verified this app**: this is your own script, and Google says it of every script it has not reviewed. Click **Advanced**, then **Go to Drashti access list (unsafe)**. Google lists what the script may do (see and edit this spreadsheet, send email as you, show its windows in the Sheet). Click **Allow**.
8. Google shows the **Web app URL**: it starts `https://script.google.com/macros/s/` and ends `/exec`. Click **Copy**, and keep it for the next step. Click **Done**.

> **From now on, never click Deploy › New deployment again.** A new deployment has a new address, and every Drashti knows only the first one: they would all stop. To put in a change later, see section 11.

## 8. Run Drashti › Set up… in the Sheet

1. Go back to the Sheet's browser tab and **reload** it (so the new menu appears). A menu **Drashti** appears after **Help** (it can take a few seconds).
2. Choose **Drashti › Set up…**. The first time, Google asks you to authorize again: the same steps as in step 7.7. If no window opens after you allow it, choose **Drashti › Set up…** again.
3. The window shows **your approver Gmail, from the script's settings**. If it is not right, close the window, correct it in step 6, and choose **Drashti › Set up…** again.
4. Paste the **Web app URL** from step 7.8 into **The web app's address**.
5. Click **Make the keys**. Your browser makes the list's keys; the window checks that Google signs as Drashti checks, then keeps them in the script's settings. This takes a few seconds.
6. The window says **Done** and shows **one line**. Click **Copy the line** (or select it and copy it), and paste it into the chat with Claude. It holds the web app's address and the public key: neither is a secret. The private key stays in the script's settings, in your account, and is never shown.

The Sheet now has two tabs: **Access List** (one row per Gmail) and **Computers** (one row per computer let in).

Claude puts that line into the release of Drashti. Until then, Drashti cannot use your list.

## 9. Let yourself in first, as the owner

1. In the Sheet, choose **Drashti › Let me in (the owner)…** and click **OK**.
2. A token arrives in your approver Gmail's inbox: an email **Your Drashti token** from your own address, with a token like `ABCD-EFGH-JKMN-PQRS-TVWX-YZ01-2345`.
3. When you have the Drashti with your list built in, open it. On its lock screen, choose **I Have a Token**, and type your approver Gmail and that token.
4. That computer is then the owner's: it has **View › Access List**, where you see and change everyone.

A token works once, for one computer, and runs out after **3 days**. If yours runs out, or for another computer of your own, choose **Let me in (the owner)…** again: you get a new token (a token not yet used stops working; computers already in stay in). Your own Gmail never uses **Request Access** on the lock screen: the list refuses it, and **Let me in** is its way in. **Never paste a token into the chat.**

---

## 10. Using the list

- **Someone asks for access** from their Drashti's lock screen: you get an email **Drashti: … asks for access**, with their Gmail, the name they typed, their computer and Drashti's version, and an **Approve** and a **Reject** link. Each link opens a page with **one button**: nothing happens until you press it. The links work once, and for **7 days**.
- **Approve:** the page asks **How long may they use Drashti?** (below), then they get an email from your approver Gmail with their one-time token (it works once, on one computer, for 3 days).
- **Reject:** they are told plainly, by email and on their lock screen, and nothing more happens.
- **In Drashti, View › Access List** (your computer only): add a Gmail, approve, reject, revoke, give access again (a new token), change how long access lasts, and a note.
- **How long access lasts** (from 28 Oct 2026). Approving (on the Approve page, or **Approve…** and **Add a Gmail…** in the Access List), **Give access again…** and **Change the length…** each ask how long: **Unlimited** (until you revoke it, chosen at first, so nobody is cut off by a slip), **1 day** (24 hours), **7, 30, 60, 90, 120, 180 or 365 days**, or **a number of days** you type (1 to 730, two years; for longer, choose Unlimited). A length counts from the moment you give it, by the list's clock (Google's), never by anyone's computer.
  - **When it ends** shows in the Sheet's **Access ends** column and in the Access List. From 7 days before (at once for 7 days or less), a bar in their Drashti says when it ends. When the time is up, their Drashti stops exactly as a revoke stops it, and its lock screen says their access has ended and how to come back.
  - **To give more time,** before or after the end: **Change the length…** (or **Give access again…**) in the Access List. A new length counts from that moment. Given before the end, nothing stops. After it, a Drashti showing its lock screen opens by itself within 15 seconds; one that stopped while open is quit and started again.
  - **Your own row is always Unlimited:** no length can be set on it, as it can never be revoked.
  - **Give each mandir computer's Gmail Unlimited**, so a date never cuts off a sabha. Lengths are for operators' own computers.
  - **Typed in the Sheet,** **Access ends** counts too: a date and time is the new end, and empty or `Unlimited` is no end. Anything else the list cannot read stops that Gmail's Drashtis until you put it right.
- **In the Sheet:** to stop someone at once, set their **Status** to **revoked** (it is a list to choose from). Their Drashti stops within about 30 seconds, and their computers stay out even if you set **approved** again later: to let them back in, use **Give access again** in Drashti's Access List. Setting **approved** in the Sheet sends no token: use the Approve link or the Access List.
- **Leave alone:** the **Computers** tab (Google warns you before a change), the hidden columns, and the column headers. Do not add a second row for a Gmail that has one. In **Script Properties**, the list keeps its own settings beside your `APPROVER_EMAIL` (`WEB_APP_URL`, the keys, and `REQUESTS_TODAY`, its count of the day's requests): leave them as they are, except as section 13 says.
- **Never share the Sheet or the script** with anyone: whoever can edit them can let people in.
- Times in the emails follow the Sheet's time zone (**File › Settings**).

## 11. Putting in a change later (always the same deployment)

When a new Drashti needs a change in the list, Claude names the files to paste again (only those):

1. In **Extensions › Apps Script**, open each file named, select all its text, and paste the new text over it, as in step 5. Save (the disk icon, or Cmd+S / Ctrl+S).
2. **Deploy › Manage deployments**. Click your deployment (`Drashti access list`), then the pencil (**Edit**).
3. **Version:** choose **New version**. Click **Deploy**.

The address and the key stay the same, so the line built into Drashti keeps working and every Drashti carries on.

- **Never use New deployment** (it makes a new address).
- **Never touch the keys** in **Project Settings › Script Properties**, and **never choose Drashti › Set up…** for a change.
- **Lengths of access (28 Oct 2026):** paste `core.js`, `Code.js` and `Link.html` again (`appsscript.json` and `Setup.html` are unchanged). Your Sheet needs nothing: the list adds its two new columns, **Access ends** (shown) and **Length** (hidden), by itself at its first call, with **Unlimited** for everyone approved before.

## 12. The limits of a free Google account

Google's own figures (its quota page, https://developers.google.com/apps-script/guides/services/quotas, read on 27 October 2026; Google may change them):

| Google's limit                        | Free account              | What it means for the list                                                                                                                                                                                                                |
| ------------------------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Email recipients a day (MailApp)      | **100**                   | Each request emails you once; each approval, rejection and Let me in emails one person. About **50 new people a day** (a request and an approval each).                                                                                   |
| Simultaneous executions (per account) | **30** at the same moment | The list runs as you, so every Drashti's check counts against your 30. A check takes well under a second (the list reads the Sheet at most every 10 seconds), so about **400 Drashtis open at the same time** can check every 15 seconds. |
| Script runtime                        | 6 minutes per call        | A call takes about a second.                                                                                                                                                                                                              |
| Script Properties reads and writes    | 50,000 a day              | The list reads its settings at most once every 10 minutes: never near it.                                                                                                                                                                 |

The list's own limits, so that requests never use up the emails tokens need: **50 requests a day in all**, **3 a day for one Gmail**, **10 a day from one computer**, and **10 tries of a token an hour** for one Gmail or one computer. Google's daily email count starts again **24 hours after the first email** of the day.

**If a limit is hit:**

- **The day's emails are used up:** a request is still kept (you see it in the Sheet and in the Access List), but no email comes; approving says **The access list has sent all the emails it may send today. Try again tomorrow.**, and nothing changes. Wait until the next day. When many people join at once, approve them over several days, about 50 a day.
- **Too many Drashtis checking at once:** some checks are answered late or not at all. Each Drashti waits up to **2 minutes** without an answer (with a countdown) before it stops, so a busy moment does no harm. If it happens often, tell Claude: the time between checks can be made longer in a new release.
- **Google says "Service invoked too many times":** the same; wait, and it clears.

## 13. If something goes wrong

- **No Drashti menu in the Sheet:** reload the Sheet's tab and wait a few seconds; check that all five files were saved (step 5).
- **Set up… asks for APPROVER_EMAIL:** do step 6, then choose **Drashti › Set up…** again.
- **The line was not copied, or the window was closed:** choose **Drashti › Set up…** again. It shows the same line (it never makes new keys once it has them).
- **The wrong web app address was pasted:** in **Project Settings › Script Properties**, click **Edit script properties**, put the right address (ending `/exec`) in `WEB_APP_URL`, and save. **Drashti › Set up…** then shows the corrected line: send it again.
- **"This window has run out":** close it and choose **Drashti › Set up…** again.
- **Set up… says Google's signature, HMAC or SHA-256 did not match:** nothing was kept. Send the message in the chat.
- **An Approve link's page says Not done:** press the button again; or answer in Drashti's Access List. If several Google accounts are signed in in that browser, open the link where only your approver Gmail is.
- **Starting over:** the keys are never replaced once a Drashti has your line, or every Drashti would stop. Only before the release with your line is out may you start again: in **Script Properties**, delete `SIGNING_KEY`, `PUBLIC_KEY`, `LINK_KEY` and `SECRET_KEY`, choose **Drashti › Set up…**, and send the new line.
