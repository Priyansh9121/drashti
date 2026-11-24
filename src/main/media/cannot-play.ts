import type { EngineState } from '../../shared/engine/state';
import type { NodeCannotPlayReport } from '../../shared/nodes';
import {
  cannotPlayNotice,
  cannotPlayOnNodeNotice,
  cannotPlayWaitingNotice,
  cannotStartInTimeNotice,
  FIRST_FRAME_MS,
  NO_FIRST_FRAME,
  NO_PICTURE,
  NO_START_IN_TIME,
  SLOW_START_MS,
} from '../../shared/no-picture';
import {
  NOT_ON_SCREENS_MAX,
  type NotOnScreen,
  notOnScreenLine,
  notOnScreensNow,
} from '../../shared/not-on-screens';
import { cutText } from '../../shared/text';
import type { CannotPlayTook } from '../engine/one-at-a-time';

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
    // Q60-51: it still loaded or decoded, but slowly.
    [NO_START_IN_TIME]: `no picture within ${String(SLOW_START_MS / 1000)} s while it still loaded`,
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

/**
 * Where a page that draws the show found a video could not play: one of this computer's screens (its name, and its id
 * where Main has it), LIVE, the stream.
 */
export type CannotPlayWhere = { screen: string; id?: string } | 'live' | 'stream';

/**
 * Where a showing could not play, in words, from every page that said so: the screens by name first (the hall is what
 * the audience sees), else LIVE, else the stream.
 */
export function whereWords(wheres: readonly CannotPlayWhere[]): string {
  const screens = [...new Set(wheres.flatMap((w) => (typeof w === 'object' ? [`“${w.screen}”`] : [])))];
  if (screens.length === 1) return `the screen ${screens[0] ?? ''}`;
  if (screens.length > 1) return `the screens ${screens.slice(0, -1).join(', ')} and ${screens.at(-1) ?? ''}`;
  return wheres.includes('live') ? 'LIVE' : 'the stream';
}

export class CannotPlay {
  private gpuGoneAt: number | null = null;
  /** Showings heard of and waiting: where each was said, so far. */
  private readonly waiting = new Map<string, CannotPlayWhere[]>();

  constructor(private readonly deps: CannotPlayDeps) {}

  /** A GPU process stopped (app's child-process-gone). */
  gpuGone(): void {
    this.gpuGoneAt = this.deps.now();
  }

  /**
   * A page said a showing (`showing`: its file and when it went up) could not play: after the short wait, `takeOff`
   * runs once, with every page that said so meanwhile, in words (whereWords) and as they said it (the screens to name
   * under LIVE: heardOutcome); or `leftToGpu`, when a GPU process stopped
   * about then (from GPU_GONE_GRACE_MS before the first word to the end of the wait). A later word on a showing waiting
   * is only gathered.
   */
  heard(
    showing: string,
    where: CannotPlayWhere,
    takeOff: (where: string, wheres: readonly CannotPlayWhere[]) => void,
    leftToGpu: (where: string) => void,
  ): void {
    const gathered = this.waiting.get(showing);
    if (gathered) {
      gathered.push(where);
      return;
    }
    const wheres = [where];
    this.waiting.set(showing, wheres);
    const at = this.deps.now();
    this.deps.later(CANNOT_PLAY_SETTLE_MS, () => {
      this.waiting.delete(showing);
      const named = whereWords(wheres);
      const gone = this.gpuGoneAt;
      if (gone !== null && gone >= at - GPU_GONE_GRACE_MS && gone <= at + CANNOT_PLAY_SETTLE_MS)
        leftToGpu(named);
      else takeOff(named, wheres);
    });
  }
}

/** A showing that pages said could not play, once the wait is over and Main's take-off (engine.cannotPlay) has run. */
export interface Heard {
  /** Its file's name, as Media names it. */
  name: string;
  mediaId: string;
  /** Every page that said so during the wait. */
  wheres: readonly CannotPlayWhere[];
  /** The page's code: MediaError's 1 to 4 (0: none), NO_FIRST_FRAME or NO_START_IN_TIME. */
  code: number;
  /** Chromium's words, or what the start watch saw, for the log only ('' for none). */
  words: string;
  /** What the take-off took, or null when it took nothing. */
  took: CannotPlayTook | null;
  /** Whether that showing is still up after it (shared/not-on-screens.ts stillUp). */
  stillUp: boolean;
  /** The screens (their ids, else their names) already told of on this showing (HallWords). */
  told?: readonly string[];
}

/** What Main does with it: the log's line, what the operator window says, and the screens LIVE names under it. */
export interface HeardOutcome {
  log: { level: 'warn' | 'info'; line: string } | null;
  notice: string | null;
  /**
   * Whether LIVE names the screens that said so under its picture while that showing stays up (HallWords), and how: as
   * ones that could not play it, or as ones still loading it; null for none.
   */
  live: 'cannot' | 'slow' | null;
}

/**
 * What Main does with a showing pages said could not play (alpha.23, a22-halldrop: until then a video up but not playing
 * was dropped without a word). Taken off (the background, the box; on the slide, paused there): the notice and the log
 * as x46 had them (Q60-31; Q60-51: one that could not start in time is never said to be damaged), and LIVE names the
 * screens under its picture while a slide's video stays up there paused. Nothing taken off as it was up but not playing
 * (paused, waiting for its click, or at its end, on the slide or in the box): the operator is told by its name, the
 * screens, and what to try (played, its sound would be heard without its picture there), the log says so, and LIVE names
 * the screens; when only LIVE or the stream said so (the screens show it), only the log. Gone by the end of the wait:
 * only the log. What the screens show is never changed here.
 */
export function heardOutcome(h: Heard): HeardOutcome {
  const named = whereWords(h.wheres);
  const screens = h.wheres.filter((w) => typeof w === 'object');
  const onScreens = screens.length > 0 ? whereWords(screens) : null;
  const detail = h.words === '' ? '' : `: ${cutText(h.words, 300, '…')}`;
  const said = `A video could not play on ${named} (${errorKindWords(h.code)}${detail}): ${h.mediaId}`;
  const took = h.took;
  if (took) {
    const off = [
      took.background ? 'the background' : '',
      took.slide ? 'paused on the slide' : '',
      took.box ? 'the box' : '',
    ]
      .filter((w) => w !== '')
      .join(', ');
    return {
      log: { level: 'warn', line: `${said}; taken off (${off})` },
      notice:
        h.code === NO_START_IN_TIME
          ? cannotStartInTimeNotice(h.name, named, took)
          : cannotPlayNotice(h.name, named, took),
      live: took.slide && h.stillUp && onScreens !== null ? 'cannot' : null,
    };
  }
  if (!h.stillUp) return { log: { level: 'info', line: `${said}; no longer up` }, notice: null, live: null };
  return {
    log: {
      level: 'warn',
      line: `${said}; left up, not playing (paused, waiting for its click or at its end), so nothing came off`,
    },
    notice: onScreens === null ? null : cannotPlayWaitingNotice(h.name, onScreens),
    live: onScreens === null ? null : 'cannot',
  };
}

/**
 * The showings still up that a screen could not play (shared/not-on-screens.ts), as LIVE names them (as the branch's
 * first fix had it: the latest word's screens only).
 */
export class HallWords {
  private entries = new Map<string, { mediaId: string; startedAt: number; name: string; where: string }>();

  heard(h: Heard, startedAt: number): { outcome: HeardOutcome; changed: boolean } {
    const outcome = heardOutcome(h);
    const screens = h.wheres.filter((w) => typeof w === 'object');
    if (outcome.live === null || screens.length === 0) return { outcome, changed: false };
    const key = `${h.mediaId}@${String(startedAt)}`;
    this.entries.delete(key);
    this.entries.set(key, { mediaId: h.mediaId, startedAt, name: h.name, where: whereWords(screens) });
    while (this.entries.size > NOT_ON_SCREENS_MAX) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
    return { outcome, changed: true };
  }

  playsHere(_mediaId: string, _startedAt: number, _screenId: string): boolean {
    return false;
  }

  gpuGone(): boolean {
    return false;
  }

  screenGone(_screenId: string): boolean {
    return false;
  }

  prune(state: EngineState): boolean {
    const now = new Set(
      notOnScreensNow(this.list(), state).map((e) => `${e.mediaId}@${String(e.startedAt)}`),
    );
    let changed = false;
    for (const key of [...this.entries.keys()])
      if (!now.has(key)) {
        this.entries.delete(key);
        changed = true;
      }
    return changed;
  }

  list(_nameOf?: (screenId: string) => string | undefined): NotOnScreen[] {
    return [...this.entries.values()].map((e) => ({
      mediaId: e.mediaId,
      startedAt: e.startedAt,
      lines: [notOnScreenLine(e.name, e.where)],
    }));
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
