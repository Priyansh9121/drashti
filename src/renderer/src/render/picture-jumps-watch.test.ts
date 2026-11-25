import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { type PictureJump, watchPictureJumps } from '../../../../tests/e2e/picture-jumps';

/*
 * The cost spec's picture-jump watch (tests/e2e/picture-jumps.ts) with a stand-in page: a jump ends when its picture
 * lands, and (the owner's QFP-6 item 3, "Yes, stop at removal") when its element leaves the page; a picture still in the
 * page that never lands stays frozen, as before. An element's events reach the page's listeners only while it is in
 * the page, as a real one's do.
 */

class FakeVideo {
  readonly dataset: Record<string, string>;
  seeking = false;
  isConnected = true;
  constructor(key: string) {
    this.dataset = { bgSlot: key };
  }
}

let listeners: Record<string, ((e: { type: string; target: unknown }) => void)[]> = {};
let observed: (() => void) | null = null;

beforeEach(() => {
  listeners = {};
  observed = null;
  vi.useFakeTimers();
  vi.setSystemTime(1000);
  vi.stubGlobal('document', {
    addEventListener: (type: string, fn: (e: { type: string; target: unknown }) => void) => {
      (listeners[type] ??= []).push(fn);
    },
  });
  vi.stubGlobal('HTMLVideoElement', FakeVideo);
  vi.stubGlobal('Node', FakeVideo);
  vi.stubGlobal(
    'MutationObserver',
    class {
      constructor(callback: () => void) {
        observed = callback;
      }
      observe(): void {
        /* the stand-in page calls back on each removal */
      }
    },
  );
  watchPictureJumps();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** An element's event, heard by the page only while the element is in it. */
const fire = (el: FakeVideo, type: string) => {
  if (el.isConnected) for (const fn of listeners[type] ?? []) fn({ type, target: el });
};
const at = (ms: number) => {
  vi.setSystemTime(ms);
};
const jumps = () => (globalThis as { s5PictureJumps?: PictureJump[] }).s5PictureJumps ?? [];
/** Let go of: the element leaves the page, then its file is let go (its 'emptied' fires detached). */
const remove = (el: FakeVideo) => {
  el.isConnected = false;
  observed?.();
  fire(el, 'emptied');
};

it('a jump that lands ends there; one sent again as it lands stays frozen', () => {
  const v = new FakeVideo('red@1');
  at(1000);
  v.seeking = true;
  fire(v, 'seeking');
  at(1100);
  // Sent again as it lands: still seeking, still frozen.
  fire(v, 'seeked');
  expect(jumps()).toEqual([{ key: 'red@1', from: 1000, to: null, left: null }]);
  at(1300);
  v.seeking = false;
  fire(v, 'seeked');
  expect(jumps()).toEqual([{ key: 'red@1', from: 1000, to: 1300, left: null }]);
});

it('a picture let go of in the page before it landed was frozen until then', () => {
  const v = new FakeVideo('red@1');
  v.seeking = true;
  fire(v, 'seeking');
  at(1400);
  fire(v, 'emptied');
  expect(jumps()).toEqual([{ key: 'red@1', from: 1000, to: 1400, left: null }]);
});

it('a picture whose element leaves the page mid-jump was frozen until it left, and no longer (the owner’s QFP-6 item 3)', () => {
  const v = new FakeVideo('red@1');
  v.seeking = true;
  fire(v, 'seeking');
  at(1500);
  remove(v);
  at(60_000);
  // The old watch kept it open (to: null) for the rest of the test: a picture on no screen, counted frozen in every
  // later fade. Its element's leaving is recorded (B) and ends it there.
  expect(jumps()).toEqual([{ key: 'red@1', from: 1000, to: 1500, left: 1500 }]);
});

it('a picture still in the page that never lands stays frozen: the strict check still fails it', () => {
  const v = new FakeVideo('red@1');
  const other = new FakeVideo('blue@2');
  v.seeking = true;
  fire(v, 'seeking');
  at(2000);
  // Another element leaving the page ends nothing of this one.
  remove(other);
  at(60_000);
  expect(jumps()).toEqual([{ key: 'red@1', from: 1000, to: null, left: null }]);
});
