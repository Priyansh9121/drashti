import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  KIND_KEEP_MS,
  keeperMove,
  keeperShift,
  onWholePixels,
  PanelKindKeeper,
  PanelWarmUp,
} from './PanelWarmUp';

/*
 * The Stream panel's pieces drawn unseen with the LIVE picture's warm-up (Session 60, X21's second part). A graphics
 * chip draws a tile that holds a path (an icon) multisampled and one with none plainly, and makes each kind of drawing
 * once for each: so the pieces come twice, once beside icons and once with none, each in a layer of its own; and on
 * whole device pixels, as the panel draws them (a box between pixels is drawn another way, its edges smoothed).
 */

const markup = () => renderToStaticMarkup(createElement(PanelWarmUp));
/** The real panel's words, which a test may look for while the warm-up is still drawn. */
const PANEL_WORDS = ['Go live', 'Window for Zoom', 'Stream settings', 'Close stream', 'Starting the stream'];

/** Each layer of pieces (the root's children), as markup. */
function layers(html: string): string[] {
  const doc = html.replace(/^<div[^>]*>/u, '').replace(/<\/div>$/u, '');
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  for (const m of doc.matchAll(/<(\/?)div\b[^>]*>/gu)) {
    if (m[1] === '') {
      if (depth === 0) start = m.index;
      depth++;
    } else {
      depth--;
      if (depth === 0) out.push(doc.slice(start, m.index + m[0].length));
    }
  }
  return out;
}

describe('the Stream panel’s pieces, warmed unseen', () => {
  it('come twice, each in a layer of its own under brightness(0): one beside icons, one with none', () => {
    const [withIcons = '', plain = ''] = layers(markup());
    for (const layer of [withIcons, plain]) {
      expect(layer).toContain('will-change-transform');
      expect(layer).toContain('[filter:brightness(0)]');
      // The primary button (its gradient, inset light, ring and glow), a card's and the sheet's shadows, the dim, the
      // Program box's picture.
      expect(layer).toContain('from-primary-hi');
      expect(layer).toContain('shadow-primary');
      expect(layer).toContain('shadow-card');
      expect(layer).toContain('shadow-overlay');
      expect(layer).toContain('bg-black/60');
      expect(layer).toContain('<canvas');
      // A see-through fill under rounded corners narrower than their radius (rounded-lg, 8 px: a 4 px bar), and the
      // meter's quiet bar the same.
      expect(layer).toMatch(/overflow-hidden rounded-lg"><span class="block h-full w-1 bg-black\/60"/u);
      expect(layer).toMatch(/rounded-full[^"]*"><span class="block h-full w-1 bg-success"/u);
      // The sheet's shadow where its box is not: the box just above a clip, its shadow's tail inside it.
      expect(layer).toMatch(/overflow-hidden"><span class="absolute -top-10 [^"]*shadow-overlay"/u);
    }
    expect(withIcons).toContain('<svg');
    expect(withIcons).toContain('animate-spin');
    expect(plain).not.toContain('<svg');
  });

  it('can’t be reached or read out, has no button, and its words are none of the panel’s', () => {
    const html = markup();
    expect(html).toMatch(/^<div[^>]*aria-hidden="true"[^>]*inert=""[^>]*data-chip-warm-up=""/u);
    expect(html.match(/data-testid=/gu)).toHaveLength(1);
    // Nothing in it is a button: the window's one primary stays its own (first-start.spec.ts, next-thing.spec.ts).
    expect(html).not.toContain('<button');
    expect(html).not.toContain('data-variant');
    for (const words of PANEL_WORDS) expect(html).not.toContain(words);
  });

  it('has the preview’s picture beneath, unfiltered: a canvas the graphics chip draws, under rounded corners', () => {
    // At least 128 x 129 px, so Chromium draws it on the GPU as a layer of its own (smaller, it is drawn in its tile).
    expect(markup()).toMatch(
      /^<div[^>]*><span class="absolute [^"]*overflow-hidden rounded-lg[^"]*"><canvas width="320" height="180"/u,
    );
    const [withIcons = '', plain = ''] = layers(markup());
    expect(withIcons + plain).not.toContain('width="320"');
  });

  it('starts on a whole device pixel', () => {
    expect(onWholePixels(10, 3, 1)).toEqual({ dx: 0, dy: 0 });
    expect(onWholePixels(10.5, 3.25, 1)).toEqual({ dx: 0.5, dy: -0.25 });
    // Two device pixels a CSS pixel: a half is whole already, a quarter is not.
    expect(onWholePixels(10.5, 3.25, 2)).toEqual({ dx: 0, dy: 0.25 });
    // A ratio it cannot read counts as one.
    expect(onWholePixels(10.5, 3, Number.NaN)).toEqual({ dx: 0.5, dy: 0 });
    expect(onWholePixels(Number.NaN, 3, 1)).toEqual({ dx: 0, dy: 0 });
  });
});

/*
 * The primary button's kind kept in use (the owner's "A + keep tracing", Q60-9). The warm-up makes it at the start, but
 * the GPU's pipeline cache drops a kind left unused for minutes: in the Performance check's step, about seven minutes
 * in, the Stream panel's Go live made it again (its compile 184 ms on CI's Mac, the hall's frame 183 ms: x21-macos-21's
 * trace). So the LIVE heading keeps a tiny copy of it, drawn again every KIND_KEEP_MS under a cover of the panel's own
 * colour: the gradient and its inset light under rounded corners, beside an icon (a tile with a path is multisampled).
 */
describe('the primary button’s kind, kept in use', () => {
  const keeper = () => renderToStaticMarkup(createElement(PanelKindKeeper));

  it('draws the primary’s gradient and inset light under rounded corners beside an icon, a layer of its own', () => {
    const html = keeper();
    expect(html).toMatch(/^<span[^>]*aria-hidden="true"[^>]*inert=""[^>]*data-chip-warm-up=""/u);
    expect(html).toContain('will-change-transform');
    expect(html).toMatch(/rounded-lg[^"]*bg-linear-to-b from-primary-hi via-primary via-55% to-primary-lo/u);
    expect(html).toContain('shadow-[inset_0_1px_0_var(--depth-primary-top)]');
    expect(html).toContain('<svg');
    expect(html).not.toContain('<button');
  });

  it('is hidden under a cover of the panel’s colour drawn after it, a pixel larger all round', () => {
    const html = keeper();
    const cover = html.lastIndexOf('<span class="absolute inset-px bg-panel"');
    expect(cover).toBeGreaterThan(html.indexOf('from-primary-hi'));
    expect(html).toMatch(/<span class="absolute inset-\[2px\] [^"]*from-primary-hi/u);
  });

  it('leaves its layer’s edge uncovered: a tile all of one colour is never drawn (Chromium shows it as that colour)', () => {
    // The cover is inset a pixel from the layer, so the layer is not one colour: x21-macos-25's trace at 94b70d52,
    // with the cover filling the layer, still made the primary's kind new at the step.
    expect(keeper()).not.toContain('class="absolute inset-0 bg-panel"');
  });

  it('starts on a whole device pixel, wherever the heading falls', () => {
    // Measured with the shift it has, so a second look keeps a whole pixel.
    expect(keeperShift({ left: 720.5, top: 63.25 }, { dx: 0, dy: 0 }, 1)).toEqual({ dx: 0.5, dy: -0.25 });
    expect(keeperShift({ left: 721, top: 63 }, { dx: 0.5, dy: -0.25 }, 1)).toEqual({ dx: 0.5, dy: -0.25 });
    expect(keeperShift({ left: 720, top: 63 }, { dx: 0, dy: 0 }, 2)).toEqual({ dx: 0, dy: 0 });
  });

  it('draws it again the same way: the whole button a pixel down, never its background moved within it', () => {
    // Its background moved a pixel within its box (background-position 0 1px, a24-streamwarm) was drawn as a repeated
    // picture: CI's Mac made two kinds of its own at the keeper's first step, 20 s after the window opened (the gradient
    // drawn into a picture first, then that picture under the rounded corners), as the Stream panel's test traced.
    const still = keeperMove(false);
    const moved = keeperMove(true);
    expect(still).toEqual({});
    expect(moved).toEqual({ transform: 'translateY(1px)' });
    for (const step of [still, moved])
      expect(Object.keys(step).some((k) => k.startsWith('background'))).toBe(false);
    expect(keeper()).not.toContain('background-position');
  });

  it('draws it again often enough to stay in the GPU’s cache', () => {
    expect(KIND_KEEP_MS).toBeGreaterThanOrEqual(5_000);
    expect(KIND_KEEP_MS).toBeLessThanOrEqual(30_000);
  });
});
