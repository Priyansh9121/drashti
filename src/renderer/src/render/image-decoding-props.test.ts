import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { DeckMedia, DeckSlide } from '../../../shared/deck';
import type { StepTiming } from '../../../shared/deck-show';
import type { MediaElement, RenderSlide } from '../../../shared/model';
import { DeckStepStill, DeckStepView } from './DeckStep';
import { ElementView, SlideView } from './SlideView';
import { ScreenPictures } from './picture-looks';
import { PLAIN } from '../../../shared/picture-look';
import { displayUrl } from '../../../shared/media';

// A still's version is supplied by the window's store; this test needs no window or video decoder.
vi.mock('./stills', () => ({ useStill: () => ({ version: 0, failed: false }), requestStill: vi.fn() }));

const picture: MediaElement = {
  id: 'placeholder-picture',
  kind: 'image',
  frame: { x: 0, y: 0, width: 1920, height: 1080 },
  fit: 'fill',
  mediaId: 'placeholder-picture-id',
};
const slide: RenderSlide = {
  id: 'placeholder-slide',
  width: 1920,
  height: 1080,
  background: null,
  backdrop: { kind: 'picture', mediaId: 'placeholder-backdrop', fit: 'fill' },
  elements: [picture],
};
const timing: StepTiming = {
  index: 1,
  step: { clipId: 'placeholder-clip', lastId: 'placeholder-last', clipMs: 1000 },
  clipAt: 10_000,
  endsAt: 11_000,
  still: true,
  drashti: null,
  shownAt: 10_000,
};
const deck: DeckSlide = {
  steps: [{ clipId: 'placeholder-before-clip', lastId: 'placeholder-before', clipMs: 1000 }, timing.step],
  media: [],
};
const video: MediaElement = {
  ...picture,
  id: 'placeholder-video',
  kind: 'video',
  mediaId: 'placeholder-video-id',
};

const images = (html: string) => html.match(/<img\b[^>]*>/gu) ?? [];
function expectSync(html: string, count: number): void {
  const found = images(html);
  expect(found).toHaveLength(count);
  for (const image of found) expect(image).toContain('decoding="sync"');
}

// The sync guard is a scalar passed down the existing tree. No extra provider or subscription is needed just to
// carry this constant while a native transition runs or cleans up. The pixel specs test the actual decode/wait.
describe('a slide image decoding hint passed through the existing render tree', () => {
  it('reaches an ordinary picture and its slide backdrop without an ancestor decoding context', () => {
    const props = { slide, imageDecoding: 'sync' as const };
    expectSync(renderToStaticMarkup(createElement(SlideView, props)), 2);
  });

  it('reaches the pictures and backdrop inside a cropped PDF page', () => {
    const cropped: RenderSlide = {
      ...slide,
      width: 960,
      height: 540,
      pageCrop: { x: 120, y: 80, width: 1920, height: 1080 },
    };
    const html = renderToStaticMarkup(createElement(SlideView, { slide: cropped, imageDecoding: 'sync' }));
    expect(html).toContain('data-page-crop');
    expectSync(html, 2);
  });

  it('reaches both the previous and last still of a baked deck step', () => {
    const props = { deck, timing, style: {}, imageDecoding: 'sync' as const };
    expectSync(renderToStaticMarkup(createElement(DeckStepView, props)), 2);
  });

  it('reaches a deck step drawn as a still', () => {
    const props = { deck, index: 1, style: {}, imageDecoding: 'sync' as const };
    expectSync(renderToStaticMarkup(createElement(DeckStepStill, props)), 1);
  });

  it('reaches the generated still for a video drawn still', () => {
    const props = { el: video, media: 'still' as const, imageDecoding: 'sync' as const };
    expectSync(renderToStaticMarkup(createElement(ElementView, props)), 1);
  });

  it('reaches a deck video poster before that video starts', () => {
    const media: DeckMedia = {
      kind: 'video',
      mediaId: video.mediaId,
      posterId: 'placeholder-poster',
      box: { x: 0, y: 0, w: 1, h: 1 },
      loop: false,
      volume: 1,
      start: { clicked: true },
    };
    const props = {
      el: video,
      deck: media,
      startedAt: 0,
      imageDecoding: 'sync' as const,
      seeks: { [video.mediaId]: { at: 0, toMs: 0, paused: true, waiting: true } },
    };
    const html = renderToStaticMarkup(createElement(ElementView, props));
    expect(html).toContain('data-deck-poster="placeholder-poster"');
    expectSync(html, 1);
  });

  it('keeps the native default when no pictures-first hint was supplied', () => {
    const html =
      renderToStaticMarkup(createElement(SlideView, { slide })) +
      renderToStaticMarkup(createElement(DeckStepView, { deck, timing, style: {} }));
    expect(images(html)).toHaveLength(4);
    expect(html).not.toContain('decoding="sync"');
  });
});

it('selects a prepared display rendition in its very first image, before any loading effect runs', () => {
  const key = `p1-${'ab'.repeat(16)}-1920x1080`;
  const rendered = renderToStaticMarkup(
    createElement(
      ScreenPictures.Provider,
      {
        value: {
          pictures: { [picture.mediaId]: { ...PLAIN, display: { key, width: 1920, height: 1080 } } },
          liveZoom: null,
        },
      },
      createElement(ElementView, { el: picture, imageDecoding: 'sync' }),
    ),
  );
  expect(images(rendered)).toHaveLength(1);
  expect(rendered).toContain(displayUrl(picture.mediaId, key));
  expect(rendered).not.toContain(`drashti-media://media/${picture.mediaId}`);
  expectSync(rendered, 1);
});
