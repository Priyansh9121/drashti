import type { MenuEntry } from '../ui/Menu';
import { Bookmark, FolderOpen, Pencil, SlidersHorizontal, SquarePen, Trash2 } from '../ui/icons';

/*
 * The one right-click menu (Session 55, Part 14): every file, folder, video, sound and picture, wherever it shows
 * (the library, a playlist's rows, a folder playlist's folders, an audio playlist's tracks, Media and, from Part 6,
 * the wallpapers), gets the same menu, by a right-click, Shift+F10 or the Menu key, or a long press on a touch screen.
 * It holds Delete, and what fits the thing: Edit (the Picture editor, or Edit slides), Trim (a video's or sound's
 * start, end and markers), Rename, and Show in Finder (Show in Explorer on Windows). A place gives its own first
 * entries (Add to playlist, Show in the library, the order a presentation plays in…). Later Parts add their own
 * items to every menu through addFileMenuItems (Part 5's Save picture…, Part 6's When it ends), never a second menu.
 */

/** What a right-click is on. */
export type FileKind =
  | 'presentation'
  | 'deck'
  | 'slide'
  | 'picture'
  | 'video'
  | 'sound'
  | 'input'
  | 'passage'
  | 'folder'
  | 'header'
  | 'slot';

/** Where it shows: its menu's Delete does what fits there. */
export type FilePlace = 'library' | 'media' | 'playlist' | 'music' | 'wallpapers';

/** What a right-click is on, and what its place lets the menu do. */
export interface FileTarget {
  kind: FileKind;
  /** Its name, for the menu's label and its questions. */
  name: string;
  place: FilePlace;
  /** A picture's, video's or sound's media id (a picture slide's picture too, for Part 5's Save picture…). */
  mediaId?: string;
  /** A presentation's, a deck's or a slide's presentation. */
  presentationId?: string;
  /** A slide's id. */
  slideId?: string;
  /** In a playlist: which, and its row. */
  playlistId?: string;
  itemId?: string;
  /** What fits only here, first in the menu. */
  first?: MenuEntry[];
  /** Edit: the Picture editor, or Edit slides at this slide, or a wallpaper's pictures and timing (Part 6). */
  edit?: { label: 'Picture editor…' | 'Edit slides…' | 'Edit wallpaper…'; run: () => void };
  /** Trim: a video's or sound's start, end and markers. */
  trim?: () => void;
  rename?: () => void;
  /** Show in Finder (Explorer): the file it is, shown by the main process. */
  reveal?: () => void;
  /** Delete for this place (it asks first itself when it should). */
  remove?: { label: string; run: () => void };
}

/** A later Part's items for the menu (Save picture…, When it ends): those that fit the thing, or none. */
export type FileMenuItems = (target: FileTarget) => MenuEntry[];

/** A later Part's items, and whether Simple Mode's menu has them too (Session 56). */
const added: { items: FileMenuItems; simple: boolean }[] = [];

/**
 * Add items to every file's menu (Part 5's Save picture…, Part 6's When it ends): returns how to take them out.
 * `simple`: Simple Mode's menu has them too (Session 56: Trim black and silence, Even loudness, When it ends).
 */
export function addFileMenuItems(
  items: FileMenuItems,
  { simple = false }: { simple?: boolean } = {},
): () => void {
  const entry = { items, simple };
  added.push(entry);
  return () => {
    const at = added.indexOf(entry);
    if (at >= 0) added.splice(at, 1);
  };
}

/** Show in Finder on a Mac, Show in Explorer on Windows. */
export function revealLabel(platform: string): string {
  return platform === 'win32' ? 'Show in Explorer' : 'Show in Finder';
}

/**
 * The menu's entries, in one order everywhere: the place's own first, then Edit, Trim, a later Part's items, Rename,
 * Show in Finder (Explorer), and Delete last, apart. In Simple Mode (Session 55, Part 18: "Right-click Delete and
 * Rename"), those two alone: a file's Rename (never a header's, which names a part of the playlist), and Delete.
 */
export function fileMenuEntries(
  target: FileTarget,
  platform: string,
  { simple = false }: { simple?: boolean } = {},
): MenuEntry[] {
  if (simple) {
    const out: MenuEntry[] = [];
    if (target.rename && target.kind !== 'header')
      out.push({ label: 'Rename…', icon: Pencil, onSelect: target.rename });
    if (target.remove)
      out.push({
        label: target.remove.label,
        icon: Trash2,
        danger: true,
        separatorBefore: out.length > 0,
        onSelect: target.remove.run,
      });
    return out;
  }
  const entries: MenuEntry[] = [...(target.first ?? [])];
  const group = (more: MenuEntry[]) => {
    const [head, ...rest] = more;
    if (!head) return;
    entries.push({ ...head, separatorBefore: entries.length > 0 || head.separatorBefore }, ...rest);
  };
  const editing: MenuEntry[] = [];
  if (target.edit)
    editing.push({
      label: target.edit.label,
      icon: target.edit.label === 'Picture editor…' ? SlidersHorizontal : SquarePen,
      onSelect: target.edit.run,
    });
  if (target.trim)
    editing.push({ label: 'Trim (start, end and markers)…', icon: Bookmark, onSelect: target.trim });
  for (const { items } of added) editing.push(...items(target));
  group(editing);
  const naming: MenuEntry[] = [];
  if (target.rename) naming.push({ label: 'Rename…', icon: Pencil, onSelect: target.rename });
  if (target.reveal) naming.push({ label: revealLabel(platform), icon: FolderOpen, onSelect: target.reveal });
  group(naming);
  if (target.remove)
    entries.push({
      label: target.remove.label,
      icon: Trash2,
      danger: true,
      separatorBefore: entries.length > 0,
      onSelect: target.remove.run,
    });
  return entries;
}
