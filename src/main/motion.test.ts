import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * Motion in the interface is all tokens (Session 26g, Diya's "Rising", the design lab's table):
 * every duration, delay and easing is a --dur-*, --delay-*, --stagger-* or --ease-* in app.css, with
 * the lab's values, and nothing in the window's code or styles uses a number of its own. The
 * audience screens' own motion (render/, output/, program/, the stage display) is the show's, not
 * the interface's: Session 27.
 */

const renderer = join(__dirname, '..', 'renderer', 'src');
const css = readFileSync(join(renderer, 'styles', 'app.css'), 'utf8');

/** The :root block that holds the tokens. */
const rootBlock = (() => {
  const at = /^:root\s*\{/mu.exec(css)?.index ?? -1;
  const end = css.indexOf('\n}', at);
  return at < 0 ? '' : css.slice(at, end + 2);
})();
const token = (name: string) => new RegExp(`--${name}:\\s*([^;]+);`, 'u').exec(rootBlock)?.[1]?.trim();

/** The design lab's table (design-lab/diya/README.md, "Motion"), with the few the build added. */
const TABLE: Record<string, string> = {
  'dur-instant': '0ms',
  'dur-press': '90ms',
  'dur-hover': '120ms',
  'dur-exit': '150ms',
  'dur-menu': '160ms',
  'dur-notice': '200ms',
  'dur-dialog': '220ms',
  'dur-scrim': '200ms',
  'dur-panel': '240ms',
  'dur-move': '180ms',
  'dur-step': '320ms',
  'dur-empty': '520ms',
  'dur-light': '1400ms',
  'ease-out': 'cubic-bezier(0.23, 1, 0.32, 1)',
  'ease-drawer': 'cubic-bezier(0.32, 0.72, 0, 1)',
  'ease-in-out': 'cubic-bezier(0.65, 0, 0.35, 1)',
  'ease-flame': 'cubic-bezier(0.2, 0.8, 0.25, 1)',
  'rise-notice': '6px',
  rise: '8px',
  'rise-lg': '14px',
  'slide-sheet': '16px',
};

/** The window's own code: every .ts and .tsx under src/renderer/src but the audience screens'. */
const AUDIENCE = ['render', 'output', 'program', join('web', 'stage'), 'sharpen', 'audio'];
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return AUDIENCE.includes(relative(renderer, path)) ? [] : files(path);
    return /\.tsx?$/u.test(name) && !/\.test\.tsx?$/u.test(name) ? [path] : [];
  });
}

/** A number of its own, where motion is said: a class, an inline style, or an animate() call. */
const OWN_NUMBERS: readonly (readonly [RegExp, string])[] = [
  [/\b(?:duration|delay)-(?:\d|\[)/u, 'a Tailwind duration or delay'],
  [/\bease-\[/u, 'a Tailwind easing of its own'],
  [/\banimate-(?:\[|ping|pulse|bounce)\b/u, 'a Tailwind animation of its own'],
  [
    /\b(?:transition|animation)(?:Duration|Delay)?:\s*['"`][^'"`]*\d+m?s\b/u,
    'an inline transition or animation',
  ],
  [/\bduration:\s*\d/u, 'an animate() with its own duration'],
  [/\beasing:\s*['"`]/u, 'an animate() with its own easing'],
];

describe('motion in the interface is tokens', () => {
  it('has the design lab’s table, every duration and easing a token', () => {
    const wrong = Object.entries(TABLE)
      .filter(([name, value]) => token(name) !== value)
      .map(([name, value]) => `--${name}: ${token(name) ?? 'missing'} (the table says ${value})`);
    expect(wrong).toEqual([]);
  });

  it('Tailwind’s own transitions and the spinner take the tokens', () => {
    expect(css).toMatch(/--default-transition-duration:\s*var\(--dur-hover\)/u);
    expect(css).toMatch(/--default-transition-timing-function:\s*var\(--ease-out\)/u);
    expect(css).toMatch(/--animate-spin:\s*spin var\(--dur-spin\)/u);
  });

  it('app.css uses no number of its own for an animation or transition', () => {
    const outside = css.replace(rootBlock, '');
    const own = [...outside.matchAll(/\b(animation|transition)(?:-duration|-delay)?\s*:\s*([^;]+);/gu)]
      .map((m) => m[0])
      // The audience screens' reduced motion, as it always was (their motion is the show's).
      .filter((d) => !/^(animation|transition)-duration:\s*0\.01ms !important;$/u.test(d))
      .filter((d) => /\d+(?:\.\d+)?m?s\b/u.test(d.replace(/var\([^)]*\)/gu, '')));
    expect(own).toEqual([]);
  });

  it('would see a number of its own (the patterns, on lines that have one)', () => {
    const bad = [
      '<div className="transition-opacity duration-300">',
      '<div className="delay-[40ms]">',
      "style={{ transition: 'opacity 200ms ease-out' }}",
      "row.animate(frames, { duration: 180, easing: 'ease-out' });",
      '<span className="animate-pulse">',
    ];
    for (const line of bad)
      expect(
        OWN_NUMBERS.some(([pattern]) => pattern.test(line)),
        line,
      ).toBe(true);
    const good = [
      '<div className="transition-colors">',
      'row.animate(frames, { duration: time, easing: curve });',
    ];
    for (const line of good)
      expect(
        OWN_NUMBERS.some(([pattern]) => pattern.test(line)),
        line,
      ).toBe(false);
  });

  it('the window’s code says no duration, delay or easing of its own', () => {
    const found: string[] = [];
    for (const file of files(renderer)) {
      const text = readFileSync(file, 'utf8');
      text.split('\n').forEach((line, i) => {
        for (const [pattern, what] of OWN_NUMBERS)
          if (pattern.test(line)) found.push(`${relative(renderer, file)}:${String(i + 1)}: ${what}`);
      });
    }
    expect(found).toEqual([]);
  });
});
