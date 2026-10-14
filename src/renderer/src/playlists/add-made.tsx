import type { NewItem, PlaylistNode } from '../../../shared/playlists';
import { Select } from '../ui/Field';
import { addFromLibrary, loadTree, usePlaylists } from './playlist-store';

/*
 * Add to playlist after an import (Session 26a): the import report, and the
 * link dialog before Download, offer the open playlist, another, or a new one
 * named after the file or folder. Everything the import made goes in, in the
 * order imported, at the end; Undo takes it out again. Adding to the playlist
 * that is live never changes what is on the screens.
 */

export type AddTarget = { kind: 'none' } | { kind: 'playlist'; id: string } | { kind: 'new'; name: string };

/** "Name", or "Name (2)" when a playlist has it already. */
export function uniquePlaylistName(name: string, taken: readonly PlaylistNode[]): string {
  const names = new Set(taken.map((n) => n.name.toLocaleLowerCase()));
  const base = name.trim() === '' ? 'New playlist' : name.trim();
  if (!names.has(base.toLocaleLowerCase())) return base;
  for (let n = 2; ; n++) {
    const next = `${base} (${String(n)})`;
    if (!names.has(next.toLocaleLowerCase())) return next;
  }
}

/** A file's or folder's name without its folder and extension, for a playlist named after it. */
export function nameAfter(path: string): string {
  const last = path.split(/[\\/]/u).filter(Boolean).pop() ?? path;
  const dot = last.lastIndexOf('.');
  return dot > 0 ? last.slice(0, dot) : last;
}

/** Add `items` to the target; the playlist's name, or null when nothing was added. */
export async function addMadeTo(target: AddTarget, items: NewItem[]): Promise<string | null> {
  if (target.kind === 'none' || items.length === 0) return null;
  let id = target.kind === 'playlist' ? target.id : null;
  if (target.kind === 'new') {
    const name = uniquePlaylistName(target.name, usePlaylists.getState().tree);
    const made = await window.drashti.playlists.create(name, null, false);
    if (!made.ok) return null;
    id = made.ids[0] ?? null;
    await loadTree();
  }
  if (!id) return null;
  const added = await addFromLibrary(id, null, items);
  if (added.length === 0) return null;
  return usePlaylists.getState().tree.find((n) => n.id === id)?.name ?? 'the playlist';
}

/** Where to add, to begin with: the open playlist when one is open (not a template), else none. */
export function defaultTarget(): AddTarget {
  const { openId, tree } = usePlaylists.getState();
  return openId && tree.some((n) => n.id === openId) ? { kind: 'playlist', id: openId } : { kind: 'none' };
}

const valueOf = (t: AddTarget) => (t.kind === 'playlist' ? `playlist:${t.id}` : t.kind);

/** The open playlist first, then the others, then a new one named after what was imported. */
export function AddTargetSelect({
  value,
  onChange,
  newName,
  label,
  noneLabel,
  testId,
}: {
  value: AddTarget;
  onChange: (target: AddTarget) => void;
  /** What a new playlist is called (after the file or folder). */
  newName: string;
  label: string;
  /** The choice of no playlist, when there is one ("No playlist"). */
  noneLabel?: string;
  testId: string;
}) {
  const tree = usePlaylists((s) => s.tree);
  const openId = usePlaylists((s) => s.openId);
  const playlists = tree.filter((n) => !n.isFolder);
  const ordered = [...playlists.filter((n) => n.id === openId), ...playlists.filter((n) => n.id !== openId)];
  return (
    <Select
      aria-label={label}
      data-testid={testId}
      value={valueOf(value)}
      className="min-w-0 flex-1"
      onChange={(e) => {
        const v = e.target.value;
        onChange(
          v === 'none'
            ? { kind: 'none' }
            : v === 'new'
              ? { kind: 'new', name: newName }
              : { kind: 'playlist', id: v.slice('playlist:'.length) },
        );
      }}
    >
      {noneLabel !== undefined && <option value="none">{noneLabel}</option>}
      {ordered.map((n) => (
        <option key={n.id} value={`playlist:${n.id}`}>
          {n.name}
          {n.id === openId ? ' (open)' : ''}
        </option>
      ))}
      <option value="new">A new playlist, “{uniquePlaylistName(newName, tree)}”</option>
    </Select>
  );
}
