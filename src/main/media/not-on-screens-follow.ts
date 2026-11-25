import type { EngineState } from '../../shared/engine/state';
import { cannotPlayNotice } from '../../shared/no-picture';
import type { CannotPlayTook } from '../engine/one-at-a-time';
import { type HallWords, offWords } from './cannot-play';

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
  /** A take-off at Play waiting for its moment (one at a time). */
  private atPlayWaiting = false;

  constructor(
    private readonly words: HallWords,
    private readonly send: () => void,
  ) {}

  /**
   * The take-off at Play (the owner's QA23-HALLDROP-1 (b), "Take it off at Play (Rec.)", as his Q60-31): a slide's or
   * the box's video that a screen said it could not play, once it plays (the time bar's Play, a phone, Companion, MIDI,
   * a deck's click: whatever played it), is taken off as one playing would be, a moment after the change: paused there
   * on the slide with its sound, the box off; the notice says so, by the screens.
   */
  connectPlay(deps: TakeOffAtPlay): void {
    this.atPlay = deps;
  }

  /**
   * A screen has no first frame of a showing up 2 s after it went up (the owner's QA23-HALLDROP-1 (a), "Words during the
   * wait (Rec.)", media:no-frame-yet): LIVE says "Starting on the screen “…”…" until it draws or the verdict comes. Whether
   * LIVE's lines changed (and the window was told).
   */
  starting(
    mediaId: string,
    startedAt: number,
    screenId: string,
    screenName: string,
    fileName: string,
  ): boolean {
    const changed = this.words.starting(mediaId, startedAt, screenId, screenName, fileName);
    if (changed) this.send();
    return changed;
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

  /** The show changed: a showing no longer up is forgotten; one the hall could not play, now playing, is taken off. */
  showChanged(state: EngineState): void {
    if (this.words.prune(state)) this.send();
    const atPlay = this.atPlay;
    if (!atPlay || this.atPlayWaiting) return;
    const nameOf = (screenId: string) => atPlay.nameOf(screenId);
    if (this.words.playingCannot(state, nameOf).length === 0) return;
    // Outside the engine's change: the take-off is a change of its own.
    this.atPlayWaiting = true;
    atPlay.later(() => {
      this.atPlayWaiting = false;
      for (const p of this.words.playingCannot(atPlay.state(), nameOf)) {
        const took = atPlay.takeOff(p.mediaId, p.startedAt);
        if (!took) continue;
        atPlay.log(
          `A video was played that ${p.where} could not play: ${p.mediaId}; taken off at Play (${offWords(took)})`,
        );
        atPlay.tell(cannotPlayNotice(p.name, p.where, took));
      }
    });
  }

  /** That screen drew the showing after all (media:plays-here): whether its line went. */
  drew(mediaId: string, startedAt: number, screenId: string): boolean {
    const changed = this.words.playsHere(mediaId, startedAt, screenId);
    if (changed) this.send();
    return changed;
  }
}
