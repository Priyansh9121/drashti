import type { EngineState } from '../../shared/engine/state';
import type { CannotPlayTook } from '../engine/one-at-a-time';
import type { HallWords } from './cannot-play';

/** What the take-off at Play needs from Main (the owner's QA23-HALLDROP-1 (b)). */
export interface TakeOffAtPlay {
  /** Run `run` a moment later, outside the engine's change (setImmediate in Drashti; tests run it by hand). */
  later(run: () => void): void;
  /** The show now. */
  state(): EngineState;
  /** Main's take-off (engine.cannotPlay): what it took, or null. */
  takeOff(mediaId: string, startedAt: number): CannotPlayTook | null;
  /** The operator window's notice. */
  tell(text: string): void;
  /** Main's log. */
  log(line: string): void;
  /** A screen's name now (undefined: gone). */
  nameOf(screenId: string): string | undefined;
}

/*
 * What Main does with LIVE's "Not on the screen" lines (media/cannot-play.ts HallWords) as things happen around them
 * (alpha.23, a22-halldrop; the re-review's MUST-5 asked for it in one tested place): a GPU process stopping, a screen's
 * page loading again or its window closing, the screens changing (a name, one gone), the show changing (a showing gone),
 * and a screen drawing a showing after all (media:plays-here). Each tells the operator window the lines again
 * (`send`) only when they changed. What the screens show is never changed here.
 */
export class LiveLinesFollow {
  private atPlay: TakeOffAtPlay | null = null;

  constructor(
    private readonly words: HallWords,
    private readonly send: () => void,
  ) {}

  /** The take-off at Play (not yet: Play plays as asked). */
  connectPlay(deps: TakeOffAtPlay): void {
    this.atPlay = deps;
  }

  /** A screen has no first frame of a showing 2 s after it went up (not yet: nothing said). */
  starting(
    _mediaId: string,
    _startedAt: number,
    _screenId: string,
    _screenName: string,
    _fileName: string,
  ): boolean {
    return this.atPlay !== null && false;
  }

  /**
   * A GPU process stopped (the re-review's MUST-5): no line changes. A video loaded again after it says media:plays-here
   * once it draws (drew), and a damaged one that fails again within the GPU's grace is never heard, so its line stays.
   */
  gpuStopped(): void {
    // Nothing to forget: what draws again says so.
  }

  /** That screen's page starts loading again: it draws its videos afresh, so it is no longer named. */
  pageLoading(screenId: string): void {
    if (this.words.screenGone(screenId)) this.send();
  }

  /** That screen's window closed (taken off its display, or the screen removed): no longer named. */
  windowClosed(screenId: string): void {
    if (this.words.screenGone(screenId)) this.send();
  }

  /** The screens changed (a name, one gone): the lines name them as they are now, when any are named. */
  screensChanged(): void {
    if (this.words.naming()) this.send();
  }

  /** The show changed: a showing no longer up is forgotten. */
  showChanged(state: EngineState): void {
    if (this.words.prune(state)) this.send();
  }

  /** That screen drew the showing after all (media:plays-here): whether its line went. */
  drew(mediaId: string, startedAt: number, screenId: string): boolean {
    const changed = this.words.playsHere(mediaId, startedAt, screenId);
    if (changed) this.send();
    return changed;
  }
}
