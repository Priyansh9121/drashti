import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * Every text and edge pair of the design tokens, measured against docs/design.md's rules (Session
 * 25, ID-1): text at least 4.5:1 (WCAG 1.4.3), and the edge of a control and the focus ring at
 * least 3:1 (1.4.11). A button's edge with an opacity modifier is measured as drawn: mixed over the
 * button's own background, against the surface it sits on. The tokens and the buttons' classes are
 * read from the source, so the test follows any change to them.
 */

const renderer = join(__dirname, '..', 'renderer', 'src');
const ui = join(renderer, 'ui');
const css = readFileSync(join(renderer, 'styles', 'app.css'), 'utf8');
const token: Record<string, string> = {
  white: '#ffffff',
  ...Object.fromEntries(
    [...css.matchAll(/--color-([a-z0-9-]+):\s*(#[0-9a-f]{6})\b/giu)].map((m): [string, string] => [
      m[1] ?? '',
      m[2] ?? '',
    ]),
  ),
};
const colour = (name: string): string => {
  const hex = token[name];
  if (!hex) throw new Error(`app.css has no --color-${name}`);
  return hex;
};

const rgb = (hex: string) =>
  [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [number, number, number];
const linear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const luminance = (hex: string) => {
  const [r, g, b] = rgb(hex).map(linear) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
/** WCAG's contrast ratio. */
export function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
/** `top` at `alpha` over `bottom`, as the screen shows it. */
function over(top: string, alpha: number, bottom: string): string {
  const [t, b] = [rgb(top), rgb(bottom)];
  return `#${t
    .map((c, i) =>
      Math.round((c * alpha + (b[i] ?? 0) * (1 - alpha)) * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

const SURFACES = ['ink', 'panel', 'panel-2', 'panel-3'];
/** Where controls sit: the window, panels, and raised cards and dialogs' fields. */
const CONTROL_SURFACES = ['ink', 'panel', 'panel-2'];

/** A Button variant's background and edge, from its classes in ui/Button.tsx. */
function variant(name: string): { background: string | null; edge: string; alpha: number } {
  const source = readFileSync(join(ui, 'Button.tsx'), 'utf8');
  const classes = new RegExp(`^\\s*${name}: '([^']*)'`, 'mu').exec(source)?.[1];
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

describe('the design tokens’ contrast (docs/design.md §2)', () => {
  it('text: every text colour on every surface at 4.5:1 or more', () => {
    const fails: string[] = [];
    for (const text of [
      'fg',
      'muted',
      'faint',
      'accent',
      'danger',
      'warning-fg',
      'success-fg',
      'danger-fg',
      'rec',
    ])
      for (const surface of SURFACES)
        if (ratio(colour(text), colour(surface)) < 4.5)
          fails.push(`${text} on ${surface}: ${ratio(colour(text), colour(surface)).toFixed(2)}`);
    for (const [text, fill] of [
      ['white', 'live'],
      ['white', 'accent-strong'],
      ['white', 'onair'],
      ['white', 'danger-strong'],
      ['warning-fg', 'warning-bg'],
      ['success-fg', 'success-bg'],
      ['danger-fg', 'danger-bg'],
      ['fg', 'warning-bg'],
      ['fg', 'danger-bg'],
    ] as const)
      if (ratio(colour(text), colour(fill)) < 4.5)
        fails.push(`${text} on ${fill}: ${ratio(colour(text), colour(fill)).toFixed(2)}`);
    expect(fails).toEqual([]);
  });

  it('edges: a control’s edge, the focus ring and a lit clear at 3:1 or more where controls sit', () => {
    const fails: string[] = [];
    for (const edge of ['field', 'accent', 'live'])
      for (const surface of CONTROL_SURFACES)
        if (ratio(colour(edge), colour(surface)) < 3)
          fails.push(`${edge} on ${surface}: ${ratio(colour(edge), colour(surface)).toFixed(2)}`);
    expect(fails).toEqual([]);
  });

  it('buttons: each variant’s edge, as drawn, at 3:1 or more against the surface it sits on', () => {
    const fails: string[] = [];
    for (const name of ['secondary', 'danger', 'warning']) {
      const v = variant(name);
      for (const surface of CONTROL_SURFACES) {
        const drawn = over(colour(v.edge), v.alpha, colour(v.background ?? surface));
        const r = ratio(drawn, colour(surface));
        if (r < 3)
          fails.push(
            `${name} (border-${v.edge}${v.alpha < 1 ? `/${String(v.alpha * 100)}` : ''}) on ${surface}: ${r.toFixed(2)}`,
          );
      }
    }
    expect(fails).toEqual([]);
  });
});

// ---- the colour-distance report (a report only in Session 25: it fails today, and Session 26's colours fix it) ----

const toLab = (hex: string): [number, number, number] => {
  const [r, g, b] = rgb(hex).map(linear) as [number, number, number];
  const xyz = [
    (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047,
    0.2126 * r + 0.7152 * g + 0.0722 * b,
    (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883,
  ].map((v) => (v > 216 / 24389 ? Math.cbrt(v) : (v * 24389) / 27 / 116 + 16 / 116)) as [
    number,
    number,
    number,
  ];
  return [116 * xyz[1] - 16, 500 * (xyz[0] - xyz[1]), 200 * (xyz[1] - xyz[2])];
};

/** CIEDE2000 colour difference between two colours. */
export const deltaE00 = (a: string, b: string): number => deltaE00Lab(toLab(a), toLab(b));

/** CIEDE2000 colour difference between two CIELAB colours. */
function deltaE00Lab([L1, a1, b1]: readonly number[], [L2, a2, b2]: readonly number[]): number {
  if (
    L1 === undefined ||
    a1 === undefined ||
    b1 === undefined ||
    L2 === undefined ||
    a2 === undefined ||
    b2 === undefined
  )
    throw new Error('a CIELAB colour has three numbers');
  const rad = Math.PI / 180;
  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const Cm = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cm ** 7 / (Cm ** 7 + 25 ** 7)));
  const [ap1, ap2] = [(1 + G) * a1, (1 + G) * a2];
  const [Cp1, Cp2] = [Math.hypot(ap1, b1), Math.hypot(ap2, b2)];
  const hue = (bb: number, ap: number) => (bb === 0 && ap === 0 ? 0 : (Math.atan2(bb, ap) / rad + 360) % 360);
  const [hp1, hp2] = [hue(b1, ap1), hue(b2, ap2)];
  const dL = L2 - L1;
  const dC = Cp2 - Cp1;
  let dh = hp2 - hp1;
  if (Cp1 * Cp2 === 0) dh = 0;
  else if (dh > 180) dh -= 360;
  else if (dh < -180) dh += 360;
  const dH = 2 * Math.sqrt(Cp1 * Cp2) * Math.sin((dh / 2) * rad);
  const Lm = (L1 + L2) / 2;
  const Cpm = (Cp1 + Cp2) / 2;
  let hm = hp1 + hp2;
  if (Cp1 * Cp2 !== 0)
    hm = Math.abs(hp1 - hp2) > 180 ? (hp1 + hp2 + (hp1 + hp2 < 360 ? 360 : -360)) / 2 : (hp1 + hp2) / 2;
  const T =
    1 -
    0.17 * Math.cos((hm - 30) * rad) +
    0.24 * Math.cos(2 * hm * rad) +
    0.32 * Math.cos((3 * hm + 6) * rad) -
    0.2 * Math.cos((4 * hm - 63) * rad);
  const SL = 1 + (0.015 * (Lm - 50) ** 2) / Math.sqrt(20 + (Lm - 50) ** 2);
  const SC = 1 + 0.045 * Cpm;
  const SH = 1 + 0.015 * Cpm * T;
  const RT =
    -2 *
    Math.sqrt(Cpm ** 7 / (Cpm ** 7 + 25 ** 7)) *
    Math.sin(60 * Math.exp(-(((hm - 275) / 25) ** 2)) * rad);
  return Math.sqrt((dL / SL) ** 2 + (dC / SC) ** 2 + (dH / SH) ** 2 + RT * (dC / SC) * (dH / SH));
}

/** How a colour looks with no working green or red cones (Machado et al. 2009, severity 1). */
const VISION: Record<string, number[][] | null> = {
  usual: null,
  deuteranopia: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  protanopia: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
};
function seenWith(hex: string, matrix: number[][] | null): string {
  if (!matrix) return hex;
  const lin = rgb(hex).map(linear);
  const out = matrix.map((row) =>
    Math.min(
      1,
      Math.max(
        0,
        row.reduce((sum, m, i) => sum + m * (lin[i] ?? 0), 0),
      ),
    ),
  );
  const gamma = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
  return `#${out
    .map((c) =>
      Math.round(gamma(c) * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

describe('colours that must never be confused: the report (Session 26 sets the floor)', () => {
  it('measures the primary button, LIVE and ON AIR apart (CIEDE2000), with usual and red-green colour vision', () => {
    const pairs = [
      ['accent-strong', 'live'],
      ['accent-strong', 'onair'],
      ['live', 'onair'],
    ] as const;
    const rows = pairs.flatMap(([a, b]) =>
      Object.entries(VISION).map(([vision, m]) => ({
        pair: `${a} / ${b}`,
        vision,
        deltaE00: Math.round(deltaE00(seenWith(colour(a), m), seenWith(colour(b), m)) * 10) / 10,
      })),
    );
    // A report, not a gate, this session: the primary and ON AIR are nearly one colour to a deuteranope.
    console.info(
      `Colour distance (ΔE00; 10 is the floor proposed for Session 26):\n${rows.map((r) => `  ${r.pair.padEnd(26)} ${r.vision.padEnd(13)} ${String(r.deltaE00)}`).join('\n')}`,
    );
    for (const r of rows) expect(Number.isFinite(r.deltaE00)).toBe(true);
    // The formula itself, against published test pairs (Sharma, Wu and Dalal 2005: pairs 1 and 17).
    expect(deltaE00Lab([50, 2.6772, -79.7751], [50, 0, -82.7485])).toBeCloseTo(2.0425, 4);
    expect(deltaE00Lab([50, 2.5, 0], [73, 25, -18])).toBeCloseTo(27.1492, 4);
    expect(deltaE00('#123456', '#123456')).toBe(0);
  });
});
