/** The existing Lively band is decoration alone. Its sweep does not capture a window or change readable words. */
export interface BandSweepFacts {
  looksOtherwise: boolean;
  motion: string;
  chip: string;
  quiet: boolean;
  reduced: boolean;
}

export function bandSweeps(f: BandSweepFacts): boolean {
  return f.looksOtherwise && f.motion === 'lively' && f.chip === 'yes' && f.quiet && !f.reduced;
}
