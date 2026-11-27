import { describe, expect, it } from 'vitest';
import { FRAME_DROPS, inCopy, LOOK_KEYS, sharedCorners } from './motion';

/*
 * Lead 2's item 3 for alpha.24 (the release lead's yes): a leaving copy (ui/motion.ts, leave) draws in the window's look,
 * not only its colours. B · Depth's rules (styles/look-depth.css) key on <html>'s attributes
 * (`:root[data-window-look='depth']`, `[data-base]`) and on the columns, zones and rows the copied thing sat in
 * (`[data-zone]`, `[data-testid='live-rest'] > div > *`), none of which a shadow root's rules can see: in Depth a fold's
 * copy showed flat buttons with 8 px corners and an edge, and square corners on the rounded row, for its 0.19 s (lead 2's
 * hands-on pass of uilook, row 28). The copy's host carries what the looks key on, its rules take <html>'s part as the
 * host's, and it is drawn inside a frame of the node's ancestors that draws nothing. The styles' own guards (every key
 * Depth uses, nothing moving): src/main/copy-look-styles.test.ts.
 */

describe('a leaving copy’s host carries what the window’s looks key on', () => {
  it('B · Depth’s, and the base', () => {
    expect([...LOOK_KEYS].sort()).toEqual(['data-base', 'data-window-look']);
  });
});

describe('a copy’s frame draws nothing of its own', () => {
  it('carries none of its ancestors’ ids, classes or styles', () => {
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
    const whole = { top: 300.5, right: 999.2, bottom: 420.9, left: 624.4 };
    expect(sharedCorners(whole, ROW, RADII)).toEqual(RADII);
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
