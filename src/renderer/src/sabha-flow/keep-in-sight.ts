/*
 * Red (a22-flow-next): a stand-in that never scrolls.
 */

/** The read list's own box's scrollTop that shows a row whole, moving the least (unchanged when it shows already). */
export function nearestScrollTop(
  at: { scrollTop: number; height: number },
  row: { top: number; height: number },
): number {
  void row;
  return at.scrollTop;
}
