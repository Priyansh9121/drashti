/*
 * The Sabha flow panel's share of the left column (alpha.23). Stub.
 */

/** The flow's share of the column under the Library button: to start with, and the splitter's least and most. */
export const FLOW_SHARE = { initial: 0.5, min: 0.25, max: 0.75 } as const;

export function flowAreaHeight(at: { area: number; share: number; need: number; dragged: boolean }): number {
  const share = Math.min(FLOW_SHARE.max, Math.max(FLOW_SHARE.min, at.share));
  return Math.round(share * at.area);
}
