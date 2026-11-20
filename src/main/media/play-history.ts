import type { EngineState } from '../../shared/engine/state';

/*
 * Resume where it stopped, last played and play counts (alpha.20: the owner's Q60-34 item 3 and "last played", his
 * "Yes, all A" to Q60-39: P1 A and P6 (e) A), in the main process. It follows the engine's state: a file going up (a
 * showing of its own: its start) is counted once, with the day; the background video or the sound, 10 minutes or longer,
 * taken off before its last 30 seconds (cleared, replaced, or Drashti quitting) keeps where it was and when; taken off in
 * its last 30 seconds it was played to its end, and nothing is kept. Nothing here moves or stops anything: the window
 * offers "Resume at …" (markers/ResumeOffers.tsx), and its press is the engine's own move. Every write waits while the
 * library is busy (db/later-writes.ts), never the show. The practice show, Next's picture and a preview are never the
 * engine's, so never counted.
 */

export interface PlayHistoryDeps {
  /** A write when the library is free (db/later-writes.ts): a newer one for the same key replaces one waiting. */
  later(key: string, run: () => void): void;
  media: {
    countPlay(mediaId: string, at: string): void;
    keepResume(mediaId: string, atMs: number, at: string): void;
    forgetResume(mediaId: string): void;
  };
  /** The engine's clock (ms since the epoch). */
  now(): number;
}

/** Red (x47, slice 3): still to be written. */
export class PlayHistory {
  constructor(
    readonly deps: PlayHistoryDeps,
    readonly now: EngineState | null = null,
  ) {}

  changed(_state: EngineState): void {
    // Red: nothing kept yet.
  }

  quitting(): void {
    // Red: nothing kept yet.
  }
}
