/*
 * A video that could not play on a page that draws the show (Q60-31, the owner's own bug, x46): its element failed
 * there, as that computer's decoder raises an error, or a cut or damaged file does, or its copy cannot be read. Until
 * then the hall went black at once while its sound played on, never taken off and nobody told. Now Main takes it off as
 * it takes off a video whose picture cannot be drawn (x36's ShowEngine.noPicture: the background with its sound; on the
 * slide or in the box, paused), says so by its name and where, and logs the error's kind and where.
 *
 * A GPU process that stops makes every video it decodes fail as well, and those load again by themselves, from the
 * engine's time, once another has started (render/media-attempts.ts): a failure heard about when a GPU process stopped
 * (shortly before it, or within the short wait after it) is left to that. The wait is short: the screens keep what
 * they drew meanwhile (render/background-slots.ts), never black.
 */

/** A media element's error code (MediaError's 1 to 4) in words for the log; 0 and anything else: none given. */
export function errorKindWords(code: number): string {
  const kinds: Record<number, string> = {
    1: 'stopped',
    2: 'a network or file error',
    3: 'a decoding error',
    4: 'not playable here',
  };
  return kinds[code] ?? 'an error with no code';
}

/** How long after a page's word Main waits before taking the video off (a GPU process's stop may be heard after it). */
export const CANNOT_PLAY_SETTLE_MS = 1000;
/** A failure heard this soon after a GPU process stopped is that stop's. */
export const GPU_GONE_GRACE_MS = 3000;

export interface CannotPlayDeps {
  now(): number;
  /** Run `run` after `ms` (setTimeout in Drashti; tests run it by hand). */
  later(ms: number, run: () => void): void;
}

export class CannotPlay {
  private gpuGoneAt: number | null = null;

  constructor(private readonly deps: CannotPlayDeps) {}

  /** A GPU process stopped (app's child-process-gone). */
  gpuGone(): void {
    this.gpuGoneAt = this.deps.now();
  }

  /**
   * A page said a showing could not play: after the short wait, `takeOff` runs; or `leftToGpu`, when a GPU process
   * stopped about then (from GPU_GONE_GRACE_MS before the word to the end of the wait).
   */
  heard(takeOff: () => void, leftToGpu: () => void): void {
    const at = this.deps.now();
    this.deps.later(CANNOT_PLAY_SETTLE_MS, () => {
      const gone = this.gpuGoneAt;
      if (gone !== null && gone >= at - GPU_GONE_GRACE_MS && gone <= at + CANNOT_PLAY_SETTLE_MS) leftToGpu();
      else takeOff();
    });
  }
}

/** What a paired computer says of a showing its screen could not play (Q60-44). */
export interface NodeCannotPlayReport {
  screenId: string;
  mediaId: string;
  startedAt: number;
  code: number;
  words: string;
}

/** A paired computer's screen that could not play a video (Q60-44): what to tell, once for each showing. */
export class NodeCannotPlay {
  heard(
    _node: { id: string; name: string },
    _screen: string,
    _file: { name: string },
    _report: NodeCannotPlayReport,
  ): { notice: string; log: string } | null {
    return null;
  }
}
