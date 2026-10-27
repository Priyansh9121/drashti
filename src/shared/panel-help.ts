import type { GuideId } from './guides';

/*
 * "What is this?" on each operator panel (Session 25): two or three plain sentences saying what the
 * panel is for and the one thing to do first. All the words are here, in one place; each names the
 * passage of a guide it comes from (the operator's, docs/operator-guide.md, unless it says another), which
 * its Read more opens in Help › Guides (Sessions 31–36). A unit test checks each passage is still there,
 * just once, and that every panel has its words. Pro Mode only.
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
}

export const PANEL_HELP = {
  playlists: {
    title: 'Playlists',
    doc: 'operator',
    text: 'A playlist is the running order for one sabha. Click tonight’s playlist to open it, then click its first item: a presentation’s slides appear in the middle, and a video, a picture or a sound goes on the screens at once. While a phone or tablet is paired as a remote, right-click a playlist for Share with Phones and Tablets: remotes then show its files under Shared from Drashti until you choose Stop Sharing.',
    guide: "**Open tonight's playlist.**",
  },
  library: {
    title: 'The library',
    doc: 'operator',
    text: 'Every presentation, picture, video and sound on this computer: type a few letters of a kirtan’s title or words in the search box to find it, then press Add to playlist. Import… brings more in (From a Link… offers the playlist the last download went into), and a file Drashti can’t play says Converting… while Drashti converts it by itself. In Media, one click puts up a video input (Add a Video Input… names a camera or a mixer’s output), Show a Window… another app’s window, and Picture in Picture… something small in a corner; right-click a video input, or drag it, to put it in a playlist instead.',
    guide: 'the **Library**',
  },
  slides: {
    title: 'Slides',
    doc: 'operator',
    text: 'The slides of whatever you clicked, in the order they play. Click a slide to put it on the screens at once, or press Space for the next one. Right-click a slide for New Timer Slide…, and the ⋯ menu beside Edit slides has Delete… for the whole presentation, or Delete from the library… while a playlist item is open; in Edit slides, a video can Show the play bar on the screens.',
    guide: '**Starting.**',
  },
  live: {
    title: 'LIVE',
    doc: 'operator',
    text: 'What the hall sees this moment. Under it, each video or sound playing has a time bar, with Play or Pause: click it, or drag along it and let go, to move there on every screen at once; with the keyboard on it, the arrows move 5 s, Page Up and Page Down 30 s, and Home and End to its start and end. Back 15 s, Forward 15 s and Last 10 s jump the background video or a single sound, and a picture in picture has its own line there, with Swap and Take off; drag its box in LIVE to move it.',
    guide: 'headed **LIVE**',
  },
  looks: {
    title: 'Looks',
    doc: 'operator',
    text: 'A Look says what each group of screens shows: which layers, and which languages. Press one, and every screen in its group changes at once. The lit one is on the screens now.',
    guide: '**Looks.**',
  },
  lowerthirds: {
    title: 'Lower Thirds',
    doc: 'operator',
    text: 'A name, a title and a place across the bottom of the hall’s screens, the stream or both. New… makes one with its look and how it comes in; Show puts it up and Hide takes it off again.',
    guide: '**Lower Thirds.**',
  },
  stage: {
    title: 'Stage screen',
    doc: 'operator',
    text: 'What the speaker and the singers see, never the hall: type a short message for them, such as “Two minutes left”, and send it; its own Clear takes it off. The stage layout’s timers are here too, with Start, Pause and Reset; Edit layout…, then New from a Template…, makes a ready-made timer layout, such as a countdown, and the stage screens show it at once. Edit layout… can also add the box “The audience picture, live”, to show them what the hall sees, on a stage tablet too: it says Audience off in its bottom left corner while the hall’s screens are off, and No audience screens when no group shows that picture, as a box of the audience screens’ state does.',
    guide: '**The stage message.**',
  },
  props: {
    title: 'Props',
    doc: 'operator',
    text: 'Something to show over any slide, such as the mandir’s name. Show puts one up and Hide takes it off; F4 takes them all off.',
    guide: '**Props.**',
  },
  masks: {
    title: 'Masks',
    doc: 'admin',
    text: 'A mask hides part of the screens, or shows only what is inside it. Show one here; F8 takes the Masks layer off, and a screen’s own mask, set in its Look, stays.',
    guide: '**Masks.**',
  },
  messages: {
    title: 'Messages',
    doc: 'operator',
    text: 'A message goes across the bottom of the hall’s screens, such as “Car 12 please move”. Fill in its fields and press Show; Take off removes it.',
    guide: '**Messages.**',
  },
  timers: {
    title: 'Timers',
    doc: 'operator',
    text: 'Countdowns and clocks. Press Start, then Show on the screens to put one up alone in the slide’s place; press it again, or Clear slide, to take it off. The stage screens show every running timer by themselves, or, with a layout of their own, the timers in it.',
    guide: '**Timers.**',
  },
  music: {
    title: 'Music',
    doc: 'operator',
    text: 'Sounds that play one after another, apart from the slides, such as before the sabha. Choose a list and press Play: the time bar shows the track’s time left, and a click or a drag along it moves in the track, as Back 15 s, Forward 15 s and Last 10 s do (small icons in the row with Play and Pause). A slide with its own sound stops the music.',
    guide: '**Music before the sabha.**',
  },
  idle: {
    title: 'Idle rotation',
    doc: 'operator',
    text: 'Darshan pictures and quotes, one after another, while nothing else is up. Press Start; it stops by itself when the first slide goes up.',
    guide: '**Darshan pictures and quotes on the screens**',
  },
  playlist: {
    title: 'The open playlist',
    doc: 'operator',
    text: 'The playlist you opened, its items as cards in the order they play: drag a card to move it, or drop files on it to add them. One click on a video, a picture or a sound puts it on the screens at once, Alt-click (Option-click on a Mac) only shows it below, and Cmd-click (Ctrl-click on Windows) only marks it; a click on a presentation, a deck or a PDF shows its slides below. A video input from Media can be an item too: renaming the input in Media renames its items on this computer, and on a computer with no video input of that name, the card says Not on this computer and Next goes past it.',
    guide: '**Middle:**',
  },
  controls: {
    title: 'Show controls',
    doc: 'operator',
    text: 'Clear all, the layers’ clear buttons in the order of their keys, Logo and Black-out, each with its key. Each changes the hall’s screens at once, and Put it back, straight after Clear all, brings back what it took off.',
    guide: '**Covering and clearing:**',
  },
  nextback: {
    title: 'Next and Back',
    doc: 'operator',
    text: 'Next puts up what comes next in the open playlist, as Space or the right arrow does. Back goes to the slide before, as the left arrow does.',
    guide: '**Next** or **Back** under LIVE',
  },
  stream: {
    title: 'Stream',
    doc: 'operator',
    text: 'The stream from this computer to YouTube or another platform: what it shows, going live and recording. ON AIR and REC in the header say when it is public and when it is being recorded. Window for Zoom… shows the same picture in a window of its own, for Zoom to share.',
    guide: '**The stream** (only on the computer that streams',
  },
  phones: {
    title: 'Phones',
    doc: 'operator',
    text: 'Phones and tablets on the mandir’s Wi-Fi, paired as a remote, a stage display or for announcements: turn on Let paired phones and tablets connect, then check each one says Connected. A playlist shared from its right-click menu (Share with Phones and Tablets) shows on a remote under Shared from Drashti. To let a remote add pictures, videos, sounds and decks with Add from this Phone…, turn on Phones and tablets may add files, off until then: they come into Media and the playlist Added from Phones, never onto the screens by themselves.',
    guide: '**Phones** (if a phone remote or a stage tablet is used)',
  },
  announcements: {
    title: 'Announcements',
    doc: 'operator',
    text: 'Announcements sent from paired phones, waiting for you. Read each one, fix a typo with Edit, then Approve it into the ticker or as a message, or Reject it.',
    guide: '**Announcements from phones.**',
  },
  statusbar: {
    title: 'The status bar',
    doc: 'operator',
    text: 'What Drashti is doing: the screens, the sound output, imports and warnings, and its version. A warning in yellow says what to look at: Audience off or Stage off means this computer’s hall or stage screens are switched off, and Turn on brings them back where they were, asking nothing. After a screen is put on a display, or Shows or Sends is changed in Screens, Keep these screens? undoes the change in 15 seconds unless you press Keep.',
    guide: '**Along the bottom:**',
  },
  audio: {
    title: 'Audio',
    doc: 'operator',
    text: 'Audio playlists to play before the sabha: + makes one or imports sounds, and sounds dragged onto one go in. Play starts a list, and a click or a drag along its time bar moves in its track, as Back 15 s, Forward 15 s and Last 10 s do (small icons in the row with Play and Pause). Clear audio along the bottom, or F5, stops whatever sound is playing.',
    guide: '**Audio.** In the right column',
  },
  tools: {
    title: 'More tools',
    doc: 'operator',
    text: 'Lower Thirds, Masks, the Idle rotation and the MIDI controller, folded away until you need them. Press More tools to open them or fold them again.',
    guide: '**More tools.** Folded away',
  },
} as const satisfies Record<string, PanelHelp>;

export type PanelHelpId = keyof typeof PANEL_HELP;
