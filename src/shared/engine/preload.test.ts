import { describe, expect, it } from 'vitest';
import type { RenderSlide } from '../model';
import { mediaToPreload } from './preload';

const slide: RenderSlide = {
  id: 's',
  width: 1920,
  height: 1080,
  background: null,
  elements: [
    { id: 'a', kind: 'image', frame: { x: 0, y: 0, width: 10, height: 10 }, mediaId: 'logo', fit: 'fit' },
    { id: 'b', kind: 'video', frame: { x: 0, y: 0, width: 10, height: 10 }, mediaId: 'clip', fit: 'fit' },
    { id: 'c', kind: 'image', frame: { x: 5, y: 5, width: 10, height: 10 }, mediaId: 'logo', fit: 'fill' },
    {
      id: 'd',
      kind: 'shape',
      frame: { x: 0, y: 0, width: 1, height: 1 },
      fill: '#000000',
      cornerRadius: 0,
      opacity: 1,
    },
  ],
};

describe('what an output loads ahead', () => {
  it("takes the next slide's background and placed images and videos, each once", () => {
    expect(
      mediaToPreload({
        kind: 'slide',
        presentationId: 'p',
        slideIndex: 1,
        slide,
        background: { kind: 'media', mediaId: 'clouds', media: 'video', fit: 'fill', loop: true },
        itemId: null,
        notes: '',
      }),
    ).toEqual([
      { mediaId: 'clouds', media: 'video' },
      { mediaId: 'logo', media: 'image' },
      { mediaId: 'clip', media: 'video' },
    ]);
  });

  it('takes the next picture or video item, and nothing for a sound or the end', () => {
    expect(
      mediaToPreload({ kind: 'media', itemId: 'i', mediaId: 'pic', media: 'image', label: 'Pic' }),
    ).toEqual([{ mediaId: 'pic', media: 'image' }]);
    expect(
      mediaToPreload({ kind: 'media', itemId: 'i', mediaId: 'dhun', media: 'audio', label: 'Dhun' }),
    ).toEqual([]);
    expect(mediaToPreload(null)).toEqual([]);
  });
});
