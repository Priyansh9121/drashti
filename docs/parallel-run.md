# Running Drashti alongside ProPresenter

This guide is for the volunteers who try Drashti on the mandir's two computers, the ProPresenter 6 Mac and the ProPresenter 7 Windows PC, before it is used for a real sabha. It follows the plan's "parallel run" (PLAN.md, section 5.1): Drashti runs on the real computers and screens on evenings **without** a sabha, and ProPresenter stays installed, untouched, the whole time.

You never need to change anything in ProPresenter. Drashti only reads its files.

Keep a notebook (or a shared document) open. For every evening, write down the date, which computer, who was there, and anything that looked different from ProPresenter or went wrong, with the time it happened.

---

## 1. First: check the Mac's macOS version

Drashti is built on Electron 44, which needs **macOS 13 (Ventura) or later**.

1. On the Mac, click the Apple menu in the top-left corner and choose **About This Mac**.
2. Read the version under the name, for example "macOS Sonoma 14.6".
3. If it says macOS 13, 14, 15 or later, carry on.
4. **If it says macOS 12 (Monterey) or anything older, stop here and tell us.** Do not try to update macOS yourself on the show computer. Drashti cannot run on it yet, and we will decide together what to do.

On the Windows PC, Drashti needs 64-bit Windows 10 or Windows 11. Press the Windows key, type `winver`, press Enter, and write down the version and build number.

---

## 2. Get Drashti and install it

Drashti's installers are made automatically each time a new version is ready, on GitHub. Whoever looks after Drashti will send you a link, or you can fetch them yourself if you have access:

1. Open the Drashti repository on GitHub, then **Actions**, then **CI**.
2. Open the newest run with a green tick for the `main` branch.
3. At the bottom, under **Artifacts**, download **drashti-macOS** (for the Mac) or **drashti-Windows** (for the PC). They are zip files. They are kept for 7 days only, so ask for a new run if they have gone.
4. Unzip the download.

**On the Mac:**

1. Open the `.dmg` file and drag **Drashti** into **Applications**.
2. Open Drashti from Applications. The first time, macOS says it cannot check the app, because it is not signed yet. Click **Done** (or **Cancel**), then open **System Settings**, then **Privacy & Security**, scroll down, and click **Open Anyway** next to the message about Drashti. Confirm with your password if asked. (On older macOS versions you can instead right-click Drashti in Applications and choose **Open**.)
3. This is only needed once.

**On the Windows PC:**

1. Run the `.exe` installer. Windows says "Windows protected your PC", because the build is not signed yet. Click **More info**, then **Run anyway**.
2. It installs for the current user, with no administrator password, and Drashti appears in the Start menu.
3. Section 6 of `docs/windows-checks.md` has checks for this install; do them now and write down what you see (the rest of that file comes in section 10 of this guide).

When Drashti starts the first time, its library holds two sample presentations. Your own library comes in the next step.

---

## 3. Bring in the ProPresenter library

Drashti copies presentations, playlists, props and media from ProPresenter's folders. It never changes or moves anything in them.

**On the Mac (ProPresenter 6):**

1. In Finder, open your home folder, then **Documents**. Drag the **ProPresenter6** folder onto Drashti's presentation list (the left-hand column, under Presentations). A dashed box says "Drop lyrics, presentations or media to import them".
2. Then the settings folder, which holds the playlists and props: in Finder, choose **Go**, then **Go to Folder…**, type `~/Library/Application Support/RenewedVision/ProPresenter6`, press Enter, and drag the **ProPresenter6** folder you see onto the presentation list too.
3. If the audit report named other folders with presentations or media (a second drive, a Media folder somewhere else), drag those in as well.

**On the Windows PC (ProPresenter 7):**

1. Open File Explorer, then **Documents**. Drag the **ProPresenter** folder onto Drashti's presentation list.
2. If the audit report named other folders (media on another drive, for example), drag those in as well.

You can also use **Import…**, above the list, then **A folder…**.

While it imports, a progress bar shows in the status bar along the bottom, and you can keep using Drashti. When it finishes, the **report** opens. Read it:

- It says what came across (presentations, slides, playlists, media).
- **Missing media**: files ProPresenter pointed at that were not found. Press **Find…** and choose the folder where those files are, and Drashti finds them by name.
- **Can't play**: some video, picture and sound formats (ProRes, AVI, HEIC, AIFF and a few others) cannot play in Drashti as they are. Press **Convert all** (or **Convert** beside one file) and Drashti makes a copy of each that plays, one at a time in the background, and uses the copy everywhere the original was used. ProPresenter's files are never changed. It waits while the stream is on air or recording, and stops if the disk gets under 2 GB free. The **Media** tab beside Presentations shows the same, with progress and **Cancel**. If something looks wrong afterwards, **Undo** at the bottom of the left-hand column puts the original back.
- **Legacy fonts**: older Gujarati and Hindi text is sometimes typed in fonts such as Gopika, Terafont or Kruti Dev. Those slides still show in that font when it is installed, but search cannot read them yet and their words cannot be edited as plain text. The report names the fonts.

Importing a folder again later skips what did not change. For a presentation that changed in ProPresenter since, the report asks whether to **Replace** Drashti's copy or **Keep both**.

Write down the numbers the report shows (presentations, playlists, media, problems) in your notes.

Once the import is done, **back up the library** to a USB drive: choose **File**, then **Back Up Library…** (on Windows, press **Alt** first to show the menu bar), pick the drive, and keep **Include the media** ticked. Drashti says where the backup went. Do it again after any evening you change the library. If the library ever needs to go back to a backup, **File**, then **Restore Library…** asks first, keeps the current library as well, and restarts Drashti (the screens go black for a moment), so never do it during a sabha. If the backup turns out to be damaged, Drashti says so after the restart and keeps the library you had.

---

## 4. Set up the screens and the sound

The first time Drashti starts, the **setup wizard** opens by itself (later, it is in **View > Set Up Screens…**; on Windows press Alt for the menu bar, or use **Setup wizard** in Screens). It takes a minute and changes nothing until **Finish**:

- **Screens**: **Show each display's number on it** puts a big number on every display for a few seconds (not on the one the controls are on), so you can see which output feeds which screens. For each display choose **The audience picture**, **The stage view (performers)** or **Not used**, and the languages a kirtan shows on it (for example Gujarati then transliteration in the hall, Gujarati only on the stage).
- **Sound**: choose the output that goes to the mixer, and **Play a test tone** to hear it.
- **Theme**: the look new presentations start with.
- **Finish**: everything is set at once, and every screen shows a test slide for a few seconds, in its own languages. If an output would cover the controls, Drashti asks first.

Each step has **Skip this step**, which keeps things as they are. To set up by hand instead, or to change a screen's size later:

1. Click **Screens** (top right).
2. Under **Screen groups**, type a name such as "Main Hall" and click **Add group**.
3. Under **Connected displays**, find each display that feeds the hall's screens and click **Use this display** next to it. If one of them is the display the Drashti controls are on, Drashti asks first, because the output would cover the controls.
4. Click **Identify screens**: each screen shows its name for a few seconds, so you can check they are the right ones.
5. If a screen needs a different size or shape (an LED wall, for example), set its canvas size and scaling there.
6. If there is a stage display for the performers, make a second group, for example "Stage", set it to show **The stage view (performers)**, and use its display.
7. **Sound**: in the same panel, under **Sound output**, choose the output that goes to the mixer (the one ProPresenter uses). Drashti remembers it.
8. Close the panel. The setup is kept for next time.

If an output ever covers the controls by mistake, press **Cmd+Shift+U** (Mac) or **Ctrl+Shift+U** (Windows) to uncover them. It works even when Drashti is not the active app.

**Looks.** A Look says what each screen group shows: which layers (the background, slides, props, messages, the ticker, the Masks layer), a kirtan's languages, and whether slides are drawn as designed or only their words, as a lower third. Drashti starts with one Look, **Standard**, which shows exactly what the screens showed before. In Screens, under **Looks**, **New Look** or **Duplicate** makes another, for example "Gujarati only" or "Lower thirds"; choose a Look there to see and change each group's settings in it. To switch the live Look in a sabha, use **Looks** under the live picture: every screen changes at once. The first Look in the list is the one Drashti starts with (**Earlier** and **Later** move a Look), and after an unexpected stop the Look that was live comes back. Simple Mode keeps whichever Look is live and cannot switch it.

**Stage layouts.** A stage screen shows the **Standard** stage view unless its group's Look gives it a layout of its own. In Screens, under a stage group, **Edit stage layouts…** opens the editor: **Duplicate** Standard, then drag the boxes where the performers want them (current and next slide, notes, clock, timers, the stage message, what's coming up in the playlist, the time left on a video or song, whether the hall is blacked out, or some fixed words), set each one's size and colour, and **Save**. Then choose it under **Stage layout** for the stage group. Ask the performers what they need to see.

**Macros.** A macro does several things at one press: for example "Arti": Clear all, the Arti prop, the arti sound, and the stage message "Arti now". Make one with **Edit** in the **Macros** panel (right column), then press its button, or make a slide run it when it goes up (**Edit slides**, the slide, **When it goes up, run**). A macro can't touch the stream, the library or any settings. Simple Mode doesn't run macros.

**A MIDI controller.** If the operators like pads or a foot switch, plug it in, press **MIDI** in the Macros panel, choose the device, then for each action press **Learn** and the pad. Next, Back, Clear all, Black-out and Logo work in Simple Mode too.

**Key and fill.** If the mandir's video switcher (an ATEM, for example) lays words over the camera, it needs two feeds from the computer: in Screens, make a group, set it to **Key and fill (for a video switcher)**, and use two displays: the first is the **fill**, the second the **key** (swap them with **Sends** if they're the wrong way round). On the switcher, set the downstream key's source to those two inputs and turn on **Pre Multiplied Key**. The words show as a lower third; black-out and the logo don't affect them.

**Masks.** If a screen's picture spills somewhere it shouldn't (an LED wall that isn't a rectangle, a projector hitting a pillar), make a mask in Screens (**Edit masks…** under that group): add rectangles, rounded rectangles or ellipses over the parts to hide (or choose **Show only what is inside them**), **Save**, then choose it under **Mask** for that group. It stays on in that Look; Clear all and F7 never take it away. The **Masks** panel under the live picture is different: it puts a mask up on the audience screens for a moment, and F7 takes it down.

---

## 5. Run a sabha from a playlist

Replay last week's sabha from its imported playlist, from start to end, as the operator would.

1. At the top of the left column, under **Playlists**, click the playlist (inside its folder).
2. Click the first item. Its slides appear in the middle.
3. Press **Space** (or the right arrow) to put the first slide on the screens. Keep pressing it to go through the sabha. At the end of one item, it carries on into the next, stepping over headers.
4. **Shift+→** jumps to the start of the next item; **Shift+←** goes back to the start of the previous one.
5. Pictures and videos in the playlist go up as the background; songs and sounds play through the mixer.
6. Under the live picture, **Next** shows what comes next.
7. Try the other controls a sabha uses: **Black-out** (B), the clear buttons along the bottom (F1 to F8; each is lit while its layer is on the screens), a **timer** ("Sabha starts in 5:00"), a **message** (for example "Car {plate} please move"), a **prop** (the mandir's logo), a **stage message** if there is a stage display, and another **Look** if the mandir uses more than one.
8. Compare with ProPresenter as you go. Things to look at:
   - Do the words look the same: size, font, line breaks, Gujarati and Hindi letters?
   - Are the backgrounds and videos the same, and do they start and loop the same way?
   - Is the sound right, and in step with the picture?
   - Does anything appear late, flicker, or go black when it shouldn't?

Write down anything different, with the time.

**Making next week's playlist from a template.** At the top of the left column, **Templates** lists running orders to make playlists from: two examples come with Drashti (**Example: Ravi Sabha** and **Example: Bal/Kishore Sabha**), to change into the mandir's own. **Use** beside one makes a new playlist from it; type its name and press Enter. Its slots (dashed rows, such as "Kirtan" or "Pravachan title") are places to fill: click one, and pick what goes there (the list starts with the slot's category, and typing searches titles, words, kavi and raag). To keep a playlist's running order as a template, open the playlist and choose **Save as template…** in its menu (**⋯**): each kirtan can stay the same every week or become a slot. A template never goes on the screens itself.

To fix words on a slide, use **Edit words** above the slides. To change how a slide looks (move or resize its words, give a word its own font or size, add a shadow or an outline, a shape, a picture or a video), use **Edit slides** beside it, or double-click a slide. In the slide editor, click something to select it and drag it to move it (it snaps to the middle and edges; hold Alt to place it freely); double-click words to type in them. **Save** puts the change on the screens if the slide is live; **Cancel** keeps nothing. Either save can be undone with **Undo** (Cmd+Z or Ctrl+Z).

### Simple Mode, for a volunteer

Simple Mode is one screen with big buttons, for running a sabha from its playlist without being able to change anything by mistake. Try it on one of these evenings, ideally with a volunteer who has not used Drashti before.

1. In Pro Mode, mark the mandir's logo once: under the live picture, in **Props**, press the stamp button beside the logo's prop (**Use … as the logo**). The **Logo** button shows that prop instead of the picture.
2. Press **Simple Mode** in the header (or **View**, then **Switch to Simple Mode**; on Windows press **Alt** first).
3. Pick the playlist at the top left if it is not already open. Its items are listed below, with headers.
4. **Next** (or →, Space, Page Down, or a presentation clicker) starts the playlist and goes through it. **Back** (←, Page Up) undoes the last Next exactly: after one Next too many, the screens are as they were.
5. **Black out** (B or .) and **Logo** (L) cover the picture, and pressing them again brings back exactly what was there. The stage screens keep showing the words.
6. **Clear all** (F1) takes everything down; straight after it, **Put it back** (or Cmd+Z, Ctrl+Z on Windows) brings it all back.
7. Nothing in Simple Mode can import, edit, remove, or change themes, screens, the sound, or backups, or switch the Look. Drashti remembers Simple Mode, and comes back in it after a restart.
8. To leave it: **View**, then **Switch to Pro Mode…**, type **pro**, and press **Switch to Pro Mode**. Volunteers should not need to.

Write down anything the volunteer found hard, with what they were trying to do.

---

## 6. Going live on YouTube, and recording

Only on the computer that streams, and only once the screens and sound work. **Try it first on a private or unlisted YouTube stream**, never the mandir's public one, until it has worked twice.

**Once, to set it up:**

1. Plug in the camera (or the capture card) and the cable from the mixer's line out into the computer.
2. In Drashti press **Stream** (top right), then **Stream settings**.
3. In **YouTube Studio** choose **Go live**, then **Stream**. Copy the **Stream key** and paste it in Drashti's **Stream key** box, then **Save key**. Drashti keeps it locked away and never shows it again ("A key is saved"). Check the **Address** says `rtmps://a.rtmps.youtube.com/live2`.
4. Choose the **Camera** and the **Sound input** (the mixer's line in). On a Mac, the first time, macOS asks whether Drashti may use the camera and the microphone: press **Allow**. If Drashti says Windows or macOS is blocking them, follow what it says, then open the Stream panel again.
5. **Internet**: **Good internet** (1080p) needs an upload of 8 Mbps or more; otherwise choose **Weak internet** (720p). Ask whoever looks after the mandir's internet, or run a speed test on this computer.
6. **Save profile**. Back in the Stream panel, the preview shows what the stream will look like, and the bar under it moves with the sound. Talk into a microphone on the mixer: if the lips move after the words are heard, raise **Sound delay** in Stream settings a little at a time.
7. **Recording**: press **Choose a folder…** and pick a folder on a disk with plenty of space (an hour at Good internet is about 3 GB).

**Each time:**

1. Open the **Stream** panel. Choose **Camera and words** (the camera, with the kirtan's words along the bottom) or **Slides** (what the hall sees). You can switch at any time, even on air.
2. Press **Record** if the sabha should be recorded too.
3. Press **Go live…**, read what it says, then **Go live**. The top of the window says **ON AIR**. In YouTube Studio the stream appears after a few seconds.
4. Run the sabha as usual. On the hall's screens, black-out and the logo do not black out the stream in **Camera and words**: the camera carries on and the words go.
5. At the end, press **End the stream…**, then **End the stream**, and **Stop recording**. End the broadcast in YouTube Studio too.
6. The recording is in the folder you chose, named `Drashti <date> <time>.mkv`. It opens in **VLC** (free, for Mac and Windows) or IINA on a Mac; QuickTime Player does not open this kind of file. If Drashti stopped in the middle, the file still plays up to that moment.

There is no key for going live or ending: always the buttons, and always a question first.

**When the internet drops:** do nothing at first. Drashti says **Reconnecting** and tries again by itself (after 1, 2, 4, 8, 15 and then every 30 seconds), and the recording carries on all the while. The hall's screens are not affected. If it has not come back within a few minutes, check the internet (a browser on this computer), and if the connection is slow all evening, end the stream, choose **Weak internet** in Stream settings and go live again. If YouTube's broadcast has ended by then, start a new one in YouTube Studio.

**If Drashti closes by itself while on air**, start it again: within 5 minutes it goes live again by itself (and records into a new file; the first one still plays) and says so. After 5 minutes it asks first, in the Stream panel.

**If the disk fills up**, Drashti stops recording before less than 2 GB is free and says so; the stream goes on. The Stream panel always shows the free space and about how long the recording can go on.

---

## 7. Phones and tablets on the Wi-Fi

Drashti can take a phone as a remote, a tablet as a stage screen, and announcements sent from phones. It is off until you turn it on, and only phones you pair (or the printed poster's link) get in. Try it on one of these evenings with two or three phones.

**Turning it on (once on each computer):**

1. Press **Phones** in the header, then turn on **Let paired phones and tablets connect**.
2. The first time, the computer asks about the network:
   - **Mac:** "Do you want the application Drashti to accept incoming network connections?" Press **Allow**.
   - **Windows:** Windows Security asks about Drashti. Tick **Private networks** only, then **Allow**. Check that Windows treats the mandir's Wi-Fi as private: Settings, **Network & internet**, the Wi-Fi's properties, **Private network**.
3. The panel shows the address phones open, such as `http://192.168.1.20:8740`. While the network is on, the top of the window always says **Network on**, with how many devices are connected.

**A phone as a remote:**

1. The phone joins the **same Wi-Fi** as this computer.
2. In **Phones**, type a name (for example "Remote: Priyansh's phone") and press **Pair a Remote device**. A QR code and a six-digit code appear for two minutes.
3. On the phone, scan the QR code with the camera and open the link, or open the address in the browser and type the code.
4. The remote opens: **Next** and **Back** at the bottom, the slides to tap, Clear, Black-out, Logo, timers and messages. The top says **Connected**. A tap does what the same button does in Drashti, and Simple Mode's limits apply to it too.

**A tablet as a stage screen:** the same, with **Pair a Stage device**. The tablet shows what the stage screens show. Press **Full screen** on it, and set the tablet never to lock while it is on the stage.

**The announcements poster:**

1. In **Phones**, press **Make a poster link**, then **Print the poster**, and put it up where people can see it. The link is shown only then, so print it before closing Drashti.
2. Anyone on the Wi-Fi can scan it and send an announcement: the words, who it is from, and how long to show it.
3. **Announcements** at the top of Drashti says how many are waiting. Open it, and for each one:
   - **Approve** puts it **In the ticker**, scrolling along the bottom of the hall's screens (not on the stream), or **As a message**. It comes off by itself when its time is up, or press **Take off**.
   - **Edit** fixes a typo first.
   - **Reject** keeps it off the screens.
4. Only Pro Mode approves announcements. In Simple Mode the top says how many are waiting: ask the coordinator.
5. **Make a new one** stops the old poster's link, for example if a photo of the poster was shared somewhere it should not be.

**When a phone cannot connect:**

- Is the phone on the **same Wi-Fi** as this computer, not a guest network? Turn its mobile data off and try again.
- Does the top of Drashti say **Network on**? If the Phones panel says the port is in use by another program, quit that program, or choose another port (every phone then needs the new address).
- **Windows:** if Private networks was not ticked, open Windows Security, **Firewall & network protection**, **Allow an app through firewall**, find Drashti and tick **Private**.
- **Mac:** if Allow was not pressed, open System Settings, **Network**, **Firewall**, **Options**, and set Drashti to allow incoming connections.
- Try the number address instead of the name ending `.local`, or the other way round.
- If the Wi-Fi drops for a moment, do nothing: the remote says **Connecting…** and comes back by itself.

**When a phone is lost** (or someone leaves the seva): in **Phones**, press **Remove** beside it. It is cut off at once, even in the middle of a sabha. To use it again, pair it with a new code.

---

## 8. Falling back to ProPresenter

A real sabha always has a named fallback operator who knows how to switch back. Practise it on these evenings until it takes **under a minute**:

1. Quit Drashti: **Cmd+Q** on the Mac; on Windows, close the Drashti window. If screens are showing, Drashti asks first, because they will go black. Confirm.
2. Open ProPresenter. Its screens come back as before.
3. Time it and write the time down.

The plan's order for real use (PLAN.md, section 5.1) is: a smaller weekday or Bal/Kishore sabha first, then Ravi Sabha, then a festival, one computer at a time. ProPresenter is only retired on a computer after four weeks of sabhas without falling back.

---

## 9. After a problem: save diagnostics

If anything goes wrong (a screen went black, something froze, Drashti closed by itself), as soon as you can:

1. In Drashti, choose **Help**, then **Save Diagnostics…** (on Windows, press **Alt** first to show the menu bar).
2. A file called "Drashti diagnostics" with the date and time appears on the **Desktop**. The live controls say where it went.
3. Send that file to whoever looks after Drashti, with the time it happened and what you saw.

The file holds the versions, the screen and sound setup, and Drashti's log. It never holds kirtan words, presentation names or where your files are.

If Drashti closed by itself, start it again: it puts back what was on the screens (the slide, background, sound, timers, messages and props) and says so at the top. Save diagnostics after that.

---

## 10. The checks to run on each computer

Once per computer, during these evenings:

1. **The performance check.** Close Drashti first. It covers the first display for about half a minute, imports a few hundred sample files into a throwaway library (never the real one) while changing slides quickly, and prints one line.
   - Mac, in Terminal:

     ```bash
     DRASHTI_SELFTEST=performance /Applications/Drashti.app/Contents/MacOS/Drashti | grep DRASHTI_PERFTEST_RESULT
     ```

   - Windows, in PowerShell:

     ```powershell
     $env:DRASHTI_SELFTEST = 'performance'
     Start-Process -Wait -NoNewWindow "$env:LOCALAPPDATA\Programs\drashti\Drashti.exe" -RedirectStandardOutput "$env:TEMP\drashti-perf.txt"
     Select-String DRASHTI_PERFTEST_RESULT "$env:TEMP\drashti-perf.txt"
     ```

   Run it twice and copy the **second** line into your notes (the first run after installing can be slow while the computer checks the new app). It should say `"passed":true`.

2. **On the Windows PC**, go through `docs/windows-checks.md`: the taskbar, focus, scaling, sleep, notifications, installing, performance and the fallback drill. Write down Pass, Fail (with what you saw) or N/A for each.

---

## Keys at a glance

On the Mac, **Cmd** is the ⌘ key; on Windows, use **Ctrl** instead. These keys are provisional: they will be changed to the ones the operators use in ProPresenter once the setup checklist comes back.

| Key                                            | What it does                                                                                     |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| **Space**, **→**, **↓** or **Page Down**       | Next slide (on into the next playlist item at the end)                                           |
| **←**, **↑** or **Page Up**                    | Previous slide (in Simple Mode, Back: undoes the last Next exactly)                              |
| **Shift+→** or **Shift+↓**                     | Next playlist item                                                                               |
| **Shift+←** or **Shift+↑**                     | Previous playlist item                                                                           |
| **B** or **.**                                 | Black-out on or off                                                                              |
| **L**                                          | The logo instead of the picture, and back                                                        |
| **F1**                                         | Clear all                                                                                        |
| **F2**                                         | Clear the slide (the background stays)                                                           |
| **F3**                                         | Clear the background                                                                             |
| **F4**                                         | Clear props                                                                                      |
| **F5**                                         | Clear messages                                                                                   |
| **F6**                                         | Clear the sound                                                                                  |
| **F7**                                         | Clear masks                                                                                      |
| **F8**                                         | Clear the ticker (announcements scrolling along the bottom)                                      |
| **Cmd+F** / **Ctrl+F**                         | Search the library                                                                               |
| **Delete** or **Backspace** (in a list)        | Remove the marked presentations, playlists or items (asks first for presentations and playlists) |
| **Cmd+Z** / **Ctrl+Z**                         | Undo the last removal, words edit or theme (in Simple Mode: put back what Clear all took down)   |
| **Cmd+Enter** / **Ctrl+Enter** (editing words) | Save the words                                                                                   |
| **Cmd+Shift+S** / **Ctrl+Shift+S**             | Open Screens                                                                                     |
| **Cmd+Shift+U** / **Ctrl+Shift+U**             | Uncover the controls (works from anywhere)                                                       |
| **Esc**                                        | Cancel editing words or a question, or empty the search box                                      |

Going live, ending the stream and recording have no keys: use the buttons in the **Stream** panel (each going live or ending asks first).

In the slide editor:

| Key                                                    | What it does                                                                                                 |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| **Tab** / **Shift+Tab**                                | Select the next (or previous) thing on the slide                                                             |
| **← → ↑ ↓**                                            | Move what is selected one pixel (with **Shift**, ten)                                                        |
| **Enter**                                              | Type in the selected words (double-click them, too)                                                          |
| **Esc**                                                | Stop typing; then let go of the selection; then close (asking first if changed)                              |
| **Delete** or **Backspace**                            | Delete what is selected                                                                                      |
| **Cmd+D** / **Ctrl+D**                                 | Duplicate what is selected                                                                                   |
| **Cmd+Z** / **Ctrl+Z**, **Cmd+Shift+Z** / **Ctrl+Y**   | Undo and redo in the editor (while typing: the typing)                                                       |
| **Cmd+S** / **Ctrl+S**                                 | Save the slides                                                                                              |
| **Alt** (while dragging)                               | Place freely, without snapping                                                                               |
| **Shift** (while dragging a corner or the turn handle) | Keep the proportions (a picture or video keeps them anyway: Shift lets them go); turn in steps of 15 degrees |
