import { HEVC_TYPE } from '../../shared/convert';

/*
 * Whether this computer plays HEVC video (Session 51). Chromium decodes HEVC only where the computer can (most Macs
 * do; Windows needs Microsoft's HEVC extension), and only a window can ask it: the media list asks so to offer
 * Convert (renderer convert-store.ts playsHevc). The main process asks the operator window the same question once
 * it has opened, and each import is told: where it cannot play, HEVC is converted by itself, as any file Drashti
 * cannot play; where it can, it plays as it is. An import starting before the window has said waits for the answer
 * (Session 51 review: a smart playlist's or the drop folder's first look, a few seconds after the start, took HEVC
 * as it was), at most HEVC_WAIT_MS.
 */

/** The longest an import waits for the window's answer before it goes on without it. */
export const HEVC_WAIT_MS = 15_000;

/** The question, as the media list asks it: Chromium's answer is "probably", "maybe" or nothing. */
export const PLAYS_HEVC_SCRIPT = `document.createElement('video').canPlayType(${JSON.stringify(HEVC_TYPE)})`;

/** Ask a window (`run` runs a script in it): whether it plays HEVC, or null when it cannot be told. */
export async function askPlaysHevc(run: (script: string) => Promise<unknown>): Promise<boolean | null> {
  try {
    const answer = await run(PLAYS_HEVC_SCRIPT);
    return typeof answer === 'string' ? answer !== '' : null;
  } catch {
    return null;
  }
}

/** The window's answer, as the imports wait for it: known from the start when a test gives it. */
export class HevcAnswer {
  private answer: boolean | null;
  /** Answered, or the window could not say: no import waits any more. */
  private told: boolean;
  private readonly waiting = new Set<(answer: boolean | null) => void>();

  constructor(
    given: boolean | null,
    private readonly waitMs = HEVC_WAIT_MS,
  ) {
    this.answer = given;
    this.told = given !== null;
  }

  /** The answer now: null while it is not known. */
  get now(): boolean | null {
    return this.answer;
  }

  /** The window's answer (null: it could not say this time); the imports waiting go on with it. */
  tell(answer: boolean | null): void {
    if (answer !== null) this.answer = answer;
    this.told = true;
    for (const go of [...this.waiting]) go(this.answer);
  }

  /** For an import about to start: the answer at once once told, else when told, or null after the wait. */
  wait(): Promise<boolean | null> {
    if (this.told) return Promise.resolve(this.answer);
    return new Promise((resolve) => {
      const go = (answer: boolean | null) => {
        clearTimeout(timer);
        this.waiting.delete(go);
        resolve(answer);
      };
      const timer = setTimeout(() => {
        go(this.answer);
      }, this.waitMs);
      this.waiting.add(go);
    });
  }
}
