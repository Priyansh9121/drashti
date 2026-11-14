import { afterEach, describe, expect, it, vi } from 'vitest';
import { AUDIENCE_TIMER_FADE_MS } from '../../shared/audience-timer';
import {
  type EngineState,
  initialEngineState,
  type MessageItem,
  type SlideLayer,
} from '../../shared/engine/state';
import { roleLook } from '../../shared/looks';
import { animationLength, LOWER_THIRD_ANIMATIONS } from '../../shared/lower-third-animations';
import { NEW_LOWER_THIRD } from '../../shared/lower-thirds';
import { DEFAULT_MESSAGE_LOOK, messageAnimation } from '../../shared/message-look';
import type { RenderSlide } from '../../shared/model';
import { ZOOM_GLIDE_MS } from '../../shared/picture-look';
import {
  captureWithShowAbort,
  nextScheduledChange,
  PNG_WAIT_MS,
  slidePictureReadyAt,
  waitForSlidePicture,
  whileScreensMove,
} from './slide-picture';

/*
 * When the hall screens are still enough for a phone's Save at a click (C6's review, HIGH): besides the slide's own
 * motion, a message coming in or going out (its words a unit at a time) and one with a live timer, the band of
 * standard messages coming in, the chosen wallpaper fading into its next picture, the live zoom's glide, a timer for the
 * audience fading out and a key and fill pair's moving lower third. Placeholder states only.
 */

const NOW = 1_000_000;

it('aborts a phone capture when an engine change makes the hall screens busy', async () => {
  const listeners = new Set<() => void>();
  const subscribe = (changed: () => void) => {
    listeners.add(changed);
    return () => {
      listeners.delete(changed);
    };
  };
  let still = true;
  const deadline = new AbortController();
  let capturing: AbortSignal | undefined;
  const result = captureWithShowAbort(
    subscribe,
    () => still,
    deadline.signal,
    (signal) => {
      capturing = signal;
      return new Promise<null>((resolve) =>
        signal.addEventListener('abort', () => resolve(null), { once: true }),
      );
    },
  );
  expect(listeners.size).toBe(1);
  for (const changed of listeners) changed();
  expect(capturing?.aborted).toBe(false);
  still = false;
  for (const changed of listeners) changed();
  expect(capturing?.aborted).toBe(true);
  expect(deadline.signal.aborted).toBe(false);
  expect(await result).toBeNull();
  expect(listeners.size).toBe(0);
});

it('also unsubscribes after the capture deadline aborts', async () => {
  const off = vi.fn();
  const deadline = new AbortController();
  const result = captureWithShowAbort(
    () => off,
    () => true,
    deadline.signal,
    (signal) =>
      new Promise<null>((resolve) => signal.addEventListener('abort', () => resolve(null), { once: true })),
  );
  deadline.abort();
  expect(await result).toBeNull();
  expect(off).toHaveBeenCalledOnce();
});

it('hands a capture no longer wanted at the start a stopped signal, so its hidden window never opens', async () => {
  // The screens changed between Main's last look and the capture (C18's review, LOW-1): the session's start()
  // refuses a stopped signal before opening anything (library/pdf-copy-session.ts).
  const off = vi.fn();
  const deadline = new AbortController();
  const stoppedAtStart: boolean[] = [];
  const result = captureWithShowAbort(
    () => off,
    () => false,
    deadline.signal,
    (signal) => {
      stoppedAtStart.push(signal.aborted);
      return Promise.resolve(null);
    },
  );
  expect(await result).toBeNull();
  expect(stoppedAtStart).toEqual([true]);
  expect(deadline.signal.aborted).toBe(false);
  expect(off).toHaveBeenCalledOnce();
});

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

/** A wallpaper going round while nothing is up: each picture 10 s, fading into the next over 1.5 s. */
const roundWallpaper = (since: number) => ({
  id: 'placeholder-wallpaper',
  name: 'Placeholder wallpaper',
  pictures: ['placeholder-a', 'placeholder-b'],
  secondsEach: 10,
  fadeMs: 1500,
  since,
});

describe('what the engine has scheduled for the hall screens (C6’s review, MEDIUM 2)', () => {
  it('is nothing when nothing is due', () => {
    expect(nextScheduledChange(initialEngineState(), NOW)).toBe(Infinity);
  });

  it('is the soonest of the slide moving on and a message’s or a lower third’s time up', () => {
    const lowerThird = {
      ...NEW_LOWER_THIRD,
      id: 'placeholder-lower-third',
      lines: ['Placeholder name', '', ''],
      seconds: 5,
      shownAt: NOW - 2_000,
    };
    const due = stateWith((s) => {
      s.autoAdvance = { startedAt: NOW - 1_000, durationMs: 5_000 };
      s.layers.messages = [{ ...message, until: NOW + 6_000 }];
      s.layers.lowerThird = lowerThird;
    });
    expect(nextScheduledChange(due, NOW)).toBe(NOW + 3_000);
    expect(nextScheduledChange({ ...due, layers: { ...due.layers, lowerThird: null } }, NOW)).toBe(
      NOW + 4_000,
    );
    // Past its moment, the engine is about to act: due now.
    const late = stateWith((s) => {
      s.autoAdvance = { startedAt: NOW - 6_000, durationMs: 5_000 };
    });
    expect(nextScheduledChange(late, NOW)).toBe(NOW - 1_000);
  });

  it('is the wallpaper’s next fade where it shows, and the next after the one under way', () => {
    const between = stateWith((s) => {
      s.chosenWallpaper = roundWallpaper(NOW - 1_000);
    });
    expect(nextScheduledChange(between, NOW)).toBe(NOW + 7_500);
    const fading = stateWith((s) => {
      s.chosenWallpaper = roundWallpaper(NOW - 9_000);
    });
    expect(nextScheduledChange(fading, NOW)).toBe(NOW + 9_500);
    // A cut (no fade) changes the picture at the end of its seconds.
    const cut = stateWith((s) => {
      s.chosenWallpaper = { ...roundWallpaper(NOW - 1_000), fadeMs: 0 };
    });
    expect(nextScheduledChange(cut, NOW)).toBe(NOW + 9_000);
    // Hidden by a slide: nothing to see.
    const hidden = stateWith((s) => {
      s.chosenWallpaper = roundWallpaper(NOW - 1_000);
      s.layers.slide = slideLayer(NOW - 60_000);
    });
    expect(nextScheduledChange(hidden, NOW)).toBe(Infinity);
  });

  it('is the background video’s end with nothing over it, when the engine acts on it', () => {
    const video = {
      kind: 'media' as const,
      mediaId: 'placeholder-video',
      media: 'video' as const,
      fit: 'fit' as const,
      loop: false,
      startedAt: NOW - 1_000,
      durationMs: 5_000,
    };
    const playing = stateWith((s) => {
      s.layers.background = video;
    });
    expect(nextScheduledChange(playing, NOW)).toBe(NOW + 4_000);
    const looping = stateWith((s) => {
      s.layers.background = { ...video, loop: true };
    });
    expect(nextScheduledChange(looping, NOW)).toBe(Infinity);
    const under = stateWith((s) => {
      s.layers.background = video;
      s.layers.slide = slideLayer(NOW - 60_000);
    });
    expect(nextScheduledChange(under, NOW)).toBe(Infinity);
    const ended = stateWith((s) => {
      s.layers.background = { ...video, startedAt: NOW - 6_000 };
    });
    expect(nextScheduledChange(ended, NOW)).toBe(Infinity);
  });
});

describe('waiting for a capture’s quiet time', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /** The engine's clock and the timers, moved on together. */
  function clock() {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    return { now: () => Date.now(), pass: (ms: number) => vi.advanceTimersByTimeAsync(ms) };
  }

  it('answers with a picture from the slide at once when the slide moves on within the capture’s time', async () => {
    const c = clock();
    const s = stateWith((x) => {
      x.autoAdvance = { startedAt: NOW - 1_000, durationMs: 5_000 };
    });
    let answer: number | null | undefined;
    void waitForSlidePicture(() => s, c.now).then((a) => {
      answer = a;
    });
    await c.pass(0);
    expect(answer).toBeNull();
  });

  it('waits past the wallpaper’s fade due in a second, then has its time to itself', async () => {
    const c = clock();
    // Its next fade from 1 s to 2.5 s from now, and the one after 11 s from now.
    const s = stateWith((x) => {
      x.chosenWallpaper = roundWallpaper(NOW - 7_500);
    });
    let answer: number | null | undefined;
    void waitForSlidePicture(() => s, c.now).then((a) => {
      answer = a;
    });
    await c.pass(2_499);
    expect(answer).toBeUndefined();
    await c.pass(1);
    // 8 s from then would pass 9 s from the ask: it ends 9 s from the ask.
    expect(answer).toBe(NOW + 9_000);
  });

  it('waits past a message’s time up and its going out, as the engine takes it off', async () => {
    const c = clock();
    const s = stateWith((x) => {
      x.layers.messages = [{ ...message, shownAt: NOW - 60_000, until: NOW + 500 }];
    });
    // The engine at the message's time: off, going out from then (engine/timed.ts).
    setTimeout(() => {
      s.layers.messages = [];
      s.messagesOff = [{ message, at: NOW + 500 }];
    }, 500);
    let answer: number | null | undefined;
    void waitForSlidePicture(() => s, c.now).then((a) => {
      answer = a;
    });
    await c.pass(500 + messageOut - 1);
    expect(answer).toBeUndefined();
    await c.pass(1);
    expect(answer).toBe(Math.min(NOW + 500 + messageOut + 8_000, NOW + 9_000));
  });
});

describe('the PNG made in the network’s process, never while the hall screens move (C18’s review, LOW-2)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /** The pace by these screens, with the engine's clock and the timers moved on together. */
  function paced(state: () => EngineState | null) {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const pace = whileScreensMove(state, () => Date.now());
    /** One look before a slice: whether it has let the PNG go on yet. */
    const look = () => {
      let goes = false;
      void pace().then(() => {
        goes = true;
      });
      return () => goes;
    };
    return { look, pass: (ms: number) => vi.advanceTimersByTimeAsync(ms) };
  }

  const dissolving = (at: number, durationMs: number): SlideLayer => ({
    ...slideLayer(at),
    transition: { kind: 'dissolve', durationMs },
  });

  it('goes on at once while the screens are still, and before the engine’s state has come', async () => {
    for (const screens of [initialEngineState(), null]) {
      const p = paced(() => screens);
      const goes = p.look();
      await p.pass(0);
      expect(goes()).toBe(true);
      vi.useRealTimers();
    }
  });

  it('waits out a transition the operator starts while the PNG is made, then goes on', async () => {
    const s = stateWith((x) => {
      x.layers.slide = dissolving(NOW, 800);
    });
    const p = paced(() => s);
    const goes = p.look();
    await p.pass(799);
    expect(goes()).toBe(false);
    await p.pass(1);
    expect(goes()).toBe(true);
    // Still now: the next slice goes on at once.
    const next = p.look();
    await p.pass(0);
    expect(next()).toBe(true);
  });

  it('waits out motion that starts while it waits', async () => {
    const s = stateWith((x) => {
      x.layers.slide = dissolving(NOW, 500);
    });
    const p = paced(() => s);
    // Next again 400 ms in: another 500 ms from then.
    setTimeout(() => {
      s.layers.slide = dissolving(NOW + 400, 500);
    }, 400);
    const goes = p.look();
    await p.pass(899);
    expect(goes()).toBe(false);
    await p.pass(1);
    expect(goes()).toBe(true);
  });

  it('waits 3 s at most in all, across its slices, then goes on without waiting again', async () => {
    expect(PNG_WAIT_MS).toBe(3_000);
    const s = stateWith((x) => {
      x.layers.slide = dissolving(NOW, 2_000);
    });
    const p = paced(() => s);
    const first = p.look();
    await p.pass(2_000);
    expect(first()).toBe(true);
    // Then motion that keeps going (a message with a live timer): the second left of the 3 s, and no more.
    s.layers.messages = [
      {
        id: 'placeholder-timed',
        text: '[Placeholder timer]',
        parts: [{ kind: 'timer', timerId: 'placeholder-timer' }],
        shownAt: NOW,
      },
    ];
    const second = p.look();
    await p.pass(999);
    expect(second()).toBe(false);
    await p.pass(1);
    expect(second()).toBe(true);
    const third = p.look();
    await p.pass(0);
    expect(third()).toBe(true);
  });
});
