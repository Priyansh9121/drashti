# What changed in Drashti

Each version, newest first. A version's section is what Help › Check for Updates… and its release page show, so it is written for the people who run Drashti, in plain words: only "- " lists, no other formatting, and at most 4,000 characters. Changes not released yet wait under Unreleased, at the top; a release gives them their version's heading.

## Unreleased

Import from a Link

- A Dropbox folder link becomes one playlist, named after it, folder by folder: each folder's videos, then its PowerPoint files, A to Z, a header for each folder inside. Its PDFs and pictures wait for Add the PDFs and pictures.
- A Dropbox folder link unpacks now. Dropbox's zips list an empty entry named "/", and Drashti refused the whole folder for it ("would leave the folder"); that entry is skipped, and everything that would really leave the folder is still refused.

Playlists

- Repeat Slides: a playlist whose pictures and slides go round by themselves, the last back to the first (15 s each with a 1 s fade, to begin with). Esc or Stop ends it and the slide stays up; black-out and the logo cover it while it goes on. Any slide can now come on by Fade through black, Slide or Slow zoom too.
- A smart playlist follows a folder on the computer: + New › Smart Playlist from a Folder…. What Drashti imports as media or pictures there, subfolders too, joins it by itself, in the folder's order. A file taken away is marked, not removed (one button takes the missing out); a changed one replaces its item; a folder that is gone (a USB stick taken out) is said so, and the playlist carries on when it is back.
- Dragging into a playlist is surer: rows no longer change size as a drag starts, which could cancel it. Search results can be dragged in too.
- Files dragged from the Finder (Explorer on Windows) onto the open playlist, or onto a playlist's name, are imported and added where they land, in the order dragged.

Library

- The library starts plainer: no Shastra tab, no Templates beside the playlists and no kirtan filters. An admin brings them back with View › Show Shastra, Templates and Kirtan Details. Nothing in them is lost, and search still finds kirtans by kavi, raag and occasion.
- Import… is a button under the search box now: Files…, A Folder… or From a Link…. Files… offers everything Drashti imports.
- A PDF, PowerPoint or Keynote file's pages no longer fill the Media list: they are its presentation's slides. Media lists the pictures, videos and sounds you imported.

The operator window

- Built round playlists: the playlists at the top left, always there; the open playlist in the middle, its items as cards (a picture, what it is, its length or slides), with Add files… and From a Link…; the chosen item's slides under it.
- On the right: LIVE, Audio (Music and the Arti together), the stage screen, messages, timers (one tidy line each, running ones first), props, Looks, and More tools (macros, masks, the idle rotation) folded away.
- The live picture is headed LIVE, and the Next picture under it is gone. What comes next still shows on the stage screen, on phones and tablets, and in Simple Mode.
- Edit layout… on the Stage screen panel opens the stage layout editor at the layout in use.
- After an import, the report's Add to playlist puts everything it brought in into the open playlist, another, or a new one named after it. Import from a Link asks the same before Download, the open playlist to begin with.

Deleting

- A trash button on the chosen row (and the one under the mouse) deletes a playlist, a presentation, a picture, video or sound, or music, as the Delete key does, and takes an item out of a playlist or a sound out of music. Undo brings each back.
- Pictures, videos and sounds can be deleted now. Drashti first says where one is used; it leaves playlists and music, and slides show nothing in its place. Its file goes when Drashti next starts.

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
