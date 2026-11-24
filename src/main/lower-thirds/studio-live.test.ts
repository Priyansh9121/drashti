import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScreenRole } from '../../shared/screens';
import type { StudioLivePicture } from '../../shared/studio-live';
import {
  type CapturedImage,
  hallScreenOf,
  LIVE_EVERY_MS,
  LIVE_TAKE_LIMIT_MS,
  LIVE_WIDTH,
  livePictureOf,
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
    // (Within the time limit: past it, the still counts as none: the next test.)
    await vi.advanceTimersByTimeAsync(LIVE_TAKE_LIMIT_MS - 1);
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

  it('a still that never comes counts as none after LIVE_TAKE_LIMIT_MS, and Live carries on', async () => {
    let n = 0;
    const take = vi.fn(() =>
      ++n === 1 ? new Promise<StudioLivePicture | null>(() => undefined) : Promise.resolve(picture(n)),
    );
    const { live, sent } = make(take);
    live.watch(true);
    await vi.advanceTimersByTimeAsync(LIVE_TAKE_LIMIT_MS - 1);
    expect(sent).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(sent).toEqual([null]);
    await vi.advanceTimersByTimeAsync(LIVE_EVERY_MS);
    expect(sent).toEqual([null, picture(2)]);
    live.watch(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('takes nothing while the studio is minimized, one at once when it comes back; closed, nothing is wanted', async () => {
    const take = vi.fn(() => Promise.resolve(picture(1)));
    const { live } = make(take);
    live.watch(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(take).toHaveBeenCalledTimes(1);
    live.pause(true);
    expect(live.watching).toBe(false);
    await vi.advanceTimersByTimeAsync(LIVE_EVERY_MS * 5);
    expect(take).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    live.pause(false);
    expect(live.watching).toBe(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(take).toHaveBeenCalledTimes(2);
    // Another backdrop chosen while minimized: nothing when it comes back.
    live.pause(true);
    live.watch(false);
    live.pause(false);
    await vi.advanceTimersByTimeAsync(LIVE_EVERY_MS * 3);
    expect(take).toHaveBeenCalledTimes(2);
    // Closed while minimized: the next studio's Live is taken at once.
    live.watch(true);
    await vi.advanceTimersByTimeAsync(0);
    live.pause(true);
    live.stop();
    expect(live.watching).toBe(false);
    live.watch(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(take).toHaveBeenCalledTimes(4);
    live.stop();
    expect(vi.getTimerCount()).toBe(0);
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
    // None showing here (none set up, a single display, or only on nodes): no still ("No live picture to show").
    expect(hallScreenOf(screens, roleOf, (id) => id === 's-stage')).toBeNull();
    expect(hallScreenOf([], roleOf, () => true)).toBeNull();
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
    expect(livePictureOf(image(640, 360), 'screen', 6)?.at).toBe(6);
    expect(asked).toEqual([LIVE_WIDTH, 640]);
    expect(livePictureOf(image(1920, 1080, true), 'screen', 7)).toBeNull();
  });
});
