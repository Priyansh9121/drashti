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
    text: 'A playlist is the running order for one sabha. Click tonight’s playlist to open it, then click its first item: its slides appear in the middle.',
    guide: "**Open tonight's playlist.**",
  },
  library: {
    title: 'The library',
    doc: 'operator',
    text: 'Every presentation, picture, video and sound on this computer. Type a few letters of a kirtan’s title or words in the search box to find it. Choose one and press Add to playlist to put it in the open playlist, or bring more in with Import….',
    guide: 'the **Library**',
  },
  slides: {
    title: 'Slides',
    doc: 'operator',
    text: 'The slides of whatever you clicked, in the order they play. Click a slide to put it on the screens at once, or press Space for the next one.',
    guide: '**Starting.**',
  },
  live: {
    title: 'LIVE',
    doc: 'operator',
    text: 'What the hall sees this moment. Nothing here changes the screens: the slides, Next and the buttons along the bottom do.',
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
    text: 'What the speaker and the singers see, never the hall. Type a short message for them, such as “Two minutes left”, and send it; its own Clear takes it off.',
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
    text: 'A mask hides part of the screens, or shows only what is inside it. Show one here; F7 takes the Masks layer off, and a screen’s own mask, set in its Look, stays.',
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
    text: 'Countdowns and clocks. Press Start, then Show on the screens to put one up; the stage screens show every running timer by themselves.',
    guide: '**Timers.**',
  },
  music: {
    title: 'Music',
    doc: 'operator',
    text: 'Sounds that play one after another, apart from the slides, such as before the sabha. Choose a list and press Play; a slide with its own sound stops it.',
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
    text: 'The playlist you opened, its items as cards in the order they play. Click an item to see its slides below it, drag a card to move it, or drop files on it to add them.',
    guide: '**Middle:**',
  },
  controls: {
    title: 'Show controls',
    doc: 'operator',
    text: 'Clear all, a clear button for each layer, Logo and Black-out, each with its key. Each changes the hall’s screens at once, and Put it back, straight after Clear all, brings back what it took off.',
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
    text: 'The stream from this computer to YouTube or another platform: what it shows, going live and recording. ON AIR and REC in the header say when it is public and when it is being recorded.',
    guide: '**The stream** (only on the computer that streams',
  },
  phones: {
    title: 'Phones',
    doc: 'operator',
    text: 'Phones and tablets on the mandir’s Wi-Fi, paired as a remote, a stage display or for announcements. Turn on Let paired phones and tablets connect, then check each one says Connected.',
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
    text: 'What Drashti is doing: the screens, the sound output, imports and warnings, and its version. A warning in yellow says what to look at.',
    guide: '**Along the bottom:**',
  },
  audio: {
    title: 'Audio',
    doc: 'operator',
    text: 'Audio playlists to play before the sabha: + makes one or imports sounds, and sounds dragged onto one go in. Play starts a list; Clear audio along the bottom, or F6, stops whatever sound is playing.',
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
