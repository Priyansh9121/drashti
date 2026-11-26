/*
 * One appearance fading into the next, its band sweeping in (Sessions 40 and 42, Lively): only when the look changes,
 * in Lively, the show quiet for 0.8 s and the computer allowing motion, and (alpha.24, the release lead's review of
 * uimotion, MUST-1) only with a graphics chip known to be there, as all of Lively now: a new install starts in Lively,
 * and a PC drawing in software never fades its whole window.
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
  return f.looksOtherwise && f.motion === 'lively' && f.chip === 'yes' && f.quiet && !f.reduced && f.canFade;
}
