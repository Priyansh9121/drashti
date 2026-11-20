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
const image = (src: string, decode: () => Promise<void>) => {
  let attributeSrc = src;
  return {
    get src() {
      return attributeSrc;
    },
    set src(value: string) {
      attributeSrc = value;
    },
    currentSrc: src,
    complete: true,
    decode,
    getAttribute: (name: string) => (name === 'src' ? attributeSrc : null),
  } as HTMLImageElement;
};
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
  const resolveSrc = vi.spyOn(again, 'src', 'get');
  expect(slideMediaDrawable(root(again), layer, true)).toBe(true);
  expect(slideMediaReady(root(again), engineNow() + 3000, layer, true)).toBe(true);
  expect(againDecode).not.toHaveBeenCalled();
  expect(resolveSrc).not.toHaveBeenCalled();
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

it('keeps a relative source on the resolved-address fallback', async () => {
  const absolute = 'file:///placeholder/relative.png';
  const relativeImage = (decode: () => Promise<void>) => {
    const img = image('relative.png', decode);
    Object.defineProperty(img, 'src', { get: () => absolute });
    Object.defineProperty(img, 'currentSrc', { value: absolute });
    return img;
  };
  const first = relativeImage(() => Promise.resolve());
  const ready = slideMediaReady(root(first), engineNow() + 3000, layer, true);
  if (ready !== true) await ready;
  const decode = vi.fn(() => Promise.resolve());
  const again = relativeImage(decode);
  expect(slideMediaReady(root(again), engineNow() + 3000, layer, true)).toBe(true);
  expect(decode).not.toHaveBeenCalled();
});

it('keeps a newly assigned address cold while currentSrc still names the preceding picture', async () => {
  const before = 'drashti-media://media/placeholder-stale-current';
  const first = image(before, () => Promise.resolve());
  const ready = slideMediaReady(root(first), engineNow() + 3000, layer, true);
  if (ready !== true) await ready;
  const changed = image(before, () => Promise.resolve());
  changed.src = 'drashti-media://media/placeholder-new-source';
  expect(changed.currentSrc).toBe(before);
  expect(slideMediaDrawable(root(changed), layer, true)).toBe(false);
});

it('the first scene decodes its own image even when the initial preloader already prepared its address', async () => {
  const src = 'drashti-media://media/placeholder-first-scene-own-image';
  const preloaded = image(src, () => Promise.resolve());
  const prepared = slideMediaReady(root(preloaded), engineNow() + 3000, layer, true);
  if (prepared !== true) await prepared;
  const decoder = pending();
  const own = image(src, decoder.decode);
  // A later prepared Next keeps its same-frame path, but the new scene has not prepared its own element yet.
  expect(slideMediaDrawable(root(own), layer, true)).toBe(true);
  expect(slideMediaDrawable(root(own), layer, true, true)).toBe(false);
  const ready = slideMediaReady(root(own), engineNow() + 3000, layer, true, true);
  expect(ready).not.toBe(true);
  expect(decoder.decode).toHaveBeenCalledOnce();
  decoder.finish();
  if (ready !== true) await ready;
});

it('the first scene keeps the same three-second deadline if its own native decode never finishes', async () => {
  const src = 'drashti-media://media/placeholder-first-scene-deadline';
  const preloaded = image(src, () => Promise.resolve());
  const prepared = slideMediaReady(root(preloaded), engineNow() + 3000, layer, true);
  if (prepared !== true) await prepared;
  const decoder = pending();
  const own = image(src, decoder.decode);
  const ready = slideMediaReady(root(own), engineNow() + 3000, layer, true, true);
  expect(ready).not.toBe(true);
  let settled = false;
  if (ready !== true)
    void ready.then(() => {
      settled = true;
    });
  await vi.advanceTimersByTimeAsync(2999);
  expect(settled).toBe(false);
  await vi.advanceTimersByTimeAsync(1);
  expect(settled).toBe(true);
});
