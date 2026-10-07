# Setup day: the checklist

This is the list for the day Drashti is set up on the mandir's two computers: for the admin doing the setup, with the operators there for the parts marked **(operators)**. Tick each line as it is done, and fill in the "Write down" table at the end. The steps say what to do; `docs/admin-guide.md` says how, and `docs/parallel-run.md` has the first evenings beside ProPresenter.

ProPresenter stays installed and untouched all day. Drashti only reads its files.

---

## Before the day

- [ ] **The audit**, on both computers, if it has not been run yet: `tools/audit/README.md`. Run each script with `--collect` (Mac) or `-Collect` (Windows) onto a USB drive, and keep that drive with you: its copies are raw and can hold licence details and personal data.
- [ ] **The setup checklist** (`tools/audit/SETUP-CHECKLIST.md`), printed and filled in by the operators: the screen map, the features each sabha uses, the keys they rely on, the sound, streaming, Gujarati and Hindi text, and how they switch back.
- [ ] **The OS versions** from the audit reports: the Mac needs macOS 13 (Ventura) or later, the PC 64-bit Windows 10 or 11. If either is older, stop and decide what to do first; do not update a show computer's OS on the day.
- [ ] **Which computer is Main**, and whether the other is a node or a Main of its own (admin guide, section 1).
- [ ] **The network**: a cable between the computers if possible, and Main's address reserved in the router by whoever looks after the mandir's network (admin guide, section 8).
- [ ] **The installers**: the same Drashti version for both computers, and the version before it, on a USB drive.
- [ ] **A private or unlisted YouTube stream** ready in YouTube Studio for the stream test (never the mandir's public one).
- [ ] **Bring**: two USB drives (one stays plugged in for backups), the printed key card (end of `docs/parallel-run.md`), a notebook, the operators' presentation clicker and any MIDI controller.

## 1. Install (both computers)

- [ ] Install Drashti (`docs/parallel-run.md`, section 2). On the Mac, allow it once in **Privacy & Security**; on Windows, **More info**, **Run anyway**.
- [ ] On the first start, choose **Main** on the first computer, and **Node** on the second if it will be one.
- [ ] Write down the version on each, from the right of the status bar along the bottom of the window (a node's is in Main's screens dashboard, once it is paired). They must be the same.

## 2. Bring in the library (Main)

- [ ] Drag ProPresenter's folders onto the presentation list (`docs/parallel-run.md`, section 3), and any other folders the audit named.
- [ ] Read the report and **write down its numbers**: presentations, playlists, media, problems.
- [ ] **Media that could not be found** (the report's notice "… media files could not be found"): **Find missing media…**, and pick each folder the files are in (or **Find…** beside one file).
- [ ] **Media Drashti cannot play** (the notice "… media files Drashti cannot play"): **Convert all**, and let it finish in the background.
- [ ] **Legacy fonts** the report's notes name (under **Imported with notes**): install each font on **Main and on the node** (admin guide, section 11). Quit and start Drashti again, and look at a few of those slides.
- [ ] **PowerPoint, Keynote and PDF decks**: drag them in. Each page becomes a picture slide. The first time, macOS asks whether Drashti may control Keynote or Microsoft PowerPoint: **Allow**. If the report says there is no Keynote or PowerPoint here, or that one could not open a deck, save the deck as PDF and drag in the PDF.
- [ ] **Keynote and PowerPoint on this computer** (never tried on these machines before the setup). With a placeholder deck (a few slides of made-up words, one hidden slide, one with an animation, speaker notes on some), not one of the mandir's: drag it in, and check the report says which app saved it as PDF, counts the hidden slide and the animation, and that the slides' notes are right. Then check that the app closed again (or, if it was already open with something of yours, that it was left as it was). **On the Windows PC with PowerPoint** this is the first time it has ever run: also check PowerPoint showed no window, and drag in a deck while PowerPoint is open with an unsaved presentation: the presentation must still be there, unsaved. Write down how long the deck took (the log says, **Help**, **Save Diagnostics…**).
- [ ] **(operators)** Open five kirtans they know well and compare with ProPresenter: the words, the line breaks, the Gujarati and Hindi letters, the backgrounds.
- [ ] **Back up**: **File**, **Back Up Library…**, with the media, to the USB drive.
- [ ] **Scheduled backups**: **File**, **Scheduled Backups…**, onto the drive that stays plugged in (admin guide, section 5). Press **Back up now** once and check it finishes.

## 3. Screens and sound (Main, then the node)

- [ ] **The setup wizard** (**View**, **Set Up Screens…**): **Show each display's number on it**, then for each display what it shows and its languages, as the screen map in the checklist says.
- [ ] **Sound**: the output to the mixer, and **Play a test tone**. **(operators)** Check the mixer hears it on the right channel.
- [ ] Canvas sizes and scaling for any screen that is not 1920 × 1080 (an LED wall).
- [ ] **(operators)** **Looks**: the everyday Look first in the list, then any others they need ("Gujarati only", "Lower thirds").
- [ ] **(operators)** **Stage layout**: with the performers, the boxes they want on the stage screen.
- [ ] **Masks** for any screen that is not a rectangle, or a projector that spills.
- [ ] **Key and fill**, if the mandir's video switcher lays words over the camera: set the switcher's key to **pre-multiplied**, and check the words key cleanly over a camera.
- [ ] **The node** (if there is one): **Pair a node** on Main, give the node's displays their groups, and tick **Get everything ready** in the screens dashboard. In the screens dashboard, the node says **Online** and its media all ready.

## 4. The show's own things (Main)

- [ ] **The logo**: in **Props**, the stamp button beside the mandir's logo prop.
- [ ] **(operators)** Props, message templates and timers they use, from the checklist's "Features used".
- [ ] **(operators)** **Macros** for what they do together at one press (the arti, say), and any MIDI pads (**MIDI**, **Learn**).
- [ ] **The arti's times**, with the presentation that is the arti (admin guide, section 10).
- [ ] **The idle rotation**: pictures and quotes from authorised sources, and which screens show it.
- [ ] **Music** lists for before the sabha, and **markers** on any video or sound that needs a start or end point.
- [ ] **(operators)** **Markers brought over from ProPresenter**: open three or four videos or sounds that had start or end points (or markers) in ProPresenter, and check in their **Markers** that Drashti's are at the same times. They follow community notes on the file formats, never yet checked against the mandir's own files: write down any that are off.
- [ ] **Shastra texts** and **calendars**, if the mandir has prepared files from an authorised source.
- [ ] **Sabha templates**: replace the two examples with the mandir's real running orders.
- [ ] **(operators)** The keys: try their presentation clicker (Next, Back, Black-out). The keys are provisional until the checklist's "Keyboard shortcuts" section is read: write down any key they want different.

## 5. Phones and the network (Main)

- [ ] **Phones**, **Let paired phones and tablets connect**. Answer the firewall: **Allow** on the Mac; on Windows **Private networks** only, and check the mandir's network is set as private.
- [ ] Write down the address the Phones panel shows, and check it is the reserved one.
- [ ] Pair two or three phones as remotes, and a tablet as a stage display. Phones need Safari 16.4 or later (iOS 16.4) or Chrome on Android.
- [ ] Make the announcements poster, print it, and send one test announcement.

## 6. Roles and PINs (Main, and the node's Main settings)

- [ ] **File**, **Roles and PINs…**: an admin PIN and an operator PIN.
- [ ] Give the operator PIN to the operators; keep the admin PIN with the admins. **Never write a PIN in the shared notebook.**
- [ ] Check: quit and start Drashti; it opens in Simple Mode, and the operator PIN switches to Pro Mode.

## 7. The stream (the computer that streams)

- [ ] Stream settings: the key from YouTube Studio (pasted once; Drashti never shows it again), the camera, the mixer's line in, **Good** or **Weak internet** from a speed test. Then, in the Stream panel's recording part, **Choose a folder…** for the recordings.
- [ ] Write down the **Encoder** line the Stream panel shows (a graphics encoder such as VideoToolbox, NVENC, Quick Sync or AMF is best).
- [ ] **On the Mac that streams**: during the test stream, write down the frames a second the Stream panel shows (it should hold at the profile's 30). CI's Mac, a virtual machine, managed only about 9: a real Mac has never been measured.
- [ ] **Go live** on the unlisted stream for ten minutes while changing slides and playing a video. In YouTube Studio: the picture, the sound, the lips in time with the words (else raise **Sound delay**).
- [ ] End it, open the recording in VLC, and do it all a second time on another day before a real sabha.

## 8. The checks

On each computer:

- [ ] **The performance check**, twice (`docs/parallel-run.md`, section 11). Copy the second line into the table below. It should say `"passed":true`.
- [ ] **The performance check's video cases** (same section): `video-1080p30` and `dissolves-video` on every computer that shows video (Main and the node), and `masks-video` where a screen has a mask. In each line, "every screen showed 9 in 10 of the background video's frames" must say `"ok":true`, and the slide-change lines too, "the import overlapped at least 2 slide changes" among them (on a quick computer it passes with "nothing to judge": the import was over too soon to need it, and the slide-change lines judge the five changes from its start instead, saying how many came after it). A computer that keeps fewer than 9 in 10 frames needs a graphics chip that decodes video (admin guide, sections 1 and 13).
- [ ] **On the Windows PC: ahead of other programs, or level with them** (admin guide, section 13). Run `video-1080p30` and `dissolves-video` again with `$env:DRASHTI_PRIORITY = 'normal'`. Keep Drashti ahead (the default) unless the normal runs kept clearly more of the video's frames (with dissolves) and their slide changes still passed; then an admin unticks **File**, **Run Ahead of Other Programs** on that PC (press **Alt** for the menu). Write down which, and why.
- [ ] **The watchdog self-test**, on Main (admin guide, section 12): every line PASS.
- [ ] On the PC: **`docs/windows-checks.md`**, every line Pass, Fail (with what you saw) or N/A.
- [ ] **A video background on every screen** for a minute, with a dissolve to another: smooth on every screen, the node's too, and in step. The first video after installing or updating can stutter for a second while the computer prepares its graphics: put one up once before each first sabha.
- [ ] **The node in step**: a dissolve and a video side by side on Main's screen and the node's.
- [ ] **(operators)** **A whole sabha rehearsed**: in Pro Mode by an operator, and in Simple Mode by a volunteer who has not used Drashti before. Write down anything they found hard.
- [ ] **By keyboard alone** in Simple Mode: Tab to each big button, and Enter.
- [ ] **A screen reader**, if anyone at the mandir uses one (this needs a person who uses it every day): VoiceOver on the Mac (**Cmd+F5**) or Narrator or NVDA on Windows. Check the regions are announced (header, playlists, library, slides, live, show controls, status), the buttons say what they do, the dialogs say their names, and Simple Mode's buttons can be found and pressed. On a phone, VoiceOver or TalkBack on the remote: Next and Back, and the tabs.
- [ ] **On the Windows PC: Windows' own text size at 200%** (Windows 11: **Settings**, **Accessibility**, **Text size**; Windows 10: **Settings**, **Ease of Access**, **Display**, **Make text bigger**; 200%, then **Apply**): the operator window's buttons, lists and dialogs still fit and can be read, and nothing is cut off. Set it back afterwards if the operators prefer.
- [ ] **The fallback drill**: the named fallback operator quits Drashti and opens ProPresenter. Time it: it should take under a minute.

## Write down

Keep this with the notebook. Never the PINs, the stream key or pairing codes.

| What                                                          | Main | Node / second computer |
| ------------------------------------------------------------- | ---- | ---------------------- |
| Computer, OS version                                          |      |                        |
| Drashti version                                               |      |                        |
| Main or node                                                  |      |                        |
| Address (reserved in the router), and the `.local` name       |      |                        |
| Each display: which output, which screens, canvas size        |      |                        |
| Sound output to the mixer                                     |      |                        |
| Import report: presentations, playlists, media, problems      |      |                        |
| Missing media left, files converted                           |      |                        |
| Legacy fonts, and where installed                             |      |                        |
| Performance check, second line                                |      |                        |
| Video cases: frames shown (1080p30 / dissolves / masks)       |      |                        |
| Windows: ahead of other programs, or normal (and the figures) |      |                        |
| Watchdog self-test result                                     |      |                        |
| Windows checks: any Fail                                      |      |                        |
| Stream: encoder, internet preset, test dates and how it went  |      |                        |
| Node: round trip and clock in the dashboard                   |      |                        |
| Phones and tablets paired (owner, model, OS)                  |      |                        |
| Where the backups drive is, and the scheduled time            |      |                        |
| Who holds the admin PIN (not the PIN)                         |      |                        |
| Named fallback operator, and the drill's time                 |      |                        |
| Keys the operators want changed                               |      |                        |
| Anything different from ProPresenter, with the time           |      |                        |
