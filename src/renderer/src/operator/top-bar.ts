/*
 * The top bar's words (alpha.24, uitop; the owner's "too congested", in place of Session 51's S2-3 rule): Stream,
 * Phones, Announcements, Ready?, Screens, Audience, Stage and Simple Mode are one quiet group (Header.tsx). Each of its
 * ghost buttons keeps its words wherever the bar still fits with them, and gives them up as the window narrows, one at a
 * time, the least used first (Simple Mode, Ready?, Phones, Announcements, Stream): it then shows its icon alone, square,
 * its words for screen readers only, and its tooltip names it. Screens and the Audience and Stage switches always keep
 * their words, as do the states (LIVE, ON AIR, REC, the network). Before alpha.24, with Phones on, all five showed their
 * icon alone below 1680 px wide, wherever they fitted.
 *
 * "Fits" is: the name, LIVE with the longest the stream says beside it ("On air · reconnecting" and REC), the network's
 * badge while Phones is on, at least 48 px of what is live, and the group, each as wide as drawn at 1280 × 720; each
 * width below is the first 16 px step where the bar fits with that button's words (top-bar.test.ts works it out).
 * Whole class names, so Tailwind finds them.
 */

/** The buttons that may show their icon alone, in the order they give up their words as the window narrows. */
export const MAY_SHOW_ICON_ALONE = ['simple', 'ready', 'phones', 'announcements', 'stream'] as const;
export type IconAloneButton = (typeof MAY_SHOW_ICON_ALONE)[number];

/**
 * From which window width (px) each shows its words: with Phones off (`quiet`), and with Phones on (`crowded`: the
 * network's badge and Announcements in the bar too; Announcements is only there then).
 */
export const WORDS_FROM: Readonly<
  Record<IconAloneButton, { readonly quiet: number; readonly crowded: number }>
> = {
  simple: { quiet: 1280, crowded: 1648 },
  ready: { quiet: 1184, crowded: 1536 },
  phones: { quiet: 1120, crowded: 1488 },
  announcements: { quiet: 1408, crowded: 1408 },
  stream: { quiet: 1056, crowded: 1296 },
};

/** Each button's class names below its width: its words for screen readers only, and itself square (32 px). */
const BELOW: Readonly<
  Record<IconAloneButton, Readonly<Record<'quiet' | 'crowded', { words: string; icon: string }>>>
> = {
  simple: {
    quiet: { words: 'max-[1280px]:sr-only', icon: 'max-[1280px]:w-8 max-[1280px]:px-0' },
    crowded: { words: 'max-[1648px]:sr-only', icon: 'max-[1648px]:w-8 max-[1648px]:px-0' },
  },
  ready: {
    quiet: { words: 'max-[1184px]:sr-only', icon: 'max-[1184px]:w-8 max-[1184px]:px-0' },
    crowded: { words: 'max-[1536px]:sr-only', icon: 'max-[1536px]:w-8 max-[1536px]:px-0' },
  },
  phones: {
    quiet: { words: 'max-[1120px]:sr-only', icon: 'max-[1120px]:w-8 max-[1120px]:px-0' },
    crowded: { words: 'max-[1488px]:sr-only', icon: 'max-[1488px]:w-8 max-[1488px]:px-0' },
  },
  announcements: {
    quiet: { words: 'max-[1408px]:sr-only', icon: 'max-[1408px]:w-8 max-[1408px]:px-0' },
    crowded: { words: 'max-[1408px]:sr-only', icon: 'max-[1408px]:w-8 max-[1408px]:px-0' },
  },
  stream: {
    quiet: { words: 'max-[1056px]:sr-only', icon: 'max-[1056px]:w-8 max-[1056px]:px-0' },
    crowded: { words: 'max-[1296px]:sr-only', icon: 'max-[1296px]:w-8 max-[1296px]:px-0' },
  },
};

/** A button's words: for screen readers only below its width. */
export const wordsClass = (button: IconAloneButton, crowded: boolean): string =>
  BELOW[button][crowded ? 'crowded' : 'quiet'].words;

/** That button, square, the height of the top bar's buttons, below its width. */
export const iconClass = (button: IconAloneButton, crowded: boolean): string =>
  BELOW[button][crowded ? 'crowded' : 'quiet'].icon;

/** Announcements with some waiting: how many stays in sight beside its icon below its width. */
export const COUNT_IF_NARROW = 'max-[1408px]:px-2';

/**
 * Narrower still, below 1280 px with Phones on (Session 51, S2-3's review, kept): the network's badge says its count
 * alone beside its icon, and the ? beside Stream, Phones and Announcements go (each panel has its own ?).
 */
export const WORDS_IF_NARROWER = 'max-[1280px]:sr-only';
/** A ? beside a top bar button, gone below 1280 px while Phones is on. */
export const HIDDEN_IF_NARROWER = 'max-[1280px]:hidden';

/**
 * The ? beside Stream, Phones and Announcements (help/WhatIsThis.tsx): the header's compact room, held while Help is off
 * (alpha.24, topbar; the a25 list's item 6), so turning Help on or off moves nothing in the bar. The widths above count
 * that room whether Help is on or off; before, with Help off, Stream moved 40 px and Phones 20 px as Help came on.
 */
export const HELP_ROOM = { compact: true, keepRoom: true } as const;

/**
 * The Announcements button's colours change at once (alpha.24, topbar; the a25 list's item 30): as one comes to wait it
 * turns the warning's colours in the same frame, never eased over 120 ms (the redesign's rule: an operator window's
 * motion is transform and opacity). It still dims while pressed and, Lively, lifts as any button does. Important, so it
 * holds over the motion rules (app.css, ui/motion.css: unlayered, by data-variant) as over the button's own fade.
 */
export const COLOURS_AT_ONCE = '[transition-property:opacity,transform,translate]!';
