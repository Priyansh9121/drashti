import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { deltaE00, deltaE00Lab } from '../shared/contrast';
import type { Appearance } from '../shared/appearance/appearances';
import { BLACK, BUILT_IN, COLOUR_TOKENS } from '../shared/appearance/appearances';
import {
  appearanceProblems,
  BUTTON_EDGES,
  measureContrast,
  measureDistances,
  type Measured,
} from '../shared/appearance/rules';

/*
 * Every appearance's contrast and colour distance (Sessions 39–40; the rules are the design lab's, Session 26g, now on
 * every appearance): text at 4.5:1 or more on every surface, every fill with its text, control edges at 3:1
 * where controls sit, the words at 15:1 on panels and secondary words at 7:1, and the primary at least 10
 * (CIEDE2000) from LIVE, ON AIR and a warning, and 7 from success and danger, in usual colour vision and in
 * simulated protanopia, deuteranopia and tritanopia (src/shared/appearance/rules.ts). Ratios are compared
 * unrounded (2.999 fails 3). The buttons' classes and app.css's tokens are read from the source, so the test
 * follows any change to them. It prints each appearance's tables (docs/design.md quotes them).
 */

const renderer = join(__dirname, '..', 'renderer', 'src');
const css = readFileSync(join(renderer, 'styles', 'app.css'), 'utf8');
const button = readFileSync(join(renderer, 'ui', 'Button.tsx'), 'utf8');

/** A block of app.css by its opening, without its braces. */
function block(start: RegExp): string {
  const at = start.exec(css)?.index;
  if (at === undefined) throw new Error(`app.css has no ${String(start)} block`);
  const open = css.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) return css.slice(open + 1, i);
  }
  throw new Error(`app.css's ${String(start)} block never closes`);
}
/** The colour tokens a block sets. */
const coloursIn = (text: string): Record<string, string> =>
  Object.fromEntries(
    [...text.matchAll(/--color-([a-z0-9-]+):\s*(#[0-9a-f]{6})\b/giu)].map((m): [string, string] => [
      m[1] ?? '',
      (m[2] ?? '').toLowerCase(),
    ]),
  );

const truncate = (v: number, places = 2) => (Math.floor(v * 10 ** places) / 10 ** places).toFixed(places);

function table(a: Appearance, rows: Measured[], distance: boolean): string {
  return [
    `${a.name} (${a.base}): ${distance ? 'colours never confused' : 'contrast'}`,
    distance
      ? '| Pair | Colours | Least | In | Rule | Result |'
      : '| Pair | Colours | Ratio | Rule | Result |',
    distance ? '|---|---|---:|---|---:|---|' : '|---|---|---:|---:|---|',
    ...rows.map((m) =>
      distance
        ? `| ${m.what} | ${m.colours} | ${truncate(m.value, 1)} | ${m.vision ?? ''} | ≥ ${String(m.min)} | ${m.ok ? 'pass' : '**FAIL**'} |`
        : `| ${m.what} | ${m.colours} | ${truncate(m.value)} | ≥ ${String(m.min)}:1 | ${m.ok ? 'pass' : '**FAIL**'} |`,
    ),
    `Failures: ${String(rows.filter((m) => !m.ok).length)} of ${String(rows.length)}.`,
  ].join('\n');
}

describe('every built-in appearance’s contrast (docs/design.md §2)', () => {
  it.each(BUILT_IN.map((a) => [a.name, a] as const))(
    '%s meets every contrast rule, unrounded',
    (_name, a) => {
      const rows = measureContrast(a);
      console.info(table(a, rows, false));
      expect(rows.filter((m) => !m.ok).map((m) => `${m.what}: ${truncate(m.value)}`)).toEqual([]);
    },
  );

  it.each(BUILT_IN.map((a) => [a.name, a] as const))(
    '%s keeps its primary apart from LIVE, ON AIR and a warning, for everyone',
    (_name, a) => {
      const rows = measureDistances(a);
      console.info(table(a, rows, true));
      expect(
        rows.filter((m) => !m.ok).map((m) => `${m.what}: ${truncate(m.value, 1)} (${m.vision ?? ''})`),
      ).toEqual([]);
    },
  );

  it('every appearance sets every colour, in #rrggbb, with names and ids of its own', () => {
    for (const a of BUILT_IN) {
      expect(Object.keys(a.colours).sort(), a.name).toEqual([...COLOUR_TOKENS].sort());
      for (const [name, hex] of Object.entries(a.colours))
        expect(hex, `${a.name} ${name}`).toMatch(/^#[0-9a-f]{6}$/u);
    }
    expect(new Set(BUILT_IN.map((a) => a.id)).size).toBe(BUILT_IN.length);
    expect(new Set(BUILT_IN.map((a) => a.name)).size).toBe(BUILT_IN.length);
  });

  it('would see a failure: Black’s secondary words dimmed below 4.5:1 (the named mutation)', () => {
    const dimmed: Appearance = { ...BLACK, colours: { ...BLACK.colours, muted: '#55555c' } };
    const problems = appearanceProblems(dimmed);
    expect(problems.some((p) => p.startsWith('secondary words on panels: '))).toBe(true);
    expect(problems.some((p) => p.startsWith('muted on panel-3: '))).toBe(true);
    expect(appearanceProblems(BLACK)).toEqual([]);
    // And a primary too close to LIVE.
    const near: Appearance = { ...BLACK, colours: { ...BLACK.colours, primary: '#d0302f' } };
    expect(appearanceProblems(near).some((p) => p.startsWith('primary vs live: '))).toBe(true);
  });
});

describe('the tokens in app.css and the buttons in ui/Button.tsx', () => {
  it('app.css’s @theme holds Black’s colours: what a window shows before its appearance is set', () => {
    const theme = coloursIn(block(/@theme\s*\{/u));
    expect(theme).toEqual(Object.fromEntries(COLOUR_TOKENS.map((name) => [name, BLACK.colours[name]])));
  });

  it('the audience screens and the phone pages set every colour of their own, so no appearance reaches them', () => {
    for (const start of [/^body\.output\s*\{/mu, /^body\.web\s*\{/mu]) {
      const own = coloursIn(block(start));
      expect(Object.keys(own).sort(), String(start)).toEqual([...COLOUR_TOKENS].sort());
    }
  });

  it('each button variant’s edge is the solid colour the rules measure, and the primary draws -hi to -lo with its own words', () => {
    const classes = (name: string) => new RegExp(`^\\s*${name}:\\s*'([^']*)'`, 'mu').exec(button)?.[1] ?? '';
    for (const [variant, edge] of Object.entries(BUTTON_EDGES))
      expect(classes(variant).split(/\s+/u), variant).toContain(`border-${edge}`);
    const primary = classes('primary');
    expect(primary).toContain('from-primary-hi');
    expect(primary).toContain('to-primary-lo');
    expect(primary).toContain('text-on-primary');
    expect(primary).not.toContain('text-white');
  });
});

describe('colour difference (CIEDE2000)', () => {
  it('measures colour difference correctly (Sharma, Wu and Dalal 2005, pairs 1 and 17)', () => {
    expect(deltaE00Lab([50, 2.6772, -79.7751], [50, 0, -82.7485])).toBeCloseTo(2.0425, 4);
    expect(deltaE00Lab([50, 2.5, 0], [73, 25, -18])).toBeCloseTo(27.1492, 4);
    expect(deltaE00('#123456', '#123456')).toBe(0);
  });
});
