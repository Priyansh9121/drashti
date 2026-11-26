import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contrastRatio, over } from '../shared/contrast';
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
const WORDS = ['fg', 'muted', 'faint', 'accent'] as const;

describe('B · Depth: styles/look-depth.css', () => {
  it('is there, loaded by the operator window alone, once (never the screens in the hall, the stream or the phones)', () => {
    expect(source, 'look-depth.css').not.toBe('');
    const mains: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else if (/\.(tsx?|css)$/u.test(name) && readFileSync(path, 'utf8').includes('look-depth.css'))
          mains.push(relative(renderer, path).split('\\').join('/'));
      }
    };
    walk(renderer);
    expect(mains.filter((m) => !m.endsWith('.test.ts'))).toEqual(['operator/main.tsx']);
    const main = readFileSync(join(renderer, 'operator', 'main.tsx'), 'utf8');
    expect(main.match(/look-depth\.css/gu)?.length).toBe(1);
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
      '--state-fill': 'var(--color-panel-2)',
      // A section's row an opaque colour of its own (a 3 % lift of its column's panel): a fold's fading copy of the
      // section's insides is drawn on the first opaque colour round them (uimotion's ui/fold.ts), so the row's own.
      '--state-row': 'color-mix(in srgb, var(--color-fg) 3%, var(--color-panel))',
      '--state-disabled': '0.4',
    });
    for (const base of ['dark', 'light'] as const) {
      const look = block(`${SCOPE}[data-base='${base}']`);
      const own = block(`${SCOPE}[data-base='${base}'] :is(body, [data-zone])`);
      expect(own['--state-hover'], `${base}: hover`).toBeDefined();
      expect(own['--state-press'], `${base}: press`).toBeDefined();
      expect(look['--elev-light'], `${base}: a panel's light`).toMatch(/^#ffffff[0-9a-f]{2}$/u);
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
      const ground = a.colours.ink;
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
          // The live row: its tint over its raised surface (playlists/SlideRow.tsx: bg-panel-3).
          live: drawn(look['--state-live-tint'] ?? '', colours, zones[zone]['panel-3']),
        };
        for (const [place, bg] of Object.entries(places))
          for (const word of WORDS) {
            const ratio = contrastRatio(a.colours[word], bg);
            if (ratio < 4.5) low.push(`${zone} ${place} (${bg}): ${word} ${ratio.toFixed(2)}:1`);
          }
        // Hover and press are seen: apart from the control at rest.
        expect(places['hover'], `${zone}: hover`).not.toBe(places['rest']);
        expect(places['press'], `${zone}: press`).not.toBe(places['hover']);
      }
      expect(low).toEqual([]);
    });
});
