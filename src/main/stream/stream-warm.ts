import type { OutputWarmUpEnd } from '../../shared/screens';

/*
 * The stream's page's own GPU warm-up as it opens (Session 60, X21; C19's finding; the owner's answer A to Q60-1).
 * Opened mid-show (the Stream panel's preview, or going live or recording while a show plays), the stream's page warmed
 * its graphics chip up as every page does (render/WarmUp.tsx), and that drawing held the hall's frames: a trace on CI's
 * Mac showed the GPU process's main thread 94-98% busy for the 5.5-7.8 s of its warm-up, the hall's longest frame 1-3
 * s, while the new drawing pipelines it made were few and quick (5-25, 13-72 ms in all, even on a new CI Mac): the
 * hall's screens' own warm-ups had made them. So once a hall screen on this computer has drawn its warm-up whole at
 * this start (since the GPU process last started: what it made goes with it) and the opening is over (or does not
 * play), the stream's page draws the show at once, with no warm-up of its own: what it draws with is made. Before then
 * (no hall screen here, or none whose warm-up drew everything; the opening still playing; the GPU process started
 * again since) it warms itself up as before. Where Chromium draws without a graphics chip nothing warms up anywhere,
 * as before. A node never has the stream's page.
 */

/** Red (Session 60, X21 A): nothing is followed yet, so the stream's page always warms itself up, as before. */
export class StreamPageWarmUp {
  constructor(readonly log: (line: string) => void) {}

  /** A hall screen on this computer said how its warm-up ended (Session 58, WU-2). */
  hallEnded(_how: OutputWarmUpEnd['how']): void {
    // Red: not followed yet.
  }

  /** The GPU process stopped: the pipelines the warm-ups made went with it. */
  gpuGone(): void {
    // Red: not followed yet.
  }

  /** The opening plays at this start, from its plan until it ends. */
  openingPlays(): void {
    // Red: not followed yet.
  }

  /** The opening is over, or does not play at this start. */
  openingOver(): void {
    // Red: not followed yet.
  }

  /** Whether the stream's page `pageId` draws the show without a warm-up of its own; said in the log once a page. */
  skips(_pageId: number): boolean {
    return false;
  }
}
