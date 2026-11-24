import { describe, expect, it } from 'vitest';
import { initialEngineState, type EngineState } from '../../../shared/engine/state';
import { DEFAULT_LIVE_GROUP_LOOK } from '../../../shared/looks';
import type { MediaElement, RenderSlide, TextElement } from '../../../shared/model';
import {
  initialPictureReadyToHandOver,
  initialPicturesFor,
  keepInitialPicturePriority,
  programInitialPictures,
  prepareInitialPicture,
  settleInitialPicture,
  startInitialPicturePriority,
  type CurrentPictureSelection,
  type InitialPicturePriority,
} from './initial-picture-preload';

const image: MediaElement = {
  id: 'placeholder-image',
  kind: 'image',
  mediaId: 'current-picture',
  fit: 'fill',
  frame: { x: 0, y: 0, width: 1920, height: 1080 },
};
const video: MediaElement = { ...image, id: 'placeholder-video', kind: 'video', mediaId: 'current-video' };
const words: TextElement = {
  id: 'placeholder-words',
  kind: 'text',
  text: 'Placeholder words',
  lang: 'en',
  frame: { x: 40, y: 40, width: 600, height: 120 },
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
const slide: RenderSlide = {
  id: 'placeholder-slide',
  width: 1920,
  height: 1080,
  background: null,
  elements: [image],
};
function live(elements = slide.elements): EngineState {
  const state = initialEngineState();
  return {
    ...state,
    layers: {
      ...state.layers,
      slide: {
        presentationId: 'placeholder-presentation',
        slideIndex: 0,
        slide: { ...slide, elements },
        shownAt: 100,
        notes: '',
      },
    },
    next: {
      kind: 'media',
      itemId: 'placeholder-next',
      mediaId: 'next-picture',
      media: 'image',
      label: 'Placeholder',
    },
  };
}
const look = DEFAULT_LIVE_GROUP_LOOK;
const ids = (selected: CurrentPictureSelection | null) => selected?.media.map((m) => m.mediaId).sort() ?? [];
function withBackground(state: EngineState): EngineState {
  return {
    ...state,
    layers: {
      ...state.layers,
      background: {
        kind: 'media',
        mediaId: 'current-background',
        media: 'image',
        fit: 'fill',
        loop: false,
        startedAt: 80,
      },
    },
  };
}
const selected: CurrentPictureSelection = {
  key: 'initial-picture',
  media: [
    { mediaId: 'current-one', media: 'image' },
    { mediaId: 'current-two', media: 'image' },
  ],
};
const waiting = (): InitialPicturePriority => ({
  current: selected,
  pending: ['current-one', 'current-two'],
  until: 3100,
});

describe('the picture already up gets decoded before Next', () => {
  it('takes each current image once, including its background, without starting a video or taking Next', () => {
    const state = withBackground(live([image, { ...image, id: 'another-use' }, video]));
    const current = initialPicturesFor(state, look);
    expect(ids(current)).toEqual(['current-background', 'current-picture']);
    expect(current?.media.every((m) => m.media === 'image')).toBe(true);
  });

  it('also prepares an image background when no slide is up', () => {
    expect(ids(initialPicturesFor(withBackground(initialEngineState()), look))).toEqual([
      'current-background',
    ]);
  });

  it('leaves a video-only picture and a page with nothing up free to load Next', () => {
    expect(initialPicturesFor(live([video]), look)).toBeNull();
    expect(initialPicturesFor(initialEngineState(), look)).toBeNull();
  });

  it('bypasses priority where key/fill or a stage-only layout must not wait for pictures', () => {
    expect(initialPicturesFor(live(), look, false)).toBeNull();
  });

  it('prepares only the layers this picture draws', () => {
    const state = withBackground(live());
    expect(ids(initialPicturesFor(state, { ...look, layers: ['background'] }))).toEqual([
      'current-background',
    ]);
    expect(ids(initialPicturesFor(state, { ...look, layers: ['slide'] }))).toEqual(['current-picture']);
  });

  it('does not prioritize a covered slide or pictures hidden by a lower third', () => {
    expect(initialPicturesFor({ ...live(), blackout: true }, look)).toBeNull();
    expect(initialPicturesFor({ ...live(), wallpaper: true }, look)).toBeNull();
    expect(initialPicturesFor(live([image, words]), { ...look, slides: 'lowerThird' })).toBeNull();
    expect(ids(initialPicturesFor(live(), { ...look, slides: 'lowerThird' }))).toEqual(['current-picture']);
  });

  it('uses the same full-frame decision as the stream, including Camera lower thirds', () => {
    expect(ids(programInitialPictures(live(), 'slides', null))).toEqual(['current-picture']);
    expect(ids(programInitialPictures(live(), 'camera', null))).toEqual(['current-picture']);
    expect(programInitialPictures(live([image, words]), 'camera', null)).toBeNull();
    expect(programInitialPictures({ ...live(), blackout: true }, 'camera', null)).toBeNull();
  });

  it('does not mistake a Next update for a different current picture', () => {
    const state = live();
    const first = initialPicturesFor(state, look);
    expect(first).not.toBeNull();
    expect(initialPicturesFor({ ...state, next: null }, look)?.key).toBe(first?.key);
    const layer = state.layers.slide;
    if (!layer) throw new Error('The fixture has no current slide');
    const changed = { ...state, layers: { ...state.layers, slide: { ...layer, shownAt: 200 } } };
    expect(initialPicturesFor(changed, look)?.key).not.toBe(first?.key);
  });
});

describe('initial-only picture priority cannot starve Next', () => {
  it('gives the initial images one three-second turn, never holding an empty selection', () => {
    const priority = startInitialPicturePriority(selected, 100);
    expect(priority?.pending).toEqual(['current-one', 'current-two']);
    expect(priority?.until).toBe(3100);
    expect(startInitialPicturePriority(null, 100)).toBeNull();
    expect(startInitialPicturePriority({ key: 'empty', media: [] }, 100)).toBeNull();
  });

  it('releases the old picture immediately when the show changes, and never re-arms a released turn', () => {
    expect(keepInitialPicturePriority(waiting(), 'another-picture', 200)).toBeNull();
    expect(keepInitialPicturePriority(null, selected.key, 200)).toBeNull();
  });

  it('expires at the independent three-second bound even if an image never settles', () => {
    const priority = waiting();
    expect(keepInitialPicturePriority(priority, selected.key, 3099)).toBe(priority);
    expect(keepInitialPicturePriority(priority, selected.key, 3100)).toBeNull();
  });

  it('releases failed preparation without leaving Next behind it', () => {
    expect(settleInitialPicture(waiting(), 'current-one', 'failed')).toBeNull();
  });

  it('waits for every current decode and the scene before handing its consumers over', () => {
    const first = settleInitialPicture(waiting(), 'current-one', 'ready');
    expect(first?.pending).toEqual(['current-two']);
    expect(initialPictureReadyToHandOver(first, true)).toBe(false);
    const complete = settleInitialPicture(first, 'current-two', 'ready');
    expect(complete?.until).toBe(3100);
    expect(initialPictureReadyToHandOver(complete, false)).toBe(false);
    expect(initialPictureReadyToHandOver(complete, true)).toBe(true);
  });

  it('waits for a replacement source during the same initial turn without renewing its bound', () => {
    const ready = { ...waiting(), pending: [] };
    const changed = prepareInitialPicture(ready, 'current-one');
    expect(changed?.pending).toEqual(['current-one']);
    expect(changed?.until).toBe(3100);
    expect(initialPictureReadyToHandOver(changed, true)).toBe(false);
    expect(prepareInitialPicture(ready, 'next-picture')).toBe(ready);
    expect(prepareInitialPicture(null, 'current-one')).toBeNull();
  });

  it('ignores another consumer and duplicate completions rather than releasing the wrong picture', () => {
    const priority = waiting();
    expect(settleInitialPicture(priority, 'next-picture', 'ready')).toBe(priority);
    const first = settleInitialPicture(priority, 'current-one', 'ready');
    expect(settleInitialPicture(first, 'current-one', 'ready')).toBe(first);
  });
});
