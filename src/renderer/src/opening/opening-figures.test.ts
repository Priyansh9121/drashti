import { describe, expect, it } from 'vitest';
import { OPENING_MS } from '../../../shared/opening';
import { type OpeningFrame, openingFigures } from './opening-figures';

/*
 * The opening's own figures for the log (Session 58, C4: Q57-32), read from the frames the operator window drew from
 * when it might move, as the Performance check's probe reads them.
 */

/** Frames every `step` ms from `from` to `to` (ms on the page's clock), with the opening `started` at that time. */
function frames(from: number, to: number, step: number, started: number): OpeningFrame[] {
  const out: OpeningFrame[] = [];
  for (let at = from; at <= to; at += step)
    out.push({ at, progress: at < started ? null : Math.min(OPENING_MS, at - started) });
  return out;
}

const AT = { askedAt: 100, releasedAt: 1300, releasedBy: 'ready' as const, end: OPENING_MS };

describe('the opening’s figures', () => {
  it('on time: it held, moved at the next frame, ran its two seconds, every frame even', () => {
    expect(openingFigures(frames(1300, 3400, 16, 1300), AT)).toEqual({
      heldMs: 1200,
      releasedBy: 'ready',
      movedAfterMs: 16,
      firstAtMs: 16,
      ranMs: 2000,
      longestFrameMs: 16,
    });
  });

  it('late: its first frame came long after it might move, its start unseen', () => {
    const late = [{ at: 1300, progress: null }, { at: 1316, progress: 0 }, ...frames(1616, 3400, 16, 1316)];
    expect(openingFigures(late, { ...AT, releasedBy: 'limit' })).toEqual({
      heldMs: 1200,
      releasedBy: 'limit',
      movedAfterMs: 316,
      firstAtMs: 300,
      ranMs: 1728,
      longestFrameMs: 16,
    });
  });

  it('a long frame while it ran is its longest frame', () => {
    const run = frames(1300, 3400, 16, 1300).filter((f) => f.at < 2000 || f.at > 2500);
    expect(openingFigures(run, AT).longestFrameMs).toBe(528);
  });

  it('ended by a key before it moved: only how long it held', () => {
    expect(openingFigures([{ at: 1300, progress: null }], AT)).toEqual({
      heldMs: 1200,
      releasedBy: 'ready',
      movedAfterMs: null,
      firstAtMs: null,
      ranMs: null,
      longestFrameMs: null,
    });
  });

  it('ended by a key while it ran: its first move and longest frame so far, never a length', () => {
    expect(openingFigures(frames(1300, 1800, 25, 1300), AT)).toMatchObject({
      movedAfterMs: 25,
      ranMs: null,
      longestFrameMs: 25,
    });
  });
});
