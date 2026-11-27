import { describe, expect, it } from 'vitest';
import type { AppearanceNow } from './appearances';
import { drawAppearance, type AppearanceRoot } from './draw';

/*
 * What <html> is told (Sessions 39–40, 60; alpha.24): the appearance's custom properties and the attributes the styles
 * follow, among them the window's look (QA24-UI-4): data-window-look is "depth" while the window follows the computer
 * (styles/look-depth.css draws B · Depth then), "flat" in an appearance chosen by name.
 */

function aRoot(): AppearanceRoot & { props: Record<string, string> } {
  const props: Record<string, string> = {};
  return {
    props,
    style: {
      setProperty: (name: string, value: string) => {
        props[name] = value;
      },
    },
    dataset: {},
  };
}

const now = (depth: boolean): AppearanceNow => ({
  id: 'black',
  base: 'dark',
  vars: { '--color-ink': '#09090b' },
  motion: 'calm',
  moving: true,
  look: [],
  slow: false,
  chip: 'yes',
  depth,
});

describe('drawAppearance', () => {
  it('sets the custom properties and says the window’s look: depth while following the computer, flat otherwise', () => {
    const root = aRoot();
    drawAppearance(root, now(true));
    expect(root.props['--color-ink']).toBe('#09090b');
    expect(root.dataset).toMatchObject({ appearance: 'black', base: 'dark', windowLook: 'depth' });
    drawAppearance(root, now(false));
    expect(root.dataset['windowLook']).toBe('flat');
  });
});
