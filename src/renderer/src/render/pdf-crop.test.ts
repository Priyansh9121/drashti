import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { cropRenderedPage } from '../../../shared/pdf-page-crop';
import type { RenderSlide } from '../../../shared/model';
import { SlideView } from './SlideView';
import { Placed } from './Placed';
const page: RenderSlide = { id: 'generated-page', width: 400, height: 600, background: '#ffffff', elements: [] };
const crop = { x: 0.125, y: 0.25, w: 0.5, h: 0.5 };
it('gives every output the cropped aspect and clips a full page translated underneath', () => {
  const shown = cropRenderedPage(page, crop);
  expect(shown).toMatchObject({ width: 200, height: 300 });
  const html = renderToStaticMarkup(createElement(SlideView, { slide: shown, media: 'still' }));
  expect(html).toContain('data-page-crop=""');
  expect(html).toContain('width:200px;height:300px;overflow:hidden');
  expect(html).toContain('left:-50px;top:-150px');
  expect(html).toContain('width:400px;height:600px');
});
it('fits the same cropped page in hall and thumbnail frames', () => {
  const shown = cropRenderedPage(page, crop);
  for (const size of [{width:1920,height:1080},{width:160,height:90}]) {
    const html = renderToStaticMarkup(createElement(Placed, { content: shown, box: size, mode: 'fit', children: createElement(SlideView, {slide:shown,media:'still'}) }));
    expect(html).toContain('data-page-crop=""');
    expect(html).toContain('overflow:hidden');
  }
});
