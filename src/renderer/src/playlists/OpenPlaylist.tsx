import { useWhatIsThis } from '../help/WhatIsThis';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import { create } from 'zustand';
import { formatDuration } from '../../../shared/format';
import { actionFor, LIBRARY_KEYMAP } from '../../../shared/keymap';
import type { RenderSlide } from '../../../shared/model';
import type { PlaylistItemInfo, TimerCue } from '../../../shared/playlists';
import { SMART_MAX_FILES } from '../../../shared/playlists';
import { useEngine } from '../engine/engine-store';
import { leaveItem, selectPresentation, useLibrary } from '../library/library-store';
import { mediaKindIcon, mediaProblem } from '../library/MediaList';
import { useExtras } from '../library/extras-store';
import { chooseAddTo, openLinkDialog } from '../links/link-store';
import { MediaStill } from '../render/MediaStill';
import { PlacedInParent } from '../render/Placed';
import { SlideView } from '../render/SlideView';
import { Badge, LiveBadge, MissingBadge, UnplayableBadge } from '../ui/Badge';
import { Button, IconButton } from '../ui/Button';
import { cx } from '../ui/cx';
import { rowTops, slideRows } from '../ui/motion';
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  BookOpen,
  Bookmark,
  BookTemplate,
  FilePlus,
  FolderSync,
  Link2,
  Repeat2,
  SlidersHorizontal,
  ListMusic,
  ListPlus,
  MoreHorizontal,
  Pencil,
  Presentation,
  SquareDashed,
  Timer,
  Trash2,
  X,
} from '../ui/icons';
import type { MenuEntry, MenuPlace } from '../ui/Menu';
import { isMenuKey, Menu, MenuButton, menuBelow, menuPlace } from '../ui/Menu';
import { Notice } from '../ui/Notice';
import { rowClass } from '../ui/ListRow';
import { RowDelete } from '../ui/RowDelete';
import { EmptyState } from '../ui/States';
import { Truncate } from '../ui/Truncate';
import { plural } from '../ui/text';
import { afterDrag, dragKind, droppedIds, droppedPaths, hasFiles, startDrag, useDragging } from './drag';
import { droppedItems, isRemoveKey, RenameField } from './playlist-shared';
import { useSmart } from './smart-store';
import { markersMedia, openMarkers } from '../markers/MarkersDialog';
import { openPictureEditor } from '../pictures/PictureEditor';
import { RepeatBar } from './RepeatBar';
import {
  addFromLibrary,
  addHeader,
  clickItem,
  closePlaylist,
  fillPlaceholder,
  importIntoPlaylist,
  itemName,
  markedItems,
  moveItemBy,
  moveItems,
  newFromTemplate,
  pickItem,
  removeMarkedItems,
  removeMissingItems,
  renameHeader,
  renameNode,
  requestRemoveNode,
  startRenaming,
  stopRenaming,
  templateOpen,
  usePlaylists,
} from './playlist-store';

/*
 * The open playlist in the centre of the operator window (Session 26a; it
 * was in the left column, in place of the list of playlists): a header with
 * its name, Add files…, From a Link… and its menu, then its items as cards,
 * each with a picture, its name, what it is and its length or slide count.
 * Drag a card to move it (Up and Down, and Alt+↑ ↓, as before); drop library
 * rows or files anywhere on it.
 */

// ---- the open playlist's items ----------------------------------------------------------

/** Where a drag would land: before the item at `at` (or at the end), or on a placeholder to fill it. */
type DropSpot = { at: number } | { fill: string };

/** What an item is, in a word or two, on its card (Session 26a). */
function kindWord(item: PlaylistItemInfo): string {
  switch (item.kind) {
    case 'presentation':
      return item.deck ? 'Deck' : 'Presentation';
    case 'media':
      return item.media === 'image' ? 'Picture' : item.media === 'video' ? 'Video' : 'Sound';
    case 'header':
      return 'Header';
    case 'shastra':
      return 'Shastra passage';
    case 'placeholder':
      return item.hint === null ? 'Slot' : 'Not found';
  }
}

/** Its length or slide count, when there is one to say. */
function sizeWord(item: PlaylistItemInfo): string | null {
  if (item.kind === 'presentation' && item.slideCount !== undefined) return plural(item.slideCount, 'slide');
  if (item.kind === 'media' && item.durationMs) return formatDuration(item.durationMs);
  return null;
}

/** First slides of the playlist's presentations, for their cards: asked for once, forgotten when the library changes. */
const useCardSlides = create<{ slides: Record<string, RenderSlide | null> }>(() => ({ slides: {} }));
let asked = new Set<string>();
let watching = false;
function wantSlides(ids: readonly string[]): void {
  if (!watching) {
    watching = true;
    window.drashti.library.onChanged((what) => {
      if (what !== 'presentations') return;
      asked = new Set();
      useCardSlides.setState({ slides: {} });
    });
  }
  const missing = [...new Set(ids)].filter((id) => !asked.has(id));
  if (missing.length === 0) return;
  for (const id of missing) asked.add(id);
  void window.drashti.playlists.firstSlides(missing).then((found) => {
    useCardSlides.setState((s) => ({ slides: { ...s.slides, ...found } }));
  });
}

const PICTURE_BOX =
  'relative aspect-video w-20 shrink-0 overflow-hidden rounded-sm border border-line bg-black';

/** The picture on an item's card: a presentation's first slide, a picture or a video's still, or an icon. */
function ItemPicture({ item }: { item: PlaylistItemInfo }) {
  const slide = useCardSlides((s) =>
    item.kind === 'presentation' ? s.slides[item.presentationId] : undefined,
  );
  if (item.kind === 'presentation' && slide)
    return (
      <span className={PICTURE_BOX} data-a11y-picture aria-hidden="true">
        <PlacedInParent content={slide} mode="fit" className="absolute inset-0">
          <SlideView slide={slide} media="still" />
        </PlacedInParent>
      </span>
    );
  if (item.kind === 'media' && item.media !== 'audio' && !item.missing)
    return (
      <span className={PICTURE_BOX} data-a11y-picture aria-hidden="true">
        <MediaStill mediaId={item.mediaId} media={item.media} />
      </span>
    );
  const KindIcon =
    item.kind === 'media'
      ? mediaKindIcon[item.media]
      : item.kind === 'shastra'
        ? BookOpen
        : item.kind === 'placeholder'
          ? item.hint === null
            ? SquareDashed
            : AlertTriangle
          : Presentation;
  return (
    <span aria-hidden="true" className={cx(PICTURE_BOX, 'flex items-center justify-center bg-panel-3')}>
      <KindIcon
        size={18}
        className={item.kind === 'placeholder' && item.hint !== null ? 'text-warning' : 'text-muted'}
      />
    </span>
  );
}

/** An item's card: its picture, its name, what it is and its length or slide count (Session 26a). */
function ItemBody({ item, live }: { item: PlaylistItemInfo; live: boolean }) {
  const liveBadge = live ? <LiveBadge /> : null;
  if (item.kind === 'header')
    return (
      <span className="flex items-center gap-2">
        {item.color && (
          <span
            aria-hidden="true"
            className="h-3.5 w-1.5 shrink-0 rounded-sm"
            style={{ background: item.color }}
          />
        )}
        <span
          data-label
          title={item.label}
          // A name the operator typed, perhaps in Gujarati or Hindi: as typed, never capitals or spaced letters.
          className="min-w-0 flex-1 truncate text-xs font-bold text-muted"
        >
          {item.label}
        </span>
      </span>
    );
  const name = item.kind === 'presentation' ? (item.presentationName ?? item.label) : item.label;
  const size = sizeWord(item);
  const problem = item.kind === 'media' ? mediaProblem(item) : null;
  return (
    <span className="flex items-center gap-2.5">
      <ItemPicture item={item} />
      <span className="min-w-0 flex-1">
        <span
          data-label
          title={name}
          className={cx(
            'block truncate text-sm font-medium',
            item.kind === 'placeholder' && item.hint !== null && 'text-warning-fg',
          )}
        >
          {name}
        </span>
        <span className="block truncate text-xs text-muted" data-testid="item-what">
          {kindWord(item)}
          {size ? ` · ${size}` : ''}
        </span>
        {item.kind === 'presentation' &&
          (item.presentationName === null ? (
            <span className="text-xs text-warning-fg">Removed from the library</span>
          ) : item.order.mode === 'arrangement' ? (
            <span className="block truncate text-xs text-muted">
              Arrangement: {item.arrangementName ?? ''}
            </span>
          ) : item.order.mode === 'all' ? (
            <span className="text-xs text-muted">All slides in order</span>
          ) : null)}
        {item.kind === 'shastra' && item.missing && (
          <span className="text-xs text-warning-fg">Its Shastra text is not loaded</span>
        )}
        {item.kind === 'placeholder' && (
          <span
            className={cx('block truncate text-xs', item.hint === null ? 'text-muted' : 'text-warning-fg')}
          >
            {item.hint === null
              ? `A slot${item.category ? ` · ${item.category}` : ''} · choose what goes here`
              : 'Not found at import · drag a presentation here'}
          </span>
        )}
        {item.kind !== 'placeholder' && <CuesLine cues={item.timers} />}
      </span>
      {/* A smart playlist's item whose file is gone from the folder (Session 26c): it still plays. */}
      {(item.kind === 'media' || item.kind === 'presentation') && item.gone && (
        <Badge
          tone="warning"
          data-testid="item-gone"
          title="Its file is no longer in the folder this playlist follows. It still plays: Drashti keeps its own copy."
        >
          Not in the folder
        </Badge>
      )}
      {item.kind === 'media' && (item.missing ? <MissingBadge /> : problem && <UnplayableBadge />)}
      {liveBadge}
    </span>
  );
}

/** How following the folder goes, in words. */
function smartState(view: { state: string; adding: number }): string {
  if (view.state === 'folder-gone')
    return 'The folder is not there (a USB stick taken out?). Its items stay, and it carries on when the folder is back.';
  if (view.state === 'too-many')
    return `The folder holds more than ${SMART_MAX_FILES.toLocaleString('en')} videos, pictures, sounds and decks: nothing more is added until some are moved out.`;
  if (view.state === 'waiting')
    return `Waiting while the stream is on air or recording: ${plural(view.adding, 'file')} will join afterwards.`;
  if (view.adding > 0) return `Adding ${plural(view.adding, 'file')}…`;
  return 'What goes in the folder joins by itself.';
}

/**
 * A smart playlist's settings (Session 26c): the folder it follows, how that goes, and the one button
 * for the items whose files are gone.
 */
function SmartBar({ playlistId }: { playlistId: string }) {
  const view = useSmart((s) => s.views[playlistId]);
  if (!view) return null;
  return (
    <div
      data-testid="smart-bar"
      data-state={view.state}
      className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-line px-3 py-1.5 text-xs"
    >
      <span className="text-muted">Follows</span>
      <Truncate
        text={view.folder}
        className="min-w-24 max-w-full flex-1 font-medium"
        data-testid="smart-folder"
      />
      <span
        role="status"
        data-testid="smart-state"
        className={view.state === 'following' || view.state === 'waiting' ? 'text-muted' : 'text-warning-fg'}
      >
        {smartState(view)}
      </span>
      {view.missing > 0 && (
        <Button
          size="sm"
          icon={Trash2}
          data-testid="smart-remove-missing"
          title="Take out the items whose files are no longer in the folder"
          onClick={() => void removeMissingItems(playlistId)}
        >
          Remove the missing ({view.missing})
        </Button>
      )}
    </div>
  );
}

function itemMenu(item: PlaylistItemInfo): MenuEntry[] {
  const remove = {
    label: 'Remove from playlist',
    icon: Trash2,
    danger: true,
    separatorBefore: true,
    onSelect: () => {
      if (!usePlaylists.getState().marked.includes(item.id))
        clickItem(item.id, { toggle: false, range: false });
      void removeMarkedItems();
    },
  };
  if (item.kind === 'header')
    return [{ label: 'Rename…', icon: Pencil, onSelect: () => startRenaming(item.id) }, remove];
  // A slot (not a placeholder an import left): its name and where filling it starts.
  if (item.kind === 'placeholder' && item.hint === null)
    return [
      {
        label: 'Edit slot…',
        icon: Pencil,
        onSelect: () => {
          usePlaylists.setState({ editingSlot: item });
        },
      },
      remove,
    ];
  const timers: MenuEntry[] =
    item.kind === 'presentation' || item.kind === 'media' || item.kind === 'shastra'
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
  // A picture's zoom and enhancements (Session 26e).
  if (item.kind === 'media' && item.media === 'image' && !item.missing && item.unplayable === null)
    return [
      {
        label: 'Picture editor…',
        icon: SlidersHorizontal,
        onSelect: () => {
          openPictureEditor({ id: item.mediaId, name: item.label });
        },
      },
      ...timers,
      remove,
    ];
  // A video's or sound's start, end and markers, on its timeline (Session 26e).
  if (item.kind === 'media' && item.media !== 'image' && !item.missing && item.unplayable === null)
    return [
      {
        label: 'Start, end and markers…',
        icon: Bookmark,
        onSelect: () => {
          openMarkers(markersMedia(item));
        },
      },
      ...timers,
      remove,
    ];
  if (item.kind === 'presentation' && item.presentationName !== null)
    return [
      {
        label: 'Show in the library',
        icon: Presentation,
        onSelect: () => {
          leaveItem();
          void selectPresentation(item.presentationId);
        },
      },
      ...timers,
      remove,
    ];
  return [...timers, remove];
}

/** A line under an item that runs timer cues: what it does to which timers. */
function CuesLine({ cues }: { cues: readonly TimerCue[] }) {
  const timers = useEngine((s) => s.state?.timers);
  if (cues.length === 0) return null;
  const name = (id: string) => timers?.find((t) => t.id === id)?.name ?? 'a timer since removed';
  const verb = { start: 'starts', reset: 'resets', show: 'shows' } as const;
  return (
    <span className="flex items-center gap-1 truncate text-xs text-muted" data-testid="item-timer-cues">
      <Timer size={12} aria-hidden="true" className="shrink-0" />
      {cues.map((c) => `${verb[c.action]} “${name(c.timerId)}”`).join(', ')}
    </span>
  );
}

/**
 * After a move the keyboard stays where it was: on the item, or on its Up or Down (on the item once
 * that is off). Only when it was lost (the row moved, or the button went off): never taken back from
 * where the operator has gone since, even beside it (Tab from the item to Down). Put back as the list
 * is drawn in its new order, and looked at again a frame later (Sessions 31–36: put back only then, a
 * key pressed in between went nowhere).
 */
function keepFocus(id: string, on: 'item' | 'up' | 'down'): void {
  const row = document.querySelector(`[data-item-row="${CSS.escape(id)}"]`);
  const now = document.activeElement;
  const lost =
    now === null ||
    now === document.body ||
    (now instanceof HTMLButtonElement && now.disabled && (row?.contains(now) ?? false));
  if (!row || !lost) return;
  const button = on === 'item' ? null : row.querySelector<HTMLElement>(`[data-move="${on}"]:not(:disabled)`);
  (button ?? row.querySelector<HTMLElement>('[data-testid="playlist-item"]'))?.focus();
}

/**
 * Up and Down on the chosen item, on a line under it so its name keeps its room: it moves a place,
 * as one Undo step, without dragging (Alt+↑ ↓ too).
 */
function MoveButtons({
  name,
  first,
  last,
  hidden,
  onMove,
}: {
  name: string;
  first: boolean;
  last: boolean;
  /** While a drag is under way: hidden, keeping its room (drag.ts). */
  hidden: boolean;
  onMove: (step: -1 | 1, on: 'up' | 'down') => void;
}) {
  return (
    <span
      role="group"
      aria-label={`Move “${name}”`}
      data-testid="playlist-item-moves"
      className={cx('mt-1 mb-1 flex justify-end gap-1', hidden && 'invisible')}
    >
      <Button
        size="sm"
        icon={ArrowUp}
        data-move="up"
        disabled={first}
        title="Up a place (Alt+↑)"
        onClick={() => onMove(-1, 'up')}
      >
        Up
      </Button>
      <Button
        size="sm"
        icon={ArrowDown}
        data-move="down"
        disabled={last}
        title="Down a place (Alt+↓)"
        onClick={() => onMove(1, 'down')}
      >
        Down
      </Button>
    </span>
  );
}

function PlaylistItems({ platform, openId }: { platform: string; openId: string }) {
  const node = usePlaylists(
    (s) => s.tree.find((n) => n.id === openId) ?? s.templates.find((n) => n.id === openId),
  );
  const isTemplate = usePlaylists(templateOpen);
  // Slots and templates only with View › Show Shastra, Templates and Kirtan Details (Session 26a).
  const extras = useExtras((s) => s.on);
  const items = usePlaylists((s) => s.items);
  const listRef = useRef<HTMLUListElement>(null);
  /** Where the rows were before a move (Up, Down, Alt+↑ ↓), until the list is drawn in its new order. */
  const slideFrom = useRef<Map<string, number> | null>(null);
  /** Where the keyboard was before a move, put back in the same commit as the list's new order. */
  const focusFrom = useRef<{ id: string; on: 'item' | 'up' | 'down' } | null>(null);
  useLayoutEffect(() => {
    const keep = focusFrom.current;
    focusFrom.current = null;
    if (keep) keepFocus(keep.id, keep.on);
    const before = slideFrom.current;
    if (!before) return;
    slideFrom.current = null;
    slideRows(listRef.current, 'data-item-row', before);
  }, [items]);
  const marked = usePlaylists((s) => s.marked);
  const anchorId = usePlaylists((s) => s.anchorId);
  const dragging = useDragging((s) => s.on);
  const renaming = usePlaylists((s) => s.renaming);
  const renameIn = usePlaylists((s) => s.renameIn);
  const [spot, setSpot] = useState<DropSpot | null>(null);
  // The cards' pictures: each presentation's first slide.
  const presentationIds = items.flatMap((i) => (i.kind === 'presentation' ? [i.presentationId] : []));
  const wanted = presentationIds.join(' ');
  useEffect(() => {
    wantSlides(wanted === '' ? [] : wanted.split(' '));
  }, [wanted]);
  const [menu, setMenu] = useState<{ at: MenuPlace; item: PlaylistItemInfo } | null>(null);
  // What is this? (Sessions 31–36): its ? in the playlist's header row, its words under it.
  const help = useWhatIsThis('playlist');
  const markedSet = new Set(marked);
  // The item on the screens now: the playlist's place, while something of it is up (not after Clear all).
  const liveItem = useEngine((s) => {
    const st = s.state;
    // A Repeat Slides playlist's step on the screens (Session 26d): its slide is named by its item.
    const step = st?.layers.slide?.presentationId === `repeat:${openId}` ? st.layers.slide : null;
    if (step) return step.slide.id.split('/')[0] ?? null;
    if (st?.live.playlist?.playlistId !== openId) return null;
    const up = st.layers.slide !== null || st.layers.background !== null || st.layers.audio !== null;
    return up ? st.live.playlist.itemId : null;
  });
  const shownItem = useLibrary((s) => (s.item?.playlistId === openId ? s.item.id : null));

  const spotFor = (e: DragEvent): DropSpot => {
    const row = (e.target as HTMLElement).closest<HTMLElement>('[data-item-index]');
    if (!row) return { at: items.length };
    const index = Number(row.dataset['itemIndex']);
    const box = row.getBoundingClientRect();
    const part = (e.clientY - box.top) / Math.max(1, box.height);
    const item = items[index];
    const kind = dragKind(e);
    // A presentation or a passage dropped on the middle of a slot (or a placeholder) fills it.
    if (
      (kind === 'presentations' || kind === 'passages') &&
      item?.kind === 'placeholder' &&
      part > 0.2 &&
      part < 0.8
    )
      return { fill: item.id };
    return { at: part < 0.5 ? index : index + 1 };
  };
  const sameSpot = (a: DropSpot | null, b: DropSpot) =>
    a !== null && ('at' in a && 'at' in b ? a.at === b.at : 'fill' in a && 'fill' in b && a.fill === b.fill);

  const onDragOver = (e: DragEvent) => {
    const kind = dragKind(e);
    if (!kind && !hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = kind === 'items' ? 'move' : 'copy';
    const next = spotFor(e);
    if (!sameSpot(spot, next)) setSpot(next);
  };
  const onDrop = (e: DragEvent) => {
    const kind = dragKind(e);
    // Files from the Finder or Explorer: imported as anywhere, then added where they landed, in the
    // order dropped (Session 26a). The window's own drop, which only imports, never sees them.
    if (!kind && hasFiles(e)) {
      e.preventDefault();
      e.stopPropagation();
      const where = spotFor(e);
      setSpot(null);
      const at = 'at' in where ? where.at : items.findIndex((i) => i.id === where.fill);
      void importIntoPlaylist(openId, at, droppedPaths(e));
      return;
    }
    if (!kind) return;
    e.preventDefault();
    const where = spotFor(e);
    setSpot(null);
    if (kind === 'items') {
      if ('at' in where) void moveItems(droppedIds(e, 'items'), where.at);
      return;
    }
    if ('fill' in where)
      void fillPlaceholder(where.fill, droppedIds(e, kind === 'passages' ? 'passages' : 'presentations'));
    else void addFromLibrary(openId, where.at, droppedItems(e));
  };

  const lineAt = spot && 'at' in spot ? spot.at : null;
  return (
    // Drops land anywhere on it (Session 26a): on an item where it falls, elsewhere (its header, the space
    // below its items) at the end.
    <section
      aria-label={`Playlist: ${node?.name ?? ''}`}
      data-testid="open-playlist"
      className="flex min-h-0 flex-1 flex-col"
      onDragOver={onDragOver}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setSpot(null);
      }}
      onDrop={onDrop}
    >
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-line px-3 py-2">
        {node?.kind === 'smart' ? (
          <FolderSync size={16} aria-hidden="true" className="shrink-0 text-muted" />
        ) : node?.kind === 'repeat' ? (
          <Repeat2 size={16} aria-hidden="true" className="shrink-0 text-muted" />
        ) : (
          <ListMusic size={16} aria-hidden="true" className="shrink-0 text-muted" />
        )}
        {renaming === openId && renameIn === 'centre' ? (
          <span className="min-w-40 flex-1">
            <RenameField
              value={node?.name ?? ''}
              label="Playlist name"
              onDone={(name) => {
                if (name === null) stopRenaming();
                else void renameNode(openId, name);
              }}
            />
          </span>
        ) : (
          <h2
            className="min-w-40 flex-1 truncate text-base font-bold"
            data-testid="playlist-title"
            title={`${node?.name ?? ''} (double-click to rename)`}
            onDoubleClick={() => {
              startRenaming(openId, 'centre');
            }}
          >
            {node?.name ?? ''}
          </h2>
        )}
        {!isTemplate && (
          <>
            <Button
              size="sm"
              icon={FilePlus}
              data-testid="playlist-add-files"
              title="Import files and add them at the end of this playlist"
              onClick={() => void addFilesTo(openId)}
            >
              Add files…
            </Button>
            <Button
              size="sm"
              icon={Link2}
              data-testid="playlist-from-link"
              title="Download from a link and add it at the end of this playlist"
              onClick={() => {
                chooseAddTo({ kind: 'playlist', id: openId });
                openLinkDialog();
              }}
            >
              From a Link…
            </Button>
          </>
        )}
        {help.button}
        <MenuButton
          label="Playlist"
          title="Playlist actions"
          icon={MoreHorizontal}
          entries={[
            { label: 'Add a header', icon: ListPlus, onSelect: () => void addHeader() },
            ...(extras
              ? [
                  {
                    label: 'Add a slot…',
                    icon: SquareDashed,
                    onSelect: () => {
                      usePlaylists.setState({ addingSlot: true });
                    },
                  },
                ]
              : []),
            ...(isTemplate
              ? [
                  {
                    label: 'New playlist from this',
                    icon: ListPlus,
                    separatorBefore: true,
                    onSelect: () => void newFromTemplate(openId),
                  },
                ]
              : extras
                ? [
                    {
                      label: 'Save as template…',
                      icon: BookTemplate,
                      separatorBefore: true,
                      onSelect: () => {
                        usePlaylists.setState({ savingTemplate: openId });
                      },
                    },
                  ]
                : []),
            {
              label: isTemplate ? 'Rename template…' : 'Rename playlist…',
              icon: Pencil,
              onSelect: () => startRenaming(openId, 'centre'),
            },
            {
              label: isTemplate ? 'Delete template…' : 'Delete playlist…',
              icon: Trash2,
              danger: true,
              separatorBefore: true,
              onSelect: () => requestRemoveNode(openId),
            },
          ]}
        />
        <IconButton
          icon={X}
          label="Close the playlist"
          size="sm"
          data-testid="playlist-close"
          onClick={closePlaylist}
        />
      </div>
      {help.card && <div className="shrink-0 pt-2">{help.card}</div>}
      {node?.kind === 'smart' && <SmartBar playlistId={openId} />}
      {node?.kind === 'repeat' && node.repeat && <RepeatBar playlistId={openId} settings={node.repeat} />}
      {isTemplate && (
        <Notice
          tone="info"
          compact
          className="mx-2 mb-2"
          data-testid="template-banner"
          actions={
            <Button size="sm" icon={ListPlus} onClick={() => void newFromTemplate(openId)}>
              New playlist from this
            </Button>
          }
        >
          A template: make a playlist from it to run a sabha. It never goes on the screens itself.
        </Notice>
      )}
      <ul
        ref={listRef}
        aria-label={`Items in ${node?.name ?? 'the playlist'}`}
        data-testid="playlist-items"
        data-count={items.length}
        // (Drops are the section's: see above.)
        // Scrolled into view, an item keeps the list's padding: never flush against the divider below,
        // whose grab area reaches a few pixels into the list (a drop there would miss the list).
        className="min-h-0 flex-1 scroll-py-2 space-y-1 overflow-y-auto px-3 py-2"
      >
        {items.map((item, index) => {
          const isMarked = markedSet.has(item.id);
          const isLive = liveItem === item.id;
          const line =
            lineAt === index
              ? 'shadow-[0_-2px_0_0_var(--color-accent)]'
              : lineAt === items.length && index === items.length - 1
                ? 'shadow-[0_2px_0_0_var(--color-accent)]'
                : '';
          const filling = spot !== null && 'fill' in spot && spot.fill === item.id;
          if (renaming === item.id && item.kind === 'header')
            return (
              <li key={item.id} data-item-index={index} className="py-0.5">
                <RenameField
                  value={item.label}
                  label="Header"
                  onDone={(label) => {
                    if (label === null) stopRenaming();
                    else void renameHeader(item.id, label);
                  }}
                />
              </li>
            );
          const look =
            item.kind !== 'placeholder'
              ? ''
              : item.hint === null
                ? 'border-dashed border-line-strong!'
                : 'border-dashed border-warning/70! bg-warning-bg/60';
          const move = (step: -1 | 1, on: 'item' | 'up' | 'down') => {
            // The rows slide to their new places once the list is drawn in its new order (ui/motion.ts).
            slideFrom.current = rowTops(listRef.current, 'data-item-row');
            focusFrom.current = { id: item.id, on };
            void moveItemBy(item.id, step).then((moved) => {
              if (!moved) {
                slideFrom.current = null;
                focusFrom.current = null;
              }
              if (moved || on === 'item')
                requestAnimationFrame(() => {
                  keepFocus(item.id, on);
                });
            });
          };
          return (
            <li
              key={item.id}
              data-item-index={index}
              data-item-row={item.id}
              className={cx('group relative rounded-md', line)}
              onKeyDown={(e) => {
                const action = actionFor(e.nativeEvent, platform, LIBRARY_KEYMAP);
                if (action !== 'moveItemUp' && action !== 'moveItemDown') return;
                e.preventDefault();
                const on = (e.target as HTMLElement).dataset['move'];
                move(action === 'moveItemUp' ? -1 : 1, on === 'up' || on === 'down' ? on : 'item');
              }}
            >
              <button
                type="button"
                draggable
                data-testid="playlist-item"
                data-kind={item.kind}
                data-item-id={item.id}
                data-marked={isMarked ? 'true' : undefined}
                data-live={isLive ? 'true' : undefined}
                aria-pressed={isMarked}
                aria-current={shownItem === item.id ? 'true' : undefined}
                aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
                aria-label={
                  item.kind !== 'placeholder'
                    ? undefined
                    : item.hint === null
                      ? `Slot: ${item.label}${item.category ? ` (${item.category})` : ''}. Press to choose what goes here.`
                      : `Not found: ${item.label}. Drag a presentation here to replace it.`
                }
                onClick={(e) => {
                  const mods = { toggle: platform === 'darwin' ? e.metaKey : e.ctrlKey, range: e.shiftKey };
                  // A plain click shows the item in the slide grid; with Cmd/Ctrl or Shift it only marks.
                  if (mods.toggle || mods.range) clickItem(item.id, mods);
                  else void pickItem(item);
                }}
                onDoubleClick={() => {
                  if (item.kind === 'header') startRenaming(item.id);
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  if (!markedSet.has(item.id)) clickItem(item.id, { toggle: false, range: false });
                  setMenu({ at: menuPlace(e), item });
                }}
                onKeyDown={(e) => {
                  if (isMenuKey(e)) {
                    e.preventDefault();
                    if (!markedSet.has(item.id)) clickItem(item.id, { toggle: false, range: false });
                    setMenu({ at: menuBelow(e.currentTarget), item });
                    return;
                  }
                  if (!isRemoveKey(e, platform)) return;
                  e.preventDefault();
                  if (!usePlaylists.getState().marked.includes(item.id))
                    clickItem(item.id, { toggle: false, range: false });
                  void removeMarkedItems();
                }}
                onDragStart={(e) => {
                  const ours = usePlaylists.getState().marked.includes(item.id);
                  startDrag(e, 'items', ours ? markedItems().map((i) => i.id) : [item.id]);
                  // Chosen once the drag is over: choosing it now would move Up and Down (and the
                  // rows) under the pointer as the drag starts.
                  if (!ours)
                    afterDrag(() => {
                      clickItem(item.id, { toggle: false, range: false });
                    });
                }}
                className={cx(
                  rowClass({ selected: shownItem === item.id, marked: isMarked, dropTarget: filling }),
                  'pr-10 pl-2.5',
                  item.kind === 'header' ? 'min-h-8 pt-2 pb-1' : 'min-h-11 py-1.5',
                  look,
                )}
              >
                <ItemBody item={item} live={isLive} />
              </button>

              {isMarked && anchorId === item.id && (
                <MoveButtons
                  name={itemName(item)}
                  first={index === 0}
                  last={index === items.length - 1}
                  hidden={dragging}
                  onMove={move}
                />
              )}
              {/* Out of the playlist only (the library keeps it), as Delete does on the item; Undo puts it
                  back (Session 26a). Last in the Tab order, after Up and Down. */}
              <RowDelete
                label={`Remove “${itemName(item)}” from the playlist`}
                chosen={isMarked && anchorId === item.id}
                className={cx('absolute right-1.5', item.kind === 'header' ? 'top-0.5' : 'top-2')}
                onDelete={() => {
                  if (!usePlaylists.getState().marked.includes(item.id))
                    clickItem(item.id, { toggle: false, range: false });
                  void removeMarkedItems();
                }}
              />
            </li>
          );
        })}
        {items.length === 0 && (
          <li
            className={cx(
              'rounded-lg border border-dashed',
              lineAt !== null ? 'border-accent' : 'border-line-strong',
            )}
          >
            <EmptyState icon={ListPlus} title="This playlist is empty" compact lamp>
              Drag presentations, pictures, videos or files here, use Add files… or From a Link… above, or
              choose one in the library and press Add to playlist.
            </EmptyState>
          </li>
        )}
      </ul>
      {menu && (
        <Menu
          at={menu.at}
          label={menu.item.label}
          entries={itemMenu(menu.item)}
          onClose={() => {
            setMenu(null);
          }}
        />
      )}
    </section>
  );
}

/** Add files…: import files chosen in the system's dialog, then add what they made at the end. */
async function addFilesTo(playlistId: string): Promise<void> {
  const paths = await window.drashti.library.pickImportPaths('files');
  await importIntoPlaylist(playlistId, null, paths);
}

/**
 * The open playlist (Session 26a: in the centre, above the chosen item's slides): its items as cards, in
 * order, to drag about, drop library rows and files on, and download into.
 */
export function OpenPlaylist({ platform }: { platform: string }) {
  const openId = usePlaylists((s) => s.openId);
  if (!openId) return null;
  return <PlaylistItems platform={platform} openId={openId} />;
}
