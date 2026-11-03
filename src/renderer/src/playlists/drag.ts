import type { DragEvent } from 'react';
import { create } from 'zustand';

/*
 * Dragging inside the operator window: presentations, media, Shastra
 * passages and video inputs (Session 51) from the library into a playlist, and items within a playlist; a slide's row
 * within its deck or out of it (Session 55, Part 4b). Only the kind of drag can be read while it is under way; the ids
 * arrive with the drop (a slide's row also says where it came from while it is dragged: draggedSlide).
 */

const TYPES = {
  presentations: 'application/x-drashti-presentations',
  media: 'application/x-drashti-media',
  items: 'application/x-drashti-playlist-items',
  /** Shastra passages (their ids), from the Books tab. */
  passages: 'application/x-drashti-passages',
  /** This computer's video inputs (Session 51), by their names, from Media's Video inputs. */
  inputs: 'application/x-drashti-inputs',
  /** A slide's row in a playlist (Session 55, Part 4b): its item's id and its place in the item's order. */
  slide: 'application/x-drashti-slide-row',
} as const;

export type DragKind = keyof typeof TYPES;

/**
 * A drag of Drashti's is under way. Rows hide their Add to playlist, Up and Down meanwhile, keeping
 * their room: Chromium cancels a drag whose row changes under the pointer as it starts (a row marked
 * by the drag would grow those buttons over the place it was grabbed), so nothing may change size,
 * and nothing is chosen, until the drag is over (Session 26a).
 */
export const useDragging = create<{
  on: boolean;
  /**
   * A drag from the library is under way (Session 44): its sheet stands aside, so the playlists and folders
   * it lies over show and take the drop. Set at the drag's first move, never at its start: Chromium cancels
   * a drag whose source is gone from under the pointer as it starts.
   */
  aside: boolean;
}>(() => ({ on: false, aside: false }));

/**
 * Do something once the drag is over (choosing the row it came from, say): done at dragstart, it
 * would move rows under the pointer as the drag starts, which cancels it.
 */
export function afterDrag(then: () => void): void {
  const done = () => {
    window.removeEventListener('dragend', done, true);
    then();
  };
  window.addEventListener('dragend', done, true);
}

/** Files dragged in from the Finder or Explorer. */
export const hasFiles = (e: DragEvent): boolean => e.dataTransfer.types.includes('Files');

/** The paths of files dropped from the Finder or Explorer (none that Drashti cannot tell). */
export const droppedPaths = (e: DragEvent): string[] =>
  Array.from(e.dataTransfer.files)
    .map((f) => window.drashti.files.pathFor(f))
    .filter((p) => p !== '');

/** The slide's row being dragged (Session 55, Part 4b): its item and its place there; null when none is. */
let slideRow: { itemId: string; position: number } | null = null;

/** The slide's row being dragged, read while the drag is under way (where its drop would land). */
export const draggedSlide = (): { itemId: string; position: number } | null => slideRow;

/** Call first in a dragstart handler, before anything that changes what the rows show. */
export function startDrag(e: DragEvent, kind: DragKind, ids: readonly string[]): void {
  e.dataTransfer.setData(TYPES[kind], JSON.stringify(ids));
  // Within the playlist: a move. From the library: a copy.
  const within = kind === 'items' || kind === 'slide';
  e.dataTransfer.effectAllowed = within ? 'move' : 'copy';
  const [itemId, position] = ids;
  slideRow =
    kind === 'slide' && itemId !== undefined && position !== undefined
      ? { itemId, position: Number(position) }
      : null;
  useDragging.setState({ on: true });
  // From the library: its sheet stands aside once the drag has started (see `aside`).
  const aside = () => {
    window.removeEventListener('dragover', aside, true);
    if (useDragging.getState().on) useDragging.setState({ aside: true });
  };
  if (!within) window.addEventListener('dragover', aside, true);
  // Over when it ends (after the drop has been placed: a reset at the drop itself would bring the
  // buttons back, and move the rows, before the list reads where it landed), or, should the row it
  // came from be gone, at the next mouse move.
  const over = () => {
    useDragging.setState({ on: false, aside: false });
    slideRow = null;
    window.removeEventListener('dragover', aside, true);
    for (const type of ['dragend', 'mousemove'] as const) window.removeEventListener(type, over, true);
  };
  for (const type of ['dragend', 'mousemove'] as const) window.addEventListener(type, over, true);
}

/** What is being dragged, if it is something of Drashti's. */
export function dragKind(e: DragEvent): DragKind | null {
  const types = e.dataTransfer.types;
  for (const kind of Object.keys(TYPES) as DragKind[]) if (types.includes(TYPES[kind])) return kind;
  return null;
}

/** The ids a drop carries (none if the data is not what Drashti put there). */
export function droppedIds(e: DragEvent, kind: DragKind): string[] {
  try {
    const value: unknown = JSON.parse(e.dataTransfer.getData(TYPES[kind]));
    if (Array.isArray(value) && value.every((v): v is string => typeof v === 'string')) return value;
  } catch {
    // Not ours.
  }
  return [];
}
