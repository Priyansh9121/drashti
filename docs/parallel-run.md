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

Drashti is free, from one link for each computer. Each link always gives the newest version:

- **A Mac with Apple silicon:** https://github.com/Priyansh9121/drashti/releases/latest/download/Drashti-mac-apple-silicon.dmg
- **A Mac with an Intel processor:** https://github.com/Priyansh9121/drashti/releases/latest/download/Drashti-mac-intel.dmg
- **The Windows PC:** https://github.com/Priyansh9121/drashti/releases/latest/download/Drashti-windows-setup.exe

**Which Mac is it?** Apple menu, **About This Mac** (as in section 1). A line **Chip** that says Apple M1, M2, M3 or later means Apple silicon. A line **Processor** that mentions Intel means an Intel Mac. Take the right one: the Apple-silicon file does not open on an Intel Mac, and the Intel one runs more slowly on Apple silicon.

If a link says **Not Found**, no version has been published yet. Whoever looks after Drashti can then give you the installers from the newest CI run (**Actions**, **CI**, the newest green run for `main`, under **Artifacts**: **drashti-macOS** or **drashti-Windows**, zip files kept for 7 days; unzip the download).

**On the Mac:**

1. Open the downloaded `.dmg` (in **Downloads**) and drag **Drashti** into **Applications**.
2. Open Drashti from Applications. The first time, macOS says it could not verify Drashti, because it is not signed yet. Click **Done**, then open **System Settings**, then **Privacy & Security**, scroll down to **Security**, and click **Open Anyway** next to the message about Drashti. Confirm with your password (or Touch ID), and click **Open Anyway** once more. (On macOS 13 or 14 you can instead right-click Drashti in Applications and choose **Open**.) The disk image's window shows these two steps as a picture. **Open Anyway** appears in Privacy & Security only after a first try to open Drashti. Whoever looks after Drashti can instead type one line in Terminal: `xattr -dr com.apple.quarantine /Applications/Drashti.app`.
3. This is only needed once. Eject the Drashti disk in Finder's sidebar; the `.dmg` can go in the Bin.
4. Drashti has its own logo: you see it in Applications, in the Dock while Drashti is open, and when you switch apps with Cmd+Tab. If the Dock or Finder still shows a different picture, restart the Mac.

**On the Windows PC:**

1. Open the downloaded `Drashti-windows-setup.exe`. If the browser says it is not commonly downloaded, keep it (in Edge: **…**, **Keep**, then **Show more**, **Keep anyway**).
2. Windows says "Windows protected your PC", because the build is not signed yet. Click **More info**, then **Run anyway**.
3. It installs for the current user, with no administrator password, and Drashti appears in the Start menu with its own logo, which the taskbar shows too while Drashti is open.
4. Section 6 of `docs/windows-checks.md` has checks for this install; do them now and write down what you see (the rest of that file comes in section 11 of this guide).

**Let each computer in, before the first evening.** From version 1.0.0-alpha.13, Drashti opens only on a computer let in with a Gmail that the person who approves access has approved, and it needs the internet to check: as it opens, and every 15 seconds while it runs. Do this on each computer before the first evening, as the approval can take a while:

1. Give the computer the surest connection there is: a network cable to the mandir's internet if you can, with a phone's hotspot ready as a spare.
2. Start Drashti. On its very first start it asks how the computer will be used: choose **Main: run the show here** (for a node, see section 8: a node needs no Gmail of its own).
3. Drashti opens on its lock screen, **Let this computer in**. Under **Request Access**, type your Gmail (and your name), then press **Request Access**. It says the person who approves access has been emailed.
4. When they approve, the screen says **Approved** (it asks every 30 seconds, or press **Check Again**), and an email, "Your Drashti token", comes to your Gmail with a token in groups of four letters and figures.
5. Under **I Have a Token**, type the same Gmail and the token, then press **Let This Computer In**. Drashti opens, and from then on opens on this computer until its access is taken away.

A token works once, on one computer, and runs out after 3 days unused; keep it as private as a password. For a second computer with the same Gmail, **Request Access** there says the Gmail is already approved: ask the person who approves access to give access again, and a new token comes by email. What happens without the internet, or when access is taken away, is in section 5 (**Access by Gmail**).

Once Drashti opens the first time, its library holds no presentations, not even test slides. Your own library comes in the next step.

---

## 3. Bring in the ProPresenter library

Drashti copies presentations, playlists, props and media from ProPresenter's folders. It never changes or moves anything in them.

**On the Mac (ProPresenter 6):**

1. In Finder, open your home folder, then **Documents**. Press **Library** (at the top of Drashti's left-hand column) and drag the **ProPresenter6** folder onto its list of presentations. A dashed box says "Drop lyrics, presentations or media to import them".
2. Then the settings folder, which holds the playlists and props: in Finder, choose **Go**, then **Go to Folder…**, type `~/Library/Application Support/RenewedVision/ProPresenter6`, press Enter, and drag the **ProPresenter6** folder you see onto the library's list too.
3. If the audit report named other folders with presentations or media (a second drive, a Media folder somewhere else), drag those in as well.

**On the Windows PC (ProPresenter 7):**

1. Open File Explorer, then **Documents**. Press **Library** (at the top of Drashti's left-hand column) and drag the **ProPresenter** folder onto its list of presentations.
2. If the audit report named other folders (media on another drive, for example), drag those in as well.

You can also use **Import…**, in the library above its list, then **A folder…**.

While it imports, a progress bar shows in the status bar along the bottom, and you can keep using Drashti. When it finishes, the **report** opens. Read it:

- It says what came across (presentations, slides, playlists, media).
- **Media that could not be found** (a notice at the top of the report): files ProPresenter pointed at that were not found. Press **Find missing media…** (or **Find…** beside one file) and choose the folder where those files are, and Drashti finds them by name.
- **Media Drashti cannot play as it is**: Drashti takes nearly any video or sound file, and one it cannot play as it is (an AVI, a WMA, an AIFF, or an MKV with AC-3 or DTS sound, say) is converted by itself a moment after the import. Drashti makes a copy of each that plays, one at a time in the background, and uses the copy everywhere the original was used, and wherever the original is added again later (a playlist, a slide, the music, or the same file imported again); until then the file says **Converting…** and cannot go live. An HEVC video is converted the same way on a computer that cannot play HEVC (as many Windows PCs cannot), and plays as it is where it can. The report says what Drashti is converting, and then what it converted. A file that plays as it is is never converted. A picture it cannot play (HEIC or TIFF, say) is left as it is: its row in the media list says it can't play as it is, and **Convert all** (in the report, or above the media list) or **Convert** beside one file makes the copy. ProPresenter's files are never changed. Converting waits while the stream is on air or recording, and stops if the disk gets under 2 GB free. A conversion waiting or under way when Drashti quits starts again by itself at the next start, about 10 seconds after the window opens; one cancelled or failed does not. The **Media** tab beside Presentations shows the same, with progress and **Cancel**. If something looks wrong after **Convert**, **Undo** at the bottom of the left-hand column puts the original back.
- **Legacy fonts** (in the notes of the files that use them): older Gujarati and Hindi text is sometimes typed in fonts such as Gopika, Terafont or Kruti Dev. Those slides still show in that font when it is installed, but search cannot read them yet and their words cannot be edited as plain text. The report names the fonts.

**PowerPoint, Keynote and PDF.** A slide deck (an announcement deck, say) is dragged onto Drashti's window the same way (anywhere on it, in Pro Mode). Where PowerPoint or Keynote is on the computer, a PowerPoint (`.pptx` or `.ppt`) or Keynote file comes in **with its animations**: the app makes a movie of the deck, and Drashti cuts it into a step for each click, so **Next** and **Back** step through its clicks as in its slide show (the top of the window says, for example, "click 1 of 2"), and each slide comes in with the deck's own transition. Its videos and sounds come in as real videos and sounds, playing as the deck plays them (with the slide or at a click, trimmed, looping, at their volume), with the time bar. The report says which app made it and how long it took, and what could not come across. A PowerPoint file goes to PowerPoint where it is installed (otherwise Keynote, on a Mac), and a Keynote file to Keynote. They work out of sight: Drashti opens them in the background, and closes them again when it is done (if one was already open, it is left just as it was). On the Windows PC this has not yet been tried with the real PowerPoint: if it does not work there, the deck comes in as before, a picture of each page, with its videos as real videos. Drashti never makes a deck's animations while the stream is on air or recording: the deck then comes in as pictures, and the report says to import it again afterwards (it then takes the pictures' place). A PDF's pages become slides holding a picture of each. Either way, each slide keeps its speaker notes for the stage screen, its words cannot be changed in Drashti, and slides hidden in the deck are left out, as in its slide show; the report says how many.

- **The first time**, the Mac asks whether **Drashti** may control **Keynote** (or **Microsoft PowerPoint**): choose **Allow**. If **Don't Allow** was chosen, the report says so: open **System Settings**, **Privacy & Security**, **Automation**, **Drashti**, switch **Keynote** (or **Microsoft PowerPoint**) on, and drag the deck in again.
- **If neither is on the computer**, the deck's slides cannot come in, but its videos and sounds do, and the report says what needs PowerPoint or Keynote: on a computer that has one, save the deck as PDF (PowerPoint: **File**, **Save As**, PDF; Keynote: **File**, **Export To**, **PDF…**), and drag in the PDF. If a deck will not open in them (it may be damaged), the report says to save it again in PowerPoint or Keynote and drag that in.
- **A problem with an import** shows in the status bar along the bottom, in yellow with a ⚠ sign: press **Report** there to read it.
- **To remove a presentation** from the library: click it (or choose several: **Shift**-click, **Cmd**-click or **Ctrl**-click, **Cmd+A** or **Ctrl+A**, or drag a box over them), press **Delete** (on a Mac keyboard, **⌫**) and confirm **Delete**. The presentation open in the middle also has **Delete…** in its **⋯** menu, after **Edit slides** (**Delete from the library…** while it is open from a playlist). The question says any playlist it is in keeps its card, marked **Removed from the library**, and **Next** goes past it. **Edit**, **Undo** (Cmd-Z or Ctrl-Z) brings it back.

![The import report for a PDF, and for a PowerPoint file this computer cannot turn into pictures](screenshots/pictures-report.png)

Importing a folder again later skips what did not change. For a presentation that changed in ProPresenter since, the report asks whether to **Replace** Drashti's copy or **Keep both**.

Write down the numbers the report shows (presentations, playlists, media, problems) in your notes.

Once the import is done, **back up the library** to a USB drive: choose **File**, then **Back Up Library…** (on Windows, press **Alt** first to show the menu bar), pick the drive, and keep **Include the media** ticked. Drashti says where the backup went. Do it again after any evening you change the library. If the library ever needs to go back to a backup, **File**, then **Restore Library…** asks first, keeps the current library as well, and restarts Drashti (the screens go black for a moment), so never do it during a sabha. If the backup turns out to be damaged, Drashti says so after the restart and keeps the library you had.

**Backups by themselves.** Drashti can back up by itself on chosen days at a time: **File**, then **Scheduled Backups…**, **Choose…** the USB drive (or another disk; never Drashti's own folder), tick the days, set the time (late evening, after the sabha, is good), how many to keep (7 is a good start), and keep **With the media** ticked, then switch **Back up by itself** on and press **Save**. **Back up now** tries it at once. Drashti makes a folder "Drashti scheduled backups" on the drive and keeps everything there: the first backup copies all the pictures, videos and sounds, and later ones copy only what is new, so they are quick. When there are more than the number to keep, it removes the oldest it made there, and nothing else. It works quietly in the background and waits while the stream is on air or recording. **Leave the drive plugged in:** if it is not there at the time, that backup is skipped and a yellow line at the bottom of the window says so (press **OK** on it once you have seen it). If Drashti is closed at the time, that backup is not made later. To go back to one, use **File**, then **Restore Library…**, and choose a "Drashti backup" folder inside "Drashti scheduled backups".

---

## 4. The screens and the sound

The quickest way: with the hall's display connected and no screen showing the hall's picture yet, Drashti offers **Show on** that display, on the first start's welcome and under the top bar (with **Not now**). One click makes it the hall's screen (every language, named after the display) and shows the test slide on it for a few seconds.

**Set Up Screens…** (on the welcome, or later in **View > Set Up Screens…**; on Windows press Alt for the menu bar, or use **Set Up Screens…** in Screens) opens straight on the displays:

- **Screens**: **Show each display's number on it** puts a big number on every display for a few seconds (not on the one the controls are on), so you can see which output feeds which screens. For each display, one click: **The audience picture**, **The stage view (performers)** or **Not used** (the first one free for the hall is already chosen when no screen shows the hall's picture), and the languages a kirtan shows on it (for example Gujarati then transliteration in the hall, Gujarati only on the stage). **Done** sets the screens at once, and every screen shows a test slide for a few seconds, in its own languages; if an output would cover the controls, Drashti asks first (that display says **The controls are on this display**). **More setup…** goes on to the rest, which changes nothing until **Finish**:
- **Sound**: choose the output that goes to the mixer, and **Play a test tone** to hear it.
- **Stream** (only on the computer that streams to YouTube): what the stream shows, the camera and the sound input, and a kirtan's languages on the stream. These are YouTube's settings in Screens (below), where they can be changed at any time.
- **Theme**: the look new presentations start with.
- **Finish**: the screens, the sound, the stream and the theme are set at once.

Each step has **Skip this step**, which keeps things as they are. To set up by hand instead, or to change a screen's size later:

1. Click **Screens** (top right). It opens with three cards: **Projector**, **Stage screen** and **YouTube (the stream)**, each with a small picture of what it shows. The displays and the screen groups are below them.
2. Under **Screen groups**, type a name such as "Main Hall" and click **Add group**.
3. Under **Connected displays**, find each display that feeds the hall's screens and click **Use this display** next to it. If one of them is the display the Drashti controls are on, Drashti asks first, because the output would cover the controls.
4. Click **Identify screens**: each screen shows its name for a few seconds, so you can check they are the right ones.
5. If a screen needs a different size or shape (an LED wall, for example), set its canvas size and scaling there.
6. If there is a stage display for the performers, make a second group, for example "Stage", set it to show **The stage view (performers)**, and use its display.
7. **Sound**: in the same panel, under **Sound output**, choose the output that goes to the mixer (the one ProPresenter uses). Drashti remembers it.
8. Close the panel. The setup is kept for next time.

**Keep these screens?** After any change that puts an output on a display (**Show on**, **Done** or **Finish**, **Use this display**, ticking **On**, or a group's **Shows** or a key and fill output's **Sends** in Screens), Drashti asks **Keep these screens?** and counts down 15 seconds, on top of any of Drashti's own dialogs. **Keep** (or Enter) keeps the new screens; **Go back** (or Esc) puts back what that change changed, and nothing else, and so does pressing nothing for 15 seconds. If the change put an output over the controls, that output asks the same in its middle: Enter keeps, Esc goes back. If Drashti stops before an answer (a crash or a power cut), the next start goes back to the screens as they were before the change, and says so. Turning an output off asks nothing.

If an output ever covers the controls by mistake, press **Cmd+Shift+U** (Mac) or **Ctrl+Shift+U** (Windows) to uncover them. It works even when Drashti is not the active app.

**Looks.** A Look says what each screen group shows: which layers (the background, slides, props, messages, the ticker, the Masks layer, picture in picture), a kirtan's languages, and whether slides are drawn as designed or only their words, as a lower third (messages then show along the top). Drashti starts with one Look, **Standard**, which shows exactly what the screens showed before. In Screens, under **Looks**, **New Look** or **Duplicate** makes another, for example "Gujarati only" or "Lower thirds"; choose a Look there to see and change each group's settings in it. To switch the live Look in a sabha, use **Looks** under the live picture: every screen changes at once. The first Look in the list is the one Drashti starts with (**Up** and **Down** move a Look), and after an unexpected stop the Look that was live comes back. Simple Mode keeps whichever Look is live and cannot switch it.

**Stage layouts.** A stage screen shows the **Standard** stage view unless its group's Look gives it a layout of its own. In Screens, under a stage group, **Edit stage layouts…** opens the editor: **Duplicate** Standard, then drag the boxes where the performers want them (current and next slide, notes, clock, timers, the stage message, what's coming up in the playlist, the time left on a video or song, whether the hall is blacked out, the audience picture live, or some fixed words), set each one's size and colour, and **Save**. Then choose it under **Stage layout** for the stage group. **New from a Template…** in the editor makes a ready-made layout with the timer it shows (**Timer only**, **Countdown to a time**, **Countdown**, **Count up from 0:00**, or **Timer and clock over the audience**), and the stage screens show it at once, in the live Look; the **Stage screen** panel under the live picture then lists its timers, with **Start**, **Pause** (or **Stop**) and **Reset**. A box can be moved and sized with the mouse, the arrow keys or its numbers, can overlap the others, and can have a fill, bold words, a line round the letters or a shadow; a timer box can turn amber from a time left, red at 0:00, and flash at 0:00. Ask the performers what they need to see. With **Audience** off, the audience picture keeps the hall's picture, with **Audience off** in its corner, so the performers are not misled.

**A MIDI controller.** If the operators like pads or a foot switch, plug it in, press **MIDI controller…** under **More tools** (right column), choose the device, then for each action press **Learn** and the pad. Next, Back, Clear all, Black-out and Logo work in Simple Mode too.

**Key and fill.** If the mandir's video switcher (an ATEM, for example) lays words over the camera, it needs two feeds from the computer: in Screens, make a group, set it to **Key and fill (for a video switcher)**, and use two displays: the first is the **fill**, the second the **key** (swap them with **Sends** if they're the wrong way round). On the switcher, set the downstream key's source to those two inputs and turn on **Pre Multiplied Key**. The words show as a lower third; black-out and the logo don't affect them. The key and the fill draw a lower third alike at every moment, as it comes in and goes out too. A picture-in-picture box stays off a key and fill pair unless its Look turns that layer on.

**The mixer's program as a video input.** To show the video mixer's program (a camera) on the hall's screens and the stream, connect the mixer's USB output to the computer, then press **Library**, **Media**, **Add a Video Input…**. Choose it by its small live picture, give it a name (Drashti offers "Input 1"), choose **Fit inside, with black around it** or **Fill the screen**, and press **Add to Media**. On a Mac, the first time, Drashti says why it needs the camera: press **Continue**, then **Allow**. On Windows, if it says the camera privacy setting is off, **Open Settings** shows where to turn it on. From then on one click on it, under **Video inputs** in **Media**, puts it up, and it can go in a playlist or behind a slide as a video can (`docs/operator-guide.md`, section 6). A playlist or a slide names it, so on the other computer an input given the same name goes up in its place; where there is none, Drashti says so plainly and **Next** goes on past it. If the mixer's program is Drashti's own picture, showing it in Drashti makes a picture inside itself, over and over: use it while the mixer shows a camera.

**Masks.** If a screen's picture spills somewhere it shouldn't (an LED wall that isn't a rectangle, a projector hitting a pillar), make a mask in Screens (**Edit masks…** under that group). The editor shows the hall screen's live picture behind the shapes for as long as it is open, so the mask fits what is really there (with no hall screen yet, a test pattern). Add rectangles, rounded rectangles or ellipses over the parts to hide (or choose **Show only what is inside them**), **Save**, then choose it under **Mask** for that group. It stays on in that Look; Clear all and F8 never take it away. The **Masks** panel under the live picture is different: it puts a mask up on the audience screens for a moment, and F8 takes it down.

---

## 5. Run a sabha from a playlist

Replay last week's sabha from its imported playlist, from start to end, as the operator would.

1. At the top of the left column, under **Playlists**, click the playlist (inside its folder). It opens in the middle of the window, its items as cards.
2. Click the first item. Its slides appear under the playlist.
3. Press **Space** (or the right arrow) to put the first slide on the screens. Keep pressing it to go through the sabha. At the end of one item, it carries on into the next, stepping over headers.
4. **Shift+→** jumps to the start of the next item; **Shift+←** goes back to the start of the previous one.
5. Pictures and videos in the playlist go up as the background; songs and sounds play through the mixer. One click on one puts it up at once (**Enter** on its card too); a double click puts it up once, never again from its start. To look at one in the middle without putting it up, **Alt**-click it (**Option**-click on a Mac); **Cmd**-click (**Ctrl**-click on Windows) and **Shift**-click only choose it. A presentation opens in the middle, as in step 2.
6. What comes next shows on the stage screen (its **Next**) and on a presenter's phone or tablet.
7. Try the other controls a sabha uses: **Black-out** (B), the clear buttons along the bottom (F1 to F8, in the order of their keys, each showing its key; each is lit while its layer is on the screens), a **timer** (**Show on the screens** puts its time up alone, "5:00"), a **message** (for example "Car {plate} please move"), a **prop** (the mandir's logo), a **stage message** if there is a stage display, and another **Look** if the mandir uses more than one.
8. Compare with ProPresenter as you go. Things to look at:
   - Do the words look the same: size, font, line breaks, Gujarati and Hindi letters?
   - Are the backgrounds and videos the same, and do they start and loop the same way?
   - Is the sound right, and in step with the picture?
   - Does anything appear late, flicker, or go black when it shouldn't?

Write down anything different, with the time.

**Shastra passages.** The texts (Satsang Diksha, the Vachanamrut, Swamini Vato…) are **not** part of Drashti. The mandir's admin loads each one from a file prepared from a source that BAPS or the mandir has authorised, and nobody else: never a text copied from a website or typed up from memory. To load one, drag its file onto the library, or choose **Shastra** (the tab beside Presentations and Media), then **Texts…**, then **Load a text…**. Loading a newer file of the same text updates it. To show a passage, type its reference in the Shastra box, for example `SD 14`, `SD 14-16` or `Vach G.Pr. 1`, and press Enter: its slides appear in the middle, ready to go up as a presentation's are. If Drashti says it cannot find that reference, check the text's abbreviation (listed in **Texts…**). You can also search the words, in any language, or click through a text's sections. Drag a passage onto a playlist to put it in the running order. Each screen shows the languages its Look chooses: Sanskrit can be shown in Gujarati script on one screen and Devanagari on another.

**Making next week's playlist from a template.** With **View › Show Shastra, Templates and Kirtan Details** on (Pro Mode), at the top of the left column, **Templates** lists running orders to make playlists from: two examples come with Drashti (**Example: Ravi Sabha** and **Example: Bal/Kishore Sabha**), to change into the mandir's own. **Use** beside one makes a new playlist from it; type its name and press Enter. Its slots (dashed rows, such as "Kirtan" or "Pravachan title") are places to fill: click one, and pick what goes there (the list starts with the slot's category, and typing searches titles, words, kavi and raag). To keep a playlist's running order as a template, open the playlist and choose **Save as template…** in its menu (**⋯**): each kirtan can stay the same every week or become a slot. A template never goes on the screens itself. To rename a slot or change what it searches, right-click it and choose **Edit slot…**. To make an item start a timer as it goes up (the pravachan's countdown for the stage, for example), right-click it and choose **Timers when it goes up…**; a template keeps this for every playlist made from it.

**The idle rotation (darshan pictures and quotes).** Before a sabha, the screens can show darshan pictures and quotes, one after another. An admin chooses them once, in the **Idle rotation** panel at the bottom of the live column: **Set up**, tick the pictures (they must be in the media library first: drag them onto the library's **Media** tab), choose how many seconds each stays up, and add quotes (type them from an authorised source, in Gujarati, Hindi or English, with who said them). Then, in **Screens**, set each group's **When nothing is up**: **The idle rotation, once started** for the hall, or **always** for a lobby screen that should show it whenever nothing else is up. Before the sabha press **Start**; the first slide that goes up stops it by itself, and Clear all does not bring it back to the hall. Check on a practice evening that every screen changes picture at the same moment.

**Samvat and tithi.** Like the texts, the calendar is **not** part of Drashti, and Drashti never works out a tithi itself. The mandir's admin loads a calendar file prepared from the calendar BAPS or the mandir publishes (and nobody else: never one copied from a website or worked out by hand), in the format in `docs/calendar-format.md`: drag it onto the library, or press **Calendar** in the Timers panel, then **Load a calendar…**. A new year's calendar is loaded the same way; loading a corrected file with the same name replaces the old one. Today's Samvat date, tithi and festival then show along the bottom of the operator window (and in Simple Mode). For the performers, add a **Samvat date and tithi** box to a stage layout (or tick **Today's Samvat date under the time** on its clock); for the audience, make a message such as "Today: {date}" with the field set to **Today's Samvat date**, and show it when wanted. On a date the calendar does not give, nothing shows: check the dates in **Calendar**.

To fix words on a slide, use **Edit words** above the slides. To change how a slide looks (move or resize its words, give a word its own font or size, add a shadow or an outline, a shape, a picture or a video, or a **Timer** that shows a timer live), use **Edit slides** beside it, or double-click a slide. **New Timer Slide…**, in a slide's right-click menu, adds a slide with a timer after it. In the slide editor, click something to select it and drag it to move it (it snaps to the middle and edges; hold Alt to place it freely); double-click words to type in them. Shift-click (or drag a box round them) selects several: drag the box round them by its handles to resize them together, or its round handle to turn them together. **Copy** and **Paste** (Cmd+C and Cmd+V, Ctrl on Windows) copy elements to another slide, or another presentation's editor, with their look; Cmd+Shift+V pastes exactly in place. **Save** puts the change on the screens if the slide is live; **Cancel** keeps nothing. Either save can be undone with **Undo** (Cmd+Z or Ctrl+Z).

**Music before the sabha.** In the **Music** panel (right column, under **Audio**): **+**, then **Create playlist**, then **Add sounds…** and tick the sounds (import them first, like any media), or drag sound files onto it from the Finder or Explorer (**+**, then **Import**, brings them in too). **Play** plays them one after another, with a short fade between them; **Pause** stops where it is, and **Play** goes on from there. The loop button (on to begin with) goes round again after the last; the shuffle button mixes the order from the next Play. The music is separate from the slides: Next and Back don't touch it. A slide or item with its own sound takes over (the music stops), and **Clear audio** (the **Audio** button along the bottom, or F5) or **Clear all** stops it too; **Put it back** brings it back. In the same row as **Play** and **Pause**, after the next track's button, three small buttons, **Back 15 s**, **Forward 15 s** and **Last 10 s** (the mouse over one names it), move in the track playing, never past its start or end (dimmed until Drashti knows how long it is, a moment after it starts). In Simple Mode there is a **Play music** / **Pause music** button, and a phone remote has them in its **More** tab.

**Start, end and markers.** To play only part of a video or a sound, or jump to a place in it: in the media list, press its **Markers** button (a bookmark; its tooltip says "Start, end and markers of …"). Play or drag the preview to the place, then press **Here** beside **Start** or **End**, or type a name and press **Add at the time shown** for a marker; **Save**. It plays only that part everywhere it is used (a looping background goes round between the two points). While it plays, its markers are buttons under the live picture (and in a phone remote's **More** tab): a press jumps every screen and the sound there together. Beside them, for a background video or a sound playing, **Back 15 s**, **Forward 15 s** and **Last 10 s** jump the same way. Under **Next** and **Back**, each thing playing (the background video, a video on the slide, the picture-in-picture box's video, a sound, the music) has its **time bar**: the time gone and the time left, with its start and end points and its markers as ticks. Click or drag it to move there (every screen, the node and the stream go there together as you let go), with **Play** or **Pause** before it; with the keyboard, the arrow keys move it 5 seconds, **Page Up** and **Page Down** 30. Simple Mode shows the bar and never moves it, and a phone remote has the same bars under its live picture. A video on a slide can show a thin play bar on the screens as well: tick **Show the play bar on the screens** for it in the slide editor. After importing presentations, look over any start and end points and markers the report says were read.

### Simple Mode, for a volunteer

Simple Mode is one screen with big buttons, for running a sabha from its playlist without being able to change anything by mistake. Try it on one of these evenings, ideally with a volunteer who has not used Drashti before.

1. In Pro Mode, mark the mandir's logo once: under the live picture, in **Props**, press the stamp button beside the logo's prop (**Use … as the logo**). The **Logo** button shows that prop instead of the picture.
2. Press **Simple Mode** in the header (or **View**, then **Switch to Simple Mode**; on Windows press **Alt** first).
3. The first time Simple Mode opens on a library (with no slide up), three short steps show under the header: choosing the playlist, Next and Back, and Black-out and Clear all. **Next step** goes on, **Skip** ends them, and so does a slide going up; they never come again for that library, and the keys work all along.
4. Pick the playlist at the top left if it is not already open. Its items are listed below, with headers.
5. **Next** (or →, Space, Page Down, or a presentation clicker) starts the playlist and goes through it, a video input in it too (the list marks one this computer does not have, and Next goes past it). **Back** (←, Page Up) undoes the last Next exactly: after one Next too many, the screens are as they were.
6. **Black-out** (B or .) and **Logo** (F12 or L) cover the picture, and pressing them again brings back exactly what was there. The stage screens keep showing the words.
7. **Clear all** (F1) takes everything down; straight after it, **Put it back** (or Cmd+Z, Ctrl+Z on Windows) brings it all back.
8. Nothing in Simple Mode can import, edit, remove, or change themes, screens, the sound or backups, or switch the Look; its time bars show what plays without moving it. It can turn **Audience** or **Stage** back on (**Turn on** in its status bar), never off. If Drashti stops unexpectedly and is started again within 3 hours, it comes back in Simple Mode. After Drashti is quit on purpose (or started 3 hours or more after a stop) it starts in Pro Mode.
9. To leave it: **Switch to Pro Mode…** at the top right (or **View**, then **Switch to Pro Mode…**), type **pro**, and press **Switch to Pro Mode**. Volunteers should not need to.

Write down anything the volunteer found hard, with what they were trying to do.

### Updates (for whoever looks after Drashti)

Drashti never updates itself. To see if there is a newer version: **Help**, then **Check for Updates…** (Pro Mode; on Windows press **Alt** first). If there is one, press **Download** (it comes slowly in the background, and waits while the stream is on air or recording), then turn on **Install it when Drashti quits**. It installs the next time Drashti is quit, after the sabha, and Drashti does not start again by itself: start it as usual. On a Mac, until Drashti is signed, the update is downloaded but has to be installed by hand: **Show the file**, quit Drashti, open the file and drag Drashti into Applications. **Update the second computer too:** a node must run the same version as Main. Its window then says so and offers **Update to Drashti …**; press it, then **Download Drashti …**, then **Quit and install**, and start it again.

### Access by Gmail

Since alpha.13 Drashti has **no roles and no PINs**. On a computer let in (section 2), everyone can do everything in Pro Mode, except the **Access List** (**View › Access List…**), which only the computer of the person who approves access has. **Simple Mode** is a way of working, not a lock: it is left with **Switch to Pro Mode…** and the word **pro**.

- **The internet.** Drashti checks its access as it opens and every 15 seconds. When it cannot, a bar at the top counts down ("No internet: Drashti stops in 1:45 unless it can check your access") while the show goes on, and goes by itself once a check is answered again. Join the computer to the phone's hotspot before the countdown ends: after 2 minutes everything stops (**Drashti stopped: no internet**), and only **Quit** works; check the connection, then start Drashti again. With no internet as it starts, Drashti does not open: the lock screen says so, with **Try Again**.
- **When access is taken away** (the person who approves access revokes the Gmail), Drashti stops at its next check, saying "Your access to Drashti has been removed", and only **Quit** works: the stream and the recording end, the screens fade to black, a node goes black, and the phones say **Drashti has stopped**. Ask the person who approves access.
- **A data folder copied to another computer** does not let that computer in: each computer is let in on its own.
- Phones, tablets and a node work only while their Main is let in.

---

## 6. Going live on YouTube, and recording

Only on the computer that streams, and only once the screens and sound work. **Try it first on a private or unlisted YouTube stream**, never the mandir's public one, until it has worked twice.

**Once, to set it up:**

1. Plug in the camera (or the capture card) and the cable from the mixer's line out into the computer.
2. In Drashti press **Stream** (top right), then **Stream settings**.
3. In **YouTube Studio** choose **Go live**, then **Stream**. Copy the **Stream key** and paste it in Drashti's **Stream key** box, then **Save key**. Drashti keeps it locked away and never shows it again ("A key is saved"). Check the **Address** says `rtmps://a.rtmps.youtube.com/live2`.
4. Choose the **Camera** and the **Sound input** (the mixer's line in; a mixer's USB output is a sound input too, and can be chosen here). They are also on **YouTube**'s card in **Screens**, with the stream's languages: the same settings, so a change in one shows in the other. On a Mac, the first time, macOS asks whether Drashti may use the camera and the microphone: press **Allow**. If Drashti says Windows or macOS is blocking them, follow what it says, then open the Stream panel again.
5. **Internet**: **Good internet** (1080p) needs an upload of 8 Mbps or more; otherwise choose **Weak internet** (720p). Ask whoever looks after the mandir's internet, or run a speed test on this computer.
6. **Save profile**. Back in the Stream panel, the preview shows what the stream will look like, and the bar under it moves with the sound. Talk into a microphone on the mixer: if the lips move after the words are heard, raise **Sound delay** in Stream settings a little at a time.
7. **Recording**: press **Choose a folder…** and pick a folder on a disk with plenty of space (an hour at Good internet is about 3 GB).

**Each time:**

1. Open the **Stream** panel. Choose **Camera and words** (the camera, with the kirtan's words along the bottom) or **Slides** (what the hall sees, a video input on the screens too). You can switch at any time, even on air.
2. Press **Record** if the sabha should be recorded too.
3. Press **Go live…**, read what it says, then **Go live**. The top of the window says **ON AIR**. In YouTube Studio the stream appears after a few seconds.
4. Run the sabha as usual. On the hall's screens, black-out and the logo do not black out the stream in **Camera and words**: the camera carries on and the words go.
5. At the end, press **End the stream…**, then **End the stream**, and **Stop recording**. End the broadcast in YouTube Studio too.
6. The recording is in the folder you chose, named `Drashti <date> <time>.mkv`. It opens in **VLC** (free, for Mac and Windows) or IINA on a Mac; QuickTime Player does not open this kind of file. If Drashti stopped in the middle, the file still plays up to that moment.

There is no key for going live or ending: always the buttons, and always a question first.

**When the internet drops:** the stream says **Reconnecting** and tries again by itself (after 1, 2, 4, 8, 15 and then every 30 seconds), and the recording carries on all the while. But Drashti also needs the internet to check its access: the bar at the top counts down, and after 2 minutes everything stops, the hall's screens too. So join the computer to the phone's hotspot before the countdown ends (section 5, **Access by Gmail**). If the stream has not come back within a few minutes, check the internet (a browser on this computer), and if the connection is slow all evening, end the stream, choose **Weak internet** in Stream settings and go live again. If YouTube's broadcast has ended by then, start a new one in YouTube Studio.

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
4. The remote opens: **Next** and **Back** at the bottom, the live picture with the time bar of what plays, the slides to tap, and the clears in the window's order with their keys (**Clear all** F1 to **Logo** F12, and **Black-out** B); its **More** tab has the music, the stage screen, messages, timers, props, the Looks and more tools. The top says **Connected**. A tap does what the same button does in Drashti, and Simple Mode's limits apply to it too.

**A presenter's phone or iPad** is a Remote too: it also has the whole **Library** (search, open a presentation, tap a slide to put it up), the slide's **Notes** under the live picture, and, on an iPad held sideways, the notes and Next beside the slides. Give the presenter `docs/presenter-guide.md`: one page, from pairing and Add to Home Screen to using it.

**Looking closer, sharing and adding files.** On a remote, **Look closer** (or a tap on the live picture) shows the picture full size and sharp, to zoom with two fingers on the phone alone; zoomed in on what is live, **Show this zoom on the screens** puts that zoom on the hall's screens, and **Back to Whole** undoes it. **Look through** shows a presentation's slides one by one on the phone alone, and the magnifier or the play button beside a picture or a video in the playlist (or in **Media**) opens it there, a video with its sound and its own time bar. In Drashti, right-click a playlist and choose **Share with Phones and Tablets**: paired remotes find it in their **Library**, under **Shared from Drashti**, to look at and play on the phone alone (**Stop Sharing** ends it). And with **Phones and tablets may add files** on (in **Phones**; off until turned on), a remote's **Add from this Phone…** (in **Library**, **Media**) sends a picture, video, sound, PDF, PowerPoint or Keynote file (up to 2 GB each) into Drashti's **Media** and the playlist **Added from Phones**, marked with the phone's name; it never goes on the screens by itself.

**A tablet as a stage screen:** the same, with **Pair a Stage device**. The tablet shows what the stage screens show, a layout's audience picture too, drawn from small previews as the phone remote's live picture is (a video input or another app's window is not drawn there: that part stays black). Press **Full screen** on it, and set the tablet never to lock while it is on the stage.

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
- If the phone says **Drashti has stopped**, Drashti stopped on the computer: its access was taken away, or it could not check it (section 5, **Access by Gmail**).

**When a phone is lost** (or someone leaves the seva): in **Phones**, press **Remove** beside it. It is cut off at once, even in the middle of a sabha. To use it again, pair it with a new code.

---

## 8. The second computer as a node

With Drashti, the mandir's second computer can follow the first instead of running a show of its own: the first is **Main** (the library, the playlists, the controls), and the second is a **node** that shows Main's screens on its own displays, in step. A node has no controls and makes no sound. Try it on one of these evenings, after section 7.

**Setting up the node (once):**

1. Install **the same version** of Drashti on both computers (the node says so if they differ, and refuses to follow until they match).
2. On the second computer, start Drashti. On its very first start it asks how the computer will be used: choose **Node: show screens for another computer**. A node needs no Gmail of its own: it runs while its Main is let in (section 2). (A computer that already runs Drashti as Main: **File**, then **Use This Computer as a Node…**; on Windows press **Alt** for the menu bar. Its library stays on the computer, untouched, for switching back.)
3. The node's window opens: **Drashti Node**, with **Pair with Main**.
4. On Main, open **Screens** (in the header), then press **Pair a node**. It shows Main's **address** (for example `192.168.1.20`) and a **code**, for two minutes.
5. On the node, type the address and the code, then press **Pair with Main**. The node's window now says **Online** and **Follows** Main's name.
6. The first time, Main's computer may ask about the network:
   - **Mac:** "accept incoming network connections?" Press **Allow**.
   - **Windows:** tick **Private networks** only, then **Allow**.

**Giving the node's displays a screen:** in Main's **Screens**, under **Nodes**, each of the node's displays is listed with **Use this display**: choose the group (for example "Main Hall" or "Lobby") and press it. The node opens an output on that display and shows what that group shows, the same as Main's own screens. **Show display numbers** in the node's window puts each display's number on it, so you know which is which.

**Pictures and videos:** the node keeps its own copies, made over the network before they are needed: what is on the screens, the playlist that is playing, and every playlist made, changed or opened on Main this week. For a festival with pictures from elsewhere in the library, tick **Get everything ready** for the node in the screens dashboard (below). If something goes up before its copy has arrived, the words show at once and the picture or video appears as soon as it has copied.

**Reusing a playlist from an earlier week:** open it on Main before the sabha (a click on it is enough). It then counts as this week's, and the node copies its pictures and videos straight away. Check the dashboard says they are all ready (for example "14 of 14 ready"). **Get everything ready** also covers it.

**Before the sabha: the screens dashboard.** Click the screens line at the bottom left of Main's window (for example "3 screens showing"). The dashboard shows every display, Main's and the node's, with a small picture of what each really shows, and for the node: **Online**, its latency, its clock, and how many pictures and videos are ready (for example "14 of 14 ready"). **Identify** puts a display's number and screen name on it. Simple Mode can open the dashboard too, but cannot change anything there.

**When a node goes offline** (the bottom of Main's window shows a warning, such as "“Lobby PC” offline since 19:42"):

- **Do not stop the sabha.** Main's own screens carry on. The node's screens keep their last picture (a video plays on) for 2 minutes; after that they go black until the node hears from its Main again.
- Check the node computer is on, Drashti is open on it, and its network cable or Wi-Fi is connected. When the network is back, the node connects again **by itself** and catches up with the show; nothing needs pressing.
- If the node computer restarted, Drashti shows the last picture again until Main answers (for 2 minutes at most; then black until it does).
- If Main has stopped (its access was taken away, or it could not check it), the node goes black at once, and shows again once Main is let in and running.
- If the warning says the node is **still copying** files on its screens, they appear as soon as they arrive. If it says there is not enough room on the node's disk, free some space on that computer.
- If the node's window says **Refused**: "not the Main this node paired with", Main's computer or its Drashti data was replaced; unpair the node and pair it again. If nothing was replaced, tell whoever looks after Drashti, and leave the node unpaired. "Main runs Drashti … and this node runs …": install the same version on both.

**Removing a node:** in Main's **Screens** (or the dashboard), press **Remove** beside it. It is cut off at once and its screens go black. To use it again, pair it with a new code. On the node, **Unpair…** does the same from its side, and **Use this computer as Main…** turns it back into a Main.

---

## 9. Falling back to ProPresenter

A real sabha always has a named fallback operator who knows how to switch back. Practise it on these evenings until it takes **under a minute**:

1. Quit Drashti: **Cmd+Q** on the Mac; on Windows, close the Drashti window. If screens are showing, Drashti asks first, because they will go black. Confirm.
2. Open ProPresenter. Its screens come back as before.
3. Time it and write the time down.

The plan's order for real use (PLAN.md, section 5.1) is: a smaller weekday or Bal/Kishore sabha first, then Ravi Sabha, then a festival, one computer at a time. ProPresenter is only retired on a computer after four weeks of sabhas without falling back.

---

## 10. After a problem: save diagnostics

If anything goes wrong (a screen went black, something froze, Drashti closed by itself), as soon as you can:

1. In Drashti, choose **Help**, then **Save Diagnostics…** (on Windows, press **Alt** first to show the menu bar).
2. A file called "Drashti diagnostics" with the date and time appears on the **Desktop**. The live controls say where it went.
3. Send that file to whoever looks after Drashti, with the time it happened and what you saw.

The file holds the versions, the screen and sound setup, and Drashti's log. It never holds kirtan words, presentation names or where your files are. If Drashti asks about crash files first, press **Save** with **Include crash files** left unticked, unless whoever looks after Drashti asks for them: they can hold words from slides.

If the problem showed on the node's screens, do the same on the node: **Help**, then **Save Diagnostics…** there too (on Windows, press **Alt** first). The node's window says where its file went, and both files go to whoever looks after Drashti.

If Drashti closed by itself, start it again: it puts back what was on the screens (the slide, background, sound, timers, messages and props) and says so at the top. A video or a sound carries on where it would be by now, counting from its last jump or marker, between its start and end points. A video input, as the background or in the picture-in-picture box, is put back while it is still in **Media**; if a screen then finds no camera of that name, it comes off again (the box with it) within 20 seconds. Either way, the note at the top names an input that did not come back. Save diagnostics after that.

---

## 11. The checks to run on each computer

Once per computer, during these evenings:

1. **The performance check.** It needs the computer let in first (section 2). Close Drashti, then run it. It covers the first display for about half a minute, imports a few hundred sample files into a throwaway library (never the real one) while changing slides quickly, and prints one line.
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

   **The video cases** (on each computer that shows video: Main, and the node). The same check, with a video background on the screen while the slides change every two seconds, as in a sabha. Run each case once (twice if it did not pass), with the installed Drashti closed:
   - `video-1080p30`: a 1080p video at 30 frames a second, the everyday background;
   - `dissolves-video`: a new video dissolving in every two seconds, the hardest case;
   - `masks-video`: the 1080p video under a mask (only if a screen has a mask).

   Mac, in Terminal (one line per case):

   ```bash
   DRASHTI_SELFTEST=performance DRASHTI_PERF_SCENARIO=video-1080p30 /Applications/Drashti.app/Contents/MacOS/Drashti | grep DRASHTI_PERFTEST_RESULT
   ```

   Windows, in PowerShell (change the case on the second line for each run):

   ```powershell
   $env:DRASHTI_SELFTEST = 'performance'
   $env:DRASHTI_PERF_SCENARIO = 'video-1080p30'
   Start-Process -Wait -NoNewWindow "$env:LOCALAPPDATA\Programs\drashti\Drashti.exe" -RedirectStandardOutput "$env:TEMP\drashti-perf.txt"
   Select-String DRASHTI_PERFTEST_RESULT "$env:TEMP\drashti-perf.txt"
   ```

   Copy each line into your notes. What matters in it (`"name"` is the check, `"ok"` whether it passed, `"detail"` its figure):
   - **"every screen showed 9 in 10 of the background video's frames"** must be `"ok":true`. Its detail is the share it showed (for example `97%`). Below 90% means this computer cannot decode and draw the video in time: it needs a graphics chip that decodes video (`docs/admin-guide.md`, sections 1 and 13).
   - **"half the slide changes during the import reached the screen within a frame"** and **"9 in 10 within two frames"** should be `"ok":true`.
   - **"the main process never went more than 150 ms without a turn"** should be `"ok":true`; a figure a little over (say 150 to 200 ms) once is not a worry, several hundred is.
   - **"the import overlapped at least 2 slide changes (if it lasted 4.0 s or more)"** should be `"ok":true`. On a quick computer the import is over before the slides can change twice: the line still passes, and its detail says so (for example `1 in 1.1 s, quicker than 2 changes take: nothing to judge`). The slides then go on changing after the import until five changes have been made since it began, and the slide-change lines judge those five; their details say how many came after it (for example `median 9 ms, 5 changes from the import's start, 4 after it`). If this line fails, the slides stopped changing while the import ran: note the detail.
   - The `summary` names the priority Drashti ran at (`main process priority above normal` on Windows).

   **On the Windows PC only**, run `video-1080p30` and `dissolves-video` again with `$env:DRASHTI_PRIORITY = 'normal'` added (normal priority, level with other programs, instead of ahead of them), and keep those lines too: the admin decides from them whether Drashti runs ahead of other programs on this PC (`docs/admin-guide.md`, section 13). Afterwards close PowerShell (or `Remove-Item Env:DRASHTI_*`), so nothing is left set.

2. **On the Windows PC**, go through `docs/windows-checks.md`: the taskbar, focus, scaling, sleep, notifications, installing, performance and the fallback drill. Write down Pass, Fail (with what you saw) or N/A for each.

---

## Keys at a glance

On the Mac, **Cmd** is the ⌘ key; on Windows, use **Ctrl** instead. These keys follow what the operators already press. **F5** now clears the sound and **F6** messages (they changed places); **F7** clears the ticker and **F8** the Masks layer (they changed places too). The clear buttons along the bottom go in the same order, F2 to F8, each showing its key. **F12** is the logo (**L** still works). **Cmd+1** (Ctrl+1 on Windows) turns the audience screens off and on, and **Cmd+2** (Ctrl+2) the stage screens; **View** shows them beside **Audience** and **Stage**. On a Mac laptop the F-keys may need Fn held down, unless **Use F1, F2, etc. keys as standard function keys** is on (System Settings, **Keyboard**, **Keyboard Shortcuts…**, **Function Keys**); a Windows laptop may need Fn Lock.

| Key                                            | What it does                                                                                                                                                                           |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Space**, **→**, **↓** or **Page Down**       | Next slide (on into the next playlist item at the end)                                                                                                                                 |
| **←**, **↑** or **Page Up**                    | Previous slide (in Simple Mode, Back: undoes the last Next exactly)                                                                                                                    |
| **Shift+→** or **Shift+↓**                     | Next playlist item                                                                                                                                                                     |
| **Shift+←** or **Shift+↑**                     | Previous playlist item                                                                                                                                                                 |
| **B** or **.**                                 | Black-out on or off                                                                                                                                                                    |
| **F12** or **L**                               | The logo instead of the picture, and back                                                                                                                                              |
| **F1**                                         | Clear all                                                                                                                                                                              |
| **F2**                                         | Clear the slide (the background stays)                                                                                                                                                 |
| **F3**                                         | Clear the background                                                                                                                                                                   |
| **F4**                                         | Clear props                                                                                                                                                                            |
| **F5**                                         | Clear the sound                                                                                                                                                                        |
| **F6**                                         | Clear messages                                                                                                                                                                         |
| **F7**                                         | Clear the ticker (announcements scrolling along the bottom)                                                                                                                            |
| **F8**                                         | Clear the Masks layer (a screen's own mask, set in its Look, stays)                                                                                                                    |
| **Cmd+F** / **Ctrl+F**                         | Open the library at its search box                                                                                                                                                     |
| **Shift+F10** or the Menu key (in a list)      | The menu of a playlist, folder or item, as a right-click (on a Mac laptop: **Fn+Shift+F10**)                                                                                           |
| **Tab** / **Shift+Tab**                        | Move through the window, region by region; **Enter** presses what has the focus (Space is Next, except in an open menu, where it chooses)                                              |
| **Cmd+A** / **Ctrl+A** (in a list)             | Choose the whole list (**Shift**-click chooses a run, **Cmd**- or **Ctrl**-click one more, and a box dragged from an empty place the rows it touches)                                  |
| **Delete** or **Backspace** (in a list)        | Remove the chosen presentations, playlists or items, all at once with one Undo (asks first for presentations and playlists)                                                            |
| **Alt+↑** / **Alt+↓** (a playlist's item)      | Move the item up or down a place (on a Mac, **Alt** is the ⌥ Option key)                                                                                                               |
| **Cmd+Z** / **Ctrl+Z**                         | Undo the last removal, words edit, theme, or playlist add or move (in Simple Mode: put back what Clear all took down)                                                                  |
| **Cmd+Enter** / **Ctrl+Enter** (editing words) | Save the words                                                                                                                                                                         |
| **Cmd+1** / **Ctrl+1**                         | The audience screens off, and on again                                                                                                                                                 |
| **Cmd+2** / **Ctrl+2**                         | The stage screens off, and on again                                                                                                                                                    |
| **Cmd+Shift+S** / **Ctrl+Shift+S**             | Open Screens                                                                                                                                                                           |
| **Cmd+Shift+U** / **Ctrl+Shift+U**             | Uncover the controls (works from anywhere)                                                                                                                                             |
| **Esc**                                        | Stop Repeat Slides going round (its slide stays up). In a dialog, a question or the search box: close it, or empty the box; with typed changes it asks first (**Enter** keeps editing) |
| **?** (Pro Mode, no field chosen)              | The list of keys (also **Help**, then **Keyboard Shortcuts…**)                                                                                                                         |

**B**, **.**, **L** and **?** can be turned off (**Help**, then **Keyboard Shortcuts…**, the switch at the top): then use the **Black-out** button, and **F12** or the **Logo** button for the logo.

In **Start, end and markers** (a video's timeline): **I** and **O** set the start and the end at the play head, and the arrow keys move a handle (with **Shift**, a second at a time).

On a **time bar** (under **Next** and **Back**, in Pro Mode): the arrow keys move what plays 5 seconds, **Page Up** and **Page Down** 30, and **Home** and **End** go to its start and end points.

**Transitions** (how a slide comes on; chosen in Pro Mode, for a slide or a presentation in the slide editor, or for a Repeat Slides playlist under its name): **Cut** (at once), **Fade**, **Fade through black**, **Slide** (in from the right) and **Slow zoom** (a fade, then the slide growing slowly while it is up); and **Wipe**, **Push** and **Zoom**, which move the words on screens whose Look is Bold and fade elsewhere, and **Line by line** and **Word by word** (never word by word on a kirtan's slides). Pictures only ever fade. Every screen runs them at the same moment. A slide from a deck with its animations comes in with the deck's own transition; in the slide editor it, and each of its clicks, can have one of these instead, **Over the deck's own** or **Instead of the deck's own**.

Zooming the picture on the screens has no key either: in Pro Mode, scroll or pinch over the **LIVE** picture while a picture is up, and **Keep this zoom** keeps it for next time. The screens dashboard has no key: click the screens line at the bottom left of the window (it opens in Simple Mode too). Going live, ending the stream and recording have no keys: use the buttons in the **Stream** panel (each going live or ending asks first). Switching the Look has no key either: use its buttons under the live picture.

In the slide editor:

| Key                                                    | What it does                                                                                                 |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| **Tab** / **Shift+Tab**                                | Select the next (or previous) thing on the slide                                                             |
| **← → ↑ ↓**                                            | Move what is selected one pixel (with **Shift**, ten)                                                        |
| **Enter**                                              | Type in the selected words (double-click them, too)                                                          |
| **Esc**                                                | Stop typing; then let go of the selection; then close (asking first if changed)                              |
| **Delete** or **Backspace**                            | Delete what is selected                                                                                      |
| **Cmd+D** / **Ctrl+D**                                 | Duplicate what is selected                                                                                   |
| **Cmd+A** / **Ctrl+A**                                 | Select everything on the slide                                                                               |
| **Cmd+C**, **Cmd+X**, **Cmd+V** (Ctrl on Windows)      | Copy, cut and paste what is selected (to another slide, or another presentation's slides)                    |
| **Cmd+Shift+V** / **Ctrl+Shift+V**                     | Paste exactly in place                                                                                       |
| **Cmd+Z** / **Ctrl+Z**, **Cmd+Shift+Z** / **Ctrl+Y**   | Undo and redo in the editor (while typing: the typing)                                                       |
| **Cmd+S** / **Ctrl+S**                                 | Save the slides                                                                                              |
| **Alt** (while dragging)                               | Place freely, without snapping                                                                               |
| **Shift** (while dragging a corner or the turn handle) | Keep the proportions (a picture or video keeps them anyway: Shift lets them go); turn in steps of 15 degrees |
