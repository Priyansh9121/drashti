import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FRAME_DROPS, inCopy, LOOK_KEYS, sharedCorners } from './motion';

/*
 * Lead 2's item 3 for alpha.24 (the release lead's yes): a leaving copy (ui/motion.ts, leave) draws in the window's look,
 * not only its colours. B · Depth's rules (styles/look-depth.css) key on <html>'s attributes
 * (`:root[data-window-look='depth']`, `[data-base]`) and on the columns, zones and rows the copied thing sat in
 * (`[data-zone]`, `[data-testid='live-rest'] > div > *`), none of which a shadow root's rules can see: in Depth a fold's
 * copy showed flat buttons with 8 px corners and an edge, and square corners on the rounded row, for its 0.19 s (lead 2's
 * hands-on pass of uilook, row 28). The copy's host carries what the looks key on, its rules take <html>'s part as the
 * host's, and it is drawn inside a frame of the node's ancestors that draws nothing. Read from the source, as
 * motion.test.ts reads app.css.
 */

const SHEETS: Record<string, string> = {
  'styles/app.css': readFileSync(join(__dirname, '..', 'styles', 'app.css'), 'utf8'),
  'ui/motion.css': readFileSync(join(__dirname, 'motion.css'), 'utf8'),
  'styles/look-depth.css': readFileSync(join(__dirname, '..', 'styles', 'look-depth.css'), 'utf8'),
};

/** The interface motion's attributes on <html> (ui/motion.ts, ui/fold.ts, app.css): a copy's host never carries them. */
const MOTION_KEYS = ['data-interface-motion', 'data-chip', 'data-opened', 'data-band-sweep'];

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

/** Every rule of a style sheet, blocks inside an at-rule too: its selectors and its declarations. */
const rules = (text: string) =>
  [...text.replace(/\/\*[\s\S]*?\*\//gu, '').matchAll(/([^{}@;]+)\{([^{}]*)\}/gu)].map((m) => ({
    selectors: topLevel((m[1] ?? '').replace(/\s+/gu, ' ')),
    body: (m[2] ?? '').trim(),
  }));

/** The attributes a selector's own <html> part names (`:root[a][b='c'] …` → a, b), or none. */
const rootKeys = (selector: string) => {
  const root = /^:root((?:\[[^\]]*\])+)/u.exec(selector)?.[1] ?? '';
  return [...root.matchAll(/\[\s*([\w-]+)/gu)].map((m) => m[1] ?? '');
};

/** Every attribute a selector names, anywhere in it. */
const attributes = (selector: string) => [...selector.matchAll(/\[\s*([\w-]+)/gu)].map((m) => m[1] ?? '');

const all = Object.entries(SHEETS).flatMap(([file, text]) => rules(text).map((r) => ({ file, ...r })));

describe('a leaving copy’s host carries what the window’s looks key on', () => {
  it('every attribute of <html> B · Depth keys on', () => {
    const depth = rules(SHEETS['styles/look-depth.css'] ?? '').flatMap((r) => r.selectors.flatMap(rootKeys));
    expect(depth.length).toBeGreaterThan(30);
    expect([...new Set(depth)].filter((k) => !LOOK_KEYS.includes(k))).toEqual([]);
    expect([...LOOK_KEYS].sort()).toEqual(['data-base', 'data-window-look']);
  });

  it('and never the interface motion’s: every attribute of <html> a style keys on is one or the other', () => {
    const keys = new Set(all.flatMap((r) => r.selectors.flatMap(rootKeys)));
    expect([...keys].filter((k) => !LOOK_KEYS.includes(k) && !MOTION_KEYS.includes(k))).toEqual([]);
    expect(MOTION_KEYS.filter((k) => LOOK_KEYS.includes(k))).toEqual([]);
  });

  it('the looks’ rules that reach a copy start nothing moving in it', () => {
    const look = all.filter((r) =>
      r.selectors.some((sel) => rootKeys(sel).length > 0 && rootKeys(sel).every((k) => LOOK_KEYS.includes(k))),
    );
    expect(look.length).toBeGreaterThan(30);
    expect(
      look
        .filter((r) => /(?:^|;)\s*(?:animation|transition)[a-z-]*\s*:/u.test(r.body))
        .map((r) => `${r.file}: ${r.selectors.join(', ')}`),
    ).toEqual([]);
  });
});

describe('a copy’s frame (its ancestors, drawing nothing) starts no arrival in it', () => {
  it('drops every attribute an animation keys on, where a copy can match it', () => {
    const named = all
      .filter((r) => /(?:^|;)\s*animation(?:-name)?\s*:\s*(?!none)/u.test(r.body))
      .flatMap((r) => r.selectors)
      // A rule keyed on the interface motion's attributes of <html> never matches in a copy (its host has none).
      .filter((sel) => !rootKeys(sel).some((k) => MOTION_KEYS.includes(k)))
      .flatMap(attributes)
      // The copy's own (app.css, ui/motion.css: its exit), never a frame's.
      .filter((a) => a !== 'data-leaving');
    expect(named.length).toBeGreaterThan(3);
    expect([...new Set(named)].filter((a) => !FRAME_DROPS.includes(a))).toEqual([]);
  });

  it('nor its ids, classes or styles of its own', () => {
    for (const a of ['id', 'class', 'style']) expect(FRAME_DROPS, a).toContain(a);
  });
});

describe('a copy’s styles see <html>’s part of a look’s rules as their host’s', () => {
  it('takes a look’s <html> part as the host’s, as the browser writes it and as the source does', () => {
    expect(inCopy(':root[data-window-look="depth"] [data-zone="left"] [data-variant]')).toBe(
      ':host([data-window-look="depth"]) [data-zone="left"] [data-variant]',
    );
    expect(inCopy(":root[data-window-look='depth'][data-base='dark'] :is(body, [data-zone])")).toBe(
      ":host([data-window-look='depth'][data-base='dark']) :is(body, [data-zone])",
    );
    expect(inCopy(':root[data-base="light"]')).toBe(':host([data-base="light"])');
    expect(inCopy(':root[data-window-look="depth"], :root[data-base] > .x')).toBe(
      ':host([data-window-look="depth"]), :host([data-base]) > .x',
    );
  });

  it('leaves as it is every <html> part that names the interface motion, or more than attributes', () => {
    for (const sel of [
      ':root[data-interface-motion="lively"][data-chip="yes"] [data-lively="open"]',
      ':root[data-opened][data-chip="yes"] [data-variant]:not([data-show-control])',
      ':root[data-window-look="depth"][data-chip="yes"] .x',
      ':root',
      ':root .x',
      ':root:not([data-base]) .x',
      ':root[data-base="light"]:hover',
      ':root[data-base="light"]::after',
      '.a:root[data-base="light"]',
      ':where(:root[data-base="light"]) .x',
      '.a:root-ish',
    ])
      expect(inCopy(sel), sel).toBe(sel);
  });

  it('names a test id as the copy and its frame carry it, never inside a class name', () => {
    expect(inCopy(':root[data-window-look="depth"] [data-testid="live-rest"] > div > *')).toBe(
      ':host([data-window-look="depth"]) [data-copy-testid="live-rest"] > div > *',
    );
    expect(inCopy('[data-testid] .x, [ data-testid^="section-"]')).toBe(
      '[data-copy-testid] .x, [ data-copy-testid^="section-"]',
    );
    expect(inCopy('.\\[\\&_\\[data-testid\\=x\\]\\]\\:p-1 [data-testid="x"]')).toBe(
      '.\\[\\&_\\[data-testid\\=x\\]\\]\\:p-1 [data-copy-testid="x"]',
    );
    expect(inCopy('[data-testidx="y"]')).toBe('[data-testidx="y"]');
  });

  it('still keeps no :host part of the page’s own selectors', () => {
    expect(inCopy(':root, :host')).toBe(':root');
    expect(inCopy(':host')).toBe(':not(*)');
  });
});

describe('a fold’s copy has the corners of the row it folds out of', () => {
  const ROW = { top: 300, right: 1000, bottom: 420, left: 624 };
  const RADII = { topLeft: '8px', topRight: '8px', bottomRight: '8px', bottomLeft: '8px' };

  it('takes the row’s bottom corners where its insides meet them', () => {
    expect(sharedCorners({ top: 336, right: 1000, bottom: 420, left: 624 }, ROW, RADII)).toEqual({
      topLeft: '',
      topRight: '',
      bottomRight: '8px',
      bottomLeft: '8px',
    });
  });

  it('within a pixel, and all four for the whole row', () => {
    expect(sharedCorners({ top: 300.5, right: 999.2, bottom: 420.9, left: 624.4 }, ROW, RADII)).toEqual(RADII);
  });

  it('none where it meets no corner of the row', () => {
    expect(sharedCorners({ top: 336, right: 990, bottom: 400, left: 634 }, ROW, RADII)).toEqual({
      topLeft: '',
      topRight: '',
      bottomRight: '',
      bottomLeft: '',
    });
  });

  it('each corner its own radius', () => {
    const radii = { topLeft: '1px', topRight: '2px', bottomRight: '3px 4px', bottomLeft: '0px' };
    expect(sharedCorners({ top: 360, right: 1000, bottom: 420, left: 700 }, ROW, radii)).toEqual({
      topLeft: '',
      topRight: '',
      bottomRight: '3px 4px',
      bottomLeft: '',
    });
  });
});
