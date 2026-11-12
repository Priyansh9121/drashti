import type { PresentationDoc } from '../../../../shared/library';
import type { PlaylistItemInfo } from '../../../../shared/playlists';
import { pinKey, type QuickPin, type QuickRowKind } from '../../../../shared/quick-bar';
import { WHEN_ENDS, type WhenEnds } from '../../../../shared/wallpapers';
import { groupName, type MiddleRow, playlistRows } from '../../playlists/rows';

/*
 * The playlist on a phone or tablet (Session 55, Part 9), as Part 4 made the operator window's: its rows, from the
 * window's own rows (playlists/rows.ts): a presentation's (a PDF's, a deck's, a Shastra passage's) name, which folds,
 * and a row a slide under it, "<name>_N" with a text slide's first line; a picture, a video, a sound and a video input a
 * row each; a header and a slot rows that never go up. One tap puts a row up, as one click on the window's does (the
 * same requests a phone has always sent: a slide from its row, so Next goes on from it; an item; Repeat Slides going
 * round from there). A long press opens the row's menu: what the window's one right-click menu (Part 14), Save
 * picture… and the Picture editor (Part 5), When it ends (Part 6) and Pin to the quick bar (Part 8) give it that a phone
 * can do, in the window's order; in Simple Mode what its window's menu has, and what is the phone's
 * own (looking at it here, saving its picture here). Pure, so it is tested apart (phone-rows.test.ts).
 */

/**
 * The rows a phone shows: the window's, or in a Repeat Slides playlist a row an item (a phone reads no going-round
 * steps: a tap starts it going round from that item, as before).
 */
export function phoneRows(
  items: readonly PlaylistItemInfo[],
  docs: ReadonlyMap<string, PresentationDoc | null>,
  folded: ReadonlySet<string>,
  repeat: boolean,
): MiddleRow[] {
  if (!repeat) return playlistRows(items, docs, folded);
  return items.map((item, index) => ({ kind: 'item', key: item.id, item, index, number: index + 1 }));
}

/** What a tap on a row does: a request sent (it goes up), its slides folded or opened, or nothing. */
export type RowTap =
  | { kind: 'post'; path: string; body: Record<string, unknown> }
  | { kind: 'fold'; itemId: string }
  | { kind: 'none' };

/** One tap on a row, as one click on the window's row (playlists/one-click.ts). */
export function rowTap(row: MiddleRow, playlistId: string, repeat: boolean): RowTap {
  if (repeat) {
    if (row.kind === 'slide') return { kind: 'none' };
    const goes = row.item.kind !== 'header' && row.item.kind !== 'placeholder';
    return goes
      ? {
          kind: 'post',
          path: `/api/v1/repeat/${encodeURIComponent(playlistId)}/start`,
          body: { itemId: row.item.id },
        }
      : { kind: 'none' };
  }
  switch (row.kind) {
    case 'group':
      return { kind: 'fold', itemId: row.item.id };
    case 'slide':
      return row.item
        ? {
            kind: 'post',
            path: '/api/v1/trigger/slide',
            body: {
              presentationId: row.presentationId,
              slideIndex: row.at.position,
              arrangementId: row.arrangementId,
              playlist: { playlistId, itemId: row.item.id },
            },
          }
        : { kind: 'none' };
    case 'item':
      // A picture, video, sound or video input up at once; a missing file too (Drashti says why, as the window's).
      return row.item.kind === 'media' || row.item.kind === 'input'
        ? { kind: 'post', path: '/api/v1/trigger/item', body: { playlistId, itemId: row.item.id } }
        : { kind: 'none' };
  }
}

/** What Rename… renames: a file in the library, or a presentation. */
export type RenameWhat =
  | { kind: 'media'; mediaId: string; media: 'image' | 'video' | 'audio' }
  | { kind: 'presentation'; presentationId: string };

/** An entry of a row's menu, by what it does. */
export type RowAction =
  /** Looked at, or played, on this phone alone (Session 54, D1). */
  | { id: 'look' }
  /** The Picture editor (Part 5), on the phone. */
  | { id: 'edit'; mediaId: string; name: string }
  /** Save picture… (Part 5): the phone's Share sheet, or a download. */
  | { id: 'save'; mediaId: string; name: string }
  /** When it ends (Part 6): one of four, the row's own ticked. */
  | { id: 'whenEnds'; value: WhenEnds; checked: boolean }
  /** Pin to the quick bar (Part 8), or Unpin once pinned. */
  | { id: 'pin'; pin: QuickPin }
  | { id: 'unpin'; key: string }
  /** Rename… (Part 14). */
  | { id: 'rename'; what: RenameWhat; name: string }
  /** Remove from playlist (Part 14): the row's item out of this playlist only, with Undo. */
  | { id: 'remove'; itemId: string; name: string };

export interface RowMenuContext {
  playlistId: string;
  /** Simple Mode on Drashti's computer leaves out the picture editor and the quick bar. */
  simple: boolean;
  /** Whether this is on the quick bar now. */
  pinned: (pin: QuickPin) => boolean;
}

const ROW_KIND: Record<'image' | 'video' | 'audio', QuickRowKind> = {
  image: 'picture',
  video: 'video',
  audio: 'sound',
};

/** A row's pin, as the window pins it from its one right-click menu (quick-bar-store.ts pinFor). */
function pinOf(row: MiddleRow, playlistId: string): QuickPin | null {
  if (row.kind === 'slide') {
    if (!row.item) return null;
    return {
      kind: 'slide',
      presentationId: row.presentationId,
      slideId: row.at.slide.id,
      playlistId,
      itemId: row.item.id,
      label: row.label,
    };
  }
  const { item } = row;
  const name = item.kind === 'presentation' ? (item.presentationName ?? item.label) : item.label;
  const what: QuickRowKind | null =
    item.kind === 'media'
      ? ROW_KIND[item.media]
      : item.kind === 'input'
        ? 'input'
        : item.kind === 'presentation' || item.kind === 'shastra'
          ? 'presentation'
          : null;
  return what ? { kind: 'item', playlistId, itemId: item.id, label: name, what } : null;
}

/** The picture a row is (a picture's row, or a slide that is a picture: a deck's or a PDF's page), or null. */
function pictureOf(row: MiddleRow): { mediaId: string; name: string } | null {
  if (row.kind === 'slide') {
    const picture = row.at.slide.slide.elements.find((e) => e.kind === 'image');
    return picture?.kind === 'image' ? { mediaId: picture.mediaId, name: row.label } : null;
  }
  const { item } = row;
  return item.kind === 'media' && item.media === 'image' && !item.missing
    ? { mediaId: item.mediaId, name: item.label }
    : null;
}

/** Whether the row can be looked at, or played, on this phone (a picture or video there, or a slide). */
function lookable(row: MiddleRow): boolean {
  if (row.kind === 'slide') return true;
  const { item } = row;
  return item.kind === 'media' && item.media !== 'audio' && !item.missing;
}

/** A row's menu, in the window's order: its own first, Edit, its later Parts' items, Rename, and Remove last. */
export function rowMenu(row: MiddleRow, ctx: RowMenuContext): RowAction[] {
  const out: RowAction[] = [];
  const picture = pictureOf(row);
  if (lookable(row)) out.push({ id: 'look' });
  // The Picture editor and quick bar are Pro Mode's.
  const editable =
    picture && !(row.kind === 'item' && row.item.kind === 'media' && row.item.unplayable !== null);
  if (!ctx.simple && editable) out.push({ id: 'edit', ...picture });
  if (picture) out.push({ id: 'save', ...picture });
  if (row.kind === 'item' && row.item.kind === 'media' && row.item.media === 'video') {
    const own = row.item.whenEnds ?? 'wallpaper';
    for (const value of WHEN_ENDS) out.push({ id: 'whenEnds', value, checked: value === own });
  }
  const pin = ctx.simple ? null : pinOf(row, ctx.playlistId);
  if (pin) out.push(ctx.pinned(pin) ? { id: 'unpin', key: pinKey(pin) } : { id: 'pin', pin });
  // Rename…: a file, or a presentation still in the library (never a header's words, a slide or a passage).
  if (row.kind !== 'slide') {
    const { item } = row;
    if (item.kind === 'media')
      out.push({
        id: 'rename',
        what: { kind: 'media', mediaId: item.mediaId, media: item.media },
        name: item.label,
      });
    else if (item.kind === 'presentation' && item.presentationName !== null)
      out.push({
        id: 'rename',
        what: { kind: 'presentation', presentationId: item.presentationId },
        name: item.presentationName,
      });
  }
  // Remove from playlist: a slide's row takes its presentation's row out (a slide is never taken out of it from here).
  if (row.kind === 'slide') {
    if (row.item) out.push({ id: 'remove', itemId: row.item.id, name: groupName(row.item, null) });
  } else {
    const { item } = row;
    out.push({
      id: 'remove',
      itemId: item.id,
      name: item.kind === 'presentation' ? (item.presentationName ?? item.label) : item.label,
    });
  }
  return out;
}
