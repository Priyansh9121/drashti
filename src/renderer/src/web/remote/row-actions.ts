import type { PresentationDoc } from '../../../../shared/library';
import { WHEN_ENDS_NAMES } from '../../../../shared/wallpapers';
import { useEngine } from '../../engine/engine-store';
import type { MiddleRow } from '../../playlists/rows';
import { itemOrder } from '../../playlists/rows';
import { ImageDown, Pencil, Pin, PinOff, Play, SlidersHorizontal, Trash2, ZoomIn } from '../../ui/icons';
import { api } from '../device';
import { tap, useTapNotice } from '../taps';
import { presentationPages, picturePage, videoPage } from '../viewer/pages';
import { savePictureHere } from '../viewer/save-picture';
import { openViewer } from '../viewer/viewer-store';
import { type RowAction, rowMenu } from './phone-rows';
import {
  askRename,
  type MenuEntry,
  isPinned,
  openEditor,
  openMenu,
  pinIt,
  unpin,
  usePhoneTools,
} from './phone-tools-store';
import { refreshPlaylist } from './remote-store';

/*
 * A row's menu on a phone (Session 55, Part 9): the entries phone-rows.ts says a row has, each in the window's words
 * and doing what the window's does, through the phone's requests (each checked in the main process). Remove takes the
 * row's item out of this playlist only, asking first while it is on the screens, with Undo; Rename… asks for the new
 * name, with Undo; When it ends is kept with the row; Pin and Unpin change the quick bar the window shows too.
 */

const post = (path: string, body?: unknown) =>
  api<{ ids?: string[] }>(path, { method: 'POST', body: body ?? {} });

/** Take a row's item out of the playlist, with its Undo said under the rows. */
export async function removeRow(playlistId: string, itemId: string, name: string): Promise<void> {
  const r = await post('/api/v1/playlist-items/delete', { ids: [itemId] });
  if (!r.ok) {
    useTapNotice.setState({ text: r.message });
    return;
  }
  const ids = r.ids ?? [itemId];
  usePhoneTools.setState({
    undo: {
      where: 'rows',
      text: `Took “${name}” out of the playlist`,
      undo: async () => {
        const back = await post('/api/v1/playlist-items/restore', { ids });
        if (!back.ok) useTapNotice.setState({ text: back.message });
        await refreshPlaylist(playlistId);
      },
    },
  });
  await refreshPlaylist(playlistId);
}

/** Whether a row's item is what the screens show now (Remove asks first then, as the window does). */
function itemIsUp(itemId: string): boolean {
  const live = useEngine.getState().state?.live.playlist;
  return live?.itemId === itemId;
}

/** Rename… a file or a presentation: asked here, kept in the library, with Undo. */
function rename(action: Extract<RowAction, { id: 'rename' }>, playlistId: string): void {
  const path =
    action.what.kind === 'media'
      ? `/api/v1/media/${encodeURIComponent(action.what.mediaId)}/rename`
      : `/api/v1/presentations/${encodeURIComponent(action.what.presentationId)}/rename`;
  const word =
    action.what.kind === 'presentation'
      ? 'the presentation'
      : action.what.media === 'image'
        ? 'the picture'
        : action.what.media === 'video'
          ? 'the video'
          : 'the sound';
  askRename({
    what: word,
    name: action.name,
    save: async (to) => {
      const r = await post(path, { name: to });
      if (!r.ok) return r.message;
      usePhoneTools.setState({
        undo: {
          where: 'rows',
          text: `Renamed “${action.name}” to “${to}”`,
          undo: async () => {
            const back = await post(path, { name: action.name });
            if (!back.ok) useTapNotice.setState({ text: back.message });
            await refreshPlaylist(playlistId);
          },
        },
      });
      await refreshPlaylist(playlistId);
      return null;
    },
  });
}

/** What a row's look entry opens: the row's slide among its item's (a deck's step by step), or its file. */
function look(row: MiddleRow, doc: PresentationDoc | null): void {
  if (row.kind === 'slide') {
    const order = row.item && doc ? itemOrder(row.item, doc) : null;
    if (!order || !doc) return;
    const { pages, start } = presentationPages(row.presentationId, order.slides, row.at.position, null);
    openViewer(pages, start, doc.name);
    return;
  }
  const { item } = row;
  if (item.kind !== 'media') return;
  openViewer([
    item.media === 'video' ? videoPage(item.mediaId, item.label) : picturePage(item.mediaId, item.label),
  ]);
}

/** The words and icon of each entry, in the window's words. */
function entryOf(
  action: RowAction,
  row: MiddleRow,
  playlistId: string,
  doc: PresentationDoc | null,
): MenuEntry {
  switch (action.id) {
    case 'look': {
      const video = row.kind === 'item' && row.item.kind === 'media' && row.item.media === 'video';
      return {
        id: 'look',
        label: video ? 'Play it on this phone' : 'Look at it on this phone',
        icon: video ? Play : ZoomIn,
        run: () => {
          look(row, doc);
        },
      };
    }
    case 'edit':
      return {
        id: 'edit',
        label: 'Picture editor…',
        icon: SlidersHorizontal,
        run: () => {
          openEditor(action.mediaId, action.name);
        },
      };
    case 'save':
      return {
        id: 'save',
        label: 'Save picture…',
        icon: ImageDown,
        run: () => {
          const pictures = useEngine.getState().state?.pictures;
          void savePictureHere(action.mediaId, action.name, pictures?.[action.mediaId] ?? null).then(
            (problem) => {
              if (problem) useTapNotice.setState({ text: problem });
            },
          );
        },
      };
    case 'whenEnds':
      return {
        id: `when-${action.value}`,
        label: `When it ends: ${WHEN_ENDS_NAMES[action.value]}`,
        pressed: action.checked,
        run: () => {
          if (row.kind === 'slide') return;
          void tap(async () => {
            const r = await post(`/api/v1/playlist-items/${encodeURIComponent(row.item.id)}/when-ends`, {
              whenEnds: action.value,
            });
            if (r.ok) await refreshPlaylist(playlistId);
            return r;
          });
        },
      };
    case 'pin':
      return {
        id: 'pin',
        label: 'Pin to the quick bar',
        icon: Pin,
        run: () => void pinIt(action.pin),
      };
    case 'unpin':
      return {
        id: 'unpin',
        label: 'Unpin from the quick bar',
        icon: PinOff,
        run: () => void unpin(action.key),
      };
    case 'rename':
      return {
        id: 'rename',
        label: 'Rename…',
        icon: Pencil,
        run: () => {
          rename(action, playlistId);
        },
      };
    case 'remove':
      return {
        id: 'remove',
        label: row.kind === 'slide' ? `Remove “${action.name}” from playlist` : 'Remove from playlist',
        icon: Trash2,
        danger: true,
        run: () => {
          if (itemIsUp(action.itemId))
            usePhoneTools.setState({ removing: { playlistId, itemId: action.itemId, name: action.name } });
          else void removeRow(playlistId, action.itemId, action.name);
        },
      };
  }
}

/** A row's long press: its menu, titled with its name. */
export function openRowMenu(
  row: MiddleRow,
  playlistId: string,
  simple: boolean,
  doc: PresentationDoc | null,
  title: string,
): void {
  const actions = rowMenu(row, { playlistId, simple, pinned: isPinned });
  openMenu(
    title,
    actions.map((a) => entryOf(a, row, playlistId, doc)),
  );
}
