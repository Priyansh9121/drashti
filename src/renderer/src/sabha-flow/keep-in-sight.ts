/*
 * Now kept in sight in the Sabha flow's read list (alpha.23, QA23-FLOW-2): as Back and Next move Now, the list scrolls
 * its own box the least that shows the Now row whole, and never the panel around it (an element's scrollIntoView moves
 * every box around it too: the panel's body would move Back and Next from under the pointer as they are pressed).
 */

/** The read list's own box's scrollTop that shows a row whole, moving the least (unchanged when it shows already). */
export function nearestScrollTop(
  at: { scrollTop: number; height: number },
  row: { top: number; height: number },
): number {
  const { scrollTop, height } = at;
  // Above, or taller than the box: its top at the box's top.
  if (row.top < scrollTop || row.height >= height) return Math.max(0, row.top);
  // Below: its bottom at the box's bottom.
  if (row.top + row.height > scrollTop + height) return row.top + row.height - height;
  return scrollTop;
}

/** Scroll `box` (the read list's own scrolling box) so that `row` shows whole, the least way; nothing else moves. */
export function keepInSight(box: HTMLElement, row: HTMLElement): void {
  const top =
    row.getBoundingClientRect().top - box.getBoundingClientRect().top - box.clientTop + box.scrollTop;
  const next = nearestScrollTop(
    { scrollTop: box.scrollTop, height: box.clientHeight },
    { top, height: row.getBoundingClientRect().height },
  );
  if (next !== box.scrollTop) box.scrollTop = next;
}
