import type { SoundState } from '../../shared/stream';

/*
 * "No sound" (MED-1, Session 31). While on air or recording, the stream worker says how long what it
 * encodes has stayed below -50 dBFS (worker/sound-meter.ts); after 20 s of that, the operator is told,
 * beside ON AIR and REC and in a notice, in Pro and Simple Mode. A microphone that is unplugged (or that
 * the system blocks, or that would not start) is told sooner: once it has been gone for 3 s with nothing
 * heard since, so a moment's crackle of a loose cable never raises it at once. It goes as soon as a
 * second is loud again. It never switches an input by itself, and says nothing while neither on air nor
 * recording.
 */

/** Quiet this long, on air or recording, is No sound: ms. */
export const NO_SOUND_MS = 20_000;
/** The chosen microphone gone (unplugged) this long, with nothing heard since, is No sound: ms. */
export const MISSING_GRACE_MS = 3000;

export interface NoSound {
  /** When this began (ms since the epoch): a new reason is a new start. */
  since: number;
  /** Nothing loud enough for NO_SOUND_MS, or the chosen input is gone. */
  why: 'quiet' | 'input';
}

/** The chosen input is known to give nothing: unplugged, refused by the system, or would not start. */
const gone = (input: SoundState) => input === 'missing' || input === 'blocked' || input === 'failed';

export class NoSoundWatch {
  private goneSince: number | null = null;
  private current: NoSound | null = null;

  constructor(
    private readonly limitMs = NO_SOUND_MS,
    private readonly graceMs = MISSING_GRACE_MS,
  ) {}

  /** How long it counts as quiet before saying so (ms). */
  get limit(): number {
    return this.limitMs;
  }

  /**
   * The stream as it is now: `active` while on air or recording; `quietMs` from the worker; `input` the
   * chosen microphone's state. Says what to show, and whether that changed.
   */
  update(p: { active: boolean; quietMs: number; input: SoundState; now: number }): {
    now: NoSound | null;
    changed: boolean;
  } {
    if (!gone(p.input)) this.goneSince = null;
    else this.goneSince ??= p.now;
    let why: NoSound['why'] | null = null;
    if (p.active) {
      if (this.goneSince !== null && p.now - this.goneSince >= this.graceMs && p.quietMs >= this.graceMs)
        why = 'input';
      else if (p.quietMs >= this.limitMs) why = 'quiet';
    }
    const before = this.current;
    if (why === null) this.current = null;
    else if (before?.why !== why) this.current = { since: p.now, why };
    return { now: this.current, changed: before !== this.current };
  }
}
