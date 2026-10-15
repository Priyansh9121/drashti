import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contrastRatio, deltaE00, deltaE00Lab, over, VISIONS } from '../shared/contrast';

/*
 * The design tokens' contrast and colour distance (Session 26g, Diya), measured by the design lab's
 * rules (design-lab/diya/tools/contrast.mjs): every pair of its table, with WCAG 2.x ratios compared
 * unrounded (2.999 fails 3), the lamp's light measured at its brightest point (its colour over the
 * surface at the token's strength, mixed in sRGB as browsers draw it), and the primary's plum kept at
 * least 10 (CIEDE2000) from LIVE and ON AIR in usual colour vision and in simulated protanopia,
 * deuteranopia and tritanopia. The tokens and the buttons' classes are read from the source, so the
 * test follows any change to them. It prints both tables (docs/design.md quotes them).
 */

const renderer = join(__dirname, '..', 'renderer', 'src');
const css = readFileSync(join(renderer, 'styles', 'app.css'), 'utf8');
const button = readFileSync(join(renderer, 'ui', 'Button.tsx'), 'utf8');

/** The tokens of a block of app.css (the @theme block; the audience screens' block is not the look). */
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
const theme = block(/@theme\s*\{/u);
const root = block(/^:root\s*\{/mu);
const token: Record<string, string> = {
  white: '#ffffff',
  black: '#000000',
  ...Object.fromEntries(
    [...theme.matchAll(/--color-([a-z0-9-]+):\s*(#[0-9a-f]{6})\b/giu)].map((m): [string, string] => [
      m[1] ?? '',
      (m[2] ?? '').toLowerCase(),
    ]),
  ),
};
const lampToken = (name: string): string => {
  const v = new RegExp(`--lamp-${name}:\\s*([^;]+);`, 'u').exec(root)?.[1]?.trim();
  if (!v) throw new Error(`app.css has no --lamp-${name}`);
  return v;
};
const lampHex = `#${lampToken('rgb')
  .split(/\s+/u)
  .map((c) => Number(c).toString(16).padStart(2, '0'))
  .join('')}`;
/** The lamp's light at its brightest, over a surface. */
const lit = (strength: string, surface: string) =>
  over(lampHex, Number(lampToken(strength)), colour(surface));
function colour(name: string): string {
  const glows: Record<string, () => string> = {
    'header-glow': () => lit('header', 'panel'),
    'window-glow': () => lit('window', 'ink'),
    'welcome-glow': () => lit('welcome', 'panel'),
    'empty-glow': () => lit('empty', 'ink'),
    'lamp-colour': () => lampHex,
  };
  const hex = glows[name]?.() ?? token[name];
  if (!hex) throw new Error(`app.css has no --color-${name}`);
  return hex;
}

/** The design lab's table: [what, foreground, background, rule, where the rule comes from]. */
const PAIRS: readonly (readonly [string, string, string, number, string])[] = [
  ['fg on panel', 'fg', 'panel', 15, 'design.md (fg 15:1 on panels)'],
  ['fg on panel-2 (fields, cards)', 'fg', 'panel-2', 4.5, 'WCAG 1.4.3'],
  ['fg on panel-3 (selected row)', 'fg', 'panel-3', 4.5, 'WCAG 1.4.3'],
  ['fg on ink (slide grid title)', 'fg', 'ink', 4.5, 'WCAG 1.4.3'],
  ['muted on panel', 'muted', 'panel', 7, 'design.md (muted 7:1)'],
  ['muted on panel-2', 'muted', 'panel-2', 7, 'design.md (muted 7:1)'],
  ['muted on panel-3', 'muted', 'panel-3', 4.5, 'WCAG 1.4.3'],
  ['faint on ink', 'faint', 'ink', 4.5, 'design.md (faint 4.5:1 on every surface)'],
  ['faint on panel', 'faint', 'panel', 4.5, 'design.md'],
  ['faint on panel-2', 'faint', 'panel-2', 4.5, 'design.md'],
  ['faint on panel-3', 'faint', 'panel-3', 4.5, 'design.md'],
  ['white on live (LIVE badge, live buttons)', 'white', 'live', 4.5, 'design.md'],
  ['white on primary (primary button)', 'white', 'primary', 4.5, 'design.md'],
  ['white on onair (ON AIR badge)', 'white', 'onair', 4.5, 'design.md'],
  ['accent as link text on panel', 'accent', 'panel', 4.5, 'WCAG 1.4.3'],
  ['focus ring (accent) vs ink', 'accent', 'ink', 3, 'WCAG 1.4.11'],
  ['focus ring vs panel', 'accent', 'panel', 3, 'WCAG 1.4.11'],
  ['focus ring vs panel-2', 'accent', 'panel-2', 3, 'WCAG 1.4.11'],
  ['focus ring vs panel-3', 'accent', 'panel-3', 3, 'WCAG 1.4.11'],
  ['field edge vs panel', 'field', 'panel', 3, 'design.md (3:1 control edges)'],
  ['field edge vs panel-2', 'field', 'panel-2', 3, 'WCAG 1.4.11'],
  ['live border vs panel (live row, thumbnail)', 'live', 'panel', 3, 'WCAG 1.4.11'],
  ['live border vs the black slide inside it', 'live', 'black', 3, 'WCAG 1.4.11'],
  ['warning-fg on warning-bg', 'warning-fg', 'warning-bg', 4.5, 'WCAG 1.4.3'],
  ['warning-fg on panel-2 ("Cannot play")', 'warning-fg', 'panel-2', 4.5, 'WCAG 1.4.3'],
  ['success-fg on success-bg', 'success-fg', 'success-bg', 4.5, 'WCAG 1.4.3'],
  ['danger-fg on danger-bg', 'danger-fg', 'danger-bg', 4.5, 'WCAG 1.4.3'],
  ['danger (button text) on panel', 'danger', 'panel', 4.5, 'WCAG 1.4.3'],
  ['white on primary-hi (gradient top, hover)', 'white', 'primary-hi', 4.5, 'the primary’s gradient'],
  ['white on primary-lo (gradient bottom, pressed)', 'white', 'primary-lo', 4.5, 'the primary’s gradient'],
  ['fg on the header at the lamp’s brightest', 'fg', 'header-glow', 4.5, 'the lamp’s light'],
  ['muted on the header at the lamp’s brightest', 'muted', 'header-glow', 4.5, 'the lamp’s light'],
  ['faint on the header at the lamp’s brightest', 'faint', 'header-glow', 4.5, 'the lamp’s light'],
  ['fg on the window at the lamp’s brightest', 'fg', 'window-glow', 4.5, 'the lamp’s light'],
  ['faint on the window at the lamp’s brightest', 'faint', 'window-glow', 4.5, 'the lamp’s light'],
  ['fg on the welcome at the lamp’s brightest', 'fg', 'welcome-glow', 4.5, 'the first start'],
  ['muted on the welcome at the lamp’s brightest', 'muted', 'welcome-glow', 4.5, 'the first start'],
  ['muted on an empty state’s light', 'muted', 'empty-glow', 4.5, 'empty states'],
  ['focus ring vs the header’s light', 'accent', 'header-glow', 3, 'WCAG 1.4.11'],
  ['field edge vs panel-3', 'field', 'panel-3', 3, 'WCAG 1.4.11'],
  ['accent (info rail, links) on panel-2', 'accent', 'panel-2', 4.5, 'info notices'],
  ['warning (Stopped rail) vs panel-2', 'warning', 'panel-2', 3, 'WCAG 1.4.11'],
  ['live (lit clear dot) vs panel-2', 'live', 'panel-2', 3, 'WCAG 1.4.11'],
  ['field edge vs ink', 'field', 'ink', 3, 'WCAG 1.4.11'],
  ['strong secondary’s edge vs ink', 'primary-edge', 'ink', 3, 'WCAG 1.4.11 (Clear all)'],
  ['strong secondary’s edge vs panel', 'primary-edge', 'panel', 3, 'WCAG 1.4.11 (Clear all)'],
  ['strong secondary’s edge vs panel-2', 'primary-edge', 'panel-2', 3, 'WCAG 1.4.11 (Clear all)'],
];

/** Text colours that must read on every surface, and fills with their text. */
const TEXT = ['fg', 'muted', 'faint', 'accent', 'danger', 'warning-fg', 'success-fg', 'danger-fg', 'rec'];
const SURFACES = ['ink', 'panel', 'panel-2', 'panel-3'];
const FILLS = [
  ['white', 'live'],
  ['white', 'primary'],
  ['white', 'primary-hi'],
  ['white', 'primary-lo'],
  ['white', 'onair'],
  ['white', 'danger-strong'],
  ['warning-fg', 'warning-bg'],
  ['success-fg', 'success-bg'],
  ['danger-fg', 'danger-bg'],
  ['fg', 'warning-bg'],
  ['fg', 'danger-bg'],
] as const;
/** Where controls sit: the window, panels, and raised cards and dialogs' fields. */
const CONTROL_SURFACES = ['ink', 'panel', 'panel-2'];

/** A Button variant's background and edge, from its classes in ui/Button.tsx. */
function variant(name: string): { background: string | null; edge: string; alpha: number } {
  const classes = new RegExp(`^\\s*${name}:\\s*'([^']*)'`, 'mu').exec(button)?.[1];
  if (!classes) throw new Error(`Button.tsx has no ${name} variant`);
  const bg = /(?:^|\s)bg-([a-z0-9-]+)(?:\s|$)/u.exec(classes)?.[1] ?? null;
  const edge = /(?:^|\s)border-([a-z][a-z0-9-]*?)(?:\/(\d+))?(?:\s|$)/u.exec(classes);
  if (!edge?.[1]) throw new Error(`the ${name} button has no edge colour`);
  return {
    background: bg === 'transparent' ? null : bg,
    edge: edge[1],
    alpha: edge[2] ? Number(edge[2]) / 100 : 1,
  };
}

const truncate = (v: number, places = 2) => (Math.floor(v * 10 ** places) / 10 ** places).toFixed(places);

describe('the design tokens’ contrast (docs/design.md §2, the design lab’s table)', () => {
  it('every pair of the lab’s table meets its rule, unrounded', () => {
    const rows = PAIRS.map(([what, fg, bg, rule, source]) => {
      const r = contrastRatio(colour(fg), colour(bg));
      return { what, fg, bg, rule, source, r, ok: r >= rule };
    });
    console.info(
      [
        '| Pair | Colours | Rule | Ratio | Result | Source of the rule |',
        '|---|---|---:|---:|---|---|',
        ...rows.map(
          (x) =>
            `| ${x.what} | \`${x.fg}\` ${colour(x.fg)} on \`${x.bg}\` ${colour(x.bg)} | ≥ ${String(x.rule)}:1 | ${truncate(x.r)} | ${x.ok ? 'pass' : '**FAIL**'} | ${x.source} |`,
        ),
        `Contrast failures: ${String(rows.filter((x) => !x.ok).length)} of ${String(rows.length)} pairs.`,
      ].join('\n'),
    );
    expect(rows.filter((x) => !x.ok).map((x) => `${x.what}: ${truncate(x.r)}`)).toEqual([]);
  });

  it('text: every text colour on every surface, and every fill with its text, at 4.5:1 or more', () => {
    const fails: string[] = [];
    for (const text of TEXT)
      for (const surface of SURFACES) {
        const r = contrastRatio(colour(text), colour(surface));
        if (r < 4.5) fails.push(`${text} on ${surface}: ${truncate(r)}`);
      }
    for (const [text, fill] of FILLS) {
      const r = contrastRatio(colour(text), colour(fill));
      if (r < 4.5) fails.push(`${text} on ${fill}: ${truncate(r)}`);
    }
    expect(fails).toEqual([]);
  });

  it('buttons: each variant’s edge, as drawn, at 3:1 or more against the surface it sits on', () => {
    const fails: string[] = [];
    for (const name of ['secondary', 'strong', 'danger', 'warning']) {
      const v = variant(name);
      for (const surface of CONTROL_SURFACES) {
        const drawn = over(colour(v.edge), v.alpha, colour(v.background ?? surface));
        const r = contrastRatio(drawn, colour(surface));
        if (r < 3) fails.push(`${name} (border-${v.edge}) on ${surface}: ${truncate(r)}`);
      }
    }
    expect(fails).toEqual([]);
  });

  it('the primary is the lamp’s plum, lit from above: its button draws -hi to -lo', () => {
    const primary = new RegExp(`^\\s*primary:\\s*'([^']*)'`, 'mu').exec(button)?.[1] ?? '';
    expect(primary).toContain('from-primary-hi');
    expect(primary).toContain('to-primary-lo');
    expect(primary).toContain('text-white');
  });
});

describe('colours that must never be confused (CIEDE2000, usual and simulated colour vision)', () => {
  /** [what, colour, colour, must be at least (null: for information)]. */
  const DISTANCES: readonly (readonly [string, string, string, number | null])[] = [
    ['primary vs ON AIR', 'primary', 'onair', 10],
    ['primary vs live', 'primary', 'live', 10],
    ['primary-hi vs ON AIR', 'primary-hi', 'onair', 10],
    ['primary-hi vs live', 'primary-hi', 'live', 10],
    ['primary-lo vs ON AIR', 'primary-lo', 'onair', 10],
    ['primary-lo vs live', 'primary-lo', 'live', 10],
    ['primary-edge vs ON AIR', 'primary-edge', 'onair', 10],
    ['primary-edge vs live', 'primary-edge', 'live', 10],
    ['live vs ON AIR', 'live', 'onair', null],
    ['primary vs success', 'primary', 'success', null],
    ['primary vs guide', 'primary', 'guide', null],
    ['accent vs ON AIR', 'accent', 'onair', null],
    ['accent vs live', 'accent', 'live', null],
    ['the lamp’s light vs warning', 'lamp-colour', 'warning', null],
  ];

  it('keeps the primary at least 10 from LIVE and ON AIR, for everyone', () => {
    const rows = DISTANCES.map(([what, a, b, floor]) => {
      const each = VISIONS.map((v) => deltaE00(colour(a), colour(b), v));
      const least = Math.min(...each);
      const vision = VISIONS[each.indexOf(least)] ?? 'usual';
      return { what, each, least, vision, floor, ok: floor === null || least >= floor };
    });
    console.info(
      [
        '| Pair | usual | protan | deutan | tritan | smallest | Result |',
        '|---|---:|---:|---:|---:|---:|---|',
        ...rows.map(
          (x) =>
            `| ${x.what} | ${x.each.map((d) => truncate(d, 1)).join(' | ')} | **${truncate(x.least, 1)}** (${x.vision}) | ${x.floor === null ? 'for information' : x.ok ? `pass (≥ ${String(x.floor)})` : `**FAIL** (< ${String(x.floor)})`} |`,
        ),
      ].join('\n'),
    );
    expect(rows.filter((x) => !x.ok).map((x) => `${x.what}: ${truncate(x.least, 1)} (${x.vision})`)).toEqual(
      [],
    );
  });

  it('measures colour difference correctly (Sharma, Wu and Dalal 2005, pairs 1 and 17)', () => {
    expect(deltaE00Lab([50, 2.6772, -79.7751], [50, 0, -82.7485])).toBeCloseTo(2.0425, 4);
    expect(deltaE00Lab([50, 2.5, 0], [73, 25, -18])).toBeCloseTo(27.1492, 4);
    expect(deltaE00('#123456', '#123456')).toBe(0);
  });
});
