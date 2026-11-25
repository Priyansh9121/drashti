import { afterEach, expect, it } from 'vitest';
import { nextBackgroundVideo } from '../../../shared/engine/preload';
import type { UpNext } from '../../../shared/engine/state';
import { mediaUrl, pageCopyUrl } from '../../../shared/media';
import { preloadVideoUrl, setPageCopyHeight, setReadyPageCopies } from '../render/page-copy';

/*
 * The video Next will put up as the background is loaded ahead as the file its playback will take
 * (a22-review-fadecopies S4): its page copy on a page that draws smaller with one ready (the stream's picture page,
 * the operator window), the original everywhere else, and the original for a slide's own video. Placeholder ids.
 */

afterEach(() => {
  setPageCopyHeight(null);
  setReadyPageCopies({});
});

it('the background video Next puts up: a video item, or a slide’s background video; never a slide’s own video', () => {
  const item: UpNext = {
    kind: 'media',
    itemId: 'i',
    mediaId: 'clip',
    media: 'video',
    label: 'Placeholder clip',
  };
  expect(nextBackgroundVideo(item)).toBe('clip');
  expect(nextBackgroundVideo({ ...item, media: 'image' })).toBeNull();
  expect(nextBackgroundVideo(null)).toBeNull();
  const slide = {
    kind: 'slide',
    background: { kind: 'media', mediaId: 'backdrop', media: 'video', fit: 'fit', loop: true },
  } as unknown as UpNext;
  expect(nextBackgroundVideo(slide)).toBe('backdrop');
  expect(nextBackgroundVideo({ ...slide, background: null } as unknown as UpNext)).toBeNull();
});

it('warms the page copy a background video will play on a page that draws smaller, the original elsewhere', () => {
  setReadyPageCopies({ clip: [720] });
  expect(preloadVideoUrl('clip', 0, true), 'the hall: the original').toBe(mediaUrl('clip'));
  setPageCopyHeight(720);
  expect(preloadVideoUrl('clip', 0, true), 'the stream page: its copy').toBe(pageCopyUrl('clip', 720));
  expect(preloadVideoUrl('clip', 0, false), 'a slide’s own video: the original').toBe(mediaUrl('clip'));
  expect(preloadVideoUrl('clip', 1, true), 'a later try: the original').toBe(mediaUrl('clip', 1));
  setReadyPageCopies({});
  expect(preloadVideoUrl('clip', 0, true), 'no copy ready: the original').toBe(mediaUrl('clip'));
});
