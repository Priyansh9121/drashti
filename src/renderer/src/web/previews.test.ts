import { describe, expect, it } from 'vitest';
import { drawnWidth } from '../render/previews';
import { devicePictures, type PictureFetch } from './previews';

/*
 * A phone's pictures at the width it draws them (Session 54, D1): the step asked for, the sharpest kept and given
 * to every place, a smaller one let go after, never a narrower one asked again, the whole picture known, a picture
 * not ready tried again later, and no more kept than a phone should hold. Made-up ids and sizes; no network.
 */

function setup(options: { bytes?: number; fail?: Set<string>; keepBytes?: number } = {}) {
  const asked: string[] = [];
  const revoked: string[] = [];
  const timers: { at: number; run: () => void }[] = [];
  let now = 1_000_000;
  let urls = 0;
  let holdFetches = false;
  const held: (() => void)[] = [];
  const fetchPicture: PictureFetch = async (mediaId, step) => {
    asked.push(`${mediaId}@${String(step)}`);
    if (holdFetches) await new Promise<void>((resolve) => held.push(resolve));
    if (options.fail?.has(mediaId)) return null;
    return { blob: new Blob([new Uint8Array(options.bytes ?? 100)]) };
  };
  const loader = devicePictures({
    fetchPicture,
    createUrl: () => `blob:picture-${String(++urls)}`,
    revokeUrl: (url) => revoked.push(url),
    now: () => now,
    later: (run, ms) => timers.push({ at: now + ms, run }),
    ...(options.keepBytes ? { keepBytes: options.keepBytes } : {}),
  });
  return {
    loader,
    asked,
    revoked,
    pass: (ms: number) => {
      now += ms;
      for (const t of timers.splice(0).filter((x) => x.at <= now)) t.run();
    },
    holdFetches: () => {
      holdFetches = true;
    },
    release: () => {
      holdFetches = false;
      for (const r of held.splice(0)) r();
    },
    inFlight: () => held.length,
  };
}

describe('a phone’s pictures at the width it draws them (Session 54, D1)', () => {
  it('asks for the step a place draws, and the smallest when no width is given', async () => {
    const { loader, asked } = setup();
    await loader.load('m1');
    await loader.load('m2', 1029);
    await loader.load('m3', 4500);
    expect(asked).toEqual(['m1@320', 'm2@1280', 'm3@7680']);
  });

  it('keeps the sharpest, tells every place drawing it, lets the smaller go after, and never asks narrower again', async () => {
    const { loader, asked, revoked, pass } = setup();
    const small = await loader.load('m1', 500);
    let told = 0;
    const stop = loader.subscribe('m1', () => told++);
    const big = await loader.load('m1', 2000);
    expect(big).not.toBe(small);
    expect(loader.cached('m1')).toBe(big);
    expect(told).toBe(1);
    // A thumbnail asking again for its small width is given the sharp one, with nothing fetched.
    expect(await loader.load('m1', 400)).toBe(big);
    expect(asked).toEqual(['m1@640', 'm1@2560']);
    // The small one is let go a little later, once every place has moved on.
    expect(revoked).toEqual([]);
    pass(10_000);
    expect(revoked).toEqual([small]);
    stop();
  });

  it('asks for no wider once it has the whole picture', async () => {
    const { loader, asked } = setup();
    const url = (await loader.load('m1', 3000)) ?? '';
    // Drawn, it is 1600 wide: narrower than the step (3840), so it is the whole picture.
    loader.measured('m1', url, 1600);
    expect(await loader.load('m1', 7000)).toBe(url);
    expect(asked).toEqual(['m1@3840']);
  });

  it('tries a picture not ready again a little later, keeping the one it has meanwhile', async () => {
    const fail = new Set<string>();
    const { loader, asked, pass } = setup({ fail });
    const small = await loader.load('m1', 300);
    fail.add('m1');
    expect(await loader.load('m1', 1200)).toBe(small);
    expect(await loader.load('m1', 1200)).toBe(small);
    expect(asked).toEqual(['m1@320', 'm1@1280']);
    fail.delete('m1');
    pass(15_000);
    expect(await loader.load('m1', 1200)).not.toBe(small);
    expect(asked).toEqual(['m1@320', 'm1@1280', 'm1@1280']);
    // None at all: null, and a second ask meanwhile waits for the same fetch.
    fail.add('m2');
    expect(await loader.load('m2', 600)).toBeNull();
  });

  it('fetches three at a time, and one picture once however many places ask', async () => {
    const { loader, asked, holdFetches, release, inFlight } = setup();
    holdFetches();
    const all = ['a', 'b', 'c', 'd', 'e'].map((id) => loader.load(id, 600));
    const again = loader.load('a', 640);
    await Promise.resolve();
    await Promise.resolve();
    expect(inFlight()).toBe(3);
    release();
    await Promise.all([...all, again]);
    expect(asked.filter((a) => a === 'a@640')).toHaveLength(1);
    expect(asked).toHaveLength(5);
  });

  it('keeps no more than a phone should hold, letting the least recently used go, never one drawn now', async () => {
    // Two fit; a third does not.
    const { loader, revoked, pass } = setup({ bytes: 450, keepBytes: 1000 });
    const first = await loader.load('m1', 600);
    const release = loader.hold('m1');
    pass(1);
    const second = await loader.load('m2', 600);
    pass(1);
    // Over: m1 is the least recently used, but drawn now, so m2 goes.
    const third = await loader.load('m3', 600);
    expect(revoked).toEqual([second]);
    expect(loader.cached('m1')).toBe(first);
    expect(loader.cached('m2')).toBeUndefined();
    expect(loader.cached('m3')).toBe(third);
    release();
  });
});

describe('how wide a picture is drawn (Session 54, D1)', () => {
  it('is its box on the screen in device pixels, or wider when it fills a box of another shape', () => {
    // A live picture 343 CSS pixels wide on a phone of 3 device pixels to each.
    expect(drawnWidth({ width: 343, height: 193 }, 'contain', null, 3)).toBe(1029);
    // A wide picture (21:9) filling a 16:9 box: as wide as its height asks.
    expect(drawnWidth({ width: 160, height: 90 }, 'cover', { width: 2100, height: 900 }, 2)).toBe(420);
    // A narrow one filling it: the box's width.
    expect(drawnWidth({ width: 160, height: 90 }, 'cover', { width: 900, height: 1600 }, 2)).toBe(320);
    expect(drawnWidth({ width: 100, height: 50 }, 'fill', null, Number.NaN)).toBe(100);
  });
});
