import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contrastRatio, deltaE00, deltaE00Lab, luminance } from '../shared/contrast';
import type { Appearance, Colours } from '../shared/appearance/appearances';
import {
  BLACK,
  BUILT_IN,
  builtIn,
  COLOUR_TOKENS,
  COMFORT_DARK_STATES,
  DARK_STATES,
  DECORATION_TOKENS,
  APPEARANCE_FAMILIES,
  familyOf,
  plainDecoration,
  WHITE,
} from '../shared/appearance/appearances';
import {
  appearanceProblems,
  BUTTON_EDGES,
  colourlessPlaces,
  decorationLacks,
  hueApart,
  hueCount,
  HUES,
  lookApart,
  LOOKS_APART,
  measureContrast,
  measureDistances,
  places,
  WORDS_AIM,
  type Measured,
} from '../shared/appearance/rules';
import { hexToOklch } from '../shared/appearance/oklch';
import { appearanceVars } from '../shared/appearance/vars';
import { ZONE_TOKENS, ZONES, zonesOf } from '../shared/appearance/zones';

/*
 * Every appearance's contrast and colour distance (Sessions 39–40; the rules are the design lab's, Session 26g, now on
 * every appearance): text at 4.5:1 or more on every surface, every fill with its text, control edges at 3:1
 * where controls sit, the words at 15:1 on panels and secondary words at 7:1, and the primary at least 10
 * (CIEDE2000) from LIVE, ON AIR and a warning, and 7 from success and danger, in usual colour vision and in
 * simulated protanopia, deuteranopia and tritanopia (src/shared/appearance/rules.ts). Ratios are compared
 * unrounded (2.999 fails 3). The buttons' classes and app.css's tokens are read from the source, so the test
 * follows any change to them. It prints each appearance's tables (docs/design.md quotes them).
 *
 * Session 42, more colourful appearances: the decoration's rules too (the header's words at 4.5:1, its focus ring
 * and controls at 3:1, headings at 4.5:1, the second colour at 3:1 as drawn and apart from the states), and every
 * appearance but Black and White more than one colour (rules.ts, decorationLacks): a header colour of its own, a
 * band, coloured headings and surfaces that carry its hue.
 *
 * Session 60 (the owner's Q60-30 and Q60-36): every appearance but Black comfortable (dark panels a deep tint,
 * 3–6 % luminance, light ones soft paper, 75–85 %, the words at 10–13:1 on every panel), Black kept exactly as it
 * was and White softened to paper; LIVE's frame and lit dots lighter on the comfortable dark ones; every two of a
 * base at least LOOKS_APART apart (rules.ts, lookApart); and each in a family.
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

/** Black and White, and every other appearance (the colourful ones). */
const PLAIN = new Set([BLACK.id, WHITE.id]);
const COLOURFUL = BUILT_IN.filter((a) => !PLAIN.has(a.id));
/** alpha.8's colourful ones (Session 44 reworked them). */
const ALPHA_8 = [
  'dhaja',
  'tiranga',
  'saffron',
  'peacock',
  'midnight-blue',
  'sandalwood',
  'lotus',
  'marble',
  'tulsi',
  'diwali',
  'holi',
  'aarti',
];

describe('more colourful appearances (Session 42): more places for colour', () => {
  it('Black is kept exactly as it was (Q60-36, Q2 A): its colours, its panel for a header, no band, the focus ring’s colour to mark', () => {
    expect(BLACK.colours).toEqual({
      ink: '#09090b',
      panel: '#121215',
      'panel-2': '#1b1b1f',
      'panel-3': '#26262b',
      line: '#2c2c32',
      'line-strong': '#42424a',
      field: '#82828d',
      fg: '#f5f5f7',
      muted: '#c8c8cf',
      faint: '#a1a1ab',
      accent: '#8ab4f8',
      'primary-hi': '#ffffff',
      primary: '#ededf0',
      'primary-lo': '#d6d6dc',
      'on-primary': '#0b0b0e',
      'primary-edge': '#c9c9d1',
      ...DARK_STATES,
    });
    // LIVE's frame is LIVE's own red in Black: it reads 3.7:1 on Black's panels.
    expect(BLACK.colours['live-edge']).toBe(BLACK.colours.live);
    expect(BLACK.decoration).toEqual({
      header: '#121215',
      'on-header': '#f5f5f7',
      'on-header-muted': '#c8c8cf',
      'header-ring': '#8ab4f8',
      'header-field': '#82828d',
      second: '#8ab4f8',
      heading: '#c8c8cf',
      // Session 44: a flat header, no title strips, and the layer buttons as before.
      'header-2': '#121215',
      strip: '#121215',
      'strip-2': '#121215',
      layer: '#1b1b1f',
      'layer-edge': '#2c2c32',
      band: [],
    });
  });

  it('White is softened to paper (Q60-36, Q2 A) and stays plain: its panel for a header, no band, the focus ring’s colour to mark', () => {
    expect(WHITE.decoration).toEqual(plainDecoration(WHITE.colours));
    expect(luminance(WHITE.colours.panel)).toBeGreaterThan(0.78);
    expect(luminance(WHITE.colours.panel)).toBeLessThan(0.82);
    expect(luminance(WHITE.colours['panel-2'])).toBeLessThan(0.87);
    expect(contrastRatio(WHITE.colours.fg, WHITE.colours.panel)).toBeGreaterThan(12);
    expect(contrastRatio(WHITE.colours.fg, WHITE.colours.panel)).toBeLessThan(WORDS_AIM.most);
    expect(hexToOklch(WHITE.colours.panel).c).toBeLessThan(0.01);
  });

  it('Black and White draw no gradient and no band, and every zone their own surfaces', () => {
    for (const a of [BLACK, WHITE]) {
      const vars = appearanceVars(a);
      expect(vars['--band-height']).toBe('0px');
      // Session 44: no gradient, and every zone its own surfaces.
      expect(vars['--header-image']).toBe('none');
      expect(vars['--strip-image']).toBe('none');
      for (const zone of ZONES)
        for (const t of ZONE_TOKENS)
          expect(vars[`--zone-${zone}-${t}`], `${a.name} ${zone} ${t}`).toBe(a.colours[t]);
    }
  });

  it.each(COLOURFUL.map((a) => [a.name, a] as const))(
    '%s is more than one colour: a header of its own, a band, coloured headings, surfaces with its hue',
    (_name, a) => {
      const d = a.decoration;
      console.info(
        `${a.name}: header ${d.header} (${d['on-header']}), band ${d.band.join(' ')}, second ${d.second}, headings ${d.heading}`,
      );
      expect(decorationLacks(a)).toEqual([]);
      const vars = appearanceVars(a);
      expect(vars['--band-height']).toBe('6px');
      for (const name of DECORATION_TOKENS) expect(vars[`--color-${name}`], name).toBe(d[name]);
      d.band.forEach((colour, i) => {
        expect(vars[`--color-band-${String(i + 1)}`]).toBe(colour);
        expect(vars[`--band-${String(i + 1)}`]).toBe('1');
      });
      for (let i = d.band.length; i < 5; i++) expect(vars[`--band-${String(i + 1)}`]).toBe('0');
    },
  );

  it('the built-in appearances, in the menu’s order, each clearly different: two of its window, header and next thing to do at least 10 from every other’s', () => {
    expect(BUILT_IN.map((a) => a.name)).toEqual([
      'Black',
      'White',
      'Dhaja',
      'Tiranga',
      'Sandhya',
      'Dusk Slate',
      'Dusk Rose',
      'Dusk Sage',
      'Dusk Indigo',
      'Dusk Amber',
      'Dusk Teal',
      'Diwali',
      'Holi',
      'Aarti',
      'Navratri',
      'Uttarayan',
      'Janmashtami',
      'Sharad Purnima',
      'Dev Diwali',
      'Vasant Panchami',
      'Annakut',
      'Raksha Bandhan',
      'Ganesh Chaturthi',
      'Guru Purnima',
      'Peacock',
      'Midnight Blue',
      'Lotus',
      'Tulsi',
      'Monsoon',
      'Forest',
      'Prabhat',
      'Himalaya',
      'Mogra',
      'Gulmohar',
      'Kesuda',
      'Champa',
      'Sagar',
      'Akash',
      'Chandni',
      'Ratna',
      'Manek',
      'Panna',
      'Neelam',
      'Moti',
      'Pukhraj',
      'Heera',
      'Neel',
      'Mehndi',
      'Haldi',
      'Bandhani',
      'Patola',
      'Ajrakh',
      'Kalamkari',
      'Madhubani',
      'Warli',
      'Saffron',
      'Sandalwood',
      'Marble',
      'Sandstone',
      'Teak',
      'Pittal',
      'Tamra',
      'Gold Leaf',
      'Kesar',
      'Broadcast',
      'Stage desk',
      'Daylight',
      'Signal',
    ]);
    const alike: string[] = [];
    for (const [i, a] of BUILT_IN.entries())
      for (const b of BUILT_IN.slice(i + 1)) {
        const apart = [
          deltaE00(a.colours.ink, b.colours.ink),
          deltaE00(a.decoration.header, b.decoration.header),
          deltaE00(a.colours.primary, b.colours.primary),
        ].sort((x, y) => y - x);
        if ((apart[1] ?? 0) < 10) alike.push(`${a.name} and ${b.name}: ${truncate(apart[1] ?? 0, 1)}`);
      }
    expect(alike).toEqual([]);
  });

  it('Dhaja and Tiranga are the flags’ colours, colours only, with the flag’s red kept from Next', () => {
    const dhaja = builtIn('dhaja');
    const tiranga = builtIn('tiranga');
    expect(dhaja?.name).toBe('Dhaja');
    expect(tiranga?.name).toBe('Tiranga');
    if (!dhaja || !tiranga) return;
    // The mandir flag: red and white stripes, red outside, with the logo's gold between them; a deep red header.
    const [red, white, gold] = [dhaja.decoration.band[0] ?? '', '#ffffff', dhaja.decoration.band[2] ?? ''];
    expect(dhaja.decoration.band).toEqual([red, white, gold, white, red]);
    expect(hexToOklch(red).h).toBeLessThan(35);
    expect(hexToOklch(gold).h).toBeGreaterThan(60);
    expect(hexToOklch(gold).h).toBeLessThan(100);
    expect(hexToOklch(dhaja.decoration.header).h).toBeLessThan(35);
    expect(hexToOklch(dhaja.decoration.header).l).toBeLessThan(0.5);
    // Red stays in the header and the band: the next thing to do is white.
    expect(hexToOklch(dhaja.colours.primary).c).toBeLessThan(0.03);
    expect(hexToOklch(dhaja.colours.primary).l).toBeGreaterThan(0.95);
    // India's flag, in the commonly published shades: saffron, white and India green, and the wheel's navy.
    expect(tiranga.decoration.band).toEqual(['#ff9933', '#ffffff', '#138808']);
    expect(tiranga.decoration.header).toBe('#000080');
    expect(tiranga.colours.primary).toBe('#ff9933');
    // Never named for an organisation.
    for (const a of BUILT_IN) expect(a.name).not.toMatch(/baps/iu);
  });

  it('would see a failure: a colourful appearance without the new colours, or with words on its header below 4.5:1', () => {
    const saffron = BUILT_IN.find((a) => a.id === 'saffron') ?? BLACK;
    const without: Appearance = { ...saffron, decoration: plainDecoration(saffron.colours) };
    expect(decorationLacks(without)).toEqual(
      expect.arrayContaining([
        'a band of 2 to 5 colours (it has 0)',
        'a header colour apart from its panels and window',
      ]),
    );
    const faint: Appearance = {
      ...saffron,
      decoration: { ...saffron.decoration, 'on-header': saffron.decoration.header },
    };
    expect(appearanceProblems(faint).some((p) => p.startsWith('words on the header: 1.00:1'))).toBe(true);
    // And a mark that could be taken for LIVE.
    const red: Appearance = { ...saffron, decoration: { ...saffron.decoration, second: '#d42a31' } };
    expect(appearanceProblems(red).some((p) => p.startsWith('second vs live: '))).toBe(true);
  });
});

/** The hue of each place, or null where it has none (rules.ts, places). */
function placeHues(a: Appearance): (number | null)[] {
  const least = a.base === 'dark' ? HUES.dark : HUES.light;
  return places(a).map(([, colours]) => {
    const hued = colours.map(hexToOklch).find((c) => c.c >= least);
    return hued === undefined ? null : hued.h;
  });
}

describe('real colour (Session 44): four hues at least, in every place', () => {
  it.each(COLOURFUL.map((a) => [a.name, a] as const))(
    '%s draws each place in a colour of its kind, with four hues at least among them',
    (_name, a) => {
      const hues = hueCount(a);
      console.info(`${a.name}: ${String(hues.count)} hues: ${hues.chosen.join('; ')}`);
      expect(colourlessPlaces(a)).toEqual([]);
      expect(hues.count).toBeGreaterThanOrEqual(HUES.least);
    },
  );

  it('the colourful appearances: alpha.8’s twelve and Session 44’s twelve, re-tuned, and more, after Black and White', () => {
    expect(BUILT_IN.slice(0, 2)).toEqual([BLACK, WHITE]);
    expect(COLOURFUL.length).toBeGreaterThanOrEqual(24);
    for (const id of ALPHA_8)
      expect(
        COLOURFUL.map((a) => a.id),
        id,
      ).toContain(id);
  });

  it('each a clearly different combination: two of a base differ in the hue of three of their places at least', () => {
    const alike: string[] = [];
    for (const [i, a] of COLOURFUL.entries())
      for (const b of COLOURFUL.slice(i + 1)) {
        if (a.base !== b.base) continue;
        const [x, y] = [placeHues(a), placeHues(b)];
        const differ = x.filter((h, k) => {
          const other = y[k] ?? null;
          return h === null || other === null ? h !== other : hueApart(h, other) >= HUES.apart;
        }).length;
        if (differ < 3) alike.push(`${a.name} and ${b.name}: ${String(differ)}`);
      }
    expect(alike).toEqual([]);
  });

  it.each(BUILT_IN.map((a) => [a.name, a] as const))(
    '%s: its zones are its own surfaces in their hues, as zones.ts works them out (Black and White: its own)',
    (_name, a) => {
      const tints = a.tints ?? { left: null, middle: null, right: null, bar: null };
      expect(a.zones).toEqual(zonesOf(a.colours, a.base === 'dark', tints));
      expect(PLAIN.has(a.id), 'tinted zones but Black and White').toBe(a.tints === undefined);
    },
  );
});

describe('the tokens in app.css and the buttons in ui/Button.tsx', () => {
  it('app.css’s @theme holds Black’s colours and decoration: what a window shows before its appearance is set', () => {
    // Session 44: and the colours only the gradients draw, kept in a static theme of their own.
    const theme = { ...coloursIn(block(/@theme\s*\{/u)), ...coloursIn(block(/@theme static\s*\{/u)) };
    expect(theme).toEqual({
      ...Object.fromEntries(COLOUR_TOKENS.map((name) => [name, BLACK.colours[name]])),
      ...Object.fromEntries(DECORATION_TOKENS.map((name) => [name, BLACK.decoration[name]])),
    });
    // No band before then: none of its blocks takes any room, and the strip is 0 px.
    const root = block(/^:root\s*\{/mu);
    expect(root).toMatch(/--band-height:\s*0px;/u);
    for (let i = 1; i <= 5; i++) expect(root).toMatch(new RegExp(`--band-${String(i)}:\\s*0;`, 'u'));
    // Session 44: every zone Black's own surfaces, and no gradient.
    for (const zone of ZONES)
      for (const t of ZONE_TOKENS)
        expect(root).toMatch(new RegExp(`--zone-${zone}-${t}:\\s*${BLACK.colours[t]};`, 'u'));
    expect(root).toMatch(/--header-image:\s*none;/u);
    expect(root).toMatch(/--strip-image:\s*none;/u);
  });

  it('the audience screens and the phone pages set every colour of their own, so no appearance reaches them', () => {
    for (const start of [/^body\.output\s*\{/mu, /^body\.web\s*\{/mu]) {
      const own = coloursIn(block(start));
      expect(Object.keys(own).sort(), String(start)).toEqual([...COLOUR_TOKENS].sort());
    }
  });

  it('the phone pages are Black, fixed (Session 41): body.web’s colours meet Black’s rules, and are Black’s with its tints', () => {
    const web = block(/^body\.web\s*\{/mu);
    const phones: Appearance = {
      ...BLACK,
      id: 'phones',
      name: 'The phone pages',
      colours: coloursIn(web) as Colours,
    };
    console.info(table(phones, measureContrast(phones), false));
    expect(appearanceProblems(phones)).toEqual([]);
    expect(phones.colours).toEqual(
      Object.fromEntries(COLOUR_TOKENS.map((name) => [name, BLACK.colours[name]])),
    );
    // The shadows' tints too (vars.ts), and nothing of the lamp's light.
    const tints = Object.fromEntries(
      [...web.matchAll(/(--depth-[a-z-]+):\s*(#[0-9a-f]{8})\b/giu)].map((m): [string, string] => [
        m[1] ?? '',
        (m[2] ?? '').toLowerCase(),
      ]),
    );
    expect(tints).toEqual(
      Object.fromEntries(
        Object.entries(appearanceVars(BLACK)).filter(([name]) => name.startsWith('--depth-')),
      ),
    );
    expect(web).not.toMatch(/--lamp-/u);
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

describe('comfortable appearances (Session 60, the owner’s Q60-30 and Q60-36)', () => {
  it.each(BUILT_IN.filter((a) => a.id !== BLACK.id).map((a) => [a.name, a] as const))(
    '%s: every panel a deep tint or soft paper, and the words on it at 10–13:1',
    (_name, a) => {
      const panels = [a.colours.panel, ...ZONES.map((z) => a.zones[z].panel)];
      const [lo, hi] = a.base === 'dark' ? [0.03, 0.06] : [0.75, 0.85];
      for (const p of panels) {
        expect(luminance(p), `${a.name} panel ${p}`).toBeGreaterThanOrEqual(lo);
        expect(luminance(p), `${a.name} panel ${p}`).toBeLessThanOrEqual(hi);
        const words = contrastRatio(a.colours.fg, p);
        expect(words, `${a.name} words on ${p}`).toBeGreaterThanOrEqual(WORDS_AIM.least);
        expect(words, `${a.name} words on ${p}`).toBeLessThanOrEqual(WORDS_AIM.most);
      }
    },
  );

  it('LIVE’s frame and lit dots: the lighter red on every comfortable dark appearance, LIVE’s own on Black and the light ones; the LIVE label always LIVE’s own red', () => {
    for (const a of BUILT_IN) {
      expect(a.colours.live, a.name).toBe('#d42a31');
      const lighter = a.base === 'dark' && a.id !== BLACK.id;
      expect(a.colours['live-edge'], a.name).toBe(
        lighter ? COMFORT_DARK_STATES['live-edge'] : a.colours.live,
      );
    }
    expect(COMFORT_DARK_STATES['live-edge']).toBe('#ff5a60');
  });

  it(`no two alike: every two appearances of a base at least ${String(LOOKS_APART)} apart (OKLab, fourteen places)`, () => {
    const close: string[] = [];
    let least = { apart: Infinity, pair: '' };
    for (const [i, a] of BUILT_IN.entries())
      for (const b of BUILT_IN.slice(i + 1)) {
        if (a.base !== b.base) continue;
        const apart = lookApart(a, b);
        if (apart < least.apart) least = { apart, pair: `${a.name} and ${b.name}` };
        if (apart < LOOKS_APART) close.push(`${a.name} and ${b.name}: ${truncate(apart, 1)}`);
      }
    console.info(`The closest two: ${least.pair}, ${truncate(least.apart, 2)} apart`);
    expect(close).toEqual([]);
    // Would see a failure: an appearance under another name is 0 apart from it.
    const twin = BUILT_IN[2] ?? BLACK;
    expect(lookApart(twin, { ...twin, id: 'twin', name: 'Twin' })).toBe(0);
  });

  it('every built-in appearance is in a family, the families together and in the window’s order', () => {
    const order = BUILT_IN.map(familyOf);
    const seen = order.filter((f, i) => order.indexOf(f) === i);
    expect(seen).toEqual([...APPEARANCE_FAMILIES]);
    for (const [i, f] of order.entries())
      expect(order.indexOf(f), `${String(i)} ${f}`).toBe(order.indexOf(f));
    expect(order.every((f, i) => i === 0 || seen.indexOf(f) >= seen.indexOf(order[i - 1] ?? f))).toBe(true);
  });
});
