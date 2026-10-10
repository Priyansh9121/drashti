import type { KeyboardEvent, MouseEvent } from 'react';
import { create } from 'zustand';
import type { NewItem } from '../../../shared/playlists';
import { Button } from '../ui/Button';
import { ListPlus } from '../ui/icons';
import type { MenuPlace } from '../ui/Menu';
import { isMenuKey, Menu, menuBelow, menuPlace } from '../ui/Menu';
import { useDragging } from './drag';
import { addToOpenPlaylist, usePlaylists } from './playlist-store';

/*
 * Building a playlist without dragging (Session 25): Add to playlist, on the chosen library row and
 * in every row's menu (right-click, Shift+F10 or the Menu key), puts a presentation, a media file or
 * a Shastra passage into the open playlist, after its chosen item, or at the end when none is
 * chosen. Undo takes it out again. Dragging still works as before.
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

/** On the chosen library row, while a playlist is open. */
export function AddToPlaylistButton({ pick }: { pick: Pick }) {
  const playlist = useOpenName();
  const dragging = useDragging((s) => s.on);
  if (playlist === null || dragging) return null;
  return (
    <Button
      size="sm"
      icon={ListPlus}
      data-testid="add-to-playlist"
      title={`Add to “${playlist}”, after its chosen item`}
      onClick={() => void addToOpenPlaylist(pick())}
    >
      Add to playlist
    </Button>
  );
}

const useRowMenu = create<{ menu: { at: MenuPlace; label: string; pick: Pick } | null }>(() => ({
  menu: null,
}));

/** A library row's right-click and Shift+F10 (or Menu key): its menu, with Add to playlist. */
export function rowMenu(label: string, pick: Pick) {
  return {
    onContextMenu: (e: MouseEvent<HTMLElement>) => {
      e.preventDefault();
      useRowMenu.setState({ menu: { at: menuPlace(e), label, pick } });
    },
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      if (!isMenuKey(e)) return;
      e.preventDefault();
      useRowMenu.setState({ menu: { at: menuBelow(e.currentTarget), label, pick } });
    },
  };
}

/** The open row menu, once for the whole library column. */
export function LibraryRowMenu() {
  const menu = useRowMenu((s) => s.menu);
  const playlist = useOpenName();
  if (!menu) return null;
  return (
    <Menu
      at={menu.at}
      label={menu.label}
      entries={[
        playlist === null
          ? {
              label: 'Add to playlist (open a playlist first)',
              icon: ListPlus,
              disabled: true,
              onSelect: () => undefined,
            }
          : {
              label: `Add to “${playlist}”`,
              icon: ListPlus,
              onSelect: () => void addToOpenPlaylist(menu.pick()),
            },
      ]}
      onClose={() => {
        useRowMenu.setState({ menu: null });
      }}
    />
  );
}
