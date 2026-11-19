import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { SlideLayer } from '../../../shared/engine/state';
import { engineNow } from './clock';
import { slideMediaDrawable, slideMediaReady } from './SlideLayerView';

const layer: SlideLayer = {
  presentationId: 'placeholder',
  slideIndex: 0,
  shownAt: 0,
  notes: '',
  slide: { id: 'placeholder', width: 1920, height: 1080, background: null, elements: [] },
};
const root = (img: HTMLImageElement) =>
  ({
    querySelectorAll: (tag: string) => (tag === 'img' ? [img] : []),
  }) as unknown as HTMLElement;
const image = (src: string, decode: () => Promise<void>) =>
  ({ src, currentSrc: src, complete: true, decode }) as HTMLImageElement;
function pending() {
  let finish: () => void = () => {
    throw new Error('decoder not started');
  };
  const promise = new Promise<void>((resolve) => {
    finish = () => resolve();
  });
  return { finish, decode: vi.fn(() => promise) };
}
beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

it('keeps a loaded picture off a pictures-first slide until decode completes, while key/fill keeps its loaded fast path', async () => {
  const decoder = pending();
  const img = image('drashti-media://media/placeholder-pending', decoder.decode);
  expect(slideMediaDrawable(root(img), layer)).toBe(true);
  expect(slideMediaDrawable(root(img), layer, true)).toBe(false);
  const ready = slideMediaReady(root(img), engineNow() + 3000, layer, true);
  expect(ready).not.toBe(true);
  expect(decoder.decode).toHaveBeenCalledOnce();
  decoder.finish();
  if (ready !== true) await ready;
  expect(slideMediaDrawable(root(img), layer, true)).toBe(true);
});

it('a second element for a successfully decoded address can cut in the same frame without another promise', async () => {
  const decode = vi.fn(() => Promise.resolve());
  const first = image('drashti-media://media/placeholder-ready', decode);
  const ready = slideMediaReady(root(first), engineNow() + 3000, layer, true);
  if (ready !== true) await ready;
  expect(decode).toHaveBeenCalledOnce();
  const againDecode = vi.fn(() => Promise.resolve());
  const again = image(first.src, againDecode);
  expect(slideMediaDrawable(root(again), layer, true)).toBe(true);
  expect(slideMediaReady(root(again), engineNow() + 3000, layer, true)).toBe(true);
  expect(againDecode).not.toHaveBeenCalled();
});

it('a picture changed during a pending decode does not mark either address ready', async () => {
  const decoder = pending();
  const img = image('drashti-media://media/placeholder-before', decoder.decode);
  const ready = slideMediaReady(root(img), engineNow() + 3000, layer, true);
  img.src = 'drashti-media://media/placeholder-after';
  Object.defineProperty(img, 'currentSrc', { value: img.src });
  decoder.finish();
  if (ready !== true) await ready;
  for (const src of ['drashti-media://media/placeholder-before', img.src])
    expect(slideMediaDrawable(root(image(src, () => Promise.resolve())), layer, true)).toBe(false);
});
