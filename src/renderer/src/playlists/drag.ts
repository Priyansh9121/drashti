import type { DragEvent } from 'react';
import { create } from 'zustand';

/*
 * Dragging inside the operator window: presentations, media and Shastra
 * passages from the library into a playlist, and items within a playlist. Only the kind of
 * drag can be read while it is under way; the ids arrive with the drop.
 */

const TYPES = {
  presentations: 'application/x-drashti-presentations',
  media: 'application/x-drashti-media',
  items: 'application/x-drashti-playlist-items',
  /** Shastra passages (their ids), from the Shastra tab. */
  passages: 'application/x-drashti-passages',
} as const;

export type DragKind = keyof typeof TYPES;

/**
 * A drag of Drashti's is under way. Rows show no Add to playlist, Up or Down meanwhile: Chromium
 * cancels a drag whose row changes under the pointer as it starts (a row marked by the drag would
 * grow those buttons over the place it was grabbed).
 */
export const useDragging = create<{ on: boolean }>(() => ({ on: false }));

/** Call first in a dragstart handler, before anything that changes what the rows show. */
export function startDrag(e: DragEvent, kind: DragKind, ids: readonly string[]): void {
  e.dataTransfer.setData(TYPES[kind], JSON.stringify(ids));
  e.dataTransfer.effectAllowed = kind === 'items' ? 'move' : 'copy';
  useDragging.setState({ on: true });
  // Over when it ends or drops, or (should the row it came from be gone) at the next mouse move.
  const over = () => {
    useDragging.setState({ on: false });
    for (const type of ['dragend', 'drop', 'mousemove'] as const)
      window.removeEventListener(type, over, true);
  };
  for (const type of ['dragend', 'drop', 'mousemove'] as const) window.addEventListener(type, over, true);
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
