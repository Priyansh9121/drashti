/**
 * The LIVE block's height as it is while it stands (alpha.24): what LiveColumn judges by. While the whole column
 * scrolls, a scrollbar that takes room (Windows'; a Mac's floats over) narrows the block, and its picture is shorter by
 * as much, at its own shape. Judged by that height, the block would stand, widen, grow, stop standing and narrow again,
 * round and round (CI's Windows, 1024 × 645, the live column at 380 px). So what the scrollbar took from the picture is
 * added back, rounded up.
 */
export function blockAsItStands({
  block,
  scrollbar,
  picture,
}: {
  /** The block's height now (px). */
  block: number;
  /** The width a scrollbar beside it takes now (px; 0 while it stands, or where scrollbars float). */
  scrollbar: number;
  /** The live picture's box now, or null before it is drawn. */
  picture: { width: number; height: number } | null;
}): number {
  if (scrollbar <= 0 || !picture || picture.width <= 0) return block;
  return block + Math.ceil((scrollbar * picture.height) / picture.width);
}
