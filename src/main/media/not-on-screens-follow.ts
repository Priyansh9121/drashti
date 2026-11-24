import type { EngineState } from '../../shared/engine/state';
import type { HallWords } from './cannot-play';

/*
 * What Main does with LIVE's "Not on the screen" lines (media/cannot-play.ts HallWords) as things happen around them
 * (alpha.23, a22-halldrop; the re-review's MUST-5 asked for it in one tested place): a GPU process stopping, a screen's
 * page loading again or its window closing, the screens changing (a name, one gone), the show changing (a showing gone),
 * and a screen drawing a showing after all (media:plays-here). Each tells the operator window the lines again
 * (`send`) only when they changed. What the screens show is never changed here.
 */
export class LiveLinesFollow {
  constructor(
    private readonly words: HallWords,
    private readonly send: () => void,
  ) {}

  /** A GPU process stopped (as the first review fix had it: every line cleared). */
  gpuStopped(): void {
    if (this.words.gpuGone()) this.send();
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
