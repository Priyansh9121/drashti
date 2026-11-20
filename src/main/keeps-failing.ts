import { playingNow } from '../shared/engine/playing';
import type { EngineState } from '../shared/engine/state';

/*
 * A page that keeps failing on a video up (x53; the owner's Q60-31 bug hunt, x52's show-stoppers; his Q60-50 A of 20 Nov
 * 2026): a hall screen whose picture fails each time it draws, or whose renderer goes down each time it loads a video;
 * the sound player going down each time it loads a video's sound; the operator window going down each time LIVE loads
 * one. Until then each was reloaded, then given up on (a screen black and counted as showing, every sound gone, the
 * controls gone), the video staying up and nobody told. Now, as a video that fails comes off (x46's take-off,
 * main/media/cannot-play.ts): a page that fails again within a minute with a video up that was up at its last failure
 * too takes that video off (the newest of them, the likeliest cause), with its sound and a notice naming it and where,
 * and loads again at once without it. With nothing to blame, the page is given up on as before (a screen Stopped and
 * said, the sound player's red notice) and tried again by itself in a few minutes. Its one place: change it here.
 */

/** A video up when a page failed: its file, and when it went up. */
export interface UpThen {
  mediaId: string;
  since: number;
}

/** Another failure this soon after a page's last one is its failing again (the watchdog's own minute). */
export const AGAIN_MS = 60_000;

/**
 * Every video up now, each file once with its latest start: the background's, the slide's and the box's, playing or
 * paused (a page loads each of them). A deck's own sound and the music are not videos: the take-off is a video's.
 */
export function videosUp(state: EngineState): UpThen[] {
  const up = new Map<string, number>();
  for (const p of playingNow(state)) {
    if (p.ref.layer === 'audio' || p.sound === true) continue;
    up.set(p.mediaId, Math.max(up.get(p.mediaId) ?? p.clock.startedAt, p.clock.startedAt));
  }
  return [...up].map(([mediaId, since]) => ({ mediaId, since }));
}

/** Each page's last failure, and the video to take off when it fails again on one. */
export class KeepsFailing {
  private readonly last = new Map<string, { at: number; up: readonly UpThen[] }>();

  constructor(private readonly againMs = AGAIN_MS) {}

  /**
   * The page `page` failed at `at` with `up` up: the video to take off, the newest that was up at its last failure too
   * when that was within AGAIN_MS; else null (its first failure in a while, or nothing up both times).
   */
  failed(page: string, at: number, up: readonly UpThen[]): string | null {
    const before = this.last.get(page);
    this.last.set(page, { at, up });
    if (!before || at - before.at > this.againMs) return null;
    let pick: UpThen | null = null;
    for (const u of up)
      if (before.up.some((b) => b.mediaId === u.mediaId) && (pick === null || u.since > pick.since)) pick = u;
    return pick?.mediaId ?? null;
  }

  /** A page closed for good: its failures forgotten. */
  forget(page: string): void {
    this.last.delete(page);
  }
}
