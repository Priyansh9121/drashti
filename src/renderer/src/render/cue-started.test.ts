import { describe, expect, it, vi } from 'vitest';
import { cueStarted, whenCueStarted } from './cue-started';

describe("the operator preview's word that a cued picture started at Go", () => {
  it('runs what waits for it once it starts, at once once it has, and nothing cancelled', () => {
    const waited = vi.fn(),
      cancelled = vi.fn();
    whenCueStarted('cue-a', waited);
    whenCueStarted('cue-a', cancelled)();
    expect(waited).not.toHaveBeenCalled();
    cueStarted('cue-a');
    expect(waited).toHaveBeenCalledTimes(1);
    expect(cancelled).not.toHaveBeenCalled();
    const after = vi.fn();
    whenCueStarted('cue-a', after);
    expect(after).toHaveBeenCalledTimes(1);
    const other = vi.fn();
    whenCueStarted('cue-b', other);
    expect(other).not.toHaveBeenCalled();
  });
});
