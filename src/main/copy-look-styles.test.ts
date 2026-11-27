import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * Lead 2's item 3 for alpha.24 (the release lead's yes): a leaving copy (src/renderer/src/ui/motion.ts, leave) draws in
 * the window's look, not only its colours (src/renderer/src/ui/copy-look.test.ts has the rest). These guards read the
 * styles and motion.ts's two lists from the source, as motion.test.ts and look-depth.test.ts do (a renderer's tests
 * have no Node): the copy's host carries every attribute of <html> B · Depth keys on and none of the interface
 * motion's, the looks' rules that reach a copy start nothing moving, and the copy's frame (its ancestors, drawing
 * nothing) carries no attribute an arrival keys on.
 */

const renderer = join(__dirname, '..', 'renderer', 'src');
const SHEETS: Record<string, string> = {
  'styles/app.css': readFileSync(join(renderer, 'styles', 'app.css'), 'utf8'),
  'ui/motion.css': readFileSync(join(renderer, 'ui', 'motion.css'), 'utf8'),
  'styles/look-depth.css': readFileSync(join(renderer, 'styles', 'look-depth.css'), 'utf8'),
};
const motionTs = readFileSync(join(renderer, 'ui', 'motion.ts'), 'utf8');

/** One of motion.ts's lists of attribute names (`export const NAME: readonly string[] = [ … ]`), as written there. */
const listIn = (name: string) => {
  const list = new RegExp(`export const ${name}: readonly string\\[\\] = \\[([^\\]]*)\\]`, 'u');
  const body = list.exec(motionTs)?.[1] ?? '';
  return [...body.matchAll(/'([^']+)'/gu)].map((m) => m[1] ?? '');
};
const LOOK_KEYS = listIn('LOOK_KEYS');
const FRAME_DROPS = listIn('FRAME_DROPS');

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
    const onLooks = (sel: string) =>
      rootKeys(sel).length > 0 && rootKeys(sel).every((k) => LOOK_KEYS.includes(k));
    const look = all.filter((r) => r.selectors.some(onLooks));
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
      .filter((r) => /(?:^|;)\s*animation(?:-name)?\s*:(?!\s*none\b)/u.test(r.body))
      .flatMap((r) => r.selectors)
      // A rule keyed on the interface motion's attributes of <html> never matches in a copy (its host has none).
      .filter((sel) => !rootKeys(sel).some((k) => MOTION_KEYS.includes(k)))
      .flatMap(attributes)
      // The copy's own (app.css, ui/motion.css: its exit), never a frame's.
      .filter((a) => a !== 'data-leaving');
    expect(named.length).toBeGreaterThan(3);
    expect([...new Set(named)].filter((a) => !FRAME_DROPS.includes(a))).toEqual([]);
  });
});
