import type { NodeCannotPlayReport } from '../../shared/nodes';
import { cannotPlayOnNodeNotice, FIRST_FRAME_MS, NO_FIRST_FRAME, NO_PICTURE } from '../../shared/no-picture';
import { cutText } from '../../shared/text';

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

/**
 * A media element's error code (MediaError's 1 to 4) in words for the log, a first frame that never came
 * (NO_FIRST_FRAME, Q60-44), or a picture a node cannot draw (NO_PICTURE); 0 and anything else: none given.
 */
export function errorKindWords(code: number): string {
  const kinds: Record<number, string> = {
    [NO_FIRST_FRAME]: `no picture within ${String(FIRST_FRAME_MS / 1000)} s`,
    [NO_PICTURE]: 'its picture cannot be drawn there (sound only)',
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

/** Showings told of, at most: the oldest are forgotten past it. */
const TOLD_MAX = 500;

/**
 * A paired computer's screen that could not play a video (Q60-44, the owner's answer A of 20 Nov 2026, through the
 * lead), its one place on Main: the node keeps what it showed, never black (its page's slots,
 * render/background-slots.ts), and says so (node-mode/node-app.ts, once its copy of the file is there); Main does not
 * take the video off, which plays on everywhere else, and tells the operator by the node's and the file's names, once
 * for each node and showing, and logs the error's kind and the screen.
 */
export class NodeCannotPlay {
  private readonly told = new Set<string>();

  /** What to tell and log, or null when this node's word on this showing was told already. */
  heard(
    node: { id: string; name: string },
    screen: string,
    file: { name: string },
    report: NodeCannotPlayReport,
  ): { notice: string; log: string } | null {
    const key = `${node.id}|${report.mediaId}@${String(report.startedAt)}`;
    if (this.told.has(key)) return null;
    this.told.add(key);
    if (this.told.size > TOLD_MAX) {
      const oldest = this.told.values().next().value;
      if (oldest !== undefined) this.told.delete(oldest);
    }
    const detail = report.words === '' ? '' : `: ${cutText(report.words, 300, '…')}`;
    return {
      notice: cannotPlayOnNodeNotice(file.name, node.name),
      log: `A video could not play on the paired computer “${node.name}”, its screen “${screen}” (${errorKindWords(report.code)}${detail}): ${report.mediaId}; it plays on everywhere else`,
    };
  }
}
