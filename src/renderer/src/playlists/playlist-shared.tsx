import { useRef, useState } from 'react';
import type { DragEvent, KeyboardEvent } from 'react';
import { actionFor, LIBRARY_KEYMAP } from '../../../shared/keymap';
import type { NewItem } from '../../../shared/playlists';
import { cx } from '../ui/cx';
import { controlClass } from '../ui/Field';
import { dragKind, droppedIds } from './drag';

/*
 * What the list of playlists (the left column) and the open playlist (the
 * centre, Session 26a) share: naming in place, and what a drop from the
 * library brings.
 */

/** A name edited in place: Enter or leaving the field keeps it, Esc goes back. */
export function RenameField({
  value,
  label,
  onDone,
}: {
  value: string;
  label: string;
  onDone: (name: string | null) => void;
}) {
  const [text, setText] = useState(value);
  const done = useRef(false);
  const finish = (name: string | null) => {
    if (done.current) return;
    done.current = true;
    onDone(name);
  };
  return (
    <input
      autoFocus
      aria-label={label}
      data-testid="rename-field"
      value={text}
      maxLength={200}
      onFocus={(e) => {
        e.currentTarget.select();
      }}
      onChange={(e) => {
        setText(e.target.value);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          finish(text);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          finish(null);
        }
      }}
      onBlur={() => {
        finish(text);
      }}
      className={cx(controlClass, 'w-full border-accent')}
    />
  );
}

/** Presentations or media dropped from the library, as new items. */
export function droppedItems(e: DragEvent): NewItem[] {
  const kind = dragKind(e);
  if (kind === 'presentations')
    return droppedIds(e, kind).map((presentationId) => ({ kind: 'presentation', presentationId }));
  if (kind === 'media') return droppedIds(e, kind).map((mediaId) => ({ kind: 'media', mediaId }));
  if (kind === 'passages') return droppedIds(e, kind).map((passageId) => ({ kind: 'shastra', passageId }));
  return [];
}

export const fromLibrary = (e: DragEvent): boolean => {
  const kind = dragKind(e);
  return kind === 'presentations' || kind === 'media' || kind === 'passages';
};

export const isRemoveKey = (e: KeyboardEvent, platform: string): boolean =>
  !e.repeat && actionFor(e.nativeEvent, platform, LIBRARY_KEYMAP) === 'removeSelected';
