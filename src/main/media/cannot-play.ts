import type { EngineState } from '../../shared/engine/state';
import type { NodeCannotPlayReport } from '../../shared/nodes';
import {
  cannotPlayNotice,
  cannotPlayOnNodeNotice,
  cannotPlayWaitingNotice,
  cannotStartInTimeNotice,
  cannotStartInTimeWaitingNotice,
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
  notOnScreenYetLine,
  playingCannotNow,
  startingLine,
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

/** A screen's own key: its id where Main has it, else its name. */
const screenKey = (w: { screen: string; id?: string }): string => w.id ?? w.screen;

/** The screens among the pages that said so. */
const screensOf = (wheres: readonly CannotPlayWhere[]) =>
  wheres.filter((w): w is { screen: string; id?: string } => typeof w === 'object');

/**
 * What Main does with a showing pages said could not play (alpha.23, a22-halldrop: until then a video up but not playing
 * was dropped without a word). Taken off (the background, the box; on the slide, paused there): the notice and the log
 * as x46 had them (Q60-31; Q60-51: one that could not start in time is never said to be damaged), and LIVE names the
 * screens under its picture while a slide's video stays up there paused. Nothing taken off as it was up but not playing
 * (paused, waiting for its click, or at its end, on the slide or in the box): the operator is told by its name, the
 * screens not told of yet on this showing (`told`: a later word, a second screen's, says only what is new), and what to
 * try; one only slow to start (NO_START_IN_TIME, Q60-51, the owner's "Yes, A") is said not to have started in time and
 * to be still loading there, never damaged; the log says so, and LIVE names the screens, as still loading or as unable
 * to play it. When only LIVE or the stream said so (the screens show it), only the log; gone by the end of the wait,
 * only the log. What the screens show is never changed here.
 */
/** What a take-off took, in the log's words. */
export const offWords = (took: CannotPlayTook): string =>
  [
    took.background ? 'the background' : '',
    took.slide ? 'paused on the slide' : '',
    took.box ? 'the box' : '',
  ]
    .filter((w) => w !== '')
    .join(', ');

/** The log's line for a showing pages said could not play, up to what came of it. */
const saidLine = (h: Pick<Heard, 'wheres' | 'code' | 'words' | 'mediaId'>): string =>
  `A video could not play on ${whereWords(h.wheres)} (${errorKindWords(h.code)}${
    h.words === '' ? '' : `: ${cutText(h.words, 300, '…')}`
  }): ${h.mediaId}`;

export function heardOutcome(h: Heard): HeardOutcome {
  const named = whereWords(h.wheres);
  const screens = screensOf(h.wheres);
  const told = new Set(h.told ?? []);
  const fresh = screens.filter((w) => !told.has(screenKey(w)));
  const slow = h.code === NO_START_IN_TIME;
  const kind = slow ? 'slow' : 'cannot';
  const said = saidLine(h);
  const took = h.took;
  if (took) {
    return {
      log: { level: 'warn', line: `${said}; taken off (${offWords(took)})` },
      // Taken off is a change of the show: said, as before, even to a screen told of already.
      notice: slow ? cannotStartInTimeNotice(h.name, named, took) : cannotPlayNotice(h.name, named, took),
      live: took.slide && h.stillUp && screens.length > 0 ? kind : null,
    };
  }
  if (!h.stillUp)
    return {
      log: { level: 'info', line: `${said}; not up as the show’s background, slide or box video now` },
      notice: null,
      live: null,
    };
  const again = screens.length > 0 && fresh.length === 0 ? '; told already' : '';
  return {
    log: {
      level: 'warn',
      line: `${said}; left up, not playing (paused, waiting for its click or at its end), so nothing came off${again}`,
    },
    notice:
      fresh.length === 0
        ? null
        : slow
          ? cannotStartInTimeWaitingNotice(h.name, whereWords(fresh))
          : cannotPlayWaitingNotice(h.name, whereWords(fresh)),
    live: screens.length > 0 ? kind : null,
  };
}

/**
 * How a screen that does not show a showing is named under LIVE: still waiting for its first frame (the owner's
 * QA23-HALLDROP-1 (a)), still loading it past the slow bound (Q60-51), or unable to play it.
 */
type NotOnKind = 'starting' | 'slow' | 'cannot';

/** A showing kept: its file and name, the screens told of, and the screens that do not show it (and how). */
interface Kept {
  mediaId: string;
  startedAt: number;
  name: string;
  told: Set<string>;
  notOn: Map<string, { name: string; kind: NotOnKind }>;
}

/** Showings whose drawing after all Main keeps a mark of, at most (the newest). */
const DREW_MAX = NOT_ON_SCREENS_MAX * 5;

/**
 * For each showing up that one of this computer's screens could not play (alpha.23, a22-halldrop; the review's MUST-2
 * to MUST-5): which screens the operator was told of (each once a showing: a later word, more than CannotPlay's wait
 * after, is logged only), and which do not show it, as LIVE names them under its picture: merged as more screens say
 * so; a screen that draws it after all (media:plays-here: marked, so a drawing said during the wait counts too, until
 * that screen's next word), whose page loads again, or that goes, is no longer named; a showing not up any more is
 * forgotten. A GPU process that stops changes nothing here: a video loaded again after it says media:plays-here once it
 * draws, and one that fails again within the GPU's grace is never heard, so its line stays. The newest
 * NOT_ON_SCREENS_MAX showings are kept.
 */
export class HallWords {
  private readonly kept = new Map<string, Kept>();
  /** For each showing, the screens that drew it after all since their last word (MUST-4). */
  private readonly drew = new Map<string, { mediaId: string; startedAt: number; screens: Set<string> }>();

  /**
   * A showing pages said could not play, after the wait and Main's take-off: what to log and tell (heardOutcome, with
   * the screens told of already), and whether LIVE's lines changed.
   */
  heard(h: Heard, startedAt: number): { outcome: HeardOutcome; changed: boolean } {
    const key = `${h.mediaId}@${String(startedAt)}`;
    const was = this.kept.get(key);
    // Screens that drew it after all during the wait (their media:plays-here came before it ended): neither told nor
    // named; a take-off, a change of the show, is told as ever.
    const marks = this.drew.get(key)?.screens;
    const drewThere = new Set(
      screensOf(h.wheres)
        .filter((w) => marks?.has(screenKey(w)) === true)
        .map(screenKey),
    );
    const wheres =
      drewThere.size === 0 || h.took
        ? h.wheres
        : h.wheres.filter((w) => typeof w !== 'object' || !drewThere.has(screenKey(w)));
    if (wheres.length === 0 || (screensOf(wheres).length === 0 && drewThere.size > 0 && !h.took))
      return {
        outcome: {
          log: { level: 'info', line: `${saidLine(h)}; drew there after all, so nothing to tell` },
          notice: null,
          live: null,
        },
        changed: false,
      };
    const outcome = heardOutcome({ ...h, wheres, told: was ? [...was.told] : [] });
    const screens = screensOf(wheres).filter((w) => !drewThere.has(screenKey(w)));
    if (!h.stillUp || screens.length === 0) return { outcome, changed: false };
    const k: Kept = was ?? {
      mediaId: h.mediaId,
      startedAt,
      name: h.name,
      told: new Set<string>(),
      notOn: new Map<string, { name: string; kind: NotOnKind }>(),
    };
    if (outcome.notice !== null) for (const w of screens) k.told.add(screenKey(w));
    let changed = false;
    if (outcome.live !== null)
      for (const w of screens) {
        const before = k.notOn.get(screenKey(w));
        // A screen that could not play it stays so; one starting or still loading it becomes what the word says.
        const kind = before?.kind === 'cannot' ? 'cannot' : outcome.live;
        if (before?.kind === kind && before.name === w.screen) continue;
        k.notOn.set(screenKey(w), { name: w.screen, kind });
        changed = true;
      }
    if (!was) {
      this.kept.set(key, k);
      while (this.kept.size > NOT_ON_SCREENS_MAX) {
        const oldest = this.kept.keys().next().value;
        if (oldest === undefined) break;
        if ((this.kept.get(oldest)?.notOn.size ?? 0) > 0) changed = true;
        this.kept.delete(oldest);
      }
    }
    return { outcome, changed };
  }

  /** A screen said (again) that a showing could not play (a new media:cannot-play word): its drawing's mark goes. */
  saidAgain(mediaId: string, startedAt: number, screenId: string): void {
    this.drew.get(`${mediaId}@${String(startedAt)}`)?.screens.delete(screenId);
  }

  /**
   * That screen drew the showing after all: marked (a word still in CannotPlay's wait then neither tells nor names it),
   * and no longer named. Whether LIVE's lines changed.
   */
  playsHere(mediaId: string, startedAt: number, screenId: string): boolean {
    const key = `${mediaId}@${String(startedAt)}`;
    let marks = this.drew.get(key);
    if (!marks) {
      marks = { mediaId, startedAt, screens: new Set() };
      this.drew.set(key, marks);
      while (this.drew.size > DREW_MAX) {
        const oldest = this.drew.keys().next().value;
        if (oldest === undefined) break;
        this.drew.delete(oldest);
      }
    }
    marks.screens.add(screenId);
    return this.kept.get(key)?.notOn.delete(screenId) ?? false;
  }

  /** That screen's page loads again, or it went: no longer named on any showing. */
  screenGone(screenId: string): boolean {
    let changed = false;
    for (const k of this.kept.values()) if (k.notOn.delete(screenId)) changed = true;
    return changed;
  }

  /** Whether LIVE names any screen now. */
  naming(): boolean {
    for (const k of this.kept.values()) if (k.notOn.size > 0) return true;
    return false;
  }

  /** Forget the showings not up in `state` any more: whether LIVE's lines changed. */
  prune(state: EngineState): boolean {
    if (this.kept.size === 0 && this.drew.size === 0) return false;
    const showings = [...this.kept.values(), ...this.drew.values()].map((k) => ({
      mediaId: k.mediaId,
      startedAt: k.startedAt,
      lines: [],
    }));
    const up = new Set(notOnScreensNow(showings, state).map((e) => `${e.mediaId}@${String(e.startedAt)}`));
    for (const key of [...this.drew.keys()]) if (!up.has(key)) this.drew.delete(key);
    let changed = false;
    for (const [key, k] of [...this.kept])
      if (!up.has(key)) {
        if (k.notOn.size > 0) changed = true;
        this.kept.delete(key);
      }
    return changed;
  }

  /**
   * LIVE's lines for each showing kept with screens that do not show it, the screens by their names now (`nameOf`;
   * undefined: gone, not named), those that could not play it apart from those still loading it.
   */
  list(nameOf: (screenId: string) => string | undefined): NotOnScreen[] {
    const out: NotOnScreen[] = [];
    for (const k of this.kept.values()) {
      const named = this.namedNow(k, nameOf);
      const lines = [
        ...(named.cannot.length > 0 ? [notOnScreenLine(k.name, whereWords(named.cannot))] : []),
        ...(named.slow.length > 0 ? [notOnScreenYetLine(k.name, whereWords(named.slow))] : []),
      ];
      const starting = named.starting.length > 0 ? startingLine(whereWords(named.starting)) : undefined;
      if (lines.length > 0 || starting !== undefined)
        out.push({ mediaId: k.mediaId, startedAt: k.startedAt, lines, ...(starting ? { starting } : {}) });
    }
    return out;
  }

  /** A showing's screens that do not show it, by their names now and how each is named. */
  private namedNow(
    k: Kept,
    nameOf: (screenId: string) => string | undefined,
  ): Record<NotOnKind, CannotPlayWhere[]> {
    const named: Record<NotOnKind, CannotPlayWhere[]> = { starting: [], slow: [], cannot: [] };
    for (const [id, s] of k.notOn) {
      const name = nameOf(id) ?? (id === s.name ? s.name : undefined);
      if (name !== undefined) named[s.kind].push({ screen: name });
    }
    return named;
  }

  /**
   * A screen has no first frame of a showing up 2 s after it went up (the owner's QA23-HALLDROP-1 (a)): LIVE says it is
   * starting there until it draws (playsHere) or the verdict comes (heard); never for a screen named so already. Whether
   * LIVE's lines changed.
   */
  starting(
    mediaId: string,
    startedAt: number,
    screenId: string,
    screenName: string,
    fileName: string,
  ): boolean {
    const key = `${mediaId}@${String(startedAt)}`;
    const was = this.kept.get(key);
    if (was?.notOn.has(screenId)) return false;
    const k: Kept = was ?? {
      mediaId,
      startedAt,
      name: fileName,
      told: new Set<string>(),
      notOn: new Map<string, { name: string; kind: NotOnKind }>(),
    };
    k.notOn.set(screenId, { name: screenName, kind: 'starting' });
    if (!was) {
      this.kept.set(key, k);
      while (this.kept.size > NOT_ON_SCREENS_MAX) {
        const oldest = this.kept.keys().next().value;
        if (oldest === undefined) break;
        this.kept.delete(oldest);
      }
    }
    return true;
  }

  /**
   * The showings kept that a screen could not play and that play now in `state` (the owner's QA23-HALLDROP-1 (b): Play
   * on them is followed by the take-off), with the screens in words by their names now. One only slow ("yet") or still
   * starting there, or drawn after all, is not among them.
   */
  playingCannot(
    state: EngineState,
    nameOf: (screenId: string) => string | undefined,
  ): { mediaId: string; startedAt: number; name: string; where: string }[] {
    const cannot = [...this.kept.values()].flatMap((k) => {
      const named = this.namedNow(k, nameOf).cannot;
      return named.length > 0 ? [{ k, where: whereWords(named) }] : [];
    });
    if (cannot.length === 0) return [];
    const playing = playingCannotNow(state);
    return cannot
      .filter(({ k }) => playing.has(`${k.mediaId}@${String(k.startedAt)}`))
      .map(({ k, where }) => ({ mediaId: k.mediaId, startedAt: k.startedAt, name: k.name, where }));
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
