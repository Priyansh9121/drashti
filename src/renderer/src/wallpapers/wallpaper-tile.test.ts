import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Wallpaper } from '../../../shared/wallpapers';
import { WallpaperTile } from './WallpapersPanel';

const wallpaper: Wallpaper = {
  id: 'wallpaper',
  name: 'Placeholder wallpaper',
  secondsEach: 10,
  fadeMs: 1500,
  pictures: [{ mediaId: 'picture', name: 'Placeholder.png', missing: true }],
};

describe('a wallpaper tile warning', () => {
  it('keeps its full warning in a tooltip when the narrow tile wraps its words', () => {
    const html = renderToStaticMarkup(createElement(WallpaperTile, { wallpaper, chosen: true }));
    const warning = /<span[^>]*data-testid="wallpaper-missing"[^>]*>/u.exec(html)?.[0];
    expect(warning).toContain('title="Picture missing"');
    expect(html).toContain('aria-label="Placeholder wallpaper, its picture is missing"');
  });
});
