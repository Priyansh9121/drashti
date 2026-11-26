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
/** The operator window's newer motion (alpha.24, uimotion): the sections' folds and the controls' answers. */
const motionCss = readFileSync(join(renderer, 'ui', 'motion.css'), 'utf8');

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
  // alpha.24 (uimotion, the owner's "more interactive, more animated, more transitions"): out on an ease-in (the
  // release lead's "ease-out in, ease-in out"), a press dims, a hover lifts a pixel (Lively).
  'ease-in': 'cubic-bezier(0.32, 0, 0.67, 0)',
  'press-dim': '0.85',
  lift: '1px',
  // Lively (Session 42): the band sweeps in once as the appearance changes, a block every 40 ms, all of it within
  // the motion skills' 500 ms (one entry under 800 ms, the stagger under 500 ms in all).
  'dur-sweep': '320ms',
  'stagger-sweep': '40ms',
  // Live appearances (Session 60, the owner's Q60-36 (3)): slow loops in the header and the band, on a sine curve.
  'dur-look-fade': '1200ms',
  'dur-look-drift': '40000ms',
  'dur-look-shimmer': '9600ms',
  'dur-look-glint': '14000ms',
  'dur-look-sparkle': '2400ms',
  'dur-look-glow': '4800ms',
  'dur-look-petal': '12000ms',
  'dur-look-puff': '16000ms',
  'dur-look-rain': '1600ms',
  'dur-look-kite': '30000ms',
  'dur-look-cloud': '72000ms',
  'stagger-look': '2400ms',
  'ease-look': 'cubic-bezier(0.37, 0, 0.63, 1)',
  'ease-look-steady': 'linear',
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

  it('app.css and ui/motion.css use no number of their own for an animation or transition', () => {
    const outside = `${css.replace(rootBlock, '')}\n${motionCss}`;
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
    // alpha.24 (uimotion): a tab's panel arrives as another tab is chosen (Lively), in ui/Tabs.tsx.
    const LIVELY = new Set([
      join('playlists', 'OpenPlaylist.tsx'),
      join('ui', 'Panel.tsx'),
      join('ui', 'Tabs.tsx'),
      join('ui', 'motion.ts'),
    ]);
    const arriving: string[] = [];
    const staggered: string[] = [];
    const lively: string[] = [];
    const folding: string[] = [];
    const tabsArrive: boolean[] = [];
    for (const file of files(renderer)) {
      const text = readFileSync(file, 'utf8');
      const at = relative(renderer, file);
      if (text.includes('data-motion=') && !ARRIVING.has(at)) arriving.push(at);
      if (text.includes("'--i'") && !ONE_AFTER_ANOTHER.has(at) && !LIVELY.has(at)) staggered.push(at);
      if (text.includes('data-lively=') && !LIVELY.has(at)) lively.push(at);
      // A section's fold (alpha.24): only a Panel or a PanelGroup folds.
      if (text.includes('data-fold=') && at !== join('ui', 'Panel.tsx')) folding.push(at);
      if (at === join('ui', 'Tabs.tsx')) tabsArrive.push(text.includes('data-lively='));
    }
    expect(arriving).toEqual([]);
    expect(staggered).toEqual([]);
    expect(lively).toEqual([]);
    expect(folding).toEqual([]);
    expect(tabsArrive).toEqual([true]);
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

  /*
   * alpha.24 (uimotion; the owner's QA24-UI-3 "more interactive and more animated, more transitions"; the release
   * lead's perf rules: transform and opacity, nothing while the window opens, nothing without a graphics chip, as a
   * live look's touch): a section under LIVE folds and unfolds, the controls that are not show controls answer the
   * pointer and the keyboard, and Off and reduced motion stop all of it (app.css's own rules).
   */
  /** Every rule of a style sheet: its selectors and its declarations (no nesting in these files). */
  const rules = (text: string) =>
    [...text.replace(/\/\*[\s\S]*?\*\//gu, '').matchAll(/([^{}@]+)\{([^{}]*)\}/gu)].map((m) => ({
      selectors: (m[1] ?? '').split(',').map((sel) => sel.trim().replace(/\s+/gu, ' ')),
      body: (m[2] ?? '').trim(),
    }));
  const ruleFor = (text: string, selector: string) =>
    rules(text).find((r) => r.selectors.includes(selector))?.body ?? '';

  it('a section’s fold: Calm fades its insides in, Lively unrolls them; what folds away leaves as a copy (Calm fading, Lively rolling up)', () => {
    expect(ruleFor(motionCss, "[data-fold='calm']")).toMatch(
      /^animation:\s*fade-in var\(--dur-open\) var\(--ease-out\) both;$/u,
    );
    expect(ruleFor(motionCss, "[data-leaving='fold']")).toMatch(
      /^animation:\s*fade-out var\(--dur-exit\) var\(--ease-in\) both;$/u,
    );
    expect(ruleFor(motionCss, "[data-leaving='fold-lively']")).toMatch(
      /^animation:\s*fold-up calc\(var\(--dur-exit\) \* var\(--lively-time\)\) var\(--ease-in\) both;$/u,
    );
    // Lively's unroll: its insides shown from the top down and faded in, by clip and opacity alone (no box moves).
    expect(
      ruleFor(css, ":root[data-interface-motion='lively'][data-chip='yes'] [data-lively='open']"),
    ).toMatch(
      /^animation:\s*lively-open calc\(var\(--dur-open\) \* var\(--lively-time\)\) var\(--ease-out\) both;$/u,
    );
    const keyframes = (text: string, name: string) =>
      new RegExp(`@keyframes ${name} \\{([\\s\\S]*?)\\n\\}`, 'u').exec(text)?.[1] ?? '';
    expect(keyframes(css, 'lively-open')).toMatch(/clip-path:\s*inset\(0 0 100% 0\)/u);
    expect(keyframes(css, 'lively-open')).not.toMatch(/transform|translate|height/u);
    expect(keyframes(motionCss, 'fold-up')).toMatch(/clip-path:\s*inset\(0 0 100% 0\)/u);
    expect(keyframes(motionCss, 'fold-up')).not.toMatch(/transform|translate|height/u);
  });

  it('the controls’ answers reach no show control, and start only once the window has opened, with a graphics chip', () => {
    const MOVES = /(?:^|;)\s*(?:transition[a-z-]*|translate|filter|rotate)\s*:/u;
    const moving = rules(motionCss).filter((r) => MOVES.test(r.body) && !r.selectors[0]?.startsWith('['));
    expect(moving.length).toBeGreaterThan(0);
    const wrong = moving.flatMap((r) =>
      r.selectors.filter(
        (sel) =>
          !sel.startsWith(":root[data-opened][data-chip='yes']") ||
          (/\[data-variant\]|\[data-row\]|role='tab'|role\^='menuitem'/u.test(sel) &&
            !sel.includes(':not([data-show-control]')),
      ),
    );
    expect(wrong).toEqual([]);
    // The buttons and the fold's chevron named.
    const named = moving.flatMap((r) => r.selectors).join('\n');
    for (const kind of ['[data-variant]', '[data-fold-chevron]']) expect(named, kind).toContain(kind);
    // Only transform and opacity move (lead 2's decision on the hands-on pass, problem 3): a press dims by opacity, and
    // the focus ring is there at once, as before alpha.24, nothing of it moving (the keyboard's checks read it at once).
    expect(
      ruleFor(
        motionCss,
        ":root[data-opened][data-chip='yes'] [data-variant]:not([data-show-control]):not([data-show-control] *):not(:disabled):active",
      ),
    ).toMatch(/^opacity:\s*var\(--press-dim\);/u);
    expect(motionCss).not.toMatch(/outline|brightness|\bfilter:/u);
  });

  /*
   * The release lead's review of uimotion (27 Nov 2026), MUST-1 (option b, answered as recommended, the owner's "till
   * 9:00AM"): without a graphics chip, Lively is held whole and the window looks as Calm's (the new install's default
   * stays Lively). S2: a section's insides that hold a show control are there at once. S3: the chevron turns only for a
   * fold that moves. S6: a menu's choices never ease outside ui/motion.css's guard (and, since the hands-on pass's
   * problem 3, not at all).
   */
  it('all of Lively waits for a graphics chip: every Lively rule in app.css and ui/motion.css names data-chip', () => {
    const lively = [...rules(css), ...rules(motionCss)].flatMap((r) =>
      r.selectors.filter((sel) => sel.includes("[data-interface-motion='lively']")),
    );
    expect(lively.length).toBeGreaterThan(8);
    // Named on <html> itself, with the motion: the root's own part of the selector holds both.
    const onRoot = (sel: string) => sel.split(' ')[0] ?? '';
    expect(lively.filter((sel) => !onRoot(sel).includes("[data-chip='yes']"))).toEqual([]);
  });

  it('a section whose insides hold a show control shows them at once, in Calm and in Lively', () => {
    expect(ruleFor(motionCss, '[data-fold]:has([data-show-control])')).toBe('animation: none;');
    expect(
      ruleFor(
        motionCss,
        ":root[data-interface-motion='lively'][data-chip='yes'] [data-lively='open']:has([data-show-control])",
      ),
    ).toBe('animation: none;');
  });

  it('the chevron turns only for a fold that moves, and a menu’s choices have no transition of their own', () => {
    const turning = rules(motionCss).filter((r) =>
      r.selectors.some((sel) => sel.includes('[data-fold-chevron]')),
    );
    expect(turning.flatMap((r) => r.selectors)).toEqual([
      ":root[data-opened][data-chip='yes'] [data-fold-chevron][data-turning]",
    ]);
    // S6, met by lead 2's decision on the hands-on pass (problem 3): with the ring at once, a menu's choices have no
    // transition at all, neither of their own nor from ui/motion.css.
    expect(motionCss).not.toMatch(/menuitem/u);
    const menu = readFileSync(join(renderer, 'ui', 'Menu.tsx'), 'utf8');
    expect(menu).not.toMatch(/\btransition-colors\b/u);
  });

  /*
   * S4: every control in the sections under LIVE that changes what the hall sees or hears is a show control (Button's
   * or IconButton's `instant`), so none of them ever glides, fades its colour or is covered by a fold's copy.
   */
  it('the sections’ controls that change the hall are show controls', () => {
    const HALL =
      /type:\s*'(?:showMessage|hideMessage|startTimer|resetTimer|showAudienceTimer|hideAudienceTimer|setStageMessage|clearStageMessage)'|counts \? 'pauseTimer'|dispatch\('(?:pauseMusic|resumeMusic|musicNext|musicPrevious)'\)|onClick=\{show\}|\bshow\(r\)|Show the countdown|>\s*Show\s*<\/Button>/u;
    /** Each <Button …> or <IconButton …>: its opening tag, and with a Button's words up to </Button>. */
    const tags = (text: string) =>
      [...text.matchAll(/<(Button|IconButton)\b/gu)].map((m) => {
        let depth = 0;
        let end = m.index;
        for (let i = m.index; i < text.length; i++) {
          const ch = text[i];
          if (ch === '{') depth += 1;
          else if (ch === '}') depth -= 1;
          else if (ch === '>' && depth === 0) {
            end = i;
            break;
          }
        }
        const open = text.slice(m.index, end + 1);
        const words = open.endsWith('/>') ? '' : text.slice(end, text.indexOf('</Button>', end) + 9);
        return { open, all: open + words };
      });
    const FILES: Record<string, number> = {
      [join('operator', 'TimersPanel.tsx')]: 6,
      [join('operator', 'MessagesPanel.tsx')]: 2,
      [join('operator', 'StageControls.tsx')]: 3,
      [join('music', 'MusicPanel.tsx')]: 4,
    };
    for (const [file, count] of Object.entries(FILES)) {
      const hall = tags(readFileSync(join(renderer, file), 'utf8')).filter((t) => HALL.test(t.all));
      expect(hall.length, file).toBe(count);
      expect(
        hall.filter((t) => !/\binstant\b/u.test(t.open)).map((t) => t.open),
        file,
      ).toEqual([]);
    }
  });
});
