import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BLACK, WHITE } from '../../../shared/appearance/appearances';
import { FollowPreview } from './AppearanceDialog';
import { AppearancePreview } from './AppearancePreview';
import { DEPTH_COLOURS } from './DepthPreview';

/*
 * The Appearance window's picture of Follow the computer (the alpha.25 list's item 9): Follow the computer draws the
 * operator window in B · Depth (styles/look-depth.css), so its picture shows Depth, Black's and White's, as the window
 * will look: the columns as rounded panels a gap apart on the darker ground, each with its 1 px light along the top and
 * no edge, the side columns one surface up, the top bar and the bar of clears on the ground with no line, and LIVE's
 * light red ring round the live picture; never a gradient or a blur. Depth's own colours are look-depth.css's
 * (src/main/look-depth.test.ts holds them to the file). An appearance chosen by name keeps its flat picture. Drawn to markup: unit tests run without a page.
 */

/** Depth's own colours in a base (src/main/look-depth.test.ts holds DepthPreview.tsx's to look-depth.css's). */
const token = (base: 'dark' | 'light', name: 'ground' | 'light' | 'ring'): string =>
  DEPTH_COLOURS[base][name];

interface Tag {
  attrs: Record<string, string>;
}
/** Every opening tag of the markup, with its attributes. */
function tags(html: string): Tag[] {
  return [...html.matchAll(/<([a-z]+)((?:\s+[\w-]+(?:="[^"]*")?)*)\s*\/?>/gu)].map((m) => ({
    attrs: Object.fromEntries(
      [...(m[2] ?? '').matchAll(/([\w-]+)(?:="([^"]*)")?/gu)].map((a) => [a[1] ?? '', a[2] ?? '']),
    ),
  }));
}
/** A style attribute as its declarations. */
const styleOf = (t: Tag | undefined): Record<string, string> =>
  Object.fromEntries(
    (t?.attrs['style'] ?? '')
      .split(';')
      .filter((d) => d.includes(':'))
      .map((d) => [d.slice(0, d.indexOf(':')).trim(), d.slice(d.indexOf(':') + 1).trim()]),
  );
const classes = (t: Tag | undefined) => (t?.attrs['class'] ?? '').split(/\s+/u);

/** Follow the computer's two pictures, each as its tags from its root on. */
function pictures(): Tag[][] {
  const all = tags(renderToStaticMarkup(createElement(FollowPreview)));
  const roots = all.flatMap((t, i) => (t.attrs['data-testid'] === 'appearance-preview' ? [i] : []));
  return roots.map((at, n) => all.slice(at, roots[n + 1] ?? all.length));
}
const part = (picture: Tag[], name: string) => picture.find((t) => t.attrs['data-part'] === name);

describe('the Appearance window: Follow the computer’s picture', () => {
  it('draws Black and White in Depth, each on its ground, in that order', () => {
    const drawn = pictures();
    expect(drawn).toHaveLength(2);
    for (const [picture, base] of [
      [drawn[0] ?? [], 'dark'],
      [drawn[1] ?? [], 'light'],
    ] as const) {
      expect(picture[0]?.attrs['data-look'], `${base}: drawn in Depth`).toBe('depth');
      expect(styleOf(picture[0])['background'], `${base}: the ground`).toBe(token(base, 'ground'));
    }
  });

  it('draws the columns as rounded panels with their light along the top and no edge, the side columns one surface up', () => {
    for (const [picture, a, base] of [
      [pictures()[0] ?? [], BLACK, 'dark'],
      [pictures()[1] ?? [], WHITE, 'light'],
    ] as const) {
      const light = `inset 0 1px 0 ${token(base, 'light')}`;
      for (const [name, colour] of [
        ['left', a.colours['panel-2']],
        ['middle', a.colours.panel],
        ['right', a.colours['panel-2']],
      ] as const) {
        const column = part(picture, name);
        expect(styleOf(column), `${a.name}: the ${name} column`).toMatchObject({
          background: colour,
          'box-shadow': light,
        });
        expect(classes(column), `${a.name}: the ${name} column has no edge`).not.toContain('border');
        expect(
          classes(column).some((c) => /^rounded-\[\d+px\]$/u.test(c)),
          `${a.name}: the ${name} column rounded`,
        ).toBe(true);
      }
      // The top bar and the bar of clears on the ground: no colour and no line of their own.
      for (const name of ['header', 'bar']) {
        const strip = part(picture, name);
        expect(strip, `${a.name}: the ${name}`).toBeDefined();
        expect(styleOf(strip)['background'], `${a.name}: the ${name} on the ground`).toBeUndefined();
        expect(
          classes(strip).filter((c) => /^border/u.test(c)),
          `${a.name}: the ${name}'s line`,
        ).toEqual([]);
      }
    }
  });

  it('marks LIVE with its red frame and its light red ring round the live picture, never a glow, a gradient or a blur', () => {
    for (const [picture, a, base] of [
      [pictures()[0] ?? [], BLACK, 'dark'],
      [pictures()[1] ?? [], WHITE, 'light'],
    ] as const) {
      const live = styleOf(part(picture, 'live'));
      expect(live['border-color'], `${a.name}: LIVE's frame`).toBe(a.colours['live-edge']);
      expect(live['box-shadow'], `${a.name}: LIVE's ring`).toBe(`0 0 0 1px ${token(base, 'ring')}`);
      const styles = picture.map((t) => t.attrs['style'] ?? '').join(';');
      expect(styles, `${a.name}: no gradient`).not.toMatch(/gradient\(/u);
      // Every shadow a ring or an inset light: no blur.
      for (const shadow of picture.map((t) => styleOf(t)['box-shadow']).filter((s) => s !== undefined))
        expect(shadow, `${a.name}: a shadow with no blur`).toMatch(
          /^(?:inset )?0 (?:0|1px) 0 (?:1px )?#[0-9a-f]+$/u,
        );
    }
  });

  it('keeps an appearance chosen by name its flat picture', () => {
    for (const a of [BLACK, WHITE]) {
      const [root] = tags(renderToStaticMarkup(createElement(AppearancePreview, { appearance: a })));
      expect(root?.attrs['data-look'], `${a.name} by name`).toBeUndefined();
      expect(styleOf(root)['background'], `${a.name} by name: its own window colour`).toBe(a.colours.ink);
    }
  });
});
