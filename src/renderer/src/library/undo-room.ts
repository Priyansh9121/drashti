/**
 * Whether the Undo line, or the room it leaves, is at the left column's foot (QA24-UNDOLINE-2): the line while it
 * shows; once it has gone, its room, empty, only while the pointer is over the column or one of Drashti's drags is
 * under way (a drag moves no pointer, so the column cannot tell where it is), so nothing in the column moves under
 * the pointer. Only a line leaves a room: none ever comes by itself, and once the pointer is elsewhere it closes.
 */
export function footKept(foot: {
  /** The line shows (its minute on, or the keyboard on its Undo). */
  shown: boolean;
  /** The line, or its room, was there. */
  kept: boolean;
  /** The pointer is over the left column. */
  overColumn: boolean;
  /** One of Drashti's drags is under way. */
  dragging: boolean;
}): boolean {
  return foot.shown || (foot.kept && (foot.overColumn || foot.dragging));
}
