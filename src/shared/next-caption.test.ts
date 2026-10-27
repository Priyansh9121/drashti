import { describe, expect, it } from 'vitest';
import type { UpNext } from './engine/state';
import { nextCaption } from './next-caption';

/*
 * What Next will put up, in words (Session 54, D5 review): the operator window's caption under its picture of what
 * comes next (operator/NextPreview.tsx), now said on a phone too, from the same words. Placeholder names.
 */

const slide = (more: Partial<Extract<UpNext, { kind: 'slide' }>> = {}): UpNext => ({
  kind: 'slide',
  presentationId: 'p1',
  slideIndex: 2,
  slide: { id: 's3', width: 1920, height: 1080, elements: [] } as unknown as Extract<
    UpNext,
    { kind: 'slide' }
  >['slide'],
  background: null,
  itemId: null,
  notes: '',
  ...more,
});

describe('what Next will put up, in words', () => {
  it('says the next slide by its item or presentation, and the next item when it is one', () => {
    expect(nextCaption(slide(), { label: 'Placeholder Kirtan' })).toBe('Placeholder Kirtan, slide 3');
    expect(nextCaption(slide({ itemId: 'i2', slideIndex: 0 }), { label: 'Placeholder Talk' })).toBe(
      'Placeholder Talk, slide 1 (next item)',
    );
    expect(nextCaption(slide(), { label: null })).toBe('Presentation, slide 3');
    expect(nextCaption(slide())).toBe('Presentation, slide 3');
  });

  it('adds a deck’s next click, and a video input, a missing file or a missing sound behind it', () => {
    expect(nextCaption(slide({ step: 2 }), { label: 'Placeholder Deck' })).toBe(
      'Placeholder Deck, slide 3, click 2',
    );
    expect(nextCaption(slide({ step: 0 }), { label: 'Placeholder Deck' })).toBe('Placeholder Deck, slide 3');
    expect(nextCaption(slide({ input: 'Input 1' }), { label: 'Placeholder Kirtan' })).toBe(
      'Placeholder Kirtan, slide 3, over the video input “Input 1”',
    );
    expect(nextCaption(slide({ input: 'Input 1' }), { label: 'Placeholder Kirtan', inputHere: false })).toBe(
      'Placeholder Kirtan, slide 3, over the video input “Input 1”, which is not on this computer: the background stays as it is',
    );
    expect(
      nextCaption(slide({ fileMissing: 'placeholder.jpg', soundMissing: 'placeholder.mp3' }), {
        label: 'Placeholder Kirtan',
      }),
    ).toBe(
      'Placeholder Kirtan, slide 3, over the file “placeholder.jpg”, which is missing: the background stays as it is, with the sound “placeholder.mp3”, which is missing: the sound stays as it is',
    );
  });

  it('names the next picture, video, sound or video input item, and says when nothing comes next', () => {
    const media = (m: 'image' | 'video' | 'audio'): UpNext => ({
      kind: 'media',
      itemId: 'i3',
      mediaId: 'm1',
      media: m,
      label: 'Placeholder clip',
    });
    expect(nextCaption(media('image'))).toBe('Picture: Placeholder clip');
    expect(nextCaption(media('video'))).toBe('Video: Placeholder clip');
    expect(nextCaption(media('audio'))).toBe('Audio: Placeholder clip');
    expect(
      nextCaption({ kind: 'input', itemId: 'i4', inputId: 'in-1', name: 'Input 1', label: 'Input 1' }),
    ).toBe('Video input: Input 1');
    expect(nextCaption(null)).toBe('Nothing after this');
  });
});
