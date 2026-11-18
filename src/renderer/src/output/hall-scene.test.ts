import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { type EngineState, initialEngineState } from '../../../shared/engine/state';
import type { MediaElement, RenderSlide, TextElement } from '../../../shared/model';
import { HallScene } from './HallScene';

/*
 * A hall screen draws a slide only once its pictures can be drawn, as the stream's page does (Session 59, X19; the
 * owner's decision Q58-52): the slide it first draws, and a slide cut in, wait for them (3 s at most), keeping what is on
 * screen until then. Rendered here without a page, nothing has loaded, so the slide is still waiting.
 */

const words: TextElement = {
  id: 'placeholder-words',
  kind: 'text',
  frame: { x: 40, y: 40, width: 600, height: 120 },
  text: 'Placeholder words',
  lang: 'en',
  style: {
    fontFamily: null,
    fontSize: 40,
    fontWeight: 400,
    color: '#ffffff',
    align: 'center',
    verticalAlign: 'middle',
    lineHeight: 1.2,
    shadow: false,
  },
};
const picture: MediaElement = {
  id: 'placeholder-picture',
  kind: 'image',
  frame: { x: 0, y: 0, width: 1920, height: 1080 },
  fit: 'fill',
  mediaId: 'placeholder-picture-id',
};

function withSlide(slide: RenderSlide): EngineState {
  const state = initialEngineState();
  return {
    ...state,
    layers: {
      ...state.layers,
      slide: { presentationId: 'placeholder-deck', slideIndex: 0, slide, shownAt: 1, notes: '' },
    },
  };
}

const slide: RenderSlide = {
  id: 'placeholder-slide',
  width: 1920,
  height: 1080,
  background: null,
  elements: [picture, words],
};

const drawn = (matte: 'fill' | 'key' | null) =>
  renderToStaticMarkup(
    createElement(HallScene, {
      state: withSlide(slide),
      canvas: { width: 1920, height: 1080 },
      scaling: 'fit',
      matte,
    }),
  );

describe('a hall screen waits for a slide’s pictures (X19)', () => {
  it('draws the slide it first shows only once its pictures can be drawn', () => {
    const html = drawn(null);
    expect(html).toContain('data-layer="slide"');
    // The slide is there, waiting (a cut not yet made): nothing of it shows until its pictures can be drawn.
    expect(html).toMatch(/data-layer="slide"[^>]*data-fading="true"/);
    expect(html).not.toMatch(/data-layer="slide"[^>]*data-fade-start=/);
  });

  it('asks for slide pictures to be painted with the slide, including a picture already loaded (X19 L7)', () => {
    const images = drawn(null).match(/<img\b[^>]*>/gu) ?? [];
    expect(images.length).toBeGreaterThan(0);
    for (const image of images) expect(image).toContain('decoding="sync"');
  });

  it('a key and fill pair’s two halves cut together, as before (Q59-5): never a frame apart on the keyer', () => {
    for (const matte of ['fill', 'key'] as const) {
      expect(drawn(matte), matte).toContain('data-layer="slide"');
      expect(drawn(matte), matte).not.toMatch(/data-layer="slide"[^>]*data-fading="true"/);
      expect(drawn(matte), matte).not.toContain('decoding="sync"');
    }
  });
});
