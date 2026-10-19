import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * Motion in the interface is all tokens (Session 26g, "Rising", the design lab's table):
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

/** The design lab's table (the design lab's README, "Motion"), with the few the build added. */
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
  // Lively (Session 40), from the motion skills' tables: moving on MD3's standard curve, arrivals 30 ms apart.
  'dur-glide': '240ms',
  'dur-arrive': '220ms',
  'stagger-arrive': '30ms',
  'arrive-most': '8',
  'dur-open': '200ms',
  'dur-crossfade': '200ms',
  'ease-glide': 'cubic-bezier(0.2, 0, 0, 1)',
  'rise-arrive': '6px',
  'press-scale': '0.97',
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

  it('things arrive only in their one-off places, and one after another only on one-off arrivals', () => {
    // Decision 4 (15 Oct 2026): notices, the first start's words and the empty places' steps; never a
    // list, a show control or anything repeated.
    const ARRIVING = new Set([
      join('ui', 'Dialog.tsx'),
      join('ui', 'Menu.tsx'),
      join('ui', 'Notice.tsx'),
      join('ui', 'States.tsx'),
      join('help', 'WhatIsThis.tsx'),
      join('operator', 'StatusBar.tsx'),
      join('operator', 'RecoveryBanner.tsx'),
      join('operator', 'StartHere.tsx'),
      join('setup', 'Welcome.tsx'),
    ]);
    const ONE_AFTER_ANOTHER = new Set([join('operator', 'StartHere.tsx'), join('setup', 'Welcome.tsx')]);
    // Lively (Session 40), Priyansh's choice beside Calm: a playlist's cards just opened arrive one after another,
    // and a folded panel's insides as it opens; never a show control, never while the show changes (ui/motion.ts).
    const LIVELY = new Set([
      join('playlists', 'OpenPlaylist.tsx'),
      join('ui', 'Panel.tsx'),
      join('ui', 'motion.ts'),
    ]);
    const arriving: string[] = [];
    const staggered: string[] = [];
    const lively: string[] = [];
    for (const file of files(renderer)) {
      const text = readFileSync(file, 'utf8');
      const at = relative(renderer, file);
      if (text.includes('data-motion=') && !ARRIVING.has(at)) arriving.push(at);
      if (text.includes("'--i'") && !ONE_AFTER_ANOTHER.has(at) && !LIVELY.has(at)) staggered.push(at);
      if (text.includes('data-lively=') && !LIVELY.has(at)) lively.push(at);
    }
    expect(arriving).toEqual([]);
    expect(staggered).toEqual([]);
    expect(lively).toEqual([]);
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
