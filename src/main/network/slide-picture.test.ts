import { describe, expect, it } from 'vitest';
import { AUDIENCE_TIMER_FADE_MS } from '../../shared/audience-timer';
import {
  type EngineState,
  initialEngineState,
  type MessageItem,
  type SlideLayer,
} from '../../shared/engine/state';
import { roleLook } from '../../shared/looks';
import { animationLength, LOWER_THIRD_ANIMATIONS } from '../../shared/lower-third-animations';
import { DEFAULT_MESSAGE_LOOK, messageAnimation } from '../../shared/message-look';
import type { RenderSlide } from '../../shared/model';
import { ZOOM_GLIDE_MS } from '../../shared/picture-look';
import { slidePictureReadyAt } from './slide-picture';

/*
 * When the hall screens are still enough for a phone's Save at a click (C6's review, HIGH): besides the slide's own
 * motion, a message coming in or going out (its words a unit at a time) and one with a live timer, the band of
 * standard messages coming in, the chosen wallpaper fading into its next picture, the live zoom's glide, a timer for the
 * audience fading out and a key and fill pair's moving lower third. Placeholder states only.
 */

const NOW = 1_000_000;

function stateWith(change: (state: EngineState) => void): EngineState {
  const state = initialEngineState();
  change(state);
  return state;
}

const plainSlide: RenderSlide = {
  id: 'placeholder-slide',
  width: 1280,
  height: 720,
  background: '#000000',
  elements: [],
};
const slideLayer = (shownAt: number): SlideLayer => ({
  presentationId: 'placeholder-deck',
  slideIndex: 0,
  slide: plainSlide,
  notes: '',
  shownAt,
});

/** A word-by-word animation: a message's in and out take longer the more words it has. */
const byWord = LOWER_THIRD_ANIMATIONS.find((a) => a.unit === 'word');
if (!byWord) throw new Error('There is no word-by-word animation.');
const wordLook = { ...DEFAULT_MESSAGE_LOOK, animation: byWord.id };
/** Three words and today's date: four units as the screens cut them (render/HallMessages.tsx). */
const message: MessageItem = {
  id: 'placeholder-message',
  text: 'Placeholder words here',
  parts: [
    { kind: 'text', text: 'Placeholder words here' },
    { kind: 'samvat', lang: 'en' },
  ],
  look: wordLook,
  shownAt: NOW - 100,
};
const messageIn = animationLength(messageAnimation(wordLook), 'in', 4);
const messageOut = animationLength(messageAnimation(wordLook), 'out', 4);

describe('when the hall screens are still for a phone’s Save', () => {
  it('is now when nothing moves', () => {
    expect(slidePictureReadyAt(initialEngineState(), NOW)).toBe(NOW);
  });

  it('waits for a message with its own look to come in and to go out, a word at a time', () => {
    const coming = stateWith((s) => {
      s.layers.messages = [message];
    });
    expect(messageIn).toBeGreaterThan(100);
    expect(slidePictureReadyAt(coming, NOW)).toBe(NOW - 100 + messageIn);
    expect(slidePictureReadyAt(coming, NOW - 100 + messageIn)).toBe(NOW - 100 + messageIn);
    const going = stateWith((s) => {
      s.messagesOff = [{ message, at: NOW - 50 }];
    });
    expect(slidePictureReadyAt(going, NOW)).toBe(NOW - 50 + messageOut);
  });

  it('never counts a message with a live timer as still', () => {
    const timed: MessageItem = {
      id: 'placeholder-timed',
      text: '[Placeholder timer]',
      parts: [{ kind: 'timer', timerId: 'placeholder-timer' }],
      shownAt: NOW - 60_000,
    };
    const banner = stateWith((s) => {
      s.layers.messages = [timed];
    });
    expect(slidePictureReadyAt(banner, NOW)).toBe(Infinity);
    const own = stateWith((s) => {
      s.layers.messages = [{ ...timed, look: wordLook }];
    });
    expect(slidePictureReadyAt(own, NOW)).toBe(Infinity);
  });

  it('waits for the band of standard messages to come in (Bold’s 300 ms, the longer)', () => {
    const plain: MessageItem = { id: 'placeholder-plain', text: 'Placeholder plain', shownAt: NOW - 100 };
    const banner = stateWith((s) => {
      s.layers.messages = [plain];
    });
    expect(slidePictureReadyAt(banner, NOW)).toBe(NOW - 100 + 300);
    // One put back after a restart has no time: the band is simply there.
    const back = stateWith((s) => {
      s.layers.messages = [{ id: 'placeholder-back', text: 'Placeholder back' }, plain];
    });
    expect(slidePictureReadyAt(back, NOW)).toBe(NOW);
  });

  it('waits for the live zoom’s glide, which every pinch or drag starts again', () => {
    const zoomed = stateWith((s) => {
      s.liveZoom = {
        mediaId: 'placeholder-picture',
        showing: 'bg:1',
        zoom: 2,
        x: 0.1,
        y: 0,
        from: { zoom: 1, x: 0, y: 0 },
        at: NOW - 100,
      };
    });
    expect(slidePictureReadyAt(zoomed, NOW)).toBe(NOW - 100 + ZOOM_GLIDE_MS);
  });

  it('waits for the chosen wallpaper to fade into its next picture wherever it shows', () => {
    const wallpaper = {
      id: 'placeholder-wallpaper',
      name: 'Placeholder wallpaper',
      pictures: ['placeholder-a', 'placeholder-b'],
      secondsEach: 10,
      fadeMs: 1500,
      since: NOW - 9_000,
    };
    // Nothing up: it shows, fading into its second picture until 10 s in.
    const nothingUp = stateWith((s) => {
      s.chosenWallpaper = wallpaper;
    });
    expect(slidePictureReadyAt(nothingUp, NOW)).toBe(wallpaper.since + 10_000);
    // A slide up hides it; under the Wallpaper it shows over the slide.
    const slideUp = stateWith((s) => {
      s.chosenWallpaper = wallpaper;
      s.layers.slide = slideLayer(NOW - 60_000);
    });
    expect(slidePictureReadyAt(slideUp, NOW)).toBe(NOW);
    expect(slidePictureReadyAt({ ...slideUp, wallpaper: true }, NOW)).toBe(wallpaper.since + 10_000);
    // A key and fill pair draws no background: with no slide, it shows the wallpaper over any background.
    const keyed = stateWith((s) => {
      s.chosenWallpaper = wallpaper;
      s.layers.background = { kind: 'color', color: '#000000' };
      s.look = { id: 'placeholder-look', name: 'Placeholder', groups: { pair: roleLook('keyfill', null) } };
    });
    expect(slidePictureReadyAt(keyed, NOW)).toBe(wallpaper.since + 10_000);
    // Between its fades, and with one picture, it is still.
    expect(slidePictureReadyAt(nothingUp, wallpaper.since + 10_000)).toBe(wallpaper.since + 10_000);
    const one = stateWith((s) => {
      s.chosenWallpaper = { ...wallpaper, pictures: ['placeholder-a'] };
    });
    expect(slidePictureReadyAt(one, NOW)).toBe(NOW);
  });

  it('waits for a timer for the audience to fade out', () => {
    const off = stateWith((s) => {
      s.timerOff = { layer: { timerId: 'placeholder-timer', shownAt: NOW - 60_000 }, at: NOW - 100 };
    });
    expect(slidePictureReadyAt(off, NOW)).toBe(NOW - 100 + AUDIENCE_TIMER_FADE_MS);
  });

  it('waits for a key and fill pair’s lower third to come in or change, and to leave (Bold, six lines)', () => {
    const keyed = (s: EngineState) => {
      s.look = { id: 'placeholder-look', name: 'Placeholder', groups: { pair: roleLook('keyfill', null) } };
    };
    const up = stateWith((s) => {
      keyed(s);
      s.layers.slide = slideLayer(NOW - 100);
    });
    expect(slidePictureReadyAt(up, NOW)).toBe(NOW - 100 + 780);
    const left = stateWith((s) => {
      keyed(s);
      s.slideOff = { layer: slideLayer(NOW - 60_000), at: NOW - 100 };
    });
    expect(slidePictureReadyAt(left, NOW)).toBe(NOW - 100 + 310);
    // Without such a pair, a slide with no transition is still at once.
    const plain = stateWith((s) => {
      s.layers.slide = slideLayer(NOW - 100);
    });
    expect(slidePictureReadyAt(plain, NOW)).toBe(NOW);
  });
});
