import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contrastRatio, luminance, over, toLab } from '../shared/contrast';
import type { Appearance } from '../shared/appearance/appearances';
import { BLACK, WHITE } from '../shared/appearance/appearances';
import { ZONES, type Zone } from '../shared/appearance/zones';

/*
 * B · Depth (alpha.24, the owner's QA24-UI-4): src/renderer/src/styles/look-depth.css, read from the source (here, as
 * motion.test.ts and contrast.test.ts read app.css: a renderer's tests have no Node). The operator window alone
 * loads it, once; every rule is the Depth look's (:root[data-window-look='depth']) and none applies in forced colours;
 * it draws nothing that costs a computer without a graphics chip a new way of drawing (no gradient, no blur, no glow,
 * no backdrop filter, no layer of its own, no animation, no number of its own for a transition); its tokens are one
 * radius scale, one elevation scale and one state set; every surface it draws is one the appearance's rules measure
 * (ink, panel, panel-2 and panel-3 of the zone: rules.ts), and the words read on the few colours of its own (a
 * control's hover and press, a section's row, LIVE's tint) at 4.5:1 or more, in Black and in White (what Follow the
 * computer shows).
 */

const renderer = join(__dirname, '..', 'renderer', 'src');
const FILE = join(renderer, 'styles', 'look-depth.css');
const source = existsSync(FILE) ? readFileSync(FILE, 'utf8') : '';
const css = source.replace(/\/\*[\s\S]*?\*\//gu, '');

const SCOPE = ":root[data-window-look='depth']";
const OUTER = '@media not (forced-colors: active)';

/** The text inside the one outer block, or '' when the file is not that block alone. */
const inner = (() => {
  const text = css.trim();
  if (!text.startsWith(OUTER)) return '';
  const open = text.indexOf('{');
  return text.endsWith('}') ? text.slice(open + 1, -1) : '';
})();

/** Split at commas outside brackets. */
function topLevel(list: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let part = '';
  for (const ch of list) {
    if (ch === '(' || ch === '[') depth += 1;
    if (ch === ')' || ch === ']') depth -= 1;
    if (ch === ',' && depth === 0) {
      out.push(part.trim());
      part = '';
    } else part += ch;
  }
  if (part.trim() !== '') out.push(part.trim());
  return out;
}

interface Rule {
  selector: string;
  decls: Record<string, string>;
}
const rules: Rule[] = [...inner.matchAll(/([^{}]+)\{([^{}]*)\}/gu)].map((m) => ({
  selector: (m[1] ?? '').trim().replace(/\s+/gu, ' '),
  decls: Object.fromEntries(
    (m[2] ?? '')
      .split(';')
      .map((d) => d.trim())
      .filter((d) => d !== '')
      .map((d) => {
        const at = d.indexOf(':');
        return [
          d.slice(0, at).trim(),
          d
            .slice(at + 1)
            .trim()
            .replace(/\s+/gu, ' '),
        ];
      }),
  ),
}));

/** The declarations of the rules whose selector is exactly this. */
const block = (selector: string): Record<string, string> =>
  Object.assign({}, ...rules.filter((r) => r.selector === selector).map((r) => r.decls)) as Record<
    string,
    string
  >;

const BASES = { dark: BLACK, light: WHITE } as const;
type Base = keyof typeof BASES;
const SURFACES = ['ink', 'panel', 'panel-2', 'panel-3'] as const;
type Surface = (typeof SURFACES)[number];

/** The ground in this base (lead 2's nearer-the-mockup round: darker than the window's own ink). */
const groundOf = (base: Base): string => block(`${SCOPE}[data-base='${base}']`)['--depth-ground'] ?? '';

/** A zone's surfaces as Depth draws them in this base: the zone's own, moved as look-depth.css says. */
function surfacesOf(a: Appearance, base: Base, zone: Zone): Record<Surface, string> {
  const own = a.zones[zone];
  const moved = {
    ...block(`${SCOPE} [data-zone='${zone}']`),
    ...block(`${SCOPE}[data-base='${base}'] [data-zone='${zone}']`),
  };
  const out = Object.fromEntries(SURFACES.map((s) => [s, own[s]])) as Record<Surface, string>;
  for (const s of SURFACES) {
    const v = moved[`--color-${s}`];
    if (v === undefined) continue;
    if (v === 'var(--depth-ground)') {
      out[s] = groundOf(base);
      continue;
    }
    const to = new RegExp(`^var\\(--zone-${zone}-(ink|panel|panel-2|panel-3)\\)$`, 'u').exec(v)?.[1];
    if (!to) throw new Error(`${zone}: --color-${s} is ${v}, not one of the zone's measured surfaces`);
    out[s] = own[to as Surface];
  }
  return out;
}

/** A Depth colour (a token's value) over a surface, as the page draws it: "#rrggbb". */
function drawn(value: string, colours: Record<string, string>, under: string): string {
  const named = (v: string) => {
    const name = /^var\(--color-([\w-]+)\)$/u.exec(v.trim())?.[1];
    const hex = name === undefined ? undefined : colours[name];
    if (hex === undefined) throw new Error(`cannot read ${v}`);
    return hex;
  };
  const mix =
    /^color-mix\(in srgb, (var\(--color-[\w-]+\)) (\d+(?:\.\d+)?)%, (transparent|var\(--color-[\w-]+\))\)$/u.exec(
      value,
    );
  if (mix) {
    const top = named(mix[1] ?? '');
    const share = Number(mix[2]) / 100;
    return over(top, share, mix[3] === 'transparent' ? under : named(mix[3] ?? ''));
  }
  const hex8 = /^#([0-9a-f]{6})([0-9a-f]{2})$/u.exec(value);
  if (hex8) return over(`#${hex8[1] ?? ''}`, parseInt(hex8[2] ?? '0', 16) / 255, under);
  return named(value);
}

/** The words that sit on controls, rows and sections: they read at 4.5:1 there (WCAG 1.4.3). */
const WORDS = [
  'fg',
  'muted',
  'faint',
  'accent',
  'danger',
  'warning-fg',
  'success-fg',
  'danger-fg',
  'rec',
] as const; // every text colour rules.ts measures on every surface (the release lead's review, S2)

describe('B · Depth: styles/look-depth.css', () => {
  it('is there, loaded by the operator window alone, once (never the screens in the hall, the stream or the phones)', () => {
    expect(source, 'look-depth.css').not.toBe('');
    const mains: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        // An import of it (a comment that names it is no import).
        else if (
          /\.(tsx?|css)$/u.test(name) &&
          /(?:^import\s+|@import\s+)['"][^'"]*look-depth\.css['"]/mu.test(readFileSync(path, 'utf8'))
        )
          mains.push(relative(renderer, path).split('\\').join('/'));
      }
    };
    walk(renderer);
    expect(mains.filter((m) => !m.endsWith('.test.ts'))).toEqual(['operator/main.tsx']);
    const main = readFileSync(join(renderer, 'operator', 'main.tsx'), 'utf8');
    expect(main.match(/^import '\.\.\/styles\/look-depth\.css';$/gmu)?.length).toBe(1);
  });

  it('is all the Depth look’s, and none of it in forced colours', () => {
    expect(inner, `the whole file in one ${OUTER} block`).not.toBe('');
    expect(rules.length).toBeGreaterThan(10);
    const outside = rules.flatMap((r) => topLevel(r.selector).filter((s) => !s.startsWith(SCOPE)));
    expect(outside).toEqual([]);
  });

  it('draws no new way: no gradient, blur, glow, backdrop filter, layer, animation or timing of its own', () => {
    const all = rules.flatMap((r) => Object.entries(r.decls).map(([p, v]) => `${r.selector} { ${p}: ${v} }`));
    const banned = all.filter((d) =>
      /gradient\(|backdrop-filter|blur\(|will-change|translateZ|translate3d|animation|!important|filter:/u.test(
        d,
      ),
    );
    expect(banned).toEqual([]);
    expect(css).not.toMatch(/@keyframes/u);
    // A transition only of colours, on the motion's tokens.
    const transitions = all.filter((d) => /\btransition/u.test(d));
    expect(transitions.filter((d) => /\d+(?:\.\d+)?m?s\b/u.test(d.replace(/var\([^)]*\)/gu, '')))).toEqual(
      [],
    );
    // Every shadow a ring or an inset light: never blurred (a blur round a rounded corner is a new way of drawing).
    const blurred = rules.flatMap((r) => {
      const shadow = r.decls['box-shadow'];
      if (shadow === undefined || shadow === 'none') return [];
      return topLevel(shadow)
        .filter((part) => !part.includes('inset'))
        .filter((part) => {
          const lengths = [...part.replace(/var\([^)]*\)/gu, '').matchAll(/(-?[\d.]+)(?:px)?\b/gu)].map((m) =>
            Number(m[1]),
          );
          return (lengths[2] ?? 0) !== 0;
        })
        .map((part) => `${r.selector}: ${part}`);
    });
    expect(blurred).toEqual([]);
  });

  it('has one radius scale, one elevation scale and one state set', () => {
    expect(block(SCOPE)).toMatchObject({
      '--radius-row': 'var(--radius-md)',
      '--radius-panel': 'var(--radius-lg)',
      '--radius-pill': '9999px',
      '--depth-gap': '4px',
      '--type-title': '1.0625rem',
    });
    const states = block(`${SCOPE} :is(body, [data-zone])`);
    expect(states).toMatchObject({
      '--state-fill': 'var(--color-panel-3)',
      // A section's row an opaque colour of its own (a 3 % lift of its column's panel): a fold's fading copy of the
      // section's insides is drawn on the first opaque colour round them (uimotion's ui/fold.ts), so the row's own.
      '--state-row': 'color-mix(in srgb, var(--color-fg) 3%, var(--color-panel))',
    });
    for (const base of ['dark', 'light'] as const) {
      const look = block(`${SCOPE}[data-base='${base}']`);
      const own = block(`${SCOPE}[data-base='${base}'] :is(body, [data-zone])`);
      expect(own['--state-hover'], `${base}: hover`).toBeDefined();
      expect(own['--state-press'], `${base}: press`).toBeDefined();
      expect(own['--state-live-base'], `${base}: the live row's own surface`).toMatch(
        /^var\(--color-panel-[23]\)$/u,
      );
      // A panel's light along its top, seen (the mockup's 1 px inset highlight): at least 9 % white on a dark panel,
      // and on a light one all but white.
      const light = look['--elev-light'] ?? '';
      expect(light, `${base}: a panel's light`).toMatch(/^#ffffff([0-9a-f]{2})?$/u);
      const lightAlpha = light.length === 9 ? parseInt(light.slice(7), 16) / 255 : 1;
      expect(lightAlpha, `${base}: a panel's light`).toBeGreaterThanOrEqual(base === 'dark' ? 0.09 : 0.7);
      expect(look['--depth-ground'], `${base}: the ground`).toMatch(/^#[0-9a-f]{6}$/u);
      // LIVE's tint and ring: LIVE's own red (the same in Black and White), see-through.
      for (const name of ['--state-live-tint', '--state-live-ring']) {
        const v = look[name] ?? '';
        expect(v.slice(0, 7), `${base}: ${name}`).toBe(BASES[base].colours.live);
        const alpha = parseInt(v.slice(7), 16) / 255;
        expect(alpha, `${base}: ${name}`).toBeGreaterThan(0);
        expect(alpha, `${base}: ${name}`).toBeLessThan(0.3);
      }
    }
  });

  it('rounds the columns with no rounded clip: square columns clipped to their box, a ring of the ground over their corners', () => {
    // The release lead's review, S1: a rounded overflow clip over a column's scrolling parts may cost a layer drawn
    // afresh at every frame; a square clip and a no-blur ring in the ground's colour round the corners instead.
    // The columns' own rules (their ::after ring is the one rounded thing, over them).
    const columns = rules.filter(
      (r) => r.selector.includes("[data-testid='column-middle']") && !r.selector.endsWith('::after'),
    );
    for (const r of columns) {
      const rounded = r.decls['border-radius'];
      if (rounded !== undefined) expect(rounded, r.selector).toBe('0');
      if (r.decls['overflow'] !== undefined) expect(r.decls['overflow'], r.selector).toBe('clip');
    }
    const mask = rules.find(
      (r) => r.selector.endsWith('::after') && r.selector.includes("[data-testid='column-left']"),
    );
    expect(mask?.decls).toMatchObject({
      content: "''",
      position: 'absolute',
      inset: '0',
      'border-radius': 'var(--radius-panel)',
      'box-shadow': '0 0 0 var(--radius-panel) var(--depth-ground)',
      'pointer-events': 'none',
    });
  });

  it('keeps the live picture at the width and place it had before Depth: it reaches the gaps’ room back', () => {
    // a24-lookgap: the columns' 4 px gaps (border-inline) made the live picture 8 px narrower and 4 px over, and the
    // graphics chip drew a wide deck's first Cover a new way mid-show (CI's Mac, deck-cover-pipelines.spec.ts:144).
    const gap = block(
      `${SCOPE} :is([data-testid='column-left'], [data-testid='column-middle'], [data-testid='column-right'])`,
    )['border-inline'];
    expect(gap).toBe('var(--depth-gap) solid transparent');
    expect(block(`${SCOPE} [data-testid='column-right'] [data-testid='live-preview']`)['margin-inline']).toBe(
      'calc(-1 * var(--depth-gap))',
    );
    // Back, Next and the next picture's row and Oops's line with it, so they line up with the picture's edges as in a
    // flat look (lead 2's lookcheck of a24-lookgap: they were 4 px inside them; look-depth.spec measures it).
    expect(
      block(
        `${SCOPE} [data-testid='column-right'] :is(:has(> [data-testid='show-back']), :has(> [data-testid='show-oops']))`,
      )['margin-inline'],
    ).toBe('calc(-1 * var(--depth-gap))');
  });

  it('Follow the computer’s picture in the Appearance window draws in Depth’s own colours, this file’s', () => {
    // The alpha.25 list's item 9: appearance/DepthPreview.tsx draws Follow the computer's picture as Depth draws the
    // window (follow-preview.test.ts reads what it draws); its ground, a panel's light and LIVE's ring are these.
    const file = join(renderer, 'appearance', 'DepthPreview.tsx');
    const preview = existsSync(file) ? readFileSync(file, 'utf8') : '';
    for (const base of ['dark', 'light'] as const) {
      const look = block(`${SCOPE}[data-base='${base}']`);
      const own = new RegExp(
        `\\b${base}: \\{ ground: '(#[0-9a-f]+)', light: '(#[0-9a-f]+)', ring: '(#[0-9a-f]+)' \\}`,
        'u',
      ).exec(preview);
      expect(own?.slice(1), `${base}: DepthPreview.tsx's colours`).toEqual([
        look['--depth-ground'],
        look['--elev-light'],
        look['--state-live-ring'],
      ]);
    }
  });

  it('LIVE is a red ring and a light red tint, never a glow: the live picture and the live row', () => {
    // Inside its frame exactly as before (the light along its top: warm-up.spec compares the picture's own pixels).
    expect(block(`${SCOPE} [data-testid='live-preview']`)['box-shadow']).toBe(
      'inset 0 1px 0 var(--depth-light)',
    );
    const picture = block(`${SCOPE} [data-testid='live-preview'].border-live-edge`)['box-shadow'] ?? '';
    expect(picture).toMatch(/^inset 0 1px 0 var\(--depth-light\), 0 0 0 \d+px var\(--state-live-ring\)$/u);
    const row = block(`${SCOPE} [data-testid='slide-thumb'][aria-current='true']`)['box-shadow'] ?? '';
    // The tint inside the row's red frame; the red in its shadow, as appearance-drawing.spec reads it.
    expect(row).toMatch(/^inset 0 0 0 \d+px var\(--state-live-tint\)$/u);
  });

  for (const [base, a] of Object.entries(BASES) as [Base, Appearance][])
    it(`${a.name} (Follow the computer, ${base}): only measured surfaces, the ground under the panels, the words at 4.5:1 on every state`, () => {
      const zones = Object.fromEntries(ZONES.map((z) => [z, surfacesOf(a, base, z)])) as Record<
        Zone,
        Record<Surface, string>
      >;
      const ground = groundOf(base);
      // A darker ground than the window's own ink, with a clear tonal step to each panel (CIELAB lightness).
      expect(luminance(ground), 'the ground darker than the ink').toBeLessThan(luminance(a.colours.ink));
      const step = (x: string) => Math.abs(toLab(x)[0] - toLab(ground)[0]);
      expect(step(a.colours.panel), 'the middle off the ground').toBeGreaterThanOrEqual(4);
      expect(step(a.colours['panel-2']), 'the side columns off the ground').toBeGreaterThanOrEqual(7);
      // On the ground (the top bar, the bars along the bottom): every word at 4.5:1, every control's edge and the
      // keyboard's ring at 3:1 (the header's own: rules.ts, measured here on the ground).
      const onGround = [
        ...(['fg', 'muted', 'faint', 'accent'] as const).map((w) => [w, a.colours[w], 4.5] as const),
        ['on-header', a.decoration['on-header'], 4.5] as const,
        ['on-header-muted', a.decoration['on-header-muted'], 4.5] as const,
        ['header-field', a.decoration['header-field'], 3] as const,
        ['header-ring', a.decoration['header-ring'], 3] as const,
        ['field', a.colours.field, 3] as const,
      ].filter(([, colour, least]) => contrastRatio(colour, ground) < least);
      expect(onGround.map(([w, colour]) => `${w} ${contrastRatio(colour, ground).toFixed(2)}:1`)).toEqual([]);
      // The columns' panels on the ground: the side columns one surface up, the middle the panel; the bar on the ground.
      expect(zones.left.panel).toBe(a.colours['panel-2']);
      expect(zones.right.panel).toBe(a.colours['panel-2']);
      expect(zones.middle.ink).toBe(a.colours.panel);
      expect(zones.bar.panel).toBe(ground);
      for (const z of ['left', 'middle', 'right'] as const)
        expect(contrastRatio(zones[z].panel, ground), `${z} stands off the ground`).toBeGreaterThan(1.04);

      const own = {
        ...block(`${SCOPE} :is(body, [data-zone])`),
        ...block(`${SCOPE}[data-base='${base}'] :is(body, [data-zone])`),
      };
      const look = block(`${SCOPE}[data-base='${base}']`);
      const low: string[] = [];
      for (const zone of ['left', 'middle', 'right'] as const) {
        const colours: Record<string, string> = { ...a.colours, ...zones[zone] };
        const places: Record<string, string> = {
          rest: drawn(own['--state-fill'] ?? '', colours, zones[zone].panel),
          hover: drawn(own['--state-hover'] ?? '', colours, zones[zone].panel),
          press: drawn(own['--state-press'] ?? '', colours, zones[zone].panel),
          row: drawn(own['--state-row'] ?? '', colours, zones[zone].panel),
          // The live row: its tint over its own surface (--state-live-base, in place of SlideRow.tsx's bg-panel-3).
          live: drawn(
            look['--state-live-tint'] ?? '',
            colours,
            drawn(own['--state-live-base'] ?? '', colours, ''),
          ),
        };
        for (const [place, bg] of Object.entries(places))
          for (const word of WORDS) {
            const ratio = contrastRatio(a.colours[word], bg);
            if (ratio < 4.5) low.push(`${zone} ${place} (${bg}): ${word} ${ratio.toFixed(2)}:1`);
          }
        // Hover and press are seen: apart from the control at rest.
        expect(places['hover'], `${zone}: hover`).not.toBe(places['rest']);
        expect(places['press'], `${zone}: press`).not.toBe(places['hover']);
        expect(places['press'], `${zone}: press`).not.toBe(places['rest']);
        // A pill stands off its column (lead 2's hands-on pass: 1.06–1.14:1 was too faint to see).
        expect(
          contrastRatio(places['rest'] ?? '', zones[zone].panel),
          `${zone}: a pill off its column`,
        ).toBeGreaterThanOrEqual(1.1);
      }
      // The sections under LIVE (the alpha.25 list's item 10, uilook's hands-on row 7): a pill on a section's row stands
      // off the row, not only off its column, at rest and pressed (dark was 1.06:1 and 1.00:1), its three states apart,
      // and every word at 4.5:1 on each.
      const right: Record<string, string> = { ...a.colours, ...zones.right };
      const row = drawn(own['--state-row'] ?? '', right, zones.right.panel);
      const onRow = {
        ...own,
        ...block(`${SCOPE} [data-testid='live-rest'] > div > *`),
        ...block(`${SCOPE}[data-base='${base}'] [data-testid='live-rest'] > div > *`),
      };
      const pill: Record<string, string> = {
        rest: drawn(onRow['--state-fill'] ?? '', right, row),
        hover: drawn(onRow['--state-hover'] ?? '', right, row),
        press: drawn(onRow['--state-press'] ?? '', right, row),
      };
      for (const [place, bg] of Object.entries(pill))
        for (const word of WORDS) {
          const ratio = contrastRatio(a.colours[word], bg);
          if (ratio < 4.5) low.push(`a section's row, ${place} (${bg}): ${word} ${ratio.toFixed(2)}:1`);
        }
      expect(contrastRatio(pill['rest'] ?? '', row), 'a pill off its section’s row').toBeGreaterThanOrEqual(
        1.1,
      );
      expect(contrastRatio(pill['press'] ?? '', row), 'a pressed pill off its row').toBeGreaterThanOrEqual(
        1.1,
      );
      expect(pill['hover'], 'on a row: hover').not.toBe(pill['rest']);
      expect(pill['press'], 'on a row: press').not.toBe(pill['rest']);
      expect(pill['press'], 'on a row: press').not.toBe(pill['hover']);
      // LIVE's ring round the live picture by itself, as strong as its pin above (under 0.3) lets it be (item 10: it
      // was 1.22:1 on a dark side column; LIVE itself is carried at 3:1 or more by its red frame).
      const ring = drawn(look['--state-live-ring'] ?? '', right, zones.right.panel);
      expect(contrastRatio(ring, zones.right.panel), 'LIVE’s ring by itself').toBeGreaterThanOrEqual(
        base === 'dark' ? 1.28 : 1.5,
      );
      expect(low).toEqual([]);
    });
});
