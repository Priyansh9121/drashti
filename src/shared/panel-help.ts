import type { GuideId } from './guides';
import type { ManualChapterId } from './manual';

/*
 * "What is this?" on each operator panel (Session 25): two or three plain sentences saying what the
 * panel is for and the one thing to do first. All the words are here, in one place; each names the
 * passage of a guide it comes from (the operator's, docs/operator-guide.md, unless it says another): a unit test
 * checks each passage is still there, just once, and that every panel has its words. Each names its chapter of the
 * Drashti Manual too, and the feature there (x37, Session 60), which its Open the manual opens (Read more opened the
 * guide's passage until then, Sessions 31–36); src/main/manual.test.ts checks each is there, once. Pro Mode only.
 */

export interface PanelHelp {
  /** The panel's name, as its heading says it. */
  title: string;
  /** Two or three sentences: what it is for, and the one thing to do first. */
  text: string;
  /** The guide it follows. */
  doc: GuideId;
  /** Words of that guide's passage it follows (it must still say them, once). */
  guide: string;
  /** The Drashti Manual's chapter for it (x37, Session 60), which its "?" opens… */
  chapter: ManualChapterId;
  /** …at this feature (the chapter's level-2 heading, as written: once in that chapter). */
  feature: string;
}

export const PANEL_HELP = {
  playlists: {
    title: 'Playlists',
    chapter: 'playlists',
    feature: 'Playlists and folders',
    doc: 'operator',
    text: 'A playlist is the running order for one sabha. Click tonight’s playlist to open it in the middle, then click its first row: a slide, a picture, a video or a sound goes on the screens at once. While a phone or tablet is paired as a remote, right-click a playlist for Share with Phones and Tablets: remotes then show its files under Shared from Drashti until you choose Stop Sharing.',
    guide: "**Open tonight's playlist.**",
  },
  library: {
    title: 'The library',
    chapter: 'library',
    feature: 'The library',
    doc: 'operator',
    text: 'Every presentation, picture, video and sound on this computer: type a few letters of a kirtan’s title or words in the search box to find it, then press Add to playlist. Import… brings more in, into the library only, as do files and folders dropped anywhere here (From a Link… takes a pasted YouTube or Dropbox link, into the open playlist too), and a file Drashti can’t play says Converting… until Drashti has converted it by itself, once nothing is up or playing. In Media, one click puts up a video input (named with Add a Video Input…, in its Video inputs section under LIVE); right-click it, or drag it, to put it in a playlist instead.',
    guide: 'the **Library**',
  },
  slides: {
    title: 'Slides',
    chapter: 'editor',
    feature: 'Edit slides…',
    doc: 'operator',
    text: 'With no playlist open, these are the chosen presentation’s slides: click a row to put it up, press Space for the next one, or type its number and press Enter. Edit slides… opens its own window, with Words, Insert, Arrange, Design, Motion and Slides, while the operator window keeps the show controls. Save waits for pending media and protects unfinished typing; its saved change has one operator Undo.',
    guide: '**Edit slides opens its own window.**',
  },
  live: {
    title: 'LIVE',
    chapter: 'live',
    feature: 'LIVE',
    doc: 'operator',
    text: 'What the hall sees this moment: a picture up there zooms on the screens as you scroll or pinch over it, moves as you drag it, and goes back as it was kept with a double-click. Under it, each video or sound playing has a time bar, with Play or Pause: a click moves it there on every screen at once, and a drag moves a video’s picture with your finger, playing on from where you let go; with the keyboard on it, the arrows move 5 s, Page Up and Page Down 30 s, and Home and End to its start and end. Back 15 s and Forward 15 s jump the background video or a single sound, and a picture in picture has its own line there, with Swap and Take off; drag its box in LIVE to move it.',
    guide: 'headed **LIVE**',
  },
  lowerthirds: {
    title: 'Lower Thirds',
    chapter: 'tools',
    feature: 'Lower Thirds',
    doc: 'operator',
    text: 'A name, a title and a place across the bottom of the hall’s screens, the stream or both. Studio and New… open the Lower Thirds studio, a window with a live preview: the words, the style they sit in, the font and colours, how it comes in and goes out, a moving background, and whether it hides itself after a few seconds. Show puts it up and Hide takes it off again.',
    guide: '**Lower Thirds.**',
  },
  stage: {
    title: 'Stage screen',
    chapter: 'stage',
    feature: 'The stage screen',
    doc: 'operator',
    text: 'What the speaker and the singers see, never the hall: Layout chooses the one layout every stage screen shows, and Video input the input its video box shows. A message for them, such as “Two minutes left”, goes on every stage screen with Show, in its own size and with a flash if ticked, and off with Hide; the last few are a tap away, and the layout’s timers (with what each counts to) and a timer for the audience start, show and hide here too. Edit layouts… makes, renames and deletes layouts, each with Undo, and New from a Template… makes a ready-made one, such as Pravachan and anchoring; with Stage off every stage screen shows exactly the audience picture.',
    guide: '**The stage message.**',
  },
  messages: {
    title: 'Messages',
    chapter: 'messages',
    feature: 'Messages',
    doc: 'operator',
    text: 'A message for the hall’s screens, such as “Car 12 please move”, keeps its own look: where it sits (drag it in the small picture), how it comes in and goes out, how long it stays up, and its font, size, colours and what is behind it. Fill in its fields and press Show; Take off removes it, and Undo brings back a change or a deleted message.',
    guide: '**Messages.**',
  },
  chat: {
    title: 'Chat',
    chapter: 'phones',
    feature: 'The chat',
    doc: 'operator',
    text: 'One group chat for this computer and the phones paired with it on the mandir’s Wi-Fi, kept for today only and never on the screens or the stream. Type in the box and press Send to write as Operator; while it is folded, its heading shows how many new messages came in. For more people, show the Chat QR code in Phones; Clear chat empties it for everyone, and Remove… beside a person cuts their phone off.',
    guide: '**Chat.** In **Chat**',
  },
  timers: {
    title: 'Timers',
    chapter: 'messages',
    feature: 'Timers',
    doc: 'operator',
    text: 'Countdowns and clocks. Press Start, then Show for the audience to put one up on the hall’s screens in its own look (How it looks for the audience…: full screen or a corner, over the wallpaper or over what is up, a label, a ring or a bar, a warning, and what it does at zero), and Hide to take it off; Countdown to the start… counts down to the sabha’s time over the wallpaper, on the stage too, and goes by itself. The stage screens show every running timer by themselves, or, with a layout of their own, the timers in it.',
    guide: '**Timers.**',
  },
  wallpapers: {
    title: 'Wallpapers',
    chapter: 'playlists',
    feature: 'Wallpapers',
    doc: 'operator',
    text: 'The pictures the hall sees whenever nothing is up: click one to use it, and click it again to use none (black). Drop pictures here, from the computer or from Media, or press Import…; pictures dropped on a wallpaper go round in it, each fading into the next. Its right-click menu has Edit wallpaper… (their order, seconds and fade), Rename… and Delete…, each with Undo.',
    guide: '**Wallpapers.** Under the playlists',
  },
  sabhaflow: {
    title: 'Sabha flow',
    chapter: 'playlists',
    feature: 'Sabha flow',
    doc: 'operator',
    text: 'The sabha’s running order, from a PDF, for this window and a paired phone only: it never goes on the screens. Choose PDF… reads its numbered items in its own language, English, Gujarati or Hindi; click a row, or press Next, to mark Now, and Next up shows the item after it. A scanned PDF, or one whose letters come out wrong, says so and shows only its page.',
    guide: '**Sabha flow.** At the top of the left column',
  },
  playlist: {
    title: 'The open playlist',
    chapter: 'playlists',
    feature: 'The open playlist',
    doc: 'operator',
    text: 'The playlist you opened is where things go live: one click on a row puts it up, and a presentation’s, deck’s or PDF’s name folds its slide rows; type a row’s number and press Enter to put it up. Cmd-click (Ctrl-click on Windows) only marks a row; drag or Alt+Up/Down moves it, within its deck on a slide row, and its menu has Rename, Remove and Undo; the playlist’s ⋯ has Duplicate and Practise this playlist. A video input from Media can be a row too: without that named input on this computer it says Not on this computer and Next goes past it.',
    guide: '**Middle:**',
  },
  controls: {
    title: 'Show controls',
    chapter: 'live',
    feature: 'Clear all and the clear buttons',
    doc: 'operator',
    text: 'Clear all, the layers’ clear buttons in the order of their keys, the Wallpaper and Black-out, each with its key; a button with nothing of its own up is dimmed, so what is on the screens shows at a glance. Each changes the hall’s screens at once: the Wallpaper puts the chosen wallpaper up instead of the picture, and Put it back, straight after Clear all, brings back what it took off. One thing at a time: a slide, picture or video put up takes the Wallpaper and Black-out off, and either going on takes the other and a video off.',
    guide: '**Covering and clearing:**',
  },
  nextback: {
    title: 'Next and Back',
    chapter: 'live',
    feature: 'Next and Back',
    doc: 'operator',
    text: 'Next puts up what comes next in the open playlist, as Space or the right arrow does; the small picture beside it shows what that is. Back goes to the slide before, as the left arrow does. Oops (F9) puts back what was on the screens before the last change, one step a press.',
    guide: '**Next** or **Back** under LIVE',
  },
  stream: {
    title: 'Stream',
    chapter: 'stream',
    feature: 'The Stream panel',
    doc: 'operator',
    text: 'The stream from this computer to YouTube or another platform: what it shows, going live and recording. ON AIR and REC in the header say when it is public and when it is being recorded. Window for Zoom… shows the same picture in a window of its own, for Zoom to share.',
    guide: '**The stream** (only on the computer that streams',
  },
  phones: {
    title: 'Phones',
    chapter: 'phones',
    feature: 'Phones and tablets',
    doc: 'operator',
    text: 'Phones and tablets on the local Wi-Fi pair as a remote, stage display or for announcements: in Pro Mode turn on Let paired phones and tablets connect, then check Connected. A remote shows playlist slide rows, menus, protected show swipes and wallpapers; in Simple Mode it opens and changes any playlist, with Pause, Play, the time bar and Audio, and refuses Pro-only actions. Phones and tablets may add files allows Add from this Phone… into Added from Phones and Add photos into the ordinary playlist open in Pro Mode; in Simple Mode a phone’s files go to the end of the playlist open on the computer, but a video or sound goes into Added from Phones when that playlist is a Repeat Slides one, and nothing a phone adds goes live by itself.',
    guide: '**Phones** (if a phone remote or a stage tablet is used)',
  },
  announcements: {
    title: 'Announcements',
    chapter: 'phones',
    feature: 'Announcements from phones',
    doc: 'operator',
    text: 'Announcements sent from paired phones, waiting for you. Read each one, fix a typo with Edit, then Approve it into the ticker or as a message, or Reject it.',
    guide: '**Announcements from phones.**',
  },
  statusbar: {
    title: 'The status bar',
    chapter: 'start',
    feature: 'The status bar',
    doc: 'operator',
    text: 'What Drashti is doing: the screens, the sound output (and in red Audio muted or Video muted while one is, or at 0 %), imports and warnings, and its version; a bar under the top bar says when your access to Drashti ends, from 7 days before. A warning in yellow says what to look at: Audience off means this computer’s hall screens are switched off, and Stage off that its stage screens show the audience picture; Turn on brings them back where they were, asking nothing. A display plugged in sets itself, said in a line under the top bar; when a change made by hand puts a screen on the display with these controls, Keep these screens? undoes it in 15 seconds unless you press Keep.',
    guide: '**Along the bottom:**',
  },
  audio: {
    title: 'Audio',
    chapter: 'audio',
    feature: 'Audio playlists',
    doc: 'operator',
    text: 'Audio playlists to play before the sabha, listed here: + makes one or imports sounds, and sounds dragged onto one go in. Play starts a list, and a click or a drag along its time bar moves in its track, as Back 15 s and Forward 15 s do (small icons in the row with Play and Pause). Clear audio along the bottom, or F5, stops whatever sound is playing; under a video with sound, or a slide’s or a deck’s own sound, the music steps aside (the switch below the lists), and each video and sound plays at an even loudness (right-click one to play it as it is).',
    guide: '**Audio.** In the right column',
  },
  // Each tool's own section under LIVE (alpha.22: More tools went), in their order there.
  showwindow: {
    title: 'Show a Window',
    chapter: 'tools',
    feature: 'Show a Window',
    doc: 'operator',
    text: 'Another app’s open window (a Zoom meeting, say), live on the hall’s screens as the background. Open that window first, then press Show a Window… and choose it by its name and its small live picture; nothing goes up until Show on the screens.',
    guide: 'Open the **Show a Window** section',
  },
  streamlink: {
    title: 'Show a Stream Link',
    chapter: 'tools',
    feature: 'Show a Stream Link',
    doc: 'operator',
    text: 'Another mandir’s live webcast, from an HLS link or a YouTube live stream’s link, on this computer’s hall screens as the background, with its sound in the hall. Press Show a Stream Link…, paste the link and press Show on the screens; Drashti’s own stream shows the Wallpaper while it is up.',
    guide: 'Open the **Show a Stream Link** section',
  },
  videoinputs: {
    title: 'Video inputs',
    chapter: 'tools',
    feature: 'Video inputs',
    doc: 'operator',
    text: 'A camera or capture input on this computer (the video mixer’s USB output, say), named once and then one click away in Media. Press Add a Video Input…, choose it by its small live picture and give it a name; nothing goes up until you click it in Media.',
    guide: 'the **Video inputs** section under LIVE',
  },
  pip: {
    title: 'Picture in Picture',
    chapter: 'tools',
    feature: 'Picture in Picture',
    doc: 'operator',
    text: 'Something small in a corner of the hall’s screens while the main picture carries on: the slides, a video input, a picture or video, or another app’s window. Press Picture in Picture…, choose what goes in the box, where it sits and its size, then press Show in the box.',
    guide: 'Open the **Picture in Picture** section',
  },
  qrcode: {
    title: 'QR code',
    chapter: 'tools',
    feature: 'QR code',
    doc: 'operator',
    text: 'A slide with a large code that phones can scan, made on this computer with no internet, or the code saved as a picture. Press QR code…, paste a link or type words, check the code, then press Make the slide or Download….',
    guide: '**A QR-code slide.**',
  },
  midi: {
    title: 'MIDI controller',
    chapter: 'tools',
    feature: 'MIDI controller',
    doc: 'operator',
    text: 'A pad, keyboard or foot switch that runs Next, Back, Clear all, Black-out and the Wallpaper, in Simple Mode too. Plug it in, press MIDI controller… and choose it, then for each action press Learn and then the pad.',
    guide: '**MIDI controller.** Its section',
  },
  osc: {
    title: 'OSC control',
    chapter: 'tools',
    feature: 'OSC control',
    doc: 'operator',
    text: 'A sound or lighting console, or Companion, on the mandir’s network, running Next, Back, the clears, timers and messages. It is off until an admin turns it on with OSC control…, listing each sender’s address; it has no password, so read the admin guide first.',
    guide: '**OSC control.** Its section',
  },
} as const satisfies Record<string, PanelHelp>;

export type PanelHelpId = keyof typeof PANEL_HELP;
