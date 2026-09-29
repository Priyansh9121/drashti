import type { DragEvent } from 'react';

/*
 * Dragging inside the operator window: presentations and media from the
 * library into a playlist, and items within a playlist. Only the kind of
 * drag can be read while it is under way; the ids arrive with the drop.
 */

const TYPES = {
  presentations: 'application/x-drashti-presentations',
  media: 'application/x-drashti-media',
  items: 'application/x-drashti-playlist-items',
} as const;

export type DragKind = keyof typeof TYPES;

export function startDrag(e: DragEvent, kind: DragKind, ids: readonly string[]): void {
  e.dataTransfer.setData(TYPES[kind], JSON.stringify(ids));
  e.dataTransfer.effectAllowed = kind === 'items' ? 'move' : 'copy';
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
