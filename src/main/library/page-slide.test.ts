import { describe, expect, it } from 'vitest';
import { pageSlidePresentation } from './page-slide';

/* Make a slide… (alpha.21): the presentation that holds a PDF page's picture, or a part of one. */

describe('pageSlidePresentation', () => {
  it('is one slide, the picture fitted to the whole slide on black, at the hall’s picture size', () => {
    const made = pageSlidePresentation('library-1', 'Placeholder PDF tools, page 1 (part)', 'media-1', {
      width: 1920,
      height: 1080,
    });
    expect(made).toMatchObject({
      libraryId: 'library-1',
      name: 'Placeholder PDF tools, page 1 (part)',
      width: 1920,
      height: 1080,
      source: { kind: 'drashti', path: null, ref: null, importedAt: null },
    });
    expect(made.groups).toHaveLength(1);
    const slides = made.groups[0]?.slides ?? [];
    expect(slides).toHaveLength(1);
    expect(slides[0]).toMatchObject({ background: '#000000' });
    expect(slides[0]?.elements).toEqual([
      {
        id: 'page',
        kind: 'image',
        frame: { x: 0, y: 0, width: 1920, height: 1080 },
        mediaId: 'media-1',
        fit: 'fit',
      },
    ]);
  });

  it('takes the size the hall’s pictures are made at', () => {
    const made = pageSlidePresentation('library-1', 'Placeholder', 'media-1', { width: 3840, height: 2160 });
    expect([made.width, made.height]).toEqual([3840, 2160]);
    expect(made.groups[0]?.slides[0]?.elements[0]?.frame).toEqual({ x: 0, y: 0, width: 3840, height: 2160 });
  });
});
