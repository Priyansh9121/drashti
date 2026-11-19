import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { onWholePixels, PanelWarmUp } from './PanelWarmUp';

/*
 * The Stream panel's pieces drawn unseen with the LIVE picture's warm-up (Session 60, X21's second part). A graphics
 * chip draws a tile that holds a path (an icon, or a rounded box's inset light) multisampled and one with none plainly,
 * and makes each kind of drawing once for each: so the pieces come twice, once beside icons and once with no path at
 * all, each in a layer of its own; and on whole device pixels, as the panel draws them (a box between pixels is drawn
 * another way, its edges smoothed).
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
  it('come twice, each in a layer of its own under brightness(0): one beside icons, one with no path at all', () => {
    const [withIcons = '', plain = ''] = layers(markup());
    for (const layer of [withIcons, plain]) {
      expect(layer).toContain('will-change-transform');
      expect(layer).toContain('[filter:brightness(0)]');
      // The primary button's gradient, the sheet's shadow, the dim, see-through under rounded corners, the meter, the
      // Program box's picture.
      expect(layer).toContain('from-primary-hi');
      expect(layer).toContain('shadow-overlay');
      expect(layer.match(/bg-black\/60/gu)?.length).toBeGreaterThanOrEqual(2);
      expect(layer).toContain('rounded-full');
      expect(layer).toContain('<canvas');
    }
    expect(withIcons).toContain('<svg');
    expect(withIcons).toContain('animate-spin');
    expect(withIcons).toContain('shadow-primary');
    expect(withIcons).toContain('shadow-card');
    // No icon, and no inset light (the primary button's and a card's shadows have one, drawn as a path).
    expect(plain).not.toContain('<svg');
    expect(plain).not.toContain('shadow-primary');
    expect(plain).not.toContain('shadow-card');
    expect(plain).not.toContain('inset');
  });

  it('can’t be reached or read out, and its words are none of the panel’s buttons’', () => {
    const html = markup();
    expect(html).toMatch(/^<div[^>]*aria-hidden="true"[^>]*inert=""/u);
    expect(html.match(/data-testid=/gu)).toHaveLength(1);
    for (const words of PANEL_WORDS) expect(html).not.toContain(words);
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
