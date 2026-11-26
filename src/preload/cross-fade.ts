/*
 * One appearance fading into the next (Session 40, Lively): the stand-in before its rule (red first), as the preload
 * decided it before.
 */
export interface CrossFadeFacts {
  /** The new appearance looks otherwise (another one, or another base). */
  looksOtherwise: boolean;
  motion: string;
  /** Whether Chromium draws with a graphics chip (unknown until it has said). */
  chip: string;
  /** The show has not changed for 0.8 s. */
  quiet: boolean;
  reduced: boolean;
  /** The page can play a view transition. */
  canFade: boolean;
}

export function crossFades(f: CrossFadeFacts): boolean {
  return f.looksOtherwise && f.motion === 'lively' && f.quiet && !f.reduced && f.canFade;
}
