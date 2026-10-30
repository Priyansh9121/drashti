import type { PresentationSummary } from '../../../shared/library';
import type { MediaSummary, PlaylistItemInfo } from '../../../shared/playlists';
import { isPassageId } from '../../../shared/shastra';
import { isRepeatId } from '../../../shared/repeat';
import { openSlideEditor } from '../editor/open-editor';
import { requestRemoval } from '../library/import-store';
import { leaveItem, selectPresentation, setLibraryTab } from '../library/library-store';
import { requestMediaRemoval } from '../library/media-removal';
import { pushRemoval } from '../library/undo';
import { markersMedia, openMarkers } from '../markers/MarkersDialog';
import { openPictureEditor } from '../pictures/PictureEditor';
import {
  requestRemoveFolder,
  requestRemoveMarkedItems,
  startRenaming,
  usePlaylists,
} from '../playlists/playlist-store';
import type { MiddleRow } from '../playlists/rows';
import type { MenuEntry } from '../ui/Menu';
import { ListPlus, Presentation, SlidersHorizontal, SquareDashed, Timer } from '../ui/icons';
import type { FileKind, FileTarget } from './file-menu';
import { askRename, revealFile } from './FileMenu';

/*
 * What the one right-click menu (Session 55, Part 14) holds for each thing, wherever it shows: the library's
 * presentations and Media's pictures, videos and sounds, a playlist's rows (a presentation's name, a slide, a picture,
 * a video, a sound, a video input, a header, a slot), a folder playlist's folders and an audio playlist's tracks.
 * Delete does what fits the place: from a playlist it takes the row out of that playlist only; from the library it
 * deletes Drashti's own copy (never the owner's file); each asks first itself when it should, with Undo.
 */

/** Rename a presentation in the library (asked, with Undo). */
export function renamePresentation(id: string, name: string): void {
  askRename('the presentation', name, async (to) => {
    const result = await window.drashti.library.renamePresentation(id, to);
    if (!result.ok) return result.message;
    pushRemoval({
      text: `Renamed “${name}” to “${to}”`,
      restore: async () => {
        await window.drashti.library.renamePresentation(id, name);
      },
    });
    return null;
  });
}

/** A media file's kind, as its menu and questions say it. */
const MEDIA_WORD = { image: 'picture', video: 'video', audio: 'sound' } as const;
const MEDIA_KIND: Record<'image' | 'video' | 'audio', FileKind> = {
  image: 'picture',
  video: 'video',
  audio: 'sound',
};

/** Rename a picture, video or sound in the library (asked, with Undo): its playlist rows with its name follow. */
export function renameMedia(id: string, name: string, kind: 'image' | 'video' | 'audio'): void {
  askRename(`the ${MEDIA_WORD[kind]}`, name, async (to) => {
    const result = await window.drashti.media.rename(id, to);
    if (!result.ok) return result.message;
    pushRemoval({
      text: `Renamed “${name}” to “${to}”`,
      restore: async () => {
        await window.drashti.media.rename(id, name);
      },
    });
    return null;
  });
}

/** Edit for a media file: the Picture editor for a picture, nothing else (a video's and a sound's is Trim). */
function mediaEdit(
  id: string,
  name: string,
  kind: 'image' | 'video' | 'audio',
  can: boolean,
): FileTarget['edit'] {
  return kind === 'image' && can
    ? { label: 'Picture editor…', run: () => openPictureEditor({ id, name }) }
    : undefined;
}

/** A presentation in the library's list. */
export function libraryPresentation(p: PresentationSummary, first: MenuEntry[] = []): FileTarget {
  return {
    kind: 'presentation',
    name: p.name,
    place: 'library',
    presentationId: p.id,
    first,
    edit: { label: 'Edit slides…', run: () => void openSlideEditor(p.id, p.name) },
    rename: () => {
      renamePresentation(p.id, p.name);
    },
    reveal: () => void revealFile({ presentationId: p.id }),
    remove: { label: 'Delete…', run: () => void requestRemoval(p.id) },
  };
}

/** A picture, video or sound in Media. */
export function libraryMedia(m: MediaSummary, first: MenuEntry[] = []): FileTarget {
  const can = !m.missing && m.unplayable === null;
  return {
    kind: MEDIA_KIND[m.kind],
    name: m.name,
    place: 'media',
    mediaId: m.id,
    first,
    edit: mediaEdit(m.id, m.name, m.kind, can),
    ...(m.kind !== 'image' && can ? { trim: () => openMarkers(m) } : {}),
    rename: () => {
      renameMedia(m.id, m.name, m.kind);
    },
    reveal: () => void revealFile({ mediaId: m.id }),
    remove: { label: 'Delete…', run: () => void requestMediaRemoval(m.id) },
  };
}

/** Take the row out of its playlist (asked first when it is up): the library keeps it. */
const takeOut = { label: 'Remove from playlist', run: requestRemoveMarkedItems };

/** A row of the open playlist: an item's own. */
export function playlistRow(item: PlaylistItemInfo, playlistId: string, extra: MenuEntry[] = []): FileTarget {
  const timers: MenuEntry[] =
    item.kind === 'presentation' || item.kind === 'media' || item.kind === 'shastra' || item.kind === 'input'
      ? [
          {
            label: 'Timers when it goes up…',
            icon: Timer,
            onSelect: () => {
              usePlaylists.setState({ cuesFor: item });
            },
          },
        ]
      : [];
  const base = { place: 'playlist' as const, playlistId, itemId: item.id, remove: takeOut };
  switch (item.kind) {
    case 'header':
      return {
        ...base,
        kind: 'header',
        name: item.label,
        first: extra,
        rename: () => {
          startRenaming(item.id);
        },
      };
    case 'placeholder':
      return {
        ...base,
        kind: 'slot',
        name: item.label,
        first: [
          ...(item.hint === null
            ? [
                {
                  label: 'Edit slot…',
                  icon: SquareDashed,
                  onSelect: () => {
                    usePlaylists.setState({ editingSlot: item });
                  },
                },
              ]
            : []),
          ...extra,
        ],
      };
    case 'media': {
      const can = !item.missing && item.unplayable === null;
      return {
        ...base,
        kind: MEDIA_KIND[item.media],
        name: item.label,
        mediaId: item.mediaId,
        first: [...timers, ...extra],
        edit: mediaEdit(item.mediaId, item.label, item.media, can),
        ...(item.media !== 'image' && can ? { trim: () => openMarkers(markersMedia(item)) } : {}),
        rename: () => {
          renameMedia(item.mediaId, item.label, item.media);
        },
        reveal: () => void revealFile({ mediaId: item.mediaId }),
      };
    }
    case 'input':
      return { ...base, kind: 'input', name: item.label, first: [...timers, ...extra] };
    case 'shastra':
      return { ...base, kind: 'passage', name: item.label, first: [...timers, ...extra] };
    case 'presentation': {
      const name = item.presentationName ?? item.label;
      const here = item.presentationName !== null;
      return {
        ...base,
        kind: item.deck === true ? 'deck' : 'presentation',
        name,
        presentationId: item.presentationId,
        first: [
          ...(here
            ? [
                {
                  label: 'Show in the library',
                  icon: Presentation,
                  onSelect: () => {
                    leaveItem();
                    // The library's sheet opens on it (Session 44).
                    setLibraryTab('presentations');
                    void selectPresentation(item.presentationId);
                  },
                },
              ]
            : []),
          ...timers,
          ...extra,
        ],
        ...(here
          ? {
              edit: {
                label: 'Edit slides…' as const,
                run: () => void openSlideEditor(item.presentationId, name),
              },
              rename: () => {
                renamePresentation(item.presentationId, name);
              },
              reveal: () => void revealFile({ presentationId: item.presentationId }),
            }
          : {}),
      };
    }
  }
}

/**
 * A slide's row (in a playlist under its presentation's name, or the library's chosen presentation's): Edit slides at
 * it (a picture on it: the Picture editor too), and New Timer Slide… after it where slides are made here. Delete from
 * a playlist takes its presentation's row out (a slide alone is never taken out of a presentation from here).
 */
export function slideRowTarget(
  row: Extract<MiddleRow, { kind: 'slide' }>,
  name: string,
  playlistId: string | null,
  extra: MenuEntry[] = [],
): FileTarget {
  const slide = row.at.slide;
  const picture = slide.slide.elements.find((e) => e.kind === 'image');
  // A passage's and a Repeat Slides playlist's slides are made elsewhere: no editor.
  const editable = !isPassageId(row.presentationId) && !isRepeatId(row.presentationId);
  const pictureEntry: MenuEntry[] =
    picture?.kind === 'image'
      ? [
          {
            label: 'Picture editor…',
            icon: SlidersHorizontal,
            onSelect: () => {
              openPictureEditor({ id: picture.mediaId, name: row.label });
            },
          },
        ]
      : [];
  return {
    kind: 'slide',
    name: row.label,
    place: playlistId === null ? 'library' : 'playlist',
    presentationId: row.presentationId,
    slideId: slide.id,
    ...(picture?.kind === 'image' ? { mediaId: picture.mediaId } : {}),
    ...(playlistId !== null && row.item ? { playlistId, itemId: row.item.id } : {}),
    first: [...pictureEntry, ...extra],
    ...(editable
      ? {
          edit: {
            label: 'Edit slides…' as const,
            run: () => void openSlideEditor(row.presentationId, name, slide.id),
          },
        }
      : {}),
    ...(playlistId !== null && row.item
      ? { remove: { label: `Remove “${name}” from playlist`, run: requestRemoveMarkedItems } }
      : {}),
  };
}

/**
 * Make it an item of its own (Session 55, Part 4b's keyboard move): in the menu of a slide's row of a deck or
 * presentation in a playlist (one of more than one slide there), as the place's own, so the keyboard (Shift+F10) can do
 * what dragging the row out of its deck does. Pro Mode's: Simple Mode's menu has Rename and Delete only (Part 18).
 */
export function slideOutEntry(run: () => void): MenuEntry {
  return { label: 'Make it an item of its own', icon: ListPlus, onSelect: run };
}

/** A folder playlist's folder (Session 44): Delete takes it and everything in it out of the playlist, with one Undo. */
export function folderTarget(path: string, name: string, playlistId: string): FileTarget {
  return {
    kind: 'folder',
    name,
    place: 'playlist',
    playlistId,
    remove: { label: 'Remove the folder from playlist…', run: () => requestRemoveFolder(path) },
  };
}

/** An audio playlist's track: a sound (Delete takes it out of that audio playlist only, with Undo). */
export function trackTarget(
  track: { mediaId: string; name: string; playable: boolean },
  remove: () => void,
): FileTarget {
  return {
    kind: 'sound',
    name: track.name,
    place: 'music',
    mediaId: track.mediaId,
    ...(track.playable
      ? {
          trim: () =>
            openMarkers({
              id: track.mediaId,
              name: track.name,
              kind: 'audio',
              missing: false,
              unplayable: null,
              format: null,
              convertedTo: null,
            }),
        }
      : {}),
    rename: () => {
      renameMedia(track.mediaId, track.name, 'audio');
    },
    reveal: () => void revealFile({ mediaId: track.mediaId }),
    remove: { label: 'Remove from the audio playlist', run: remove },
  };
}
