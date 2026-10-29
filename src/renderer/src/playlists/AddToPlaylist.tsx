import type { NewItem } from '../../../shared/playlists';
import { Button } from '../ui/Button';
import { cx } from '../ui/cx';
import { ListPlus } from '../ui/icons';
import type { MenuEntry } from '../ui/Menu';
import type { FileKind, FileTarget } from '../files/file-menu';
import { fileMenuProps } from '../files/FileMenu';
import { useDragging } from './drag';
import { addToOpenPlaylist, usePlaylists } from './playlist-store';

/*
 * Building a playlist without dragging (Session 25): Add to playlist, on the chosen library row and
 * in every row's menu (right-click, Shift+F10 or the Menu key; the one right-click menu since Session 55), puts a
 * presentation, a media file or a Shastra passage into the open playlist, after its chosen item, or at the end when
 * none is chosen. Undo takes it out again. Dragging still works as before.
 */

/** What a row adds: the marked ones when it is one of them (as a drag takes them), else itself. */
export type Pick = () => NewItem[];

/** The open playlist's name, or null when none is open. */
function useOpenName(): string | null {
  return usePlaylists((s) => {
    if (s.openId === null) return null;
    const node = s.tree.find((n) => n.id === s.openId) ?? s.templates.find((n) => n.id === s.openId);
    return node?.name ?? 'the playlist';
  });
}

/** How much taller the chosen row is while a playlist is open: a line for Add to playlist under it. */
export const ADD_LINE_HEIGHT = 36;

/** Whether a playlist is open (the chosen library row then has its Add to playlist line). */
export const usePlaylistOpen = (): boolean => usePlaylists((s) => s.openId !== null);

/** On a line under the chosen library row (so its name keeps its room), while a playlist is open. */
export function AddToPlaylistButton({ pick, className }: { pick: Pick; className?: string }) {
  const playlist = useOpenName();
  // Hidden while a drag is under way, keeping its room (a row that changes size as a drag starts
  // cancels it: drag.ts).
  const dragging = useDragging((s) => s.on);
  if (playlist === null) return null;
  return (
    <div className={cx('flex shrink-0 justify-end', dragging && 'invisible', className)}>
      <Button
        size="sm"
        icon={ListPlus}
        data-testid="add-to-playlist"
        title={`Add to “${playlist}”, after its chosen item`}
        onClick={() => void addToOpenPlaylist(pick())}
      >
        Add to playlist
      </Button>
    </div>
  );
}

/** The open playlist's name, as a menu opening now reads it, or null when none is open. */
function openNameNow(): string | null {
  const s = usePlaylists.getState();
  if (s.openId === null) return null;
  const node = s.tree.find((n) => n.id === s.openId) ?? s.templates.find((n) => n.id === s.openId);
  return node?.name ?? 'the playlist';
}

/** A library row's menu's first entry: Add to the open playlist (or why it cannot yet). */
export function addToEntry(pick: Pick): MenuEntry {
  const playlist = openNameNow();
  return playlist === null
    ? {
        label: 'Add to playlist (open a playlist first)',
        icon: ListPlus,
        disabled: true,
        onSelect: () => undefined,
      }
    : { label: `Add to “${playlist}”`, icon: ListPlus, onSelect: () => void addToOpenPlaylist(pick()) };
}

/**
 * A library row's right-click, Shift+F10 or Menu key, and a long press (Session 55, Part 14): the one right-click menu,
 * with Add to playlist first, then what fits the thing (Edit, Trim, Rename, Show in Finder) and Delete… (as its trash
 * button and the Delete key do).
 */
export function rowMenu(
  target: string | ((first: MenuEntry[]) => FileTarget),
  pick: Pick,
  /** A row given by its name alone: what it is (a Shastra passage, a video input), with Add to playlist only. */
  kind: FileKind = 'passage',
) {
  return fileMenuProps(() =>
    typeof target === 'string'
      ? { kind, name: target, place: 'library', first: [addToEntry(pick)] }
      : target([addToEntry(pick)]),
  );
}
