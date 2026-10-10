/*
 * "What is this?" on each operator panel (Session 25): two or three plain sentences saying what the
 * panel is for and the one thing to do first. All the words are here, in one place; each names the
 * passage of the operator's guide (docs/operator-guide.md) it comes from, and a unit test checks
 * that passage is still there and that every panel has its words. Pro Mode only.
 */

export interface PanelHelp {
  /** The panel's name, as its heading says it. */
  title: string;
  /** Two or three sentences: what it is for, and the one thing to do first. */
  text: string;
  /** Words of the operator's guide this follows (it must still say them). */
  guide: string;
}

export const PANEL_HELP = {
  playlists: {
    title: 'Playlists',
    text: 'A playlist is the running order for one sabha. Click tonight’s playlist to open it, then click its first item: its slides appear in the middle.',
    guide: "**Open tonight's playlist.**",
  },
  library: {
    title: 'The library',
    text: 'Every presentation, picture, video, sound and Shastra passage on this computer. Type a few letters of a kirtan’s title or words in the search box to find it. Choose one and press Add to playlist to put it in the open playlist.',
    guide: 'the **Library**',
  },
  slides: {
    title: 'Slides',
    text: 'The slides of whatever you clicked, in the order they play. Click a slide to put it on the screens at once, or press Space for the next one.',
    guide: '**Starting.**',
  },
  live: {
    title: 'On the screens now',
    text: 'What the hall sees this moment, and below it what Next will bring. Nothing here changes the screens: the slides, Next and the buttons along the bottom do.',
    guide: '**live picture**',
  },
  looks: {
    title: 'Looks',
    text: 'A Look says what each group of screens shows: which layers, and which languages. Press one, and every screen in its group changes at once. The lit one is on the screens now.',
    guide: '**Looks.**',
  },
  macros: {
    title: 'Macros',
    text: 'A macro does several things at one press, as the admin set it up: for the arti, Clear all, its background and its sound. Press its button when the moment comes.',
    guide: '**Macros.**',
  },
  stage: {
    title: 'Stage screen',
    text: 'What the speaker and the singers see, never the hall. Type a short message for them, such as “Two minutes left”, and send it; its own Clear takes it off.',
    guide: '**The stage message.**',
  },
  props: {
    title: 'Props',
    text: 'Something to show over any slide, such as the mandir’s name. Show puts one up and Hide takes it off; F4 takes them all off.',
    guide: '**Props.**',
  },
  masks: {
    title: 'Masks',
    text: 'A mask hides part of the screens, or shows only what is inside it. Show one here; F7 takes the Masks layer off, and a screen’s own mask, set in its Look, stays.',
    guide: 'the Masks layer',
  },
  messages: {
    title: 'Messages',
    text: 'A message goes across the bottom of the hall’s screens, such as “Car 12 please move”. Fill in its fields and press Show; Take off removes it.',
    guide: '**Messages.**',
  },
  timers: {
    title: 'Timers',
    text: 'Countdowns and clocks. Press Start, then Show on the screens to put one up; the stage screens show every running timer by themselves.',
    guide: '**Timers.**',
  },
  music: {
    title: 'Music',
    text: 'Sounds that play one after another, apart from the slides, such as before the sabha. Choose a list and press Play; a slide with its own sound stops it.',
    guide: '**Music before the sabha.**',
  },
  arti: {
    title: 'Arti',
    text: 'If the admin set the arti’s time, a strip counts down to it, and at the time the arti is what Next shows. Press Next at the right moment.',
    guide: '**The arti.**',
  },
  idle: {
    title: 'Idle rotation',
    text: 'Darshan pictures and quotes, one after another, while nothing else is up. Press Start; it stops by itself when the first slide goes up.',
    guide: '**Darshan pictures and quotes on the screens**',
  },
} as const satisfies Record<string, PanelHelp>;

export type PanelHelpId = keyof typeof PANEL_HELP;
