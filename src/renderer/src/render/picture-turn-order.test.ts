import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { MediaElement, RenderSlide } from '../../../shared/model';
import { PLAIN } from '../../../shared/picture-look';
import { ScreenPictures } from './picture-looks';
import { SlideView } from './SlideView';

// A still's version is supplied by the window's store; this test needs no window or video decoder.
vi.mock('./stills', () => ({ useStill: () => ({ version: 0, failed: false }), requestStill: vi.fn() }));

/*
 * How the screens draw a slide's picture turned, flipped and zoomed, which the phones' zoom (web/viewer/live-zoom.ts)
 * and LIVE's drag (operator/live-drag.ts) work back from (a22-review-zoomturn's nit: nothing tested it, and a swapped
 * order would quietly zoom and move the screens to the wrong place): its box at its frame, flipped and then turned
 * about its middle (`rotate(r) scale(fx, fy)`, the right-hand part first); inside it, the zoom moved in the box's own
 * widths and heights, then scaled about its middle (`translate(x%, y%) scale(z)`); with a crop of its own, the box is
 * the whole picture the crop is cut from, inside the turned frame that clips it. Made-up ids.
 */

const LOOK = { ...PLAIN, zoom: 2, x: 0.25, y: -0.125 };

function drawn(el: MediaElement): string {
  const slide: RenderSlide = { id: 's1', width: 1920, height: 1080, background: null, elements: [el] };
  return renderToStaticMarkup(
    createElement(
      ScreenPictures.Provider,
      { value: { pictures: { [el.mediaId]: LOOK }, liveZoom: null } },
      createElement(SlideView, { slide }),
    ),
  );
}

/** The style of the first tag carrying this attribute. */
function styleOf(html: string, attribute: string): string {
  const tag = new RegExp(`<[a-z]+\\b[^>]*\\s${attribute}="[^>]*>`, 'u').exec(html)?.[0] ?? '';
  return /style="([^"]*)"/u.exec(tag)?.[1] ?? '';
}

const picture = (how: Partial<MediaElement>): MediaElement => ({
  id: 'e1',
  kind: 'image',
  mediaId: 'm-picture',
  fit: 'fill',
  frame: { x: 480, y: 270, width: 960, height: 540 },
  ...how,
});

describe('the screens draw a slide’s picture turned, flipped and zoomed in the order the zoom maths takes', () => {
  it('its box at its frame, flipped and then turned about its middle; the zoom inside, moved then scaled', () => {
    const html = drawn(picture({ rotation: 90, flipX: true }));
    const box = styleOf(html, 'data-look');
    expect(box).toContain('left:480px');
    expect(box).toContain('top:270px');
    expect(box).toContain('width:960px');
    expect(box).toContain('height:540px');
    expect(box).toContain('transform:rotate(90deg) scale(-1, 1)');
    expect(box).not.toMatch(/transform-origin/u);
    const zoom = styleOf(html, 'data-look-picture');
    expect(zoom).toContain('transform-origin:50% 50%');
    expect(zoom).toContain('transform:translate(25%, -12.5%) scale(2)');
  });

  it('with a crop of its own: the turned frame clips; the box inside is the whole picture, the crop over the frame', () => {
    const html = drawn(
      picture({ rotation: 270, flipY: true, crop: { x: 0.4, y: 0.1, width: 0.5, height: 0.5 } }),
    );
    const frame = styleOf(html, 'data-slide-crop');
    expect(frame).toContain('left:480px');
    expect(frame).toContain('width:960px');
    expect(frame).toContain('transform:rotate(270deg) scale(1, -1)');
    expect(frame).toContain('overflow:hidden');
    // The whole picture: 960 / 0.5 by 540 / 0.5, from -0.4 and -0.1 of it.
    const box = styleOf(html, 'data-look');
    expect(box).toContain('left:-768px');
    expect(box).toContain('top:-108px');
    expect(box).toContain('width:1920px');
    expect(box).toContain('height:1080px');
    expect(box).not.toMatch(/rotate|scale/u);
    expect(styleOf(html, 'data-look-picture')).toContain('transform:translate(25%, -12.5%) scale(2)');
  });
});
