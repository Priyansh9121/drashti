# What changed in Drashti

Each version, newest first. A version's section is what Help › Check for Updates… and its release page show, so it is written for the people who run Drashti, in plain words: only "- " lists, no other formatting, and at most 4,000 characters. Changes not released yet wait under Unreleased, at the top; a release gives them their version's heading.

## Unreleased

Easier for volunteers' hands, in today's look.

Playlists

- Build a playlist without dragging: choose a presentation, a picture or video, or a Shastra passage in the library and press Add to playlist beside it, or choose Add to the playlist in its menu (right-click). It goes after the playlist's chosen item, or at the end.
- Move a playlist item with the Up and Down buttons beside it, or with Alt+↑ and Alt+↓ (Option on a Mac). Dragging still works.
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

- In a menu, the choice the keyboard is on now shows the focus ring. Closing a menu puts the keyboard back where it was, and Esc in a menu closes only the menu, even in the slide editor.
- The edges of secondary and danger buttons are stronger, so every button's edge can be seen on every panel.
- Playlist headers and library names are shown as they were typed, no longer in spaced capitals, which broke Hindi and Gujarati letters.

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
