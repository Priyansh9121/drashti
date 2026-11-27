import { describe, expect, it } from 'vitest';
import { framesVerdict, meter } from '../../../tests/e2e/route-c-frames';

/*
 * caption-ai-chain.spec.ts's verdict on the stream page's own frames while Route C hears each sound (cap-realc). The
 * owner, 24 Nov 2026 (QA23-REALC-2), word for word: "Mac: log frames only (Rec.)". So on the Mac this release records
 * the frames and does not judge them; Windows keeps the verdict exactly as it was (lead 2's QR-1 A: worse only when
 * every sound's window is worse than both captions-off windows).
 */

/** Window figures as the chain's meter gives them: p95 and longest gap (ms), gaps over 1.5 periods, frames. */
const w = (p95: number, longest: number, over15: number, frames: number) => ({
  frames,
  period: 33.3,
  p95,
  longest,
  over15,
});
/** Run 45345171540's Mac first try (cap-packimport-1124-180414-12700): the one false alarm in 13 Mac tries. */
const flaky = {
  controls: [w(33.4, 66.7, 1, 89), w(33.4, 33.4, 0, 77)],
  trials: [w(33.4, 66.7, 2, 62), w(66.7, 66.7, 4, 53)],
};
/** Its retry, which passed. */
const clean = {
  controls: [w(33.4, 66.7, 1, 89), w(33.4, 33.4, 0, 76)],
  trials: [w(33.4, 66.7, 2, 55), w(33.4, 33.4, 0, 54)],
};

describe('the chain’s stream-frames verdict', () => {
  it('Windows: judged as before, worse only when every sound’s window is worse than both controls', () => {
    expect(framesVerdict('win32', flaky.trials, flaky.controls)).toEqual({ judged: true, worse: true });
    expect(framesVerdict('win32', clean.trials, clean.controls)).toEqual({ judged: true, worse: false });
    // One sound's window no worse than one control: not worse.
    expect(framesVerdict('win32', [w(66.7, 66.7, 4, 53), w(33.4, 33.4, 0, 60)], flaky.controls)).toEqual({
      judged: true,
      worse: false,
    });
  });

  it('the Mac (the owner: "Mac: log frames only"): the same figures, worked out and recorded, never judged', () => {
    expect(framesVerdict('darwin', flaky.trials, flaky.controls)).toEqual({ judged: false, worse: true });
    expect(framesVerdict('darwin', clean.trials, clean.controls)).toEqual({ judged: false, worse: false });
    expect(framesVerdict('darwin', flaky.trials, flaky.controls, 'fake-microphone')).toEqual({
      judged: false,
      worse: true,
    });
  });

  it('the Mac judged again only through the stream-clock seam (alpha.23), never with the fake microphone', () => {
    expect(framesVerdict('darwin', flaky.trials, flaky.controls, 'stream-clock')).toEqual({
      judged: true,
      worse: true,
    });
    expect(framesVerdict('darwin', clean.trials, clean.controls, 'stream-clock')).toEqual({
      judged: true,
      worse: false,
    });
    expect(framesVerdict('win32', flaky.trials, flaky.controls, 'stream-clock')).toEqual({
      judged: true,
      worse: true,
    });
  });

  it('the meter reads a window as before: the gaps’ 95th percentile, the longest, those over 1.5 periods', () => {
    const frames = [0, 33, 67, 100, 167, 200, 233, 300, 333];
    expect(meter(frames, 0, 333)).toEqual({ frames: 9, period: 33, p95: 67, longest: 67, over15: 2 });
    expect(meter(frames, 0, 100, 33.3)).toEqual({ frames: 4, period: 33.3, p95: 34, longest: 34, over15: 0 });
  });
});
