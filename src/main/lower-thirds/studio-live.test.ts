import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScreenRole } from '../../shared/screens';
import type { StudioLivePicture } from '../../shared/studio-live';
import {
  type CapturedImage,
  hallScreenOf,
  LIVE_EVERY_MS,
  LIVE_WIDTH,
  livePictureOf,
  liveRectOf,
  StudioLive,
} from './studio-live';

/*
 * Live behind the Lower Thirds studio's preview (alpha.22): a still of what is live, taken about once a second while
 * the studio shows Live and never otherwise (nothing left running once it is closed or shows another backdrop), each
 * taken only after the one before is done, from a hall screen's window on this computer, else LIVE in the operator
 * window.
 */

const picture = (n: number): StudioLivePicture => ({
  url: `data:image/jpeg;base64,${String(n)}`,
  source: 'screen',
  at: n,
});

describe('StudioLive', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function make(take: () => Promise<StudioLivePicture | null>) {
    const sent: (StudioLivePicture | null)[] = [];
    const lines: string[] = [];
    const live = new StudioLive({
      take,
      send: (p) => sent.push(p),
      log: (l) => lines.push(l),
    });
    return { live, sent, lines };
  }

  it('takes nothing until asked; then one at once and one about every second; none once told to stop', async () => {
    let n = 0;
    const take = vi.fn(() => Promise.resolve(picture(++n)));
    const { live, sent, lines } = make(take);
    await vi.advanceTimersByTimeAsync(5000);
    expect(take).not.toHaveBeenCalled();
    expect(live.watching).toBe(false);

    live.watch(true);
    expect(live.watching).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toEqual([picture(1)]);
    await vi.advanceTimersByTimeAsync(LIVE_EVERY_MS);
    expect(sent).toEqual([picture(1), picture(2)]);
    await vi.advanceTimersByTimeAsync(LIVE_EVERY_MS * 3);
    expect(sent).toHaveLength(5);
    expect(live.taken).toBe(5);
    // Asked again while it already watches: nothing more.
    live.watch(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(take).toHaveBeenCalledTimes(5);

    live.watch(false);
    expect(live.watching).toBe(false);
    await vi.advanceTimersByTimeAsync(LIVE_EVERY_MS * 10);
    expect(take).toHaveBeenCalledTimes(5);
    expect(vi.getTimerCount()).toBe(0);
    expect(lines).toHaveLength(2);
  });

  it('never takes the next before the one before is done, and never sends one that came after it stopped', async () => {
    const pending: ((p: StudioLivePicture | null) => void)[] = [];
    const take = vi.fn(
      () =>
        new Promise<StudioLivePicture | null>((resolve) => {
          pending.push(resolve);
        }),
    );
    const { live, sent } = make(take);
    live.watch(true);
    await vi.advanceTimersByTimeAsync(LIVE_EVERY_MS * 5);
    expect(take).toHaveBeenCalledTimes(1);
    pending[0]?.(picture(1));
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toEqual([picture(1)]);
    await vi.advanceTimersByTimeAsync(LIVE_EVERY_MS);
    expect(take).toHaveBeenCalledTimes(2);
    // Stopped while that one is being taken: it is never sent, and nothing is taken after it.
    live.watch(false);
    pending[1]?.(picture(2));
    await vi.advanceTimersByTimeAsync(LIVE_EVERY_MS * 5);
    expect(sent).toEqual([picture(1)]);
    expect(take).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('says when there is nothing to take it from, and carries on after a picture that failed', async () => {
    const results: (() => Promise<StudioLivePicture | null>)[] = [
      () => Promise.resolve(null),
      () => Promise.reject(new Error('capture failed')),
      () => Promise.resolve(picture(3)),
    ];
    let i = 0;
    const { live, sent } = make(() => (results[i++] ?? results[2] ?? (() => Promise.resolve(null)))());
    live.watch(true);
    await vi.advanceTimersByTimeAsync(LIVE_EVERY_MS * 2);
    expect(sent).toEqual([null, null, picture(3)]);
    live.watch(false);
  });

  it('started again after a stop, it takes one at once', async () => {
    const take = vi.fn(() => Promise.resolve(picture(1)));
    const { live } = make(take);
    live.watch(true);
    await vi.advanceTimersByTimeAsync(0);
    live.watch(false);
    live.watch(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(take).toHaveBeenCalledTimes(2);
    live.watch(false);
  });
});

describe('where Live takes its picture', () => {
  const roles: Record<string, ScreenRole> = {
    hall: 'audience',
    stage: 'stage',
    kf: 'keyfill',
    hall2: 'audience',
  };
  const roleOf = (g: string): ScreenRole | null => roles[g] ?? null;

  it('the first audience screen showing on this computer (in Screens’ order); never a stage or key and fill one', () => {
    const screens = [
      { id: 's-stage', groupId: 'stage' },
      { id: 's-kf', groupId: 'kf' },
      { id: 's-hall-a', groupId: 'hall' },
      { id: 's-hall-b', groupId: 'hall' },
      { id: 's-hall2', groupId: 'hall2' },
    ];
    expect(hallScreenOf(screens, roleOf, () => true)).toBe('s-hall-a');
    expect(hallScreenOf(screens, roleOf, (id) => id !== 's-hall-a')).toBe('s-hall-b');
    expect(hallScreenOf(screens, roleOf, (id) => id === 's-hall2' || id === 's-stage')).toBe('s-hall2');
    // None showing here (none set up, or only on nodes): LIVE in the operator window instead.
    expect(hallScreenOf(screens, roleOf, (id) => id === 's-stage')).toBeNull();
    expect(hallScreenOf([], roleOf, () => true)).toBeNull();
  });

  it('LIVE’s picture as the operator window shows it: the scene inside LIVE’s box and the window, in whole points', () => {
    const view = { width: 1024, height: 645 };
    const box = { x: 10, y: 40, width: 402, height: 228 };
    expect(liveRectOf({ box, scene: { x: 12, y: 42, width: 398, height: 224 }, view })).toEqual({
      x: 12,
      y: 42,
      width: 398,
      height: 224,
    });
    // Zoomed in (the scene larger than its box): only what the box shows.
    expect(liveRectOf({ box, scene: { x: -200, y: -100, width: 1200, height: 675 }, view })).toEqual({
      x: 10,
      y: 40,
      width: 402,
      height: 228,
    });
    // Scrolled partly out of the window: the part in it; wholly out, or too small: none.
    expect(
      liveRectOf({ box: { ...box, y: -100 }, scene: { x: 10, y: -100, width: 402, height: 228 }, view }),
    ).toEqual({ x: 10, y: 0, width: 402, height: 128 });
    expect(liveRectOf({ box: { ...box, y: 700 }, scene: { ...box, y: 700 }, view })).toBeNull();
    expect(liveRectOf({ box: { ...box, width: 4 }, scene: { ...box, width: 4 }, view })).toBeNull();
    expect(liveRectOf(null)).toBeNull();
    expect(liveRectOf({ box: 'x' })).toBeNull();
  });

  it('a still is a JPEG at most LIVE_WIDTH wide, never wider than taken; an empty picture is none', () => {
    const asked: number[] = [];
    const image = (width: number, height: number, empty = false): CapturedImage => ({
      isEmpty: () => empty,
      getSize: () => ({ width, height }),
      resize: ({ width: w }) => {
        asked.push(w);
        return image(w, Math.round((height * w) / width));
      },
      toJPEG: () => Buffer.from('jpeg'),
    });
    expect(livePictureOf(image(1920, 1080), 'screen', 5)).toEqual({
      url: `data:image/jpeg;base64,${Buffer.from('jpeg').toString('base64')}`,
      source: 'screen',
      at: 5,
    });
    expect(asked).toEqual([LIVE_WIDTH]);
    expect(livePictureOf(image(640, 360), 'live', 6)?.source).toBe('live');
    expect(asked).toEqual([LIVE_WIDTH, 640]);
    expect(livePictureOf(image(1920, 1080, true), 'screen', 7)).toBeNull();
  });
});
