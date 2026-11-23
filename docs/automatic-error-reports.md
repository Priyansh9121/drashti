# Automatic error report setup

Automatic error reports came in alpha.21: each computer needs alpha.21 or later. This is a **new** Apps Script project, separate from the access list you already use. Keep the existing access-list project as it is.

1. In your own Google account, create a blank Sheet for automatic error reports and a private Drive folder for their log files. Keep both private. Copy their ids from their addresses for the next step.
2. Create a new Apps Script project. Paste `access-list/error-reports/core.js` into a script file called `core`, and `access-list/error-reports/Code.js` into `Code`. In Project Settings, show the manifest file, then paste `access-list/error-reports/appsscript.json` into `appsscript.json`.
3. In Project Settings › Script Properties, add `SHEET_ID` and `FOLDER_ID` with the ids you just copied. For each computer, generate a random 32-character lowercase hexadecimal install id and a separate random 64-character lowercase hexadecimal secret (no spaces or hyphens). Use a password manager or another trusted random generator on your own computer. Never type a secret into a chat or put one in the repository.
4. Add a Script Property named `INSTALL_` followed by that computer’s install id. Its value is that computer’s secret. Use one property per computer; do not put all computers into one large property. Delete this property to revoke that computer’s ability to post.
5. Choose Deploy › New deployment › Web app. Run it as **you**, with access for **Anyone**. Google asks you to allow this new project to write your Sheet and Drive folder. Copy the web app address ending in `/exec`. No email permission is used.
6. On each computer, make a private JSON setup file with exactly these three fields. Replace every placeholder yourself. Each computer gets only its own id and secret:

   ```json
   {
     "endpoint": "YOUR_NEW_WEB_APP_ADDRESS",
     "installId": "THIS_COMPUTERS_RANDOM_INSTALL_ID",
     "secret": "THIS_COMPUTERS_RANDOM_SECRET"
   }
   ```

7. With that computer let in as the access-list owner, choose Help › Automatic Error Reports… › Set Up… and open its file. Reporting stays off. Open the control again, read what goes, and choose **Turn On**. Keep the setup file private and delete the working copy once you have stored its details safely.
8. The next real error report creates the **Automatic errors** tab and a JSON log file in your chosen folder. No test or CI run sends anything to Google. Do not cause a crash or stream failure during a sabha to test this. A developer can verify the complete receiving path locally with fake services.

The Sheet holds receipt and incident times, receiver install/report/computer/access-entry ids, the existing diagnostics install id, version, system and OS release, role, current mode, error code, activity counts, dropped count and the Drive file id. Find the computer in the access list’s **Computers** tab by its computer or grant id (the access entry id); these are hidden columns there. A computer’s host name or Gmail is never sent in an automatic report. The Drive file holds the same safe fields and up to 30 coded log events, not the raw local log.

Reports are capped at 10 per computer per UTC day. Twenty can wait locally for up to 7 days; further reports are counted as dropped. Streaming and recording pause uploads. Internet or receiver failures leave the same report queued; the receiver recognises a repeated id and does not make another row. Turning off clears the queue on that computer, but cannot retract a report already received.

Keep the Sheet and folder private, review their storage regularly and remove reports you no longer need. To rotate a secret, replace its Script Property, import the matching new setup file on that computer and turn reports on again. To update the receiver later, paste both files and deploy a **new version** of this deployment so its address stays the same.

If setup cannot be read or saved, reporting stays off. Check the data folder’s space and permissions, and ask the developer to inspect `automatic-error-reports/state.json` without copying its secret into a report or chat. The full local log and Help › Report a Problem… remain available.
