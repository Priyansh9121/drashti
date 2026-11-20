import type { EngineState } from '../../shared/engine/state';
import { type Playing, playingNow } from '../../shared/engine/playing';
import { playbackAtMs, playbackSpanMs } from '../../shared/media';
import { RESUME_END_MS, RESUME_FROM_MS } from '../../shared/play-history';

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

/** One showing of a file: what plays, from when. */
const showingOf = (p: Playing): string => `${p.ref.layer}:${p.mediaId}@${String(p.clock.startedAt)}`;

export class PlayHistory {
  /** What plays now, by showing, as last seen (its latest moves and pauses). */
  private showing = new Map<string, Playing>();
  private writes = 0;

  /** `now`: the engine's state as Main starts (a show brought back after a crash is not counted again). */
  constructor(
    private readonly deps: PlayHistoryDeps,
    now: EngineState | null = null,
  ) {
    for (const p of playingNow(now)) this.showing.set(showingOf(p), p);
  }

  /** The engine's state changed: what went up is counted; what came off keeps where it was, when it is long. */
  changed(state: EngineState): void {
    const now = this.deps.now();
    const next = new Map(playingNow(state).map((p) => [showingOf(p), p] as const));
    for (const [key, p] of next) if (!this.showing.has(key)) this.counted(p, now);
    for (const [key, p] of this.showing) if (!next.has(key)) this.left(p, now);
    this.showing = next;
  }

  /** Drashti quitting: what plays now keeps where it is, as if taken off. */
  quitting(): void {
    const now = this.deps.now();
    for (const p of this.showing.values()) this.left(p, now);
    this.showing.clear();
  }

  private counted(p: Playing, now: number): void {
    const at = new Date(now).toISOString();
    const id = p.mediaId;
    // Each its own key: two plays in one moment are both counted.
    this.deps.later(`played:${id}:${String(this.writes++)}`, () => {
      this.deps.media.countPlay(id, at);
    });
  }

  /**
   * The background video or the sound taken off: where it was, kept when it is 10 minutes or longer and was not near
   * its end point; forgotten when it was. A file that goes round, or whose length is not known, keeps nothing.
   */
  private left(p: Playing, now: number): void {
    if (p.ref.layer !== 'background' && p.ref.layer !== 'audio') return;
    const length = p.durationMs;
    if (length === undefined || length < RESUME_FROM_MS || p.clock.loop) return;
    const atMs = playbackAtMs(p.clock, length, now);
    const { end } = playbackSpanMs(p.clock.clip, length);
    const id = p.mediaId;
    if (atMs >= end - RESUME_END_MS)
      this.deps.later(`resume:${id}`, () => {
        this.deps.media.forgetResume(id);
      });
    else {
      const at = new Date(now).toISOString();
      this.deps.later(`resume:${id}`, () => {
        this.deps.media.keepResume(id, atMs, at);
      });
    }
  }
}
