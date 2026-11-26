/*
 * The Sabha flow panel's share of the left column (alpha.23; lead 2's yes, owner away, to a22-flow-core's proposal for
 * Q-FC-2 A): while it is open its area is its share of the column under the Library button, but at least what Now and
 * Next up need to be whole (and the read list's own 96 px), never past the splitter's most, so the playlists never
 * have less than the splitter's least already leaves them. Once the operator has set the splitter themselves, their
 * setting wins: Next up then scrolls with the panel's body, never cut (Q-FC-2 A). Folded, the panel has no share.
 */

/** The flow's share of the column under the Library button: to start with, and the splitter's least and most. */
export const FLOW_SHARE = { initial: 0.5, min: 0.25, max: 0.75 } as const;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/**
 * The flow area's height (px) in a column of `area` px under the Library button: `share` the splitter's (remembered)
 * fraction, `need` what the panel needs for Now and Next up whole (0: nothing measured, or nothing to keep whole),
 * `dragged` whether the operator set the splitter themselves.
 */
export function flowAreaHeight(at: { area: number; share: number; need: number; dragged: boolean }): number {
  const chosen = Math.round(clamp(at.share, FLOW_SHARE.min, FLOW_SHARE.max) * at.area);
  if (at.dragged || !(at.need > 0)) return chosen;
  return Math.min(Math.round(FLOW_SHARE.max * at.area), Math.max(chosen, Math.round(at.need)));
}
