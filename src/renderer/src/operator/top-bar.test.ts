import { describe, expect, it } from 'vitest';
import {
  COUNT_IF_NARROW,
  HIDDEN_IF_NARROWER,
  iconClass,
  MAY_SHOW_ICON_ALONE,
  type IconAloneButton,
  WORDS_FROM,
  WORDS_IF_NARROWER,
  wordsClass,
} from './top-bar';

/*
 * The top bar's words (alpha.24, uitop; the owner's "too congested"): Stream, Phones, Announcements, Ready?, Screens,
 * Audience, Stage and Simple Mode are one quiet group, and each of its ghost buttons keeps its words wherever the bar
 * still fits with them, from CI's 1024 px to 1680 px, giving them up one at a time as the window narrows, the least
 * used first. Before alpha.24, with Phones on, all five showed their icon alone below 1680 px, wherever they fitted.
 *
 * The widths below are the bar's parts as drawn at 1280 × 720 (docs/screenshots/operator-1280x720.png, phones-panel.png
 * and simple-mode-on-air.png, alpha.22, read to a pixel or two); Announcements' word, "On air · reconnecting" and the
 * Audience and Stage dots are worked out from the same letters. The real bar is checked at 1024 and 1280 by
 * audience-stage.spec.ts (Phones on, on air) and simple-mode-switch.spec.ts / operator-fit.spec.ts (Phones off).
 */

const PX = {
  /** The bar's sides (2 × 16), the name with its mark, and the gaps either side of the states (2 × 16). */
  frame: 32 + 95 + 32,
  /** The longest the stream says beside LIVE ("On air · reconnecting" and REC) and the gap after it. */
  onAir: 216 + 16,
  /** The network's badge ("Network on · 3 devices"; its count alone below 1280 px) and the gap after it. */
  network: { full: 174 + 16, compact: 36 + 16 },
  /** LIVE's badge and the gap before what is live. */
  live: 50 + 8,
  /** What is live ("Live: … · slide 2 of 5"): at least this much of it is always in sight. */
  line: 48,
  /** Each ghost button with its words; any of them with its icon alone (square). */
  words: { simple: 134, ready: 95, phones: 98, announcements: 148, stream: 96 } as Record<IconAloneButton, number>,
  icon: 32,
  /** A ? beside Stream, Phones and Announcements, and the gap before it. */
  help: 20 + 2,
  screens: 100,
  /** Audience On and Stage On, each with its dot, and the gap between them. */
  switches: 103 + 2 + 82,
  /** A hairline between the group's parts. */
  divider: 1,
  /** The gap between the group's parts. */
  gap: 2,
  /** The group's edge and the room inside it. */
  edge: 2 + 4,
};

/** Whether a button shows its words at this width. */
const shows = (b: IconAloneButton, width: number, crowded: boolean) =>
  width >= WORDS_FROM[b][crowded ? 'crowded' : 'quiet'];

/** How wide the group is at this width (`force`: that button with its words whatever the rule says). */
function groupWidth(width: number, crowded: boolean, force?: IconAloneButton): number {
  const button = (b: IconAloneButton) => (b === force || shows(b, width, crowded) ? PX.words[b] : PX.icon);
  const help = crowded && width < 1280 ? 0 : PX.help;
  const parts = [
    button('stream') + help,
    button('phones') + help,
    ...(crowded ? [button('announcements') + help] : []),
    PX.divider,
    button('ready'),
    PX.divider,
    PX.screens,
    PX.switches,
    PX.divider,
    button('simple'),
  ];
  return parts.reduce((a, b) => a + b, 0) + PX.gap * (parts.length - 1) + PX.edge;
}

/** How wide the whole bar must be at this width, on air (the longest), with LIVE and at least PX.line of its line. */
function need(width: number, crowded: boolean, force?: IconAloneButton): number {
  const network = crowded ? (width < 1280 ? PX.network.compact : PX.network.full) : 0;
  return PX.frame + PX.onAir + network + PX.live + PX.line + groupWidth(width, crowded, force);
}

const MODES = [
  { crowded: false, words: 'Phones off' },
  { crowded: true, words: 'Phones on' },
] as const;

describe('the top bar’s words', () => {
  it('Screens, Audience and Stage always keep their words: only Simple Mode, Ready?, Phones, Announcements and Stream may show an icon alone', () => {
    expect([...MAY_SHOW_ICON_ALONE]).toEqual(['simple', 'ready', 'phones', 'announcements', 'stream']);
  });

  it('give up their words one at a time as the window narrows, the least used first, in that order', () => {
    for (const { crowded } of MODES) {
      const from = MAY_SHOW_ICON_ALONE.filter((b) => crowded || b !== 'announcements').map(
        (b) => WORDS_FROM[b][crowded ? 'crowded' : 'quiet'],
      );
      expect(from).toEqual([...from].sort((a, b) => b - a));
      expect(new Set(from).size).toBe(from.length);
    }
  });

  it('with Phones on, each keeps its words below 1680 px, where before alpha.24 all five showed their icon alone; with Phones off, from no wider than with it on', () => {
    for (const b of MAY_SHOW_ICON_ALONE) {
      expect(WORDS_FROM[b].crowded, b).toBeLessThanOrEqual(1680);
      expect(WORDS_FROM[b].quiet, b).toBeLessThanOrEqual(WORDS_FROM[b].crowded);
      expect(WORDS_FROM[b].quiet, b).toBeGreaterThanOrEqual(1024);
    }
    expect(WORDS_FROM.stream.crowded).toBeLessThan(1680);
    expect(WORDS_FROM.stream.crowded).toBeLessThan(WORDS_FROM.simple.crowded);
  });

  it('each says its width in whole class names Tailwind finds: its words for screen readers only, and its button square, below it', () => {
    for (const b of MAY_SHOW_ICON_ALONE)
      for (const { crowded } of MODES) {
        const from = String(WORDS_FROM[b][crowded ? 'crowded' : 'quiet']);
        expect(wordsClass(b, crowded)).toBe(`max-[${from}px]:sr-only`);
        expect(iconClass(b, crowded)).toBe(`max-[${from}px]:w-8 max-[${from}px]:px-0`);
      }
    // Announcements waiting keeps its count beside its icon below the same width.
    expect(COUNT_IF_NARROW).toBe(`max-[${String(WORDS_FROM.announcements.crowded)}px]:px-2`);
    // Below 1280 px with Phones on, the ? go and the network's badge says its count alone, as before.
    expect(HIDDEN_IF_NARROWER).toBe('max-[1280px]:hidden');
    expect(WORDS_IF_NARROWER).toBe('max-[1280px]:sr-only');
  });

  it('at every width from 1024 to 1920 px the bar fits: the name, LIVE on air, the network, 48 px of what is live and the group', () => {
    for (const { crowded, words } of MODES)
      for (let width = 1024; width <= 1920; width++)
        expect(need(width, crowded), `${words} at ${String(width)} px`).toBeLessThanOrEqual(width);
  });

  it('and each button’s words come back at the first 16 px step where they fit, never later', () => {
    for (const { crowded, words } of MODES)
      for (const b of MAY_SHOW_ICON_ALONE) {
        if (!crowded && b === 'announcements') continue;
        const from = WORDS_FROM[b][crowded ? 'crowded' : 'quiet'];
        expect(from % 16, `${words}: ${b}`).toBe(0);
        const before = from - 16;
        if (before < 1024) continue;
        expect(need(before, crowded, b), `${words}: ${b}'s words at ${String(before)} px`).toBeGreaterThan(before);
      }
  });
});
