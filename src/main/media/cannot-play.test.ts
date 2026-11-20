import { describe, expect, it } from 'vitest';
import { CANNOT_PLAY_SETTLE_MS, CannotPlay, errorKindWords, GPU_GONE_GRACE_MS } from './cannot-play';

/** A CannotPlay on a hand-turned clock: what ran, and the clock to move. */
function rig() {
  let now = 100_000;
  const waiting: { at: number; run: () => void }[] = [];
  const ran: string[] = [];
  const c = new CannotPlay({
    now: () => now,
    later: (ms, run) => {
      waiting.push({ at: now + ms, run });
    },
  });
  const to = (t: number) => {
    now = t;
    for (const w of waiting.splice(0).sort((a, b) => a.at - b.at))
      if (w.at <= now) w.run();
      else waiting.push(w);
  };
  const heard = () => {
    c.heard(
      () => ran.push('off'),
      () => ran.push('gpu'),
    );
  };
  return { c, heard, ran, to, at: () => now };
}

describe('a video that could not play (Q60-31)', () => {
  it('is taken off after the short wait', () => {
    const r = rig();
    r.heard();
    r.to(r.at() + CANNOT_PLAY_SETTLE_MS - 1);
    expect(r.ran).toEqual([]);
    r.to(r.at() + 1);
    expect(r.ran).toEqual(['off']);
  });

  it('is left to load again when a GPU process stopped just before the word, or within the wait after it', () => {
    const before = rig();
    before.c.gpuGone();
    before.to(before.at() + GPU_GONE_GRACE_MS - 1);
    before.heard();
    before.to(before.at() + CANNOT_PLAY_SETTLE_MS);
    expect(before.ran).toEqual(['gpu']);
    const after = rig();
    after.heard();
    after.to(after.at() + CANNOT_PLAY_SETTLE_MS - 10);
    after.c.gpuGone();
    after.to(after.at() + 10);
    expect(after.ran).toEqual(['gpu']);
  });

  it('is taken off when the GPU process stopped long before the word', () => {
    const r = rig();
    r.c.gpuGone();
    r.to(r.at() + GPU_GONE_GRACE_MS + 1);
    r.heard();
    r.to(r.at() + CANNOT_PLAY_SETTLE_MS);
    expect(r.ran).toEqual(['off']);
  });
});

describe('a media element’s error in words for the log', () => {
  it('says MediaError’s four codes plainly, and none for anything else', () => {
    expect([1, 2, 3, 4, 0, 9].map(errorKindWords)).toEqual([
      'stopped',
      'a network or file error',
      'a decoding error',
      'not playable here',
      'an error with no code',
      'an error with no code',
    ]);
  });
});
