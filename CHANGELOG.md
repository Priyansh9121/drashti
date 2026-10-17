# What changed in Drashti

Each version, newest first. A version's section is what Help › Check for Updates… and its release page show, so it is written for the people who run Drashti, in plain words: only "- " lists, no other formatting, and at most 4,000 characters. Changes not released yet wait under Unreleased, at the top; a release gives them their version's heading.

## Unreleased

- What is this? cards now have Read more, which opens the guide at the passage they come from; there is a ? beside Next and Back, the show controls, the open playlist, Stream, Phones, Announcements, the status bar, Audio and More tools too.
- Help › Guides… opens the operator's, presenter's, admin's and setup day's guides inside Drashti, with their pictures, without the internet; search finds every passage that holds the words you type, after answers to questions such as "When a screen is black or frozen, what do I do?". Simple Mode shows the operator's and presenter's.
- The computer stays awake while the stream is on air or recording, even with no hall screen showing.
- If the stream's own page keeps failing, Drashti stops restarting it after the sixth time in a minute and says so, with Try again, in Simple Mode too; a hall screen whose page fails to load is logged and loaded again at once.
- After Drashti stops unexpectedly, the next start stops a conversion, Save as MP4, YouTube download or PowerPoint it had started that was left running, and removes the half-saved file; your own programs are never touched.
- A conversion or Save as MP4 that FFmpeg gets stuck on stops after four times the video's length and 5 minutes more, saying so plainly, and reading a file stops after 30 seconds; FFmpeg only ever opens files.
- A limiter keeps the stream's and recordings' sound under full scale, so a loud desk, or Drashti's own sound mixed in, never clips; quieter sound passes as it is, and the meter still shows the mix as it comes.
- A long recording goes on in parts of 3.5 GB, each playing on its own, so a USB stick never cuts a sabha's recording short; Drashti says so when the recording folder is on a FAT32 drive or its disk has room for less than an hour.
- On air or recording, the header says No sound, beside ON AIR and REC and in Simple Mode too, when nothing has reached the stream for 20 seconds, or 3 seconds after its microphone is unplugged; a notice says what to check. It goes when sound is back, and Drashti never changes the microphone itself.
- Choosing the stream's camera and sound input quickly, or just as it goes live, no longer leaves it on an older choice: the newest always wins.

## 1.0.0-alpha.5 (16 Oct 2026)

Diya, Drashti's own look, with Next and Back under the live picture and a welcome on the first start; a Bold Movement for any Look; and new connections an admin can turn on. What the hall's screens show only changes where an admin chooses. Update after a sabha, never on the day of one.

- The operator window, Simple Mode and the phone pages take the lamp's colours: plum-black panels, warm text, the next thing to do in plum. Live, ON AIR, warnings and errors keep theirs; the hall's screens do not change.
- The live picture and the live slide glow red beneath, at once, as their red border does.
- Dialogs, menus and notices rise gently into place, and a playlist item moved Up or Down slides there. Next, Back, Clear all, Black-out and Logo still change at once, and with Reduce motion on nothing in the window moves.
- In a show, Next and Back sit under the live picture with their keys: Next is the one plum button and does exactly what → does. Clear all stays where it was, with F1.
- Closing something with typed changes: Save changes has the focus (Enter saves), unless saving would change what the screens show now (then Keep editing has it). Throwing work away is never the default.
- A backup warning offers Back up now.
- When a hall screen stops (it kept failing), a red notice at the top of the window names it, in Simple Mode too, with Try again; it goes when the screen is back.
- Each screen group's Look has a Movement: Calm, as before, or Bold, set by an admin in Screens.
- New transitions: Wipe, Push and Zoom, which move only the words on Bold screens (others fade), and Line by line and Word by word (never word by word on a kirtan's slides). Pictures only ever fade, and Fade itself now eases in and out.
- Drashti's own default transition keeps the kind you choose; it used to keep only Fade or Cut.
- Lower thirds come in, keep their box while the words change, and fade out when their slide is cleared on its own; Clear all still clears at once.
- Messages and the ticker's band come in gently (rising, on Bold screens); changing a message's words never plays it again.
- The idle rotation dissolves evenly, and a prop's or the logo's video plays in step on every screen, even one opened later.
- Stream to up to three places at once (YouTube, Facebook, another platform), each with its own key, with a Several platforms preset; ON AIR says how many are on air, and one dropping never stops the others.
- The stream key never shows in Drashti's log, and FFmpeg gets only what it needs from the computer.
- The drop folder (File › Drop Folder…): pictures and videos put in it come into Media by themselves once fully copied, under a From the drop folder filter. They wait while on air or recording, as smart playlists now do.
- Events out (File › Events Out…): Drashti can tell a program on your network, such as n8n, what happens in the show, signed. Nothing is sent until an admin chooses, and the words only if asked.
- Before a screen first shows the show it quietly prepares every transition, unseen (it stays black), so the first Bold push of a sabha never stutters.
- A sharpened picture is sharpened at the size the hall's largest screen shows it (an output computer's included), and again when the screens change size.
- An update is checked again before it installs, and only a newer version installs (a node matching Main's excepted).
- On the phone remote, Black-out and Logo say "Black-out is on" and "Logo is on" while on, as on the computer.
- New Chorus and Verse groups are teal and indigo, never red, so nothing looks like LIVE; yours keep their colours.
- A new library starts with a welcome: Set up the screens, Try a practice show first (placeholder slides on this screen only), or Skip for now, which shows three steps to a sabha.
- Drashti's lamp sits beside its name in the window, in Simple Mode and on the phone remote; an empty place shows it unlit.

## 1.0.0-alpha.4 (15 Oct 2026)

Drashti built round playlists: Repeat Slides, smart playlists, Dropbox folders as playlists, a video timeline and the Picture editor. The window has changed, so the operator guide shows where everything is now. Update after a sabha, never on the day of one.

The operator window

- Built round playlists: the playlists at the top left; the open playlist in the middle, its items as cards, with Add files… and From a Link…; the chosen item's slides below. On the right: LIVE (no Next picture under it), Audio (Music and the Arti), the stage screen with Edit layout…, messages, tidier timers, props, Looks, and More tools folded away.
- The library starts plainer: Shastra, Templates and the kirtan filters come back with View › Show Shastra, Templates and Kirtan Details. Import… (Files…, A Folder…, From a Link…) sits under the search box, and a deck's pages no longer fill the Media list.

Playlists

- Repeat Slides: pictures and slides that go round by themselves (15 s each with a 1 s fade, to begin with). Esc or Stop ends it and the slide stays up; black-out and the logo cover it while it goes on. Any slide can now come on by Fade through black, Slide or Slow zoom too.
- A smart playlist follows a folder on the computer: what goes into it joins by itself, in the folder's order. A file taken away is marked, a changed one replaced, and a folder that is gone (a USB stick taken out) is said so.
- A Dropbox folder link unpacks now (Dropbox's zips hold an empty "/" entry, which was refused), and becomes one playlist, folder by folder with a header for each; its PDFs and pictures wait for one button.
- Dragging into a playlist is surer, search results can be dragged too, and files dragged from the Finder or Explorer onto a playlist are imported into it. After any import, Add to playlist puts what it brought into a playlist.

Screens

- Screens opens with three cards: the projector, the stage screen and YouTube (the stream), each with a small preview and what it shows. YouTube's card holds the stream's layout, camera, sound input and languages, the same settings the Stream panel shows (now with the languages too) and the setup wizard sets. Opening Screens starts nothing.

Themes

- Ten built-in themes beside Drashti default (Midnight, Plum and Flame, Saffron, Maroon and Gold, Forest, Ocean, Ivory, Charcoal and two high-contrast ones), every word at least 7:1 against its background; changing one makes a copy. Themes shows each as a preview, and applies one to a playlist's presentations or makes it the default for new ones.

Deleting

- A trash button on the chosen row deletes a playlist, a presentation, media or music, as the Delete key does, with Undo. Pictures, videos and sounds can be deleted now: Drashti first says where one is used.

Importing

- Lyrics in a Word document (.docx) import as a text file's do: each paragraph a line, an empty paragraph a new slide, Gujarati, Hindi and English as written. Formatting, pictures and tables are left out, and the report says so. An old .doc says to save it as .docx first.

Pictures and videos

- The Picture editor: zoom, move, brightness, contrast, colour, sharpness and Auto, kept with the picture, so it looks the same on every screen, node, the stream and the thumbnails (the file is never changed). From LIVE, zoom the picture on the screens for that showing; Keep this zoom saves it.
- Sharpness is made once per picture: a sharpened copy, made in the background after Save, is what every screen, node and phone shows, so a sharpened picture comes up at once on any computer. Until the copy is ready the picture shows unsharpened.
- A video's start and end on a timeline, and Save as MP4…: that part saved as its own file, copied as it is (the picture and sound unchanged) from the clean frame at or just before the start, which it names first.

## 1.0.0-alpha.3 (11 Oct 2026)

Downloading from YouTube, inside Drashti and with no adverts. Update after a sabha, never on the day of one.

Import from a Link

- YouTube can be picked now: paste a video's Share link, see its title and length, and save it as MP4 (choosing its quality) or MP3 (its sound only), in the folder you choose; then it is imported as any file is. Tick "This video is the mandir's own, or its owner allows us to use it" each time before Download. Qualities above Highest video quality are shown but cannot be picked.
- A downloaded video holds no adverts, and Drashti asks no outside service about it. Drashti never signs in to YouTube: a private, members-only or age-restricted video says so, and the mandir's own can still be downloaded in YouTube Studio.
- A YouTube download waits while on air or recording, and one already going stops and carries on afterwards. If YouTube changes how it sends videos, a newer Drashti may be needed.
- Looking at a YouTube link waits while on air or recording too, as a download does, and goes on by itself afterwards. Looking at a Dropbox link is as before.
- A new admin setting in File › Import from a Link…: Highest video quality (1080p, 1440p, 2160p (4K) or 4320p (8K)), 1080p to begin with. It is kept with the library, so a backup keeps it. A Dropbox video taller than it is imported as a copy that tall, as 1080p videos were before; the original stays in the folder as it came.
- The import report of a download says which videos the library has as a smaller copy. With the Import from a Link dialog open, the report waits for See the import report instead of opening over the dialog.

## 1.0.0-alpha.2 (11 Oct 2026)

Easier for volunteers' hands, and importing from a Dropbox link. Update after a sabha, never on the day of one.

Playlists

- Build a playlist without dragging: choose a presentation, a picture or video, or a Shastra passage in the library and press Add to playlist under it, or choose Add to the playlist in its menu (right-click). It goes after the playlist's chosen item, or at the end.
- Move a playlist item with the Up and Down buttons under it, or with Alt+↑ and Alt+↓ (Option on a Mac). Dragging still works.
- Undo now takes back adding and moving playlist items, one step at a time.
- Looks, macro actions, music tracks, idle pictures and a screen's languages now say Up and Down, not Earlier and Later.

Typed changes

- Closing Edit words, the Kirtan dialog, playback markers or a theme with changes not saved now asks first. So do the setup wizard with PINs typed, and the slide, macro, stage layout and mask editors, which asked before with two buttons.
- The question is the same everywhere: Keep editing (what Enter and Esc do), Save changes, or Throw them away. It says how much would be lost.
- When the presentation being changed is on the screens, the question says so: saving then changes the screens at once.

Show controls

- Next, Back, Black-out, Logo, Clear all, Put it back and the clears now change in the same moment as the screens, with no fade. The live slide's border, and the scroll to bring it into view, are instant too.
- Simple Mode now says Black-out, as Pro Mode and the phones do, and all three show it with the same picture, a filled screen. On a phone, Clear all now shows the eraser, as in Pro Mode.
- A screen reader hears whether Black-out and Logo are on once, not twice.

Menus, buttons and names

- In a menu, the choice the keyboard is on now shows the focus ring. Closing a menu puts the keyboard back where it was, and Esc in a menu closes only the menu, even in the slide editor. While a menu is open, the arrow keys and Space work the menu, never the slides.
- The edges of secondary and danger buttons are stronger, so every button's edge can be seen on every panel.
- Playlist headers and library names are shown as they were typed, no longer in spaced capitals, which broke Hindi and Gujarati letters.

Phones and tablets

- On the remote, the announcements page and the stage display, two quick taps never zoom the page, and pulling down at the top never reloads it.
- Every button and field on a phone's page is now at least 44 pixels each way, including Show notes, the music and marker buttons, and Dismiss.
- The remote's words are larger, 16 pixels or more, apart from the tab bar's labels and the small LIVE-style badges.
- In the operator window, a notice's Dismiss is a larger target.

Import from a link

- File › Import from a Link… (or Import, then From a link…) saves a Dropbox file or folder in a folder you choose, then imports its PowerPoint files and MP4 videos; everything else stays in the folder. Downloads wait while the stream is on air or recording, and carry on if you close the window. YouTube is shown but not offered yet.
- A Dropbox video above 1080p goes into the library as a 1080p copy; the original stays in the folder as it came. The import report says where the files were saved, with Show in Finder (Show in Explorer on Windows).

Help

- Help › Keyboard Shortcuts… (or the ? key) lists every key, grouped by what you are doing, as your computer writes them. The keys may still change after the setup day.
- A small ? on each panel's heading in Pro Mode says what the panel is for and what to do first, in two or three sentences.
- Error messages now say what to do next, in plain words: for example "The drive is full: free some space, or choose another drive." They no longer show the computer's own error codes or "Something went wrong" alone, and a phone is told to try again or tell the operator.

## 1.0.0-alpha.1 (10 Oct 2026)

Fixes for streaming from a Mac, for quitting while on air, and for screens that go blank or stop. Update after a sabha, never on the day of one.

Streaming and quitting

- A Mac can now go live to YouTube. In 1.0.0-alpha.0 the Mac could not check YouTube's secure connection, so the stream never went on air. Windows was not affected.
- If the stream server's certificate cannot be checked, the Stream panel now says so in plain words, instead of saying the connection dropped.
- Quitting while the stream is on air or recording now ends the stream, stops the recording and quits. Before, Drashti could keep running with no window, still on air and recording.
- The quit question now says when the stream is on air or recording, and what will stop.
- After a quit on purpose, Drashti starts again off air and not recording. Only after a crash does the stream come back by itself (within 5 minutes, as before).

Screens

- A screen that fails while drawing now goes black and comes back by itself, instead of staying blank for the rest of the sabha. If the operator window fails, it offers to reload itself, without touching the screens.
- A screen that freezes is now noticed and restarted.
- A screen Drashti has given up on is tried again after 2 minutes, then every 10 minutes. Meanwhile it shows as Stopped in Screens and the status bar, with Try again.
- Dissolves no longer dim, flash or start from black: when slides change quickly, a background dissolving in carries on to its end; a slide still loading its pictures never flashes up; and a screen that opens part-way through a dissolve shows the background whole.

Starting up, and output nodes

- After an unexpected stop 3 hours or more before Drashti starts again, it now starts as after a normal quit (in Pro Mode, or Simple Mode when PINs are on), not in Simple Mode.
- If the file that lets the nodes recognise Main is damaged, Drashti no longer quietly makes a new one, which stopped every node following. It says so when it starts, and Screens › Nodes offers Make a new identity… (an admin's); then pair each node again.
- A computer that cannot read whether it is Main or a node now starts as what it last ran as, and says so, instead of waiting at a question with nobody there to answer it. A node that cannot read its pairing says so in its window.
- Some rare errors when quitting during an import, or with a node paired, are fixed.
- In Drashti's log, a hidden stream key now reads [stream key] once, not "[stream key] key]". The key itself was never written.

Updating

- Windows: Download, then turn on "Install it when Drashti quits". It installs as Drashti quits after the sabha.
- Mac: Download, then Show the file. After the sabha, quit Drashti, open the file and drag Drashti into Applications.
- Update the output nodes to the same version the same evening.

## 1.0.0-alpha.0 (9 Oct 2026)

The first release of Drashti, for trying it at the mandir beside the presentation software already in use.

- Installers for Macs (Apple silicon and Intel) and for Windows.
- Help › Check for Updates… finds later versions.
