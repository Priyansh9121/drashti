import { describe, expect, it } from 'vitest';
import { contrastRatio } from '../contrast';
import type { Appearance, Colours } from './appearances';
import { BLACK, COLOUR_TOKENS } from './appearances';
import { appearanceProblems, CONTRAST_RULES, DISTANCE_RULES } from './rules';
import { plainZones } from './zones';

/*
 * The owner's two rule changes for comfortable appearances (Q60-36, Q1 A, 20 Nov 2026; x43's audit found the rules
 * themselves kept every dark appearance near-black and every light one near-white):
 *  1. the words on panels at least 10:1, aiming at 10–13:1 (it was 15:1, which allowed a dark panel 1.4 % at most);
 *  2. a lighter red for LIVE's frame and lit dot on dark surfaces only (`live-edge`, about #ff5a60), so the frame
 *     keeps 3:1 on a lifted panel; LIVE's label stays #d42a31 with white words (5.0:1).
 * Made-up colours only: a dark appearance lifted to the comfort target (panels 3.7 %, x43's Black comfort-tuned).
 */

const rule = (what: string) => CONTRAST_RULES.find((r) => r.what === what);

/** Black's surfaces and words lifted to the comfort target: panel #363639 (3.7 %), words 10.8:1. */
const LIFTED = {
  ink: '#303133',
  panel: '#363639',
  'panel-2': '#3b3b3f',
  'panel-3': '#414247',
  fg: '#f3f2f4',
  muted: '#cfd0d7',
  faint: '#b0b1bb',
} as const;

/** Black with other colours, its zones its own surfaces (built with Object.assign: a token added since needs no change). */
const blackWith = (...changes: Readonly<Record<string, string>>[]): Appearance => {
  const colours = Object.assign({}, BLACK.colours, ...changes) as Colours;
  return { ...BLACK, colours, zones: plainZones(colours) };
};

const problemsAbout = (a: Appearance, start: string) =>
  appearanceProblems(a).filter((p) => p.startsWith(start));

describe('the words on panels: at least 10:1, aiming at 10–13:1 (Q60-36, Q1 A)', () => {
  it('asks 10:1 of the words on panels, not 15:1', () => {
    expect(rule('words on panels')?.min).toBe(10);
    expect(rule('words on panels')?.fg).toBe('fg');
    expect(rule('words on panels')?.bg).toBe('panel');
  });

  it('a lifted panel with its words at 10.8:1 meets it; words at 9.2:1 do not', () => {
    const lifted = blackWith(LIFTED);
    expect(contrastRatio(LIFTED.fg, LIFTED.panel)).toBeGreaterThan(10.7);
    expect(problemsAbout(lifted, 'words on panels:')).toEqual([]);
    const dim = blackWith(LIFTED, { fg: '#e2e1e3' });
    expect(contrastRatio('#e2e1e3', LIFTED.panel)).toBeLessThan(10);
    expect(problemsAbout(dim, 'words on panels:')).toEqual(['words on panels: 9.24:1, at least 10:1']);
  });
});

describe('LIVE’s frame and lit dot: `live-edge`, lighter on dark surfaces (Q60-36, Q1 A)', () => {
  it('is a colour every appearance sets', () => {
    expect(COLOUR_TOKENS).toContain('live-edge');
  });

  it('the frame, the lit clear’s dot and the lit layer button’s dot are measured in live-edge; the LIVE label stays live', () => {
    for (const what of [
      'live border vs panel (live row, thumbnail)',
      'live border vs the black slide inside it',
      'live (lit clear dot) vs panel-2',
      'a lit layer button’s dot (live) on its fill',
    ])
      expect(rule(what)?.fg, what).toBe('live-edge');
    // The LIVE label: white words on LIVE's own red.
    expect(rule('white on live')?.fg).toBe('white');
    expect(rule('white on live')?.bg).toBe('live');
  });

  it('a lifted dark panel keeps the frame at 3:1 with the lighter red, and would not with LIVE’s own', () => {
    const lighter = blackWith(LIFTED, { 'live-edge': '#ff5a60' });
    expect(problemsAbout(lighter, 'live border')).toEqual([]);
    expect(problemsAbout(lighter, 'live (lit clear dot)')).toEqual([]);
    expect(problemsAbout(lighter, 'white on live')).toEqual([]);
    const same = blackWith(LIFTED, { 'live-edge': '#d42a31' });
    expect(problemsAbout(same, 'live border vs panel')).toEqual([
      'live border vs panel (live row, thumbnail): 2.39:1, at least 3:1',
    ]);
    expect(problemsAbout(same, 'live (lit clear dot) vs panel-2')).toEqual([
      'live (lit clear dot) vs panel-2: 2.21:1, at least 3:1',
    ]);
  });

  it('nothing that acts, marks or decorates can be taken for the lighter red either', () => {
    const against = (x: string) =>
      DISTANCE_RULES.find(([, a, b]) => a === x && (b as string) === 'live-edge')?.[3];
    for (const x of [
      'primary',
      'primary-hi',
      'primary-lo',
      'primary-edge',
      'second',
      'heading',
      'layer',
      'layer-edge',
    ])
      expect(against(x), `${x} vs live-edge`).toBe(10);
  });
});
